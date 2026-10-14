import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "../../bin/assert.mjs");

test("assert --json remains machine-readable with --stats and --summary", () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "record-schema-assert-cli-"));
    try {
        mkdirSync(join(rootDirectory, "rules"), { recursive: true });
        mkdirSync(join(rootDirectory, "records"), { recursive: true });
        writeFileSync(
            join(rootDirectory, "records", "sample.yaml"),
            "value: present\n",
            "utf8"
        );
        writeFileSync(
            join(rootDirectory, "rules", "test.rules.yaml"),
            [
                "schema: record-schema-assertion-pack",
                "schema_version: 2",
                "pack_id: test.cli",
                "sources:",
                "  corpus:",
                "    include: records/**/*.yaml",
                "selectors:",
                "  root:",
                "    source: corpus",
                "    path: $",
                "rules:",
                "  - id: PRESENT",
                "    kind: require",
                "    severity: error",
                "    scope: root",
                "    must:",
                "      value: { eq: present }",
                "    message: value missing",
                ""
            ].join("\n"),
            "utf8"
        );

        const output = execFileSync(
            process.execPath,
            [
                cli,
                "--root",
                rootDirectory,
                "--packs",
                "rules/test.rules.yaml",
                "--json",
                "--stats",
                "--summary"
            ],
            { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
        );
        const result = JSON.parse(output);
        assert.equal(result.executed, 1);
        assert.deepEqual(result.vacuous, []);
        assert.equal(result.scope_counts.PRESENT, 1);
        assert.equal(result.findings.length, 0);
    } finally {
        rmSync(rootDirectory, { recursive: true, force: true });
    }
});
