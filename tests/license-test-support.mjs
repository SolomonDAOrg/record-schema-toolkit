// @ts-check

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
    LICENSE_CHECKSUM_SURFACE,
    LICENSE_RULE
} from "../lib/record-schema/LicenseDocument.mjs";
import { sha256Hex } from "../lib/util/hashes.mjs";

const TEST_IDENTIFIER = "LicenseRef-SOLOMON-DAO-TEST-LICENSE";
const TEST_TITLE = "SOLOMON DAO LLC TEST LICENSE";
const TEST_VERSION = "1.0";
const TEST_EFFECTIVE_DATE = "2026-07-29";
const TEST_CANONICAL_URL =
    `https://github.com/SolomonDAOrg/licenses/blob/main/LICENSES/${TEST_IDENTIFIER}`;
const METADATA_BEGIN =
    "----------------------------BEGIN DOCUMENT METADATA-----------------------------";
const METADATA_END =
    "-----------------------------END DOCUMENT METADATA------------------------------";
const LEGACY_METADATA_END =
    "-----------------------------END DOCUMENT METADATA-------------------------------";

/**
 * @typedef {Object} BuildTestLicenseOptions
 * @property {string} [identifier]
 * @property {string} [title]
 * @property {string} [version]
 * @property {string} [effectiveDate]
 * @property {string} [spdxFieldName]
 * @property {string} [preamble]
 * @property {string} [bodyClause]
 * @property {string} [scheduleClause]
 * @property {string} [declaredChecksum]
 * @property {string} [metadataChecksum]
 * @property {string} [metadataVersion]
 * @property {boolean} [legacyMetadataEnd]
 * @property {string[]} [additionalMetadata]
 */

/**
 * @param {BuildTestLicenseOptions} [options]
 * @returns {{text: string, checksum: string, surface: string, identifier: string, canonicalUrl: string}}
 */
function buildTestLicense(options = {}) {
    const identifier = options.identifier || TEST_IDENTIFIER;
    const title = options.title || TEST_TITLE;
    const version = options.version || TEST_VERSION;
    const effectiveDate = options.effectiveDate || TEST_EFFECTIVE_DATE;
    const spdxFieldName =
        options.spdxFieldName || "SPDX-LicenseIdentifier";
    const canonicalUrl =
        `https://github.com/SolomonDAOrg/licenses/blob/main/LICENSES/${identifier}`;
    const preamble =
        options.preamble ||
        "Copyright (c) 2026 SOLOMON DAO LLC\n\nThis existing header text remains in place.\n\n";
    const bodyClause =
        options.bodyClause ||
        "The permission and restriction text is part of the legal body.";
    const scheduleClause =
        options.scheduleClause ||
        "SCHEDULE A --- RETAINED CONTENT\n\n- retained/path/**";
    const surface = [
        "",
        "1. TERMS",
        "",
        bodyClause,
        "",
        LICENSE_RULE,
        "",
        scheduleClause,
        "",
        LICENSE_RULE,
        "",
        "END OF LICENSE",
        "",
        LICENSE_RULE
    ].join("\n") + "\n";
    const checksum = sha256Hex(new TextEncoder().encode(surface));
    const declaredChecksum = options.declaredChecksum || checksum;
    const metadataChecksum = options.metadataChecksum || declaredChecksum;
    const metadataVersion = options.metadataVersion || version;
    const metadataEnd = options.legacyMetadataEnd
        ? LEGACY_METADATA_END
        : METADATA_END;
    const additionalMetadata = options.additionalMetadata || [];
    const metadataLines = [
        `${spdxFieldName}: ${identifier}`,
        "Document-Type: LICENSE",
        `Title: ${title}`,
        `Version: ${metadataVersion}`,
        `Effective-Date: ${effectiveDate}`,
        ...additionalMetadata,
        `Canonical-URL: ${canonicalUrl}`,
        `Checksum-SHA256: ${metadataChecksum}`,
        `Checksum-Surface: ${LICENSE_CHECKSUM_SURFACE}`
    ];
    const text =
        `${title}\n\n` +
        `Version ${version} - Effective 29 July 2026\n` +
        `Version: ${version}\n` +
        `Checksum-SHA256: ${declaredChecksum}\n\n` +
        preamble +
        `${LICENSE_RULE}\n` +
        surface +
        `\n${METADATA_BEGIN}\n` +
        `${metadataLines.join("\n")}\n` +
        `${metadataEnd}\n`;
    return { text, checksum, surface, identifier, canonicalUrl };
}

/**
 * @param {string} rootDirectory
 * @param {"canonical" | "repository-copy"} [kind]
 * @param {BuildTestLicenseOptions} [options]
 * @returns {{path: string, text: string, checksum: string, surface: string, identifier: string, canonicalUrl: string}}
 */
function writeTestLicense(rootDirectory, kind = "repository-copy", options = {}) {
    const built = buildTestLicense(options);
    const targetPath =
        kind === "canonical"
            ? join(rootDirectory, "LICENSES", built.identifier)
            : join(rootDirectory, "LICENSE");
    mkdirSync(join(rootDirectory, "LICENSES"), { recursive: true });
    writeFileSync(targetPath, built.text, "utf8");
    return { path: targetPath, ...built };
}

/**
 * @param {string} rootDirectory
 * @param {string} checksum
 * @param {{path?: string, identifier?: string}} [options]
 */
function writeTestRegistry(rootDirectory, checksum, options = {}) {
    const identifier = options.identifier || TEST_IDENTIFIER;
    const registryPath = options.path || `LICENSES/${identifier}`;
    const canonicalUrl =
        `https://github.com/SolomonDAOrg/licenses/blob/main/${registryPath}`;
    const registry = {
        schema: "record-schema-license-registry",
        schema_version: 1,
        canonical_repository: "https://github.com/SolomonDAOrg/licenses",
        checksum_surface: LICENSE_CHECKSUM_SURFACE,
        licenses: [
            {
                spdx_license_identifier: identifier,
                title: TEST_TITLE,
                version: TEST_VERSION,
                effective_date: TEST_EFFECTIVE_DATE,
                path: registryPath,
                canonical_url: canonicalUrl,
                checksum_sha256: checksum,
                checksum_surface: LICENSE_CHECKSUM_SURFACE
            }
        ]
    };
    writeFileSync(
        join(rootDirectory, "LICENSES.json"),
        `${JSON.stringify(registry, null, 2)}\n`,
        "utf8"
    );
}

/**
 * @param {string} rootDirectory
 * @param {string} checksum
 * @param {{licenseFile?: string, checksumOverride?: string}} [options]
 */
function writeTestUpstream(rootDirectory, checksum, options = {}) {
    const licenseFile = options.licenseFile || "./LICENSE";
    const declaredChecksum = options.checksumOverride || checksum;
    writeFileSync(
        join(rootDirectory, "SCHEMA_UPSTREAM.yaml"),
        `schema: record-schema-upstream\nschema_version: 1\n\nrecord_schema:\n  upstreams: []\n  provides:\n    - name: Test repository\n      kind: tooling\n      id: test-repository\n      license: "${TEST_TITLE}"\n      licenseRef: "${TEST_IDENTIFIER}"\n      licenseCanonicalUrl: "${TEST_CANONICAL_URL}"\n      licenseChecksumSha256: "${declaredChecksum}"\n      licenseChecksumSurface: "license-body-v1"\n      licenseFile: "${licenseFile}"\n`,
        "utf8"
    );
}

export {
    LEGACY_METADATA_END,
    METADATA_BEGIN,
    METADATA_END,
    TEST_CANONICAL_URL,
    TEST_EFFECTIVE_DATE,
    TEST_IDENTIFIER,
    TEST_TITLE,
    TEST_VERSION,
    buildTestLicense,
    writeTestLicense,
    writeTestRegistry,
    writeTestUpstream
};
