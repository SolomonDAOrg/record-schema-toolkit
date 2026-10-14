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

import { LicenseRegistry } from "../../lib/record-schema/LicenseRegistry.mjs";
import {
    TEST_IDENTIFIER,
    writeTestLicense,
    writeTestRegistry
} from "../license-test-support.mjs";

function makeDirectory() {
    return mkdtempSync(join(tmpdir(), "license-registry-"));
}

/** @param {ReturnType<LicenseRegistry["validate"]>} issues */
function issueCodes(issues) {
    return issues.map((issue) => issue.code);
}

describe("LicenseRegistry", () => {
    it("validates schema version 1 and extensionless canonical files", () => {
        const rootDirectory = makeDirectory();
        try {
            const canonical = writeTestLicense(rootDirectory, "canonical");
            writeTestRegistry(rootDirectory, canonical.checksum);
            const registry = LicenseRegistry.loadFromRoot(rootDirectory);
            assert.ok(registry);
            assert.equal(registry.data.schema_version, 1);
            assert.deepEqual(registry.validate(), []);
            assert.ok(registry.getEntry(TEST_IDENTIFIER));
            assert.ok(registry.loadDocument(TEST_IDENTIFIER));
        } finally {
            rmSync(rootDirectory, { recursive: true, force: true });
        }
    });

    it("rejects .txt canonical paths", () => {
        const rootDirectory = makeDirectory();
        try {
            const canonical = writeTestLicense(rootDirectory, "canonical");
            writeTestRegistry(rootDirectory, canonical.checksum, {
                path: `LICENSES/${TEST_IDENTIFIER}.txt`
            });
            const registry = LicenseRegistry.loadFromRoot(rootDirectory);
            assert.ok(registry);
            assert.ok(
                issueCodes(registry.validate()).includes(
                    "license.registry.path"
                )
            );
        } finally {
            rmSync(rootDirectory, { recursive: true, force: true });
        }
    });

    it("rejects an unregistered extensionless canonical file", () => {
        const rootDirectory = makeDirectory();
        try {
            const canonical = writeTestLicense(rootDirectory, "canonical");
            writeTestRegistry(rootDirectory, canonical.checksum);
            writeFileSync(
                join(rootDirectory, "LICENSES", "LicenseRef-UNREGISTERED"),
                canonical.text,
                "utf8"
            );
            const registry = LicenseRegistry.loadFromRoot(rootDirectory);
            assert.ok(registry);
            assert.ok(
                issueCodes(registry.validate()).includes(
                    "license.registry.file.unregistered"
                )
            );
        } finally {
            rmSync(rootDirectory, { recursive: true, force: true });
        }
    });

    it("rejects a manifest checksum that differs from the canonical file", () => {
        const rootDirectory = makeDirectory();
        try {
            writeTestLicense(rootDirectory, "canonical");
            writeTestRegistry(rootDirectory, "0".repeat(64));
            const registry = LicenseRegistry.loadFromRoot(rootDirectory);
            assert.ok(registry);
            assert.ok(
                issueCodes(registry.validate()).includes(
                    "license.registry.mismatch"
                )
            );
        } finally {
            rmSync(rootDirectory, { recursive: true, force: true });
        }
    });
});
