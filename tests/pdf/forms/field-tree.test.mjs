/**
 * Reading an AcroForm: name composition, attribute inheritance, terminal-field
 * detection, and the widget shapes a field can take.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadPdf } from "../../../lib/pdf/reader.mjs";
import {
    readAcroForm,
    indexFieldsByName
} from "../../../lib/pdf/forms/field-tree.mjs";

import {
    assembleFixture,
    buildFormFixture,
    textField,
    choiceField,
    radioGroup,
    fieldGroup
} from "./form-fixture.mjs";

/**
 * @param {Parameters<typeof buildFormFixture>[0]} fields
 * @param {number[]} rootIds
 * @param {string} [extras]
 */
function formFrom(fields, rootIds, extras) {
    return readAcroForm(loadPdf(buildFormFixture(fields, rootIds, extras)));
}

test("a document with no AcroForm reads as no form", () => {
    const bytes = assembleFixture(
        [
            { id: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
            { id: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
            {
                id: 3,
                body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>"
            }
        ],
        1
    );
    assert.equal(readAcroForm(loadPdf(bytes)), null);
});

test("a fully-qualified name joins the partial names of its ancestors", () => {
    const form = formFrom(
        [
            fieldGroup({ id: 17, name: "outer", kidIds: [18] }),
            textField({
                id: 18,
                name: "inner",
                rect: "[50 280 300 300]",
                parentId: 17
            })
        ],
        [17]
    );
    assert.equal(form.fields.length, 1);
    assert.equal(form.fields[0].name, "outer.inner");
    assert.deepEqual(form.fields[0].namePath, ["outer", "inner"]);
});

test("a node without a partial name contributes nothing to the path", () => {
    const form = formFrom(
        [
            { id: 17, body: "<< /Kids [18 0 R] >>" },
            textField({
                id: 18,
                name: "only",
                rect: "[50 280 300 300]",
                parentId: 17
            })
        ],
        [17]
    );
    assert.equal(form.fields[0].name, "only");
});

test("field type and flags are inherited from an ancestor", () => {
    const form = formFrom(
        [
            fieldGroup({
                id: 17,
                name: "outer",
                kidIds: [18],
                extras: "/FT /Tx /Ff 4096"
            }),
            {
                id: 18,
                body:
                    "<< /Type /Annot /Subtype /Widget /T (inner)" +
                    " /Parent 17 0 R /Rect [50 280 300 300] /P 3 0 R >>"
            }
        ],
        [17]
    );
    const field = form.fields[0];
    assert.equal(field.type, "text");
    assert.equal(field.fieldFlags, 4096);
    assert.equal(field.multiline, true);
});

test("a field's own attribute overrides the inherited one", () => {
    const form = formFrom(
        [
            fieldGroup({
                id: 17,
                name: "outer",
                kidIds: [18],
                extras: "/FT /Tx /Ff 4096 /Q 1"
            }),
            textField({
                id: 18,
                name: "inner",
                rect: "[50 280 300 300]",
                parentId: 17,
                extras: "/Ff 0 /Q 2"
            })
        ],
        [17]
    );
    assert.equal(form.fields[0].fieldFlags, 0);
    assert.equal(form.fields[0].quadding, 2);
});

test("the form's /DA is the last fallback for a field without one", () => {
    const form = formFrom(
        [
            {
                id: 10,
                body:
                    "<< /Type /Annot /Subtype /Widget /FT /Tx /T (bare)" +
                    " /Rect [50 600 300 620] /P 3 0 R >>"
            }
        ],
        [10]
    );
    assert.equal(form.defaultAppearance, "/Helv 0 Tf 0 g");
    assert.equal(form.fields[0].defaultAppearance, "/Helv 0 Tf 0 g");
});

test("a merged field and widget reports one widget carrying its own id", () => {
    const form = formFrom(
        [textField({ id: 10, name: "merged", rect: "[50 600 300 620]" })],
        [10]
    );
    const field = form.fields[0];
    assert.equal(field.widgets.length, 1);
    assert.equal(field.widgets[0].id, field.id);
    assert.equal(field.widgets[0].merged, true);
    assert.deepEqual(field.widgets[0].rectangle, [50, 600, 300, 620]);
    assert.equal(field.widgets[0].pageId, 3);
});

test("a rectangle given corner-reversed is normalised", () => {
    const form = formFrom(
        [textField({ id: 10, name: "flipped", rect: "[300 620 50 600]" })],
        [10]
    );
    assert.deepEqual(form.fields[0].widgets[0].rectangle, [50, 600, 300, 620]);
});

test("kids without a partial name are widgets, not child fields", () => {
    const form = formFrom(
        radioGroup({
            id: 20,
            name: "pick",
            states: ["Alpha", "Beta"],
            firstKidId: 21
        }),
        [20]
    );
    assert.equal(form.fields.length, 1);
    const field = form.fields[0];
    assert.equal(field.type, "button");
    assert.equal(field.buttonKind, "radio");
    assert.equal(field.widgets.length, 2);
    assert.equal(field.widgets[0].merged, false);
    assert.deepEqual(field.onStates, ["Alpha", "Beta"]);
    assert.deepEqual(field.widgets[0].onStates, ["Alpha"]);
    assert.deepEqual(field.widgets[1].onStates, ["Beta"]);
});

test("Off is not reported as an on state", () => {
    const form = formFrom(
        radioGroup({
            id: 20,
            name: "pick",
            states: ["Yes"],
            firstKidId: 21
        }),
        [20]
    );
    assert.deepEqual(/** @type {any} */ (form.fields[0]).onStates, ["Yes"]);
});

test("button kind follows the radio and pushbutton flags", () => {
    const kinds = [
        [0, "checkbox"],
        [32768, "radio"],
        [65536, "push"],
        [32768 | 65536, "push"]
    ];
    for (const [flags, expected] of kinds) {
        const form = formFrom(
            radioGroup({
                id: 20,
                name: "b",
                states: ["On"],
                firstKidId: 21,
                flags: Number(flags)
            }),
            [20]
        );
        assert.equal(
            /** @type {any} */ (form.fields[0]).buttonKind,
            expected,
            String(flags)
        );
    }
});

test("choice options accept both bare values and export/display pairs", () => {
    const form = formFrom(
        [
            choiceField({
                id: 14,
                name: "bare",
                rect: "[50 400 300 420]",
                options: "[(a) (b)]"
            }),
            choiceField({
                id: 15,
                name: "paired",
                rect: "[50 360 300 380]",
                options: "[[(AU) (Australia)] [(NZ) (New Zealand)]]"
            })
        ],
        [14, 15]
    );
    assert.deepEqual(/** @type {any} */ (form.fields[0]).options, [
        { exportValue: "a", displayText: "a" },
        { exportValue: "b", displayText: "b" }
    ]);
    assert.deepEqual(/** @type {any} */ (form.fields[1]).options, [
        { exportValue: "AU", displayText: "Australia" },
        { exportValue: "NZ", displayText: "New Zealand" }
    ]);
});

test("an absent value is distinguished from an empty one", () => {
    const form = formFrom(
        [
            textField({ id: 10, name: "unset", rect: "[50 600 300 620]" }),
            textField({
                id: 11,
                name: "empty",
                rect: "[50 560 300 580]",
                extras: "/V ()"
            })
        ],
        [10, 11]
    );
    assert.deepEqual(form.fields[0].value, { kind: "absent" });
    assert.deepEqual(form.fields[1].value, { kind: "text", text: "" });
});

test("a list box value may be a single string or an array", () => {
    const form = formFrom(
        [
            choiceField({
                id: 14,
                name: "one",
                rect: "[50 400 300 420]",
                options: "[(a) (b)]",
                extras: "/V (a)"
            }),
            choiceField({
                id: 15,
                name: "many",
                rect: "[50 360 300 380]",
                options: "[(a) (b)]",
                extras: "/Ff 2097152 /V [(a) (b)]"
            })
        ],
        [14, 15]
    );
    assert.deepEqual(form.fields[0].value, {
        kind: "selection",
        values: ["a"]
    });
    assert.deepEqual(form.fields[1].value, {
        kind: "selection",
        values: ["a", "b"]
    });
});

test("a field with an unrecognised type is reported, not dropped", () => {
    const form = formFrom(
        [
            {
                id: 10,
                body:
                    "<< /Type /Annot /Subtype /Widget /FT /Zz /T (odd)" +
                    " /Rect [50 600 300 620] /P 3 0 R >>"
            }
        ],
        [10]
    );
    assert.equal(form.fields.length, 1);
    assert.equal(form.fields[0].type, "unknown");
    assert.equal(form.fields[0].fieldType, "Zz");
});

test("an /XFA entry is reported", () => {
    const plain = formFrom(
        [textField({ id: 10, name: "a", rect: "[50 600 300 620]" })],
        [10]
    );
    assert.equal(plain.hasXfa, false);

    const hybrid = formFrom(
        [textField({ id: 10, name: "a", rect: "[50 600 300 620]" })],
        [10],
        "/XFA [(template) 4 0 R]"
    );
    assert.equal(hybrid.hasXfa, true);
});

test("a cycle in the field tree terminates", () => {
    const form = formFrom(
        [
            { id: 17, body: "<< /T (loop) /Kids [18 0 R] >>" },
            { id: 18, body: "<< /T (back) /Kids [17 0 R] >>" }
        ],
        [17]
    );
    assert.ok(Array.isArray(form.fields));
});

test("indexing rejects two terminal fields sharing a name", () => {
    const form = formFrom(
        [
            textField({ id: 10, name: "same", rect: "[50 600 300 620]" }),
            textField({ id: 11, name: "same", rect: "[50 560 300 580]" })
        ],
        [10, 11]
    );
    assert.throws(
        () => indexFieldsByName(form.fields),
        /duplicate fully-qualified field name: same/
    );
});
