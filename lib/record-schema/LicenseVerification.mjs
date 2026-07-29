/**
 * Repository-level LICENSE and canonical registry verification.
 *
 * @module record-schema/LicenseVerification
 */

import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { parseYaml } from "../parsing/yaml.mjs";
import {
    LICENSE_CHECKSUM_SURFACE,
    LicenseDocument,
    makeIssue
} from "./LicenseDocument.mjs";
import {
    LicenseRegistry,
    resolveContainedRegularFile
} from "./LicenseRegistry.mjs";

/**
 * @typedef {import("./LicenseDocument.mjs").LicenseValidationIssue} LicenseValidationIssue
 */

/**
 * @typedef {Object} LicenseVerificationResult
 * @property {string} root
 * @property {string | null} canonical_root
 * @property {boolean} local_registry
 * @property {boolean} canonical_registry
 * @property {Record<string, string | null>[]} licenses
 * @property {LicenseValidationIssue[]} issues
 * @property {{licenses: number, registry_licenses: number, errors: number, warnings: number}} stats
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
 * @param {string} absolutePath
 * @returns {string}
 */
function relativeDisplayPath(rootDirectory, absolutePath) {
    const relativePath = relative(rootDirectory, absolutePath);
    return relativePath.length > 0
        ? relativePath.replaceAll("\\", "/")
        : ".";
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>[]}
 */
function objectArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    /** @type {Record<string, unknown>[]} */
    const output = [];
    for (let i = 0, len = value.length; i < len; i++) {
        const entry = objectValue(value[i]);
        if (entry !== null) {
            output.push(entry);
        }
    }
    return output;
}

/**
 * @param {Record<string, unknown>} parsedUpstream
 * @returns {Record<string, unknown>[]}
 */
function collectLicenseDeclarations(parsedUpstream) {
    const recordSchema = objectValue(parsedUpstream.record_schema);
    if (recordSchema === null) {
        return [];
    }
    return [
        ...objectArray(recordSchema.upstreams),
        ...objectArray(recordSchema.provides)
    ].filter((entry) => {
        return (
            Object.prototype.hasOwnProperty.call(entry, "license") ||
            Object.prototype.hasOwnProperty.call(entry, "licenseRef") ||
            Object.prototype.hasOwnProperty.call(
                entry,
                "licenseCanonicalUrl"
            ) ||
            Object.prototype.hasOwnProperty.call(
                entry,
                "licenseChecksumSha256"
            ) ||
            Object.prototype.hasOwnProperty.call(
                entry,
                "licenseChecksumSurface"
            ) ||
            Object.prototype.hasOwnProperty.call(entry, "licenseFile")
        );
    });
}

/**
 * @param {Record<string, unknown>} declaration
 * @param {number} declarationIndex
 * @param {string} upstreamPath
 * @param {string} rootDirectory
 * @param {LicenseRegistry | null} canonicalRegistry
 * @param {Map<string, LicenseDocument>} loadedDocuments
 * @param {LicenseValidationIssue[]} issues
 */
function validateLicenseDeclaration(
    declaration,
    declarationIndex,
    upstreamPath,
    rootDirectory,
    canonicalRegistry,
    loadedDocuments,
    issues
) {
    const requiredFields = [
        "license",
        "licenseRef",
        "licenseCanonicalUrl",
        "licenseChecksumSha256",
        "licenseChecksumSurface"
    ];
    for (let i = 0, len = requiredFields.length; i < len; i++) {
        const fieldName = requiredFields[i];
        if (stringValue(declaration[fieldName]) === null) {
            issues.push(
                makeIssue(
                    upstreamPath,
                    "error",
                    "upstream.license.field.missing",
                    `License declaration ${declarationIndex + 1} must contain ${fieldName}`
                )
            );
        }
    }

    const identifier = stringValue(declaration.licenseRef);
    const declaredTitle = stringValue(declaration.license);
    const declaredCanonicalUrl = stringValue(
        declaration.licenseCanonicalUrl
    );
    const declaredChecksum = stringValue(
        declaration.licenseChecksumSha256
    );
    const declaredSurface = stringValue(
        declaration.licenseChecksumSurface
    );
    const declaredFile = stringValue(declaration.licenseFile);

    if (
        declaredSurface !== null &&
        declaredSurface !== LICENSE_CHECKSUM_SURFACE
    ) {
        issues.push(
            makeIssue(
                upstreamPath,
                "error",
                "upstream.license.checksum_surface",
                `licenseChecksumSurface must be ${LICENSE_CHECKSUM_SURFACE}`
            )
        );
    }

    /** @type {LicenseDocument | null} */
    let localDocument = null;
    if (declaredFile !== null) {
        const absolutePath = resolveContainedRegularFile(
            rootDirectory,
            declaredFile
        );
        if (absolutePath === null) {
            issues.push(
                makeIssue(
                    upstreamPath,
                    "error",
                    "upstream.license.file.path",
                    `licenseFile must resolve to a contained regular non-symlink file: ${declaredFile}`
                )
            );
        } else if (!existsSync(absolutePath)) {
            issues.push(
                makeIssue(
                    upstreamPath,
                    "error",
                    "upstream.license.file.missing",
                    `licenseFile does not exist: ${declaredFile}`
                )
            );
        } else {
            localDocument = loadedDocuments.get(absolutePath) || null;
            if (localDocument === null) {
                localDocument = LicenseDocument.load(absolutePath);
                loadedDocuments.set(absolutePath, localDocument);
                issues.push(...localDocument.validate());
            }
        }
    }

    if (localDocument !== null) {
        const comparisons = [
            ["license", declaredTitle, localDocument.title],
            [
                "licenseRef",
                identifier,
                localDocument.getSpdxLicenseIdentifier()
            ],
            [
                "licenseCanonicalUrl",
                declaredCanonicalUrl,
                localDocument.getCanonicalUrl()
            ],
            [
                "licenseChecksumSha256",
                declaredChecksum,
                localDocument.getChecksumSha256()
            ],
            [
                "licenseChecksumSurface",
                declaredSurface,
                localDocument.getChecksumSurface()
            ]
        ];
        for (let i = 0, len = comparisons.length; i < len; i++) {
            if (comparisons[i][1] !== comparisons[i][2]) {
                issues.push(
                    makeIssue(
                        upstreamPath,
                        "error",
                        "upstream.license.mismatch",
                        `${comparisons[i][0]} does not match ${declaredFile}`
                    )
                );
            }
        }
    }

    if (canonicalRegistry === null || identifier === null) {
        return;
    }
    const canonicalEntry = canonicalRegistry.getEntry(identifier);
    if (canonicalEntry === null) {
        issues.push(
            makeIssue(
                upstreamPath,
                "error",
                "upstream.license.canonical_missing",
                `Canonical registry does not contain ${identifier}`
            )
        );
        return;
    }
    const registryComparisons = [
        ["license", declaredTitle, stringValue(canonicalEntry.title)],
        [
            "licenseCanonicalUrl",
            declaredCanonicalUrl,
            stringValue(canonicalEntry.canonical_url)
        ],
        [
            "licenseChecksumSha256",
            declaredChecksum,
            stringValue(canonicalEntry.checksum_sha256)
        ],
        [
            "licenseChecksumSurface",
            declaredSurface,
            stringValue(canonicalEntry.checksum_surface)
        ]
    ];
    for (let i = 0, len = registryComparisons.length; i < len; i++) {
        if (registryComparisons[i][1] !== registryComparisons[i][2]) {
            issues.push(
                makeIssue(
                    upstreamPath,
                    "error",
                    "upstream.license.canonical_mismatch",
                    `${registryComparisons[i][0]} does not match canonical registry entry ${identifier}`
                )
            );
        }
    }

    if (localDocument !== null) {
        const canonicalDocument = canonicalRegistry.loadDocument(identifier);
        if (canonicalDocument === null) {
            issues.push(
                makeIssue(
                    upstreamPath,
                    "error",
                    "upstream.license.canonical_file_missing",
                    `Canonical LICENSE file is unavailable for ${identifier}`
                )
            );
        } else {
            issues.push(
                ...localDocument.validate({
                    canonicalDocument
                })
            );
        }
    }
}

/**
 * Verify a repository LICENSE, SCHEMA_UPSTREAM declarations, local registry,
 * and optional canonical registry checkout.
 *
 * @param {string} rootDirectory
 * @param {{canonicalRoot?: string | null, requireLicense?: boolean}} [options]
 * @returns {LicenseVerificationResult}
 */
export function verifyLicenseRepository(rootDirectory, options = {}) {
    const root = resolve(rootDirectory);
    const canonicalRoot = options.canonicalRoot
        ? resolve(options.canonicalRoot)
        : null;
    const requireLicense = options.requireLicense !== false;
    /** @type {LicenseValidationIssue[]} */
    const issues = [];
    /** @type {Map<string, LicenseDocument>} */
    const loadedDocuments = new Map();

    const localRegistry = LicenseRegistry.loadFromRoot(root);
    if (localRegistry !== null) {
        issues.push(...localRegistry.validate());
    }

    /** @type {LicenseRegistry | null} */
    let canonicalRegistry = null;
    if (canonicalRoot !== null) {
        canonicalRegistry = LicenseRegistry.loadFromRoot(canonicalRoot);
        if (canonicalRegistry === null) {
            issues.push(
                makeIssue(
                    canonicalRoot,
                    "error",
                    "license.canonical.registry_missing",
                    "Canonical root does not contain LICENSES.json"
                )
            );
        } else if (
            localRegistry === null ||
            canonicalRegistry.source_path !== localRegistry.source_path
        ) {
            issues.push(...canonicalRegistry.validate());
        }
    } else if (localRegistry !== null) {
        canonicalRegistry = localRegistry;
    }

    const rootLicensePath = resolve(root, "LICENSE");
    if (!existsSync(rootLicensePath)) {
        if (requireLicense) {
            issues.push(
                makeIssue(
                    rootLicensePath,
                    "error",
                    "license.root.missing",
                    "Repository root LICENSE is missing"
                )
            );
        }
    } else {
        const rootDocument = LicenseDocument.load(rootLicensePath);
        loadedDocuments.set(rootLicensePath, rootDocument);
        issues.push(...rootDocument.validate());
        const identifier = rootDocument.getSpdxLicenseIdentifier();
        if (canonicalRegistry !== null && identifier !== null) {
            const canonicalDocument = canonicalRegistry.loadDocument(identifier);
            if (canonicalDocument === null) {
                issues.push(
                    makeIssue(
                        rootLicensePath,
                        "error",
                        "license.canonical.missing",
                        `Canonical registry does not contain a readable file for ${identifier}`
                    )
                );
            } else {
                issues.push(
                    ...rootDocument.validate({
                        canonicalDocument
                    })
                );
            }
        }
    }

    const upstreamPath = resolve(root, "SCHEMA_UPSTREAM.yaml");
    if (existsSync(upstreamPath)) {
        try {
            const parsedValue = parseYaml(readFileSync(upstreamPath, "utf8"), {
                filename: upstreamPath
            });
            const parsedUpstream = objectValue(parsedValue);
            if (parsedUpstream === null) {
                issues.push(
                    makeIssue(
                        upstreamPath,
                        "error",
                        "upstream.license.parse",
                        "SCHEMA_UPSTREAM.yaml root must be an object"
                    )
                );
            } else {
                const declarations =
                    collectLicenseDeclarations(parsedUpstream);
                for (
                    let i = 0, len = declarations.length;
                    i < len;
                    i++
                ) {
                    validateLicenseDeclaration(
                        declarations[i],
                        i,
                        upstreamPath,
                        root,
                        canonicalRegistry,
                        loadedDocuments,
                        issues
                    );
                }
            }
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            issues.push(
                makeIssue(
                    upstreamPath,
                    "error",
                    "upstream.license.parse",
                    `Unable to parse SCHEMA_UPSTREAM.yaml: ${message}`
                )
            );
        }
    }

    /** @type {Record<string, string | null>[]} */
    const licenses = [];
    const loadedDocumentEntries = Array.from(loadedDocuments.entries());
    for (
        let i = 0, len = loadedDocumentEntries.length;
        i < len;
        i++
    ) {
        const absolutePath = loadedDocumentEntries[i][0];
        const document = loadedDocumentEntries[i][1];
        const summary = document.toSummary();
        summary.file = relativeDisplayPath(root, absolutePath);
        licenses.push(summary);
    }
    licenses.sort((left, right) =>
        String(left.file).localeCompare(String(right.file))
    );

    const stats = {
        licenses: licenses.length,
        registry_licenses:
            canonicalRegistry === null
                ? 0
                : canonicalRegistry.getEntries().length,
        errors: issues.filter((issue) => issue.severity === "error").length,
        warnings: issues.filter((issue) => issue.severity === "warn").length
    };

    return {
        root,
        canonical_root: canonicalRoot,
        local_registry: localRegistry !== null,
        canonical_registry: canonicalRegistry !== null,
        licenses,
        issues,
        stats
    };
}
