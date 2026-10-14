import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateAssertionReport } from "../../lib/record-schema/assertions/AssertionReport.mjs";

function withRepository(run) {
    const root = mkdtempSync(join(tmpdir(), "record-schema-report-"));
    try {
        run(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

test("table reports aggregate, sort, and expose verbose details", () => {
    withRepository((root) => {
        writeFileSync(
            join(root, "data.yaml"),
            `items:\n  - { group: Beta, value: 3, note: third }\n  - { group: Alpha, value: 2, note: second }\n  - { group: Alpha, value: 1, note: first }\n`
        );
        writeFileSync(
            join(root, "pack.yaml"),
            `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.report-table
sources:
  data: { include: ["data.yaml"] }
selectors:
  items:
    source: data
    path: "$.items[*]"
    bind:
      group_name: "$.group"
      item_value: "$.value"
      note: "$.note"
reports:
  totals:
    title: totals
    sections:
      - kind: table
        title: rows
        select: items
        group: "{#group_name}"
        columns:
          - { key: group, value: "#group_name", aggregate: first, title: Group, width: 8 }
          - { key: count, value: "#item_value", aggregate: count, title: Count, width: 5, align: right }
          - { key: total, value: "#item_value", aggregate: sum, title: Total, width: 5, align: right }
          - { key: notes, value: "#note", aggregate: join, order_by: "#item_value", separator: "/", title: Notes }
        details:
          - { key: value, value: "#item_value", title: Value, width: 5, align: right }
          - { key: note, value: "#note", title: Note }
        sort:
          - { by: total, direction: descending }
          - { by: group, direction: ascending }
`
        );

        const compact = generateAssertionReport(root, {
            packs: ["pack.yaml"],
            report: "totals"
        });
        assert.deepEqual(compact.errors, []);
        assert.match(compact.text, /^totals\n\nrows\n/m);
        assert.match(compact.text, /Alpha\s+2\s+3\s+first\/second/);
        assert.match(compact.text, /Beta\s+1\s+3\s+third/);
        const table = compact.sections[0];
        assert.ok(table.kind === "table");
        assert.deepEqual(
            table.rows.map((row) => ({
                key: row.key,
                count: row.count,
                total: row.total,
                notes: row.notes
            })),
            [
                { key: "Alpha", count: 2, total: 3, notes: "first/second" },
                { key: "Beta", count: 1, total: 3, notes: "third" }
            ]
        );
        assert.deepEqual(table.details, {});

        const verbose = generateAssertionReport(root, {
            packs: ["pack.yaml"],
            report: "totals",
            verbose: true
        });
        assert.deepEqual(verbose.errors, []);
        assert.ok(verbose.sections[0].kind === "table");
        assert.deepEqual(verbose.sections[0].details.Alpha, [
            { value: 2, note: "second" },
            { value: 1, note: "first" }
        ]);
        assert.match(verbose.text, /second/);
        assert.match(verbose.text, /first/);
    });
});

test("reach reports consume the same analysis as reach validation", () => {
    withRepository((root) => {
        writeFileSync(
            join(root, "data.yaml"),
            `nodes:\n  - { group: G, name: Alpha }\n  - { group: G, name: Beta }\n  - { group: H, name: Gamma }\nuses: [Alpha]\n`
        );
        writeFileSync(
            join(root, "baseline.yaml"),
            `dead:\n  - { name: Beta, category: retained }\n`
        );
        writeFileSync(
            join(root, "pack.yaml"),
            `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.report-reach
sources:
  data: { include: ["data.yaml"] }
  baseline: { include: ["baseline.yaml"] }
selectors:
  nodes:
    source: data
    path: "$.nodes[*]"
    bind:
      group_name: "$.group"
      member_name: "$.name"
rules:
  - id: DEAD
    kind: reach
    nodes: nodes
    node_key: "{#member_name}"
    node_group: "#group_name"
    node_context: { literal: Kind }
    edges:
      - select: { source: data, path: "$.uses[*]" }
        key: "{#value}"
        tier: direct
    tiers: [direct]
    unreachable_tier: dead
    baseline: baseline
    baseline_entries: "$.dead[*]"
    baseline_key: "{$.name}"
    baseline_category: category
    baseline_categories: [retained]
    message: unreachable
reports:
  reach:
    sections:
      - kind: reach_summary
        title: summary
        rule: DEAD
      - kind: reach_catalogue
        title: catalogue
        rule: DEAD
        group: "{#group}|{#context}"
        label: "{#group} {#context}"
        member: "{#member_name}"
        realised_tiers: [direct]
        show_tiers: [dead]
`
        );

        const report = generateAssertionReport(root, {
            packs: ["pack.yaml"],
            report: "reach"
        });
        assert.deepEqual(report.errors, []);
        assert.match(report.text, /DEAD\s+3 nodes,\s+2 unreachable \(1 accepted\)/);
        assert.match(report.text, /G Kind: 1\/2 realised — Beta\[dead\]/);
        assert.match(report.text, /H Kind: 0\/1 realised — Gamma\[dead\]/);
        assert.ok(report.sections[0].kind === "reach_summary");
        assert.deepEqual(report.sections[0].rows[0], {
            rule: "DEAD",
            nodes: 3,
            reached: 1,
            unreachable: 2,
            accepted: 1,
            tiers: { direct: 1, dead: 2 },
            categories: { retained: 1 }
        });
    });
});

test("reach reports support deterministic templates and declaration order", () => {
    withRepository((root) => {
        writeFileSync(
            join(root, "data.yaml"),
            `nodes:\n  - { group: Zeta, name: First }\n  - { group: Alpha, name: Second }\nuses: [First]\n`
        );
        writeFileSync(
            join(root, "baseline.yaml"),
            `dead:\n  - { name: Second, category: retained }\n`
        );
        writeFileSync(
            join(root, "pack.yaml"),
            `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.report-template
sources:
  data: { include: ["data.yaml"] }
  baseline: { include: ["baseline.yaml"] }
selectors:
  nodes:
    source: data
    path: "$.nodes[*]"
    bind: { group_name: "$.group", member_name: "$.name" }
reports:
  reach:
    sections:
      - kind: reach_summary
        rules: [LIVE]
        category_groups:
          - { key: accepted, categories: [retained, absent] }
        lines:
          - "nodes={#LIVE_nodes} dead={#LIVE_tier_dead} accepted={#category_group_accepted} absent={#category_absent}"
      - kind: reach_catalogue
        rule: LIVE
        group: "{#group_name}"
        label: "{#group_name}"
        member: "{#member_name}"
        realised_tiers: [reached]
        show_tiers: [dead]
        order: source
rules:
  - id: LIVE
    kind: reach
    nodes: nodes
    node_key: "{#member_name}"
    edges:
      - select: { source: data, path: "$.uses[*]" }
        key: "{#value}"
    baseline: baseline
    baseline_entries: "$.dead[*]"
    baseline_key: "{$.name}"
    baseline_category: category
    baseline_categories: [retained]
    message: unreachable
`
        );

        const report = generateAssertionReport(root, {
            packs: ["pack.yaml"],
            report: "reach"
        });
        assert.deepEqual(report.errors, []);
        assert.match(report.text, /^nodes=2 dead=1 accepted=1 absent=0/m);
        assert.ok(report.text.indexOf("Zeta:") < report.text.indexOf("Alpha:"));
    });
});
