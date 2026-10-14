import test from "node:test";
import assert from "node:assert/strict";
import {
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { materializeAssertions } from "../../lib/record-schema/assertions/AssertionMaterializer.mjs";
import { runAssertions } from "../../lib/record-schema/assertions/AssertionRunner.mjs";

function withRepository(run) {
    const root = mkdtempSync(join(tmpdir(), "record-schema-materialize-"));
    try {
        run(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

function derivedPack() {
    return `schema: record-schema-assertion-pack
schema_version: 2
pack_id: test.derived-materialization
sources:
  documents: { include: ["document.yaml"] }
rules:
  - id: DERIVED
    kind: derive
    scope:
      source: documents
      path: "$"
    bind:
      written: "$.storage.worst_case_bytes"
      derived: { expression: "2 + 3" }
    require_bindings: false
    assert: "written == derived"
    materialize:
      operation: yaml_inline_mapping_field
      mapping_key: storage
      field: worst_case_bytes
      value: "#derived"
    message: derived value drift
`;
}

test("derived materialization updates only one inline mapping field", () => {
    withRepository((root) => {
        writeFileSync(join(root, "pack.yaml"), derivedPack());
        writeFileSync(
            join(root, "document.yaml"),
            `schema: test\nstorage: { profile: split, note: "comma, brace } retained", worst_case_bytes: 1 } # keep\nsegments: []\n`
        );

        const preview = materializeAssertions(root, {
            packs: ["pack.yaml"]
        });
        assert.deepEqual(preview.errors, []);
        assert.equal(preview.outputs.length, 1);
        assert.equal(preview.outputs[0].changed, true);
        assert.match(
            preview.outputs[0].content,
            /worst_case_bytes: 5 \} # keep/
        );
        assert.match(
            preview.outputs[0].content,
            /note: "comma, brace \} retained"/
        );

        const written = materializeAssertions(root, {
            packs: ["pack.yaml"],
            write: true
        });
        assert.deepEqual(written.errors, []);
        assert.deepEqual(
            runAssertions(root, { packs: ["pack.yaml"] }).findings,
            []
        );
        assert.equal(
            materializeAssertions(root, { packs: ["pack.yaml"] }).outputs[0]
                .changed,
            false
        );
    });
});

test("derived materialization can append an absent scalar field", () => {
    withRepository((root) => {
        writeFileSync(join(root, "pack.yaml"), derivedPack());
        writeFileSync(
            join(root, "document.yaml"),
            `schema: test\nstorage: { profile: split }\nsegments: []\n`
        );

        const result = materializeAssertions(root, {
            packs: ["pack.yaml"],
            write: true
        });
        assert.deepEqual(result.errors, []);
        assert.match(
            readFileSync(join(root, "document.yaml"), "utf8"),
            /storage: \{ profile: split, worst_case_bytes: 5 \}/
        );
    });
});
