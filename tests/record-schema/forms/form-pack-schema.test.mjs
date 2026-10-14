// @ts-check

/**
 * form.pack.schema.json itself, and the packs published beside it.
 *
 * The schema lives in the record-schema repository; these tests skip when no
 * checkout of it is beside the toolkit, the way the PDF form tests skip without
 * their fixtures.
 *
 * @module tests/record-schema/forms/form-pack-schema_test
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { FormPack } from "../../../lib/record-schema/FormPack.mjs";
import { Schema } from "../../../lib/record-schema/Schema.mjs";
import { verifyAgainstDocument } from "../../../lib/record-schema/forms/verify.mjs";
import { loadPdf, readAcroForm } from "../../../lib/pdf/index.mjs";

import { HAS_SCHEMA_REPO, SCHEMA_ROOT, packData } from "./fixture.mjs";

const WHEN_PRESENT = { skip: !HAS_SCHEMA_REPO };
const SCHEMA_PATH = join(SCHEMA_ROOT, "schema/form.pack.schema.json");

/** @returns {Schema} */
function schema() {
    return Schema.load(SCHEMA_PATH);
}

/** The packs published in the schema repository. */
const PUBLISHED = [
    { file: "irs-w9-2024-03.json", form: "irs-w9", bindings: 14, targets: 23 },
    {
        file: "irs-w8ben-e-2021-10.json",
        form: "irs-w8ben-e-part1",
        bindings: 10,
        targets: 22
    }
];

test("the test pack validates against the schema", WHEN_PRESENT, () => {
    assert.deepEqual(schema().validate(packData()), []);
});

test("the schema pins the pack's identity", WHEN_PRESENT, () => {
    const loaded = schema();
    assert.equal(
        loaded.validate(packData({ schema: "record-schema-render-pack" }))
            .length > 0,
        true
    );
    assert.equal(loaded.validate(packData({ pack_id: "Up" })).length > 0, true);
    assert.equal(
        loaded.validate(packData({ schema_version: 0 })).length > 0,
        true
    );
});

test("the schema requires a checksum for the document", WHEN_PRESENT, () => {
    const data = packData();
    data.forms["irs-w9"].document = { path: "a.pdf" };
    assert.match(
        JSON.stringify(schema().validate(data)),
        /sha256.*Missing required property/
    );
});

test("the schema requires an explicit xfa decision", WHEN_PRESENT, () => {
    const data = packData();
    delete data.forms["irs-w9"].xfa;
    assert.match(
        JSON.stringify(schema().validate(data)),
        /xfa.*Missing required property/
    );
});

test("the schema closes the form and binding objects", WHEN_PRESENT, () => {
    const extraOnForm = packData();
    extraOnForm.forms["irs-w9"].surprise = true;
    assert.match(
        JSON.stringify(schema().validate(extraOnForm)),
        /Unknown property/
    );

    const extraOnBinding = packData();
    extraOnBinding.forms["irs-w9"].bindings[0].surprise = true;
    assert.equal(schema().validate(extraOnBinding).length > 0, true);
});

test("the schema rejects a binding of no declared kind", WHEN_PRESENT, () => {
    const data = packData();
    data.forms["irs-w9"].bindings = [
        { bind: "sideways", field: "Name", target: "t" }
    ];
    assert.equal(schema().validate(data).length > 0, true);
});

test("the schema rejects an unaddressable field name", WHEN_PRESENT, () => {
    const data = packData();
    data.forms["irs-w9"].bindings[0].field = "legal_name";
    assert.equal(schema().validate(data).length > 0, true);
});

for (const published of PUBLISHED) {
    const path = join(SCHEMA_ROOT, "forms/packs", published.file);
    const when = { skip: !HAS_SCHEMA_REPO || !existsSync(path) };

    test(`${published.file} validates against the schema`, when, () => {
        assert.deepEqual(
            schema().validate(JSON.parse(readFileSync(path, "utf8"))),
            []
        );
    });

    test(`${published.file} passes the pack's own checks`, when, () => {
        assert.deepEqual(FormPack.load(path).validate(), {
            valid: true,
            errors: []
        });
    });

    test(`${published.file} matches the PDF it pins`, when, () => {
        const pack = FormPack.load(path);
        const form = pack.getForm(published.form);
        const documentPath = pack.resolveDocumentPath(
            published.form,
            SCHEMA_ROOT
        );
        assert.ok(
            existsSync(documentPath),
            "the pinned document is present: " + documentPath
        );

        const acroForm = readAcroForm(
            loadPdf(new Uint8Array(readFileSync(documentPath)))
        );
        assert.deepEqual(
            verifyAgainstDocument(form, acroForm),
            [],
            "every target and appearance state exists in the document"
        );
        assert.equal(form.bindings.length, published.bindings);

        let targets = 0;
        for (const binding of form.bindings) {
            targets =
                targets +
                (binding.bind === "segments"
                    ? binding.segments.length
                    : binding.bind === "button_group"
                    ? binding.options.length
                    : 1);
        }
        assert.equal(targets, published.targets);
    });
}
