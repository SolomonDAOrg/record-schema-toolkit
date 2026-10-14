// @ts-check

/**
 * Checking a form's bindings against the template contract they read from and
 * the document they write to.
 *
 * @module tests/record-schema/forms/verify_test
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
    verifyAgainstContract,
    verifyAgainstDocument
} from "../../../lib/record-schema/forms/verify.mjs";
import { loadPdf, readAcroForm } from "../../../lib/pdf/index.mjs";

import { W9_FIELDS, W9_PATH, contract, formDefinition } from "./fixture.mjs";

/** @returns {import("../../../lib/pdf/forms/types.mjs").AcroForm} */
function w9Form() {
    return readAcroForm(loadPdf(new Uint8Array(readFileSync(W9_PATH))));
}

/** @param {{path: string, message: string}[]} errors @returns {string} */
function messages(errors) {
    return errors.map((error) => error.message).join(" | ");
}

test("the shipped bindings match both contract and document", () => {
    assert.deepEqual(verifyAgainstContract(formDefinition(), contract()), []);
    assert.deepEqual(verifyAgainstDocument(formDefinition(), w9Form()), []);
});

test("a binding naming an undeclared template field is reported", () => {
    const form = formDefinition();
    form.bindings[0].field = "Nonexistent";
    assert.match(
        messages(verifyAgainstContract(form, contract())),
        /The template declares no field named Nonexistent/
    );
});

test("a check binding needs a boolean field", () => {
    const form = formDefinition();
    form.bindings[3].field = "LegalName";
    assert.match(
        messages(verifyAgainstContract(form, contract())),
        /A check binding needs a field of type boolean; LegalName is text/
    );
});

test("a button group needs an enum field", () => {
    const form = formDefinition();
    form.bindings[2].field = "LegalName";
    assert.match(
        messages(verifyAgainstContract(form, contract())),
        /A button_group binding needs a field of type enum; LegalName is text/
    );
});

test("an enum value no option binds is reported before it is chosen", () => {
    const form = formDefinition();
    form.bindings[2].options = form.bindings[2].options.filter(
        (option) => option.value !== "partnership"
    );
    assert.match(
        messages(verifyAgainstContract(form, contract())),
        /TaxClassification may hold "partnership", which no option binds/
    );
});

test("an option outside the declared values is reported", () => {
    const form = formDefinition();
    form.bindings[2].options.push({
        value: "cooperative",
        target: W9_FIELDS.requester,
        on_state: "1"
    });
    assert.match(
        messages(verifyAgainstContract(form, contract())),
        /Option "cooperative" is outside the declared values of TaxClassification/
    );
});

test("a target the document does not declare is reported", () => {
    const form = formDefinition();
    form.bindings[0].target = "topmostSubform[0].Page1[0].f9_99[0]";
    assert.match(
        messages(verifyAgainstDocument(form, w9Form())),
        /The document declares no field named topmostSubform\[0\]\.Page1\[0\]\.f9_99\[0\]/
    );
});

test("a text binding pointed at a button is reported", () => {
    const form = formDefinition();
    form.bindings[0].target = W9_FIELDS.individual;
    assert.match(
        messages(verifyAgainstDocument(form, w9Form())),
        /is a button field; this binding writes a text field/
    );
});

test("a check binding pointed at a text field is reported", () => {
    const form = formDefinition();
    form.bindings[3].target = W9_FIELDS.legalName;
    assert.match(
        messages(verifyAgainstDocument(form, w9Form())),
        /is a text field; this binding writes a button field/
    );
});

test("an on state the button does not declare is reported", () => {
    const form = formDefinition();
    form.bindings[2].options[1].on_state = "99";
    assert.match(
        messages(verifyAgainstDocument(form, w9Form())),
        /has no appearance state 99; it declares 2/
    );
});

test("a segment longer than its comb box is reported", () => {
    const form = formDefinition();
    form.bindings[7].segments[0].length = 5;
    assert.match(
        messages(verifyAgainstDocument(form, w9Form())),
        /holds at most 2 characters; the segment claims 5/
    );
});

test("the checks are independent of each other", () => {
    const form = formDefinition();
    form.bindings[0].field = "Nonexistent";
    assert.deepEqual(
        verifyAgainstDocument(form, w9Form()),
        [],
        "a contract fault is not a document fault"
    );
});
