/**
 * Wave 13 validation: PDF/A conformance scaffolding (XMP pdfaid, OutputIntent,
 * embedded ICC). Structural checks only — full conformance needs a PDF/A
 * validator (veraPDF), which isn't part of this suite. node internals only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import DocMod from "../../lib/pdf/document.mjs";
import { getSrgbIccProfile } from "../../lib/pdf/icc.mjs";

const { PdfDocumentBuilder } = DocMod;
const dec = new TextDecoder("latin1");

/** Build a one-page doc and return its bytes as a latin1 string. */
function build(opts) {
    const d = new PdfDocumentBuilder(opts);
    d.addPageFromString("BT /F1 12 Tf 72 700 Td (record) Tj ET\n");
    return dec.decode(d.build());
}

test("the embedded sRGB ICC profile is valid (ICC v2 monitor RGB)", () => {
    const icc = getSrgbIccProfile();
    assert.ok(icc.length > 500, "non-trivial profile");
    assert.equal(icc[8], 2, "ICC major version 2");
    assert.equal(
        String.fromCharCode(icc[12], icc[13], icc[14], icc[15]),
        "mntr",
        "device class = display/monitor"
    );
    assert.equal(
        String.fromCharCode(icc[16], icc[17], icc[18], icc[19]),
        "RGB ",
        "data color space RGB"
    );
});

test("pdfa:'2b' sets the PDF 1.7 header", () => {
    const s = build({ title: "x", pdfa: "2b" });
    assert.ok(s.startsWith("%PDF-1.7"), "1.7 header");
});

test("pdfa adds the pdfaid identification block to the XMP", () => {
    const s = build({ title: "x", pdfa: "2b" });
    assert.ok(s.includes("<pdfaid:part>2</pdfaid:part>"), "part 2");
    assert.ok(
        s.includes("<pdfaid:conformance>B</pdfaid:conformance>"),
        "level B"
    );
});

test("pdfa conformance level and part are parsed", () => {
    assert.ok(
        build({ title: "x", pdfa: "2a" }).includes(
            "<pdfaid:conformance>A</pdfaid:conformance>"
        ),
        "2a -> level A"
    );
    assert.ok(
        build({ title: "x", pdfa: 1 }).includes("<pdfaid:part>1</pdfaid:part>"),
        "1 -> part 1"
    );
});

test("pdfa adds an OutputIntent with an embedded ICC profile", () => {
    const s = build({ title: "x", pdfa: "2b" });
    assert.ok(/\/OutputIntents \[<</.test(s), "catalog /OutputIntents array");
    assert.ok(s.includes("/S /GTS_PDFA1"), "PDF/A output intent subtype");
    assert.ok(
        s.includes("/OutputConditionIdentifier (sRGB IEC61966-2.1)"),
        "condition id"
    );
    assert.ok(/\/DestOutputProfile \d+ 0 R/.test(s), "dest output profile ref");
    assert.ok(s.includes("/N 3"), "ICC stream has 3 components");
});

test("pdfa forces an XMP /Metadata stream", () => {
    const s = build({ title: "x", pdfa: "2b" });
    assert.ok(/\/Metadata \d+ 0 R/.test(s), "catalog references metadata");
    assert.ok(s.includes("<?xpacket begin="), "XMP packet embedded");
});

test("PDF/A and encryption are mutually exclusive", () => {
    assert.throws(
        () =>
            new PdfDocumentBuilder({
                pdfa: "2b",
                encryption: { ownerPassword: "x" }
            }),
        /PDF\/A does not permit encryption/
    );
});

test("an explicit outputIntent works without pdfa (custom profile + id)", () => {
    const icc = new Uint8Array(600).fill(7); // stand-in profile bytes
    const d = new PdfDocumentBuilder({
        title: "x",
        outputIntent: { iccProfile: icc, n: 4, identifier: "MyCMYK" }
    });
    d.addPageFromString("BT ET");
    const s = dec.decode(d.build());
    assert.ok(/\/OutputIntents \[/.test(s), "output intent present");
    assert.ok(s.includes("/OutputConditionIdentifier (MyCMYK)"), "custom id");
    assert.ok(s.includes("/N 4"), "custom component count");
    // no pdfaid unless pdfa was requested
    assert.ok(!s.includes("pdfaid:part"), "no PDF/A claim without pdfa");
});

test("no OutputIntent or pdfaid on a plain document", () => {
    const s = build({ title: "x" });
    assert.ok(!s.includes("/OutputIntents"), "no output intent");
    assert.ok(!s.includes("pdfaid"), "no PDF/A id");
    assert.ok(s.startsWith("%PDF-1.4"), "default header unchanged");
});
