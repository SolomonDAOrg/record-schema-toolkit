// @ts-check

/**
 * Unit tests for the Registry class.
 *
 * Covers: construction, static factories (parse / empty / load / loadIfExists /
 * loadMerged), series methods, doc-type methods, commitment-kind methods,
 * cross-reference helpers, _merge, isValidSeriesCode / isValidDocTypeCode,
 * and all get/has/getAll/getBy* accessors.
 *
 * @module tests/classes/Registry_test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Registry } from "../../lib/record-schema/Registry.mjs";

// ============================================================================
// Fixtures
// ============================================================================

/**
 * Minimal single-document YAML registry.
 * @type {string}
 */
const YAML_SINGLE = `\
schema: record-schema-registry
series:
  - code: DP
    name: DAO Proposals
    description: Governance proposals
    tier: "1"
    allowed_doc_types: [PROP, ANEX]
    recommended_doc_types: [PROP]
  - code: CHA
    name: Charter Documents
    tier: "1"
    allowed_doc_types: [CHA]
doc_types:
  - code: PROP
    name: Proposal
    description: A governance proposal
    recommended_extensions: [md]
    markdown_envelope: standard
    recommended_header_fields: [Title, Author]
    recommended_slug: proposal
    allowed_series: [DP]
  - code: ANEX
    name: Annex
    recommended_extensions: [md, pdf]
    allowed_series: [DP]
  - code: CHA
    name: Charter
    filing: true
    exclude_ind: true
    allowed_series: [CHA]
commitment_kinds:
  - code: VOTE
    name: Vote
    required_one_of: [yes, no, abstain]
    recommended_fields: [reason]
  - code: SIGN
    name: Signature
    required_one_of: [sig]
`;

/**
 * Second YAML registry for merge testing.
 * @type {string}
 */
const YAML_SECOND = `\
schema: record-schema-registry
series:
  - code: SOP
    name: Standard Operating Procedures
    tier: "2"
doc_types:
  - code: SOP
    name: SOP Document
commitment_kinds:
  - code: APPR
    name: Approval
`;

/**
 * Create a temp dir and return cleanup helper.
 * @returns {{ dir: string, write: (name: string, content: string) => string, cleanup: () => void }}
 */
function makeTmpDir() {
    const dir = join(
        tmpdir(),
        "registry-test-" + Math.random().toString(36).slice(2)
    );
    mkdirSync(dir, { recursive: true });
    return {
        dir,
        write(name, content) {
            const p = join(dir, name);
            writeFileSync(p, content, "utf8");
            return p;
        },
        cleanup() {
            rmSync(dir, { recursive: true });
        }
    };
}

// ============================================================================
// Construction
// ============================================================================

describe("Registry - construction", () => {
    it("initialises empty maps and null source_path", () => {
        const r = new Registry();
        assert.equal(r.source_path, null);
        assert.equal(r.series_by_code.size, 0);
        assert.equal(r.doc_types_by_code.size, 0);
        assert.equal(r.commitment_kinds_by_code.size, 0);
        assert.deepEqual(r.raw_documents, []);
    });

    it("stores provided source_path", () => {
        const r = new Registry("/some/registry.yaml");
        assert.equal(r.source_path, "/some/registry.yaml");
    });
});

// ============================================================================
// empty()
// ============================================================================

describe("Registry.empty", () => {
    it("returns Registry with no entries", () => {
        const r = Registry.empty();
        assert.ok(r instanceof Registry);
        assert.equal(r.series_by_code.size, 0);
        assert.equal(r.doc_types_by_code.size, 0);
        assert.equal(r.commitment_kinds_by_code.size, 0);
    });
});

// ============================================================================
// parse()
// ============================================================================

describe("Registry.parse", () => {
    it("parses series from YAML", () => {
        const r = Registry.parse(YAML_SINGLE);
        assert.equal(r.series_by_code.size, 2);
        assert.ok(r.hasSeries("DP"));
        assert.ok(r.hasSeries("CHA"));
    });

    it("parses doc_types from YAML", () => {
        const r = Registry.parse(YAML_SINGLE);
        assert.equal(r.doc_types_by_code.size, 3);
        assert.ok(r.hasDocType("PROP"));
        assert.ok(r.hasDocType("ANEX"));
        assert.ok(r.hasDocType("CHA"));
    });

    it("parses commitment_kinds from YAML", () => {
        const r = Registry.parse(YAML_SINGLE);
        assert.equal(r.commitment_kinds_by_code.size, 2);
        assert.ok(r.hasCommitmentKind("VOTE"));
        assert.ok(r.hasCommitmentKind("SIGN"));
    });

    it("stores source_path when provided", () => {
        const r = Registry.parse(YAML_SINGLE, "/path/registry.yaml");
        assert.equal(r.source_path, "/path/registry.yaml");
    });

    it("handles empty YAML without throwing", () => {
        const r = Registry.parse("");
        assert.ok(r instanceof Registry);
        assert.equal(r.series_by_code.size, 0);
    });

    it("handles YAML with no series/doc_types/commitment_kinds keys", () => {
        const r = Registry.parse("schema: record-schema-registry\n");
        assert.equal(r.series_by_code.size, 0);
        assert.equal(r.doc_types_by_code.size, 0);
    });

    it("populates raw_documents", () => {
        const r = Registry.parse(YAML_SINGLE);
        assert.ok(r.raw_documents.length > 0);
    });
});

// ============================================================================
// load / loadIfExists
// ============================================================================

describe("Registry.load / loadIfExists", () => {
    it("load reads and parses a YAML file", () => {
        const tmp = makeTmpDir();
        const p = tmp.write("registry.yaml", YAML_SINGLE);
        const r = Registry.load(p);
        assert.ok(r.hasSeries("DP"));
        tmp.cleanup();
    });

    it("load throws on missing file", () => {
        assert.throws(() => Registry.load("/no/such/file.yaml"));
    });

    it("loadIfExists returns Registry for existing file", () => {
        const tmp = makeTmpDir();
        const p = tmp.write("registry.yaml", YAML_SINGLE);
        const r = Registry.loadIfExists(p);
        assert.ok(r instanceof Registry);
        tmp.cleanup();
    });

    it("loadIfExists returns null for missing file", () => {
        assert.equal(Registry.loadIfExists("/no/such/file.yaml"), null);
    });
});

// ============================================================================
// loadMerged
// ============================================================================

describe("Registry.loadMerged", () => {
    it("merges entries from multiple files", () => {
        const tmp = makeTmpDir();
        const p1 = tmp.write("reg1.yaml", YAML_SINGLE);
        const p2 = tmp.write("reg2.yaml", YAML_SECOND);
        const r = Registry.loadMerged([p1, p2]);
        assert.ok(r.hasSeries("DP"));
        assert.ok(r.hasSeries("SOP"));
        assert.ok(r.hasDocType("PROP"));
        assert.ok(r.hasDocType("SOP"));
        assert.ok(r.hasCommitmentKind("VOTE"));
        assert.ok(r.hasCommitmentKind("APPR"));
        tmp.cleanup();
    });

    it("second registry overwrites first on duplicate code", () => {
        const overrideYaml = `\
schema: record-schema-registry
series:
  - code: DP
    name: Overridden Name
    tier: "9"
`;
        const tmp = makeTmpDir();
        const p1 = tmp.write("reg1.yaml", YAML_SINGLE);
        const p2 = tmp.write("override.yaml", overrideYaml);
        const r = Registry.loadMerged([p1, p2]);
        assert.equal(r.getSeriesName("DP"), "Overridden Name");
        tmp.cleanup();
    });

    it("skips missing files silently", () => {
        const tmp = makeTmpDir();
        const p1 = tmp.write("reg1.yaml", YAML_SINGLE);
        const r = Registry.loadMerged([p1, "/no/such/file.yaml"]);
        assert.ok(r.hasSeries("DP"));
        tmp.cleanup();
    });

    it("handles empty paths array", () => {
        const r = Registry.loadMerged([]);
        assert.ok(r instanceof Registry);
        assert.equal(r.series_by_code.size, 0);
    });
});

// ============================================================================
// Series methods
// ============================================================================

describe("Registry - series methods", () => {
    /** @type {Registry} */
    let r;
    r = Registry.parse(YAML_SINGLE);

    it("getSeries returns entry for known code", () => {
        const entry = r.getSeries("DP");
        assert.ok(entry !== undefined);
        assert.equal(entry.name, "DAO Proposals");
    });

    it("getSeries returns undefined for unknown code", () => {
        assert.equal(r.getSeries("XX"), undefined);
    });

    it("getSeriesName returns name for known code", () => {
        assert.equal(r.getSeriesName("DP"), "DAO Proposals");
    });

    it("getSeriesName falls back to code for unknown", () => {
        assert.equal(r.getSeriesName("ZZ"), "ZZ");
    });

    it("getSeriesDescription returns description", () => {
        assert.equal(r.getSeriesDescription("DP"), "Governance proposals");
    });

    it("getSeriesDescription returns undefined when absent", () => {
        assert.equal(r.getSeriesDescription("CHA"), undefined);
    });

    it("hasSeries returns true for known code", () => {
        assert.equal(r.hasSeries("DP"), true);
    });

    it("hasSeries returns false for unknown code", () => {
        assert.equal(r.hasSeries("XX"), false);
    });

    it("getAllSeriesCodes returns all codes", () => {
        const codes = r.getAllSeriesCodes();
        assert.ok(codes.includes("DP"));
        assert.ok(codes.includes("CHA"));
        assert.equal(codes.length, 2);
    });

    it("getAllSeries returns all entries", () => {
        const entries = r.getAllSeries();
        assert.equal(entries.length, 2);
        assert.ok(entries.some((e) => e.code === "DP"));
    });

    it("getSeriesByTier returns entries matching tier", () => {
        const tier1 = r.getSeriesByTier("1");
        assert.ok(tier1.length === 2);
        assert.equal(r.getSeriesByTier("99").length, 0);
    });

    it("getRecommendedDocTypes returns recommended_doc_types when present", () => {
        const rdt = r.getRecommendedDocTypes("DP");
        assert.deepEqual(rdt, ["PROP"]);
    });

    it("getRecommendedDocTypes falls back to allowed_doc_types when no recommended", () => {
        // CHA series has no recommended_doc_types
        const rdt = r.getRecommendedDocTypes("CHA");
        assert.deepEqual(rdt, ["CHA"]);
    });

    it("getRecommendedDocTypes returns empty array for unknown series", () => {
        assert.deepEqual(r.getRecommendedDocTypes("XX"), []);
    });
});

// ============================================================================
// isValidSeriesCode
// ============================================================================

describe("Registry - isValidSeriesCode", () => {
    /** @type {Registry} */
    let r;
    r = Registry.parse(YAML_SINGLE);

    it("returns true for known code", () => {
        assert.equal(r.isValidSeriesCode("DP"), true);
    });

    it("returns false for unknown code when registry non-empty", () => {
        assert.equal(r.isValidSeriesCode("XX"), false);
    });

    it("returns false for non-string input", () => {
        // @ts-ignore
        assert.equal(r.isValidSeriesCode(42), false);
    });

    it("returns false for lowercase code", () => {
        assert.equal(r.isValidSeriesCode("dp"), false);
    });

    it("returns false for code that is too short (1 char)", () => {
        assert.equal(r.isValidSeriesCode("D"), false);
    });

    it("returns false for code that is too long (6 chars)", () => {
        assert.equal(r.isValidSeriesCode("TOOLNG"), false);
    });

    it("returns true for any valid-format code when registry is empty", () => {
        const empty = Registry.empty();
        assert.equal(empty.isValidSeriesCode("XX"), true);
        assert.equal(empty.isValidSeriesCode("ABCDE"), true);
    });
});

// ============================================================================
// Doc type methods
// ============================================================================

describe("Registry - doc type methods", () => {
    /** @type {Registry} */
    let r;
    r = Registry.parse(YAML_SINGLE);

    it("getDocType returns entry for known code", () => {
        const entry = r.getDocType("PROP");
        assert.ok(entry !== undefined);
        assert.equal(entry.name, "Proposal");
    });

    it("getDocType returns undefined for unknown code", () => {
        assert.equal(r.getDocType("ZZZ"), undefined);
    });

    it("getDocTypeName returns name for known code", () => {
        assert.equal(r.getDocTypeName("PROP"), "Proposal");
    });

    it("getDocTypeName falls back to code for unknown", () => {
        assert.equal(r.getDocTypeName("ZZZ"), "ZZZ");
    });

    it("getDocTypeDescription returns description", () => {
        assert.equal(r.getDocTypeDescription("PROP"), "A governance proposal");
    });

    it("getDocTypeDescription returns undefined when absent", () => {
        assert.equal(r.getDocTypeDescription("ANEX"), undefined);
    });

    it("hasDocType returns true/false correctly", () => {
        assert.equal(r.hasDocType("PROP"), true);
        assert.equal(r.hasDocType("NONE"), false);
    });

    it("getAllDocTypeCodes returns all codes", () => {
        const codes = r.getAllDocTypeCodes();
        assert.ok(codes.includes("PROP"));
        assert.ok(codes.includes("ANEX"));
        assert.ok(codes.includes("CHA"));
        assert.equal(codes.length, 3);
    });

    it("getAllDocTypes returns all entries", () => {
        assert.equal(r.getAllDocTypes().length, 3);
    });

    it("getRecommendedExtensions returns extensions array", () => {
        assert.deepEqual(r.getRecommendedExtensions("PROP"), ["md"]);
        assert.deepEqual(r.getRecommendedExtensions("ANEX"), ["md", "pdf"]);
    });

    it("getRecommendedExtensions returns empty array for unknown code", () => {
        assert.deepEqual(r.getRecommendedExtensions("ZZZ"), []);
    });

    it("getMarkdownEnvelope returns value", () => {
        assert.equal(r.getMarkdownEnvelope("PROP"), "standard");
    });

    it("getMarkdownEnvelope returns undefined for unknown code", () => {
        assert.equal(r.getMarkdownEnvelope("ZZZ"), undefined);
    });

    it("getRecommendedHeaderFields returns array", () => {
        assert.deepEqual(r.getRecommendedHeaderFields("PROP"), [
            "Title",
            "Author"
        ]);
    });

    it("getRecommendedSlug returns slug string", () => {
        assert.equal(r.getRecommendedSlug("PROP"), "proposal");
    });

    it("getRecommendedSlug returns undefined for unknown code", () => {
        assert.equal(r.getRecommendedSlug("ZZZ"), undefined);
    });

    it("isFilingDocType returns true when filing=true", () => {
        assert.equal(r.isFilingDocType("CHA"), true);
    });

    it("isFilingDocType returns false for non-filing type", () => {
        assert.equal(r.isFilingDocType("PROP"), false);
    });

    it("isFilingDocType returns false for unknown code", () => {
        assert.equal(r.isFilingDocType("ZZZ"), false);
    });

    it("shouldExcludeIndFromPdf returns true when exclude_ind=true", () => {
        assert.equal(r.shouldExcludeIndFromPdf("CHA"), true);
    });

    it("shouldExcludeIndFromPdf returns false for normal type", () => {
        assert.equal(r.shouldExcludeIndFromPdf("PROP"), false);
    });

    it("getFilingDocTypeCodes returns only filing codes", () => {
        const codes = r.getFilingDocTypeCodes();
        assert.ok(codes.includes("CHA"));
        assert.ok(!codes.includes("PROP"));
    });
});

// ============================================================================
// isValidDocTypeCode
// ============================================================================

describe("Registry - isValidDocTypeCode", () => {
    /** @type {Registry} */
    let r;
    r = Registry.parse(YAML_SINGLE);

    it("returns true for known code", () => {
        assert.equal(r.isValidDocTypeCode("PROP"), true);
    });

    it("returns false for unknown code when registry non-empty", () => {
        assert.equal(r.isValidDocTypeCode("NONE"), false);
    });

    it("returns false for lowercase code", () => {
        assert.equal(r.isValidDocTypeCode("prop"), false);
    });

    it("returns false for code too short", () => {
        assert.equal(r.isValidDocTypeCode("P"), false);
    });

    it("returns false for code too long", () => {
        assert.equal(r.isValidDocTypeCode("TOOLNG"), false);
    });

    it("returns true for any valid-format code when registry is empty", () => {
        const empty = Registry.empty();
        assert.equal(empty.isValidDocTypeCode("PROP"), true);
    });
});

// ============================================================================
// Cross-reference: isDocTypeAllowedInSeries
// ============================================================================

describe("Registry - isDocTypeAllowedInSeries", () => {
    /** @type {Registry} */
    let r;
    r = Registry.parse(YAML_SINGLE);

    it("returns true for explicitly allowed combination", () => {
        assert.equal(r.isDocTypeAllowedInSeries("PROP", "DP"), true);
    });

    it("returns false when doc_type not in series.allowed_doc_types", () => {
        // CHA not listed in DP.allowed_doc_types
        assert.equal(r.isDocTypeAllowedInSeries("CHA", "DP"), false);
    });

    it("returns false when series not in doc_type.allowed_series", () => {
        // PROP.allowed_series=[DP]; CHA series is not allowed for PROP
        assert.equal(r.isDocTypeAllowedInSeries("PROP", "CHA"), false);
    });

    it("returns true when no restrictions on either side (empty registry)", () => {
        const empty = Registry.empty();
        assert.equal(
            empty.isDocTypeAllowedInSeries("ANYTHING", "SERIES"),
            true
        );
    });
});

// ============================================================================
// Commitment kind methods
// ============================================================================

describe("Registry - commitment kind methods", () => {
    /** @type {Registry} */
    let r;
    r = Registry.parse(YAML_SINGLE);

    it("getCommitmentKind returns entry for known code", () => {
        const entry = r.getCommitmentKind("VOTE");
        assert.ok(entry !== undefined);
        assert.equal(entry.name, "Vote");
    });

    it("getCommitmentKind returns undefined for unknown code", () => {
        assert.equal(r.getCommitmentKind("ZZZ"), undefined);
    });

    it("getCommitmentKindName returns name for known code", () => {
        assert.equal(r.getCommitmentKindName("VOTE"), "Vote");
    });

    it("getCommitmentKindName falls back to code for unknown", () => {
        assert.equal(r.getCommitmentKindName("ZZZ"), "ZZZ");
    });

    it("hasCommitmentKind returns true/false correctly", () => {
        assert.equal(r.hasCommitmentKind("VOTE"), true);
        assert.equal(r.hasCommitmentKind("NONE"), false);
    });

    it("getAllCommitmentKindCodes returns all codes", () => {
        const codes = r.getAllCommitmentKindCodes();
        assert.ok(codes.includes("VOTE"));
        assert.ok(codes.includes("SIGN"));
        assert.equal(codes.length, 2);
    });

    it("getAllCommitmentKinds returns all entries", () => {
        assert.equal(r.getAllCommitmentKinds().length, 2);
    });

    it("getCommitmentRequiredOneOf returns required_one_of array", () => {
        assert.deepEqual(r.getCommitmentRequiredOneOf("VOTE"), [
            "yes",
            "no",
            "abstain"
        ]);
    });

    it("getCommitmentRequiredOneOf returns empty array for unknown code", () => {
        assert.deepEqual(r.getCommitmentRequiredOneOf("ZZZ"), []);
    });

    it("getCommitmentRecommendedFields returns recommended_fields array", () => {
        assert.deepEqual(r.getCommitmentRecommendedFields("VOTE"), ["reason"]);
    });

    it("getCommitmentRecommendedFields returns empty array when absent", () => {
        assert.deepEqual(r.getCommitmentRecommendedFields("SIGN"), []);
    });
});

// ============================================================================
// Multi-document YAML (combined format)
// ============================================================================

describe("Registry.parse - multi-document YAML", () => {
    it("parses a YAML stream with explicit --- separators", () => {
        const yaml = `\
schema: record-schema-registry
series:
  - code: DP
    name: DAO Proposals
    tier: "1"
---
schema: record-schema-registry
doc_types:
  - code: PROP
    name: Proposal
`;
        const r = Registry.parse(yaml);
        assert.ok(r.hasSeries("DP"));
        assert.ok(r.hasDocType("PROP"));
    });

    it("auto-splits combined format without --- separators", () => {
        // Two schema: record-schema-registry blocks without --- between them
        const yaml = `\
schema: record-schema-registry
series:
  - code: AA
    name: Alpha
    tier: "1"
schema: record-schema-registry
doc_types:
  - code: BB
    name: Beta
`;
        const r = Registry.parse(yaml);
        assert.ok(r.hasSeries("AA"));
        assert.ok(r.hasDocType("BB"));
    });
});

// ============================================================================
// Raw document sources
// ============================================================================

describe("Registry - raw document sources", () => {
    it("attributes parsed documents to their source file", () => {
        const registry = Registry.parse(YAML_SINGLE, "/schemas/core.yaml");
        assert.equal(registry.getRawDocumentSource(0), "/schemas/core.yaml");
    });

    it("preserves per-document source files across merged registries", () => {
        const tmp = makeTmpDir();
        const firstPath = tmp.write("first.yaml", YAML_SINGLE);
        const secondPath = tmp.write("second.yaml", YAML_SECOND);
        const registry = Registry.loadMerged([firstPath, secondPath]);

        assert.equal(registry.raw_documents.length, 2);
        assert.equal(registry.getRawDocumentSource(0), firstPath);
        assert.equal(registry.getRawDocumentSource(1), secondPath);
        tmp.cleanup();
    });

    it("falls back to a merged registry source when source arrays are absent", () => {
        const target = Registry.empty();
        const source = new Registry("/schemas/manual.yaml");
        source.raw_documents = [{ schema: "record-schema-registry" }];
        target["_merge"](source);

        assert.equal(target.getRawDocumentSource(0), "/schemas/manual.yaml");
    });
});
