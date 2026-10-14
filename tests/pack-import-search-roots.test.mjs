import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { FormattingPack } from "../lib/record-schema/FormattingPack.mjs";
import { RenderPack } from "../lib/record-schema/RenderPack.mjs";

function writeJson(path, value) {
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

test("formatting pack imports may resolve from a fallback schema root", () => {
    const repositoryRoot = mkdtempSync(resolve(tmpdir(), "record-schema-formatting-root-"));
    const schemaRoot = mkdtempSync(resolve(tmpdir(), "record-schema-formatting-fallback-"));
    writeJson(resolve(schemaRoot, "formatting/packs/base.json"), {
        schema: "record-schema-formatting-pack",
        schema_version: 1,
        pack_id: "base",
        document_policies: {
            defaults: { output_encoding: "utf-8" },
        },
    });
    writeJson(resolve(repositoryRoot, "formatting/packs/deployment.json"), {
        schema: "record-schema-formatting-pack",
        schema_version: 1,
        pack_id: "deployment",
        imports: ["formatting/packs/base.json"],
        document_policies: {
            defaults: { output_newlines: "lf" },
        },
    });

    const result = FormattingPack.loadMerged(
        repositoryRoot,
        ["formatting/packs/deployment.json"],
        [schemaRoot],
    );
    assert.deepEqual(result.packs.map((pack) => pack.getId()), ["base", "deployment"]);
    assert.equal(result.policy.defaults.output_encoding, "utf-8");
    assert.equal(result.policy.defaults.output_newlines, "lf");
});

test("render pack imports may resolve from a fallback schema root", () => {
    const repositoryRoot = mkdtempSync(resolve(tmpdir(), "record-schema-render-root-"));
    const schemaRoot = mkdtempSync(resolve(tmpdir(), "record-schema-render-fallback-"));
    writeJson(resolve(schemaRoot, "render/packs/base.json"), {
        schema: "record-schema-render-pack",
        schema_version: 1,
        pack_id: "base",
        document_policies: {
            defaults: { output_encoding: "utf-8" },
        },
    });
    writeJson(resolve(repositoryRoot, "render/packs/deployment.json"), {
        schema: "record-schema-render-pack",
        schema_version: 1,
        pack_id: "deployment",
        imports: ["render/packs/base.json"],
        document_policies: {
            defaults: { output_newlines: "lf" },
        },
    });

    const result = RenderPack.loadMerged(
        repositoryRoot,
        ["render/packs/deployment.json"],
        [schemaRoot],
    );
    assert.deepEqual(result.packs.map((pack) => pack.getId()), ["base", "deployment"]);
    assert.equal(result.policy.defaults.output_encoding, "utf-8");
    assert.equal(result.policy.defaults.output_newlines, "lf");
});
