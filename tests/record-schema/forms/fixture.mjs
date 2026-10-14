// @ts-check

/**
 * Shared fixtures for the form-binding tests: a template contract covering the
 * five field types, an instance over it, and a form pack bound to the W-9 that
 * ships as a PDF fixture.
 *
 * @module tests/record-schema/forms/fixture
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DocumentInstance } from "../../../lib/record-schema/templates/DocumentInstance.mjs";
import { Metafile } from "../../../lib/record-schema/Metafile.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The toolkit's own PDF fixtures, which the form packs below bind to. */
export const PDF_FIXTURES = resolve(HERE, "../../pdf/forms/fixtures");

/** The W-9 that ships with the PDF form tests. */
export const W9_PATH = join(PDF_FIXTURES, "irs-w9.pdf");

/** Checksum of that W-9, as the packs pin it. */
export const W9_SHA256 =
    "2d420cbb4123dcf1fb82595b2359cfbb5d81f00b9df9d359fcc7af361d093f53";

/** The sibling schema repository, when a checkout is beside the toolkit. */
export const SCHEMA_ROOT = resolve(HERE, "../../../../record-schema");

/** Whether the canonical schema and packs are reachable from here. */
export const HAS_SCHEMA_REPO = existsSync(
    join(SCHEMA_ROOT, "schema/form.pack.schema.json")
);

const W9 = "topmostSubform[0].Page1[0].";
const W9_BOXES = W9 + "Boxes3a-b_ReadOrder[0].";
const W9_ADDRESS = W9 + "Address_ReadOrder[0].";

/** Fully-qualified W-9 field names, so the tests name them once. */
export const W9_FIELDS = {
    legalName: W9 + "f1_01[0]",
    businessName: W9 + "f1_02[0]",
    individual: W9_BOXES + "c1_1[0]",
    cCorporation: W9_BOXES + "c1_1[1]",
    partnership: W9_BOXES + "c1_1[3]",
    foreignPartners: W9_BOXES + "c1_2[0]",
    address: W9_ADDRESS + "f1_07[0]",
    cityStateZip: W9_ADDRESS + "f1_08[0]",
    requester: W9 + "f1_09[0]",
    einHigh: W9 + "f1_14[0]",
    einLow: W9 + "f1_15[0]"
};

/**
 * A template contract exercising every field type the binder reads.
 * @returns {Object}
 */
export function contract() {
    return {
        fields: {
            LegalName: { type: "text", required: true },
            BusinessName: {
                type: "text",
                required: false,
                draft_placeholder: "[Business name]"
            },
            TaxClassification: {
                type: "enum",
                required: true,
                values: ["individual", "c-corporation", "partnership"],
                draft_placeholder: "[Classification]"
            },
            HasForeignPartners: {
                type: "boolean",
                required: true,
                true_label: "Yes",
                false_label: "No"
            },
            Address: { type: "text", required: true },
            CityStateZip: { type: "text", required: true },
            RequesterNameAddress: {
                type: "text",
                required: false,
                draft_placeholder: "[Requester]"
            },
            EmployerIdentificationNumber: {
                type: "text",
                required: true,
                draft_placeholder: "[EIN]"
            }
        },
        metadata: [],
        datasets: {},
        signatures: {},
        instances: { current: "current.yaml" },
        default_instance: "current"
    };
}

/**
 * An instance over that contract. `fields` overrides the resolved values, and
 * a name mapped to undefined is deleted so the instance leaves it unresolved.
 * @param {Record<string, string | boolean | undefined>} [fields]
 * @returns {Object}
 */
export function instanceData(fields = {}) {
    const resolved = {
        LegalName: "Solomon Labs Pty Ltd",
        BusinessName: "Solomon Labs",
        TaxClassification: "c-corporation",
        HasForeignPartners: false,
        Address: "Level 3, 12 Example Street",
        CityStateZip: "Adelaide SA 5000, Australia",
        RequesterNameAddress: "Requester Pty Ltd, 400 Long Avenue",
        EmployerIdentificationNumber: "98-7654321",
        ...fields
    };
    for (const name of Object.keys(resolved)) {
        if (resolved[name] === undefined) {
            delete resolved[name];
        }
    }
    return {
        schema: "record-schema-document-instance",
        schema_version: 1,
        template: { record_id: "TAX-00001", version: "1" },
        document_id: "W9",
        fields: resolved,
        datasets: {},
        stages: {
            draft: { document: { version: "1-draft", path: "draft.pdf" } },
            for_execution: { document: { version: "1", path: "w9.pdf" } }
        },
        default_stage: "for_execution"
    };
}

/**
 * Build a resolved instance.
 * @param {Record<string, string | boolean | undefined>} [fields]
 * @param {string} [stage]
 * @returns {DocumentInstance}
 */
export function instance(fields = {}, stage = "for_execution") {
    return new DocumentInstance(
        contract(),
        instanceData(fields),
        stage,
        join(PDF_FIXTURES, "current.yaml"),
        new Metafile({
            id: "TAX-00001",
            document: { version: "1" },
            title: "W-9",
            status: { phase: stage === "draft" ? "draft" : "execution" }
        })
    );
}

/**
 * A form definition bound to the W-9 fixture, covering each binding kind.
 * @param {Object} [overrides]
 * @returns {Object}
 */
export function formDefinition(overrides = {}) {
    return {
        title: "IRS Form W-9 (Rev. March 2024)",
        document: { path: W9_PATH, sha256: W9_SHA256 },
        xfa: "remove",
        need_appearances: true,
        unresolved: "skip",
        bindings: [
            {
                bind: "text",
                field: "LegalName",
                target: W9_FIELDS.legalName
            },
            {
                bind: "text",
                field: "BusinessName",
                target: W9_FIELDS.businessName
            },
            {
                bind: "button_group",
                field: "TaxClassification",
                options: [
                    {
                        value: "individual",
                        target: W9_FIELDS.individual,
                        on_state: "1"
                    },
                    {
                        value: "c-corporation",
                        target: W9_FIELDS.cCorporation,
                        on_state: "2"
                    },
                    {
                        value: "partnership",
                        target: W9_FIELDS.partnership,
                        on_state: "4"
                    }
                ]
            },
            {
                bind: "check",
                field: "HasForeignPartners",
                target: W9_FIELDS.foreignPartners,
                on_state: "1"
            },
            { bind: "text", field: "Address", target: W9_FIELDS.address },
            {
                bind: "text",
                field: "CityStateZip",
                target: W9_FIELDS.cityStateZip
            },
            {
                bind: "text",
                field: "RequesterNameAddress",
                target: W9_FIELDS.requester
            },
            {
                bind: "segments",
                field: "EmployerIdentificationNumber",
                retain: "digits",
                segments: [
                    { target: W9_FIELDS.einHigh, length: 2 },
                    { target: W9_FIELDS.einLow, length: 7 }
                ]
            }
        ],
        ...overrides
    };
}

/**
 * A whole pack wrapping `formDefinition`.
 * @param {Object} [overrides]
 * @returns {Object}
 */
export function packData(overrides = {}) {
    return {
        schema: "record-schema-form-pack",
        schema_version: 1,
        pack_id: "test-w9",
        forms: { "irs-w9": formDefinition() },
        ...overrides
    };
}
