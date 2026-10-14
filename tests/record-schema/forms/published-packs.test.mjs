// @ts-check

/**
 * The packs published in the schema repository, driven end to end: a template
 * contract and an instance for each, prefilled into the PDF the pack pins and
 * read back.
 *
 * These skip without a checkout of record-schema beside the toolkit.
 *
 * @module tests/record-schema/forms/published-packs_test
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { FormPack } from "../../../lib/record-schema/FormPack.mjs";
import { Metafile } from "../../../lib/record-schema/Metafile.mjs";
import { DocumentInstance } from "../../../lib/record-schema/templates/DocumentInstance.mjs";
import { verifyAgainstContract } from "../../../lib/record-schema/forms/verify.mjs";
import { prefillForm } from "../../../lib/record-schema/forms/prefill.mjs";
import { flattenFormFields } from "../../../lib/pdf/forms/flatten.mjs";
import {
    loadPdf,
    readAcroForm,
    readFormValues
} from "../../../lib/pdf/index.mjs";

import { HAS_SCHEMA_REPO, SCHEMA_ROOT } from "./fixture.mjs";

const W9_PAGE1 = "topmostSubform[0].Page1[0].";
const W8_PAGE1 = "topmostSubform[0].Page1[0].";

/**
 * Build a contract from a flat description, filling in the boilerplate the
 * template schema requires.
 * @param {Record<string, Object>} fields
 * @returns {Object}
 */
function contractOf(fields) {
    return {
        fields,
        metadata: [],
        datasets: {},
        signatures: {},
        instances: { current: "current.yaml" },
        default_instance: "current"
    };
}

/**
 * @param {Object} contract
 * @param {Record<string, string | boolean>} fields
 * @returns {DocumentInstance}
 */
function instanceOf(contract, fields) {
    return new DocumentInstance(
        contract,
        {
            schema: "record-schema-document-instance",
            schema_version: 1,
            template: { record_id: "TAX-00001", version: "1" },
            document_id: "FORM",
            fields,
            datasets: {},
            stages: {
                draft: { document: { version: "1-draft", path: "d.pdf" } },
                for_execution: { document: { version: "1", path: "f.pdf" } }
            },
            default_stage: "for_execution"
        },
        "for_execution",
        join(SCHEMA_ROOT, "current.yaml"),
        new Metafile({
            id: "TAX-00001",
            document: { version: "1" },
            title: "Form",
            status: { phase: "execution" }
        })
    );
}

const text = { type: "text", required: false };

/** The W-9 template the published pack binds. */
const W9_CONTRACT = contractOf({
    LegalName: { type: "text", required: true },
    BusinessName: text,
    TaxClassification: {
        type: "enum",
        required: false,
        values: [
            "individual",
            "c-corporation",
            "s-corporation",
            "partnership",
            "trust-estate",
            "limited-liability-company",
            "other"
        ]
    },
    LlcTaxClassification: text,
    OtherClassification: text,
    HasForeignPartners: {
        type: "boolean",
        required: false,
        true_label: "Yes",
        false_label: "No"
    },
    ExemptPayeeCode: text,
    FatcaExemptionCode: text,
    Address: { type: "text", required: true },
    CityStateZip: { type: "text", required: true },
    RequesterNameAddress: text,
    AccountNumbers: text,
    SocialSecurityNumber: text,
    EmployerIdentificationNumber: text
});

/** The W-8BEN-E Part I template the published pack binds. */
const W8_CONTRACT = contractOf({
    OrganizationName: { type: "text", required: true },
    CountryOfIncorporation: { type: "text", required: true },
    DisregardedEntityName: text,
    ChapterThreeStatus: {
        type: "enum",
        required: false,
        values: [
            "corporation",
            "partnership",
            "simple-trust",
            "tax-exempt-organization",
            "complex-trust",
            "foreign-government-controlled-entity",
            "central-bank-of-issue",
            "private-foundation",
            "estate",
            "foreign-government-integral-part",
            "grantor-trust",
            "disregarded-entity",
            "international-organization"
        ]
    },
    ResidenceAddress: { type: "text", required: true },
    ResidenceCity: { type: "text", required: true },
    ResidenceCountry: { type: "text", required: true },
    MailingAddress: text,
    MailingCity: text,
    MailingCountry: text
});

/** @type {{name: string, file: string, form: string, contract: Object, fields: Record<string, string|boolean>, expect: Record<string, string>, checked: string[], cleared: string[]}[]} */
const CASES = [
    {
        name: "W-9",
        file: "irs-w9-2024-03.json",
        form: "irs-w9",
        contract: W9_CONTRACT,
        fields: {
            LegalName: "Solomon Labs Pty Ltd",
            BusinessName: "Solomon Labs",
            TaxClassification: "c-corporation",
            HasForeignPartners: false,
            Address: "Level 3, 12 Example Street",
            CityStateZip: "Adelaide SA 5000, Australia",
            AccountNumbers: "ACC-2026-0041",
            EmployerIdentificationNumber: "98-7654321"
        },
        expect: {
            [W9_PAGE1 + "f1_01[0]"]: "Solomon Labs Pty Ltd",
            [W9_PAGE1 + "f1_10[0]"]: "ACC-2026-0041",
            [W9_PAGE1 + "f1_14[0]"]: "98",
            [W9_PAGE1 + "f1_15[0]"]: "7654321"
        },
        checked: [W9_PAGE1 + "Boxes3a-b_ReadOrder[0].c1_1[1]"],
        cleared: [W9_PAGE1 + "Boxes3a-b_ReadOrder[0].c1_1[0]"]
    },
    {
        name: "W-8BEN-E Part I",
        file: "irs-w8ben-e-2021-10.json",
        form: "irs-w8ben-e-part1",
        contract: W8_CONTRACT,
        fields: {
            OrganizationName: "Solomon Labs Pty Ltd",
            CountryOfIncorporation: "Australia",
            ChapterThreeStatus: "corporation",
            ResidenceAddress: "Level 3, 12 Example Street",
            ResidenceCity: "Adelaide SA 5000",
            ResidenceCountry: "Australia"
        },
        expect: {
            [W8_PAGE1 + "f1_1[0]"]: "Solomon Labs Pty Ltd",
            [W8_PAGE1 + "f1_2[0]"]: "Australia",
            [W8_PAGE1 + "f1_4[0]"]: "Level 3, 12 Example Street",
            [W8_PAGE1 + "f1_6[0]"]: "Australia"
        },
        checked: [W8_PAGE1 + "c1_1[0]"],
        cleared: [W8_PAGE1 + "c1_1[1]"]
    }
];

for (const example of CASES) {
    const path = join(SCHEMA_ROOT, "forms/packs", example.file);
    const when = { skip: !HAS_SCHEMA_REPO || !existsSync(path) };

    test(`${example.name}: the pack matches its template`, when, () => {
        const form = FormPack.load(path).getForm(example.form);
        assert.deepEqual(verifyAgainstContract(form, example.contract), []);
    });

    test(`${example.name}: an instance prefills its PDF`, when, () => {
        const pack = FormPack.load(path);
        const form = pack.getForm(example.form);
        const result = prefillForm(
            form,
            instanceOf(example.contract, example.fields),
            pack.resolveDocumentPath(example.form, SCHEMA_ROOT)
        );

        const values = readFormValues(loadPdf(result.bytes));
        for (const [target, expected] of Object.entries(example.expect)) {
            assert.deepEqual(
                values.get(target),
                { kind: "text", text: expected },
                target
            );
        }
        for (const target of example.checked) {
            const value = values.get(target);
            assert.equal(value.kind, "state", target + " holds a state");
            assert.notEqual(value.state, "Off", target);
        }
        for (const target of example.cleared) {
            assert.deepEqual(
                values.get(target),
                { kind: "state", state: "Off" },
                target
            );
        }
    });

    test(`${example.name}: appearances are supplied`, when, () => {
        const pack = FormPack.load(path);
        const form = pack.getForm(example.form);
        assert.equal(
            form.need_appearances,
            false,
            "the pack does not ask viewers to rebuild what it wrote"
        );
        const result = prefillForm(
            form,
            instanceOf(example.contract, example.fields),
            pack.resolveDocumentPath(example.form, SCHEMA_ROOT)
        );
        assert.equal(result.fill.needAppearancesSet, false);
        assert.equal(
            readAcroForm(loadPdf(result.bytes)).needAppearances,
            false
        );
    });

    test(`${example.name}: the prefilled form flattens`, when, () => {
        const pack = FormPack.load(path);
        const form = pack.getForm(example.form);
        const result = prefillForm(
            form,
            instanceOf(example.contract, example.fields),
            pack.resolveDocumentPath(example.form, SCHEMA_ROOT)
        );

        const editor = loadPdf(result.bytes);
        const flat = flattenFormFields(editor);
        assert.ok(flat.widgetsPainted > 0);
        assert.equal(readAcroForm(loadPdf(editor.save())), null);
    });
}
