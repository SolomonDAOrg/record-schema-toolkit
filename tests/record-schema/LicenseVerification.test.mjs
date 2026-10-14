// @ts-check

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { verifyLicenseRepository } from "../../lib/record-schema/LicenseVerification.mjs";
import {
    writeTestLicense,
    writeTestRegistry,
    writeTestUpstream
} from "../license-test-support.mjs";

function makeDirectory(prefix) {
    return mkdtempSync(join(tmpdir(), prefix));
}

/** @param {ReturnType<typeof verifyLicenseRepository>["issues"]} issues */
function issueCodes(issues) {
    return issues.map((issue) => issue.code);
}

describe("verifyLicenseRepository", () => {
    it("verifies a repository copy against the canonical registry", () => {
        const copyRoot = makeDirectory("license-copy-");
        const canonicalRoot = makeDirectory("license-canonical-");
        try {
            const canonical = writeTestLicense(canonicalRoot, "canonical");
            writeTestRegistry(canonicalRoot, canonical.checksum);
            const copy = writeTestLicense(copyRoot, "repository-copy");
            writeTestUpstream(copyRoot, copy.checksum);
            const result = verifyLicenseRepository(copyRoot, {
                canonicalRoot
            });
            assert.deepEqual(result.issues, []);
            assert.equal(result.stats.errors, 0);
        } finally {
            rmSync(copyRoot, { recursive: true, force: true });
            rmSync(canonicalRoot, { recursive: true, force: true });
        }
    });

    it("allows a repository-specific preamble while requiring the same legal body", () => {
        const copyRoot = makeDirectory("license-copy-");
        const canonicalRoot = makeDirectory("license-canonical-");
        try {
            const canonical = writeTestLicense(canonicalRoot, "canonical");
            writeTestRegistry(canonicalRoot, canonical.checksum);
            const copy = writeTestLicense(copyRoot, "repository-copy", {
                preamble: "COPY NOTICE (NON-AUTHORITATIVE)\n\nRepository-specific text.\n\n"
            });
            writeTestUpstream(copyRoot, copy.checksum);
            const result = verifyLicenseRepository(copyRoot, {
                canonicalRoot
            });
            assert.deepEqual(result.issues, []);
        } finally {
            rmSync(copyRoot, { recursive: true, force: true });
            rmSync(canonicalRoot, { recursive: true, force: true });
        }
    });

    it("rejects legal-body deletion or mutation against the canonical document", () => {
        const copyRoot = makeDirectory("license-copy-");
        const canonicalRoot = makeDirectory("license-canonical-");
        try {
            const canonical = writeTestLicense(canonicalRoot, "canonical");
            writeTestRegistry(canonicalRoot, canonical.checksum);
            const copy = writeTestLicense(copyRoot, "repository-copy");
            writeTestUpstream(copyRoot, copy.checksum);
            const originalText = readFileSync(copy.path, "utf8");
            const changedText = originalText.replace(
                "- retained/path/**",
                "- removed/path/**"
            );
            writeFileSync(copy.path, changedText, "utf8");
            const result = verifyLicenseRepository(copyRoot, {
                canonicalRoot
            });
            const codes = issueCodes(result.issues);
            assert.ok(codes.includes("license.checksum.mismatch"));
            assert.ok(codes.includes("license.canonical.mismatch"));
        } finally {
            rmSync(copyRoot, { recursive: true, force: true });
            rmSync(canonicalRoot, { recursive: true, force: true });
        }
    });

    it("rejects a SCHEMA_UPSTREAM checksum that differs from LICENSE", () => {
        const copyRoot = makeDirectory("license-copy-");
        try {
            const copy = writeTestLicense(copyRoot, "repository-copy");
            writeTestUpstream(copyRoot, copy.checksum, {
                checksumOverride: "0".repeat(64)
            });
            const result = verifyLicenseRepository(copyRoot);
            assert.ok(
                issueCodes(result.issues).includes(
                    "upstream.license.mismatch"
                )
            );
        } finally {
            rmSync(copyRoot, { recursive: true, force: true });
        }
    });

    it("exposes a working JSON CLI", () => {
        const copyRoot = makeDirectory("license-copy-");
        const canonicalRoot = makeDirectory("license-canonical-");
        try {
            const canonical = writeTestLicense(canonicalRoot, "canonical");
            writeTestRegistry(canonicalRoot, canonical.checksum);
            const copy = writeTestLicense(copyRoot, "repository-copy");
            writeTestUpstream(copyRoot, copy.checksum);
            const cliPath = resolve(
                new URL("../../bin/verify-license.mjs", import.meta.url)
                    .pathname
            );
            const output = execFileSync(
                process.execPath,
                [
                    cliPath,
                    "--root",
                    copyRoot,
                    "--canonical-root",
                    canonicalRoot,
                    "--json"
                ],
                { encoding: "utf8" }
            );
            const parsed = JSON.parse(output);
            assert.equal(parsed.stats.errors, 0);
            assert.equal(parsed.issues.length, 0);

            const badArguments = spawnSync(
                process.execPath,
                [cliPath, "--not-an-option"],
                { encoding: "utf8" }
            );
            assert.equal(badArguments.status, 2);
        } finally {
            rmSync(copyRoot, { recursive: true, force: true });
            rmSync(canonicalRoot, { recursive: true, force: true });
        }
    });
});
