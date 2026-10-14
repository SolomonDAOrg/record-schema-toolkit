import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Schema } from "../../lib/record-schema/Schema.mjs";
import { validateAssertionPackDocuments } from "../../lib/record-schema/assertions/AssertionPack.mjs";

function withRepository(run) {
    const root = mkdtempSync(join(tmpdir(), "record-schema-pack-schema-"));
    try {
        run(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

const packSchema = new Schema({
    type: "object",
    additionalProperties: false,
    required: ["schema", "schema_version"],
    properties: {
        schema: { const: "record-schema-assertion-pack" },
        schema_version: { type: "integer" },
        pack_id: { type: "string" },
        imports: { type: "array", items: { type: "string" } },
        rules: { type: "array" }
    }
});

test("normative pack validation follows imports and rejects unknown fields", () => {
    withRepository((root) => {
        writeFileSync(
            join(root, "base.yaml"),
            `schema: record-schema-assertion-pack
schema_version: 2
pack_id: base
unexpected: true
rules: []
`
        );
        writeFileSync(
            join(root, "pack.yaml"),
            `schema: record-schema-assertion-pack
schema_version: 2
pack_id: root
imports: [base.yaml]
rules: []
`
        );
        const errors = validateAssertionPackDocuments(
            root,
            ["pack.yaml"],
            packSchema
        );
        assert.equal(errors.length, 1);
        assert.match(errors[0], /base\.yaml/);
        assert.match(errors[0], /unexpected/);
    });
});
