// @ts-check

/**
 * Reading off a form pack what a record's template must declare, and the
 * round-trip property that matters: a contract scaffolded from a form
 * satisfies that form's own checks.
 *
 * @module tests/record-schema/forms/template-fields_test
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { FormPack } from "../../../lib/record-schema/FormPack.mjs";
import {
    describeTemplateFields,
    scaffoldTemplateFields
} from "../../../lib/record-schema/forms/template-fields.mjs";
import { verifyAgainstContract } from "../../../lib/record-schema/forms/verify.mjs";

import { HAS_SCHEMA_REPO, SCHEMA_ROOT, formDefinition } from "./fixture.mjs";

test("each binding kind names the field type it reads", () => {
    const described = describeTemplateFields(formDefinition());
    assert.equal(described.fields.LegalName.type, "text");
    assert.equal(described.fields.HasForeignPartners.type, "boolean");
    assert.equal(described.fields.TaxClassification.type, "enum");
    assert.equal(
        described.fields.EmployerIdentificationNumber.type,
        "text",
        "segments read text"
    );
    assert.deepEqual(described.conflicts, []);
});

test("an enum field reports the values its binding can express", () => {
    const described = describeTemplateFields(formDefinition());
    assert.deepEqual(described.fields.TaxClassification.values, [
        "individual",
        "c-corporation",
        "partnership"
    ]);
});

test("a field read twice records both binding kinds", () => {
    const form = formDefinition();
    form.bindings.push({
        bind: "text",
        field: "LegalName",
        target: "elsewhere"
    });
    const described = describeTemplateFields(form);
    assert.deepEqual(described.fields.LegalName.binds, ["text"]);

    form.bindings.push({
        bind: "segments",
        field: "LegalName",
        segments: [
            { target: "a", length: 1 },
            { target: "b", length: 1 }
        ]
    });
    assert.deepEqual(describeTemplateFields(form).fields.LegalName.binds, [
        "text",
        "segments"
    ]);
});

test("a field two kinds disagree about is reported as a conflict", () => {
    const form = formDefinition();
    form.bindings.push({
        bind: "check",
        field: "LegalName",
        target: "elsewhere"
    });
    assert.deepEqual(describeTemplateFields(form).conflicts, ["LegalName"]);
});

test("a scaffold satisfies the form it came from", () => {
    const form = formDefinition();
    assert.deepEqual(
        verifyAgainstContract(form, { fields: scaffoldTemplateFields(form) }),
        []
    );
});

test("a scaffold leaves every field optional with a placeholder", () => {
    const scaffold = scaffoldTemplateFields(formDefinition());
    for (const [name, field] of Object.entries(scaffold)) {
        assert.equal(field.required, false, name);
        if (field.type !== "boolean") {
            assert.equal(field.draft_placeholder, "[" + name + "]", name);
        }
    }
    assert.equal(scaffold.HasForeignPartners.true_label, "Yes");
    assert.equal(scaffold.HasForeignPartners.false_label, "No");
    assert.deepEqual(scaffold.TaxClassification.values, [
        "individual",
        "c-corporation",
        "partnership"
    ]);
});

const PUBLISHED = [
    { file: "irs-w9-2024-03.json", form: "irs-w9", fields: 14 },
    { file: "irs-w8ben-e-2021-10.json", form: "irs-w8ben-e-part1", fields: 10 }
];

for (const published of PUBLISHED) {
    const path = join(SCHEMA_ROOT, "forms/packs", published.file);
    const when = { skip: !HAS_SCHEMA_REPO || !existsSync(path) };

    test(`${published.file} scaffolds a usable contract`, when, () => {
        const form = FormPack.load(path).getForm(published.form);
        const described = describeTemplateFields(form);
        assert.deepEqual(described.conflicts, []);
        assert.equal(Object.keys(described.fields).length, published.fields);

        const scaffold = scaffoldTemplateFields(form);
        assert.deepEqual(verifyAgainstContract(form, { fields: scaffold }), []);
    });
}
