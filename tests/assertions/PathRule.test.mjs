import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runAssertions } from "../../lib/record-schema/assertions/AssertionRunner.mjs";

test("path rules resolve files and reject traversal", () => {
    const root = mkdtempSync(join(tmpdir(), "record-schema-path-"));
    mkdirSync(join(root, "rules"));
    mkdirSync(join(root, "data"));
    writeFileSync(join(root, "data", "exists.txt"), "x");
    writeFileSync(join(root, "data", "paths.yaml"), "paths:\n  - data/exists.txt\n  - ../outside\n");
    writeFileSync(join(root, "rules", "paths.yaml"), `schema: record-schema-assertion-pack
schema_version: 2
sources:
  data:
    include: data/paths.yaml
rules:
  - id: PATHS
    kind: path
    select:
      source: data
      path: $.paths[*]
    value: "{#value}"
    path_kind: file
    message: "{#target} is absent"
`);
    const result = runAssertions(root, { packs: ["rules/paths.yaml"] });
    assert.equal(result.findings.length, 1);
    assert.match(result.findings[0].message, /outside/);
});
