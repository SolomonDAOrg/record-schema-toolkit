// @ts-check

/**
 * Unit tests for the RenderPack class.
 *
 * Covers: construction, empty(), load/loadIfExists, basic accessors,
 * document-policy accessors, resolvePackEntries (all branches),
 * resolveRenderProfile (flat / inheritance / missing parent),
 * getEffectiveTargetConfig, resolveFilePolicy, extractEntityName,
 * resolveDocumentKind, deriveDocumentName, resolveCoverConfig,
 * resolveSigningConfig, getResolvedPacketConfig, validate().
 *
 * @module tests/classes/RenderPack_test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RenderPack } from "../../lib/record-schema/RenderPack.mjs";

// ============================================================================
// Helpers
// ============================================================================

/**
 * @returns {{ dir: string, write: (name: string, data: unknown) => string, cleanup: () => void }}
 */
function makeTmpDir() {
    const dir = join(
        tmpdir(),
        "rp-test-" + Math.random().toString(36).slice(2)
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

const EMPTY = RenderPack.empty("base-pack");
const SCHEMA_NAME = EMPTY.getSchema();
const SCHEMA_VERSION = EMPTY.getSchemaVersion();

describe("RenderPack - letterhead assets", () => {
    it("resolves profile and ruleset artwork relative to the pack without mutating its source", () => {
        const composition = {mode:"fixed",regions:[{source_heading:"Issuer",x:40,top:40,width:300,height:80,font_size:12}],letterhead_logo:{path:"../assets/company.svg",x:40,top:40,width:50,height:50,shift_source_headings:["Issuer"]}};
        const data = makeData({document_policies:{
            targets:{pdf:{format:"pdf",page_composition:composition}},
            render_profiles:{certificate:{target:"pdf"}},
            defaults:{render_profile_id:"certificate",page_composition:{letterhead_logo:{path:"../assets/override.svg"}}}
        }});
        const pack = new RenderPack(data,"/records/example/render/packs/company.json");
        const file = {rel_path:"certificate.md",doc_type:"DOC",ext:"md"};
        assert.equal(pack.getEffectiveTargetConfig("certificate").target.page_composition.letterhead_logo.path,"/records/example/render/assets/company.svg");
        assert.equal(pack.resolveForFile(file).page_composition.letterhead_logo.path,"/records/example/render/assets/override.svg");
        assert.equal(pack.resolveForFile({...file,render_profile_id:"certificate"}).page_composition.letterhead_logo.path,"/records/example/render/assets/company.svg");
        assert.equal(data.document_policies.targets.pdf.page_composition.letterhead_logo.path,"../assets/company.svg");
        assert.equal(data.document_policies.defaults.page_composition.letterhead_logo.path,"../assets/override.svg");
        const noProfile = new RenderPack(makeData({document_policies:{defaults:{page_composition:composition}}}),"/records/example/render/packs/company.json");
        assert.equal(noProfile.resolveForFile(file).page_composition.letterhead_logo.path,"/records/example/render/assets/company.svg");
    });
});

describe("RenderPack - merged asset paths", () => {
    it("retains each pack's font and artwork directory through both merge entry points", () => {
        const temporary = makeTmpDir();
        try {
            mkdirSync(join(temporary.dir, "base"));
            mkdirSync(join(temporary.dir, "extension"));
            const base = makeData({document_policies:{targets:{pdf:{format:"pdf",embedded_fonts:{
                resolve_relative_to:"pack",families:{Body:{faces:{regular:{path:"fonts/body.ttf"}}}}
            }}},render_profiles:{report:{target:"pdf"}}}});
            const extension = makeData({pack_id:"extension-pack",document_policies:{render_profiles:{letter:{target:"pdf",overrides:{
                embedded_fonts:{resolve_relative_to:"pack",families:{Heading:{faces:{regular:{path:"fonts/heading.ttf"}}}}},
                page_composition:{letterhead_logo:{path:"artwork/logo.svg",width:40,height:40}}
            }}}}});
            const paths = [temporary.write("base/pack.json",base),temporary.write("extension/pack.json",extension)];
            const packs = paths.map(file => RenderPack.load(file));
            for (const merged of [RenderPack.mergePacks(packs),RenderPack.loadMerged(temporary.dir,paths)]) {
                const configuration = merged.pack.getEffectiveTargetConfig("letter").target;
                const families = /** @type {Record<string, {faces: {regular: {path: string}}}>} */ (configuration.embedded_fonts.families);
                assert.equal(families.Body.faces.regular.path,join(temporary.dir,"base/fonts/body.ttf"));
                assert.equal(families.Heading.faces.regular.path,join(temporary.dir,"extension/fonts/heading.ttf"));
                assert.equal(configuration.page_composition.letterhead_logo.path,join(temporary.dir,"extension/artwork/logo.svg"));
            }
            assert.deepEqual(packs[0].getDocumentPolicies(),base.document_policies);
            assert.deepEqual(packs[1].getDocumentPolicies(),extension.document_policies);
        } finally {
            temporary.cleanup();
        }
    });
});

/**
 * Minimal valid pack data.
 * @param {object} [overrides]
 * @returns {any}
 */
function makeData(overrides = {}) {
    return {
        schema: SCHEMA_NAME,
        schema_version: SCHEMA_VERSION,
        pack_id: "base-pack",
        document_policies: {},
        ...overrides
    };
}

// ============================================================================
// Construction
// ============================================================================

describe("RenderPack - construction", () => {
    it("stores data and defaults source_path to null", () => {
        const rp = new RenderPack(makeData());
        assert.equal(rp.source_path, null);
        assert.equal(rp.getId(), "base-pack");
    });

    it("stores provided source_path", () => {
        const rp = new RenderPack(makeData(), "/some/pack.json");
        assert.equal(rp.source_path, "/some/pack.json");
    });
});

// ============================================================================
// empty()
// ============================================================================

describe("RenderPack.empty", () => {
    it("returns RenderPack with given pack_id", () => {
        const rp = RenderPack.empty("my-pack");
        assert.ok(rp instanceof RenderPack);
        assert.equal(rp.getId(), "my-pack");
    });

    it("has correct schema name and positive version", () => {
        const rp = RenderPack.empty("x-pack");
        assert.equal(typeof rp.getSchema(), "string");
        assert.ok(rp.getSchema().length > 0);
        assert.ok(rp.getSchemaVersion() >= 1);
    });

    it("has empty document_policies", () => {
        assert.deepEqual(RenderPack.empty("x-pack").getDocumentPolicies(), {});
    });
});

// ============================================================================
// load / loadIfExists
// ============================================================================

describe("RenderPack.load / loadIfExists", () => {
    it("load reads and parses JSON file", () => {
        const tmp = makeTmpDir();
        const p = tmp.write("pack.json", makeData({ pack_id: "loaded-pack" }));
        const rp = RenderPack.load(p);
        assert.equal(rp.getId(), "loaded-pack");
        assert.equal(rp.source_path, p);
        tmp.cleanup();
    });

    it("load throws on missing file", () => {
        assert.throws(() => RenderPack.load("/no/such/pack.json"));
    });

    it("loadIfExists returns RenderPack for existing file", () => {
        const tmp = makeTmpDir();
        const p = tmp.write("pack.json", makeData());
        const rp = RenderPack.loadIfExists(p);
        assert.ok(rp instanceof RenderPack);
        tmp.cleanup();
    });

    it("loadIfExists returns null for missing file", () => {
        assert.equal(RenderPack.loadIfExists("/no/such/pack.json"), null);
    });
});

// ============================================================================
// Basic accessors
// ============================================================================

describe("RenderPack - basic accessors", () => {
    it("getId returns pack_id", () => {
        assert.equal(
            new RenderPack(makeData({ pack_id: "core-pack" })).getId(),
            "core-pack"
        );
    });

    it("getDescription returns description when present", () => {
        const rp = new RenderPack(makeData({ description: "Test pack" }));
        assert.equal(rp.getDescription(), "Test pack");
    });

    it("getDescription returns undefined when absent", () => {
        assert.equal(RenderPack.empty("x-pack").getDescription(), undefined);
    });

    it("getImports returns empty array when absent", () => {
        assert.deepEqual(RenderPack.empty("x-pack").getImports(), []);
    });

    it("getImports returns array when present", () => {
        const rp = new RenderPack(makeData({ imports: ["base.json"] }));
        assert.deepEqual(rp.getImports(), ["base.json"]);
    });

    it("hasImports false when no imports", () => {
        assert.equal(RenderPack.empty("x-pack").hasImports(), false);
    });

    it("hasImports true when imports present", () => {
        assert.equal(
            new RenderPack(makeData({ imports: ["a.json"] })).hasImports(),
            true
        );
    });

    it("getPacketConfig returns null when absent", () => {
        assert.equal(RenderPack.empty("x-pack").getPacketConfig(), null);
    });

    it("getPacketConfig returns object when present", () => {
        const rp = new RenderPack(
            makeData({ packet_config: { default_entity_name: "ACME" } })
        );
        assert.ok(rp.getPacketConfig() !== null);
        assert.equal(rp.getPacketConfig().default_entity_name, "ACME");
    });
});

// ============================================================================
// Document policy accessors
// ============================================================================

describe("RenderPack - document policy accessors", () => {
    const rp = new RenderPack(
        makeData({
            document_policies: {
                precedence_notes: "Last wins.",
                defaults: { render_profile_id: "default" },
                rulesets: [
                    {
                        id: "md-rule",
                        selectors: { extensions: ["md"] },
                        render: { render_profile_id: "markdown" }
                    }
                ],
                targets: {
                    pdf: { format: "pdf" }
                },
                render_profiles: {
                    markdown: { target: "pdf" },
                    report: { target: "pdf", extends: "markdown" }
                }
            }
        })
    );

    it("getDocumentPolicies returns the policies object", () => {
        assert.ok(typeof rp.getDocumentPolicies() === "object");
    });

    it("getDefaults returns defaults", () => {
        assert.deepEqual(rp.getDefaults(), { render_profile_id: "default" });
    });

    it("getDefaults returns empty object when absent", () => {
        assert.deepEqual(RenderPack.empty("x-pack").getDefaults(), {});
    });

    it("getPrecedenceNotes returns note string", () => {
        assert.equal(rp.getPrecedenceNotes(), "Last wins.");
    });

    it("getPrecedenceNotes returns undefined when absent", () => {
        assert.equal(
            RenderPack.empty("x-pack").getPrecedenceNotes(),
            undefined
        );
    });

    it("getRulesets returns array", () => {
        assert.equal(rp.getRulesets().length, 1);
    });

    it("getRuleset finds by id", () => {
        const r = rp.getRuleset("md-rule");
        assert.ok(r !== undefined);
        assert.equal(r.id, "md-rule");
    });

    it("getRuleset returns undefined for unknown id", () => {
        assert.equal(rp.getRuleset("nonexistent"), undefined);
    });

    it("getTargets returns targets map", () => {
        assert.ok("pdf" in rp.getTargets());
    });

    it("getTarget returns target by id", () => {
        assert.ok(rp.getTarget("pdf") !== undefined);
    });

    it("getTarget returns undefined for unknown id", () => {
        assert.equal(rp.getTarget("missing"), undefined);
    });

    it("getRenderProfiles returns profiles map", () => {
        assert.ok("markdown" in rp.getRenderProfiles());
    });

    it("getRenderProfile returns profile by id", () => {
        assert.ok(rp.getRenderProfile("markdown") !== undefined);
    });

    it("getRenderProfile returns undefined for unknown id", () => {
        assert.equal(rp.getRenderProfile("missing"), undefined);
    });
});

// ============================================================================
// resolveRenderProfile (inheritance)
// ============================================================================

describe("RenderPack - resolveRenderProfile", () => {
    const rp = new RenderPack(
        makeData({
            document_policies: {
                targets: { pdf: { format: "pdf", margins: { top: 72 } } },
                render_profiles: {
                    base: {
                        target: "pdf",
                        overrides: { margins: { top: 36 } }
                    },
                    child: {
                        extends: "base",
                        target: "pdf",
                        overrides: { margins: { bottom: 36 } }
                    },
                    orphan: {
                        extends: "nonexistent",
                        target: "pdf"
                    }
                }
            }
        })
    );

    it("returns profile as-is when no extends", () => {
        const p = rp.resolveRenderProfile("base");
        assert.ok(p !== null);
        assert.equal(p.target, "pdf");
    });

    it("returns null for unknown profile id", () => {
        assert.equal(rp.resolveRenderProfile("missing"), null);
    });

    it("merges child overrides with parent overrides", () => {
        const p = rp.resolveRenderProfile("child");
        assert.ok(p !== null);
        // child.overrides should be merged with base.overrides; both set margins
        assert.ok(p.overrides !== undefined);
        assert.ok("margins" in p.overrides);
    });

    it("rejects a missing parent profile", () => {
        assert.throws(() => rp.resolveRenderProfile("orphan"), /Unknown parent render profile/);
    });
});

// ============================================================================
// getEffectiveTargetConfig
// ============================================================================

describe("RenderPack - getEffectiveTargetConfig", () => {
    const rp = new RenderPack(
        makeData({
            document_policies: {
                targets: {
                    pdf: { format: "pdf", font_size: 12 }
                },
                render_profiles: {
                    default: { target: "pdf" },
                    custom: {
                        target: "pdf",
                        overrides: { font_size: 10 }
                    },
                    no_target: {}
                }
            }
        })
    );

    it("returns target and profile for valid profile", () => {
        const result = rp.getEffectiveTargetConfig("default");
        assert.ok(result !== null);
        assert.equal(result.target.format, "pdf");
    });

    it("applies profile overrides onto target", () => {
        const result = rp.getEffectiveTargetConfig("custom");
        assert.ok(result !== null);
        assert.equal(/** @type {any} */ (result.target).font_size, 10);
    });

    it("returns null when profile has no target", () => {
        assert.equal(rp.getEffectiveTargetConfig("no_target"), null);
    });

    it("returns null for unknown profile id", () => {
        assert.equal(rp.getEffectiveTargetConfig("missing"), null);
    });
});

// ============================================================================
// Static entry helpers
// ============================================================================

describe("RenderPack - static entry helpers", () => {
    it("getEntryPath delegates correctly", () => {
        assert.equal(RenderPack.getEntryPath("file.md"), "file.md");
        assert.equal(RenderPack.getEntryPath({ path: "file.md" }), "file.md");
        assert.equal(RenderPack.getEntryPath(null), null);
    });

    it("shouldIncludeEntry delegates correctly", () => {
        assert.equal(RenderPack.shouldIncludeEntry("file.md"), true);
        assert.equal(RenderPack.shouldIncludeEntry({ include: false }), false);
    });

    it("getEntryPrecedence delegates correctly", () => {
        assert.equal(RenderPack.getEntryPrecedence({ precedence: 5 }, 0), 5);
        assert.equal(RenderPack.getEntryPrecedence("file.md", 3), 30);
    });
});

// ============================================================================
// resolveFilePolicy
// ============================================================================

describe("RenderPack.resolveFilePolicy", () => {
    const makeFile = (overrides = {}) => ({
        rel_path: "docs/file.md",
        doc_type: null,
        ext: "md",
        is_root_file: false,
        ...overrides
    });

    const policy = {
        defaults: { render_profile_id: "default" },
        rulesets: [
            {
                id: "md-rule",
                selectors: { extensions: ["md"] },
                render: { render_profile_id: "markdown" },
                severity: "warn"
            },
            {
                id: "root-rule",
                selectors: { is_root_file: true },
                render: { render_profile_id: "root" }
            }
        ]
    };

    it("returns defaults when no rulesets match", () => {
        const { effective, applied } = RenderPack.resolveFilePolicy(
            policy,
            makeFile({ ext: "yaml" })
        );
        assert.equal(effective.render_profile_id, "default");
        assert.equal(applied.length, 0);
    });

    it("applies matching ruleset and records in applied", () => {
        const { effective, applied } = RenderPack.resolveFilePolicy(
            policy,
            makeFile({ ext: "md" })
        );
        assert.equal(effective.render_profile_id, "markdown");
        assert.equal(applied.length, 1);
        assert.equal(applied[0].id, "md-rule");
        assert.equal(applied[0].severity, "warn");
    });

    it("applies multiple matching rulesets in order", () => {
        const { applied } = RenderPack.resolveFilePolicy(
            policy,
            makeFile({ ext: "md", is_root_file: true })
        );
        assert.equal(applied.length, 2);
    });

    it("normalises legacy profile field to render_profile_id", () => {
        const p = {
            rulesets: [
                {
                    id: "legacy",
                    selectors: { extensions: ["md"] },
                    render: { profile: "old-profile" }
                }
            ]
        };
        const { effective } = RenderPack.resolveFilePolicy(p, makeFile());
        assert.equal(effective.render_profile_id, "old-profile");
    });

    it("returns empty effective for empty policy", () => {
        const { effective, applied } = RenderPack.resolveFilePolicy(
            {},
            makeFile()
        );
        assert.deepEqual(applied, []);
        assert.ok(typeof effective === "object");
    });
});

// ============================================================================
// resolvePackEntries
// ============================================================================

describe("RenderPack - resolvePackEntries", () => {
    const rp = RenderPack.empty("x-pack");

    it("resolves from assembly.pack (string entries)", () => {
        const meta = { assembly: { pack: ["a.md", "b.md"] } };
        const result = rp.resolvePackEntries(meta);
        assert.ok(Array.isArray(result));
        assert.equal(result.length, 2);
        assert.equal(result[0].path, "a.md");
    });

    it("resolves from assembly.pack (object entries)", () => {
        const meta = {
            assembly: {
                pack: [
                    {
                        path: "doc.md",
                        doc_type: "CHA",
                        label: "Charter",
                        short_label: "CHA"
                    },
                    { path: "annex.md", precedence: 5 }
                ]
            }
        };
        const result = rp.resolvePackEntries(meta);
        assert.ok(Array.isArray(result));
        assert.equal(result[0].doc_type, "CHA");
        assert.equal(result[0].label, "Charter");
        assert.equal(result[0].short_label, "CHA");
    });

    it("skips entries with include: false", () => {
        const meta = {
            assembly: {
                pack: [{ path: "a.md", include: false }, { path: "b.md" }]
            }
        };
        const result = rp.resolvePackEntries(meta);
        assert.ok(Array.isArray(result));
        assert.equal(result.length, 1);
        assert.equal(result[0].path, "b.md");
    });

    it("skips IND entries when exclude_ind: true", () => {
        const meta = {
            assembly: {
                pack: [
                    { path: "ind.md", doc_type: "IND" },
                    { path: "main.md", doc_type: "CHA" }
                ]
            }
        };
        const result = rp.resolvePackEntries(meta, { exclude_ind: true });
        assert.ok(Array.isArray(result));
        assert.equal(result.length, 1);
        assert.equal(result[0].doc_type, "CHA");
    });

    it("sorts entries by precedence", () => {
        const meta = {
            assembly: {
                pack: [
                    { path: "b.md", precedence: 20 },
                    { path: "a.md", precedence: 10 }
                ]
            }
        };
        const result = rp.resolvePackEntries(meta);
        assert.ok(Array.isArray(result));
        assert.equal(result[0].path, "a.md");
        assert.equal(result[1].path, "b.md");
    });

    it("falls back to documents.pack when no assembly.pack", () => {
        const meta = {
            documents: { pack: ["x.md"] }
        };
        const result = rp.resolvePackEntries(meta);
        assert.ok(Array.isArray(result));
        assert.equal(result[0].path, "x.md");
    });

    it("falls back to documents.primary (string) when no pack", () => {
        const meta = { documents: { primary: "main.md" } };
        const result = rp.resolvePackEntries(meta);
        assert.ok(Array.isArray(result));
        assert.equal(result[0].path, "main.md");
    });

    it("falls back to documents.primary (array of strings)", () => {
        const meta = { documents: { primary: ["a.md", "b.md"] } };
        const result = rp.resolvePackEntries(meta);
        assert.ok(Array.isArray(result));
        assert.equal(result.length, 2);
    });

    it("falls back to documents.primary (object with path)", () => {
        const meta = {
            documents: { primary: { path: "main.md", label: "Main" } }
        };
        const result = rp.resolvePackEntries(meta);
        assert.ok(Array.isArray(result));
        assert.equal(result[0].path, "main.md");
        assert.equal(result[0].label, "Main");
    });

    it("returns error object when no documents defined", () => {
        const result = rp.resolvePackEntries({});
        assert.ok(!Array.isArray(result));
        assert.equal(result.success, false);
        assert.ok(typeof result.error === "string");
    });

    it("returns error when primary has no resolvable paths", () => {
        const meta = { documents: { primary: [] } };
        const result = rp.resolvePackEntries(meta);
        assert.ok(!Array.isArray(result));
        assert.equal(result.success, false);
    });

    it("skips non-object and non-string pack entries", () => {
        const meta = { assembly: { pack: [42, null, "valid.md"] } };
        const result = rp.resolvePackEntries(meta);
        assert.ok(Array.isArray(result));
        assert.equal(result.length, 1);
        assert.equal(result[0].path, "valid.md");
    });
});

// ============================================================================
// extractEntityName
// ============================================================================

describe("RenderPack - extractEntityName", () => {
    it("extracts from meta field declared in entity_extraction.fields", () => {
        const rp = RenderPack.empty("x-pack");
        const meta = { entity_name: "Acme Corp" };
        assert.equal(rp.extractEntityName(meta, []), "Acme Corp");
    });

    it("extracts from nested field (dot-path)", () => {
        const rp = RenderPack.empty("x-pack");
        const meta = { entity: { name: "Nested Corp" } };
        assert.equal(rp.extractEntityName(meta, []), "Nested Corp");
    });

    it("extracts from title field as last resort among defaults", () => {
        const rp = RenderPack.empty("x-pack");
        const meta = { title: "My Title" };
        assert.equal(rp.extractEntityName(meta, []), "My Title");
    });

    it("uses title_pattern regex capture when configured", () => {
        const rp = new RenderPack(
            makeData({
                packet_config: {
                    entity_extraction: {
                        fields: [],
                        title_pattern: "^(?<entity>.+?) -"
                    }
                }
            })
        );
        const meta = { title: "Acme Corp - Annual Report" };
        assert.equal(rp.extractEntityName(meta, []), "Acme Corp");
    });

    it("falls back to null when no field matches and no pack entries", () => {
        const rp = new RenderPack(
            makeData({
                packet_config: {
                    entity_extraction: { fields: ["nonexistent"] }
                }
            })
        );
        assert.equal(rp.extractEntityName({}, []), null);
    });
});

// ============================================================================
// resolveDocumentKind
// ============================================================================

describe("RenderPack - resolveDocumentKind", () => {
    const rp = new RenderPack(
        makeData({
            packet_config: {
                document_kind_default: "generic",
                document_kind_map: { CHA: "company_agreement" }
            }
        })
    );

    it("returns direct meta override when present", () => {
        const meta = {
            extensions: { formatting: { document_kind: "license" } }
        };
        assert.equal(rp.resolveDocumentKind(meta, []), "license");
    });

    it("maps from pack entry doc_type via document_kind_map", () => {
        const entries = [
            {
                path: "doc.md",
                doc_type: "CHA",
                precedence: 0,
                label: null,
                short_label: null
            }
        ];
        assert.equal(rp.resolveDocumentKind({}, entries), "company_agreement");
    });

    it("uses title heuristic for master agreement", () => {
        const meta = { title: "Master Agreement" };
        assert.equal(rp.resolveDocumentKind(meta, []), "master_agreement");
    });

    it("uses title heuristic for license", () => {
        const meta = { title: "Software License" };
        assert.equal(rp.resolveDocumentKind(meta, []), "license");
    });

    it("uses path heuristic for privacy policy", () => {
        const meta = { documents: { primary: "privacy-policy.md" } };
        assert.equal(rp.resolveDocumentKind(meta, []), "privacy_policy");
    });

    it("returns document_kind_default when nothing matches", () => {
        assert.equal(
            rp.resolveDocumentKind({ title: "Something Else" }, []),
            "generic"
        );
    });
});

// ============================================================================
// deriveDocumentName
// ============================================================================

describe("RenderPack - deriveDocumentName", () => {
    it("returns null when no name_patterns configured", () => {
        const rp = RenderPack.empty("x-pack");
        assert.equal(rp.deriveDocumentName("some/file.md"), null);
    });

    it("matches name from pattern and replaces underscores with spaces", () => {
        const rp = new RenderPack(
            makeData({
                packet_config: {
                    name_patterns: ["company_agreement"]
                }
            })
        );
        const name = rp.deriveDocumentName("DP-00001_company_agreement.md");
        assert.ok(name !== null);
        assert.ok(name.includes("company"));
    });

    it("skips invalid regex patterns without throwing", () => {
        const rp = new RenderPack(
            makeData({ packet_config: { name_patterns: ["[invalid"] } })
        );
        assert.doesNotThrow(() => rp.deriveDocumentName("some-file.md"));
    });
});

// ============================================================================
// getResolvedPacketConfig — defaults
// ============================================================================

describe("RenderPack - getResolvedPacketConfig", () => {
    it("returns full defaults when no packet_config present", () => {
        const cfg = RenderPack.empty("x-pack").getResolvedPacketConfig();
        assert.equal(cfg.default_entity_name, "DRAFT");
        assert.equal(cfg.default_document_title, "FILING PACKET");
        assert.equal(cfg.header_title_format, "plain");
        assert.equal(cfg.section_page_break, "always");
        assert.deepEqual(cfg.name_patterns, []);
        assert.ok(cfg.cover_config !== undefined);
        assert.ok(cfg.dust_cover_config !== undefined);
    });

    it("overrides defaults with packet_config values", () => {
        const rp = new RenderPack(
            makeData({
                packet_config: {
                    default_entity_name: "Acme",
                    header_title_format: "entity-suffix",
                    section_page_break: "never"
                }
            })
        );
        const cfg = rp.getResolvedPacketConfig();
        assert.equal(cfg.default_entity_name, "Acme");
        assert.equal(cfg.header_title_format, "entity-suffix");
        assert.equal(cfg.section_page_break, "never");
    });

    it("ignores invalid enum value for header_title_format and uses default", () => {
        const rp = new RenderPack(
            makeData({ packet_config: { header_title_format: "invalid" } })
        );
        const cfg = rp.getResolvedPacketConfig();
        assert.equal(cfg.header_title_format, "plain");
    });

    it("resolves entity_extraction with custom fields", () => {
        const rp = new RenderPack(
            makeData({
                packet_config: {
                    entity_extraction: { fields: ["custom_entity"] }
                }
            })
        );
        const cfg = rp.getResolvedPacketConfig();
        assert.deepEqual(cfg.entity_extraction.fields, ["custom_entity"]);
    });

    it("cover_config suppress_header is true by default", () => {
        const cfg = RenderPack.empty("x-pack").getResolvedPacketConfig();
        assert.equal(cfg.cover_config.suppress_header, true);
    });

    it("dust_cover_config is disabled by default", () => {
        const cfg = RenderPack.empty("x-pack").getResolvedPacketConfig();
        assert.equal(cfg.dust_cover_config.enabled, false);
    });

    it("signing_page is null by default", () => {
        const cfg = RenderPack.empty("x-pack").getResolvedPacketConfig();
        assert.equal(cfg.signing_page, null);
    });
});

// ============================================================================
// resolveCoverConfig
// ============================================================================

describe("RenderPack - resolveCoverConfig", () => {
    it("returns defaults when no profile cover and no meta cover", () => {
        const rp = RenderPack.empty("x-pack");
        const cfg = rp.resolveCoverConfig({}, null);
        assert.equal(cfg.suppress_header, true);
        assert.equal(cfg.suppress_footer, true);
        assert.equal(cfg.watermark.enabled, false);
    });

    it("profile cover overrides base cover", () => {
        const rp = RenderPack.empty("x-pack");
        const cfg = rp.resolveCoverConfig(
            {},
            {
                suppress_header: false,
                suppress_footer: false,
                suppress_page_numbering: false,
                reserve_header_footer_space: true,
                draft_watermark: { enabled: true, text: "DRAFT" }
            }
        );
        assert.equal(cfg.suppress_header, false);
        assert.equal(cfg.watermark.enabled, true);
        assert.equal(cfg.watermark.text, "DRAFT");
    });

    it("meta cover layer overrides profile cover", () => {
        const rp = RenderPack.empty("x-pack");
        const meta = {
            extensions: {
                formatting: {
                    cover: {
                        suppress_header: false,
                        draft_watermark: { enabled: true, text: "META DRAFT" }
                    }
                }
            }
        };
        const cfg = rp.resolveCoverConfig(meta, null);
        assert.equal(cfg.suppress_header, false);
        assert.equal(cfg.watermark.enabled, true);
        assert.equal(cfg.watermark.text, "META DRAFT");
    });

    it("returns defaults when meta has no extensions", () => {
        const cfg = RenderPack.empty("x-pack").resolveCoverConfig(
            { title: "Doc" },
            null
        );
        assert.equal(cfg.suppress_header, true);
    });
});

// ============================================================================
// resolveSigningConfig
// ============================================================================

describe("RenderPack - resolveSigningConfig", () => {
    const rpWithSigning = new RenderPack(
        makeData({
            packet_config: {
                signing_page: {
                    enabled: true,
                    parties: [
                        { name: "Alice", role: "Director" },
                        { name: "Bob", role: "Witness" }
                    ],
                    witness_clause: "Signed before witnesses."
                }
            }
        })
    );

    it("returns null when options.signing_page is false", () => {
        assert.equal(
            rpWithSigning.resolveSigningConfig({ signing_page: false }),
            null
        );
    });

    it("returns null when no signing_page in pack and no CLI flag", () => {
        assert.equal(RenderPack.empty("x-pack").resolveSigningConfig({}), null);
    });

    it("returns resolved config when enabled by pack", () => {
        const cfg = rpWithSigning.resolveSigningConfig({});
        assert.ok(cfg !== null);
        assert.equal(cfg.enabled, true);
        assert.equal(cfg.parties.length, 2);
        assert.equal(cfg.witness_clause, "Signed before witnesses.");
    });

    it("returns resolved config when enabled by CLI flag", () => {
        const rp = new RenderPack(
            makeData({
                packet_config: {
                    signing_page: {
                        parties: [{ name: "Alice", role: "Director" }]
                    }
                }
            })
        );
        const cfg = rp.resolveSigningConfig({ signing_page: true });
        assert.ok(cfg !== null);
        assert.equal(cfg.enabled, true);
    });

    it("overrides parties from signing_page_config option", () => {
        const cfg = rpWithSigning.resolveSigningConfig({
            signing_page_config: {
                parties: [{ name: "Charlie", role: "CEO" }],
                witness_clause: "Override clause."
            }
        });
        assert.ok(cfg !== null);
        assert.equal(cfg.parties[0].name, "Charlie");
        assert.equal(cfg.witness_clause, "Override clause.");
    });

    it("returns null when parties list is empty", () => {
        const rp = new RenderPack(
            makeData({
                packet_config: {
                    signing_page: { enabled: true, parties: [] }
                }
            })
        );
        assert.equal(rp.resolveSigningConfig({}), null);
    });
});

// ============================================================================
// validate()
// ============================================================================

describe("RenderPack - validate", () => {
    it("returns valid for a well-formed empty pack", () => {
        const result = RenderPack.empty("good-pack").validate();
        assert.equal(result.valid, true);
        assert.deepEqual(result.errors, []);
    });

    it("reports error for wrong schema name", () => {
        const rp = new RenderPack(makeData({ schema: "wrong-schema" }));
        const result = rp.validate();
        assert.ok(result.errors.some((e) => e.path === "schema"));
    });

    it("reports error for non-number schema_version", () => {
        const rp = new RenderPack(makeData({ schema_version: "one" }));
        const result = rp.validate();
        assert.ok(result.errors.some((e) => e.path === "schema_version"));
    });

    it("reports error for schema_version < 1", () => {
        const rp = new RenderPack(makeData({ schema_version: 0 }));
        const result = rp.validate();
        assert.ok(result.errors.some((e) => e.path === "schema_version"));
    });

    it("reports error for invalid pack_id", () => {
        const rp = new RenderPack(makeData({ pack_id: "Bad ID!" }));
        const result = rp.validate();
        assert.ok(result.errors.some((e) => e.path === "pack_id"));
    });

    it("accepts valid pack_id", () => {
        const rp = new RenderPack(makeData({ pack_id: "valid-pack-01" }));
        const result = rp.validate();
        assert.ok(!result.errors.some((e) => e.path === "pack_id"));
    });

    it("reports error for non-array imports", () => {
        const rp = new RenderPack(makeData({ imports: "not-array" }));
        const result = rp.validate();
        assert.ok(result.errors.some((e) => e.path === "imports"));
    });

    it("reports error for empty import entry", () => {
        const rp = new RenderPack(makeData({ imports: [""] }));
        const result = rp.validate();
        assert.ok(result.errors.some((e) => e.path === "imports[0]"));
    });

    it("reports error for non-object document_policies", () => {
        const rp = new RenderPack(makeData({ document_policies: "bad" }));
        const result = rp.validate();
        assert.ok(result.errors.some((e) => e.path === "document_policies"));
    });

    it("reports error for ruleset missing id", () => {
        const rp = new RenderPack(
            makeData({
                document_policies: {
                    rulesets: [{ id: "", selectors: {}, render: {} }]
                }
            })
        );
        const result = rp.validate();
        assert.ok(result.errors.some((e) => e.path.includes("rulesets[0].id")));
    });

    it("reports error for ruleset missing render object", () => {
        const rp = new RenderPack(
            makeData({
                document_policies: {
                    rulesets: [{ id: "r1", selectors: {}, render: null }]
                }
            })
        );
        const result = rp.validate();
        assert.ok(result.errors.some((e) => e.path.includes("render")));
    });

    it("reports error for doc_type in selectors not matching pattern", () => {
        const rp = new RenderPack(
            makeData({
                document_policies: {
                    rulesets: [
                        {
                            id: "r1",
                            selectors: { doc_types: ["bad_type"] },
                            render: {}
                        }
                    ]
                }
            })
        );
        const result = rp.validate();
        assert.ok(
            result.errors.some((e) => e.path.includes("selectors.doc_types[0]"))
        );
    });

    it("reports error for non-object targets map", () => {
        const rp = new RenderPack(
            makeData({
                document_policies: { targets: "not-object" }
            })
        );
        const result = rp.validate();
        assert.ok(result.errors.some((e) => e.path.includes("targets")));
    });

    it("reports error for non-object render_profiles map", () => {
        const rp = new RenderPack(
            makeData({
                document_policies: { render_profiles: "not-object" }
            })
        );
        const result = rp.validate();
        assert.ok(
            result.errors.some((e) => e.path.includes("render_profiles"))
        );
    });
});
