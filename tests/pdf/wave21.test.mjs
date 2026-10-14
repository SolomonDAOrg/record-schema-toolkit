/**
 * Wave 20 validation: text extraction. Round-trips text through the library's
 * own generation (so the expected output is known). Uses a system font for the
 * Type0/Unicode case; those checks skip if none is found. node internals only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

import DocMod from "../../lib/pdf/document.mjs";
import CsMod from "../../lib/pdf/content-stream.mjs";
import { layoutTable } from "../../lib/pdf/table.mjs";
import { extractText } from "../../lib/pdf/extract-text.mjs";

const { PdfDocumentBuilder } = DocMod;
const { PdfContentStreamBuilder } = CsMod;

const FONT_PATH =
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf";
const HAS_FONT = existsSync(FONT_PATH);
const TTF = HAS_FONT ? new Uint8Array(readFileSync(FONT_PATH)) : null;

test("extracts WinAnsi text from a builtin font, in reading order", () => {
    const d = new PdfDocumentBuilder({ title: "t" });
    const cs = new PdfContentStreamBuilder();
    cs.beginText()
        .setFont("F1", 14)
        .setTextMatrix(1, 0, 0, 1, 72, 720)
        .showText("The quick brown fox")
        .showTextNextLine("jumps over the lazy dog")
        .endText();
    d.addPageFromString(cs.build());
    const { text } = extractText(d.build());
    assert.equal(text, "The quick brown fox\njumps over the lazy dog");
});

test("decodes WinAnsi high bytes (currency, dashes, quotes)", () => {
    const d = new PdfDocumentBuilder({ title: "t" });
    const cs = new PdfContentStreamBuilder();
    cs.beginText()
        .setFont("F1", 14)
        .setTextMatrix(1, 0, 0, 1, 72, 720)
        .showText("Price €100 — £50 “quoted”")
        .endText();
    d.addPageFromString(cs.build());
    const { text } = extractText(d.build());
    assert.ok(text.includes("€100"), "euro");
    assert.ok(text.includes("—"), "em dash");
    assert.ok(text.includes("£50"), "pound");
    assert.ok(text.includes("“quoted”"), "smart quotes");
});

test(
    "extracts full Unicode from a Type0 font via ToUnicode",
    { skip: !HAS_FONT },
    () => {
        const d = new PdfDocumentBuilder({ title: "t" });
        const f = d.registerCIDFont(TTF);
        const cs = new PdfContentStreamBuilder();
        cs.beginText().setFont(f, 16).setTextMatrix(1, 0, 0, 1, 72, 700);
        cs.showGlyphHex(d.encodeCIDText(f, "Ωμέγα Привет café"));
        cs.endText();
        d.addPageFromString(cs.build());
        const { text } = extractText(d.build());
        assert.equal(text, "Ωμέγα Привет café");
    }
);

test("returns one string per page", () => {
    const d = new PdfDocumentBuilder({ title: "t" });
    for (let i = 1; i <= 3; i++) {
        d.addPageFromString(`BT /F1 14 Tf 72 700 Td (Page ${i} body) Tj ET\n`);
    }
    const { pages } = extractText(d.build());
    assert.equal(pages.length, 3);
    assert.ok(pages[0].includes("Page 1 body"));
    assert.ok(pages[2].includes("Page 3 body"));
});

test("extracts text from TJ arrays with kerning", () => {
    const d = new PdfDocumentBuilder({ title: "t" });
    const cs = new PdfContentStreamBuilder();
    cs.beginText().setFont("F1", 14).setTextMatrix(1, 0, 0, 1, 72, 700);
    // manual TJ with a large negative adjustment -> a word gap
    cs.operations.push("[(Hello) -300 (World)] TJ");
    cs.endText();
    d.addPageFromString(cs.build());
    const { text } = extractText(d.build());
    assert.ok(
        /Hello\s+World/.test(text),
        "TJ words with a gap: " + JSON.stringify(text)
    );
});

test("extracts table cell values", () => {
    const rows = [
        ["Alpha", "100"],
        ["Bravo", "250"]
    ];
    const { pages } = layoutTable({
        columns: [
            { header: "Name", width: 200 },
            { header: "Amt", align: "right" }
        ],
        rows,
        width: 400,
        x: 72,
        top: 720,
        bottom: 72
    });
    const d = new PdfDocumentBuilder({ title: "t" });
    for (const p of pages) {
        d.addPageFromString(p);
    }
    const { text } = extractText(d.build());
    for (const v of ["Name", "Amt", "Alpha", "100", "Bravo", "250"]) {
        assert.ok(text.includes(v), "cell " + v + " present");
    }
});

test("extracts text from an encrypted PDF with a password", () => {
    const d = new PdfDocumentBuilder({
        title: "t",
        encryption: { algorithm: "aes-256", userPassword: "pw" }
    });
    d.addPageFromString(
        "BT /F1 14 Tf 72 700 Td (Confidential body text) Tj ET\n"
    );
    const { text } = extractText(d.build(), { password: "pw" });
    assert.ok(text.includes("Confidential body text"), "decrypted + extracted");
});
