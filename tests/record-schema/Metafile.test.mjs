// @ts-check

/**
 * Unit tests for the Metafile class.
 *
 * Covers: construction, static factories (parse / empty / load / loadIfExists /
 * loadFromRecord / findInDirectory / dirNameToRecordId), basic accessors,
 * title resolution (determineDocumentTitle), primary/all document path
 * resolution, log/index document paths, formatting profile, schema validation,
 * semantic validate() including constraint checks, document existence helpers,
 * updatePacketInfo / getAssemblyPack / getAssemblyPacket, and save().
 *
 * @module tests/classes/Metafile_test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Metafile } from "../../lib/record-schema/Metafile.mjs";
import { Registry } from "../../lib/record-schema/Registry.mjs";
import { Schema } from "../../lib/record-schema/Schema.mjs";

// ============================================================================
// Helpers
// ============================================================================

/**
 * @returns {{ dir: string, write: (name: string, content: string) => string, cleanup: () => void }}
 */
function makeTmpDir() {
    const dir = join(
        tmpdir(),
        "metafile-test-" + Math.random().toString(36).slice(2)
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

/**
 * Minimal valid metafile YAML.
 * @param {string} [id]
 * @returns {string}
 */
function makeYaml(id = "DP-00001") {
    return `\
id: ${id}
series_code: DP
series: "00001"
title: Test Proposal
status:
  phase: active
  confidentiality: public
documents:
  primary:
    - path: DP-00001-proposal.md
  log:
    path: DP-00001-log.md
commitments:
  - kind: VOTE
    hash_sha256_hex: ${"a".repeat(64)}
extensions:
  formatting:
    profile: standard
`;
}

// ============================================================================
// Construction
// ============================================================================

describe("Metafile - construction", () => {
    it("stores data and defaults source_path to null", () => {
        const m = new Metafile({ id: "DP-00001" });
        assert.equal(m.data.id, "DP-00001");
        assert.equal(m.source_path, null);
    });

    it("stores provided source_path", () => {
        const m = new Metafile({}, "/path/_META.yaml");
        assert.equal(m.source_path, "/path/_META.yaml");
    });
});

// ============================================================================
// empty()
// ============================================================================

describe("Metafile.empty", () => {
    it("returns Metafile with empty data and null source_path", () => {
        const m = Metafile.empty();
        assert.ok(m instanceof Metafile);
        assert.deepEqual(m.data, {});
        assert.equal(m.source_path, null);
    });
});

// ============================================================================
// dirNameToRecordId
// ============================================================================

describe("Metafile.dirNameToRecordId", () => {
    it("extracts record ID from standard dir name", () => {
        assert.equal(
            Metafile.dirNameToRecordId("DP-00001-my-proposal"),
            "DP-00001"
        );
    });

    it("extracts record ID with 5-char series code", () => {
        assert.equal(
            Metafile.dirNameToRecordId("ABCDE-00042-slug"),
            "ABCDE-00042"
        );
    });

    it("returns null for non-matching names", () => {
        assert.equal(Metafile.dirNameToRecordId("not-a-record"), null);
        assert.equal(Metafile.dirNameToRecordId(""), null);
        assert.equal(Metafile.dirNameToRecordId("dp-00001-lowercase"), null);
    });
});

// ============================================================================
// parse()
// ============================================================================

describe("Metafile.parse", () => {
    it("parses YAML into data", () => {
        const m = Metafile.parse(makeYaml());
        assert.equal(m.getId(), "DP-00001");
        assert.equal(m.getSeriesCode(), "DP");
    });

    it("stores source_path when provided", () => {
        const m = Metafile.parse(makeYaml(), "/path/_META.yaml");
        assert.equal(m.source_path, "/path/_META.yaml");
    });

    it("handles empty YAML without throwing", () => {
        const m = Metafile.parse("");
        assert.ok(m instanceof Metafile);
    });
});

// ============================================================================
// load / loadIfExists
// ============================================================================

describe("Metafile.load / loadIfExists", () => {
    it("load reads and parses YAML file", () => {
        const tmp = makeTmpDir();
        const p = tmp.write("_META.yaml", makeYaml());
        const m = Metafile.load(p);
        assert.equal(m.getId(), "DP-00001");
        assert.equal(m.source_path, p);
        tmp.cleanup();
    });

    it("load throws for missing file", () => {
        assert.throws(() => Metafile.load("/no/such/_META.yaml"));
    });

    it("loadIfExists returns Metafile for existing file", () => {
        const tmp = makeTmpDir();
        const p = tmp.write("_META.yaml", makeYaml());
        const m = Metafile.loadIfExists(p);
        assert.ok(m instanceof Metafile);
        tmp.cleanup();
    });

    it("loadIfExists returns null for missing file", () => {
        assert.equal(Metafile.loadIfExists("/no/such/_META.yaml"), null);
    });
});

// ============================================================================
// loadFromRecord / findInDirectory
// ============================================================================

describe("Metafile.loadFromRecord", () => {
    it("loads _META.yaml using record_id convention", () => {
        const tmp = makeTmpDir();
        // loadFromRecord resolves: record_dir / `${record_id}_META.yaml`
        tmp.write("DP-00001_META.yaml", makeYaml());
        const m = Metafile.loadFromRecord(tmp.dir, "DP-00001");
        assert.ok(m instanceof Metafile);
        assert.equal(/** @type {Metafile} */ (m).getId(), "DP-00001");
        tmp.cleanup();
    });

    it("returns null when file does not exist", () => {
        const tmp = makeTmpDir();
        assert.equal(Metafile.loadFromRecord(tmp.dir, "DP-00001"), null);
        tmp.cleanup();
    });
});

describe("Metafile.findInDirectory", () => {
    it("auto-detects record ID from directory name and loads", () => {
        const tmp = makeTmpDir();
        const recordDir = join(tmp.dir, "DP-00001-my-proposal");
        mkdirSync(recordDir);
        writeFileSync(
            join(recordDir, "DP-00001_META.yaml"),
            makeYaml(),
            "utf8"
        );
        const m = Metafile.findInDirectory(recordDir);
        assert.ok(m instanceof Metafile);
        tmp.cleanup();
    });

    it("returns null when directory name has no record ID pattern", () => {
        const tmp = makeTmpDir();
        const m = Metafile.findInDirectory(join(tmp.dir, "not-a-record"));
        assert.equal(m, null);
        tmp.cleanup();
    });
});

// ============================================================================
// Basic accessors
// ============================================================================

describe("Metafile - basic accessors", () => {
    /** @type {Metafile} */
    const m = Metafile.parse(makeYaml());

    it("getId returns id field", () => {
        assert.equal(m.getId(), "DP-00001");
    });

    it("getSeriesCode returns series_code", () => {
        assert.equal(m.getSeriesCode(), "DP");
    });

    it("getSeriesNumber returns series field", () => {
        assert.equal(m.getSeriesNumber(), "00001");
    });

    it("getStatus returns status object", () => {
        const s = m.getStatus();
        assert.ok(s !== undefined);
        assert.equal(s.phase, "active");
    });

    it("getPhase returns status.phase", () => {
        assert.equal(m.getPhase(), "active");
    });

    it("getConfidentiality returns status.confidentiality", () => {
        assert.equal(m.getConfidentiality(), "public");
    });

    it("getTitle returns title field", () => {
        assert.equal(m.getTitle(), "Test Proposal");
    });

    it("getCommitments returns commitments array", () => {
        const c = m.getCommitments();
        assert.ok(Array.isArray(c));
        assert.equal(c.length, 1);
        assert.equal(c[0].kind, "VOTE");
    });

    it("getCommitments returns empty array when absent", () => {
        assert.deepEqual(Metafile.empty().getCommitments(), []);
    });

    it("getFormattingProfile returns extensions.formatting.profile", () => {
        assert.equal(m.getFormattingProfile(), "standard");
    });

    it("getFormattingProfile returns undefined when absent", () => {
        assert.equal(Metafile.empty().getFormattingProfile(), undefined);
    });

    it("getVersion returns undefined when absent", () => {
        assert.equal(Metafile.empty().getVersion(), undefined);
    });

    it("getEntityName returns entity_name field when present", () => {
        const m2 = Metafile.parse("entity_name: ACME Corp\n");
        assert.equal(m2.getEntityName(), "ACME Corp");
    });
});

// ============================================================================
// determineDocumentTitle
// ============================================================================

describe("Metafile - determineDocumentTitle", () => {
    it("returns data.title when present", () => {
        const m = Metafile.parse("title: My Title\n");
        assert.equal(m.determineDocumentTitle(), "My Title");
    });

    it("falls back to data.document.title when data.title absent", () => {
        const m = Metafile.parse("document:\n  title: Doc Title\n");
        assert.equal(m.determineDocumentTitle(), "Doc Title");
    });

    it("falls back to assembly.packet.label", () => {
        const m = Metafile.parse(
            "assembly:\n  packet:\n    label: Packet Label\n"
        );
        assert.equal(m.determineDocumentTitle(), "Packet Label");
    });

    it("falls back to pkt_cfg.default_document_title", () => {
        const m = Metafile.empty();
        assert.equal(
            m.determineDocumentTitle({
                default_document_title: "Config Title"
            }),
            "Config Title"
        );
    });

    it("falls back to FILING PACKET when everything absent", () => {
        assert.equal(
            Metafile.empty().determineDocumentTitle(),
            "FILING PACKET"
        );
    });

    it("trims whitespace from data.title", () => {
        const m = Metafile.parse("title: '  Padded  '\n");
        assert.equal(m.determineDocumentTitle(), "Padded");
    });

    it("skips blank data.title and falls back", () => {
        const m = Metafile.parse(
            "title: '   '\ndocument:\n  title: Fallback\n"
        );
        assert.equal(m.determineDocumentTitle(), "Fallback");
    });
});

// ============================================================================
// getPrimaryDocumentPath / getPrimaryDocumentPaths
// ============================================================================

describe("Metafile - primary document paths", () => {
    it("getPrimaryDocumentPath returns first string path", () => {
        const m = Metafile.parse(
            "documents:\n  primary:\n    - path: doc.md\n"
        );
        assert.equal(m.getPrimaryDocumentPath(), "doc.md");
    });

    it("getPrimaryDocumentPath handles bare string in array", () => {
        const m = Metafile.parse("documents:\n  primary:\n    - doc.md\n");
        assert.equal(m.getPrimaryDocumentPath(), "doc.md");
    });

    it("getPrimaryDocumentPath returns null when no primary defined", () => {
        assert.equal(Metafile.empty().getPrimaryDocumentPath(), null);
    });

    it("getPrimaryDocumentPaths returns all paths in order", () => {
        const m = Metafile.parse(`\
documents:
  primary:
    - path: a.md
    - path: b.md
    - c.md
`);
        assert.deepEqual(m.getPrimaryDocumentPaths(), ["a.md", "b.md", "c.md"]);
    });

    it("getPrimaryDocumentPaths returns empty array when absent", () => {
        assert.deepEqual(Metafile.empty().getPrimaryDocumentPaths(), []);
    });
});

// ============================================================================
// getDocumentsByTier / getAllDocumentPaths
// ============================================================================

describe("Metafile - document tiers / getAllDocumentPaths", () => {
    it("getDocumentsByTier returns refs for a known tier", () => {
        const m = Metafile.parse(`\
documents:
  secondary:
    - path: annex.md
`);
        const refs = m.getDocumentsByTier("secondary");
        assert.equal(refs.length, 1);
        assert.equal(refs[0].path, "annex.md");
    });

    it("getDocumentsByTier returns empty array for absent tier", () => {
        assert.deepEqual(Metafile.empty().getDocumentsByTier("tertiary"), []);
    });

    it("getAllDocumentPaths aggregates all tiers in order", () => {
        const m = Metafile.parse(`\
documents:
  primary:
    - path: main.md
  secondary:
    - path: annex.md
  supplemental:
    - path: exhibit.md
`);
        const paths = m.getAllDocumentPaths();
        assert.deepEqual(paths, ["main.md", "annex.md", "exhibit.md"]);
    });

    it("getAllDocumentPaths returns empty array when no documents", () => {
        assert.deepEqual(Metafile.empty().getAllDocumentPaths(), []);
    });
});

// ============================================================================
// getLogDocumentPath / getIndexDocumentPath
// ============================================================================

describe("Metafile - log / index document paths", () => {
    it("getLogDocumentPath returns path from object ref", () => {
        const m = Metafile.parse("documents:\n  log:\n    path: log.md\n");
        assert.equal(m.getLogDocumentPath(), "log.md");
    });

    it("getLogDocumentPath returns legacy plain string", () => {
        const m = Metafile.parse("documents:\n  log: log.md\n");
        assert.equal(m.getLogDocumentPath(), "log.md");
    });

    it("getLogDocumentPath returns null when absent", () => {
        assert.equal(Metafile.empty().getLogDocumentPath(), null);
    });

    it("getIndexDocumentPath returns path from object ref", () => {
        const m = Metafile.parse("documents:\n  index:\n    path: index.md\n");
        assert.equal(m.getIndexDocumentPath(), "index.md");
    });

    it("getIndexDocumentPath returns legacy plain string", () => {
        const m = Metafile.parse("documents:\n  index: index.md\n");
        assert.equal(m.getIndexDocumentPath(), "index.md");
    });

    it("getIndexDocumentPath returns null when absent", () => {
        assert.equal(Metafile.empty().getIndexDocumentPath(), null);
    });
});

// ============================================================================
// primaryDocumentExists / logDocumentExists
// ============================================================================

describe("Metafile - document existence helpers", () => {
    it("primaryDocumentExists returns true when file on disk", () => {
        const tmp = makeTmpDir();
        tmp.write("doc.md", "content");
        const m = Metafile.parse(
            "documents:\n  primary:\n    - path: doc.md\n"
        );
        assert.equal(m.primaryDocumentExists(tmp.dir), true);
        tmp.cleanup();
    });

    it("primaryDocumentExists returns false when file missing", () => {
        const tmp = makeTmpDir();
        const m = Metafile.parse(
            "documents:\n  primary:\n    - path: missing.md\n"
        );
        assert.equal(m.primaryDocumentExists(tmp.dir), false);
        tmp.cleanup();
    });

    it("primaryDocumentExists returns false when no primary paths", () => {
        const tmp = makeTmpDir();
        assert.equal(Metafile.empty().primaryDocumentExists(tmp.dir), false);
        tmp.cleanup();
    });

    it("primaryDocumentExists returns true if any one path exists", () => {
        const tmp = makeTmpDir();
        tmp.write("b.md", "content");
        const m = Metafile.parse(`\
documents:
  primary:
    - path: a.md
    - path: b.md
`);
        assert.equal(m.primaryDocumentExists(tmp.dir), true);
        tmp.cleanup();
    });

    it("logDocumentExists returns true when log file on disk", () => {
        const tmp = makeTmpDir();
        tmp.write("log.md", "log content");
        const m = Metafile.parse("documents:\n  log:\n    path: log.md\n");
        assert.equal(m.logDocumentExists(tmp.dir), true);
        tmp.cleanup();
    });

    it("logDocumentExists returns false when log file missing", () => {
        const tmp = makeTmpDir();
        const m = Metafile.parse("documents:\n  log:\n    path: missing.md\n");
        assert.equal(m.logDocumentExists(tmp.dir), false);
        tmp.cleanup();
    });

    it("logDocumentExists returns false when no log path defined", () => {
        const tmp = makeTmpDir();
        assert.equal(Metafile.empty().logDocumentExists(tmp.dir), false);
        tmp.cleanup();
    });
});

// ============================================================================
// validateSchema / isValidSchema
// ============================================================================

describe("Metafile - validateSchema / isValidSchema", () => {
    it("returns no errors for valid data", () => {
        const m = Metafile.parse(makeYaml());
        const s = new Schema({ type: "object", required: ["id"] });
        assert.deepEqual(m.validateSchema(s), []);
        assert.equal(m.isValidSchema(s), true);
    });

    it("returns errors for invalid data", () => {
        const m = Metafile.empty();
        const s = new Schema({ type: "object", required: ["id"] });
        const errors = m.validateSchema(s);
        assert.ok(errors.length > 0);
        assert.equal(m.isValidSchema(s), false);
    });
});

// ============================================================================
// validate() — semantic validation
// ============================================================================

describe("Metafile - validate (semantic)", () => {
    it("returns no issues for a well-formed metafile", () => {
        const m = Metafile.parse(makeYaml());
        const issues = m.validate("DP-00001", "DP-00001-proposal", null, null);
        assert.equal(issues.length, 0);
    });

    it("reports error for id mismatch", () => {
        const m = Metafile.parse(makeYaml("DP-00002"));
        const issues = m.validate("DP-00001", "DP-00001-proposal", null, null);
        assert.ok(issues.some((i) => i.code === "meta.id.mismatch"));
    });

    it("reports error when series_code does not match record_id prefix", () => {
        const yaml = `id: CHA-00001\nseries_code: DP\nseries: "00001"\n`;
        const m = Metafile.parse(yaml);
        const issues = m.validate("CHA-00001", "CHA-00001-charter", null, null);
        assert.ok(issues.some((i) => i.code === "meta.series_code.mismatch"));
    });

    it("reports error when series number does not match record_id", () => {
        const yaml = `id: DP-00001\nseries_code: DP\nseries: "00002"\n`;
        const m = Metafile.parse(yaml);
        const issues = m.validate("DP-00001", "DP-00001-proposal", null, null);
        assert.ok(issues.some((i) => i.code === "meta.series.mismatch"));
    });

    it("reports warning for unknown series code in registry", () => {
        const registry = Registry.parse(`\
schema: record-schema-registry
series:
  - code: CHA
    name: Charter
    tier: "1"
`);
        const m = Metafile.parse(makeYaml());
        const issues = m.validate(
            "DP-00001",
            "DP-00001-proposal",
            null,
            registry
        );
        assert.ok(issues.some((i) => i.code === "registry.unknown.series"));
    });

    it("no registry warning when series code is known", () => {
        const registry = Registry.parse(`\
schema: record-schema-registry
series:
  - code: DP
    name: DAO Proposals
    tier: "1"
`);
        const m = Metafile.parse(makeYaml());
        const issues = m.validate(
            "DP-00001",
            "DP-00001-proposal",
            null,
            registry
        );
        assert.ok(!issues.some((i) => i.code === "registry.unknown.series"));
    });

    it("reports error for non-object data", () => {
        const m = new Metafile(/** @type {any} */ (null));
        const issues = m.validate("DP-00001", "dir", null, null);
        assert.ok(issues.some((i) => i.code === "meta.invalid"));
    });
});

// ============================================================================
// validate() — constraint checks
// ============================================================================

describe("Metafile - validate (constraints)", () => {
    it("reports error when status.phase not in allowed list", () => {
        const m = Metafile.parse(makeYaml());
        const issues = m.validate(
            "DP-00001",
            "DP-00001-proposal",
            {
                status_phase_allow: ["draft", "closed"]
            },
            null
        );
        assert.ok(issues.some((i) => i.code === "status.phase.disallowed"));
    });

    it("no phase error when status.phase is allowed", () => {
        const m = Metafile.parse(makeYaml());
        const issues = m.validate(
            "DP-00001",
            "DP-00001-proposal",
            {
                status_phase_allow: ["active"]
            },
            null
        );
        assert.ok(!issues.some((i) => i.code === "status.phase.disallowed"));
    });

    it("reports error when confidentiality not in allowed list", () => {
        const m = Metafile.parse(makeYaml());
        const issues = m.validate(
            "DP-00001",
            "DP-00001-proposal",
            {
                status_confidentiality_allow: ["private"]
            },
            null
        );
        assert.ok(
            issues.some((i) => i.code === "status.confidentiality.disallowed")
        );
    });

    it("reports error when commitments required but empty", () => {
        const m = Metafile.parse(
            'id: DP-00001\nseries_code: DP\nseries: "00001"\n'
        );
        const issues = m.validate(
            "DP-00001",
            "DP-00001-proposal",
            {
                require_commitments: true
            },
            null
        );
        assert.ok(issues.some((i) => i.code === "commitments.required"));
    });

    it("no commitment error when commitments present", () => {
        const m = Metafile.parse(makeYaml());
        const issues = m.validate(
            "DP-00001",
            "DP-00001-proposal",
            {
                require_commitments: true
            },
            null
        );
        assert.ok(!issues.some((i) => i.code === "commitments.required"));
    });

    it("reports error when commitment kind not in allowed list", () => {
        const m = Metafile.parse(makeYaml());
        const issues = m.validate(
            "DP-00001",
            "DP-00001-proposal",
            {
                require_commitment_kind_allow: ["SIGN"]
            },
            null
        );
        assert.ok(issues.some((i) => i.code === "commitment.kind.disallowed"));
    });

    it("no kind error when commitment kind is allowed", () => {
        const m = Metafile.parse(makeYaml());
        const issues = m.validate(
            "DP-00001",
            "DP-00001-proposal",
            {
                require_commitment_kind_allow: ["VOTE"]
            },
            null
        );
        assert.ok(!issues.some((i) => i.code === "commitment.kind.disallowed"));
    });

    it("reports error when commitment missing hash and content_id", () => {
        const yaml = `\
id: DP-00001
series_code: DP
series: "00001"
commitments:
  - kind: VOTE
`;
        const m = Metafile.parse(yaml);
        const issues = m.validate(
            "DP-00001",
            "DP-00001-proposal",
            {
                require_commitment_hash_or_content_id: true
            },
            null
        );
        assert.ok(issues.some((i) => i.code === "commitment.missing.anchor"));
    });

    it("no anchor error when commitment has hash_sha256_hex", () => {
        const m = Metafile.parse(makeYaml());
        const issues = m.validate(
            "DP-00001",
            "DP-00001-proposal",
            {
                require_commitment_hash_or_content_id: true
            },
            null
        );
        assert.ok(!issues.some((i) => i.code === "commitment.missing.anchor"));
    });

    it("no anchor error when commitment has content_id", () => {
        const yaml = `\
id: DP-00001
series_code: DP
series: "00001"
commitments:
  - kind: VOTE
    content_id: abc123
`;
        const m = Metafile.parse(yaml);
        const issues = m.validate(
            "DP-00001",
            "DP-00001-proposal",
            {
                require_commitment_hash_or_content_id: true
            },
            null
        );
        assert.ok(!issues.some((i) => i.code === "commitment.missing.anchor"));
    });

    it("reports error when documents.primary required but absent", () => {
        const m = Metafile.parse(
            'id: DP-00001\nseries_code: DP\nseries: "00001"\n'
        );
        const issues = m.validate(
            "DP-00001",
            "DP-00001-proposal",
            {
                require_documents_primary_ref: true
            },
            null
        );
        assert.ok(issues.some((i) => i.code === "documents.primary.required"));
    });

    it("reports error when documents.log required but absent", () => {
        const m = Metafile.parse(
            'id: DP-00001\nseries_code: DP\nseries: "00001"\n'
        );
        const issues = m.validate(
            "DP-00001",
            "DP-00001-proposal",
            {
                require_documents_log_ref: true
            },
            null
        );
        assert.ok(issues.some((i) => i.code === "documents.log.required"));
    });

    it("reports warn when formatting profile required but absent", () => {
        const m = Metafile.parse(
            'id: DP-00001\nseries_code: DP\nseries: "00001"\n'
        );
        const issues = m.validate(
            "DP-00001",
            "DP-00001-proposal",
            {
                require_formatting_profile: true
            },
            null
        );
        assert.ok(
            issues.some(
                (i) => i.code === "extensions.formatting.profile.missing"
            )
        );
    });
});

// ============================================================================
// updatePacketInfo / getAssemblyPack / getAssemblyPacket
// ============================================================================

describe("Metafile - assembly packet methods", () => {
    it("updatePacketInfo sets assembly.packet fields", () => {
        const m = Metafile.empty();
        m.updatePacketInfo("packets/DP-00001-packet.pdf", "a".repeat(64));
        const pkt = m.getAssemblyPacket();
        assert.ok(pkt !== undefined);
        assert.equal(pkt.path, "packets/DP-00001-packet.pdf");
        assert.equal(pkt.hash_sha256_hex, "a".repeat(64));
        assert.ok(typeof pkt.generated_at === "string");
    });

    it("updatePacketInfo creates assembly object when absent", () => {
        const m = Metafile.empty();
        assert.equal(m.data.assembly, undefined);
        m.updatePacketInfo("out.pdf", "b".repeat(64));
        assert.ok(m.data.assembly !== undefined);
    });

    it("getAssemblyPack returns empty array when absent", () => {
        assert.deepEqual(Metafile.empty().getAssemblyPack(), []);
    });

    it("getAssemblyPack returns pack entries when present", () => {
        const m = Metafile.parse(`\
assembly:
  pack:
    - pack: standard.pack.yaml
    - pack: signing.pack.yaml
`);
        const pack = m.getAssemblyPack();
        assert.equal(pack.length, 2);
    });

    it("getAssemblyPacket returns undefined when absent", () => {
        assert.equal(Metafile.empty().getAssemblyPacket(), undefined);
    });
});

// ============================================================================
// save()
// ============================================================================

describe("Metafile - save", () => {
    it("throws when source_path is null", () => {
        const m = Metafile.empty();
        assert.throws(() => m.save(), /source path/i);
    });

    it("writes data to disk when source_path set", () => {
        const tmp = makeTmpDir();
        const p = tmp.write("_META.yaml", makeYaml());
        const m = Metafile.load(p);
        // Mutate and save
        m.data.title = "Updated Title";
        m.save();

        const reloaded = Metafile.load(p);
        assert.equal(reloaded.getTitle(), "Updated Title");
        tmp.cleanup();
    });
});
