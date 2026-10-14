import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runAssertions } from "../../lib/record-schema/assertions/AssertionRunner.mjs";

function createRepository() {
    const root = mkdtempSync(join(tmpdir(), "record-schema-mode-"));
    mkdirSync(join(root, "rules"));
    mkdirSync(join(root, "records"));
    writeFileSync(join(root, "records", "TEST-00001_DEF.yaml"), "schema: fixture\nvalue: bad\n");
    writeFileSync(
        join(root, "rules", "mode.rules.yaml"),
        `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.mode
sources:
  records:
    include: records/*.yaml
rules:
  - id: MODE_ONLY
    kind: forbid
    modes: [production]
    severity: advisory
    severity_by_mode:
      production: error
    select:
      source: records
      path: $.value
    message: production finding
`
    );
    return root;
}

test("rules can be scoped and promoted by execution mode", () => {
    const root = createRepository();
    const development = runAssertions(root, {
        packs: ["rules/mode.rules.yaml"],
        mode: "development"
    });
    assert.deepEqual(development.executed, []);
    assert.equal(development.findings.length, 0);

    const production = runAssertions(root, {
        packs: ["rules/mode.rules.yaml"],
        mode: "production"
    });
    assert.deepEqual(production.executed, ["MODE_ONLY"]);
    assert.equal(production.findings.length, 1);
    assert.equal(production.findings[0].severity, "error");
});
