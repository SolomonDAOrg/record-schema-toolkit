/**
 * Canonical custom-license registry loading and verification.
 *
 * @module record-schema/LicenseRegistry
 */

import {
    existsSync,
    lstatSync,
    readFileSync,
    readdirSync,
    realpathSync
} from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

import {
    CANONICAL_LICENSE_REPOSITORY_URL,
    LICENSE_CHECKSUM_SURFACE,
    LicenseDocument,
    makeIssue
} from "./LicenseDocument.mjs";

const REGISTRY_FILENAME = "LICENSES.json";
const REGISTRY_SCHEMA_NAME = "record-schema-license-registry";
const REGISTRY_SCHEMA_VERSION = 1;
const LICENSE_PATH_PATTERN =
    /^LICENSES\/(LicenseRef-[A-Za-z0-9][A-Za-z0-9.-]{0,127})$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @typedef {import("./LicenseDocument.mjs").LicenseValidationIssue} LicenseValidationIssue
 */

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function objectValue(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
    }
    return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function stringValue(value) {
    return typeof value === "string" ? value : null;
}

/**
 * @param {string} rootDirectory
 * @param {string} relativePath
 * @returns {string | null}
 */
function resolveContainedRegularFile(rootDirectory, relativePath) {
    if (
        relativePath.length === 0 ||
        relativePath.startsWith("/") ||
        relativePath.startsWith("\\") ||
        isAbsolute(relativePath) ||
        relativePath.includes("\0")
    ) {
        return null;
    }
    const rootAbsolutePath = resolve(rootDirectory);
    const absolutePath = resolve(rootAbsolutePath, relativePath);
    const relativeResolvedPath = relative(rootAbsolutePath, absolutePath);
    if (
        relativeResolvedPath === ".." ||
        relativeResolvedPath.startsWith(`..${sep}`)
    ) {
        return null;
    }
    if (!existsSync(absolutePath)) {
        return absolutePath;
    }
    let fileStatus;
    try {
        fileStatus = lstatSync(absolutePath);
    } catch {
        return null;
    }
    if (!fileStatus.isFile() || fileStatus.isSymbolicLink()) {
        return null;
    }
    let realRootPath;
    let realFilePath;
    try {
        realRootPath = realpathSync(rootAbsolutePath);
        realFilePath = realpathSync(absolutePath);
    } catch {
        return null;
    }
    const realRelativePath = relative(realRootPath, realFilePath);
    if (
        realRelativePath === ".." ||
        realRelativePath.startsWith(`..${sep}`)
    ) {
        return null;
    }
    return absolutePath;
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
 * Canonical LICENSES.json registry.
 */
export class LicenseRegistry {
    /**
     * @param {string | null} rootDirectory
     * @param {Record<string, unknown>} data
     * @param {string | null} sourcePath
     * @param {LicenseValidationIssue[]} [parseIssues]
     */
    constructor(rootDirectory, data, sourcePath, parseIssues = []) {
        /** @type {string | null} */
        this.root_dir = rootDirectory;
        /** @type {Record<string, unknown>} */
        this.data = data;
        /** @type {string | null} */
        this.source_path = sourcePath;
        /** @type {LicenseValidationIssue[]} */
        this.parse_issues = parseIssues.slice();
    }

    /**
     * @param {string} sourcePath
     * @returns {LicenseRegistry}
     */
    static load(sourcePath) {
        const rootDirectory = resolve(sourcePath, "..");
        try {
            const parsedValue = JSON.parse(readFileSync(sourcePath, "utf8"));
            const data = objectValue(parsedValue);
            if (data === null) {
                return new LicenseRegistry(rootDirectory, {}, sourcePath, [
                    makeIssue(
                        sourcePath,
                        "error",
                        "license.registry.shape",
                        "LICENSES.json root must be an object"
                    )
                ]);
            }
            return new LicenseRegistry(rootDirectory, data, sourcePath);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            return new LicenseRegistry(rootDirectory, {}, sourcePath, [
                makeIssue(
                    sourcePath,
                    "error",
                    "license.registry.parse",
                    `Unable to parse LICENSES.json: ${message}`
                )
            ]);
        }
    }

    /**
     * @param {string} rootDirectory
     * @returns {LicenseRegistry | null}
     */
    static loadFromRoot(rootDirectory) {
        const sourcePath = resolve(rootDirectory, REGISTRY_FILENAME);
        if (!existsSync(sourcePath)) {
            return null;
        }
        return LicenseRegistry.load(sourcePath);
    }

    /**
     * @returns {Record<string, unknown>[]}
     */
    getEntries() {
        const licensesValue = this.data.licenses;
        if (!Array.isArray(licensesValue)) {
            return [];
        }
        /** @type {Record<string, unknown>[]} */
        const entries = [];
        for (let i = 0, len = licensesValue.length; i < len; i++) {
            const entry = objectValue(licensesValue[i]);
            if (entry !== null) {
                entries.push(entry);
            }
        }
        return entries;
    }

    /**
     * @param {string} identifier
     * @returns {Record<string, unknown> | null}
     */
    getEntry(identifier) {
        const entries = this.getEntries();
        for (let i = 0, len = entries.length; i < len; i++) {
            if (entries[i].spdx_license_identifier === identifier) {
                return entries[i];
            }
        }
        return null;
    }

    /**
     * @param {string} identifier
     * @returns {LicenseDocument | null}
     */
    loadDocument(identifier) {
        if (this.root_dir === null) {
            return null;
        }
        const entry = this.getEntry(identifier);
        if (entry === null) {
            return null;
        }
        const registryPath = stringValue(entry.path);
        if (registryPath === null) {
            return null;
        }
        const absolutePath = resolveContainedRegularFile(
            this.root_dir,
            registryPath
        );
        if (absolutePath === null || !existsSync(absolutePath)) {
            return null;
        }
        return LicenseDocument.load(absolutePath);
    }

    /**
     * @param {{verifyFiles?: boolean}} [options]
     * @returns {LicenseValidationIssue[]}
     */
    validate(options = {}) {
        const verifyFiles = options.verifyFiles !== false;
        /** @type {LicenseValidationIssue[]} */
        const issues = this.parse_issues.slice();

        if (this.data.schema !== REGISTRY_SCHEMA_NAME) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.registry.schema",
                    `schema must be ${REGISTRY_SCHEMA_NAME}`
                )
            );
        }
        if (this.data.schema_version !== REGISTRY_SCHEMA_VERSION) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.registry.schema_version",
                    `schema_version must remain ${REGISTRY_SCHEMA_VERSION}`
                )
            );
        }
        if (
            this.data.canonical_repository !==
            CANONICAL_LICENSE_REPOSITORY_URL
        ) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.registry.repository",
                    `canonical_repository must be ${CANONICAL_LICENSE_REPOSITORY_URL}`
                )
            );
        }
        if (this.data.checksum_surface !== LICENSE_CHECKSUM_SURFACE) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.registry.checksum_surface",
                    `checksum_surface must be ${LICENSE_CHECKSUM_SURFACE}`
                )
            );
        }

        const licensesValue = this.data.licenses;
        if (!Array.isArray(licensesValue) || licensesValue.length === 0) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.registry.licenses",
                    "licenses must be a non-empty array"
                )
            );
            return issues;
        }

        const seenIdentifiers = new Set();
        const seenPaths = new Set();
        const seenCanonicalUrls = new Set();
        const expectedPaths = new Set();

        for (let i = 0, len = licensesValue.length; i < len; i++) {
            const entry = objectValue(licensesValue[i]);
            if (entry === null) {
                issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.registry.entry",
                        `licenses[${i}] must be an object`
                    )
                );
                continue;
            }
            this.validateEntry(
                entry,
                i,
                issues,
                seenIdentifiers,
                seenPaths,
                seenCanonicalUrls,
                expectedPaths,
                verifyFiles
            );
        }

        if (verifyFiles) {
            this.validateLicenseDirectory(expectedPaths, issues);
        }
        return issues;
    }

    /**
     * @param {Record<string, unknown>} entry
     * @param {number} index
     * @param {LicenseValidationIssue[]} issues
     * @param {Set<string>} seenIdentifiers
     * @param {Set<string>} seenPaths
     * @param {Set<string>} seenCanonicalUrls
     * @param {Set<string>} expectedPaths
     * @param {boolean} verifyFiles
     */
    validateEntry(
        entry,
        index,
        issues,
        seenIdentifiers,
        seenPaths,
        seenCanonicalUrls,
        expectedPaths,
        verifyFiles
    ) {
        const allowedFields = new Set([
            "spdx_license_identifier",
            "title",
            "version",
            "effective_date",
            "path",
            "canonical_url",
            "checksum_sha256",
            "checksum_surface"
        ]);
        const entryKeys = Object.keys(entry);
        for (let i = 0, len = entryKeys.length; i < len; i++) {
            if (!allowedFields.has(entryKeys[i])) {
                issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.registry.field.unknown",
                        `licenses[${index}] contains unsupported field ${entryKeys[i]}`
                    )
                );
            }
        }

        const requiredFields = [
            "spdx_license_identifier",
            "title",
            "version",
            "effective_date",
            "path",
            "canonical_url",
            "checksum_sha256",
            "checksum_surface"
        ];
        for (let i = 0, len = requiredFields.length; i < len; i++) {
            const key = requiredFields[i];
            if (stringValue(entry[key]) === null) {
                issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.registry.field",
                        `licenses[${index}].${key} must be a string`
                    )
                );
            }
        }

        const identifier = stringValue(entry.spdx_license_identifier);
        const registryPath = stringValue(entry.path);
        const canonicalUrl = stringValue(entry.canonical_url);
        const checksum = stringValue(entry.checksum_sha256);
        const effectiveDate = stringValue(entry.effective_date);
        const checksumSurface = stringValue(entry.checksum_surface);

        if (identifier !== null) {
            if (!LICENSE_PATH_PATTERN.test(`LICENSES/${identifier}`)) {
                issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.registry.identifier",
                        `licenses[${index}].spdx_license_identifier is not a valid LicenseRef`
                    )
                );
            }
            if (seenIdentifiers.has(identifier)) {
                issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.registry.identifier.duplicate",
                        `Duplicate license identifier ${identifier}`
                    )
                );
            }
            seenIdentifiers.add(identifier);
        }

        if (registryPath !== null) {
            const pathMatch = LICENSE_PATH_PATTERN.exec(registryPath);
            if (pathMatch === null) {
                issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.registry.path",
                        `licenses[${index}].path must be extensionless LICENSES/LicenseRef-*`
                    )
                );
            } else if (
                identifier !== null &&
                pathMatch[1] !== identifier
            ) {
                issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.registry.path",
                        `licenses[${index}].path must be LICENSES/${identifier}`
                    )
                );
            }
            if (seenPaths.has(registryPath)) {
                issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.registry.path.duplicate",
                        `Duplicate registry path ${registryPath}`
                    )
                );
            }
            seenPaths.add(registryPath);
            expectedPaths.add(registryPath);
        }

        if (identifier !== null && canonicalUrl !== null) {
            const expectedCanonicalUrl =
                `${CANONICAL_LICENSE_REPOSITORY_URL}/blob/main/LICENSES/${identifier}`;
            if (canonicalUrl !== expectedCanonicalUrl) {
                issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.registry.canonical_url",
                        `licenses[${index}].canonical_url must be ${expectedCanonicalUrl}`
                    )
                );
            }
        }
        if (canonicalUrl !== null) {
            if (seenCanonicalUrls.has(canonicalUrl)) {
                issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.registry.canonical_url.duplicate",
                        `Duplicate canonical URL ${canonicalUrl}`
                    )
                );
            }
            seenCanonicalUrls.add(canonicalUrl);
        }

        if (checksum !== null && !SHA256_HEX_PATTERN.test(checksum)) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.registry.checksum",
                    `licenses[${index}].checksum_sha256 must be lowercase SHA-256 hex`
                )
            );
        }
        if (effectiveDate !== null && !isValidDate(effectiveDate)) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.registry.effective_date",
                    `licenses[${index}].effective_date must be a valid YYYY-MM-DD date`
                )
            );
        }
        if (checksumSurface !== LICENSE_CHECKSUM_SURFACE) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.registry.checksum_surface",
                    `licenses[${index}].checksum_surface must be ${LICENSE_CHECKSUM_SURFACE}`
                )
            );
        }

        if (
            !verifyFiles ||
            this.root_dir === null ||
            registryPath === null
        ) {
            return;
        }
        const absolutePath = resolveContainedRegularFile(
            this.root_dir,
            registryPath
        );
        if (absolutePath === null) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.registry.file.path",
                    `Canonical license path must resolve to a contained regular non-symlink file: ${registryPath}`
                )
            );
            return;
        }
        if (!existsSync(absolutePath)) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.registry.file.missing",
                    `Canonical license file is missing: ${registryPath}`
                )
            );
            return;
        }
        const document = LicenseDocument.load(absolutePath);
        issues.push(
            ...document.validate({
                expectedCanonicalFile: true,
                registryEntry: entry
            })
        );
    }

    /**
     * @param {Set<string>} expectedPaths
     * @param {LicenseValidationIssue[]} issues
     */
    validateLicenseDirectory(expectedPaths, issues) {
        if (this.root_dir === null) {
            return;
        }
        const licensesDirectory = resolve(this.root_dir, "LICENSES");
        if (!existsSync(licensesDirectory)) {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.registry.directory",
                    "LICENSES directory is missing"
                )
            );
            return;
        }
        let directoryEntries;
        try {
            directoryEntries = readdirSync(licensesDirectory, {
                withFileTypes: true
            });
        } catch {
            issues.push(
                makeIssue(
                    this.source_path,
                    "error",
                    "license.registry.directory",
                    "Unable to read LICENSES directory"
                )
            );
            return;
        }
        for (let i = 0, len = directoryEntries.length; i < len; i++) {
            const entry = directoryEntries[i];
            const relativePath = `LICENSES/${entry.name}`;
            if (!entry.isFile() || entry.isSymbolicLink()) {
                issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.registry.file.path",
                        `Canonical license must be a regular non-symlink file: ${relativePath}`
                    )
                );
                continue;
            }
            if (!expectedPaths.has(relativePath)) {
                issues.push(
                    makeIssue(
                        this.source_path,
                        "error",
                        "license.registry.file.unregistered",
                        `Canonical license file is not listed in LICENSES.json: ${relativePath}`
                    )
                );
            }
        }
    }

    /** @returns {string} */
    getFileName() {
        return this.source_path ? basename(this.source_path) : REGISTRY_FILENAME;
    }
}

export {
    LICENSE_PATH_PATTERN,
    REGISTRY_FILENAME,
    REGISTRY_SCHEMA_NAME,
    REGISTRY_SCHEMA_VERSION,
    resolveContainedRegularFile
};
