/**
 * Wave 5 validation: reader + incremental-update overlay. node internals only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import DocMod from "../../lib/pdf/document.mjs";
import CsMod from "../../lib/pdf/content-stream.mjs";
import { loadPdf } from "../../lib/pdf/reader.mjs";

const { PdfDocumentBuilder } = DocMod;
const { PdfContentStreamBuilder } = CsMod;
const dec = new TextDecoder("latin1");

/** @param {Uint8Array} b @returns {string} */
function toLatin1(b) {
    return dec.decode(b);
}

/** Build a plain N-page document. */
function buildDoc(n, title) {
    const d = new PdfDocumentBuilder({ title: title || "Doc" });
    for (let i = 1; i <= n; i++) {
        d.addPageFromString(`BT /F1 18 Tf 72 700 Td (Body page ${i}) Tj ET\n`);
    }
    return d.build();
}

/** A simple horizontal text stamp fragment. */
function stampOps(text) {
    return new PdfContentStreamBuilder()
        .beginText()
        .setFont("F1", 18)
        .setTextMatrix(1, 0, 0, 1, 100, 40)
        .showText(text)
        .endText()
        .build();
}

test("parses page count, root, and max object id from built output", () => {
    const ed = loadPdf(buildDoc(4));
    assert.equal(ed.pageCount(), 4, "4 pages");
    assert.ok(ed.rootId >= 1, "root id resolved");
    assert.ok(ed.maxId >= 4, "max id resolved");
});

test("overlay preserves the original bytes verbatim", () => {
    const original = buildDoc(3);
    const ed = loadPdf(original);
    ed.overlay(stampOps("MARK"));
    const out = ed.save();

    assert.ok(out.length > original.length, "grew");
    for (let i = 0; i < original.length; i++) {
        assert.equal(out[i], original[i], "byte " + i + " unchanged");
    }
});

test("overlay appends a valid incremental section (new xref + /Prev)", () => {
    const ed = loadPdf(buildDoc(2));
    ed.overlay(stampOps("MARK"));
    const s = toLatin1(ed.save());

    // two xref sections, two startxref, a /Prev
    assert.ok((s.match(/\nxref\n/g) || []).length >= 2, "second xref table");
    assert.ok((s.match(/startxref/g) || []).length >= 2, "second startxref");
    assert.ok(/\/Prev \d+/.test(s), "trailer /Prev");
    assert.ok(s.trimEnd().endsWith("%%EOF"), "ends at EOF");
});

test("each page gets the paint stream and the form is a Form XObject", () => {
    const ed = loadPdf(buildDoc(3));
    ed.overlay(stampOps("STAMPME"));
    const s = toLatin1(ed.save());

    // A Form XObject was added, drawing the stamp text.
    assert.ok(s.includes("/Subtype /Form"), "form xobject");
    assert.ok(s.includes("(STAMPME) Tj"), "stamp draws text");
    // Unique resource name used on the page resources.
    assert.ok(
        /\/XObject <<[^>]*\/OvFm\d+ \d+ 0 R/.test(s),
        "form in resources"
    );
    // Every page's /Contents became an array with the shared paint stream.
    const paintRefs = (s.match(/\/Contents \[\d+ 0 R \d+ 0 R\]/g) || []).length;
    assert.equal(paintRefs, 3, "3 pages point at orig + paint");
});

test("stamping a document that already has an /XObject keeps both", () => {
    // A registered Form XObject puts /XObject into the shared resources.
    const d = new PdfDocumentBuilder({ title: "WithForm" });
    const box = new PdfContentStreamBuilder()
        .setFillGray(0.9)
        .rectangle(20, 20, 80, 40)
        .fill()
        .build();
    const fm = d.registerFormXObject(box, { bbox: [0, 0, 612, 792] });
    d.addPageFromString(new PdfContentStreamBuilder().drawForm(fm).build());
    const ed = loadPdf(d.build());
    ed.overlay(stampOps("OVERLAID"));
    const s = toLatin1(ed.save());

    // The original form (Fm1) and the overlay form both live in /XObject now.
    // (Incremental update keeps the old object too, so check that *some*
    // /XObject dict — the updated one — contains both.)
    const dicts = [...s.matchAll(/\/XObject <<([^]*?)>>/g)].map((m) => m[1]);
    assert.ok(
        dicts.some(
            (x) => /\/Fm1 \d+ 0 R/.test(x) && /\/OvFm\d+ \d+ 0 R/.test(x)
        ),
        "an /XObject dict holds both the original and overlay forms"
    );
});

test("reloading a stamped PDF follows /Prev and can stamp again", () => {
    const ed1 = loadPdf(buildDoc(3));
    ed1.overlay(stampOps("FIRST"));
    const once = ed1.save();

    const ed2 = loadPdf(once);
    assert.equal(ed2.pageCount(), 3, "still 3 pages after reload");
    assert.ok(ed2.maxId > 4, "max id advanced past the first update");
    ed2.overlay(stampOps("SECOND"));
    const twice = toLatin1(ed2.save());

    // Distinct form names => both overlays survive.
    assert.ok(twice.includes("(FIRST) Tj"), "first stamp retained");
    assert.ok(twice.includes("(SECOND) Tj"), "second stamp present");
    assert.ok((twice.match(/\/Prev \d+/g) || []).length >= 2, "chained /Prev");
});

test("rejects input without a startxref", () => {
    assert.throws(
        () => loadPdf(new TextEncoder().encode("%PDF-1.4\nnot a real pdf\n")),
        /startxref/
    );
});
