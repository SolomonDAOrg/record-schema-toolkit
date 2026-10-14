/**
 * Filling a form: the values written, the appearances generated, what is
 * refused, and that the original revision survives the incremental update.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadPdf, getRaw } from "../../../lib/pdf/reader.mjs";
import { readAcroForm } from "../../../lib/pdf/forms/field-tree.mjs";
import {
    fillFormFields,
    readFormValues
} from "../../../lib/pdf/forms/fill.mjs";

/**
 * @typedef {import("../../../lib/pdf/forms/types.mjs").FormFieldInput} FormFieldInput
 */

import {
    assembleFixture,
    buildFormFixture,
    textField,
    choiceField,
    radioGroup,
    fieldGroup
} from "./form-fixture.mjs";

const latin1 = new TextDecoder("latin1");

/**
 * Fill a fixture and hand back the reloaded document.
 * @param {Parameters<typeof buildFormFixture>[0]} fields
 * @param {number[]} rootIds
 * @param {Record<string, FormFieldInput>} values
 * @param {import("../../../lib/pdf/forms/fill.mjs").FillOptions} [options]
 */
function fillAndReload(fields, rootIds, values, options) {
    const original = buildFormFixture(fields, rootIds);
    const editor = loadPdf(original);
    const result = fillFormFields(editor, values, options);
    const saved = editor.save();
    return { original, saved, result, reloaded: loadPdf(saved) };
}

/** A pair of simple text fields. */
function twoTextFields() {
    return [
        textField({ id: 10, name: "alpha", rect: "[50 600 300 620]" }),
        textField({ id: 11, name: "beta", rect: "[50 560 300 580]" })
    ];
}

test("a filled value reads back from the saved document", () => {
    const { reloaded } = fillAndReload(twoTextFields(), [10, 11], {
        alpha: "Acme Pty Ltd"
    });
    assert.deepEqual(readFormValues(reloaded).get("alpha"), {
        kind: "text",
        text: "Acme Pty Ltd"
    });
    assert.deepEqual(readFormValues(reloaded).get("beta"), { kind: "absent" });
});

test("the original bytes are preserved beneath the update", () => {
    const { original, saved } = fillAndReload(twoTextFields(), [10, 11], {
        alpha: "Acme"
    });
    assert.ok(saved.length > original.length, "the update only appends");
    assert.deepEqual(saved.slice(0, original.length), original);
});

test("non-ASCII values are written as UTF-16BE text strings", () => {
    const { saved, reloaded } = fillAndReload(twoTextFields(), [10, 11], {
        alpha: "Zürich"
    });
    assert.ok(latin1.decode(saved).includes("<FEFF"), "hex string emitted");
    assert.deepEqual(readFormValues(reloaded).get("alpha"), {
        kind: "text",
        text: "Zürich"
    });
});

test("a filled text field gains an appearance stream in its /AP /N", () => {
    const { reloaded } = fillAndReload(twoTextFields(), [10, 11], {
        alpha: "Acme"
    });
    const field = readAcroForm(reloaded).fields.find(
        (candidate) => candidate.name === "alpha"
    );
    const appearance = getRaw(field.widgets[0].entries, "AP");
    const match = /\/N\s+(\d+)\s+0\s+R/.exec(appearance);
    assert.ok(match, "AP names an indirect normal appearance");

    const object = reloaded.getObjectRaw(Number(match[1]));
    assert.match(object.dictPart, /\/Subtype\s*\/Form/);
    assert.match(object.dictPart, /\/BBox\s*\[0 0 250 20\]/);
    const content = latin1.decode(object.streamBytes);
    assert.match(content, /^\/Tx BMC/, "marked as variable text");
    assert.match(content, /re W n/, "clipped to the widget");
    assert.match(content, /\(Acme\) Tj/);
    assert.match(content, /EMC\s*$/);
});

test("the appearance carries the colour the /DA selected", () => {
    const { reloaded } = fillAndReload(
        [
            textField({
                id: 10,
                name: "blue",
                rect: "[50 600 300 620]",
                defaultAppearance: "/Helv 9 Tf 0 0 0.502 rg"
            })
        ],
        [10],
        { blue: "Acme" }
    );
    const field = readAcroForm(reloaded).fields[0];
    const match = /\/N\s+(\d+)\s+0\s+R/.exec(
        getRaw(field.widgets[0].entries, "AP")
    );
    const content = latin1.decode(
        reloaded.getObjectRaw(Number(match[1])).streamBytes
    );
    assert.match(content, /0 0 0\.502 rg/);
});

test("the appearance resources name the font the /DA asked for", () => {
    const { reloaded } = fillAndReload(twoTextFields(), [10, 11], {
        alpha: "Acme"
    });
    const field = readAcroForm(reloaded).fields[0];
    const match = /\/N\s+(\d+)\s+0\s+R/.exec(
        getRaw(field.widgets[0].entries, "AP")
    );
    const dictionary = reloaded.getObjectRaw(Number(match[1])).dictPart;
    assert.match(dictionary, /\/Font\s*<<\s*\/Helv\s+4\s+0\s+R\s*>>/);
});

test("characters the font cannot encode are reported", () => {
    const original = buildFormFixture(twoTextFields(), [10, 11]);
    const editor = loadPdf(original);
    const result = fillFormFields(editor, { alpha: "Tokyo 東京" });
    assert.deepEqual(result.filled[0].unmappedCharacters, ["東", "京"]);
    assert.deepEqual(readFormValues(loadPdf(editor.save())).get("alpha"), {
        kind: "text",
        text: "Tokyo 東京"
    });
});

test("skipping appearance generation writes the value alone", () => {
    const { reloaded, result } = fillAndReload(
        twoTextFields(),
        [10, 11],
        { alpha: "Acme" },
        { generateAppearances: false }
    );
    assert.equal(result.filled[0].widgetsUpdated, 0);
    const field = readAcroForm(reloaded).fields[0];
    assert.equal(getRaw(field.widgets[0].entries, "AP"), undefined);
});

test("null clears a value without leaving an empty one behind", () => {
    const { reloaded } = fillAndReload(
        [
            textField({
                id: 10,
                name: "alpha",
                rect: "[50 600 300 620]",
                extras: "/V (existing)"
            })
        ],
        [10],
        { alpha: null }
    );
    assert.deepEqual(readFormValues(reloaded).get("alpha"), { kind: "absent" });
});

test("a hierarchical field is addressed by its fully-qualified name", () => {
    const { reloaded } = fillAndReload(
        [
            fieldGroup({ id: 17, name: "outer", kidIds: [18] }),
            textField({
                id: 18,
                name: "inner",
                rect: "[50 280 300 300]",
                parentId: 17
            })
        ],
        [17],
        { "outer.inner": "Nested" }
    );
    assert.deepEqual(readFormValues(reloaded).get("outer.inner"), {
        kind: "text",
        text: "Nested"
    });
});

test("a radio group sets one value and each widget's own state", () => {
    const { reloaded, result } = fillAndReload(
        radioGroup({
            id: 20,
            name: "pick",
            states: ["Alpha", "Beta"],
            firstKidId: 21
        }),
        [20],
        { pick: "Beta" }
    );
    assert.equal(result.filled[0].widgetsUpdated, 2);
    assert.deepEqual(readFormValues(reloaded).get("pick"), {
        kind: "state",
        state: "Beta"
    });
    const field = readAcroForm(reloaded).fields[0];
    assert.equal(field.widgets[0].appearanceState, "Off");
    assert.equal(field.widgets[1].appearanceState, "Beta");
});

test("a button keeps the appearance streams the file supplied", () => {
    const { reloaded } = fillAndReload(
        radioGroup({
            id: 20,
            name: "pick",
            states: ["Alpha"],
            firstKidId: 21
        }),
        [20],
        { pick: "Alpha" }
    );
    const field = readAcroForm(reloaded).fields[0];
    assert.match(
        getRaw(field.widgets[0].entries, "AP"),
        /\/Alpha\s+90\s+0\s+R/,
        "the original appearance reference is untouched"
    );
});

test("false and null clear a button to Off", () => {
    for (const input of [false, null]) {
        const { reloaded } = fillAndReload(
            radioGroup({
                id: 20,
                name: "pick",
                states: ["Alpha"],
                firstKidId: 21
            }),
            [20],
            { pick: input }
        );
        assert.deepEqual(readFormValues(reloaded).get("pick"), {
            kind: "state",
            state: "Off"
        });
        assert.equal(
            readAcroForm(reloaded).fields[0].widgets[0].appearanceState,
            "Off"
        );
    }
});

test("true selects a button with exactly one on state", () => {
    const { reloaded } = fillAndReload(
        radioGroup({ id: 20, name: "pick", states: ["Yes"], firstKidId: 21 }),
        [20],
        { pick: true }
    );
    assert.deepEqual(readFormValues(reloaded).get("pick"), {
        kind: "state",
        state: "Yes"
    });
});

test("true is refused when a button offers more than one state", () => {
    const editor = loadPdf(
        buildFormFixture(
            radioGroup({
                id: 20,
                name: "pick",
                states: ["Alpha", "Beta"],
                firstKidId: 21
            }),
            [20]
        )
    );
    assert.throws(
        () => fillFormFields(editor, { pick: true }),
        /has 2 on states, so it must be set by name/
    );
});

test("a state the file declares no appearance for is refused", () => {
    const editor = loadPdf(
        buildFormFixture(
            radioGroup({
                id: 20,
                name: "pick",
                states: ["Alpha"],
                firstKidId: 21
            }),
            [20]
        )
    );
    assert.throws(
        () => fillFormFields(editor, { pick: "Gamma" }),
        /has no appearance state Gamma; it declares Alpha/
    );
});

test("a choice value records its index in /I", () => {
    const { reloaded } = fillAndReload(
        [
            choiceField({
                id: 14,
                name: "country",
                rect: "[50 400 300 420]",
                options: "[[(AU) (Australia)] [(NZ) (New Zealand)]]",
                extras: "/Ff 131072"
            })
        ],
        [14],
        { country: "NZ" }
    );
    const field = readAcroForm(reloaded).fields[0];
    assert.deepEqual(field.value, { kind: "selection", values: ["NZ"] });
    assert.equal(getRaw(field.entries, "I"), "[1]");
});

test("a choice appearance shows the display text, not the export value", () => {
    const { reloaded } = fillAndReload(
        [
            choiceField({
                id: 14,
                name: "country",
                rect: "[50 400 300 420]",
                options: "[[(AU) (Australia)] [(NZ) (New Zealand)]]",
                extras: "/Ff 131072"
            })
        ],
        [14],
        { country: "NZ" }
    );
    const field = readAcroForm(reloaded).fields[0];
    const match = /\/N\s+(\d+)\s+0\s+R/.exec(
        getRaw(field.widgets[0].entries, "AP")
    );
    const content = latin1.decode(
        reloaded.getObjectRaw(Number(match[1])).streamBytes
    );
    assert.match(content, /\(New Zealand\) Tj/);
});

test("a multi-select list box accepts an array", () => {
    const { reloaded } = fillAndReload(
        [
            choiceField({
                id: 14,
                name: "tags",
                rect: "[50 400 300 420]",
                options: "[(x) (y) (z)]",
                extras: "/Ff 2097152"
            })
        ],
        [14],
        { tags: ["x", "z"] }
    );
    const field = readAcroForm(reloaded).fields[0];
    assert.deepEqual(field.value, { kind: "selection", values: ["x", "z"] });
    assert.equal(getRaw(field.entries, "I"), "[0 2]");
});

test("a single-select choice refuses several values", () => {
    const editor = loadPdf(
        buildFormFixture(
            [
                choiceField({
                    id: 14,
                    name: "country",
                    rect: "[50 400 300 420]",
                    options: "[(AU) (NZ)]",
                    extras: "/Ff 131072"
                })
            ],
            [14]
        )
    );
    assert.throws(
        () => fillFormFields(editor, { country: ["AU", "NZ"] }),
        /is not multi-select/
    );
});

test("a value outside a fixed option list is refused", () => {
    const editor = loadPdf(
        buildFormFixture(
            [
                choiceField({
                    id: 14,
                    name: "country",
                    rect: "[50 400 300 420]",
                    options: "[(AU) (NZ)]",
                    extras: "/Ff 131072"
                })
            ],
            [14]
        )
    );
    assert.throws(
        () => fillFormFields(editor, { country: "FR" }),
        /has no option with export value "FR"/
    );
});

test("an editable combo box accepts a value outside its list", () => {
    const { reloaded } = fillAndReload(
        [
            choiceField({
                id: 14,
                name: "country",
                rect: "[50 400 300 420]",
                options: "[(AU) (NZ)]",
                extras: "/Ff 393216"
            })
        ],
        [14],
        { country: "France" }
    );
    assert.deepEqual(readFormValues(reloaded).get("country"), {
        kind: "selection",
        values: ["France"]
    });
});

test("a value longer than /MaxLen is refused", () => {
    const editor = loadPdf(
        buildFormFixture(
            [
                textField({
                    id: 10,
                    name: "code",
                    rect: "[50 600 100 620]",
                    extras: "/MaxLen 3"
                })
            ],
            [10]
        )
    );
    assert.throws(
        () => fillFormFields(editor, { code: "ABCD" }),
        /is 4 characters and exceeds its \/MaxLen of 3/
    );
});

test("an unknown field name is refused", () => {
    const editor = loadPdf(buildFormFixture(twoTextFields(), [10, 11]));
    assert.throws(
        () => fillFormFields(editor, { gamma: "x" }),
        /no field named gamma/
    );
});

test("a read-only field is refused unless allowed", () => {
    const fields = [
        textField({
            id: 10,
            name: "locked",
            rect: "[50 600 300 620]",
            extras: "/Ff 1"
        })
    ];
    const editor = loadPdf(buildFormFixture(fields, [10]));
    assert.throws(
        () => fillFormFields(editor, { locked: "x" }),
        /is read-only; pass allowReadOnly/
    );

    const { reloaded } = fillAndReload(
        fields,
        [10],
        { locked: "x" },
        {
            allowReadOnly: true
        }
    );
    assert.deepEqual(readFormValues(reloaded).get("locked"), {
        kind: "text",
        text: "x"
    });
});

test("a signature field is refused", () => {
    const editor = loadPdf(
        buildFormFixture(
            [
                {
                    id: 10,
                    body:
                        "<< /Type /Annot /Subtype /Widget /FT /Sig /T (sig)" +
                        " /Rect [50 600 300 620] /P 3 0 R >>"
                }
            ],
            [10]
        )
    );
    assert.throws(
        () => fillFormFields(editor, { sig: "x" }),
        /is a signature field; use addSignatureField/
    );
});

test("a pushbutton is refused", () => {
    const editor = loadPdf(
        buildFormFixture(
            radioGroup({
                id: 20,
                name: "go",
                states: ["On"],
                firstKidId: 21,
                flags: 65536
            }),
            [20]
        )
    );
    assert.throws(
        () => fillFormFields(editor, { go: "On" }),
        /is a pushbutton and holds no value/
    );
});

test("a text field refuses a value that is not a string", () => {
    const editor = loadPdf(buildFormFixture(twoTextFields(), [10, 11]));
    assert.throws(
        () => fillFormFields(editor, { alpha: true }),
        /is a text field and takes a string value/
    );
});

test("a rejected fill leaves the document untouched", () => {
    const original = buildFormFixture(twoTextFields(), [10, 11]);
    const editor = loadPdf(original);
    assert.throws(() =>
        fillFormFields(editor, { alpha: "fine", gamma: "unknown" })
    );
    assert.equal(editor.updated.size, 0);
    assert.equal(editor.added.length, 0);
    assert.deepEqual(editor.save().slice(0, original.length), original);
});

test("a document declaring no AcroForm cannot be filled", () => {
    const editor = loadPdf(
        assembleFixture(
            [
                { id: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
                { id: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
                {
                    id: 3,
                    body:
                        "<< /Type /Page /Parent 2 0 R" +
                        " /MediaBox [0 0 612 792] >>"
                }
            ],
            1
        )
    );
    assert.throws(
        () => fillFormFields(editor, { alpha: "x" }),
        /declares no AcroForm/
    );
});

test("a field outside the AcroForm's /Fields is not addressable", () => {
    const editor = loadPdf(buildFormFixture(twoTextFields(), [10]));
    assert.throws(
        () => fillFormFields(editor, { beta: "x" }),
        /no field named beta/
    );
});

test("filling an XFA form requires an explicit choice", () => {
    const bytes = buildFormFixture(
        twoTextFields(),
        [10, 11],
        "/XFA [(template) 4 0 R]"
    );
    assert.throws(
        () => fillFormFields(loadPdf(bytes), { alpha: "x" }),
        /carries an \/XFA entry/
    );
});

test("keeping XFA leaves the entry in place", () => {
    const bytes = buildFormFixture(
        twoTextFields(),
        [10, 11],
        "/XFA [(template) 4 0 R]"
    );
    const editor = loadPdf(bytes);
    const result = fillFormFields(editor, { alpha: "x" }, { xfa: "keep" });
    assert.equal(result.xfaRemoved, false);
    assert.equal(readAcroForm(loadPdf(editor.save())).hasXfa, true);
});

test("removing XFA drops the entry and keeps the rest of the form", () => {
    const bytes = buildFormFixture(
        twoTextFields(),
        [10, 11],
        "/XFA [(template) 4 0 R]"
    );
    const editor = loadPdf(bytes);
    const result = fillFormFields(editor, { alpha: "x" }, { xfa: "remove" });
    assert.equal(result.xfaRemoved, true);

    const form = readAcroForm(loadPdf(editor.save()));
    assert.equal(form.hasXfa, false);
    assert.equal(form.fields.length, 2);
    assert.equal(form.defaultAppearance, "/Helv 0 Tf 0 g");
});

test("NeedAppearances is set only when asked for", () => {
    const plain = fillAndReload(twoTextFields(), [10, 11], { alpha: "x" });
    assert.equal(plain.result.needAppearancesSet, false);
    assert.equal(readAcroForm(plain.reloaded).needAppearances, false);

    const asked = fillAndReload(
        twoTextFields(),
        [10, 11],
        { alpha: "x" },
        { needAppearances: true }
    );
    assert.equal(asked.result.needAppearancesSet, true);
    assert.equal(readAcroForm(asked.reloaded).needAppearances, true);
});

test("several fields fill in one update", () => {
    const { reloaded, result } = fillAndReload(twoTextFields(), [10, 11], {
        alpha: "one",
        beta: "two"
    });
    assert.equal(result.filled.length, 2);
    const values = readFormValues(reloaded);
    assert.deepEqual(values.get("alpha"), { kind: "text", text: "one" });
    assert.deepEqual(values.get("beta"), { kind: "text", text: "two" });
});

test("a second fill of the same document stacks another update", () => {
    const first = loadPdf(buildFormFixture(twoTextFields(), [10, 11]));
    fillFormFields(first, { alpha: "one" });
    const once = first.save();

    const second = loadPdf(once);
    fillFormFields(second, { beta: "two" });
    const twice = second.save();

    const values = readFormValues(loadPdf(twice));
    assert.deepEqual(values.get("alpha"), { kind: "text", text: "one" });
    assert.deepEqual(values.get("beta"), { kind: "text", text: "two" });
    assert.deepEqual(twice.slice(0, once.length), once);
});
