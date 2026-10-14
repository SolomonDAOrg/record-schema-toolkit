// @ts-check

/**
 * Unit tests for the DocumentMetadata class.
 *
 * Covers: construction, static factories, parse / parseSidecar,
 * extractTrailing, extractFromMarkdown, extractEnvelope,
 * accessors (get/getString/getArray/has/keys/isEmpty),
 * named-field helpers, toIndOptions, validate/isValid,
 * serialize / serializeWithMarkers, saveSidecar, and
 * _parseKeyValueLines (multi-value keys).
 *
 * @module tests/classes/DocumentMetadata_test
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

import { DocumentMetadata } from "../../lib/record-schema/DocumentMetadata.mjs";
import { Schema } from "../../lib/record-schema/Schema.mjs";

// ============================================================================
// Helpers
// ============================================================================

/**
 * @returns {string}
 */
function makeTmpDir() {
    const dir = join(
        tmpdir(),
        "docmeta-test-" + Math.random().toString(36).slice(2)
    );
    mkdirSync(dir, { recursive: true });
    return dir;
}

/**
 * Build a PEM-style metadata block using the class's own markers.
 * @param {string} inner
 * @returns {string}
 */
function makeBlock(inner) {
    return `${DocumentMetadata.BEGIN_MARKER}\n${inner}\n${DocumentMetadata.END_MARKER}`;
}

// ============================================================================
// Construction
// ============================================================================

describe("DocumentMetadata - construction", () => {
    it("stores data and defaults sourcePath to null", () => {
        const m = new DocumentMetadata({ Title: "Hello" });
        assert.deepEqual(m.data, { Title: "Hello" });
        assert.equal(m.sourcePath, null);
    });

    it("stores provided sourcePath", () => {
        const m = new DocumentMetadata({}, "/some/path.metadata");
        assert.equal(m.sourcePath, "/some/path.metadata");
    });
});

// ============================================================================
// empty
// ============================================================================

describe("DocumentMetadata.empty", () => {
    it("returns instance with empty data", () => {
        const m = DocumentMetadata.empty();
        assert.ok(m instanceof DocumentMetadata);
        assert.deepEqual(m.data, {});
        assert.equal(m.sourcePath, null);
    });
});

// ============================================================================
// parse (KEY: VALUE block)
// ============================================================================

describe("DocumentMetadata.parse", () => {
    it("parses simple KEY: VALUE pairs", () => {
        const m = DocumentMetadata.parse("Title: My Doc\nVersion: 1.0");
        assert.equal(m.getString("Title"), "My Doc");
        assert.equal(m.getString("Version"), "1.0");
    });

    it("trims whitespace around keys and values", () => {
        const m = DocumentMetadata.parse("  Key : value with spaces  ");
        assert.equal(m.getString("Key"), "value with spaces");
    });

    it("ignores blank lines", () => {
        const m = DocumentMetadata.parse("A: 1\n\nB: 2\n\n");
        assert.equal(m.getString("A"), "1");
        assert.equal(m.getString("B"), "2");
    });

    it("ignores lines without colon or with colon at position 0", () => {
        const m = DocumentMetadata.parse(":nope\njust a line\nGood: yes");
        assert.equal(m.has(":nope"), false);
        assert.equal(m.getString("Good"), "yes");
    });

    it("collapses duplicate keys into array", () => {
        const m = DocumentMetadata.parse("Tag: alpha\nTag: beta\nTag: gamma");
        assert.deepEqual(m.getArray("Tag"), ["alpha", "beta", "gamma"]);
    });

    it("stores source_path", () => {
        const m = DocumentMetadata.parse("A: 1", "/path/file.metadata");
        assert.equal(m.sourcePath, "/path/file.metadata");
    });
});

// ============================================================================
// parseSidecar
// ============================================================================

describe("DocumentMetadata.parseSidecar", () => {
    it("parses plain KEY: VALUE text without markers", () => {
        const m = DocumentMetadata.parseSidecar("Title: Doc\nVersion: 2");
        assert.equal(m.getString("Title"), "Doc");
    });

    it("extracts inner block when markers are present", () => {
        const text = makeBlock("Title: Wrapped\nVersion: 3");
        const m = DocumentMetadata.parseSidecar(text);
        assert.equal(m.getString("Title"), "Wrapped");
        assert.equal(m.getString("Version"), "3");
    });

    it("falls back to full text when only begin marker present", () => {
        const text = `${DocumentMetadata.BEGIN_MARKER}\nTitle: X`;
        const m = DocumentMetadata.parseSidecar(text);
        // No end marker → full text parsed; BEGIN_MARKER line is not a KV pair
        assert.ok(m instanceof DocumentMetadata);
    });
});

// ============================================================================
// extractTrailing
// ============================================================================

describe("DocumentMetadata.extractTrailing", () => {
    it("returns null metadata when no markers present", () => {
        const result = DocumentMetadata.extractTrailing("body text only");
        assert.equal(result.metadata, null);
        assert.equal(result.raw_block, null);
        assert.ok(result.body.includes("body text only"));
    });

    it("extracts metadata block from end of document", () => {
        const body = "Document body.\n";
        const block = makeBlock("Record-ID: DP-00001\nVersion: 1");
        const text = body + "\n" + block;
        const result = DocumentMetadata.extractTrailing(text);
        assert.ok(result.metadata !== null);
        assert.equal(result.metadata.getString("Record-ID"), "DP-00001");
        assert.ok(result.body.includes("Document body"));
        assert.ok(!result.body.includes("Record-ID"));
    });

    it("uses last occurrence of begin marker", () => {
        const block1 = makeBlock("X: first");
        const block2 = makeBlock("X: last");
        const text = block1 + "\n" + block2;
        const result = DocumentMetadata.extractTrailing(text);
        assert.ok(result.metadata !== null);
        assert.equal(result.metadata.getString("X"), "last");
    });

    it("raw_block contains the full marker block", () => {
        const block = makeBlock("A: 1");
        const result = DocumentMetadata.extractTrailing("body\n" + block);
        assert.ok(result.raw_block !== null);
        assert.ok(
            /** @type {string} */ (result.raw_block).includes(
                DocumentMetadata.BEGIN_MARKER
            )
        );
        assert.ok(
            /** @type {string} */ (result.raw_block).includes(
                DocumentMetadata.END_MARKER
            )
        );
    });

    it("returns null when begin marker present but no end marker", () => {
        const text = `body\n${DocumentMetadata.BEGIN_MARKER}\nA: 1`;
        const result = DocumentMetadata.extractTrailing(text);
        assert.equal(result.metadata, null);
    });
});

// ============================================================================
// extractFromMarkdown
// ============================================================================

describe("DocumentMetadata.extractFromMarkdown", () => {
    it("parses YAML frontmatter", () => {
        const md = "---\ntitle: My Title\nversion: 1.2\n---\n\nBody here.";
        const m = DocumentMetadata.extractFromMarkdown(md);
        assert.equal(m.getString("title"), "My Title");
        assert.equal(m.getString("version"), "1.2");
    });

    it("strips surrounding quotes from frontmatter values", () => {
        const md = `---\ntitle: "Quoted Title"\nauthor: 'Single'\n---\nBody`;
        const m = DocumentMetadata.extractFromMarkdown(md);
        assert.equal(m.getString("title"), "Quoted Title");
        assert.equal(m.getString("author"), "Single");
    });

    it("ignores frontmatter lines without colon", () => {
        const md = "---\ntitle: Good\nnot-a-kv-line\n---\nBody";
        const m = DocumentMetadata.extractFromMarkdown(md);
        assert.equal(m.getString("title"), "Good");
    });

    it("returns empty metadata when no frontmatter or block", () => {
        const m = DocumentMetadata.extractFromMarkdown(
            "plain text\nno metadata"
        );
        assert.ok(m.isEmpty());
    });

    it("falls back to inline metadata block when no frontmatter", () => {
        const block = makeBlock("Record-ID: DP-00001");
        const md = "Body text.\n\n" + block;
        const m = DocumentMetadata.extractFromMarkdown(md);
        assert.equal(m.getString("Record-ID"), "DP-00001");
    });

    it("returns empty when only begin marker and no end marker", () => {
        const md = `body\n${DocumentMetadata.BEGIN_MARKER}\nA: 1`;
        const m = DocumentMetadata.extractFromMarkdown(md);
        assert.ok(m.isEmpty());
    });
});

// ============================================================================
// extractEnvelope
// ============================================================================

describe("DocumentMetadata.extractEnvelope", () => {
    it("extracts header, body, footer from full document", () => {
        const md = [
            "# Title",
            "Author: Jo",
            "---",
            "",
            "Body paragraph.",
            "",
            "---",
            "Footer content."
        ].join("\n");
        const env = DocumentMetadata.extractEnvelope(md);
        assert.ok(env.header.includes("# Title"));
        assert.ok(env.body.includes("Body paragraph."));
        assert.ok(
            env.footer !== null && env.footer.includes("Footer content.")
        );
    });

    it("returns null footer when no second delimiter", () => {
        const md = "# Header\n---\nBody only.";
        const env = DocumentMetadata.extractEnvelope(md);
        assert.equal(env.footer, null);
        assert.ok(env.body.includes("Body only."));
    });

    it("handles document with no delimiters", () => {
        const md = "Just body text.";
        const env = DocumentMetadata.extractEnvelope(md);
        assert.ok(env.body.includes("Just body text."));
        assert.equal(env.footer, null);
    });

    it("excludes metadata block from body", () => {
        const block = makeBlock("Record-ID: DP-00001");
        const md = "# Header\n---\nBody.\n\n" + block;
        const env = DocumentMetadata.extractEnvelope(md);
        assert.ok(!env.body.includes("Record-ID"));
    });
});

// ============================================================================
// Basic accessors
// ============================================================================

describe("DocumentMetadata - basic accessors", () => {
    it("get returns raw value", () => {
        const m = new DocumentMetadata({ A: "x" });
        assert.equal(m.get("A"), "x");
        assert.equal(m.get("missing"), undefined);
    });

    it("getString returns string value directly", () => {
        const m = new DocumentMetadata({ K: "v" });
        assert.equal(m.getString("K"), "v");
    });

    it("getString returns first element of array value", () => {
        const m = new DocumentMetadata({ K: ["first", "second"] });
        assert.equal(m.getString("K"), "first");
    });

    it("getString returns undefined for missing key", () => {
        const m = new DocumentMetadata({});
        assert.equal(m.getString("nope"), undefined);
    });

    it("getArray returns single-item array for string value", () => {
        const m = new DocumentMetadata({ K: "single" });
        assert.deepEqual(m.getArray("K"), ["single"]);
    });

    it("getArray returns array value directly", () => {
        const m = new DocumentMetadata({ K: ["a", "b"] });
        assert.deepEqual(m.getArray("K"), ["a", "b"]);
    });

    it("getArray returns empty array for missing key", () => {
        const m = new DocumentMetadata({});
        assert.deepEqual(m.getArray("nope"), []);
    });

    it("has returns true for existing key", () => {
        const m = new DocumentMetadata({ x: "1" });
        assert.equal(m.has("x"), true);
    });

    it("has returns false for missing key", () => {
        const m = new DocumentMetadata({ x: "1" });
        assert.equal(m.has("y"), false);
    });

    it("keys returns all keys", () => {
        const m = new DocumentMetadata({ a: "1", b: "2" });
        const k = m.keys();
        assert.ok(k.includes("a"));
        assert.ok(k.includes("b"));
        assert.equal(k.length, 2);
    });

    it("isEmpty returns true for empty data", () => {
        assert.equal(new DocumentMetadata({}).isEmpty(), true);
    });

    it("isEmpty returns false when data has keys", () => {
        assert.equal(new DocumentMetadata({ A: "1" }).isEmpty(), false);
    });
});

// ============================================================================
// Named field accessors
// ============================================================================

describe("DocumentMetadata - named field accessors", () => {
    it("getRecordId reads Record-ID", () => {
        assert.equal(
            new DocumentMetadata({ "Record-ID": "DP-00001" }).getRecordId(),
            "DP-00001"
        );
    });

    it("getRecordId falls back to record_id", () => {
        assert.equal(
            new DocumentMetadata({ record_id: "DP-00002" }).getRecordId(),
            "DP-00002"
        );
    });

    it("getDocumentType reads Document-Type", () => {
        assert.equal(
            new DocumentMetadata({ "Document-Type": "SOP" }).getDocumentType(),
            "SOP"
        );
    });

    it("getDocumentType falls back to Type", () => {
        assert.equal(
            new DocumentMetadata({ Type: "CHA" }).getDocumentType(),
            "CHA"
        );
    });

    it("getVersion reads Version", () => {
        assert.equal(
            new DocumentMetadata({ Version: "2.0" }).getVersion(),
            "2.0"
        );
    });

    it("getVersion falls back to lowercase version", () => {
        assert.equal(
            new DocumentMetadata({ version: "1.0" }).getVersion(),
            "1.0"
        );
    });

    it("getEffectiveDate reads Effective-Date", () => {
        assert.equal(
            new DocumentMetadata({
                "Effective-Date": "2024-01-01"
            }).getEffectiveDate(),
            "2024-01-01"
        );
    });

    it("getAdoptedDate reads Adopted-Date", () => {
        assert.equal(
            new DocumentMetadata({
                "Adopted-Date": "2023-06-15"
            }).getAdoptedDate(),
            "2023-06-15"
        );
    });

    it("getJurisdiction reads Jurisdiction", () => {
        assert.equal(
            new DocumentMetadata({ Jurisdiction: "RMI" }).getJurisdiction(),
            "RMI"
        );
    });

    it("getTitle reads Title, falls back to title", () => {
        assert.equal(new DocumentMetadata({ Title: "T" }).getTitle(), "T");
        assert.equal(new DocumentMetadata({ title: "t" }).getTitle(), "t");
    });

    it("getDocumentIndex parses integer", () => {
        assert.equal(
            new DocumentMetadata({
                "Document-Index": "3"
            }).getDocumentIndex(),
            3
        );
    });

    it("getDocumentIndex falls back to doc_index", () => {
        assert.equal(
            new DocumentMetadata({ doc_index: "7" }).getDocumentIndex(),
            7
        );
    });

    it("getDocumentIndex returns undefined for non-numeric", () => {
        assert.equal(
            new DocumentMetadata({
                "Document-Index": "abc"
            }).getDocumentIndex(),
            undefined
        );
    });

    it("getContentLength parses integer", () => {
        assert.equal(
            new DocumentMetadata({
                "Content-Length": "1024"
            }).getContentLength(),
            1024
        );
    });

    it("getContentLength returns undefined for negative", () => {
        assert.equal(
            new DocumentMetadata({
                "Content-Length": "-1"
            }).getContentLength(),
            undefined
        );
    });

    it("getSpdxLicenseIdentifier reads field", () => {
        assert.equal(
            new DocumentMetadata({
                "SPDX-LicenseIdentifier": "MIT"
            }).getSpdxLicenseIdentifier(),
            "MIT"
        );
    });

    it("getCanonicalUrl reads Canonical-URL", () => {
        assert.equal(
            new DocumentMetadata({
                "Canonical-URL": "https://example.com/doc"
            }).getCanonicalUrl(),
            "https://example.com/doc"
        );
    });

    it("getHashSha256Hex reads Hash-SHA256-HEX", () => {
        const hex = "a".repeat(64);
        assert.equal(
            new DocumentMetadata({ "Hash-SHA256-HEX": hex }).getHashSha256Hex(),
            hex
        );
    });
});

// ============================================================================
// toIndOptions
// ============================================================================

describe("DocumentMetadata.toIndOptions", () => {
    it("returns IndOptions with all fields", () => {
        const m = new DocumentMetadata({
            "Record-ID": "DP-00001",
            "Document-Type": "SOP",
            Version: "1.0",
            "Effective-Date": "2024-01-01",
            Jurisdiction: "RMI",
            "Document-Index": "2"
        });
        const opts = m.toIndOptions();
        assert.ok(opts !== null);
        assert.equal(opts.record_id, "DP-00001");
        assert.equal(opts.doc_type_code, "SOP");
        assert.equal(opts.version, "1.0");
        assert.equal(opts.effective_date, "2024-01-01");
        assert.equal(opts.jurisdiction, "RMI");
        assert.equal(opts.doc_index, 2);
    });

    it("returns null when Record-ID missing", () => {
        const m = new DocumentMetadata({ "Document-Type": "SOP" });
        assert.equal(m.toIndOptions(), null);
    });

    it("returns null when Document-Type missing", () => {
        const m = new DocumentMetadata({ "Record-ID": "DP-00001" });
        assert.equal(m.toIndOptions(), null);
    });

    it("accepts record_id_override", () => {
        const m = new DocumentMetadata({ "Document-Type": "SOP" });
        const opts = m.toIndOptions("OVERRIDE-00001");
        assert.ok(opts !== null);
        assert.equal(opts.record_id, "OVERRIDE-00001");
    });
});

// ============================================================================
// validate / isValid
// ============================================================================

describe("DocumentMetadata - validate / isValid", () => {
    it("validates data against schema - valid", () => {
        const m = new DocumentMetadata({
            "Record-ID": "DP-00001",
            Version: "1.0"
        });
        const schema = new Schema({
            type: "object",
            required: ["Record-ID"],
            properties: {
                "Record-ID": { type: "string" },
                Version: { type: "string" }
            }
        });
        assert.deepEqual(m.validate(schema), []);
        assert.equal(m.isValid(schema), true);
    });

    it("returns errors for invalid data", () => {
        const m = new DocumentMetadata({});
        const schema = new Schema({
            type: "object",
            required: ["Record-ID"]
        });
        const errors = m.validate(schema);
        assert.ok(errors.length > 0);
        assert.equal(m.isValid(schema), false);
    });
});

// ============================================================================
// serialize / serializeWithMarkers
// ============================================================================

describe("DocumentMetadata - serialize", () => {
    it("serializes sorted KEY: VALUE lines", () => {
        const m = new DocumentMetadata({ B: "2", A: "1" });
        const s = m.serialize();
        assert.ok(s.startsWith("A: 1"));
        assert.ok(s.includes("B: 2"));
        // Keys are sorted
        assert.ok(s.indexOf("A:") < s.indexOf("B:"));
    });

    it("serializes array values as repeated KEY: lines", () => {
        const m = new DocumentMetadata({ Tag: ["alpha", "beta"] });
        const s = m.serialize();
        const lines = s.split("\n").filter((l) => l.trim().length > 0);
        assert.equal(lines.filter((l) => l.startsWith("Tag:")).length, 2);
    });

    it("ends with newline", () => {
        const m = new DocumentMetadata({ A: "1" });
        assert.ok(m.serialize().endsWith("\n"));
    });
});

describe("DocumentMetadata - serializeWithMarkers", () => {
    it("wraps output in BEGIN/END markers", () => {
        const m = new DocumentMetadata({ A: "1" });
        const s = m.serializeWithMarkers();
        assert.ok(s.includes(DocumentMetadata.BEGIN_MARKER));
        assert.ok(s.includes(DocumentMetadata.END_MARKER));
        assert.ok(s.includes("A: 1"));
    });

    it("can be round-tripped through parseSidecar", () => {
        const m = new DocumentMetadata({ Title: "Round Trip", Version: "3" });
        const serialized = m.serializeWithMarkers();
        const parsed = DocumentMetadata.parseSidecar(serialized);
        assert.equal(parsed.getString("Title"), "Round Trip");
        assert.equal(parsed.getString("Version"), "3");
    });
});

// ============================================================================
// saveSidecar / load / loadIfExists / loadSidecar
// ============================================================================

describe("DocumentMetadata - saveSidecar / load / loadIfExists / loadSidecar", () => {
    it("saveSidecar writes .metadata file next to document", () => {
        const dir = makeTmpDir();
        const docPath = join(dir, "doc.md");
        writeFileSync(docPath, "body", "utf8");

        const m = new DocumentMetadata({ Title: "Saved", Version: "1" });
        m.saveSidecar(docPath);

        const sidecarPath = docPath + ".metadata";
        assert.ok(existsSync(sidecarPath));
        const raw = readFileSync(sidecarPath, "utf8");
        assert.ok(raw.includes("Title: Saved"));
        assert.equal(m.sourcePath, sidecarPath);
        rmSync(dir, { recursive: true });
    });

    it("load reads sidecar and parses it", () => {
        const dir = makeTmpDir();
        const p = join(dir, "meta.metadata");
        const block = makeBlock("Title: Loaded\nVersion: 9");
        writeFileSync(p, block, "utf8");

        const m = DocumentMetadata.load(p);
        assert.equal(m.getString("Title"), "Loaded");
        assert.equal(m.getString("Version"), "9");
        rmSync(dir, { recursive: true });
    });

    it("loadIfExists returns null for missing file", () => {
        assert.equal(
            DocumentMetadata.loadIfExists("/no/such/file.metadata"),
            null
        );
    });

    it("loadIfExists returns DocumentMetadata when file exists", () => {
        const dir = makeTmpDir();
        const p = join(dir, "meta.metadata");
        writeFileSync(p, "A: 1\n", "utf8");
        const m = DocumentMetadata.loadIfExists(p);
        assert.ok(m instanceof DocumentMetadata);
        assert.equal(/** @type {DocumentMetadata} */ (m).getString("A"), "1");
        rmSync(dir, { recursive: true });
    });

    it("loadSidecar returns null when no .metadata file exists", () => {
        const dir = makeTmpDir();
        const docPath = join(dir, "doc.md");
        writeFileSync(docPath, "body", "utf8");
        assert.equal(DocumentMetadata.loadSidecar(docPath), null);
        rmSync(dir, { recursive: true });
    });

    it("loadSidecar returns metadata when .metadata file exists", () => {
        const dir = makeTmpDir();
        const docPath = join(dir, "doc.md");
        writeFileSync(docPath, "body", "utf8");

        const m = new DocumentMetadata({ Title: "Side" });
        m.saveSidecar(docPath);

        const loaded = DocumentMetadata.loadSidecar(docPath);
        assert.ok(loaded instanceof DocumentMetadata);
        assert.equal(
            /** @type {DocumentMetadata} */ (loaded).getString("Title"),
            "Side"
        );
        rmSync(dir, { recursive: true });
    });
});

// ============================================================================
// BEGIN_MARKER / END_MARKER static getters
// ============================================================================

describe("DocumentMetadata - static marker getters", () => {
    it("BEGIN_MARKER is a non-empty string", () => {
        assert.ok(typeof DocumentMetadata.BEGIN_MARKER === "string");
        assert.ok(DocumentMetadata.BEGIN_MARKER.length > 0);
    });

    it("END_MARKER is a non-empty string different from BEGIN_MARKER", () => {
        assert.ok(typeof DocumentMetadata.END_MARKER === "string");
        assert.ok(DocumentMetadata.END_MARKER.length > 0);
        assert.notEqual(
            DocumentMetadata.BEGIN_MARKER,
            DocumentMetadata.END_MARKER
        );
    });
});
