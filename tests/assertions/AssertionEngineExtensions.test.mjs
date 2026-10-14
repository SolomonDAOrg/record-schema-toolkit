import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAssertions } from "../../lib/record-schema/assertions/AssertionRunner.mjs";

function withRepository(run) {
    const root = mkdtempSync(join(tmpdir(), "record-schema-assertions-"));
    try {
        run(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

test("selector extraction, lexing, binding, and projection compose", () => {
    withRepository((root) => {
        writeFileSync(join(root, "doc.md"), "Uses `Alpha + Beta` and `Gamma`.\n");
        writeFileSync(join(root, "pack.yaml"), `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.extract
sources:
  docs: { include: ["*.md"], parse: markdown }
languages:
  expression: {}
selectors:
  tokens:
    source: docs
    path: "$.inline_code[*].text"
    extract:
      pattern: "(?<body>.+)"
      group: body
    lex:
      language: expression
      kinds: [identifier]
      roles: [reference]
    bind:
      original: "{#value}"
rules:
  - id: TOKENS
    kind: unique
    select: tokens
    key: "{#value}"
    message: duplicate token
`);
        const result = runAssertions(root, { packs: ["pack.yaml"] });
        assert.deepEqual(result.loadErrors, []);
        assert.equal(result.findings.length, 0);
        assert.equal(result.selectionCounts.TOKENS, 3);
    });
});

test("table list aggregation is available to derive expressions", () => {
    withRepository((root) => {
        writeFileSync(join(root, "data.json"), JSON.stringify({ rows: [
            { group: "a", value: 2 },
            { group: "a", value: 3 },
            { group: "b", value: 7 }
        ] }));
        writeFileSync(join(root, "pack.yaml"), `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.tables
sources:
  data: { include: ["data.json"] }
tables:
  grouped:
    source: data
    path: "$.rows[*]"
    key: "{$.group}"
    value: "$.value"
    mode: list
rules:
  - id: TABLE_SUM
    kind: derive
    scope:
      source: data
      path: "$"
    bind: {}
    assert: "sum(lookup(grouped, 'a')) == 5 && first(lookup(grouped, 'b')) == 7"
    message: aggregate table failed
`);
        const result = runAssertions(root, { packs: ["pack.yaml"] });
        assert.deepEqual(result.findings, []);
    });
});

test("derive resolves referenced tables without projecting unrelated tables", () => {
    withRepository((root) => {
        writeFileSync(
            join(root, "data.json"),
            JSON.stringify({ rows: [{ group: "a", value: 5 }] })
        );
        writeFileSync(join(root, "pack.yaml"), `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.tables.referenced-only
sources:
  data: { include: ["data.json"] }
tables:
  grouped:
    source: data
    path: "$.rows[*]"
    key: "{$.group}"
    value: "$.value"
  unrelated:
    with_tables: [unrelated]
    select:
      source: data
      path: "$.rows[*]"
    key: "{$.group}"
    value: "$.value"
rules:
  - id: REFERENCED_TABLE
    kind: derive
    scope:
      source: data
      path: "$"
    bind: {}
    assert: "lookup(grouped, 'a') == 5"
    message: referenced table failed
`);
        const result = runAssertions(root, { packs: ["pack.yaml"] });
        assert.deepEqual(result.findings, []);
    });
});

test("lex rules report syntax and unresolved references", () => {
    withRepository((root) => {
        writeFileSync(join(root, "data.json"), JSON.stringify({ definitions: ["Alpha"], expressions: ["Alpha + Missing", "Alpha Beta"] }));
        writeFileSync(join(root, "pack.yaml"), `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.lex
sources:
  data: { include: ["data.json"] }
languages:
  expression: {}
rules:
  - id: EXPR
    kind: lex
    select:
      source: data
      path: "$.expressions[*]"
    language: expression
    defines:
      source: data
      path: "$.definitions[*]"
    define_key: "{#value}"
    ignore: []
    message: "{#detail}"
`);
        const result = runAssertions(root, { packs: ["pack.yaml"] });
        assert.equal(result.findings.length, 3);
        assert.ok(result.findings.some((finding) => finding.message.includes("Missing")));
        assert.ok(result.findings.some((finding) => finding.message.includes("adjacent")));
    });
});


test("named selector lists expand recursively", () => {
    withRepository((root) => {
        writeFileSync(join(root, "data.json"), JSON.stringify({
            definitions: ["Alpha", "Beta"],
            uses: ["Alpha", "Beta"]
        }));
        writeFileSync(join(root, "pack.yaml"), `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.selector-list
sources:
  data: { include: ["data.json"] }
selectors:
  declarations:
    - source: data
      path: "$.definitions[0]"
    - source: data
      path: "$.definitions[1]"
rules:
  - id: RESOLVE
    kind: resolve
    uses:
      source: data
      path: "$.uses[*]"
    use_key: "{#value}"
    defines: declarations
    define_key: "{#value}"
    message: unresolved declaration
`);
        const result = runAssertions(root, { packs: ["pack.yaml"] });
        assert.deepEqual(result.loadErrors, []);
        assert.deepEqual(result.findings, []);
        assert.deepEqual(result.resolveCounts.RESOLVE, {
            uses: 2,
            defines: 2
        });
    });
});


test("selector path lists are alternative paths", () => {
    withRepository((root) => {
        writeFileSync(join(root, "data.json"), JSON.stringify({
            first: ["Alpha"],
            second: ["Beta"]
        }));
        writeFileSync(join(root, "pack.yaml"), `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.path-list
sources:
  data: { include: ["data.json"] }
rules:
  - id: BOTH
    kind: unique
    select:
      source: data
      path: ["$.first[*]", "$.second[*]"]
    key: "{#value}"
    message: duplicate value
`);
        const result = runAssertions(root, { packs: ["pack.yaml"] });
        assert.deepEqual(result.loadErrors, []);
        assert.deepEqual(result.findings, []);
        assert.equal(result.selectionCounts.BOTH, 2);
    });
});

test("selector expansion emits a deterministic cross product", () => {
    withRepository((root) => {
        writeFileSync(join(root, "data.json"), JSON.stringify({ rows: [{ names: ["A", "B"], arguments: { x: 1, y: 2 } }] }));
        writeFileSync(join(root, "pack.yaml"), `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.expand
sources:
  data: { include: ["data.json"] }
selectors:
  pairs:
    source: data
    path: "$.rows[*]"
    bind:
      names: "$.names"
      arguments: "$.arguments"
      argument_names:
        expression: "keys(arguments)"
    expand:
      name: "#names"
      argument: "#argument_names"
    project:
      expression: "concat(name, ':', argument)"
rules:
  - id: PAIRS
    kind: count
    select: pairs
    min: 4
    max: 4
    message: wrong expansion cardinality
`);
        const result = runAssertions(root, { packs: ["pack.yaml"] });
        assert.deepEqual(result.loadErrors, []);
        assert.deepEqual(result.findings, []);
        assert.equal(result.selectionCounts.PAIRS, 4);
    });
});

test("selector scope keys can bind the selected property name", () => {
    withRepository((root) => {
        writeFileSync(join(root, "data.json"), JSON.stringify({
            records: {
                First: { accounts: [{ name: "one" }, { name: "shared" }] },
                Second: { accounts: [{ name: "shared" }] }
            }
        }));
        writeFileSync(join(root, "pack.yaml"), `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.scope-key-property
sources:
  data: { include: ["data.json"] }
selectors:
  accounts:
    source: data
    path: "$.records.*"
    scope_key: "{#key}"
    each: "$.accounts[*]"
rules:
  - id: UNIQUE_ACCOUNT
    kind: unique
    select: accounts
    key: "{$.name}"
    within: "{#scope_key}"
    message: duplicate account
`);
        const result = runAssertions(root, { packs: ["pack.yaml"] });
        assert.deepEqual(result.loadErrors, []);
        assert.deepEqual(result.findings, []);
        assert.equal(result.selectionCounts.UNIQUE_ACCOUNT, 3);
    });
});

test("resolve supports scoped exemptions and duplicate-use collapse", () => {
    withRepository((root) => {
        writeFileSync(join(root, "data.json"), JSON.stringify({
            uses: [
                { scope: "a", canonical: "Absent", argument: "x" },
                { scope: "a", canonical: "Missing", argument: "x" },
                { scope: "a", canonical: "Missing", argument: "x" }
            ],
            definitions: [],
            exemptions: [{ scope: "a", canonical: "Absent" }]
        }));
        writeFileSync(join(root, "pack.yaml"), `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.resolve-exemptions
sources:
  data: { include: ["data.json"] }
rules:
  - id: RESOLVE
    kind: resolve
    uses: { source: data, path: "$.uses[*]" }
    use_key: "{$.canonical}::{$.argument}"
    use_scope: "{$.scope}"
    defines: { source: data, path: "$.definitions[*]" }
    define_key: "{#value}"
    define_scope: "{$.scope}"
    exempts: { source: data, path: "$.exemptions[*]" }
    exempt_key: "{$.canonical}"
    exempt_scope: "{$.scope}"
    use_exempt_key: "{$.canonical}"
    use_exempt_scope: "{$.scope}"
    dedupe_uses: true
    message: unresolved
`);
        const result = runAssertions(root, { packs: ["pack.yaml"] });
        assert.equal(result.findings.length, 1);
        assert.equal(result.findings[0].message, "unresolved");
    });
});

test("resolve activation definitions restrict checked uses", () => {
    withRepository((root) => {
        writeFileSync(join(root, "data.json"), JSON.stringify({
            uses: [
                { scope: "a", canonical: "Active", argument: "missing" },
                { scope: "a", canonical: "Inactive", argument: "ignored" }
            ],
            definitions: [],
            active: [{ scope: "a", canonical: "Active" }]
        }));
        writeFileSync(join(root, "pack.yaml"), `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.resolve-activation
sources:
  data: { include: ["data.json"] }
rules:
  - id: RESOLVE
    kind: resolve
    uses: { source: data, path: "$.uses[*]" }
    use_key: "{$.canonical}::{$.argument}"
    use_scope: "{$.scope}"
    defines: { source: data, path: "$.definitions[*]" }
    define_key: "{#value}"
    define_scope: "{$.scope}"
    activation_defines: { source: data, path: "$.active[*]" }
    activation_key: "{$.canonical}"
    activation_scope: "{$.scope}"
    use_activation_key: "{$.canonical}"
    use_activation_scope: "{$.scope}"
    message: "{#key}"
`);
        const result = runAssertions(root, { packs: ["pack.yaml"] });
        assert.equal(result.findings.length, 1);
        assert.equal(result.findings[0].message, "Active::missing");
    });
});

test("selectors and projected tables can depend on named tables", () => {
    withRepository((root) => {
        writeFileSync(join(root, "data.json"), JSON.stringify({
            widths: [
                { name: "A", bytes: 2 },
                { name: "B", bytes: 3 }
            ],
            fields: [
                { owner: "Row", type: "A" },
                { owner: "Row", type: "B" }
            ]
        }));
        writeFileSync(join(root, "pack.yaml"), `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.table-dependencies
sources:
  data: { include: ["data.json"] }
tables:
  widths:
    source: data
    path: "$.widths[*]"
    key: "{$.name}"
    value: "$.bytes"
  owner_widths:
    with_tables: [widths]
    select:
      source: data
      path: "$.fields[*]"
    key: "{$.owner}"
    value:
      expression: "lookup(widths, at(value, '$.type'))"
    mode: sum
selectors:
  resolved_fields:
    source: data
    path: "$.fields[*]"
    with_tables: [widths]
    post_where:
      expr:
        bind:
          type: "$.type"
        assert: "defined(lookup(widths, type))"
rules:
  - id: TABLE_DEPENDENCY
    kind: derive
    scope: resolved_fields
    bind: {}
    assert: "lookup(owner_widths, 'Row') == 5"
    message: table dependency failed
`);
        const result = runAssertions(root, { packs: ["pack.yaml"] });
        assert.deepEqual(result.loadErrors, []);
        assert.deepEqual(result.findings, []);
        assert.equal(result.selectionCounts.TABLE_DEPENDENCY, 2);
    });
});

test("derive dedupe_by evaluates one representative row per rendered key", () => {
    withRepository((root) => {
        writeFileSync(join(root, "data.json"), JSON.stringify({
            rows: [
                { name: "same", valid: false },
                { name: "same", valid: false }
            ]
        }));
        writeFileSync(join(root, "pack.yaml"), `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.derive-dedupe
sources:
  data: { include: ["data.json"] }
rules:
  - id: DEDUPE
    kind: derive
    scope: { source: data, path: "$.rows[*]" }
    dedupe_by: "{$.name}"
    bind:
      valid: "$.valid"
    assert: "valid == true"
    message: invalid
`);
        const result = runAssertions(root, { packs: ["pack.yaml"] });
        assert.equal(result.findings.length, 1);
    });
});

test("reach supports aliases, origin-aware observations, proximity, and propagation", () => {
    withRepository((root) => {
        writeFileSync(join(root, "data.json"), JSON.stringify({
            nodes: [
                { key: "exact", aliases: ["ExactValue"], origin: "decl-a", context: "ExactKind" },
                { key: "word", aliases: ["Qualified.Value"], origin: "decl-b", context: "WordKind" },
                { key: "nearby", aliases: ["near_value"], origin: "decl-c", context: "NearbyKind" },
                { key: "propagated", aliases: ["LentValue"], origin: "decl-d", context: "LentKind" },
                { key: "self-only", aliases: ["SelfValue"], origin: "same", context: "SelfKind" },
                { key: "dead", aliases: ["DeadValue"], origin: "decl-e", context: "DeadKind" }
            ],
            exact: [
                { value: "ExactValue", origin: "use-a" },
                { value: "SelfValue", origin: "same" }
            ],
            word: [{ text: "optional Qualified.Value inside a larger scalar", origin: "use-b" }],
            nearby: [{ text: "type: NearbyKind\ndefault: near_value\nother: value", origin: "use-c" }],
            declarations: [{ name: "ProfileName", origin: "base", body: { selected: "LentValue" } }],
            activations: [{ text: "profile: ProfileName", origin: "unit" }]
        }));
        writeFileSync(join(root, "pack.yaml"), `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.advanced-reach
sources:
  data: { include: ["data.json"] }
rules:
  - id: REACH
    kind: reach
    nodes: { source: data, path: "$.nodes[*]" }
    node_key: "{$.key}"
    node_aliases: "$.aliases"
    node_origin: "$.origin"
    node_context: "$.context"
    edges:
      - select: { source: data, path: "$.exact[*]" }
        value: "$.value"
        origin: "$.origin"
        match: exact
        exclude_same_origin: true
      - select: { source: data, path: "$.word[*]" }
        value: "$.text"
        origin: "$.origin"
        match: word
        exclude_same_origin: true
      - select: { source: data, path: "$.nearby[*]" }
        value: "$.text"
        origin: "$.origin"
        match: nearby
        window: 2
        boundary: identifier_hyphen
        exclude_same_origin: true
    propagations:
      - declarations: { source: data, path: "$.declarations[*]" }
        name: "$.name"
        values:
          expression: "scalar_values(value)"
        origin: "$.origin"
        activations: { source: data, path: "$.activations[*]" }
        activation_text: "$.text"
        activation_origin: "$.origin"
        exclude_same_origin: true
    message: "{#key} is unreachable"
`);
        const result = runAssertions(root, { packs: ["pack.yaml"] });
        assert.deepEqual(result.loadErrors, []);
        assert.deepEqual(
            result.findings.map((finding) => finding.message).sort(),
            ["dead is unreachable", "self-only is unreachable"]
        );
    });
});


test("agree projections can deliberately select the last duplicate", () => {
    withRepository((root) => {
        writeFileSync(join(root, "data.json"), JSON.stringify({
            documented: [{ name: "A", value: 1 }, { name: "A", value: 2 }],
            declared: [{ name: "A", value: 2 }]
        }));
        writeFileSync(join(root, "pack.yaml"), `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.agree-last
sources:
  data: { include: ["data.json"] }
rules:
  - id: LAST
    kind: agree
    left:
      source: data
      path: "$.documented[*]"
      key: "{$.name}"
      value: "{$.value}"
      on_duplicate: last
    right:
      source: data
      path: "$.declared[*]"
      key: "{$.name}"
      value: "{$.value}"
    require_left: true
    require_right: true
    compare: number
    message: mismatch
`);
        const result = runAssertions(root, { packs: ["pack.yaml"] });
        assert.deepEqual(result.loadErrors, []);
        assert.deepEqual(result.findings, []);
    });
});

test("derive assertions expose selector bindings without hash prefixes", () => {
    withRepository((root) => {
        writeFileSync(join(root, "data.json"), JSON.stringify({ value: 7 }));
        writeFileSync(join(root, "pack.yaml"), `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.derive-selector-bindings
sources:
  data: { include: ["data.json"] }
rules:
  - id: SELECTOR_BINDINGS
    kind: derive
    scope: { source: data, path: "$.value" }
    bind:
      selected: "#value"
    assert: "file == 'data.json' && selected == 7"
    message: selector bindings unavailable
`);
        const result = runAssertions(root, { packs: ["pack.yaml"] });
        assert.deepEqual(result.loadErrors, []);
        assert.deepEqual(result.findings, []);
    });
});

test("selectors expose repository metadata, text, lines, and bytes", () => {
    withRepository((root) => {
        const directory = join(root, "nested");
        mkdirSync(directory);
        writeFileSync(join(directory, "sample.txt"), "alpha\nbeta\n");
        writeFileSync(join(root, "pack.yaml"), `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.unit-bindings
sources:
  text:
    include: nested/sample.txt
    parse: none
rules:
  - id: UNIT_BINDINGS
    kind: derive
    scope:
      source: text
      path: "$"
    bind:
      file: "#file"
      directory: "#directory"
      base_name: "#base_name"
      stem: "#stem"
      extension: "#extension"
      raw: "#raw"
      bytes: "#bytes"
      lines: "#lines"
    assert: >-
      file == 'nested/sample.txt' && directory == 'nested' &&
      base_name == 'sample.txt' && stem == 'sample' && extension == 'txt' &&
      digest_hex(raw) == 'e49c81e2d2f84e259d40e2fb8192f3bcd198b355184845d76d8f58807d0d78ee' &&
      len(lines) == 3 && len(bytes) == 11 &&
      digest_hex(bytes) == 'e49c81e2d2f84e259d40e2fb8192f3bcd198b355184845d76d8f58807d0d78ee'
    message: unit bindings differ
`);
        const result = runAssertions(root, { packs: ["pack.yaml"] });
        assert.deepEqual(result.loadErrors, []);
        assert.deepEqual(result.findings, []);
        assert.equal(result.selectionCounts.UNIT_BINDINGS, 1);
    });
});
