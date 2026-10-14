/**
 * The library against forms it did not produce: two IRS returns, which are
 * XFA-hybrid documents built on cross-reference and object streams, with
 * UTF-16BE field names, a deep name hierarchy, merged field/widget
 * dictionaries, comb and multiline text fields, checkboxes whose on states the
 * producer numbered, and an embedded font whose widths come from the file.
 *
 * The fixtures are the published forms. They are skipped rather than failed
 * when absent, so the suite still runs in a checkout without them.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { getRaw, loadPdf } from "../../../lib/pdf/reader.mjs";
import { readAcroForm } from "../../../lib/pdf/forms/field-tree.mjs";
import {
    fillFormFields,
    readFormValues
} from "../../../lib/pdf/forms/fill.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const W9 = join(FIXTURES, "irs-w9.pdf");
const W8 = join(FIXTURES, "irs-w8ben-e.pdf");
const WHEN_W9 = { skip: !existsSync(W9) };
const WHEN_W8 = { skip: !existsSync(W8) };

const latin1 = new TextDecoder("latin1");
const W9_PAGE1 = "topmostSubform[0].Page1[0].";
const W9_BOXES = W9_PAGE1 + "Boxes3a-b_ReadOrder[0].";
const W9_ADDRESS = W9_PAGE1 + "Address_ReadOrder[0].";

/**
 * @param {string} path
 * @returns {import("../../../lib/pdf/reader.mjs").PdfEditor}
 */
function open(path) {
    return loadPdf(new Uint8Array(readFileSync(path)));
}

/**
 * The content stream of a field's normal appearance.
 * @param {import("../../../lib/pdf/reader.mjs").PdfEditor} editor
 * @param {import("../../../lib/pdf/forms/types.mjs").FormField} field
 * @returns {string}
 */
function normalAppearance(editor, field) {
    const match = /\/N\s+(\d+)\s+0\s+R/.exec(
        getRaw(field.widgets[0].entries, "AP") || ""
    );
    assert.ok(match, "field " + field.name + " has an indirect /AP /N");
    return latin1.decode(editor.getObjectRaw(Number(match[1])).streamBytes);
}

test("the W-9's field names decode from UTF-16BE", WHEN_W9, () => {
    const form = readAcroForm(open(W9));
    assert.equal(form.fields.length, 23);
    const names = form.fields.map((field) => field.name);
    assert.ok(names.includes(W9_PAGE1 + "f1_01[0]"));
    assert.ok(names.includes(W9_BOXES + "c1_1[0]"));
    for (const name of names) {
        assert.ok(
            name.startsWith("topmostSubform[0]."),
            "hierarchical name: " + name
        );
    }
});

test("the W-9 reports its field types and flags", WHEN_W9, () => {
    const form = readAcroForm(open(W9));
    const counts = { text: 0, button: 0, choice: 0, signature: 0, unknown: 0 };
    for (const field of form.fields) {
        counts[field.type] = counts[field.type] + 1;
    }
    assert.deepEqual(counts, {
        text: 15,
        button: 8,
        choice: 0,
        signature: 0,
        unknown: 0
    });

    const byName = new Map(form.fields.map((field) => [field.name, field]));
    const employerId = byName.get(W9_PAGE1 + "f1_15[0]");
    assert.equal(employerId.type, "text");
    assert.equal(employerId.comb, true, "EIN is a comb field");
    assert.equal(employerId.maxLength, 7);

    const requester = byName.get(W9_PAGE1 + "f1_09[0]");
    assert.equal(requester.type, "text");
    assert.equal(requester.multiline, true);

    const exemptCode = byName.get(W9_PAGE1 + "f1_05[0]");
    assert.equal(exemptCode.quadding, 1, "centred");
});

test("the W-9's checkboxes name their own on states", WHEN_W9, () => {
    const form = readAcroForm(open(W9));
    const boxes = form.fields.filter(
        (field) => field.type === "button" && field.name.startsWith(W9_BOXES)
    );
    assert.equal(boxes.length, 8);
    for (const box of boxes) {
        assert.equal(box.type, "button");
        assert.equal(box.buttonKind, "checkbox");
        assert.equal(box.onStates.length, 1);
        assert.match(box.onStates[0], /^\d+$/, "numbered on state");
        assert.deepEqual(box.value, { kind: "state", state: "Off" });
    }
});

test("the W-9 is recognised as an XFA hybrid", WHEN_W9, () => {
    const form = readAcroForm(open(W9));
    assert.equal(form.hasXfa, true);
    assert.equal(form.needAppearances, false);
    assert.equal(form.defaultAppearance, "/Helv 0 Tf 0 g ");
    assert.throws(
        () => fillFormFields(open(W9), { [W9_PAGE1 + "f1_01[0]"]: "x" }),
        /carries an \/XFA entry/
    );
});

test("a filled W-9 reads its values back", WHEN_W9, () => {
    const editor = open(W9);
    const result = fillFormFields(
        editor,
        {
            [W9_PAGE1 + "f1_01[0]"]: "Solomon Labs Pty Ltd",
            [W9_PAGE1 + "f1_02[0]"]: "Solomon Labs",
            [W9_BOXES + "c1_1[1]"]: "2",
            [W9_ADDRESS + "f1_07[0]"]: "Level 3, 12 Example Street",
            [W9_PAGE1 + "f1_14[0]"]: "98",
            [W9_PAGE1 + "f1_15[0]"]: "7654321"
        },
        { xfa: "remove", needAppearances: true }
    );
    assert.equal(result.filled.length, 6);
    assert.equal(result.xfaRemoved, true);

    const original = readFileSync(W9);
    const saved = editor.save();
    assert.deepEqual(
        saved.slice(0, original.length),
        new Uint8Array(original),
        "the published form survives verbatim underneath"
    );

    const reloaded = loadPdf(saved);
    const values = readFormValues(reloaded);
    assert.deepEqual(values.get(W9_PAGE1 + "f1_01[0]"), {
        kind: "text",
        text: "Solomon Labs Pty Ltd"
    });
    assert.deepEqual(values.get(W9_BOXES + "c1_1[1]"), {
        kind: "state",
        state: "2"
    });
    assert.deepEqual(values.get(W9_PAGE1 + "f1_15[0]"), {
        kind: "text",
        text: "7654321"
    });
    assert.equal(readAcroForm(reloaded).hasXfa, false);
    assert.equal(readAcroForm(reloaded).needAppearances, true);
});

test("a filled W-9 checkbox keeps the file's appearance", WHEN_W9, () => {
    const editor = open(W9);
    fillFormFields(editor, { [W9_BOXES + "c1_1[1]"]: "2" }, { xfa: "keep" });
    const field = readAcroForm(loadPdf(editor.save())).fields.find(
        (candidate) => candidate.name === W9_BOXES + "c1_1[1]"
    );
    assert.equal(field.widgets[0].appearanceState, "2");
    assert.match(
        getRaw(field.widgets[0].entries, "AP"),
        /\/N\s*<<\s*\/2\s+\d+\s+0\s+R\s*>>/,
        "the producer's appearance dictionary is untouched"
    );
});

test("a W-9 comb field places one character per cell", WHEN_W9, () => {
    const editor = open(W9);
    fillFormFields(
        editor,
        { [W9_PAGE1 + "f1_15[0]"]: "7654321" },
        { xfa: "keep" }
    );
    const reloaded = loadPdf(editor.save());
    const field = readAcroForm(reloaded).fields.find(
        (candidate) => candidate.name === W9_PAGE1 + "f1_15[0]"
    );
    const content = normalAppearance(reloaded, field);
    const shown = [...content.matchAll(/\((.)\) Tj/g)].map((match) => match[1]);
    assert.deepEqual(shown, ["7", "6", "5", "4", "3", "2", "1"]);

    const positions = [...content.matchAll(/1 0 0 1 ([\d.]+) [\d.-]+ Tm/g)].map(
        (match) => Number(match[1])
    );
    assert.equal(positions.length, 7);
    const gaps = positions.slice(1).map((x, i) => x - positions[i]);
    for (const gap of gaps) {
        assert.ok(
            Math.abs(gap - gaps[0]) < 1e-6,
            "cells are evenly spaced: " + gaps.join(", ")
        );
    }
});

test("a W-9 multiline field wraps onto several lines", WHEN_W9, () => {
    const editor = open(W9);
    fillFormFields(
        editor,
        {
            [W9_PAGE1 + "f1_09[0]"]:
                "Requester Pty Ltd, 400 Long Avenue, Suite 1200," +
                " Melbourne VIC 3000"
        },
        { xfa: "keep" }
    );
    const reloaded = loadPdf(editor.save());
    const field = readAcroForm(reloaded).fields.find(
        (candidate) => candidate.name === W9_PAGE1 + "f1_09[0]"
    );
    const content = normalAppearance(reloaded, field);
    const baselines = [...content.matchAll(/1 0 0 1 [\d.]+ ([\d.]+) Tm/g)].map(
        (match) => Number(match[1])
    );
    assert.ok(baselines.length > 1, "wrapped onto more than one line");
    for (let i = 1; i < baselines.length; i++) {
        assert.ok(baselines[i] < baselines[i - 1], "lines run downward");
    }
});

test("the W-8BEN-E reads 179 fields, one a signature", WHEN_W8, () => {
    const form = readAcroForm(open(W8));
    assert.equal(form.fields.length, 179);
    const counts = { text: 0, button: 0, choice: 0, signature: 0, unknown: 0 };
    for (const field of form.fields) {
        counts[field.type] = counts[field.type] + 1;
    }
    assert.deepEqual(counts, {
        text: 66,
        button: 112,
        choice: 0,
        signature: 1,
        unknown: 0
    });
});

test("the W-8BEN-E's signature field is not fillable", WHEN_W8, () => {
    const editor = open(W8);
    const signature = readAcroForm(editor).fields.find(
        (field) => field.type === "signature"
    );
    assert.throws(
        () =>
            fillFormFields(editor, { [signature.name]: "x" }, { xfa: "keep" }),
        /is a signature field; use addSignatureField/
    );
});

test("a filled W-8BEN-E keeps the colour its /DA sets", WHEN_W8, () => {
    const editor = open(W8);
    const name = "topmostSubform[0].Page1[0].f1_1[0]";
    fillFormFields(
        editor,
        { [name]: "Solomon Labs Pty Ltd" },
        { xfa: "remove" }
    );
    const reloaded = loadPdf(editor.save());
    const field = readAcroForm(reloaded).fields.find(
        (candidate) => candidate.name === name
    );
    assert.equal(
        field.defaultAppearance,
        "/HelveticaLTStd-Bold 8.00 Tf 0.000 0.000 0.502 rg"
    );
    const content = normalAppearance(reloaded, field);
    assert.match(
        content,
        /0\.000 0\.000 0\.502 rg/,
        "the /DA colour operands are reproduced verbatim"
    );
    assert.match(content, /\/HelveticaLTStd-Bold 8 Tf/);
    assert.match(content, /\(Solomon Labs Pty Ltd\) Tj/);
});

test("appearances reference the form's embedded font", WHEN_W8, () => {
    const editor = open(W8);
    const name = "topmostSubform[0].Page1[0].f1_1[0]";
    fillFormFields(editor, { [name]: "Acme" }, { xfa: "keep" });
    const reloaded = loadPdf(editor.save());
    const field = readAcroForm(reloaded).fields.find(
        (candidate) => candidate.name === name
    );
    const match = /\/N\s+(\d+)\s+0\s+R/.exec(
        getRaw(field.widgets[0].entries, "AP")
    );
    const dictionary = reloaded.getObjectRaw(Number(match[1])).dictPart;
    assert.match(
        dictionary,
        /\/Font\s*<<\s*\/HelveticaLTStd-Bold\s+436\s+0\s+R\s*>>/,
        "the form's own font object is referenced"
    );
});
