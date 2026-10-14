import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAssertions } from "../../lib/record-schema/assertions/AssertionRunner.mjs";

function withRepository(run) {
    const root = mkdtempSync(join(tmpdir(), "record-schema-cycle-"));
    try {
        run(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

test("cycle rules report deterministic strongly connected components", () => {
    withRepository((root) => {
        writeFileSync(
            join(root, "graph.json"),
            JSON.stringify({
                nodes: ["A", "B", "C", "D"],
                edges: [
                    { from: "A", to: "B" },
                    { from: "B", to: "A" },
                    { from: "C", to: "C" },
                    { from: "D", to: "outside" }
                ]
            })
        );
        writeFileSync(
            join(root, "pack.yaml"),
            `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.cycle
sources:
  graph: { include: ["graph.json"] }
rules:
  - id: CYCLES
    kind: cycle
    severity: advisory
    nodes: { source: graph, path: "$.nodes[*]" }
    node_key: "{#value}"
    edges:
      select: { source: graph, path: "$.edges[*]" }
      from: "{$.from}"
      to: "{$.to}"
    message: "component ({#count}): {#members}"
`
        );

        const result = runAssertions(root, { packs: ["pack.yaml"] });
        assert.deepEqual(result.loadErrors, []);
        assert.equal(result.findings.length, 1);
        assert.equal(result.findings[0].severity, "advisory");
        assert.equal(result.findings[0].message, "component (2): A, B");
    });
});

test("cycle rules can include self loops explicitly", () => {
    withRepository((root) => {
        writeFileSync(
            join(root, "graph.json"),
            JSON.stringify({ nodes: ["A"], edges: [{ from: "A", to: "A" }] })
        );
        writeFileSync(
            join(root, "pack.yaml"),
            `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.self-cycle
sources:
  graph: { include: ["graph.json"] }
rules:
  - id: SELF_CYCLE
    kind: cycle
    nodes: { source: graph, path: "$.nodes[*]" }
    node_key: "{#value}"
    edges:
      select: { source: graph, path: "$.edges[*]" }
      from: "{$.from}"
      to: "{$.to}"
    minimum_size: 1
    include_self: true
    message: "{#members}"
`
        );
        const result = runAssertions(root, { packs: ["pack.yaml"] });
        assert.deepEqual(result.loadErrors, []);
        assert.equal(result.findings.length, 1);
        assert.equal(result.findings[0].message, "A");
    });
});
