import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
    renderAssertionReport,
    runAssertionReport
} from "../../lib/record-schema/assertions/AssertionReporter.mjs";

function withRepository(run) {
    const root = mkdtempSync(join(tmpdir(), "record-schema-report-"));
    try {
        run(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

test("table reports aggregate selector rows, order joined values, and filter verbose details", () => {
    withRepository((root) => {
        writeFileSync(
            join(root, "data.json"),
            JSON.stringify({
                stores: [
                    {
                        name: "small",
                        segments: [{ name: "header", size: 2, note: null, order: 2 }]
                    },
                    {
                        name: "large",
                        segments: [
                            { name: "body", size: 8, note: "body", order: 1 },
                            { name: "header", size: 2, note: "header", order: 0 }
                        ]
                    },
                    {
                        name: "empty",
                        segments: []
                    }
                ]
            })
        );
        writeFileSync(join(root, "pack.yaml"), `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.reports
sources:
  data: { include: ["data.json"] }
selectors:
  segments:
    source: data
    path: "$.stores[*]"
    each: "$.segments[*]"
    bind:
      store_name: { from: scope, path: "$.name" }
      segment_name: "$.name"
      segment_size: "$.size"
      note: "$.note"
      note_order: "$.order"
      detail: { literal: true }
  empty_stores:
    source: data
    path: "$.stores[*]"
    where: { "$.segments[*]": { count_eq: 0 } }
    bind:
      store_name: "$.name"
      segment_name: { literal: null }
      segment_size: { literal: 0 }
      note: { literal: null }
      note_order: { literal: 2 }
      detail: { literal: false }
reports:
  storage:
    title: storage report
    sections:
      - kind: table
        select: [segments, empty_stores]
        group: "{#store_name}"
        sort: { by: bytes, direction: descending }
        columns:
          - { key: store, title: store, value: "#store_name", aggregate: first, width: 8 }
          - { key: bytes, title: bytes, value: "#segment_size", aggregate: sum, width: 5, align: right }
          - { key: notes, title: notes, value: "#note", aggregate: join, order_by: "#note_order", separator: "; ", null: "-", gap_before: 2 }
        detail_include: "#detail"
        details:
          - { key: segment, value: "#segment_name", width: 8 }
          - { key: bytes, value: "#segment_size", width: 5, align: right }
rules: []
`);

        const result = runAssertionReport(root, {
            packs: ["pack.yaml"],
            report: "storage",
            verbose: true
        });
        assert.deepEqual(result.errors, []);
        const section = result.sections[0];
        assert.ok(section.kind === "table");
        assert.deepEqual(section.rows.map((row) => row.store), [
            "large",
            "small",
            "empty"
        ]);
        assert.equal(section.rows[0].bytes, 10);
        assert.equal(section.rows[0].notes, "header; body");
        assert.equal(section.details.empty.length, 0);
        const rendered = renderAssertionReport(result);
        assert.match(rendered, /storage report/);
        assert.ok(rendered.indexOf("large") < rendered.indexOf("small"));
        assert.match(rendered, /header; body/);
        assert.doesNotMatch(rendered, /empty\s+0[\s\S]*\n\s+null/);
    });
});

test("reach reports summarize and catalogue the same reach analysis as the rule", () => {
    withRepository((root) => {
        writeFileSync(
            join(root, "data.json"),
            JSON.stringify({
                nodes: [
                    { group: "Mode", name: "Alpha" },
                    { group: "Mode", name: "Beta" }
                ],
                uses: ["Alpha"]
            })
        );
        writeFileSync(join(root, "pack.yaml"), `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.reach-report
sources:
  data: { include: ["data.json"] }
selectors:
  nodes:
    source: data
    path: "$.nodes[*]"
    bind: { group_name: "$.group", member_name: "$.name" }
reports:
  realisation:
    sections:
      - { kind: reach_summary, rules: [REALISATION] }
      - kind: reach_catalogue
        rule: REALISATION
        group: "{#group_name}"
        label: "{#group_name}"
        member: "{#member_name}"
        realised_tiers: [reached]
        show_tiers: [dead]
rules:
  - id: REALISATION
    kind: reach
    nodes: nodes
    node_key: "{#member_name}"
    node_group: "#group_name"
    edges:
      - select: { source: data, path: "$.uses[*]" }
        key: "{#value}"
    message: unreachable
`);

        const result = runAssertionReport(root, {
            packs: ["pack.yaml"],
            report: "realisation"
        });
        assert.deepEqual(result.errors, []);
        assert.ok(result.sections[0].kind === "reach_summary");
        assert.deepEqual(result.sections[0].rows[0], {
            rule: "REALISATION",
            nodes: 2,
            reached: 1,
            unreachable: 1,
            accepted: 0,
            tiers: { reached: 1, dead: 1 },
            categories: {}
        });
        assert.ok(result.sections[1].kind === "reach_catalogue");
        assert.deepEqual(result.sections[1].rows[0].weak, [
            { member: "Beta", tier: "dead" }
        ]);
        assert.match(
            renderAssertionReport(result),
            /Mode: 1\/2 realised — Beta\[dead\]/
        );
    });
});
