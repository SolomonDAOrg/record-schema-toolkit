// @ts-check

/**
 * Unit tests for the corpus assertion layer.
 *
 * Two things are covered, and the second matters more than the first.
 *
 * The first is that each rule kind fires on the defect it names. That is the
 * obvious half.
 *
 * The second is that each kind fires *for the right reason* - that a rule which
 * reports clean did so because it looked and found nothing, not because it
 * never looked. Four distinct ways a rule can silently examine nothing were
 * found while porting a real corpus onto this engine: an empty join, a plural
 * path bound as a scalar, a source glob that matched half the documents it was
 * written for, and a `resolve` whose use side selected zero rows while its
 * definition side selected hundreds. Every one of them presented as a passing
 * check. The accounting tests below exist so those four cannot come back
 * unnoticed.
 *
 * @module tests/record-schema/assertions_test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import {
    evaluatePath,
    evaluatePathValues
} from "../../lib/record-schema/assertions/Path.mjs";
import {
    evaluatePredicate,
    looseEqual
} from "../../lib/record-schema/assertions/Predicate.mjs";
import {
    renderTemplate,
    renderKey
} from "../../lib/record-schema/assertions/Template.mjs";
import { evaluateExpression } from "../../lib/record-schema/assertions/Expression.mjs";
import {
    decodeLayout,
    parseHex
} from "../../lib/record-schema/assertions/Decoder.mjs";
import { runAssertions } from "../../lib/record-schema/assertions/AssertionRunner.mjs";

// ============================================================================
// Fixtures
// ============================================================================

/**
 * Build a throwaway repository from a path -> contents mapping.
 *
 * @param {Record<string, string>} files
 * @returns {string} absolute root
 */
function makeRepo(files) {
    const root = mkdtempSync(join(tmpdir(), "assertions-"));
    const paths = Object.keys(files);
    for (let i = 0, len = paths.length; i < len; i++) {
        const absolute = join(root, paths[i]);
        mkdirSync(dirname(absolute), { recursive: true });
        writeFileSync(absolute, files[paths[i]], "utf8");
    }
    return root;
}

/**
 * @param {string} root
 * @param {string[]} [packs]
 * @returns {import("../../lib/record-schema/assertions/AssertionRunner.mjs").AssertionRunResult}
 */
function run(root, packs = ["rules/test.rules.yaml"]) {
    return runAssertions(root, { packs });
}

/**
 * @param {import("../../lib/record-schema/assertions/AssertionRunner.mjs").AssertionRunResult} result
 * @param {string} ruleId
 * @returns {import("../../lib/record-schema/assertions/types/general.mjs").AssertionFinding[]}
 */
function findingsFor(result, ruleId) {
    return result.findings.filter((finding) => finding.rule === ruleId);
}

const RECORD_META = `schema: record-schema
schema_version: 1
id: AAA-00001
series_code: AAA
title: Fixture
slug: fixture
documents:
  primary:
    - { path: AAA-00001_DEF-types.yaml, label: Types }
`;

// ============================================================================
// Path
// ============================================================================

describe("assertions/Path", () => {
    const document = {
        definitions: [
            { name: "A", members: [{ name: "x", width: 4 }] },
            { name: "B", members: [] }
        ],
        nested: { deep: { width: 9 } }
    };

    it("selects children, indices, and wildcards", () => {
        assert.deepEqual(
            evaluatePathValues(document, "$.definitions[*].name"),
            ["A", "B"]
        );
        assert.deepEqual(
            evaluatePathValues(document, "$.definitions[0].name"),
            ["A"]
        );
        assert.deepEqual(
            evaluatePathValues(document, "$.definitions[-1].name"),
            ["B"]
        );
    });

    it("descends by key at any depth", () => {
        assert.deepEqual(evaluatePathValues(document, "$..width"), [4, 9]);
    });

    it("descends to every node and binds the key each hangs off", () => {
        const matches = evaluatePath(document, "$..*");
        const widths = matches.filter((match) => match.key === "width");
        assert.equal(widths.length, 2);
    });

    it("returns an empty list rather than throwing on an absent path", () => {
        // Absence is a condition rules test, not a fault.
        assert.deepEqual(evaluatePathValues(document, "$.missing.deeper"), []);
    });
});

// ============================================================================
// Predicate
// ============================================================================

describe("assertions/Predicate", () => {
    it("holds for all selected values by default and for one under mode: any", () => {
        const value = { members: [{ w: 4 }, { w: 8 }] };
        assert.equal(
            evaluatePredicate({ "$.members[*].w": { gte: 4 } }, value),
            true
        );
        assert.equal(
            evaluatePredicate({ "$.members[*].w": { gte: 8 } }, value),
            false
        );
        assert.equal(
            evaluatePredicate(
                { "$.members[*].w": { mode: "any", gte: 8 } },
                value
            ),
            true
        );
    });

    it("defines exists and absent on cardinality", () => {
        assert.equal(evaluatePredicate({ "$.a": { exists: true } }, {}), false);
        assert.equal(evaluatePredicate({ "$.a": { absent: true } }, {}), true);
    });

    it("combines clauses with all, any, none, and not", () => {
        const value = { kind: "enum", name: "Foo" };
        assert.equal(
            evaluatePredicate(
                { any: [{ kind: { eq: "struct" } }, { kind: { eq: "enum" } }] },
                value
            ),
            true
        );
        assert.equal(
            evaluatePredicate({ none: [{ kind: { eq: "enum" } }] }, value),
            false
        );
        assert.equal(
            evaluatePredicate({ not: { kind: { eq: "struct" } } }, value),
            true
        );
    });

    it("evaluates arithmetic guards over the matched value", () => {
        const dense = { members: [{ value: 0 }, { value: 1 }, { value: 2 }] };
        const sparse = { members: [{ value: 0 }, { value: 1048576 }] };
        const guard = {
            expr: {
                bind: { ordinals: "$.members[*].value" },
                assert: "max(ordinals) <= 4 * len(ordinals)"
            }
        };
        assert.equal(evaluatePredicate(guard, dense), true);
        assert.equal(evaluatePredicate(guard, sparse), false);
    });

    it("treats 8, '8', and 0x08 as one physical fact", () => {
        // YAML authors write byte counts three ways. A gate reporting the
        // difference would be reporting on the parser, not on the corpus.
        assert.equal(looseEqual(8, "8"), true);
        assert.equal(looseEqual(8, "0x08"), true);
        assert.equal(looseEqual(8, "9"), false);
    });
});

// ============================================================================
// Template
// ============================================================================

describe("assertions/Template", () => {
    it("renders paths and built-in bindings", () => {
        assert.equal(
            renderTemplate(
                "{#file}: {$.name}",
                { name: "A" },
                { "#file": "a.yaml" }
            ),
            "a.yaml: A"
        );
    });

    it("returns null from renderKey when a referenced path is absent", () => {
        // A join key built from a missing field is not the empty string; it is
        // no key at all, and collapsing the two joins every incomplete row to
        // every other one.
        assert.equal(renderKey("{$.missing}", { name: "A" }, {}), null);
        assert.equal(renderTemplate("{$.missing}", { name: "A" }, {}), "");
    });

    it("coalesces alternatives with ??", () => {
        assert.equal(
            renderKey("{$.width ?? $.bytes ?? $.size}", { size: 12 }, {}),
            "12"
        );
        assert.equal(
            renderKey("{$.reference ?? $.type}", { type: "Foo" }, {}),
            "Foo"
        );
        assert.equal(renderKey("{$.width ?? $.bytes}", { other: 1 }, {}), null);
    });

    it("preserves regex backslashes in filter arguments", () => {
        // Swallowing them turned \\[\\d+\\] into [d+] - a pattern matching
        // nothing, and a grouping key silently degrading to one group per row.
        assert.equal(
            renderKey(
                "{#path|replace(\\[\\d+\\]$,)}",
                {},
                {
                    "#path": "$.definitions[0].members[3]"
                }
            ),
            "$.definitions[0].members"
        );
    });

    it("strips one path segment with the parent filter", () => {
        assert.equal(
            renderKey("{#path|parent}", {}, { "#path": "$.a.b[2]" }),
            "$.a.b"
        );
    });
});

// ============================================================================
// Expression
// ============================================================================

describe("assertions/Expression", () => {
    it("evaluates arithmetic and comparison", () => {
        assert.equal(
            evaluateExpression("sum(w) == d", { w: [4, 8], d: 12 }),
            true
        );
        assert.equal(evaluateExpression("len(w) > 1", { w: [4, 8] }), true);
    });

    it("short-circuits && so a guard can protect the term after it", () => {
        // len(x) >= 2 && max(x) <= ... is written precisely so the right side
        // never has to hold for an empty list.
        assert.equal(
            evaluateExpression("len(x) >= 2 && max(x) <= 10", { x: [] }),
            false
        );
        assert.equal(
            evaluateExpression("len(x) == 0 || max(x) <= 10", { x: [] }),
            true
        );
    });

    it("tiles offsets and widths against a declared total", () => {
        assert.equal(
            evaluateExpression("tiles(o, w, 12)", { o: [0, 4], w: [4, 8] }),
            true
        );
        assert.equal(
            evaluateExpression("tiles(o, w, 12)", { o: [0, 5], w: [4, 8] }),
            false,
            "a one-byte gap must not tile"
        );
        assert.equal(
            evaluateExpression("tiles(o, w, 13)", { o: [0, 4], w: [4, 8] }),
            false,
            "members that tile to 12 must not satisfy a declared 13"
        );
    });

    it("detects overlapping spans", () => {
        assert.equal(
            evaluateExpression("overlaps(o, w)", { o: [0, 3], w: [4, 8] }),
            true
        );
        assert.equal(
            evaluateExpression("overlaps(o, w)", { o: [0, 8], w: [4, 8] }),
            false,
            "a gap is not an overlap"
        );
    });

    it("drops unresolved keys from lookup_all rather than defaulting them", () => {
        // Defaulting to zero lets a width table with a missing entry sum to the
        // declared total by luck. The caller compares lengths to detect it.
        const table = { u8: 8, u16: 16 };
        assert.equal(
            evaluateExpression("len(lookup_all(t, k))", {
                t: table,
                k: ["u8", "u99"]
            }),
            1
        );
    });
});

// ============================================================================
// Decoder
// ============================================================================

describe("assertions/Decoder", () => {
    const layout = {
        name: "Header",
        encoded_size: 8,
        members: [
            { name: "magic", offset: 0, width: 2, value: "0x434A" },
            { name: "revision", offset: 2, width: 1, value: 1 },
            { name: "length", offset: 4, width: 4 }
        ]
    };

    const request = {
        layout,
        fieldsPath: "$.members[*]",
        fieldName: "$.name",
        fieldOffset: "$.offset",
        fieldWidth: "$.width",
        fieldEncoding: "$.encoding",
        fieldConst: "$.value"
    };

    it("decodes little-endian fields at declared offsets", () => {
        const result = decodeLayout({
            ...request,
            hex: "4a4301002300000" + "0"
        });
        assert.equal(result.error, null);
        assert.equal(result.fields.magic, 0x434a);
        assert.equal(result.fields.revision, 1);
        assert.equal(result.fields.length, 0x23);
    });

    it("collects layout constants so bytes can be checked against them", () => {
        const result = decodeLayout({
            ...request,
            hex: "4a4302002300000" + "0"
        });
        assert.equal(result.constants.revision, 1);
        assert.equal(result.fields.revision, 2, "bytes disagree with the pin");
    });

    it("reports a field spanning past the vector rather than reading past it", () => {
        const result = decodeLayout({ ...request, hex: "4a4301" });
        assert.notEqual(result.error, null);
    });

    it("rejects a non-hex string", () => {
        assert.equal(parseHex("not-hex"), null);
        assert.equal(parseHex("4a4"), null, "an odd digit count is not bytes");
    });
});

// ============================================================================
// Rule kinds, end to end
// ============================================================================

describe("assertions/rule kinds", () => {
    it("forbid reports every match", () => {
        const root = makeRepo({
            "records/AAA/AAA-00001-fixture/AAA-00001_META.yaml": RECORD_META,
            "records/AAA/AAA-00001-fixture/AAA-00001_DEF-types.yaml":
                "schema: definition-schema\ndefinitions:\n  - name: A\n    rationale: a sentence\n",
            "rules/test.rules.yaml": `schema: record-schema-assertion-pack
schema_version: 1
sources:
  payloads: { include: ["records/**/*.yaml"], exclude: ["records/**/*_META.yaml"] }
rules:
  - id: BANNED
    kind: forbid
    select:
      source: payloads
      path: "$..*"
      where:
        "#key": { in: [rationale] }
        "#value": { type: scalar }
    message: "{#file} {#path}: banned key"
`
        });

        try {
            const result = run(root);
            assert.equal(findingsFor(result, "BANNED").length, 1);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it("unique reports colliding keys and consistent reports disagreeing values", () => {
        const root = makeRepo({
            "records/AAA/AAA-00001-fixture/AAA-00001_META.yaml": RECORD_META,
            "records/AAA/AAA-00001-fixture/AAA-00001_DEF-types.yaml":
                "schema: definition-schema\ndefinitions:\n" +
                "  - name: E\n    kind: enum\n    members:\n" +
                "      - { name: One, value: 1, tier: hot }\n" +
                "      - { name: Two, value: 1, tier: cold }\n",
            "rules/test.rules.yaml": `schema: record-schema-assertion-pack
schema_version: 1
sources:
  definitions: { include: ["records/**/*_DEF-*.yaml"] }
selectors:
  member:
    source: definitions
    path: "$.definitions[*].members[*]"
rules:
  - id: DUPORDINAL
    kind: unique
    select: member
    key: "{$.value}"
    within: "{#path|parent}"
    message: "ordinal {#key} allocated {#count} times"
  - id: MIXEDTIER
    kind: consistent
    select: member
    group: "{#path|parent}"
    value: "{$.tier}"
    message: "{#group} mixes [{#values}]"
`
        });

        try {
            const result = run(root);
            assert.equal(findingsFor(result, "DUPORDINAL").length, 1);
            assert.equal(findingsFor(result, "MIXEDTIER").length, 1);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it("agree compares joined values and supports inequality", () => {
        const root = makeRepo({
            "records/AAA/AAA-00001-fixture/AAA-00001_META.yaml": RECORD_META,
            "records/AAA/AAA-00001-fixture/AAA-00001_DEF-types.yaml":
                "schema: definition-schema\n" +
                "ceiling: { Widget: 32 }\n" +
                "actual: { Widget: 64 }\n",
            "rules/test.rules.yaml": `schema: record-schema-assertion-pack
schema_version: 1
sources:
  definitions: { include: ["records/**/*_DEF-*.yaml"] }
rules:
  - id: WITHIN_CEILING
    kind: agree
    compare: lte
    left:
      select: { source: definitions, path: "$.actual.*" }
      key: "{#key}"
      value: "{#value}"
    right:
      select: { source: definitions, path: "$.ceiling.*" }
      key: "{#key}"
      value: "{#value}"
    message: "{#key}: {#left} exceeds {#right}"
`
        });

        try {
            const result = run(root);
            assert.equal(findingsFor(result, "WITHIN_CEILING").length, 1);
            assert.equal(result.joinCounts.WITHIN_CEILING.joined, 1);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it("derive skips a row its `when` guard excludes rather than failing it", () => {
        const root = makeRepo({
            "records/AAA/AAA-00001-fixture/AAA-00001_META.yaml": RECORD_META,
            "records/AAA/AAA-00001-fixture/AAA-00001_DEF-types.yaml":
                "schema: definition-schema\ndefinitions:\n" +
                "  - name: Fixed\n    encoded_size: 12\n    members:\n" +
                "      - { name: a, offset: 0, width: 4 }\n" +
                "      - { name: b, offset: 4, width: 8 }\n" +
                "  - name: Variable\n    encoded_size: 12\n    members:\n" +
                "      - { name: a, offset: 0 }\n",
            "rules/test.rules.yaml": `schema: record-schema-assertion-pack
schema_version: 1
sources:
  definitions: { include: ["records/**/*_DEF-*.yaml"] }
rules:
  - id: TILES
    kind: derive
    scope: { source: definitions, path: "$.definitions[*]" }
    bind:
      declared: "$.encoded_size"
      offsets: "$.members[*].offset"
      widths: "$.members[*].width"
    when: "len(offsets) == len(widths) && len(offsets) > 0"
    assert: "tiles(offsets, widths, declared)"
    message: "{#file} {#path}: does not tile"
`
        });

        try {
            const result = run(root);
            assert.equal(
                findingsFor(result, "TILES").length,
                0,
                "Fixed tiles; Variable is skipped by the guard, not failed"
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

// ============================================================================
// Vacuity accounting
// ============================================================================

describe("assertions/vacuity accounting", () => {
    it("separates nodes examined from nodes matched, so a passing ban is distinguishable from an unpointed one", () => {
        const root = makeRepo({
            "records/AAA/AAA-00001-fixture/AAA-00001_META.yaml": RECORD_META,
            "records/AAA/AAA-00001-fixture/AAA-00001_DEF-types.yaml":
                "schema: definition-schema\ndefinitions:\n  - name: A\n    description: fine\n",
            "rules/test.rules.yaml": `schema: record-schema-assertion-pack
schema_version: 1
sources:
  payloads: { include: ["records/**/*_DEF-*.yaml"] }
  nowhere: { include: ["does-not-exist/**/*.yaml"] }
rules:
  - id: LOOKED
    kind: forbid
    select:
      source: payloads
      path: "$..*"
      where: { "#key": { in: [rationale] } }
    message: "banned"
  - id: NEVER_LOOKED
    kind: forbid
    select:
      source: nowhere
      path: "$..*"
      where: { "#key": { in: [rationale] } }
    message: "banned"
`
        });

        try {
            const result = run(root);
            assert.equal(result.findings.length, 0, "both report clean");
            assert.ok(
                result.scopeCounts.LOOKED > 0,
                "the pointed ban examined the corpus"
            );
            assert.equal(
                result.scopeCounts.NEVER_LOOKED,
                0,
                "the unpointed ban examined nothing, and the count says so"
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it("reports join coverage, so an agree rule comparing nothing is visible", () => {
        const root = makeRepo({
            "records/AAA/AAA-00001-fixture/AAA-00001_META.yaml": RECORD_META,
            "records/AAA/AAA-00001-fixture/AAA-00001_DEF-types.yaml":
                "schema: definition-schema\nleft: { A: 1 }\nright: { B: 1 }\n",
            "rules/test.rules.yaml": `schema: record-schema-assertion-pack
schema_version: 1
sources:
  definitions: { include: ["records/**/*_DEF-*.yaml"] }
rules:
  - id: NO_JOIN
    kind: agree
    require_right: false
    left:
      select: { source: definitions, path: "$.left.*" }
      key: "{#key}"
      value: "{#value}"
    right:
      select: { source: definitions, path: "$.right.*" }
      key: "{#key}"
      value: "{#value}"
    message: "{#key} disagrees"
`
        });

        try {
            const result = run(root);
            assert.equal(result.findings.length, 0, "reports clean");
            const join = result.joinCounts.NO_JOIN;
            assert.equal(join.left, 1);
            assert.equal(join.right, 1);
            assert.equal(
                join.joined,
                0,
                "both sides have rows and nothing was compared"
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it("reports use and definition counts separately for resolve", () => {
        const root = makeRepo({
            "records/AAA/AAA-00001-fixture/AAA-00001_META.yaml": RECORD_META,
            "records/AAA/AAA-00001-fixture/AAA-00001_DEF-types.yaml":
                "schema: definition-schema\nproofs:\n  - { name: a }\n  - { name: b }\n",
            "rules/test.rules.yaml": `schema: record-schema-assertion-pack
schema_version: 1
sources:
  definitions: { include: ["records/**/*_DEF-*.yaml"] }
rules:
  - id: ONE_SIDED
    kind: resolve
    uses: { source: definitions, path: "$.uses[*]" }
    defines: { source: definitions, path: "$.proofs[*]" }
    key: "{$.name}"
    message: "{#key} unresolved"
`
        });

        try {
            const result = run(root);
            assert.equal(result.findings.length, 0, "reports clean");
            assert.equal(result.resolveCounts.ONE_SIDED.defines, 2);
            assert.equal(
                result.resolveCounts.ONE_SIDED.uses,
                0,
                "a single row count would have shown 2 and hidden this"
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it("binds a plural path selecting nothing as an empty list, not as a missing field", () => {
        // The distinction matters at zero. A singular path selecting nothing
        // means the row has no such field and the assertion has nothing to say;
        // a plural path selecting nothing means the row has none of them, which
        // is often exactly the condition being asserted. Collapsing the two
        // skipped every row the guard was written to admit.
        const root = makeRepo({
            "records/AAA/AAA-00001-fixture/AAA-00001_META.yaml": RECORD_META,
            "records/AAA/AAA-00001-fixture/AAA-00001_DEF-types.yaml":
                "schema: definition-schema\nsection:\n  total: 3\n  entry:\n    a: { size: 1 }\n    b: { size: 1 }\n",
            "rules/test.rules.yaml": `schema: record-schema-assertion-pack
schema_version: 1
sources:
  definitions: { include: ["records/**/*_DEF-*.yaml"] }
rules:
  - id: STRIDE
    kind: derive
    scope: { source: definitions, path: "$.section" }
    bind:
      declared: "$.total"
      sizes: "$.entry.*.size"
      variable: "$.entry.*.length_from"
    when: "len(variable) == 0"
    assert: "sum(sizes) == declared"
    message: "{#file}: stride is {#declared}, fields sum otherwise"
`
        });

        try {
            const result = run(root);
            assert.equal(
                findingsFor(result, "STRIDE").length,
                1,
                "the guard admits the row and the assertion catches 2 != 3"
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

// ============================================================================
// Pack loading
// ============================================================================

describe("assertions/AssertionPack", () => {
    it("refuses a pack path that escapes the repository", () => {
        const root = makeRepo({
            "records/AAA/AAA-00001-fixture/AAA-00001_META.yaml": RECORD_META
        });

        try {
            const result = runAssertions(root, {
                packs: ["../outside.rules.yaml"]
            });
            assert.ok(result.loadErrors.length > 0);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it("rejects a rule with no message", () => {
        // A rule reporting a token and no instruction tells a reader that
        // something is wrong and not what to do about it.
        const root = makeRepo({
            "rules/test.rules.yaml": `schema: record-schema-assertion-pack
schema_version: 1
rules:
  - id: NAMELESS
    kind: forbid
    select: { source: { include: ["**/*.yaml"] }, path: "$" }
`
        });

        try {
            const result = run(root);
            assert.ok(
                result.loadErrors.some((error) => error.includes("message"))
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it("rejects an unknown rule kind", () => {
        const root = makeRepo({
            "rules/test.rules.yaml": `schema: record-schema-assertion-pack
schema_version: 1
rules:
  - id: BOGUS
    kind: interpret
    message: "x"
`
        });

        try {
            const result = run(root);
            assert.ok(
                result.loadErrors.some((error) => error.includes("kind"))
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
