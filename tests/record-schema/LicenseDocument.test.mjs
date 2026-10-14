// @ts-check

import assert from "node:assert/strict";
import {
    mkdtempSync,
    rmSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
    LICENSE_RULE,
    LicenseDocument
} from "../../lib/record-schema/LicenseDocument.mjs";
import {
    buildTestLicense,
    TEST_IDENTIFIER
} from "../license-test-support.mjs";

/** @param {ReturnType<LicenseDocument["validate"]>} issues */
function issueCodes(issues) {
    return issues.map((issue) => issue.code);
}

describe("LicenseDocument", () => {
    it("hashes immediately after the first separator through the closing separator", () => {
        const built = buildTestLicense();
        const document = LicenseDocument.parse(built.text);
        assert.equal(document.checksum_surface_text, built.surface);
        assert.ok(document.checksum_surface_text?.startsWith("\n1. TERMS"));
        assert.ok(document.checksum_surface_text?.endsWith(`${LICENSE_RULE}\n`));
        assert.equal(document.computed_checksum_sha256, built.checksum);
        assert.deepEqual(document.validate(), []);
    });

    it("does not hash title or established header text before the first separator", () => {
        const built = buildTestLicense();
        const changedText = built.text
            .replace("This existing header text remains in place.", "Different repository copy notice.");
        const document = LicenseDocument.parse(changedText);
        assert.equal(document.computed_checksum_sha256, built.checksum);
        assert.deepEqual(document.validate(), []);
    });

    it("detects mutations to legal body and retained schedules", () => {
        const built = buildTestLicense();
        const bodyMutation = built.text.replace(
            "The permission and restriction text is part of the legal body.",
            "The permission and restriction text was changed."
        );
        const scheduleMutation = built.text.replace(
            "- retained/path/**",
            "- deleted/or/changed/**"
        );
        assert.ok(
            issueCodes(LicenseDocument.parse(bodyMutation).validate()).includes(
                "license.checksum.mismatch"
            )
        );
        assert.ok(
            issueCodes(LicenseDocument.parse(scheduleMutation).validate()).includes(
                "license.checksum.mismatch"
            )
        );
    });

    it("normalizes CRLF and bare CR only", () => {
        const built = buildTestLicense();
        const crlf = LicenseDocument.parse(built.text.replaceAll("\n", "\r\n"));
        const bareCr = LicenseDocument.parse(built.text.replaceAll("\n", "\r"));
        assert.equal(crlf.computed_checksum_sha256, built.checksum);
        assert.equal(bareCr.computed_checksum_sha256, built.checksum);
        assert.deepEqual(crlf.validate(), []);
        assert.deepEqual(bareCr.validate(), []);
    });

    it("preserves and accepts both existing SPDX metadata field spellings", () => {
        const compact = LicenseDocument.parse(buildTestLicense().text);
        const hyphenated = LicenseDocument.parse(
            buildTestLicense({
                spdxFieldName: "SPDX-License-Identifier",
                legacyMetadataEnd: true,
                additionalMetadata: ["Owner: SOLOMON DAO LLC"]
            }).text
        );
        assert.equal(compact.getSpdxLicenseIdentifier(), TEST_IDENTIFIER);
        assert.equal(hyphenated.getSpdxLicenseIdentifier(), TEST_IDENTIFIER);
        assert.deepEqual(compact.validate(), []);
        assert.deepEqual(hyphenated.validate(), []);
    });

    it("rejects simultaneous SPDX field aliases instead of renaming either", () => {
        const built = buildTestLicense({
            additionalMetadata: [
                `SPDX-License-Identifier: ${TEST_IDENTIFIER}`
            ]
        });
        const issues = LicenseDocument.parse(built.text).validate();
        assert.ok(issueCodes(issues).includes("license.metadata.spdx.count"));
    });

    it("requires extensionless canonical filenames without changing repository LICENSE names", () => {
        const built = buildTestLicense();
        const canonical = LicenseDocument.parse(
            built.text,
            `/tmp/LICENSES/${TEST_IDENTIFIER}`
        );
        const txtCanonical = LicenseDocument.parse(
            built.text,
            `/tmp/LICENSES/${TEST_IDENTIFIER}.txt`
        );
        const repositoryCopy = LicenseDocument.parse(built.text, "/tmp/LICENSE");
        assert.deepEqual(canonical.validate({ expectedCanonicalFile: true }), []);
        assert.ok(
            issueCodes(
                txtCanonical.validate({ expectedCanonicalFile: true })
            ).includes("license.canonical_filename.invalid")
        );
        assert.deepEqual(repositoryCopy.validate(), []);
    });

    it("rejects invalid UTF-8 bytes", () => {
        const rootDirectory = mkdtempSync(join(tmpdir(), "license-utf8-"));
        try {
            const licensePath = join(rootDirectory, "LICENSE");
            writeFileSync(licensePath, new Uint8Array([0xff, 0xfe, 0xfd]));
            const issues = LicenseDocument.load(licensePath).validate();
            assert.ok(
                issueCodes(issues).includes("license.encoding.invalid_utf8")
            );
        } finally {
            rmSync(rootDirectory, { recursive: true, force: true });
        }
    });
});
