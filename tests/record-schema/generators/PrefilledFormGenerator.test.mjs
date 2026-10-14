// @ts-check

/**
 * Issuing filled forms for a record: the META overlay is read, the packs in
 * force are resolved, and each declared output is written from the record's
 * document instance.
 *
 * The test builds a whole repository — upstream configuration, a form pack, the
 * PDF it pins, and a record whose META binds a template — because the point of
 * this class is that those pieces reach each other.
 *
 * @module tests/record-schema/generators/PrefilledFormGenerator_test
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

import {
    loadPdf,
    readAcroForm,
    readFormValues
} from "../../../lib/pdf/index.mjs";
import { Repository } from "../../../lib/record-schema/Repository.mjs";
import { Schema } from "../../../lib/record-schema/Schema.mjs";
import { PrefilledFormGenerator } from "../../../lib/record-schema/generators/PrefilledFormGenerator.mjs";

import { buildFormFixture } from "../../pdf/forms/form-fixture.mjs";
import {
    HAS_SCHEMA_REPO,
    SCHEMA_ROOT,
    W9_PATH,
    W9_SHA256
} from "../forms/fixture.mjs";

const WHEN_PRESENT = { skip: !HAS_SCHEMA_REPO };
const PAGE1 = "topmostSubform[0].Page1[0].";

/**
 * A repository containing one record that issues a filled W-9.
 * @param {{ outputs?: Object[], packs?: string[], configurePack?: boolean }} [options]
 * @returns {{ root: string, cleanup: () => void }}
 */
function repository(options = {}) {
    const root = mkdtempSync(join(tmpdir(), "prefilled-forms-"));
    /** @param {string} rel @param {string} text */
    const write = (rel, text) => {
        const path = resolve(root, rel);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text, "utf8");
    };

    mkdirSync(resolve(root, "forms/pdf"), { recursive: true });
    copyFileSync(W9_PATH, resolve(root, "forms/pdf/fw9.pdf"));
    write(
        "forms/packs/w9.json",
        JSON.stringify({
            schema: "record-schema-form-pack",
            schema_version: 1,
            pack_id: "local-w9",
            forms: {
                "irs-w9": {
                    document: { path: "forms/pdf/fw9.pdf", sha256: W9_SHA256 },
                    xfa: "remove",
                    need_appearances: false,
                    unresolved: "skip",
                    bindings: [
                        {
                            bind: "text",
                            field: "LegalName",
                            target: PAGE1 + "f1_01[0]"
                        },
                        {
                            bind: "text",
                            field: "Address",
                            target: PAGE1 + "Address_ReadOrder[0].f1_07[0]"
                        },
                        {
                            bind: "segments",
                            field: "EmployerIdentificationNumber",
                            retain: "digits",
                            segments: [
                                { target: PAGE1 + "f1_14[0]", length: 2 },
                                { target: PAGE1 + "f1_15[0]", length: 7 }
                            ]
                        }
                    ]
                }
            }
        })
    );

    const upstream = [
        "schema: record-schema-upstream",
        "schema_version: 1",
        "",
        "record_schema:"
    ];
    if (options.configurePack !== false) {
        upstream.push("  form_packs:", "    - forms/packs/w9.json");
    }
    upstream.push(
        "  provides:",
        "    - id: tax",
        "      name: Tax",
        "      kind: schema",
        ""
    );
    write("SCHEMA_UPSTREAM.yaml", upstream.join("\n"));

    /** @type {Object} */
    const declared = {
        outputs: options.outputs || [
            { form: "irs-w9", path: "forms/w9.pdf", label: "Form W-9" }
        ]
    };
    if (options.packs) {
        declared.packs = options.packs;
    }

    write(
        "records/TAX-00001-w9/TAX-00001_META.yaml",
        [
            "schema: record-schema",
            "schema_version: 1",
            "id: TAX-00001",
            "series_code: TAX",
            "series: 1",
            "title: Taxpayer identification",
            "document:",
            "  version: '1'",
            "status:",
            "  phase: execution",
            "  last_updated: 2026-09-21T00:00:00.000Z",
            "extensions:",
            "  prefilled_forms: " + JSON.stringify(declared),
            "template:",
            "  fields:",
            "    LegalName:",
            "      type: text",
            "      required: true",
            "    Address:",
            "      type: text",
            "      required: true",
            "    EmployerIdentificationNumber:",
            "      type: text",
            "      required: false",
            "      draft_placeholder: '[EIN]'",
            "  metadata: []",
            "  datasets: {}",
            "  signatures: {}",
            "  instances:",
            "    current: TAX-00001_INSTANCE-current.yaml",
            "  default_instance: current",
            ""
        ].join("\n")
    );
    write(
        "records/TAX-00001-w9/TAX-00001_INSTANCE-current.yaml",
        [
            "schema: record-schema-document-instance",
            "schema_version: 1",
            "template:",
            "  record_id: TAX-00001",
            "  version: '1'",
            "document_id: W9",
            "fields:",
            "  LegalName: Solomon Labs Pty Ltd",
            "  Address: Level 3, 12 Example Street",
            "  EmployerIdentificationNumber: 98-7654321",
            "datasets: {}",
            "stages:",
            "  draft:",
            "    document:",
            "      version: 1-draft",
            "      path: forms/w9-draft.pdf",
            "  for_execution:",
            "    document:",
            "      version: '1'",
            "      path: forms/w9.pdf",
            "default_stage: for_execution",
            ""
        ].join("\n")
    );

    return {
        root,
        cleanup: () => rmSync(root, { recursive: true, force: true })
    };
}

/**
 * Open the repository and find its single record.
 * @param {string} root
 * @returns {{ repo: Repository, record: Object }}
 */
function openRecord(root) {
    const repo = Repository.fromFolder(root);
    const records = repo.findRecords();
    assert.equal(records.length, 1, "the tree holds one record");
    return { repo, record: records[0] };
}

test("the overlay accepts the record's declaration", WHEN_PRESENT, () => {
    const space = repository();
    try {
        const overlay = Schema.load(
            join(
                SCHEMA_ROOT,
                "overlays/prefilled-forms.record.meta.schema.json"
            )
        );
        const { record } = openRecord(space.root);
        assert.deepEqual(overlay.validate(record.metafile.data), []);
    } finally {
        space.cleanup();
    }
});

test("a record declaring no forms is reported", WHEN_PRESENT, () => {
    const space = repository();
    try {
        const { repo, record } = openRecord(space.root);
        delete record.metafile.data.extensions;
        assert.equal(PrefilledFormGenerator.declares(record), false);
        const result = new PrefilledFormGenerator(repo).generate(record, {});
        assert.equal(result.success, false);
        assert.match(result.error, /declares no prefilled forms/);
    } finally {
        space.cleanup();
    }
});

test("the declared form is written from the instance", WHEN_PRESENT, () => {
    const space = repository();
    try {
        const { repo, record } = openRecord(space.root);
        assert.equal(PrefilledFormGenerator.declares(record), true);

        const result = new PrefilledFormGenerator(repo).generate(record, {});
        assert.equal(result.success, true, result.error);
        assert.equal(result.stage, "for_execution");
        assert.equal(result.outputs.length, 1);

        const output = result.outputs[0];
        assert.equal(output.form, "irs-w9");
        assert.equal(output.label, "Form W-9");
        assert.equal(output.path, "forms/w9.pdf");
        assert.equal(output.flattened, false);
        assert.ok(existsSync(output.outputPath));

        const bytes = new Uint8Array(readFileSync(output.outputPath));
        assert.equal(
            createHash("sha256").update(bytes).digest("hex"),
            output.hash,
            "the reported hash is of what was written"
        );

        const values = readFormValues(loadPdf(bytes));
        assert.deepEqual(values.get(PAGE1 + "f1_01[0]"), {
            kind: "text",
            text: "Solomon Labs Pty Ltd"
        });
        assert.deepEqual(values.get(PAGE1 + "f1_14[0]"), {
            kind: "text",
            text: "98"
        });
        assert.deepEqual(values.get(PAGE1 + "f1_15[0]"), {
            kind: "text",
            text: "7654321"
        });
    } finally {
        space.cleanup();
    }
});

test("the published form survives beneath the copy", WHEN_PRESENT, () => {
    const space = repository();
    try {
        const { repo, record } = openRecord(space.root);
        const result = new PrefilledFormGenerator(repo).generate(record, {});
        const original = readFileSync(resolve(space.root, "forms/pdf/fw9.pdf"));
        const issued = readFileSync(result.outputs[0].outputPath);
        assert.deepEqual(
            new Uint8Array(issued.subarray(0, original.length)),
            new Uint8Array(original)
        );
    } finally {
        space.cleanup();
    }
});

test("a flattened output is no longer a form", WHEN_PRESENT, () => {
    const space = repository({
        outputs: [{ form: "irs-w9", path: "forms/w9.pdf", flatten: true }]
    });
    try {
        const { repo, record } = openRecord(space.root);
        const result = new PrefilledFormGenerator(repo).generate(record, {});
        assert.equal(result.outputs[0].flattened, true);
        const bytes = new Uint8Array(
            readFileSync(result.outputs[0].outputPath)
        );
        assert.equal(readAcroForm(loadPdf(bytes)), null);
    } finally {
        space.cleanup();
    }
});

test("a record may add an unconfigured pack", WHEN_PRESENT, () => {
    const space = repository({
        configurePack: false,
        packs: ["forms/packs/w9.json"]
    });
    try {
        const { repo, record } = openRecord(space.root);
        assert.deepEqual(repo.getFormPackPaths(), []);
        const result = new PrefilledFormGenerator(repo).generate(record, {});
        assert.equal(result.success, true, result.error);
        assert.ok(existsSync(result.outputs[0].outputPath));
    } finally {
        space.cleanup();
    }
});

test("a form no pack declares names the ones in force", WHEN_PRESENT, () => {
    const space = repository({
        outputs: [{ form: "irs-w8", path: "forms/w8.pdf" }]
    });
    try {
        const { repo, record } = openRecord(space.root);
        const result = new PrefilledFormGenerator(repo).generate(record, {});
        assert.equal(result.success, false);
        assert.match(
            result.error,
            /No form pack declares "irs-w8"; the packs in force declare irs-w9/
        );
    } finally {
        space.cleanup();
    }
});

test("an existing output is not overwritten unless asked", WHEN_PRESENT, () => {
    const space = repository();
    try {
        const { repo, record } = openRecord(space.root);
        const generator = new PrefilledFormGenerator(repo);
        assert.equal(generator.generate(record, {}).success, true);

        const second = generator.generate(record, {});
        assert.equal(second.success, false);
        assert.match(second.error, /already exists: forms\/w9\.pdf/);

        assert.equal(
            generator.generate(record, { overwrite: true }).success,
            true
        );
    } finally {
        space.cleanup();
    }
});

test("an output path is refused if it leaves the record", WHEN_PRESENT, () => {
    const space = repository();
    try {
        const { repo, record } = openRecord(space.root);
        record.metafile.data.extensions.prefilled_forms.outputs[0].path =
            "../escaped.pdf";
        assert.throws(
            () => new PrefilledFormGenerator(repo).generate(record, {}),
            /leaves the record directory/
        );
    } finally {
        space.cleanup();
    }
});

test("the draft stage is selectable and reported", WHEN_PRESENT, () => {
    const space = repository();
    try {
        const { repo, record } = openRecord(space.root);
        record.metafile.data.status.phase = "draft";
        const result = new PrefilledFormGenerator(repo).generate(record, {
            stage: "draft"
        });
        assert.equal(result.success, true, result.error);
        assert.equal(result.stage, "draft");
    } finally {
        space.cleanup();
    }
});

test("a signed output is never overwritten", WHEN_PRESENT, () => {
    const space = repository();
    try {
        const { repo, record } = openRecord(space.root);
        const signedPath = resolve(
            space.root,
            "records/TAX-00001-w9/forms/w9.pdf"
        );
        mkdirSync(dirname(signedPath), { recursive: true });
        writeFileSync(
            signedPath,
            buildFormFixture(
                [
                    {
                        id: 10,
                        body:
                            "<< /Type /Annot /Subtype /Widget /FT /Sig" +
                            " /T (sig) /V 12 0 R" +
                            " /Rect [50 600 300 620] /P 3 0 R >>"
                    },
                    { id: 12, body: "<< /Type /Sig /Contents <00> >>" }
                ],
                [10]
            )
        );

        assert.throws(
            () =>
                new PrefilledFormGenerator(repo).generate(record, {
                    overwrite: true
                }),
            /A signed PDF cannot be overwritten by prefilling/
        );
    } finally {
        space.cleanup();
    }
});

test("an unsigned existing output may be replaced", WHEN_PRESENT, () => {
    const space = repository();
    try {
        const { repo, record } = openRecord(space.root);
        const generator = new PrefilledFormGenerator(repo);
        const first = generator.generate(record, {});
        const second = generator.generate(record, { overwrite: true });
        assert.equal(second.success, true, second.error);
        assert.equal(
            second.outputs[0].hash,
            first.outputs[0].hash,
            "the same instance issues the same bytes"
        );
    } finally {
        space.cleanup();
    }
});
