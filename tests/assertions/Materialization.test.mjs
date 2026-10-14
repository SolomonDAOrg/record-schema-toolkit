import test from "node:test";
import assert from "node:assert/strict";
import {
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseYaml } from "../../lib/parsing/yaml.mjs";
import { runAssertions } from "../../lib/record-schema/assertions/AssertionRunner.mjs";
import { materializeAssertions } from "../../lib/record-schema/assertions/AssertionMaterializer.mjs";

function withRepository(run) {
    const root = mkdtempSync(join(tmpdir(), "record-schema-materialize-"));
    try {
        run(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

test("derive materialization rewrites only the declared inline mapping field", () => {
    withRepository((root) => {
        const original = `schema: example\nstorage: { profile: slotted, worst_case_bytes: 3, maximum_worst_case_bytes: 20 }\nexpected: 9\n`;
        writeFileSync(join(root, "data.yaml"), original);
        writeFileSync(join(root, "pack.yaml"), `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.derive-materialization
sources:
  data: { include: ["data.yaml"] }
rules:
  - id: DERIVED
    kind: derive
    scope: { source: data, path: "$" }
    bind:
      written: "$.storage.worst_case_bytes"
      desired: "$.expected"
    assert: "written == desired"
    message: stale derived value
    materialize:
      operation: yaml_inline_mapping_field
      mapping_key: storage
      field: worst_case_bytes
      value: "#desired"
`);

        const before = runAssertions(root, { packs: ["pack.yaml"] });
        assert.equal(before.findings.length, 1);

        const dryRun = materializeAssertions(root, {
            packs: ["pack.yaml"]
        });
        assert.deepEqual(dryRun.errors, []);
        assert.equal(dryRun.outputs.length, 1);
        assert.equal(dryRun.outputs[0].changed, true);
        assert.match(dryRun.outputs[0].content, /worst_case_bytes: 9/);
        assert.match(
            dryRun.outputs[0].content,
            /maximum_worst_case_bytes: 20/
        );
        assert.deepEqual(
            parseYaml(dryRun.outputs[0].content),
            Object.assign(parseYaml(original), {
                storage: {
                    profile: "slotted",
                    worst_case_bytes: 9,
                    maximum_worst_case_bytes: 20
                }
            })
        );

        const written = materializeAssertions(root, {
            packs: ["pack.yaml"],
            write: true
        });
        assert.deepEqual(written.errors, []);
        assert.match(readFileSync(join(root, "data.yaml"), "utf8"), /worst_case_bytes: 9/);
        assert.deepEqual(
            runAssertions(root, { packs: ["pack.yaml"] }).findings,
            []
        );
    });
});

test("flow-mapping formatter rewrites mappings and leaves prose braces unchanged", () => {
    withRepository((root) => {
        writeFileSync(
            join(root, "data.yaml"),
            `schema: example\nrow: {name: Alpha, count: 2}\ndescription: "literal {brace} text"\n`
        );
        writeFileSync(join(root, "pack.yaml"), `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.format-materialization
sources:
  data: { include: ["data.yaml"] }
rules:
  - id: SPACING
    kind: format
    source: data
    formatter: yaml_flow_mapping_spacing
    line_budget: 20
    message: flow mapping spacing drift
    materialize:
      operation: rewrite
`);

        const before = runAssertions(root, { packs: ["pack.yaml"] });
        assert.equal(before.findings.length, 1);
        assert.equal(before.findings[0].rule, "SPACING");

        const result = materializeAssertions(root, {
            packs: ["pack.yaml"],
            write: true
        });
        assert.deepEqual(result.errors, []);
        assert.equal(result.outputs.length, 1);
        const content = readFileSync(join(root, "data.yaml"), "utf8");
        assert.match(content, /row: \{ name: Alpha, count: 2 \}/);
        assert.match(content, /description: "literal \{brace\} text"/);
        assert.deepEqual(
            runAssertions(root, { packs: ["pack.yaml"] }).findings,
            []
        );
    });
});

test("reach baseline materialization preserves reviewed categories and classifies new subjects", () => {
    withRepository((root) => {
        writeFileSync(
            join(root, "data.yaml"),
            `nodes:\n  - { name: Alpha, proposed: should_bind }\n  - { name: Beta, proposed: should_bind }\n  - { name: Gamma, proposed: canonical_register }\nuses: [Alpha]\n`
        );
        writeFileSync(
            join(root, "baseline.yaml"),
            `schema: test-baseline\n# retained heading\ndead_members:\n  - { name: Beta, category: remove }\n\nother: retained\n`
        );
        writeFileSync(join(root, "pack.yaml"), `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.reach-materialization
sources:
  data: { include: ["data.yaml"] }
  baseline: { include: ["baseline.yaml"] }
selectors:
  nodes:
    source: data
    path: "$.nodes[*]"
    bind:
      member_name: "$.name"
      proposed_category: "$.proposed"
rules:
  - id: DEAD
    kind: reach
    nodes: nodes
    node_key: "{#member_name}"
    edges:
      - select: { source: data, path: "$.uses[*]" }
        key: "{#value}"
    baseline: baseline
    baseline_entries: "$.dead_members[*]"
    baseline_key: "{$.name}"
    baseline_category: category
    baseline_categories: [should_bind, canonical_register, remove]
    message: unreachable
    materialize:
      operation: reach_baseline
      file: baseline.yaml
      sections:
        - rule: DEAD
          field: dead_members
          entry:
            name: "#subject_key"
          category_field: category
          default_category: "#proposed_category"
          sort_by: [name]
`);

        const before = runAssertions(root, { packs: ["pack.yaml"] });
        assert.equal(before.findings.length, 1);
        assert.match(before.findings[0].message, /unreachable/);

        const result = materializeAssertions(root, {
            packs: ["pack.yaml"],
            write: true
        });
        assert.deepEqual(result.errors, []);
        assert.equal(result.outputs.length, 1);
        const content = readFileSync(join(root, "baseline.yaml"), "utf8");
        assert.match(content, /# retained heading/);
        assert.match(content, /\{ name: Beta, category: remove \}/);
        assert.match(
            content,
            /\{ name: Gamma, category: canonical_register \}/
        );
        assert.match(content, /other: retained/);
        assert.deepEqual(
            runAssertions(root, { packs: ["pack.yaml"] }).findings,
            []
        );
    });
});
