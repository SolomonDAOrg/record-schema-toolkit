import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runAssertionsIsolated } from "../../../lib/record-schema/assertions/AssertionProcess.mjs";

test("runAssertionsIsolated returns assertion results from a disposable process", () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "assertion-process-"));
    try {
        mkdirSync(join(rootDirectory, "data"));
        mkdirSync(join(rootDirectory, "rules"));
        writeFileSync(
            join(rootDirectory, "data", "value.json"),
            `${JSON.stringify({ value: "ok" })}\n`
        );
        writeFileSync(
            join(rootDirectory, "rules", "fixture.rules.yaml"),
            [
                "schema: record-schema-assertion-pack",
                "schema_version: 1",
                "pack_id: fixture",
                "sources:",
                "  values:",
                "    include: [data/*.json]",
                "selectors:",
                "  selected_value:",
                "    source: values",
                "    path: $.value",
                "rules:",
                "  - id: VALUE_FORM",
                "    kind: pattern",
                "    severity: error",
                "    select: selected_value",
                "    match: ^ok$",
                "    message: value is not canonical",
                ""
            ].join("\n")
        );

        const result = runAssertionsIsolated(rootDirectory, {
            packs: ["rules/fixture.rules.yaml"]
        });

        assert.deepEqual(result.executed, ["VALUE_FORM"]);
        assert.equal(result.findings.length, 0);
        assert.equal(result.unitCount, 2);
    } finally {
        rmSync(rootDirectory, { recursive: true, force: true });
    }
});
