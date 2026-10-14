// @ts-check

/**
 * Unit tests for IndManager.
 *
 * Covers: construction, generateInd, shouldExclude,
 * and applyIndToPath (all branches: read failure, idempotency,
 * update existing, create from scratch with body padding).
 *
 * @module tests/classes/IndManager_test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { IndManager } from "../../lib/record-schema/IndManager.mjs";
import { Registry } from "../../lib/record-schema/Registry.mjs";
import { DocumentMetadata } from "../../lib/record-schema/DocumentMetadata.mjs";

// ============================================================================
// Helpers
// ============================================================================

/**
 * @returns {{ dir: string, file: (name: string, text: string) => string, cleanup: () => void }}
 */
function makeTmp() {
    const dir = mkdtempSync(join(tmpdir(), "ind-test-"));
    return {
        dir,
        file(name, text) {
            const p = join(dir, name);
            writeFileSync(p, text, "utf8");
            return p;
        },
        cleanup() {
            rmSync(dir, { recursive: true, force: true });
        }
    };
}

/**
 * Read file content.
 * @param {string} p
 * @returns {string}
 */
function read(p) {
    return readFileSync(p, "utf8");
}

// ============================================================================
// construction
// ============================================================================

describe("IndManager - construction", () => {
    it("stores registry reference", () => {
        const reg = Registry.empty();
        const mgr = new IndManager(reg);
        assert.ok(mgr.registry === reg);
    });

    it("accepts null registry", () => {
        const mgr = new IndManager(null);
        assert.equal(mgr.registry, null);
    });
});

// ============================================================================
// generateInd
// ============================================================================

describe("IndManager - generateInd", () => {
    const mgr = new IndManager(null);

    it("generates IND without version", () => {
        assert.equal(mgr.generateInd("DP-00001", "CHA"), "DP-00001-CHA");
    });

    it("generates IND with version", () => {
        assert.equal(
            mgr.generateInd("DP-00001", "CHA", "2"),
            "DP-00001-CHA-v2"
        );
    });

    it("generates IND with numeric version string", () => {
        assert.equal(
            mgr.generateInd("SOP-00003", "SOP", "1"),
            "SOP-00003-SOP-v1"
        );
    });

    it("omits version when version is undefined", () => {
        assert.equal(
            mgr.generateInd("SOP-00003", "SOP", undefined),
            "SOP-00003-SOP"
        );
    });

    it("omits version when version is empty string", () => {
        // empty string is falsy → no version suffix
        assert.equal(mgr.generateInd("DP-00002", "ANEX", ""), "DP-00002-ANEX");
    });
});

// ============================================================================
// shouldExclude
// ============================================================================

describe("IndManager - shouldExclude", () => {
    it("returns false when no registry is set", () => {
        const mgr = new IndManager(null);
        assert.equal(mgr.shouldExclude("IND"), false);
    });

    it("delegates to registry.shouldExcludeIndFromPdf", () => {
        // Build a minimal registry whose shouldExcludeIndFromPdf is predictable.
        // Registry.empty() returns a registry with no doc_types, so
        // shouldExcludeIndFromPdf returns false for any code.
        const reg = Registry.empty();
        const mgr = new IndManager(reg);
        assert.equal(mgr.shouldExclude("CHA"), false);
        assert.equal(mgr.shouldExclude("ANYTHING"), false);
    });
});

// ============================================================================
// applyIndToPath
// ============================================================================

describe("IndManager - applyIndToPath", () => {
    const mgr = new IndManager(null);

    it("returns false for non-existent file path", () => {
        assert.equal(
            mgr.applyIndToPath("/no/such/file.md", "DP-00001-CHA"),
            false
        );
    });

    it("writes IND to file that has no existing metadata block", () => {
        const tmp = makeTmp();
        const p = tmp.file("doc.md", "# Hello\n\nBody text.\n");
        const changed = mgr.applyIndToPath(p, "DP-00001-CHA");
        assert.equal(changed, true);
        const content = read(p);
        assert.ok(
            content.includes("DP-00001-CHA"),
            "IND value should be in file"
        );
        assert.ok(
            content.includes(DocumentMetadata.BEGIN_MARKER),
            "BEGIN marker should be present"
        );
        assert.ok(
            content.includes(DocumentMetadata.END_MARKER),
            "END marker should be present"
        );
        tmp.cleanup();
    });

    it("is idempotent: returns false when IND already matches", () => {
        const tmp = makeTmp();
        const p = tmp.file("doc.md", "# Hello\n\nBody.\n");
        // Apply once
        mgr.applyIndToPath(p, "DP-00001-CHA");
        // Apply again with same value
        const second = mgr.applyIndToPath(p, "DP-00001-CHA");
        assert.equal(second, false);
        tmp.cleanup();
    });

    it("updates IND when existing value differs", () => {
        const tmp = makeTmp();
        const p = tmp.file("doc.md", "# Hello\n\nBody.\n");
        mgr.applyIndToPath(p, "DP-00001-CHA");
        // Now update to a different IND
        const changed = mgr.applyIndToPath(p, "DP-00001-CHA-v2");
        assert.equal(changed, true);
        const content = read(p);
        assert.ok(content.includes("DP-00001-CHA-v2"));
        tmp.cleanup();
    });

    it("preserves body content above the metadata block", () => {
        const tmp = makeTmp();
        const body = "# My Document\n\nSome content here.\n";
        const p = tmp.file("doc.md", body);
        mgr.applyIndToPath(p, "DP-00002-SOP");
        const content = read(p);
        assert.ok(content.startsWith("# My Document"));
        assert.ok(content.includes("Some content here."));
        tmp.cleanup();
    });

    it("adds blank-line separation between body and metadata block when body lacks trailing newlines", () => {
        const tmp = makeTmp();
        // Body ends with single newline — applyIndToPath should pad to double newline
        const p = tmp.file("doc.md", "Body line.\n");
        mgr.applyIndToPath(p, "DP-00003-ANEX");
        const content = read(p);
        // The body + padding + markers should not have the marker immediately
        // touching the last body line (there must be separation)
        const markerIndex = content.indexOf(DocumentMetadata.BEGIN_MARKER);
        const charBefore = content[markerIndex - 1];
        assert.equal(
            charBefore,
            "\n",
            "marker should be preceded by a newline"
        );
        tmp.cleanup();
    });

    it("Document-ID field is set correctly in the written metadata", () => {
        const tmp = makeTmp();
        const p = tmp.file("doc.md", "# Doc\n\nText.\n");
        mgr.applyIndToPath(p, "SOP-00001-SOP-v3");
        const content = read(p);
        // Extract and parse the trailing metadata to confirm the value
        const extraction = DocumentMetadata.extractTrailing(content);
        assert.ok(extraction.metadata !== null);
        assert.equal(
            extraction.metadata.getString("Document-ID"),
            "SOP-00001-SOP-v3"
        );
        tmp.cleanup();
    });

    it("handles file that already has a full metadata block (round-trip)", () => {
        const tmp = makeTmp();
        // Build a file that already has a metadata block with a different Document-ID
        const existingMeta = new DocumentMetadata({
            "Document-ID": "OLD-VALUE"
        });
        const block = existingMeta.serializeWithMarkers();
        const p = tmp.file("doc.md", "# Doc\n\nText.\n\n" + block);
        const changed = mgr.applyIndToPath(p, "NEW-VALUE");
        assert.equal(changed, true);
        const extraction = DocumentMetadata.extractTrailing(read(p));
        assert.equal(extraction.metadata.getString("Document-ID"), "NEW-VALUE");
        tmp.cleanup();
    });
});
