/**
 * Flattening a filled form: the appearances reach the page, the form and its
 * widgets are gone, and what remains can be merged without leaving annotations
 * behind that belong to nothing.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { fillFormFields } from "../../../lib/pdf/forms/fill.mjs";
import { readAcroForm } from "../../../lib/pdf/forms/field-tree.mjs";
import { flattenFormFields } from "../../../lib/pdf/forms/flatten.mjs";
import { mergePdfs } from "../../../lib/pdf/merge.mjs";
import { getRaw, loadPdf } from "../../../lib/pdf/reader.mjs";

import { buildFormFixture, radioGroup, textField } from "./form-fixture.mjs";

const latin1 = new TextDecoder("latin1");
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const W9 = join(FIXTURES, "irs-w9.pdf");
const WHEN_W9 = { skip: !existsSync(W9) };

/** A fixture with one text field and one radio group. */
function fixture() {
    return buildFormFixture(
        [
            textField({ id: 10, name: "alpha", rect: "[50 600 300 620]" }),
            ...radioGroup({
                id: 20,
                name: "pick",
                states: ["Alpha", "Beta"],
                firstKidId: 21
            })
        ],
        [10, 20]
    );
}

/**
 * Fill, flatten and reload.
 * @param {Record<string, import("../../../lib/pdf/forms/types.mjs").FormFieldInput>} values
 */
function flattened(values) {
    const editor = loadPdf(fixture());
    fillFormFields(editor, values);
    const filled = editor.save();

    const second = loadPdf(filled);
    const result = flattenFormFields(second);
    return { filled, result, bytes: second.save() };
}

test("the form is gone from the catalog", () => {
    const { bytes } = flattened({ alpha: "Acme", pick: "Beta" });
    assert.equal(readAcroForm(loadPdf(bytes)), null);
});

test("the widget annotations are removed from their page", () => {
    const { bytes } = flattened({ alpha: "Acme", pick: "Beta" });
    const editor = loadPdf(bytes);
    const annots = getRaw(editor.getDict(editor.pageIds[0]).entries, "Annots");
    assert.equal(annots.replace(/\s/g, ""), "[]");
});

test("the appearance is painted into the page's content", () => {
    const { bytes, result } = flattened({ alpha: "Acme", pick: "Beta" });
    assert.equal(
        result.widgetsPainted,
        3,
        "the text field, the on state, and the fixture's Off appearance"
    );
    assert.equal(result.widgetsRemoved, 3, "every widget of both fields");

    const editor = loadPdf(bytes);
    const contents = getRaw(
        editor.getDict(editor.pageIds[0]).entries,
        "Contents"
    );
    const ids = [...contents.matchAll(/(\d+)\s+0\s+R/g)].map((m) =>
        Number(m[1])
    );
    const painted = ids
        .map((id) =>
            latin1.decode(
                editor.getObjectRaw(id).streamBytes || new Uint8Array(0)
            )
        )
        .join("\n");
    assert.match(painted, /\/FlatFm\d+x\d+ Do/, "an appearance is drawn");
    assert.match(painted, /cm/, "placed by a transformation");
});

test("the painted appearances are registered in the page's resources", () => {
    const { bytes, result } = flattened({ alpha: "Acme", pick: "Beta" });
    const editor = loadPdf(bytes);
    const resources = getRaw(
        editor.getDict(editor.pageIds[0]).entries,
        "Resources"
    );
    const names = [...resources.matchAll(/\/FlatFm\d+x\d+/g)];
    assert.equal(
        names.length,
        result.widgetsPainted,
        "every painted appearance is named"
    );
});

test("the page's own content is bracketed before the appearances", () => {
    const { bytes } = flattened({ alpha: "Acme" });
    const editor = loadPdf(bytes);
    const contents = getRaw(
        editor.getDict(editor.pageIds[0]).entries,
        "Contents"
    );
    const ids = [...contents.matchAll(/(\d+)\s+0\s+R/g)].map((m) =>
        Number(m[1])
    );
    const first = latin1.decode(editor.getObjectRaw(ids[0]).streamBytes);
    const last = latin1.decode(
        editor.getObjectRaw(ids[ids.length - 1]).streamBytes
    );
    assert.equal(first.trim(), "q", "the original content is saved first");
    assert.match(last, /^Q/, "and restored before anything is painted");
});

test("a button with no Off appearance draws nothing when unselected", () => {
    const editor = loadPdf(
        buildFormFixture(
            radioGroup({
                id: 20,
                name: "pick",
                states: ["Alpha", "Beta"],
                firstKidId: 21,
                offAppearance: false
            }),
            [20]
        )
    );
    fillFormFields(editor, { pick: "Beta" });

    const second = loadPdf(editor.save());
    const result = flattenFormFields(second);
    assert.equal(result.widgetsPainted, 1, "only the selected state is drawn");
    assert.equal(result.widgetsRemoved, 2);
    assert.deepEqual(
        result.withoutAppearance,
        ["pick"],
        "the widget left Off had no state to draw"
    );
});

test("a document with no form flattens to nothing", () => {
    const editor = loadPdf(fixture());
    const first = flattenFormFields(editor);
    assert.equal(first.fieldsFlattened, 2);

    const second = loadPdf(editor.save());
    assert.deepEqual(flattenFormFields(second), {
        fieldsFlattened: 0,
        widgetsPainted: 0,
        widgetsRemoved: 0,
        withoutAppearance: []
    });
});

test("the original revision survives beneath the flattening", () => {
    const { filled, bytes } = flattened({ alpha: "Acme" });
    assert.ok(bytes.length > filled.length);
    assert.deepEqual(bytes.slice(0, filled.length), filled);
});

test("a flattened form merges without leaving orphaned widgets", () => {
    const { bytes } = flattened({ alpha: "Acme", pick: "Beta" });
    const merged = mergePdfs([bytes, bytes]);
    const editor = loadPdf(merged);
    assert.equal(editor.pageCount(), 2);
    assert.equal(readAcroForm(editor), null);
    for (const pageId of editor.pageIds) {
        const annots = getRaw(editor.getDict(pageId).entries, "Annots");
        assert.equal(
            annots === undefined || annots.replace(/\s/g, "") === "[]",
            true,
            "no annotation outlives the form it belonged to"
        );
    }
});

test("an applied signature is not flattened away", () => {
    const signed = loadPdf(
        buildFormFixture(
            [
                {
                    id: 10,
                    body:
                        "<< /Type /Annot /Subtype /Widget /FT /Sig /T (sig)" +
                        " /V 12 0 R /Rect [50 600 300 620] /P 3 0 R >>"
                },
                { id: 12, body: "<< /Type /Sig /Contents <00> >>" }
            ],
            [10]
        )
    );
    assert.throws(
        () => flattenFormFields(signed),
        /carries a signature; flattening would discard what it signed/
    );
});

test("an unsigned signature field does not block flattening", () => {
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
    assert.equal(flattenFormFields(editor).fieldsFlattened, 1);
});

test("the W-9's filled values reach the flattened page", WHEN_W9, () => {
    const editor = loadPdf(new Uint8Array(readFileSync(W9)));
    const page1 = "topmostSubform[0].Page1[0].";
    fillFormFields(
        editor,
        {
            [page1 + "f1_01[0]"]: "Solomon Labs Pty Ltd",
            [page1 + "Boxes3a-b_ReadOrder[0].c1_1[1]"]: "2"
        },
        { xfa: "remove" }
    );

    const filled = loadPdf(editor.save());
    const result = flattenFormFields(filled);
    assert.equal(result.fieldsFlattened, 23);
    assert.equal(result.widgetsPainted, 2, "one text value and one check mark");
    assert.equal(result.widgetsRemoved, 23);

    const flat = loadPdf(filled.save());
    assert.equal(readAcroForm(flat), null);
    const resources = getRaw(
        flat.getDict(flat.pageIds[0]).entries,
        "Resources"
    );
    assert.equal([...resources.matchAll(/\/FlatFm\d+x\d+/g)].length, 2);
    assert.match(resources, /\/Font/, "the page keeps its own resources");
});

/**
 * The transformation the flattened page applies to a widget's appearance.
 * @param {Uint8Array} bytes
 * @returns {number[][]}
 */
function placements(bytes) {
    const editor = loadPdf(bytes);
    const contents = getRaw(
        editor.getDict(editor.pageIds[0]).entries,
        "Contents"
    );
    const ids = [...contents.matchAll(/(\d+)\s+0\s+R/g)].map((m) =>
        Number(m[1])
    );
    const painted = ids
        .map((id) =>
            latin1.decode(
                editor.getObjectRaw(id).streamBytes || new Uint8Array(0)
            )
        )
        .join("\n");
    return [
        ...painted.matchAll(
            /q ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) cm/g
        )
    ].map((match) => match.slice(1).map(Number));
}

/**
 * A single text field whose widget carries a prepared appearance.
 * @param {string} rect
 * @param {string} bbox
 * @param {string} [matrix]
 * @returns {Uint8Array}
 */
function preparedAppearance(rect, bbox, matrix) {
    return buildFormFixture(
        [
            {
                id: 10,
                body:
                    "<< /Type /Annot /Subtype /Widget /FT /Tx /T (alpha)" +
                    " /Rect " +
                    rect +
                    " /P 3 0 R /V (x) /AP << /N 30 0 R >> >>"
            },
            {
                id: 30,
                body:
                    "<< /Type /XObject /Subtype /Form /BBox " +
                    bbox +
                    (matrix === undefined ? "" : " /Matrix " + matrix) +
                    " /Length 0 >>\nstream\n\nendstream"
            }
        ],
        [10]
    );
}

test("an appearance the size of its widget is placed at its corner", () => {
    const editor = loadPdf(
        preparedAppearance("[50 600 300 620]", "[0 0 250 20]")
    );
    flattenFormFields(editor);
    assert.deepEqual(placements(editor.save()), [[1, 0, 0, 1, 50, 600]]);
});

test("an appearance smaller than its widget is scaled onto it", () => {
    const editor = loadPdf(
        preparedAppearance("[50 600 300 620]", "[0 0 100 10]")
    );
    flattenFormFields(editor);
    assert.deepEqual(placements(editor.save()), [[2.5, 0, 0, 2, 50, 600]]);
});

test("an appearance whose box is offset is mapped by that offset", () => {
    const editor = loadPdf(
        preparedAppearance("[50 600 300 620]", "[10 5 110 15]")
    );
    flattenFormFields(editor);
    assert.deepEqual(placements(editor.save()), [[2.5, 0, 0, 2, 25, 590]]);
});

test("an appearance's own matrix is accounted for before mapping", () => {
    // A quarter turn maps a 100x10 box onto a 10x100 one, so the widget's
    // 250x20 rectangle scales it by 25 across and 0.2 down.
    const editor = loadPdf(
        preparedAppearance("[50 600 300 620]", "[0 0 100 10]", "[0 1 -1 0 0 0]")
    );
    flattenFormFields(editor);
    assert.deepEqual(placements(editor.save()), [[25, 0, 0, 0.2, 300, 600]]);
});

test("a corner-reversed widget rectangle is still mapped right", () => {
    const editor = loadPdf(
        preparedAppearance("[300 620 50 600]", "[0 0 250 20]")
    );
    flattenFormFields(editor);
    assert.deepEqual(placements(editor.save()), [[1, 0, 0, 1, 50, 600]]);
});

test("a hidden widget is removed without being painted", () => {
    const editor = loadPdf(
        buildFormFixture(
            [
                {
                    id: 10,
                    body:
                        "<< /Type /Annot /Subtype /Widget /FT /Tx /T (alpha)" +
                        " /F 2 /Rect [50 600 300 620] /P 3 0 R /V (x)" +
                        " /AP << /N 30 0 R >> >>"
                },
                {
                    id: 30,
                    body:
                        "<< /Type /XObject /Subtype /Form /BBox [0 0 250 20]" +
                        " /Length 0 >>\nstream\n\nendstream"
                }
            ],
            [10]
        )
    );
    const result = flattenFormFields(editor);
    assert.equal(result.widgetsPainted, 0);
    assert.equal(result.widgetsRemoved, 1);
});
