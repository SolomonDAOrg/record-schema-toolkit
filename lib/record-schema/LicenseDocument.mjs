/**
 * Parsing and verification for custom LICENSE documents.
 *
 * @module record-schema/LicenseDocument
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { DocumentMetadata } from "./DocumentMetadata.mjs";
import {
    DOCUMENT_METADATA_BEGIN,
    DOCUMENT_METADATA_END
} from "./constants/constants.mjs";
import { normalizeEol, trimBom } from "./util/normalization.mjs";
import { sha256Hex } from "../util/hashes.mjs";

const LICENSE_RULE = "=".repeat(80);
const LICENSE_END_MARKER = "END OF LICENSE";
const LICENSE_CHECKSUM_SURFACE = "license-body-v1";
const CANONICAL_LICENSE_REPOSITORY_URL =
    "https://github.com/SolomonDAOrg/licenses";
const SPDX_LICENSE_REF_PATTERN =
    /^LicenseRef-[A-Za-z0-9][A-Za-z0-9.-]{0,127}$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LEGACY_DOCUMENT_METADATA_END = `${DOCUMENT_METADATA_END}-`;
const METADATA_FIELD_NAME_PATTERN =
    /^[A-Z][A-Za-z0-9]*(?:-[A-Z][A-Za-z0-9]*)*$/;
const TOP_FIELD_NAMES = new Set([
    "Version",
    "Checksum-SHA256",
    "Canonical-URL",
    "Repository-Role"
]);
const REQUIRED_METADATA_FIELDS = [
    "Document-Type",
    "Title",
    "Version",
    "Effective-Date",
    "Canonical-URL",
    "Checksum-SHA256",
    "Checksum-Surface"
];
const SPDX_FIELD_NAMES = [
    "SPDX-LicenseIdentifier",
    "SPDX-License-Identifier"
];

/**
 * @typedef {Object} LicenseValidationIssue
 * @property {"error" | "warn"} severity
 * @property {string} code
 * @property {string} message
 * @property {string} file
 * @property {number} [line]
 */

/**
 * @typedef {Object} LicenseDocumentValidationOptions
 * @property {boolean} [expectedCanonicalFile]
 * @property {Record<string, unknown> | null} [registryEntry]
 * @property {LicenseDocument | null} [canonicalDocument]
 */

/**
 * @param {string | null} sourcePath
 * @param {"error" | "warn"} severity
 * @param {string} code
 * @param {string} message
 * @param {number} [line]
 * @returns {LicenseValidationIssue}
 */
function makeIssue(sourcePath, severity, code, message, line) {
    /** @type {LicenseValidationIssue} */
    const issue = {
        severity,
        code,
        message,
        file: sourcePath || "<memory>"
    };
    if (typeof line === "number") {
        issue.line = line;
    }
    return issue;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isValidDate(value) {
    if (!DATE_PATTERN.test(value)) {
        return false;
    }
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}

/**
 * @param {Record<string, string | string[]>} data
 * @param {string} key
 * @param {string} value
 */
function addFieldValue(data, key, value) {
    const existingValue = data[key];
    if (typeof existingValue === "undefined") {
        data[key] = value;
        return;
    }
    if (typeof existingValue === "string") {
        data[key] = [existingValue, value];
        return;
    }
    existingValue.push(value);
}

/**
 * @param {DocumentMetadata} metadata
 * @param {string} key
 * @returns {boolean}
 */
function hasSingleValue(metadata, key) {
    return typeof metadata.get(key) === "string";
}

/**
 * @param {string} canonicalUrl
 * @param {string} identifier
 * @returns {boolean}
 */
function canonicalUrlMatchesIdentifier(canonicalUrl, identifier) {
    return (
        canonicalUrl ===
        `${CANONICAL_LICENSE_REPOSITORY_URL}/blob/main/LICENSES/${identifier}`
    );
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function stringValue(value) {
    return typeof value === "string" ? value : null;
}

/**
 * A parsed custom LICENSE document.
 */
export class LicenseDocument {
    /**
     * @param {string} sourceText
     * @param {string | null} [sourcePath]
     * @param {LicenseValidationIssue[]} [initialIssues]
     */
    constructor(sourceText, sourcePath = null, initialIssues = []) {
        /** @type {string | null} */
        this.source_path = sourcePath;
        /** @type {string} */
        this.source_text = sourceText;
        /** @type {string} */
        this.normalized_text = normalizeEol(trimBom(sourceText));
        /** @type {string[]} */
        this.lines = this.normalized_text.split("\n");
        /** @type {string} */
        this.title = this.lines.length > 0 ? this.lines[0] : "";
        /** @type {DocumentMetadata} */
        this.header = DocumentMetadata.empty();
        /** @type {DocumentMetadata} */
        this.metadata = DocumentMetadata.empty();
        /** @type {string | null} */
        this.checksum_surface_text = null;
        /** @type {string | null} */
        this.computed_checksum_sha256 = null;
        /** @type {number | null} */
        this.surface_start_line = null;
        /** @type {number | null} */
        this.surface_end_line = null;
        /** @type {LicenseValidationIssue[]} */
        this.parse_issues = initialIssues.slice();
        /** @type {number | null} */
        this.first_separator_index = null;
        /** @type {number | null} */
        this.end_marker_index = null;
        /** @type {number | null} */
        this.closing_separator_index = null;
        /** @type {number | null} */
        this.metadata_begin_index = null;
        /** @type {number | null} */
        this.metadata_end_index = null;

        if (initialIssues.length === 0) {
            this.parseDocument();
        }
    }

    /**
     * @param {string} sourceText
     * @param {string | null} [sourcePath]
     * @returns {LicenseDocument}
     */
    static parse(sourceText, sourcePath = null) {
        return new LicenseDocument(sourceText, sourcePath);
    }

    /**
     * @param {string} sourcePath
     * @returns {LicenseDocument}
     */
    static load(sourcePath) {
        const sourceBytes = new Uint8Array(readFileSync(sourcePath));
        try {
            const sourceText = new TextDecoder("utf-8", {
                fatal: true,
                ignoreBOM: false
            }).decode(sourceBytes);
            return new LicenseDocument(sourceText, sourcePath);
        } catch {
            return new LicenseDocument("", sourcePath, [
                makeIssue(
                    sourcePath,
                    "error",
                    "license.encoding.invalid_utf8",
                    "LICENSE must decode as valid UTF-8"
                )
            ]);
        }
    }

    parseDocument() {
        this.findChecksumSurface();
        this.parseTopFields();
        this.parseTrailingMetadata();
    }

    findChecksumSurface() {
        let firstSeparatorIndex = -1;
        for (let i = 0, len = this.lines.length; i < len; i++) {
            if (this.lines[i] === LICENSE_RULE) {
                firstSeparatorIndex = i;
                break;
            }
        }
        if (firstSeparatorIndex === -1) {
            this.parse_issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.surface.start_separator",
                    "LICENSE must contain an exact 80-character '=' separator"
                )
            );
            return;
        }
        this.first_separator_index = firstSeparatorIndex;

        /** @type {number[]} */
        const endMarkerIndexes = [];
        for (
            let i = firstSeparatorIndex + 1, len = this.lines.length;
            i < len;
            i++
        ) {
            if (this.lines[i] === LICENSE_END_MARKER) {
                endMarkerIndexes.push(i);
            }
        }
        if (endMarkerIndexes.length !== 1) {
            this.parse_issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.surface.end_marker",
                    `LICENSE must contain exactly one ${LICENSE_END_MARKER} line after the first checksum separator`
                )
            );
            return;
        }
        const endMarkerIndex = endMarkerIndexes[0];
        this.end_marker_index = endMarkerIndex;

        let precedingNonEmptyIndex = endMarkerIndex - 1;
        while (
            precedingNonEmptyIndex > firstSeparatorIndex &&
            this.lines[precedingNonEmptyIndex] === ""
        ) {
            precedingNonEmptyIndex--;
        }
        if (this.lines[precedingNonEmptyIndex] !== LICENSE_RULE) {
            this.parse_issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.surface.end_block",
                    `${LICENSE_END_MARKER} must be preceded by an exact 80-character '=' separator`,
                    endMarkerIndex + 1
                )
            );
        }

        let closingSeparatorIndex = endMarkerIndex + 1;
        while (
            closingSeparatorIndex < this.lines.length &&
            this.lines[closingSeparatorIndex] === ""
        ) {
            closingSeparatorIndex++;
        }
        if (this.lines[closingSeparatorIndex] !== LICENSE_RULE) {
            this.parse_issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.surface.closing_separator",
                    `${LICENSE_END_MARKER} must be followed by an exact 80-character '=' separator`,
                    endMarkerIndex + 1
                )
            );
            return;
        }

        this.closing_separator_index = closingSeparatorIndex;
        this.surface_start_line = firstSeparatorIndex + 2;
        this.surface_end_line = closingSeparatorIndex + 1;
        this.checksum_surface_text =
            this.lines
                .slice(firstSeparatorIndex + 1, closingSeparatorIndex + 1)
                .join("\n") + "\n";
        this.computed_checksum_sha256 = sha256Hex(
            new TextEncoder().encode(this.checksum_surface_text)
        );
    }

    parseTopFields() {
        if (this.first_separator_index === null) {
            return;
        }
        /** @type {Record<string, string | string[]>} */
        const data = {};
        for (let i = 0; i < this.first_separator_index; i++) {
            const line = this.lines[i];
            const separatorIndex = line.indexOf(":");
            if (separatorIndex <= 0) {
                continue;
            }
            const key = line.slice(0, separatorIndex);
            if (!TOP_FIELD_NAMES.has(key)) {
                continue;
            }
            const value = line.slice(separatorIndex + 1).trim();
            if (value.length === 0) {
                this.parse_issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.header.field.empty",
                        `${key} must not be empty`,
                        i + 1
                    )
                );
                continue;
            }
            addFieldValue(data, key, value);
        }
        this.header = new DocumentMetadata(data, this.source_path);
    }

    parseTrailingMetadata() {
        let beginIndex = -1;
        for (let i = this.lines.length - 1; i >= 0; i--) {
            if (this.lines[i] === DOCUMENT_METADATA_BEGIN) {
                beginIndex = i;
                break;
            }
        }
        if (beginIndex === -1) {
            this.parse_issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.metadata.begin",
                    "LICENSE must contain the established trailing document metadata block"
                )
            );
            return;
        }
        this.metadata_begin_index = beginIndex;

        let endIndex = -1;
        for (let i = beginIndex + 1, len = this.lines.length; i < len; i++) {
            const line = this.lines[i];
            if (
                line === DOCUMENT_METADATA_END ||
                line === LEGACY_DOCUMENT_METADATA_END
            ) {
                endIndex = i;
                break;
            }
        }
        if (endIndex === -1) {
            this.parse_issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.metadata.end",
                    "LICENSE trailing document metadata block is not closed"
                )
            );
            return;
        }
        this.metadata_end_index = endIndex;

        for (let i = endIndex + 1, len = this.lines.length; i < len; i++) {
            if (this.lines[i] !== "") {
                this.parse_issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.metadata.trailing_content",
                        "Only LF line termination may follow the document metadata block",
                        i + 1
                    )
                );
                break;
            }
        }

        /** @type {Record<string, string | string[]>} */
        const data = {};
        for (let i = beginIndex + 1; i < endIndex; i++) {
            const line = this.lines[i];
            if (line.length === 0) {
                this.parse_issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.metadata.blank_line",
                        "The trailing document metadata block must not contain blank lines",
                        i + 1
                    )
                );
                continue;
            }
            const separatorIndex = line.indexOf(":");
            if (separatorIndex <= 0) {
                this.parse_issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.metadata.field.invalid",
                        "Document metadata lines must use 'Field: value' syntax",
                        i + 1
                    )
                );
                continue;
            }
            const key = line.slice(0, separatorIndex).trim();
            const value = line.slice(separatorIndex + 1).trim();
            if (key.length === 0 || value.length === 0) {
                this.parse_issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.metadata.field.invalid",
                        "Document metadata field names and values must be non-empty",
                        i + 1
                    )
                );
                continue;
            }
            if (!METADATA_FIELD_NAME_PATTERN.test(key)) {
                this.parse_issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.metadata.field.name",
                        `Invalid document metadata field name ${key}`,
                        i + 1
                    )
                );
            }
            addFieldValue(data, key, value);
        }
        this.metadata = new DocumentMetadata(data, this.source_path);
        const metadataKeys = Object.keys(data);
        for (let i = 0, len = metadataKeys.length; i < len; i++) {
            const key = metadataKeys[i];
            if (Array.isArray(data[key])) {
                this.parse_issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.metadata.field.duplicate",
                        `Trailing document metadata contains duplicate ${key}: fields`
                    )
                );
            }
        }
    }

    /**
     * @param {LicenseDocumentValidationOptions} [options]
     * @returns {LicenseValidationIssue[]}
     */
    validate(options = {}) {
        /** @type {LicenseValidationIssue[]} */
        const issues = this.parse_issues.slice();
        if (issues.some((issue) => issue.code === "license.encoding.invalid_utf8")) {
            return issues;
        }

        if (this.title.length === 0) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.title.missing",
                    "LICENSE title must be the first line"
                )
            );
        }

        this.validateTopFields(issues);
        this.validateMetadata(issues);
        this.validateIdentityAgreement(issues);

        const identifier = this.getSpdxLicenseIdentifier();
        if (
            options.expectedCanonicalFile === true &&
            identifier !== null &&
            this.source_path !== null &&
            basename(this.source_path) !== identifier
        ) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.canonical_filename.invalid",
                    `Canonical license filename must be exactly ${identifier} with no extension`
                )
            );
        }

        if (options.registryEntry) {
            this.validateRegistryEntry(options.registryEntry, issues);
        }
        if (options.canonicalDocument) {
            this.validateCanonicalDocument(options.canonicalDocument, issues);
        }
        return issues;
    }

    /**
     * @param {LicenseValidationIssue[]} issues
     */
    validateTopFields(issues) {
        const requiredHeaderFields = ["Version", "Checksum-SHA256"];
        for (let i = 0, len = requiredHeaderFields.length; i < len; i++) {
            const key = requiredHeaderFields[i];
            if (!this.header.has(key)) {
                issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.header.field.missing",
                        `Top license header must retain and include ${key}:`
                    )
                );
            } else if (!hasSingleValue(this.header, key)) {
                issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.header.field.duplicate",
                        `Top license header must contain exactly one ${key}: field`
                    )
                );
            }
        }

        const headerKeys = [
            "Version",
            "Checksum-SHA256",
            "Canonical-URL",
            "Repository-Role"
        ];
        for (let i = 0, len = headerKeys.length; i < len; i++) {
            const key = headerKeys[i];
            if (this.header.has(key) && !hasSingleValue(this.header, key)) {
                issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.header.field.duplicate",
                        `Top license header must contain at most one ${key}: field`
                    )
                );
            }
        }

        const checksum = this.header.getString("Checksum-SHA256");
        if (checksum && !SHA256_HEX_PATTERN.test(checksum)) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.header.checksum.invalid",
                    "Top Checksum-SHA256 must be 64 lowercase hexadecimal characters"
                )
            );
        }
        if (
            checksum &&
            this.computed_checksum_sha256 &&
            checksum !== this.computed_checksum_sha256
        ) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.checksum.mismatch",
                    `Top checksum ${checksum} does not match computed ${this.computed_checksum_sha256}`
                )
            );
        }
    }

    /**
     * @param {LicenseValidationIssue[]} issues
     */
    validateMetadata(issues) {
        for (let i = 0, len = REQUIRED_METADATA_FIELDS.length; i < len; i++) {
            const key = REQUIRED_METADATA_FIELDS[i];
            if (!this.metadata.has(key)) {
                issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.metadata.field.missing",
                        `Trailing document metadata must contain ${key}:`
                    )
                );
            } else if (!hasSingleValue(this.metadata, key)) {
                issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.metadata.field.duplicate",
                        `Trailing document metadata must contain exactly one ${key}: field`
                    )
                );
            }
        }

        let spdxFieldCount = 0;
        for (let i = 0, len = SPDX_FIELD_NAMES.length; i < len; i++) {
            const key = SPDX_FIELD_NAMES[i];
            if (this.metadata.has(key)) {
                spdxFieldCount++;
                if (!hasSingleValue(this.metadata, key)) {
                    issues.push(
                        makeIssue(
                            this.source_path,
                            "error",
                            "license.metadata.spdx.duplicate",
                            `Trailing document metadata must contain exactly one ${key}: field`
                        )
                    );
                }
            }
        }
        if (spdxFieldCount !== 1) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.metadata.spdx.count",
                    "Trailing document metadata must preserve exactly one SPDX-LicenseIdentifier or SPDX-License-Identifier field"
                )
            );
        }

        const documentType = this.metadata.getString("Document-Type");
        if (documentType && documentType !== "LICENSE") {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.metadata.document_type",
                    "Document-Type must be LICENSE"
                )
            );
        }

        const identifier = this.getSpdxLicenseIdentifier();
        if (identifier && !SPDX_LICENSE_REF_PATTERN.test(identifier)) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.metadata.spdx.invalid",
                    `${identifier} is not a valid LicenseRef identifier`
                )
            );
        }

        const effectiveDate = this.getEffectiveDate();
        if (effectiveDate && !isValidDate(effectiveDate)) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.metadata.effective_date.invalid",
                    "Effective-Date must be a valid YYYY-MM-DD date"
                )
            );
        }

        const checksum = this.getChecksumSha256();
        if (checksum && !SHA256_HEX_PATTERN.test(checksum)) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.metadata.checksum.invalid",
                    "Metadata Checksum-SHA256 must be 64 lowercase hexadecimal characters"
                )
            );
        }
        if (
            checksum &&
            this.computed_checksum_sha256 &&
            checksum !== this.computed_checksum_sha256
        ) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.checksum.mismatch",
                    `Metadata checksum ${checksum} does not match computed ${this.computed_checksum_sha256}`
                )
            );
        }

        const checksumSurface = this.getChecksumSurface();
        if (
            checksumSurface &&
            checksumSurface !== LICENSE_CHECKSUM_SURFACE
        ) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.metadata.checksum_surface.invalid",
                    `Checksum-Surface must be ${LICENSE_CHECKSUM_SURFACE}`
                )
            );
        }

        const canonicalUrl = this.getCanonicalUrl();
        if (
            canonicalUrl &&
            identifier &&
            !canonicalUrlMatchesIdentifier(canonicalUrl, identifier)
        ) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.canonical_url.invalid",
                    `Canonical-URL must be ${CANONICAL_LICENSE_REPOSITORY_URL}/blob/main/LICENSES/${identifier}`
                )
            );
        }
    }

    /**
     * @param {LicenseValidationIssue[]} issues
     */
    validateIdentityAgreement(issues) {
        const topVersion = this.header.getString("Version");
        const metadataVersion = this.getVersion();
        if (topVersion && metadataVersion && topVersion !== metadataVersion) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.header_metadata.mismatch",
                    `Top Version ${topVersion} does not match metadata Version ${metadataVersion}`
                )
            );
        }

        const topChecksum = this.header.getString("Checksum-SHA256");
        const metadataChecksum = this.getChecksumSha256();
        if (
            topChecksum &&
            metadataChecksum &&
            topChecksum !== metadataChecksum
        ) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.header_metadata.mismatch",
                    "Top and metadata Checksum-SHA256 values do not match"
                )
            );
        }

        const metadataTitle = this.metadata.getString("Title");
        if (metadataTitle && metadataTitle !== this.title) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.title.mismatch",
                    `Metadata Title ${metadataTitle} does not match first-line title ${this.title}`
                )
            );
        }

        const topCanonicalUrl = this.header.getString("Canonical-URL");
        const metadataCanonicalUrl = this.getCanonicalUrl();
        if (
            topCanonicalUrl &&
            metadataCanonicalUrl &&
            topCanonicalUrl !== metadataCanonicalUrl
        ) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.header_metadata.mismatch",
                    "Top and metadata Canonical-URL values do not match"
                )
            );
        }
    }

    /**
     * @param {Record<string, unknown>} entry
     * @param {LicenseValidationIssue[]} issues
     */
    validateRegistryEntry(entry, issues) {
        const comparisons = [
            ["spdx_license_identifier", this.getSpdxLicenseIdentifier()],
            ["title", this.title],
            ["version", this.getVersion()],
            ["effective_date", this.getEffectiveDate()],
            ["canonical_url", this.getCanonicalUrl()],
            ["checksum_sha256", this.getChecksumSha256()],
            ["checksum_surface", this.getChecksumSurface()]
        ];
        for (let i = 0, len = comparisons.length; i < len; i++) {
            const fieldName = comparisons[i][0];
            const documentValue = comparisons[i][1];
            const registryValue = stringValue(entry[fieldName]);
            if (registryValue !== documentValue) {
                issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.registry.mismatch",
                        `Registry ${fieldName} does not match canonical LICENSE document`
                    )
                );
            }
        }
    }

    /**
     * @param {LicenseDocument} canonicalDocument
     * @param {LicenseValidationIssue[]} issues
     */
    validateCanonicalDocument(canonicalDocument, issues) {
        const comparisons = [
            [
                "SPDX identifier",
                this.getSpdxLicenseIdentifier(),
                canonicalDocument.getSpdxLicenseIdentifier()
            ],
            ["title", this.title, canonicalDocument.title],
            ["version", this.getVersion(), canonicalDocument.getVersion()],
            [
                "effective date",
                this.getEffectiveDate(),
                canonicalDocument.getEffectiveDate()
            ],
            [
                "canonical URL",
                this.getCanonicalUrl(),
                canonicalDocument.getCanonicalUrl()
            ],
            [
                "checksum",
                this.getChecksumSha256(),
                canonicalDocument.getChecksumSha256()
            ],
            [
                "checksum surface",
                this.getChecksumSurface(),
                canonicalDocument.getChecksumSurface()
            ],
            [
                "legal-body checksum surface",
                this.checksum_surface_text,
                canonicalDocument.checksum_surface_text
            ]
        ];
        for (let i = 0, len = comparisons.length; i < len; i++) {
            if (comparisons[i][1] !== comparisons[i][2]) {
                issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.canonical.mismatch",
                        `Repository LICENSE ${comparisons[i][0]} does not match the canonical license`
                    )
                );
            }
        }
    }

    /** @returns {string | null} */
    getSpdxLicenseIdentifier() {
        const compactValue = this.metadata.getString(
            "SPDX-LicenseIdentifier"
        );
        const hyphenatedValue = this.metadata.getString(
            "SPDX-License-Identifier"
        );
        if (compactValue && !hyphenatedValue) {
            return compactValue;
        }
        if (hyphenatedValue && !compactValue) {
            return hyphenatedValue;
        }
        return null;
    }

    /** @returns {string | null} */
    getVersion() {
        return this.metadata.getString("Version") || null;
    }

    /** @returns {string | null} */
    getEffectiveDate() {
        return this.metadata.getString("Effective-Date") || null;
    }

    /** @returns {string | null} */
    getCanonicalUrl() {
        return this.metadata.getString("Canonical-URL") || null;
    }

    /** @returns {string | null} */
    getChecksumSha256() {
        return this.metadata.getString("Checksum-SHA256") || null;
    }

    /** @returns {string | null} */
    getChecksumSurface() {
        return this.metadata.getString("Checksum-Surface") || null;
    }

    /** @returns {string | null} */
    getRepositoryRole() {
        return this.header.getString("Repository-Role") || null;
    }

    /** @returns {Record<string, string | null>} */
    toSummary() {
        return {
            file: this.source_path,
            title: this.title || null,
            spdx_license_identifier: this.getSpdxLicenseIdentifier(),
            version: this.getVersion(),
            effective_date: this.getEffectiveDate(),
            canonical_url: this.getCanonicalUrl(),
            checksum_surface: this.getChecksumSurface(),
            declared_checksum_sha256: this.getChecksumSha256(),
            computed_checksum_sha256: this.computed_checksum_sha256,
            repository_role: this.getRepositoryRole()
        };
    }
}

export {
    CANONICAL_LICENSE_REPOSITORY_URL,
    LICENSE_CHECKSUM_SURFACE,
    LICENSE_END_MARKER,
    LICENSE_RULE,
    makeIssue
};
