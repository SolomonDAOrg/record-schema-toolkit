/**
 * Wave 9 validation: transparency (ExtGState), clipping, and line styling.
 * node internals only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import DocMod from "../../lib/pdf/document.mjs";
import CsMod from "../../lib/pdf/content-stream.mjs";

const { PdfDocumentBuilder } = DocMod;
const { PdfContentStreamBuilder } = CsMod;
const dec = new TextDecoder("latin1");

test("line dash / cap / join / miter emit the right operators", () => {
    const s = new PdfContentStreamBuilder()
        .setDash([6, 3], 1)
        .setLineCap(1)
        .setLineJoin(2)
        .setMiterLimit(4)
        .build();
    assert.equal(s, "[6 3] 1 d\n1 J\n2 j\n4 M");
});

test("solid dash uses an empty array", () => {
    assert.equal(new PdfContentStreamBuilder().setDash([]).build(), "[] 0 d");
});

test("clip and clipEvenOdd emit W n / W* n", () => {
    assert.equal(new PdfContentStreamBuilder().clip().build(), "W n");
    assert.equal(new PdfContentStreamBuilder().clipEvenOdd().build(), "W* n");
});

test("setExtGState emits a gs operator", () => {
    assert.equal(
        new PdfContentStreamBuilder().setExtGState("GS1").build(),
        "/GS1 gs"
    );
});

test("registerExtGState builds ca/CA/BM and names states", () => {
    const doc = new PdfDocumentBuilder();
    const a = doc.registerExtGState({ fillAlpha: 0.3 });
    const b = doc.registerExtGState({
        strokeAlpha: 0.5,
        blendMode: "Multiply"
    });
    assert.equal(a, "GS1");
    assert.equal(b, "GS2");
});

test("alpha values are clamped and trimmed", () => {
    const doc = new PdfDocumentBuilder({ compress: false });
    doc.registerExtGState({ fillAlpha: 0.25, strokeAlpha: 2 }); // 2 -> clamp to 1
    doc.addPageFromString("BT ET");
    const s = dec.decode(doc.build());
    assert.ok(s.includes("/ca 0.25"), "fill alpha");
    assert.ok(s.includes("/CA 1"), "stroke alpha clamped to 1");
    assert.ok(s.includes("/Type /ExtGState"), "typed ext gstate");
});

test("registered ExtGStates land in the page /Resources", () => {
    const doc = new PdfDocumentBuilder({ compress: false });
    const gs = doc.registerExtGState({ fillAlpha: 0.4, blendMode: "Screen" });
    const cs = new PdfContentStreamBuilder();
    cs.saveState()
        .setExtGState(gs)
        .setFillColor(0, 0, 0)
        .rectangle(0, 0, 100, 100)
        .fill()
        .restoreState();
    doc.addPageFromString(cs.build());
    const s = dec.decode(doc.build());
    assert.ok(/\/ExtGState <<[^>]*\/GS1 <</.test(s), "ExtGState resource dict");
    assert.ok(s.includes("/BM /Screen"), "blend mode present");
});

test("a form XObject can use a document ExtGState (shared resources)", () => {
    // Transparency composes with Form XObjects because forms reference the
    // shared document resources, which now include /ExtGState.
    const doc = new PdfDocumentBuilder({ compress: false });
    const gs = doc.registerExtGState({ fillAlpha: 0.2 });
    const wm = new PdfContentStreamBuilder()
        .setExtGState(gs)
        .setFillColor(0.5, 0.5, 0.5)
        .rectangle(50, 50, 200, 80)
        .fill()
        .build();
    const fm = doc.registerFormXObject(wm, { bbox: [0, 0, 612, 792] });
    doc.addPageFromString(new PdfContentStreamBuilder().drawForm(fm).build());
    const s = dec.decode(doc.build());
    assert.ok(s.includes("/GS1 gs"), "form uses the ext gstate");
    assert.ok(/\/ExtGState <</.test(s), "ext gstate in shared resources");
});
