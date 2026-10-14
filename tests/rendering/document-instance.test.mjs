import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Metafile } from "../../lib/record-schema/Metafile.mjs";
import { Document } from "../../lib/record-schema/Document.mjs";
import { RenderPack } from "../../lib/record-schema/RenderPack.mjs";
import { DocumentInstance } from "../../lib/record-schema/templates/DocumentInstance.mjs";
import { Schema } from "../../lib/record-schema/Schema.mjs";

/** @type {import("../../lib/record-schema/templates/types.mjs").TemplateContract} */
const contract = {
    fields: {
        status: {
            type: "enum",
            required: true,
            values: ["draft", "execution"]
        },
        party: { type: "text", required: true },
        effective: {
            type: "date",
            required: true,
            format: "DD MMM YYYY",
            draft_placeholder: "[Effective date]"
        },
        amount: {
            type: "decimal",
            required: true,
            decimal_places: 2,
            rounding: "half-up"
        },
        flag: {
            type: "boolean",
            required: true,
            true_label: "Yes",
            false_label: "No"
        }
    },
    metadata: [
        { target: "status.phase", field: "status" },
        { target: "entity_name", field: "party" }
    ],
    datasets: {},
    signatures: {},
    instances: { current: "current.yaml" },
    default_instance: "current"
};
/** @type {import("../../lib/record-schema/templates/types.mjs").InstanceData} */
const data = {
    schema: "record-schema-document-instance",
    schema_version: 1,
    template: { record_id: "TPL-00099", version: "2" },
    document_id: "COPY-17",
    fields: {
        party: "**Literal value**",
        amount: "12345678901234567890.125",
        flag: false
    },
    datasets: {},
    stages: {
        draft: {
            document: { version: "1-draft", path: "draft.pdf" },
            fields: { status: "draft" }
        },
        for_execution: {
            document: { version: "1", path: "execution.pdf" },
            fields: { status: "execution", effective: "2026-09-15" }
        }
    },
    default_stage: "for_execution"
};
function meta() {
    return new Metafile({
        id: "TPL-00099",
        document: { version: "2" },
        title: "Example",
        status: { phase: "draft" }
    });
}
function instance(
    c = contract,
    d = data,
    stage = "for_execution",
    path = "/tmp/current.yaml"
) {
    return new DocumentInstance(
        structuredClone(c),
        structuredClone(d),
        stage,
        path,
        meta()
    );
}

test("stage overlay is typed, metadata is bound, and original template remains unchanged", () => {
    const original = meta();
    const bound = new DocumentInstance(
        contract,
        data,
        "for_execution",
        "/tmp/current.yaml",
        original
    );
    assert.equal(bound.metafile.data.entity_name, "**Literal value**");
    assert.equal(bound.metafile.data.status.phase, "execution");
    assert.equal(original.data.status.phase, "draft");
    assert.equal(bound.text.effective, "15 Sep 2026");
    assert.equal(bound.text.amount, "12345678901234567890.13");
    assert.equal(bound.text.flag, "No");
    assert.equal(
        instance(contract, data, "draft").text.effective,
        "[Effective date]"
    );
    const source = Document.fromText(
        "# Title\n\nHello {{field:party}}.",
        "/tmp/main.md"
    ).toRenderSource(
        RenderPack.empty("test"),
        { path: "main.md", doc_type: "DOC" },
        ".",
        { instance: bound }
    );
    assert.equal(
        source.root.children
            .find((node) => node.type === "paragraph")
            .getTextContent()
            .includes("**Literal value**"),
        true
    );
    assert.equal(original.data.document.version, "2");
});

test("unknown, missing, invalid and stale bindings fail before render", () => {
    const missing = structuredClone(data);
    delete missing.stages.for_execution.fields.effective;
    assert.throws(
        () => instance(contract, missing),
        /Required execution field/
    );
    const unknown = structuredClone(data);
    unknown.fields.surprise = "x";
    assert.throws(() => instance(contract, unknown), /Undeclared/);
    const invalid = structuredClone(data);
    invalid.stages.for_execution.fields.effective = "2026-02-30";
    assert.throws(() => instance(contract, invalid), /Invalid calendar date/);
    const stale = structuredClone(data);
    stale.template.version = "3";
    assert.throws(() => instance(contract, stale), /identity\/version/);
    assert.throws(
        () => instance().bindText("{{field:unknown}}"),
        /Unknown template/
    );
    const duplicate = structuredClone(contract);
    duplicate.metadata.push(duplicate.metadata[0]);
    assert.throws(() => instance(duplicate), /Duplicate metadata/);
});

test("dataset bindings preserve duplicate rows, check hashes and reject path escape", () => {
    const directory = mkdtempSync(join(tmpdir(), "document-binding-"));
    try {
        const table =
            "Item\tAmount\nSame\t1.25\nSame\t1.25\n{{field:unknown}}\t2.00\n";
        writeFileSync(join(directory, "rows.tsv"), table);
        const c = structuredClone(contract),
            d = structuredClone(data);
        c.datasets.movements = {
            columns: [
                { header: "Item", type: "text", align: "left", width: "auto" },
                {
                    header: "Amount",
                    type: "decimal",
                    align: "right",
                    width: "max-content",
                    decimal_places: 2,
                    rounding: "reject"
                }
            ]
        };
        d.datasets.movements = {
            path: "rows.tsv",
            sha256: createHash("sha256").update(table).digest("hex")
        };
        const bound = instance(
            c,
            d,
            "for_execution",
            join(directory, "current.yaml")
        );
        assert.deepEqual(bound.dataset("movements").rows, [
            ["Same", "1.25"],
            ["Same", "1.25"],
            ["{{field:unknown}}", "2.00"]
        ]);
        const source = Document.fromText(
            ":::data-table @movements\n:::",
            join(directory, "main.md")
        ).toRenderSource(
            RenderPack.empty("test"),
            { path: "main.md", doc_type: "DOC" },
            ".",
            { instance: bound }
        );
        assert.equal(source.root.children[0].children.length, 4);
        d.datasets.movements.sha256 = "0".repeat(64);
        assert.throws(
            () =>
                instance(
                    c,
                    d,
                    "for_execution",
                    join(directory, "current.yaml")
                ),
            /checksum mismatch/
        );
        d.datasets.movements.path = "../outside.tsv";
        assert.throws(
            () =>
                instance(
                    c,
                    d,
                    "for_execution",
                    join(directory, "current.yaml")
                ),
            /leaves/
        );
    } finally {
        rmSync(directory, { recursive: true });
    }
});

test("signing slots are stable, explicit and unique", () => {
    const c = structuredClone(contract);
    c.signatures.operator = {
        party_label: "{{field:party}}",
        signer_role: "operator",
        required: true
    };
    const bound = instance(c);
    assert.throws(() => bound.assertSigningSlots(), /absent/);
    const source = Document.fromText(
        ":::signature-block single @operator\n:::",
        "/tmp/main.md"
    ).toRenderSource(
        RenderPack.empty("test"),
        { path: "main.md", doc_type: "DOC" },
        ".",
        { instance: bound }
    );
    assert.equal(source.root.children[0].attrs.fieldName, "operator");
    bound.assertSigningSlots();
    assert.throws(() => bound.signature("operator"), /more than once/);
});

test("published schemas reject opaque metadata and wrong native types", () => {
    const template = Schema.load(
        new URL(
            "../../../record-schema/schema/document.template.schema.json",
            import.meta.url
        ).pathname
    );
    const input = Schema.load(
        new URL(
            "../../../record-schema/schema/document.instance.schema.json",
            import.meta.url
        ).pathname
    );
    assert.deepEqual(template.validate(contract), []);
    assert.deepEqual(input.validate(data), []);
    const wrong = {
        ...structuredClone(data),
        fields: { ...data.fields, amount: 1.2 }
    };
    assert.notEqual(input.validate(wrong).length, 0);
    const unknown = structuredClone(contract);
    unknown.metadata.push({ target: "extensions.anything", field: "party" });
    assert.notEqual(template.validate(unknown).length, 0);
});
