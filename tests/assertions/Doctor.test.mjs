import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { diagnoseAssertions } from "../../lib/record-schema/assertions/AssertionDoctor.mjs";

function withRepository(run) {
    const root = mkdtempSync(join(tmpdir(), "record-schema-doctor-test-"));
    try {
        run(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

test("doctor proves runtime health without treating corpus findings as installation failures", () => {
    withRepository((root) => {
        writeFileSync(join(root, "data.yaml"), "values: [1]\n");
        writeFileSync(
            join(root, "pack.yaml"),
            `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.doctor
sources:
  data: { include: ["data.yaml"] }
rules:
  - id: EXPECT_TWO
    kind: require
    select: { source: data, path: "$.values[*]" }
    must: { eq: 2 }
    message: expected two
`
        );

        const result = diagnoseAssertions(root, { packs: ["pack.yaml"] });
        assert.equal(result.ok, true);
        assert.equal(result.ruleCount, 1);
        assert.deepEqual(result.errors, []);
        assert.equal(
            result.checks.find((check) => check.id === "engine")?.status,
            "ok"
        );
    });
});

test("doctor fails closed on a missing pack", () => {
    withRepository((root) => {
        const result = diagnoseAssertions(root, { packs: ["absent.yaml"] });
        assert.equal(result.ok, false);
        assert.match(result.errors.join("\n"), /does not resolve/);
    });
});
