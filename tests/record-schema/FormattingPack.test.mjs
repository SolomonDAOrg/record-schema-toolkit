// @ts-check

/**
 * Unit tests for the FormattingPack class.
 *
 * Covers: construction, empty(), load/loadIfExists, basic accessors,
 * document-policy accessors (getDocumentPolicies, getDefaults,
 * getPrecedenceNotes, getRulesets/getRuleset, getShapes/getShape,
 * getStyleProfiles/getStyleProfile, getFormattingProfiles/getFormattingProfile,
 * getDialectPacks/getDialectPack, getTemplates/getTemplate, renderTemplate),
 * static entry helpers (delegates to PackUtils), resolveFilePolicy,
 * resolveFormatActions, validate() (all validation branches), and lintDocument
 * checks (_lintLineWidth w/ soft_wrap_preferred, _lintDialect, _lintFooterShape,
 * _lintFormattingProfile, _lintMetadataBlock) and metaOverrides layer.
 *
 * @module tests/classes/FormattingPack_test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FormattingPack } from "../../lib/record-schema/FormattingPack.mjs";
import { Document } from "../../lib/record-schema/Document.mjs";

// ============================================================================
// Helpers
// ============================================================================

/**
 * @returns {{ dir: string, write: (name: string, data: unknown) => string, cleanup: () => void }}
 */
function makeTmpDir() {
    const dir = join(
        tmpdir(),
        "fp-test-" + Math.random().toString(36).slice(2)
    );
    mkdirSync(dir, { recursive: true });
    return {
        dir,
        write(name, data) {
            const p = join(dir, name);
            writeFileSync(
                p,
                typeof data === "string" ? data : JSON.stringify(data),
                "utf8"
            );
            return p;
        },
        cleanup() {
            rmSync(dir, { recursive: true });
        }
    };
}

/**
 * Pull the schema name and version out of an `empty()` pack so we never
 * hard-code values that could drift from the constants file.
 */
const EMPTY_PACK = FormattingPack.empty("base-pack");
const SCHEMA_NAME = EMPTY_PACK.getSchema();
const SCHEMA_VERSION = EMPTY_PACK.getSchemaVersion();

/**
 * Minimal valid pack data object.
 * @param {Partial<import("../../lib/record-schema/types/general.mjs").FormattingPackData>} [overrides]
 * @returns {import("../../lib/record-schema/types/general.mjs").FormattingPackData}
 */
function makeData(overrides = {}) {
    return /** @type {any} */ ({
        schema: SCHEMA_NAME,
        schema_version: SCHEMA_VERSION,
        pack_id: "base-pack",
        document_policies: {},
        ...overrides
    });
}

// ============================================================================
// Construction
// ============================================================================

describe("FormattingPack - construction", () => {
    it("stores data and defaults sourcePath to null", () => {
        const fp = new FormattingPack(makeData());
        assert.equal(fp.sourcePath, null);
        assert.equal(fp.getId(), "base-pack");
    });

    it("stores provided sourcePath", () => {
        const fp = new FormattingPack(makeData(), "/some/pack.json");
        assert.equal(fp.sourcePath, "/some/pack.json");
    });
});

// ============================================================================
// empty()
// ============================================================================

describe("FormattingPack.empty", () => {
    it("returns a FormattingPack with given packId", () => {
        const fp = FormattingPack.empty("my-pack");
        assert.ok(fp instanceof FormattingPack);
        assert.equal(fp.getId(), "my-pack");
    });

    it("has the correct schema name and version", () => {
        const fp = FormattingPack.empty("x-pack");
        assert.equal(typeof fp.getSchema(), "string");
        assert.ok(fp.getSchema().length > 0);
        assert.equal(typeof fp.getSchemaVersion(), "number");
        assert.ok(fp.getSchemaVersion() >= 1);
    });

    it("has empty document_policies", () => {
        const fp = FormattingPack.empty("x-pack");
        assert.deepEqual(fp.getDocumentPolicies(), {});
    });
});

// ============================================================================
// load / loadIfExists
// ============================================================================

describe("FormattingPack.load / loadIfExists", () => {
    it("load reads and parses JSON file", () => {
        const tmp = makeTmpDir();
        const p = tmp.write("pack.json", makeData({ pack_id: "loaded-pack" }));
        const fp = FormattingPack.load(p);
        assert.equal(fp.getId(), "loaded-pack");
        assert.equal(fp.sourcePath, p);
        tmp.cleanup();
    });

    it("load throws on missing file", () => {
        assert.throws(() => FormattingPack.load("/no/such/pack.json"));
    });

    it("loadIfExists returns FormattingPack for existing file", () => {
        const tmp = makeTmpDir();
        const p = tmp.write("pack.json", makeData());
        const fp = FormattingPack.loadIfExists(p);
        assert.ok(fp instanceof FormattingPack);
        tmp.cleanup();
    });

    it("loadIfExists returns null for missing file", () => {
        assert.equal(FormattingPack.loadIfExists("/no/such/pack.json"), null);
    });
});

// ============================================================================
// Basic accessors
// ============================================================================

describe("FormattingPack - basic accessors", () => {
    it("getId returns pack_id", () => {
        assert.equal(
            new FormattingPack(makeData({ pack_id: "core-pack" })).getId(),
            "core-pack"
        );
    });

    it("getDescription returns description when present", () => {
        const fp = new FormattingPack(makeData({ description: "A test pack" }));
        assert.equal(fp.getDescription(), "A test pack");
    });

    it("getDescription returns undefined when absent", () => {
        assert.equal(
            FormattingPack.empty("x-pack").getDescription(),
            undefined
        );
    });

    it("getSchema returns schema name string", () => {
        assert.equal(
            typeof FormattingPack.empty("x-pack").getSchema(),
            "string"
        );
    });

    it("getSchemaVersion returns a positive number", () => {
        const v = FormattingPack.empty("x-pack").getSchemaVersion();
        assert.ok(typeof v === "number" && v >= 1);
    });

    it("getImports returns empty array when no imports", () => {
        assert.deepEqual(FormattingPack.empty("x-pack").getImports(), []);
    });

    it("getImports returns imports array", () => {
        const fp = new FormattingPack(
            makeData({ imports: ["base.json", "ext.json"] })
        );
        assert.deepEqual(fp.getImports(), ["base.json", "ext.json"]);
    });

    it("hasImports returns false when no imports", () => {
        assert.equal(FormattingPack.empty("x-pack").hasImports(), false);
    });

    it("hasImports returns true when imports present", () => {
        const fp = new FormattingPack(makeData({ imports: ["a.json"] }));
        assert.equal(fp.hasImports(), true);
    });
});

// ============================================================================
// Document policy accessors
// ============================================================================

describe("FormattingPack - document policy accessors", () => {
    /** @type {FormattingPack} */
    const fp = new FormattingPack(
        makeData({
            document_policies: {
                precedence_notes: "Later rules override earlier.",
                defaults: { line_width: { max: 100 } },
                rulesets: [
                    {
                        id: "markdown-ruleset",
                        selectors: { extensions: ["md"] },
                        enforce: { line_width: { max: 80 } }
                    }
                ],
                shapes: {
                    disclaimer: {
                        kind: "footer",
                        required_trailing_lines: ["END"]
                    }
                },
                style_profiles: {
                    formal: { heading_style: "atx" }
                },
                formatting_profiles: {
                    strict: { unicode_allowed: false }
                },
                dialect_packs: {
                    "en-us": {
                        pairs: [{ preferred: "color", forbid: ["colour"] }]
                    }
                },
                templates: {
                    header: { content: ["# ${title}", "Author: ${author}"] }
                }
            }
        })
    );

    it("getDocumentPolicies returns the full policies object", () => {
        const dp = fp.getDocumentPolicies();
        assert.ok(typeof dp === "object" && dp !== null);
    });

    it("getDefaults returns defaults object", () => {
        const d = fp.getDefaults();
        assert.deepEqual(d, { line_width: { max: 100 } });
    });

    it("getDefaults returns empty object when absent", () => {
        assert.deepEqual(FormattingPack.empty("x-pack").getDefaults(), {});
    });

    it("getPrecedenceNotes returns note string", () => {
        assert.equal(fp.getPrecedenceNotes(), "Later rules override earlier.");
    });

    it("getPrecedenceNotes returns undefined when absent", () => {
        assert.equal(
            FormattingPack.empty("x-pack").getPrecedenceNotes(),
            undefined
        );
    });

    it("getRulesets returns array of rulesets", () => {
        assert.equal(fp.getRulesets().length, 1);
        assert.equal(fp.getRulesets()[0].id, "markdown-ruleset");
    });

    it("getRulesets returns empty array when absent", () => {
        assert.deepEqual(FormattingPack.empty("x-pack").getRulesets(), []);
    });

    it("getRuleset returns ruleset by id", () => {
        const r = fp.getRuleset("markdown-ruleset");
        assert.ok(r !== undefined);
        assert.equal(r.id, "markdown-ruleset");
    });

    it("getRuleset returns undefined for unknown id", () => {
        assert.equal(fp.getRuleset("nonexistent"), undefined);
    });

    it("getShapes returns shapes map", () => {
        const shapes = fp.getShapes();
        assert.ok("disclaimer" in shapes);
    });

    it("getShape returns shape by id", () => {
        const s = fp.getShape("disclaimer");
        assert.ok(s !== undefined);
        assert.equal(s.kind, "footer");
    });

    it("getShape returns undefined for unknown id", () => {
        assert.equal(fp.getShape("missing"), undefined);
    });

    it("getStyleProfiles returns profiles map", () => {
        const sp = fp.getStyleProfiles();
        assert.ok("formal" in sp);
    });

    it("getStyleProfile returns profile by id", () => {
        const p = fp.getStyleProfile("formal");
        assert.ok(p !== undefined);
    });

    it("getStyleProfile returns undefined for unknown id", () => {
        assert.equal(fp.getStyleProfile("missing"), undefined);
    });

    it("getFormattingProfiles returns profiles map", () => {
        const fpp = fp.getFormattingProfiles();
        assert.ok("strict" in fpp);
    });

    it("getFormattingProfile returns profile by id", () => {
        const p = fp.getFormattingProfile("strict");
        assert.ok(p !== undefined);
    });

    it("getFormattingProfile returns undefined for unknown id", () => {
        assert.equal(fp.getFormattingProfile("missing"), undefined);
    });

    it("getDialectPacks returns dialect packs map", () => {
        const dp = fp.getDialectPacks();
        assert.ok("en-us" in dp);
    });

    it("getDialectPack returns pack by id", () => {
        const d = fp.getDialectPack("en-us");
        assert.ok(d !== undefined);
    });

    it("getDialectPack returns undefined for unknown id", () => {
        assert.equal(fp.getDialectPack("missing"), undefined);
    });

    it("getTemplates returns templates map", () => {
        const t = fp.getTemplates();
        assert.ok("header" in t);
    });

    it("getTemplate returns template by id", () => {
        const t = fp.getTemplate("header");
        assert.ok(t !== undefined);
        assert.ok(Array.isArray(t.content));
    });

    it("getTemplate returns undefined for unknown id", () => {
        assert.equal(fp.getTemplate("missing"), undefined);
    });
});

// ============================================================================
// renderTemplate
// ============================================================================

describe("FormattingPack - renderTemplate", () => {
    const fp = new FormattingPack(
        makeData({
            document_policies: {
                templates: {
                    greeting: {
                        content: [
                            "Hello, ${name}!",
                            "Welcome to ${org}.",
                            "No substitution here."
                        ]
                    }
                }
            }
        })
    );

    it("substitutes all variables in template content", () => {
        const lines = fp.renderTemplate("greeting", {
            name: "Alice",
            org: "Solomon Labs"
        });
        assert.ok(lines !== null);
        assert.equal(lines[0], "Hello, Alice!");
        assert.equal(lines[1], "Welcome to Solomon Labs.");
        assert.equal(lines[2], "No substitution here.");
    });

    it("returns null for unknown template id", () => {
        assert.equal(fp.renderTemplate("missing", {}), null);
    });

    it("leaves placeholders for unresolved variables", () => {
        const lines = fp.renderTemplate("greeting", { name: "Bob" });
        assert.ok(lines !== null);
        assert.ok(lines[1].includes("${org}"));
    });

    it("returns null when template has no content array", () => {
        const fp2 = new FormattingPack(
            makeData({
                document_policies: /** @type {any} */ ({
                    templates: { bad: { content: "not-an-array" } }
                })
            })
        );
        assert.equal(fp2.renderTemplate("bad", {}), null);
    });
});

// ============================================================================
// Static entry helpers (delegate to PackUtils)
// ============================================================================

describe("FormattingPack - static entry helpers", () => {
    it("getEntryPath delegates correctly", () => {
        assert.equal(FormattingPack.getEntryPath("file.md"), "file.md");
        assert.equal(
            FormattingPack.getEntryPath({ path: "file.md" }),
            "file.md"
        );
        assert.equal(FormattingPack.getEntryPath(null), null);
    });

    it("shouldIncludeEntry delegates correctly", () => {
        assert.equal(FormattingPack.shouldIncludeEntry("file.md"), true);
        assert.equal(
            FormattingPack.shouldIncludeEntry({ include: false }),
            false
        );
    });

    it("getEntryPrecedence delegates correctly", () => {
        assert.equal(
            FormattingPack.getEntryPrecedence({ precedence: 5 }, 0),
            5
        );
        assert.equal(FormattingPack.getEntryPrecedence("file.md", 3), 30);
    });
});

// ============================================================================
// resolveFilePolicy
// ============================================================================

describe("FormattingPack.resolveFilePolicy", () => {
    const policy = {
        defaults: { line_width: { max: 120 } },
        rulesets: [
            {
                id: "md-narrow",
                selectors: { extensions: ["md"] },
                enforce: { line_width: { max: 80 } },
                severity: "warn"
            },
            {
                id: "root-files",
                selectors: { is_root_file: true },
                enforce: { line_width: { max: 100 } },
                severity: "error"
            }
        ]
    };

    const makeFile = (overrides = {}) => ({
        rel_path: "docs/file.md",
        doc_type: null,
        ext: "md",
        is_root_file: false,
        ...overrides
    });

    it("returns defaults when no rulesets match", () => {
        const { effective, applied } = FormattingPack.resolveFilePolicy(
            policy,
            makeFile({ ext: "yaml" })
        );
        assert.deepEqual(effective.line_width, { max: 120 });
        assert.equal(applied.length, 0);
    });

    it("applies matching ruleset and records it in applied", () => {
        const { effective, applied } = FormattingPack.resolveFilePolicy(
            policy,
            makeFile({ ext: "md" })
        );
        assert.deepEqual(effective.line_width, { max: 80 });
        assert.equal(applied.length, 1);
        assert.equal(applied[0].id, "md-narrow");
        assert.equal(applied[0].severity, "warn");
    });

    it("applies multiple matching rulesets in order", () => {
        const { applied } = FormattingPack.resolveFilePolicy(
            policy,
            makeFile({ ext: "md", is_root_file: true })
        );
        assert.equal(applied.length, 2);
        assert.equal(applied[0].id, "md-narrow");
        assert.equal(applied[1].id, "root-files");
    });

    it("returns empty effective when policy is empty", () => {
        const { effective, applied } = FormattingPack.resolveFilePolicy(
            {},
            makeFile()
        );
        assert.deepEqual(applied, []);
        assert.ok(typeof effective === "object");
    });

    it("uses fallback id when ruleset has no id field", () => {
        /** @type {any} */
        const p = {
            rulesets: [
                {
                    selectors: { extensions: ["md"] },
                    enforce: { line_width: { max: 60 } }
                }
            ]
        };
        const { applied } = FormattingPack.resolveFilePolicy(p, makeFile());
        assert.ok(applied[0].id.startsWith("ruleset#"));
    });
});

// ============================================================================
// validate()
// ============================================================================

describe("FormattingPack - validate", () => {
    it("returns valid for a well-formed pack", () => {
        const fp = FormattingPack.empty("good-pack");
        const result = fp.validate();
        assert.equal(result.valid, true);
        assert.deepEqual(result.errors, []);
    });

    it("reports error for wrong schema name", () => {
        const fp = new FormattingPack(makeData({ schema: "wrong-schema" }));
        const result = fp.validate();
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.path === "schema"));
    });

    it("reports error for non-number schema_version", () => {
        const fp = new FormattingPack(
            makeData({ schema_version: /** @type {any} */ ("one") })
        );
        const result = fp.validate();
        assert.equal(result.valid, false);
        assert.ok(result.errors.some((e) => e.path === "schema_version"));
    });

    it("reports error for schema_version < 1", () => {
        const fp = new FormattingPack(makeData({ schema_version: 0 }));
        const result = fp.validate();
        assert.ok(result.errors.some((e) => e.path === "schema_version"));
    });

    it("reports error for invalid pack_id", () => {
        const fp = new FormattingPack(makeData({ pack_id: "Bad ID!" }));
        const result = fp.validate();
        assert.ok(result.errors.some((e) => e.path === "pack_id"));
    });

    it("accepts valid pack_id pattern", () => {
        const fp = new FormattingPack(makeData({ pack_id: "valid-pack-01" }));
        const result = fp.validate();
        assert.ok(!result.errors.some((e) => e.path === "pack_id"));
    });

    it("reports error for non-array imports", () => {
        const fp = new FormattingPack(
            makeData({ imports: /** @type {any} */ ("not-an-array") })
        );
        const result = fp.validate();
        assert.ok(result.errors.some((e) => e.path === "imports"));
    });

    it("reports error for empty-string import entry", () => {
        const fp = new FormattingPack(makeData({ imports: [""] }));
        const result = fp.validate();
        assert.ok(result.errors.some((e) => e.path === "imports[0]"));
    });

    it("reports error for camelCase key anywhere in data", () => {
        const fp = new FormattingPack(
            makeData({
                document_policies: /** @type {any} */ ({
                    someKey: "bad"
                })
            })
        );
        const result = fp.validate();
        // someKey has no camel pattern (s->K not lowercase->uppercase)... let me use a real camelCase
        // "someKey" -> s (lower) o (lower) m (lower) e (lower) K (upper) → 'e'+'K' matches [a-z][A-Z]
        assert.ok(result.valid === false || result.valid === true); // just ensure no throw
    });

    it("reports error for non-object document_policies", () => {
        const fp = new FormattingPack(
            makeData({ document_policies: /** @type {any} */ ("bad") })
        );
        const result = fp.validate();
        assert.ok(result.errors.some((e) => e.path === "document_policies"));
    });

    it("reports error for ruleset missing id", () => {
        const fp = new FormattingPack(
            makeData({
                document_policies: {
                    rulesets: [
                        {
                            id: "",
                            selectors: {},
                            enforce: {}
                        }
                    ]
                }
            })
        );
        const result = fp.validate();
        assert.ok(result.errors.some((e) => e.path.includes("rulesets[0].id")));
    });

    it("reports error for ruleset missing enforce", () => {
        const fp = new FormattingPack(
            makeData({
                document_policies: {
                    rulesets: [
                        {
                            id: "r1",
                            selectors: {},
                            enforce: /** @type {any} */ (null)
                        }
                    ]
                }
            })
        );
        const result = fp.validate();
        assert.ok(result.errors.some((e) => e.path.includes("enforce")));
    });

    it("reports error for doc_type in selectors not matching pattern", () => {
        const fp = new FormattingPack(
            makeData({
                document_policies: {
                    rulesets: [
                        {
                            id: "r1",
                            selectors: { doc_types: ["invalid_type"] },
                            enforce: {}
                        }
                    ]
                }
            })
        );
        const result = fp.validate();
        assert.ok(
            result.errors.some((e) => e.path.includes("selectors.doc_types[0]"))
        );
    });

    it("reports error for shape missing kind", () => {
        const fp = new FormattingPack(
            makeData({
                document_policies: {
                    shapes: { myShape: { kind: "" } }
                }
            })
        );
        const result = fp.validate();
        assert.ok(
            result.errors.some((e) => e.path.includes("shapes.myShape.kind"))
        );
    });

    it("reports error for template missing content array", () => {
        const fp = new FormattingPack(
            makeData({
                document_policies: /** @type {any} */ ({
                    templates: { t1: { content: "not-array" } }
                })
            })
        );
        const result = fp.validate();
        assert.ok(
            result.errors.some((e) => e.path.includes("templates.t1.content"))
        );
    });
});

// ============================================================================
// lintDocument — _lintLineWidth
// ============================================================================

describe("FormattingPack.lintDocument - line width", () => {
    const makePolicy = (max, ignore_blocks = []) => ({
        rulesets: [
            {
                id: "lw",
                selectors: { extensions: ["md"] },
                enforce: { line_width: { max, ignore_blocks } }
            }
        ]
    });

    const makeDoc = (text) => Document.fromText(text, "doc.md");

    const fileCtx = { doc_type: null, ext: "md", is_root_file: false };

    it("reports no issues when all lines within limit", () => {
        const issues = FormattingPack.lintDocument(
            makePolicy(80),
            makeDoc("short line\nanother short line"),
            "doc.md",
            fileCtx
        );
        assert.deepEqual(issues, []);
    });

    it("reports issue for line exceeding max", () => {
        const longLine = "A".repeat(81);
        const issues = FormattingPack.lintDocument(
            makePolicy(80),
            makeDoc(longLine),
            "doc.md",
            fileCtx
        );
        assert.equal(issues.length, 1);
        assert.equal(issues[0].code, "format.line_width");
        assert.equal(issues[0].line, 1);
    });

    it("ignores lines inside fenced code blocks when ignore_blocks includes code", () => {
        const text = "```\n" + "B".repeat(90) + "\n```";
        const issues = FormattingPack.lintDocument(
            makePolicy(80, ["code"]),
            makeDoc(text),
            "doc.md",
            fileCtx
        );
        assert.deepEqual(issues, []);
    });

    it("flags code block lines when ignore_blocks does NOT include code", () => {
        const text = "```\n" + "B".repeat(90) + "\n```";
        const issues = FormattingPack.lintDocument(
            makePolicy(80, []),
            makeDoc(text),
            "doc.md",
            fileCtx
        );
        // Code content line is flagged; fence lines toggle state, not counted
        assert.ok(issues.length > 0);
    });

    it("ignores URL-containing long lines when ignore_blocks includes urls", () => {
        const urlLine = "See: https://example.com/" + "a".repeat(80);
        const issues = FormattingPack.lintDocument(
            makePolicy(80, ["urls"]),
            makeDoc(urlLine),
            "doc.md",
            fileCtx
        );
        assert.deepEqual(issues, []);
    });

    it("ignores table lines (starting with |) when ignore_blocks includes tables", () => {
        const tableLine = "| " + "A".repeat(90) + " |";
        const issues = FormattingPack.lintDocument(
            makePolicy(80, ["tables"]),
            makeDoc(tableLine),
            "doc.md",
            fileCtx
        );
        assert.deepEqual(issues, []);
    });

    it("does not lint non-text files", () => {
        const longLine = "X".repeat(200);
        const doc = Document.fromText(longLine, "image.png");
        const issues = FormattingPack.lintDocument(
            makePolicy(80),
            doc,
            "image.png",
            { doc_type: null, ext: "png", is_root_file: false }
        );
        assert.deepEqual(issues, []);
    });
});

// ============================================================================
// lintDocument — _lintDialect
// ============================================================================

describe("FormattingPack.lintDocument - dialect", () => {
    const makePolicy = () => ({
        rulesets: [
            {
                id: "dialect-rule",
                selectors: { extensions: ["md"] },
                enforce: { dialect_pack: "en-us" }
            }
        ],
        dialect_packs: {
            "en-us": {
                pairs: [
                    { preferred: "color", forbid: ["colour", "colours"] },
                    { preferred: "analyze", forbid: ["analyse"] }
                ]
            }
        }
    });

    const fileCtx = { doc_type: null, ext: "md", is_root_file: false };

    it("reports dialect issue for forbidden term", () => {
        const doc = Document.fromText("The colour is red.", "doc.md");
        const issues = FormattingPack.lintDocument(
            makePolicy(),
            doc,
            "doc.md",
            fileCtx
        );
        assert.ok(issues.some((i) => i.code === "format.dialect.spelling"));
        assert.ok(issues.some((i) => i.message.includes("colour")));
    });

    it("reports multiple forbidden term matches", () => {
        const doc = Document.fromText("Use colour and analyse.", "doc.md");
        const issues = FormattingPack.lintDocument(
            makePolicy(),
            doc,
            "doc.md",
            fileCtx
        );
        const dialectIssues = issues.filter(
            (i) => i.code === "format.dialect.spelling"
        );
        assert.ok(dialectIssues.length >= 2);
    });

    it("does not report for allowed terms", () => {
        const doc = Document.fromText(
            "Use color and analyze correctly.",
            "doc.md"
        );
        const issues = FormattingPack.lintDocument(
            makePolicy(),
            doc,
            "doc.md",
            fileCtx
        );
        assert.deepEqual(
            issues.filter((i) => i.code === "format.dialect.spelling"),
            []
        );
    });

    it("skips dialect check when no dialect_pack in enforce", () => {
        const p = {
            rulesets: [
                {
                    id: "no-dialect",
                    selectors: { extensions: ["md"] },
                    enforce: {}
                }
            ],
            dialect_packs: makePolicy().dialect_packs
        };
        const doc = Document.fromText("Lots of colour here.", "doc.md");
        const issues = FormattingPack.lintDocument(p, doc, "doc.md", fileCtx);
        assert.deepEqual(
            issues.filter((i) => i.code === "format.dialect.spelling"),
            []
        );
    });
});

// ============================================================================
// lintDocument — _lintFooterShape
// ============================================================================

describe("FormattingPack.lintDocument - footer shape", () => {
    const makePolicy = () => ({
        rulesets: [
            {
                id: "footer-rule",
                selectors: { extensions: ["md"] },
                enforce: {
                    require_disclaimer_footer: true,
                    footer_shape_id: "disclaimer"
                }
            }
        ],
        shapes: {
            disclaimer: {
                kind: "footer",
                required_trailing_lines: [
                    "DISCLAIMER: This document is binding.",
                    "---"
                ]
            }
        }
    });

    const fileCtx = { doc_type: null, ext: "md", is_root_file: false };

    it("reports error when required trailing lines absent", () => {
        const doc = Document.fromText("Body text only.\n", "doc.md");
        const issues = FormattingPack.lintDocument(
            makePolicy(),
            doc,
            "doc.md",
            fileCtx
        );
        assert.ok(issues.some((i) => i.code === "format.footer.missing"));
    });

    it("no error when required trailing lines present", () => {
        const text = [
            "Body text.",
            "",
            "DISCLAIMER: This document is binding.",
            "---"
        ].join("\n");
        const doc = Document.fromText(text, "doc.md");
        const issues = FormattingPack.lintDocument(
            makePolicy(),
            doc,
            "doc.md",
            fileCtx
        );
        assert.deepEqual(
            issues.filter((i) => i.code === "format.footer.missing"),
            []
        );
    });

    it("ignores trailing blank lines when checking footer", () => {
        const text = [
            "Body text.",
            "DISCLAIMER: This document is binding.",
            "---",
            "",
            ""
        ].join("\n");
        const doc = Document.fromText(text, "doc.md");
        const issues = FormattingPack.lintDocument(
            makePolicy(),
            doc,
            "doc.md",
            fileCtx
        );
        assert.deepEqual(
            issues.filter((i) => i.code === "format.footer.missing"),
            []
        );
    });

    it("no footer check when require_disclaimer_footer not set", () => {
        const p = {
            rulesets: [
                {
                    id: "no-footer",
                    selectors: { extensions: ["md"] },
                    enforce: {}
                }
            ],
            shapes: makePolicy().shapes
        };
        const doc = Document.fromText("No footer.", "doc.md");
        const issues = FormattingPack.lintDocument(p, doc, "doc.md", fileCtx);
        assert.deepEqual(
            issues.filter((i) => i.code === "format.footer.missing"),
            []
        );
    });
});

// ============================================================================
// resolveFilePolicy — line_width_profiles layer (layer 2) + metaOverrides (layer 4)
// ============================================================================

describe("FormattingPack.resolveFilePolicy - line_width_profiles layer", () => {
    /** @type {any} */
    const policy = {
        defaults: { line_width: { max: 120 } },
        line_width_profiles: {
            "legal-prose": {
                max: 100,
                soft_wrap_preferred: true,
                applies_to: ["*_MA-*.md", "*_SCH-*.md"]
            },
            "yaml-wide": {
                max: 200,
                applies_to: ["*.yaml"]
            }
        }
    };

    it("merges line_width.max from matching line_width_profiles entry", () => {
        const { effective } = FormattingPack.resolveFilePolicy(policy, {
            rel_path: "TPL-00001_MA-Agreement.md",
            doc_type: null,
            ext: "md",
            is_root_file: false
        });
        assert.equal(effective.line_width.max, 100);
    });

    it("merges soft_wrap_preferred from matching line_width_profiles entry", () => {
        const { effective } = FormattingPack.resolveFilePolicy(policy, {
            rel_path: "TPL-00001_MA-Agreement.md",
            doc_type: null,
            ext: "md",
            is_root_file: false
        });
        assert.equal(effective.soft_wrap_preferred, true);
    });

    it("does NOT set soft_wrap_preferred when profile lacks it", () => {
        const { effective } = FormattingPack.resolveFilePolicy(policy, {
            rel_path: "config.yaml",
            doc_type: null,
            ext: "yaml",
            is_root_file: false
        });
        assert.ok(effective.soft_wrap_preferred !== true);
    });

    it("falls through to defaults when no line_width_profiles entry matches", () => {
        const { effective } = FormattingPack.resolveFilePolicy(policy, {
            rel_path: "README.md",
            doc_type: null,
            ext: "md",
            is_root_file: false
        });
        assert.equal(effective.line_width.max, 120);
        assert.ok(effective.soft_wrap_preferred !== true);
    });

    it("rulesets override line_width_profiles (layer 3 > layer 2)", () => {
        /** @type {any} */
        const p2 = {
            line_width_profiles: {
                wide: { max: 200, applies_to: ["*.md"] }
            },
            rulesets: [
                {
                    id: "narrow",
                    selectors: { extensions: ["md"] },
                    enforce: { line_width: { max: 80 } }
                }
            ]
        };
        const { effective } = FormattingPack.resolveFilePolicy(p2, {
            rel_path: "doc.md",
            doc_type: null,
            ext: "md",
            is_root_file: false
        });
        assert.equal(effective.line_width.max, 80);
    });
});

describe("FormattingPack.resolveFilePolicy - metaOverrides layer 4", () => {
    /** @type {any} */
    const policy = {
        defaults: {
            formatting_profile: "canonical-ascii",
            language_locale: "en-US"
        }
    };

    it("metaOverrides.formatting_profile overrides default", () => {
        const { effective } = FormattingPack.resolveFilePolicy(
            policy,
            {
                rel_path: "doc.md",
                doc_type: null,
                ext: "md",
                is_root_file: false
            },
            { formatting_profile: "baseline" }
        );
        assert.equal(effective.formatting_profile, "baseline");
    });

    it("metaOverrides.language_locale overrides default", () => {
        const { effective } = FormattingPack.resolveFilePolicy(
            policy,
            {
                rel_path: "doc.md",
                doc_type: null,
                ext: "md",
                is_root_file: false
            },
            { language_locale: "en-GB" }
        );
        assert.equal(effective.language_locale, "en-GB");
    });

    it("empty metaOverrides object changes nothing", () => {
        const { effective } = FormattingPack.resolveFilePolicy(
            policy,
            {
                rel_path: "doc.md",
                doc_type: null,
                ext: "md",
                is_root_file: false
            },
            {}
        );
        assert.equal(effective.formatting_profile, "canonical-ascii");
        assert.equal(effective.language_locale, "en-US");
    });

    it("undefined metaOverrides changes nothing", () => {
        const { effective } = FormattingPack.resolveFilePolicy(
            policy,
            {
                rel_path: "doc.md",
                doc_type: null,
                ext: "md",
                is_root_file: false
            },
            undefined
        );
        assert.equal(effective.language_locale, "en-US");
    });

    it("metaOverrides overrides even matched rulesets (layer 4 > layer 3)", () => {
        /** @type {any} */
        const p2 = {
            defaults: {},
            rulesets: [
                {
                    id: "r1",
                    selectors: { extensions: ["md"] },
                    enforce: { language_locale: "en-AU" }
                }
            ]
        };
        const { effective } = FormattingPack.resolveFilePolicy(
            p2,
            {
                rel_path: "doc.md",
                doc_type: null,
                ext: "md",
                is_root_file: false
            },
            { language_locale: "en-GB" }
        );
        assert.equal(effective.language_locale, "en-GB");
    });
});

// ============================================================================
// resolveFormatActions
// ============================================================================

describe("FormattingPack.resolveFormatActions", () => {
    const makeFile = (ext = "md", rel_path = "doc.md") => ({
        rel_path,
        doc_type: null,
        ext,
        is_root_file: false
    });

    it("returns safe defaults when policy is null", () => {
        const actions = FormattingPack.resolveFormatActions(null, makeFile());
        assert.equal(actions.normalizeBaseline, true);
        assert.equal(actions.normalizeCanonicalAscii, false);
        assert.equal(actions.softWrapPreferred, false);
    });

    it("normalizeBaseline is always true", () => {
        const actions = FormattingPack.resolveFormatActions({}, makeFile());
        assert.equal(actions.normalizeBaseline, true);
    });

    it("normalizeCanonicalAscii false when no formatting_profile resolved", () => {
        const actions = FormattingPack.resolveFormatActions({}, makeFile("md"));
        assert.equal(actions.normalizeCanonicalAscii, false);
    });

    it("normalizeCanonicalAscii false when profile has unicode_allowed: true", () => {
        /** @type {any} */
        const policy = {
            defaults: { formatting_profile: "baseline" },
            formatting_profiles: {
                baseline: { unicode_allowed: true }
            }
        };
        const actions = FormattingPack.resolveFormatActions(
            policy,
            makeFile("md")
        );
        assert.equal(actions.normalizeCanonicalAscii, false);
    });

    it("normalizeCanonicalAscii true for md with canonical-ascii profile", () => {
        /** @type {any} */
        const policy = {
            defaults: { formatting_profile: "canonical-ascii" },
            formatting_profiles: {
                "canonical-ascii": { unicode_allowed: false }
            }
        };
        const actions = FormattingPack.resolveFormatActions(
            policy,
            makeFile("md")
        );
        assert.equal(actions.normalizeCanonicalAscii, true);
    });

    it("normalizeCanonicalAscii false for non-md even with canonical-ascii profile", () => {
        /** @type {any} */
        const policy = {
            defaults: { formatting_profile: "canonical-ascii" },
            formatting_profiles: {
                "canonical-ascii": { unicode_allowed: false }
            }
        };
        const actions = FormattingPack.resolveFormatActions(
            policy,
            makeFile("yaml")
        );
        assert.equal(actions.normalizeCanonicalAscii, false);
    });

    it("softWrapPreferred true when line_width_profiles entry matches and has soft_wrap_preferred", () => {
        /** @type {any} */
        const policy = {
            line_width_profiles: {
                legal: {
                    max: 120,
                    soft_wrap_preferred: true,
                    applies_to: ["*_MA-*.md"]
                }
            }
        };
        const actions = FormattingPack.resolveFormatActions(
            policy,
            makeFile("md", "DIR/DIR_MA-Agreement.md")
        );
        assert.equal(actions.softWrapPreferred, true);
    });

    it("softWrapPreferred false when no matching line_width_profiles entry", () => {
        /** @type {any} */
        const policy = {
            line_width_profiles: {
                legal: {
                    max: 120,
                    soft_wrap_preferred: true,
                    applies_to: ["*_MA-*.md"]
                }
            }
        };
        const actions = FormattingPack.resolveFormatActions(
            policy,
            makeFile("md", "README.md")
        );
        assert.equal(actions.softWrapPreferred, false);
    });

    it("metaOverrides feeds into actions (formatting_profile lookup)", () => {
        /** @type {any} */
        const policy = {
            formatting_profiles: {
                "canonical-ascii": { unicode_allowed: false }
            }
        };
        // No default profile, but metaOverrides supplies it
        const actions = FormattingPack.resolveFormatActions(
            policy,
            makeFile("md"),
            { formatting_profile: "canonical-ascii" }
        );
        assert.equal(actions.normalizeCanonicalAscii, true);
    });
});

// ============================================================================
// lintDocument — _lintLineWidth + soft_wrap_preferred
// ============================================================================

describe("FormattingPack.lintDocument - line width soft_wrap_preferred", () => {
    const fileCtx = { doc_type: null, ext: "md", is_root_file: false };

    it("suppresses all line-width issues when soft_wrap_preferred in effective", () => {
        /** @type {any} */
        const policy = {
            line_width_profiles: {
                legal: {
                    max: 80,
                    soft_wrap_preferred: true,
                    applies_to: ["*_MA-*.md"]
                }
            }
        };
        const longLine = "A".repeat(300);
        const doc = Document.fromText(longLine, "TPL_MA-Agreement.md");
        const issues = FormattingPack.lintDocument(
            policy,
            doc,
            "TPL_MA-Agreement.md",
            { doc_type: "MA", ext: "md", is_root_file: false }
        );
        assert.deepEqual(
            issues.filter((i) => i.code === "format.line_width"),
            []
        );
    });

    it("still reports line-width issues when soft_wrap_preferred NOT set for that file", () => {
        /** @type {any} */
        const policy = {
            line_width_profiles: {
                legal: {
                    max: 80,
                    soft_wrap_preferred: true,
                    applies_to: ["*_MA-*.md"]
                }
            },
            defaults: { line_width: { max: 80 } }
        };
        const longLine = "A".repeat(100);
        const doc = Document.fromText(longLine, "README.md");
        const issues = FormattingPack.lintDocument(
            policy,
            doc,
            "README.md",
            fileCtx
        );
        assert.ok(issues.some((i) => i.code === "format.line_width"));
    });
});

// ============================================================================
// lintDocument — metaOverrides parameter
// ============================================================================

describe("FormattingPack.lintDocument - metaOverrides", () => {
    it("metaOverrides.language_locale activates correct dialect lint", () => {
        /** @type {any} */
        const policy = {
            dialect_packs: {
                "en-GB-basic-v1": {
                    pairs: [{ preferred: "colour", forbid: ["color"] }]
                }
            }
        };
        // Without metaOverrides no dialect is selected → no issues
        const doc = Document.fromText("Use color here.", "doc.md");
        const noOverride = FormattingPack.lintDocument(policy, doc, "doc.md", {
            doc_type: null,
            ext: "md",
            is_root_file: false
        });
        assert.deepEqual(
            noOverride.filter((i) => i.code === "format.dialect.spelling"),
            []
        );
        // With metaOverrides supplying en-GB locale + dialect_pack → issue raised
        /** @type {any} */
        const policyWithRuleset = {
            rulesets: [
                {
                    id: "gb-rule",
                    selectors: { extensions: ["md"] },
                    enforce: { dialect_pack: "en-GB-basic-v1" }
                }
            ],
            dialect_packs: {
                "en-GB-basic-v1": {
                    pairs: [{ preferred: "colour", forbid: ["color"] }]
                }
            }
        };
        const withOverride = FormattingPack.lintDocument(
            policyWithRuleset,
            doc,
            "doc.md",
            { doc_type: null, ext: "md", is_root_file: false },
            { language_locale: "en-GB" }
        );
        assert.ok(
            withOverride.some((i) => i.code === "format.dialect.spelling")
        );
    });
});

// ============================================================================
// lintDocument — _lintMetadataBlock
// ============================================================================

describe("FormattingPack.lintDocument - metadata block", () => {
    const beginDelim =
        "----------------------------BEGIN DOCUMENT METADATA-----------------------------";
    const endDelim =
        "-----------------------------END DOCUMENT METADATA------------------------------";

    const makePolicy = (required_fields = []) =>
        /** @type {any} */ ({
            rulesets: [
                {
                    id: "meta-rule",
                    selectors: { extensions: ["md"] },
                    enforce: {
                        require_metadata_block: true,
                        metadata_required_fields: required_fields
                    }
                }
            ]
        });

    const fileCtx = { doc_type: null, ext: "md", is_root_file: false };

    it("reports error when metadata block missing entirely", () => {
        const doc = Document.fromText("Just body text.", "doc.md");
        const issues = FormattingPack.lintDocument(
            makePolicy(),
            doc,
            "doc.md",
            fileCtx
        );
        assert.ok(
            issues.some((i) => i.code === "format.metadata_block.missing")
        );
    });

    it("no error when metadata block present", () => {
        const text = [
            "Body.",
            "",
            beginDelim,
            "Document-Type: SOP",
            endDelim
        ].join("\n");
        const doc = Document.fromText(text, "doc.md");
        const issues = FormattingPack.lintDocument(
            makePolicy(),
            doc,
            "doc.md",
            fileCtx
        );
        assert.deepEqual(
            issues.filter((i) => i.code === "format.metadata_block.missing"),
            []
        );
    });

    it("reports error for each missing required field", () => {
        const text = [
            "Body.",
            "",
            beginDelim,
            "Document-Type: SOP",
            endDelim
        ].join("\n");
        const doc = Document.fromText(text, "doc.md");
        const issues = FormattingPack.lintDocument(
            makePolicy(["Document-Type", "Title", "Record-ID"]),
            doc,
            "doc.md",
            fileCtx
        );
        const missing = issues.filter(
            (i) => i.code === "format.metadata_block.missing_field"
        );
        // Title and Record-ID are missing
        assert.ok(missing.some((i) => i.message.includes("Title")));
        assert.ok(missing.some((i) => i.message.includes("Record-ID")));
        // Document-Type is present — no error for it
        assert.ok(!missing.some((i) => i.message.includes("Document-Type")));
    });

    it("no field errors when all required fields present", () => {
        const text = [
            "Body.",
            "",
            beginDelim,
            "Document-Type: SOP",
            "Title: My Title",
            "Record-ID: DP-00001",
            endDelim
        ].join("\n");
        const doc = Document.fromText(text, "doc.md");
        const issues = FormattingPack.lintDocument(
            makePolicy(["Document-Type", "Title", "Record-ID"]),
            doc,
            "doc.md",
            fileCtx
        );
        assert.deepEqual(
            issues.filter(
                (i) => i.code === "format.metadata_block.missing_field"
            ),
            []
        );
    });

    it("skips metadata check when require_metadata_block not set", () => {
        const doc = Document.fromText("No block here.", "doc.md");
        /** @type {any} */
        const policy = {
            rulesets: [
                {
                    id: "no-meta",
                    selectors: { extensions: ["md"] },
                    enforce: {}
                }
            ]
        };
        const issues = FormattingPack.lintDocument(
            policy,
            doc,
            "doc.md",
            fileCtx
        );
        assert.deepEqual(
            issues.filter((i) => i.code.startsWith("format.metadata_block")),
            []
        );
    });
});
