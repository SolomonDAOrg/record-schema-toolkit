/**
 * Wave 12 validation: CMYK + spot (Separation) color. node internals only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import DocMod from "../../lib/pdf/document.mjs";
import CsMod from "../../lib/pdf/content-stream.mjs";

const { PdfDocumentBuilder } = DocMod;
const { PdfContentStreamBuilder } = CsMod;
const dec = new TextDecoder("latin1");

test("CMYK fill/stroke emit k / K operators", () => {
    assert.equal(
        new PdfContentStreamBuilder().setFillCMYK(1, 0, 0.5, 0.2).build(),
        "1 0 0.5 0.2 k"
    );
    assert.equal(
        new PdfContentStreamBuilder().setStrokeCMYK(0, 1, 0, 0).build(),
        "0 1 0 0 K"
    );
});

test("color space + scn/SCN operators", () => {
    assert.equal(
        new PdfContentStreamBuilder().setFillColorSpace("CS1").build(),
        "/CS1 cs"
    );
    assert.equal(
        new PdfContentStreamBuilder().setStrokeColorSpace("CS1").build(),
        "/CS1 CS"
    );
    assert.equal(
        new PdfContentStreamBuilder().setFillColorN(0.5).build(),
        "0.5 scn"
    );
    assert.equal(
        new PdfContentStreamBuilder().setStrokeColorN(0.25, 0.5).build(),
        "0.25 0.5 SCN"
    );
});

test("spot convenience sets space then tint", () => {
    assert.equal(
        new PdfContentStreamBuilder().setFillSpot("CS1", 0.7).build(),
        "/CS1 cs\n0.7 scn"
    );
    assert.equal(
        new PdfContentStreamBuilder().setStrokeSpot("CS2", 1).build(),
        "/CS2 CS\n1 SCN"
    );
});

test("registerSpotColor builds a Separation with a tint transform", () => {
    const doc = new PdfDocumentBuilder({ compress: false });
    const spot = doc.registerSpotColor("PANTONE 185 C", [0, 1, 1, 0]);
    assert.equal(spot, "CS1");
    const cs = new PdfContentStreamBuilder();
    cs.setFillSpot(spot, 1).rectangle(0, 0, 50, 50).fill();
    doc.addPageFromString(cs.build());
    const s = dec.decode(doc.build());

    assert.ok(s.includes("/ColorSpace <<"), "ColorSpace resource dict");
    assert.ok(s.includes("[/Separation "), "Separation color space");
    assert.ok(s.includes("/DeviceCMYK"), "CMYK alternate space");
    assert.ok(s.includes("/FunctionType 2"), "exponential tint transform");
    assert.ok(s.includes("/C1 [0 1 1 0]"), "CMYK equivalent at full tint");
    // colorant name is a PDF name with whitespace escaped
    assert.ok(/\/PANTONE#20185#20C\b/.test(s), "escaped colorant name");
});

test("multiple spot colors get distinct resource names", () => {
    const doc = new PdfDocumentBuilder({ compress: false });
    const a = doc.registerSpotColor("Ink A", [1, 0, 0, 0]);
    const b = doc.registerSpotColor("Ink B", [0, 0, 0, 1]);
    assert.equal(a, "CS1");
    assert.equal(b, "CS2");
    const cs = new PdfContentStreamBuilder();
    cs.setFillSpot(a, 1).rectangle(0, 0, 10, 10).fill();
    cs.setFillSpot(b, 1).rectangle(20, 0, 10, 10).fill();
    doc.addPageFromString(cs.build());
    const s = dec.decode(doc.build());
    assert.ok(/\/CS1 \[\/Separation/.test(s), "CS1 present");
    assert.ok(/\/CS2 \[\/Separation/.test(s), "CS2 present");
});

test("default spot equivalent is process black", () => {
    const doc = new PdfDocumentBuilder({ compress: false });
    doc.registerSpotColor("Spot");
    doc.addPageFromString(
        new PdfContentStreamBuilder()
            .setFillSpot("CS1", 1)
            .rectangle(0, 0, 5, 5)
            .fill()
            .build()
    );
    const s = dec.decode(doc.build());
    assert.ok(s.includes("/C1 [0 0 0 1]"), "defaults to K=1");
});
