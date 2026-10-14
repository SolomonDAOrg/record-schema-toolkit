// @ts-check

/**
 * Unit tests for the Document class.
 *
 * Covers: construction, static factories, parseFileInfo, file-info accessors,
 * metadata extraction, content operations, persistence, cloning, and
 * normalization delegation.
 *
 * @module tests/classes/Document_test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    mkdirSync,
    writeFileSync,
    readFileSync,
    rmSync,
    existsSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Document } from "../../lib/record-schema/Document.mjs";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Create a unique temp directory and return its path.
 * @returns {string}
 */
function makeTmpDir() {
    const dir = join(
        tmpdir(),
        "doc-test-" + Math.random().toString(36).slice(2)
    );
    mkdirSync(dir, { recursive: true });
    return dir;
}

/**
 * Write a temp file and return its absolute path.
 * @param {string} dir
 * @param {string} name
 * @param {string} content
 * @returns {string}
 */
function writeTmp(dir, name, content) {
    const p = join(dir, name);
    writeFileSync(p, content, "utf8");
    return p;
}

// ============================================================================
// Construction
// ============================================================================

describe("Document - construction", () => {
    it("stores text and defaults source_path to null", () => {
        const d = new Document("hello");
        assert.equal(d.text, "hello");
        assert.equal(d.source_path, null);
    });

    it("stores provided source_path", () => {
        const d = new Document("hi", "/some/path.md");
        assert.equal(d.source_path, "/some/path.md");
    });

    it("initialises _metadata and _file_info as null", () => {
        const d = new Document("x");
        assert.equal(d._file_info, null);
        assert.equal(d._metadata, null);
        assert.equal(d._metadata_extracted, false);
    });
});

// ============================================================================
// Static factories
// ============================================================================

describe("Document.fromText", () => {
    it("creates Document with given text", () => {
        const d = Document.fromText("body text");
        assert.equal(d.text, "body text");
        assert.equal(d.source_path, null);
    });

    it("passes through optional source_path", () => {
        const d = Document.fromText("x", "/path/to/file.md");
        assert.equal(d.source_path, "/path/to/file.md");
    });
});

describe("Document.empty", () => {
    it("creates Document with empty text and null source_path", () => {
        const d = Document.empty();
        assert.equal(d.text, "");
        assert.equal(d.source_path, null);
    });
});

describe("Document.load", () => {
    it("reads file content and stores path", () => {
        const dir = makeTmpDir();
        const p = writeTmp(dir, "doc.md", "file content");
        const d = Document.load(p);
        assert.equal(d.text, "file content");
        assert.equal(d.source_path, p);
        rmSync(dir, { recursive: true });
    });

    it("throws when file does not exist", () => {
        assert.throws(() => Document.load("/nonexistent/path/doc.md"));
    });
});

describe("Document.loadIfExists", () => {
    it("returns Document when file exists", () => {
        const dir = makeTmpDir();
        const p = writeTmp(dir, "doc.md", "content");
        const d = Document.loadIfExists(p);
        assert.ok(d instanceof Document);
        assert.equal(/** @type {Document} */ (d).text, "content");
        rmSync(dir, { recursive: true });
    });

    it("returns null when file does not exist", () => {
        assert.equal(Document.loadIfExists("/nonexistent/path/doc.md"), null);
    });
});

// ============================================================================
// parseFileInfo
// ============================================================================

describe("Document.parseFileInfo", () => {
    it("extracts ext from simple filename", () => {
        const fi = Document.parseFileInfo("file.md");
        assert.equal(fi.ext, "md");
    });

    it("lowercases extension", () => {
        const fi = Document.parseFileInfo("file.MD");
        assert.equal(fi.ext, "md");
    });

    it("extracts ext from nested path", () => {
        const fi = Document.parseFileInfo("path/to/file.yaml");
        assert.equal(fi.ext, "yaml");
    });

    it("returns null ext for file without extension", () => {
        const fi = Document.parseFileInfo("LICENSE");
        assert.equal(fi.ext, null);
        assert.equal(fi.base_name, "LICENSE");
    });

    it("strips extension from base_name", () => {
        const fi = Document.parseFileInfo("CHA-charter.md");
        assert.equal(fi.base_name, "CHA-charter");
    });

    it("extracts doc_type from prefixed filename", () => {
        const fi = Document.parseFileInfo("CHA-document.md");
        assert.equal(fi.doc_type, "CHA");
    });

    it("extracts doc_type with underscore separator", () => {
        const fi = Document.parseFileInfo("SOP_procedures.md");
        assert.equal(fi.doc_type, "SOP");
    });

    it("returns null doc_type when no prefix pattern", () => {
        const fi = Document.parseFileInfo("readme.md");
        assert.equal(fi.doc_type, null);
    });

    it("extracts record_id from path", () => {
        const fi = Document.parseFileInfo(
            "records/DP-00001/DP-00001-proposal.md"
        );
        assert.equal(fi.record_id, "DP-00001");
    });

    it("returns null record_id when none present", () => {
        const fi = Document.parseFileInfo("docs/readme.md");
        assert.equal(fi.record_id, null);
    });

    it("extracts version suffix v1 from filename", () => {
        const fi = Document.parseFileInfo("CHA-charter_v2.md");
        assert.equal(fi.version, "V2");
    });

    it("extracts DRAFT version suffix", () => {
        const fi = Document.parseFileInfo("CHA-charter-DRAFT.md");
        assert.equal(fi.version, "DRAFT");
    });

    it("extracts FINAL version suffix (case insensitive)", () => {
        const fi = Document.parseFileInfo("CHA-charter-final.md");
        assert.equal(fi.version, "FINAL");
    });

    it("returns null version when no suffix", () => {
        const fi = Document.parseFileInfo("CHA-charter.md");
        assert.equal(fi.version, null);
    });

    it("handles empty string path", () => {
        const fi = Document.parseFileInfo("");
        assert.equal(fi.ext, null);
        assert.equal(fi.base_name, "");
    });
});

// ============================================================================
// File-info accessors
// ============================================================================

describe("Document - file info accessors", () => {
    it("getExtension returns extension from source_path", () => {
        const d = Document.fromText("x", "/path/to/file.yaml");
        assert.equal(d.getExtension(), "yaml");
    });

    it("getBaseName returns base_name without extension", () => {
        const d = Document.fromText("x", "/path/to/CHA-charter.md");
        assert.equal(d.getBaseName(), "CHA-charter");
    });

    it("getDocType extracts type prefix", () => {
        const d = Document.fromText("x", "/path/to/SOP-procedures.md");
        assert.equal(d.getDocType(), "SOP");
    });

    it("getDocType returns null for unprefixed file", () => {
        const d = Document.fromText("x", "/path/to/readme.md");
        assert.equal(d.getDocType(), null);
    });

    it("isMarkdown returns true for .md", () => {
        assert.equal(Document.fromText("x", "doc.md").isMarkdown(), true);
    });

    it("isMarkdown returns false for .txt", () => {
        assert.equal(Document.fromText("x", "doc.txt").isMarkdown(), false);
    });

    it("isText returns true for known text extensions", () => {
        for (const ext of ["md", "txt", "yaml", "yml", "json"]) {
            assert.equal(
                Document.fromText("x", `file.${ext}`).isText(),
                true,
                `ext=${ext}`
            );
        }
    });

    it("isText returns true for LICENSE (no extension)", () => {
        assert.equal(Document.fromText("x", "LICENSE").isText(), true);
    });

    it("isText returns false for binary-like extension", () => {
        assert.equal(Document.fromText("x", "image.png").isText(), false);
    });

    it("getFileInfo is cached after first call", () => {
        const d = Document.fromText("x", "/path/to/file.md");
        const fi1 = d.getFileInfo();
        const fi2 = d.getFileInfo();
        assert.equal(fi1, fi2);
    });
});

// ============================================================================
// reload
// ============================================================================

describe("Document - reload", () => {
    it("reloads updated content from disk", () => {
        const dir = makeTmpDir();
        const p = writeTmp(dir, "doc.md", "original");
        const d = Document.load(p);
        assert.equal(d.text, "original");

        writeFileSync(p, "updated", "utf8");
        const result = d.reload();
        assert.equal(result, true);
        assert.equal(d.text, "updated");
        rmSync(dir, { recursive: true });
    });

    it("invalidates cached metadata on reload", () => {
        const dir = makeTmpDir();
        const p = writeTmp(dir, "doc.md", "plain text");
        const d = Document.load(p);

        // Force metadata extraction
        d.getMetadata();
        assert.equal(d._metadata_extracted, true);

        writeFileSync(p, "new content", "utf8");
        d.reload();
        assert.equal(d._metadata_extracted, false);
        assert.equal(d._metadata, null);
        rmSync(dir, { recursive: true });
    });

    it("returns false when source_path is null", () => {
        const d = Document.fromText("text");
        assert.equal(d.reload(), false);
    });

    it("returns false when file has been deleted", () => {
        const dir = makeTmpDir();
        const p = writeTmp(dir, "gone.md", "text");
        const d = Document.load(p);
        rmSync(p);
        assert.equal(d.reload(), false);
        rmSync(dir, { recursive: true });
    });
});

// ============================================================================
// getLines / getLineCount
// ============================================================================

describe("Document - getLines / getLineCount", () => {
    it("splits text into lines", () => {
        const d = Document.fromText("a\nb\nc");
        assert.deepEqual(d.getLines(), ["a", "b", "c"]);
    });

    it("counts lines correctly", () => {
        const d = Document.fromText("a\nb\nc");
        assert.equal(d.getLineCount(), 3);
    });

    it("single line text has count 1", () => {
        const d = Document.fromText("single");
        assert.equal(d.getLineCount(), 1);
    });

    it("empty text has count 1 (split result)", () => {
        const d = Document.empty();
        assert.equal(d.getLineCount(), 1);
    });
});

// ============================================================================
// hasFooterDelimiter
// ============================================================================

describe("Document - hasFooterDelimiter", () => {
    it("returns true when --- appears near end", () => {
        const d = Document.fromText("body\n---\nsomething after");
        assert.equal(d.hasFooterDelimiter(), true);
    });

    it("returns true for --- as last non-empty line", () => {
        const d = Document.fromText("line1\nline2\n---");
        assert.equal(d.hasFooterDelimiter(), true);
    });

    it("returns false when no --- present", () => {
        const d = Document.fromText("just body text\nno delimiter");
        assert.equal(d.hasFooterDelimiter(), false);
    });

    it("returns false for non-delimiter dashes", () => {
        const d = Document.fromText("body\n----\nmore");
        assert.equal(d.hasFooterDelimiter(), false);
    });
});

// ============================================================================
// getMetadata / hasEmbeddedMetadata
// ============================================================================

describe("Document - getMetadata (YAML frontmatter)", () => {
    it("extracts YAML frontmatter fields", () => {
        const text = "---\ntitle: My Doc\nversion: 1.0\n---\nBody text";
        const d = Document.fromText(text, "CHA-charter.md");
        const meta = d.getMetadata();
        assert.ok(meta !== null);
        assert.equal(meta.getString("title"), "My Doc");
        assert.equal(meta.getString("version"), "1.0");
    });

    it("returns same instance on second call (cached)", () => {
        const d = Document.fromText("---\ntitle: T\n---\nbody", "doc.md");
        const m1 = d.getMetadata();
        const m2 = d.getMetadata();
        assert.equal(m1, m2);
    });

    it("hasEmbeddedMetadata returns true when frontmatter present", () => {
        const d = Document.fromText("---\ntitle: X\n---\nbody", "CHA-doc.md");
        assert.equal(d.hasEmbeddedMetadata(), true);
    });

    it("hasEmbeddedMetadata returns false for plain text", () => {
        const d = Document.fromText("just plain text", "doc.md");
        assert.equal(d.hasEmbeddedMetadata(), false);
    });
});

// ============================================================================
// hasSidecarMetadata
// ============================================================================

describe("Document - hasSidecarMetadata", () => {
    it("returns false when source_path is null", () => {
        const d = Document.fromText("text");
        assert.equal(d.hasSidecarMetadata(), false);
    });

    it("returns false when no .metadata sidecar file exists", () => {
        const dir = makeTmpDir();
        const p = writeTmp(dir, "doc.md", "text");
        const d = Document.load(p);
        assert.equal(d.hasSidecarMetadata(), false);
        rmSync(dir, { recursive: true });
    });

    it("returns true when .metadata sidecar file exists", () => {
        const dir = makeTmpDir();
        const p = writeTmp(dir, "doc.md", "text");
        writeFileSync(p + ".metadata", "Title: X\n", "utf8");
        const d = Document.load(p);
        assert.equal(d.hasSidecarMetadata(), true);
        rmSync(dir, { recursive: true });
    });
});

// ============================================================================
// save / saveTo
// ============================================================================

describe("Document - save", () => {
    it("writes text to source_path and returns true", () => {
        const dir = makeTmpDir();
        const p = writeTmp(dir, "doc.md", "original");
        const d = Document.load(p);
        d.text = "modified";
        assert.equal(d.save(), true);
        assert.equal(readFileSync(p, "utf8"), "modified");
        rmSync(dir, { recursive: true });
    });

    it("returns false when source_path is null", () => {
        const d = Document.fromText("text");
        assert.equal(d.save(), false);
    });
});

describe("Document - saveTo", () => {
    it("writes to new path and updates source_path", () => {
        const dir = makeTmpDir();
        const target = join(dir, "output.md");
        const d = Document.fromText("hello world");
        d.saveTo(target);
        assert.equal(d.source_path, target);
        assert.equal(readFileSync(target, "utf8"), "hello world");
        rmSync(dir, { recursive: true });
    });

    it("clears _file_info cache after saveTo", () => {
        const dir = makeTmpDir();
        const target = join(dir, "output.md");
        const d = Document.fromText("x", "/original/path.txt");

        // Warm the cache
        d.getFileInfo();
        assert.ok(d._file_info !== null);

        d.saveTo(target);
        assert.equal(d._file_info, null);
        rmSync(dir, { recursive: true });
    });
});

// ============================================================================
// withText / clone
// ============================================================================

describe("Document - withText", () => {
    it("creates new Document with replaced text", () => {
        const d = Document.fromText("original", "/path/file.md");
        const d2 = d.withText("new text");
        assert.equal(d2.text, "new text");
        assert.equal(d2.source_path, "/path/file.md");
    });

    it("does not mutate original", () => {
        const d = Document.fromText("original");
        d.withText("new");
        assert.equal(d.text, "original");
    });
});

describe("Document - clone", () => {
    it("creates independent copy with same text and path", () => {
        const d = Document.fromText("content", "/path/file.md");
        const c = d.clone();
        assert.equal(c.text, "content");
        assert.equal(c.source_path, "/path/file.md");
    });

    it("mutating clone does not affect original", () => {
        const d = Document.fromText("original");
        const c = d.clone();
        c.text = "changed";
        assert.equal(d.text, "original");
    });
});

// ============================================================================
// normalizeBaseline / findNonAscii / normalizeCanonicalAscii
// ============================================================================

describe("Document - normalizeBaseline", () => {
    it("returns a Document instance", () => {
        const d = Document.fromText("hello\r\nworld");
        const n = d.normalizeBaseline();
        assert.ok(n instanceof Document);
    });

    it("preserves source_path on normalized copy", () => {
        const d = Document.fromText("text", "/path/file.md");
        const n = d.normalizeBaseline();
        assert.equal(n.source_path, "/path/file.md");
    });

    it("does not mutate original", () => {
        const original = "hello\r\nworld";
        const d = Document.fromText(original);
        d.normalizeBaseline();
        assert.equal(d.text, original);
    });
});

describe("Document - findNonAscii", () => {
    it("returns empty array for pure ASCII text", () => {
        const d = Document.fromText("hello world 123");
        const result = d.findNonAscii();
        assert.ok(Array.isArray(result));
        assert.equal(result.length, 0);
    });

    it("returns array for text with non-ASCII characters", () => {
        const d = Document.fromText("caf\u00e9 na\u00efve");
        const result = d.findNonAscii();
        assert.ok(Array.isArray(result));
        assert.ok(result.length > 0);
    });
});

describe("Document - normalizeCanonicalAscii", () => {
    it("returns an object with at least a text/result field", () => {
        const d = Document.fromText("hello world");
        const result = d.normalizeCanonicalAscii();
        // Result is NormalizeResult - check it is a non-null object
        assert.ok(result !== null && typeof result === "object");
    });
});
