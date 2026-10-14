// @ts-check

/**
 * Prefilling the W-9 from a document instance: the checks that run before
 * anything is written, and that the values reach the page.
 *
 * @module tests/record-schema/forms/prefill_test
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { prefillForm } from "../../../lib/record-schema/forms/prefill.mjs";
import { mergePdfs } from "../../../lib/pdf/merge.mjs";
import {
    loadPdf,
    readAcroForm,
    readFormValues
} from "../../../lib/pdf/index.mjs";
import { getRaw } from "../../../lib/pdf/reader.mjs";

import { W9_FIELDS, W9_PATH, formDefinition, instance } from "./fixture.mjs";

/**
 * @param {Object} [formOverrides]
 * @param {Record<string, string | boolean | undefined>} [fields]
 * @param {string} [stage]
 */
function prefill(formOverrides = {}, fields = {}, stage = "for_execution") {
    return prefillForm(
        formDefinition(formOverrides),
        instance(fields, stage),
        W9_PATH
    );
}

test("a prefilled W-9 carries the instance's values", () => {
    const result = prefill();
    const values = readFormValues(loadPdf(result.bytes));

    assert.deepEqual(values.get(W9_FIELDS.legalName), {
        kind: "text",
        text: "Solomon Labs Pty Ltd"
    });
    assert.deepEqual(values.get(W9_FIELDS.cityStateZip), {
        kind: "text",
        text: "Adelaide SA 5000, Australia"
    });
    assert.deepEqual(values.get(W9_FIELDS.einHigh), {
        kind: "text",
        text: "98"
    });
    assert.deepEqual(values.get(W9_FIELDS.einLow), {
        kind: "text",
        text: "7654321"
    });
});

test("the selected classification is checked and the others are not", () => {
    const form = readAcroForm(loadPdf(prefill().bytes));
    const byName = new Map(form.fields.map((field) => [field.name, field]));

    assert.equal(
        byName.get(W9_FIELDS.cCorporation).widgets[0].appearanceState,
        "2"
    );
    assert.equal(
        byName.get(W9_FIELDS.individual).widgets[0].appearanceState,
        "Off"
    );
    assert.equal(
        byName.get(W9_FIELDS.partnership).widgets[0].appearanceState,
        "Off"
    );
});

test("the published form survives verbatim beneath the values", () => {
    const original = new Uint8Array(readFileSync(W9_PATH));
    const result = prefill();
    assert.ok(result.bytes.length > original.length);
    assert.deepEqual(result.bytes.slice(0, original.length), original);
});

test("the form's xfa and appearance settings are carried through", () => {
    const result = prefill();
    assert.equal(result.fill.xfaRemoved, true);
    assert.equal(result.fill.needAppearancesSet, true);

    const form = readAcroForm(loadPdf(result.bytes));
    assert.equal(form.hasXfa, false);
    assert.equal(form.needAppearances, true);
});

test("a skipped field leaves its box untouched and is reported", () => {
    const result = prefill({}, { BusinessName: undefined });
    assert.deepEqual(result.unresolved, ["BusinessName"]);
    assert.deepEqual(result.skipped, [W9_FIELDS.businessName]);

    const values = readFormValues(loadPdf(result.bytes));
    assert.deepEqual(values.get(W9_FIELDS.businessName), { kind: "absent" });
});

test("a prefill refuses a document that is not the pinned revision", () => {
    assert.throws(
        () =>
            prefillForm(
                formDefinition({
                    document: { path: W9_PATH, sha256: "0".repeat(64) }
                }),
                instance(),
                W9_PATH
            ),
        /is not the revision this form was written against/
    );
});

test("a prefill refuses bindings that do not match the contract", () => {
    const form = formDefinition();
    form.bindings[0].field = "Nonexistent";
    assert.throws(
        () => prefillForm(form, instance(), W9_PATH),
        /do not match the template contract[\s\S]*declares no field named Nonexistent/
    );
});

test("a prefill refuses bindings that do not match the document", () => {
    const form = formDefinition();
    form.bindings[0].target = "topmostSubform[0].Page1[0].f9_99[0]";
    assert.throws(
        () => prefillForm(form, instance(), W9_PATH),
        /do not match the document[\s\S]*declares no field named/
    );
});

test("prefilling twice from the same instance produces the same bytes", () => {
    assert.deepEqual(prefill().bytes, prefill().bytes);
});

test("a second prefill stacks on the first without losing it", () => {
    const first = prefill();
    const second = prefillForm(
        formDefinition({
            document: {
                path: W9_PATH,
                sha256: formDefinition().document.sha256
            }
        }),
        instance({ LegalName: "Second Pass Pty Ltd" }),
        W9_PATH
    );
    const values = readFormValues(loadPdf(second.bytes));
    assert.deepEqual(values.get(W9_FIELDS.legalName), {
        kind: "text",
        text: "Second Pass Pty Ltd"
    });
    assert.deepEqual(
        readFormValues(loadPdf(first.bytes)).get(W9_FIELDS.legalName),
        { kind: "text", text: "Solomon Labs Pty Ltd" }
    );
});

test("the result stays an interactive form by default", () => {
    const result = prefill();
    assert.equal(result.flatten, null);
    assert.notEqual(readAcroForm(loadPdf(result.bytes)), null);
});

test("flattening paints the values and removes the form", () => {
    const result = prefillForm(formDefinition(), instance(), W9_PATH, {
        flatten: true
    });
    assert.notEqual(result.flatten, null);
    assert.ok(result.flatten.widgetsPainted > 0);
    assert.equal(result.flatten.fieldsFlattened, 23);

    const editor = loadPdf(result.bytes);
    assert.equal(readAcroForm(editor), null);
    assert.deepEqual(readFormValues(editor).size, 0);
});

test("a flattened prefill still reports what it could not resolve", () => {
    const result = prefillForm(
        formDefinition(),
        instance({ BusinessName: undefined }),
        W9_PATH,
        { flatten: true }
    );
    assert.deepEqual(result.unresolved, ["BusinessName"]);
    assert.deepEqual(result.skipped, [W9_FIELDS.businessName]);
});

test("a flattened prefill merges without orphaned widgets", () => {
    const result = prefillForm(formDefinition(), instance(), W9_PATH, {
        flatten: true
    });
    const merged = loadPdf(mergePdfs([result.bytes, result.bytes]));
    assert.equal(merged.pageCount(), 12);
    assert.equal(readAcroForm(merged), null);
    for (const pageId of merged.pageIds) {
        const annots = getRaw(merged.getDict(pageId).entries, "Annots");
        assert.equal(
            annots === undefined || annots.replace(/\s/g, "") === "[]",
            true,
            "no widget outlives the form"
        );
    }
});

test("an unflattened prefill loses its form when merged", () => {
    const merged = loadPdf(mergePdfs([prefill().bytes]));
    assert.equal(
        readAcroForm(merged),
        null,
        "page merging does not carry a form across"
    );
});
