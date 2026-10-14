/**
 * Wave 2 validation: Form XObjects (reusable content). node internals only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";

import DocMod from "../../lib/pdf/document.mjs";
import CsMod from "../../lib/pdf/content-stream.mjs";

const { PdfDocumentBuilder } = DocMod;
const { PdfContentStreamBuilder } = CsMod;
const dec = new TextDecoder("latin1");

/** @param {Uint8Array} b @returns {string} */
function toLatin1(b) {
    return dec.decode(b);
}

/** Reuse of the xref integrity check from wave1. */
function assertXrefIntegrity(pdf) {
    const s = toLatin1(pdf);
    const sx = s.lastIndexOf("startxref");
    const xrefOff = parseInt(
        s
            .slice(sx + 9)
            .trim()
            .split(/\s/)[0],
        10
    );
    const header = s.slice(xrefOff).match(/xref\s+(\d+)\s+(\d+)/);
    const count = parseInt(header[2], 10);
    const entriesStart = xrefOff + header[0].length + 1;
    for (let id = 1; id < count; id++) {
        const rec = s.slice(
            entriesStart + id * 20,
            entriesStart + id * 20 + 20
        );
        if (rec[17] !== "n") {
            continue;
        }
        const off = parseInt(rec.slice(0, 10), 10);
        assert.ok(
            new RegExp("^" + id + " 0 obj").test(s.slice(off, off + 24)),
            `object ${id} at offset ${off}`
        );
    }
}

test("drawForm emits Do with the right placement transforms", () => {
    const a = new PdfContentStreamBuilder().drawForm("Fm1").build();
    assert.equal(a, "q\n/Fm1 Do\nQ", "no placement -> bare q/Do/Q");

    const b = new PdfContentStreamBuilder()
        .drawForm("Fm1", { x: 100, y: 200 })
        .build();
    assert.equal(b, "q\n1 0 0 1 100 200 cm\n/Fm1 Do\nQ");

    const c = new PdfContentStreamBuilder()
        .drawForm("Fm2", { x: 10, y: 20, scaleX: 2, scaleY: 3 })
        .build();
    assert.equal(c, "q\n2 0 0 3 10 20 cm\n/Fm2 Do\nQ");

    const d = new PdfContentStreamBuilder()
        .drawForm("Fm3", { matrix: [0, 1, -1, 0, 50, 60] })
        .build();
    assert.equal(d, "q\n0 1 -1 0 50 60 cm\n/Fm3 Do\nQ");
});

test("form XObject: one object referenced by many pages, content round-trips", () => {
    const wm = new PdfContentStreamBuilder();
    wm.setFillGray(0.85).rectangle(40, 40, 120, 90).fill();
    const wmSource = wm.build();

    // Uncompressed build: operators are visible as raw text.
    const doc = new PdfDocumentBuilder({ title: "wm", compress: false });
    const name = doc.registerFormXObject(wmSource, { bbox: [0, 0, 612, 792] });
    assert.equal(name, "Fm1");
    doc.addPageFromString(
        new PdfContentStreamBuilder().drawForm(name, { x: 0, y: 0 }).build()
    );
    doc.addPageFromString(
        new PdfContentStreamBuilder().drawForm(name, { x: 0, y: 300 }).build()
    );
    const s = toLatin1(doc.build());

    // Exactly one Form XObject object exists...
    assert.equal(
        (s.match(/\/Subtype \/Form/g) || []).length,
        1,
        "single form object"
    );
    // ...referenced from the shared resources /XObject dict...
    assert.ok(/\/XObject <<[^>]*\/Fm1 \d+ 0 R/.test(s), "form in resources");
    // ...and painted on both pages.
    assert.equal((s.match(/\/Fm1 Do/g) || []).length, 2, "painted twice");
    assert.ok(s.includes("/FormType 1"));
    assert.ok(s.includes("/BBox [0 0 612 792]"));
    assert.ok(s.includes(wmSource), "raw form content present");
    assertXrefIntegrity(doc.build());

    // Compressed build: the form stream deflates back to the same operators.
    const cdoc = new PdfDocumentBuilder({ title: "wm" });
    cdoc.registerFormXObject(wmSource, { bbox: [0, 0, 612, 792] });
    cdoc.addPageFromString("BT ET");
    const cpdf = cdoc.build();
    const cs = toLatin1(cpdf);
    assert.ok(cs.includes("/Filter /FlateDecode"));

    const formHdr = cs.indexOf("/Subtype /Form");
    let p = cs.indexOf("stream", formHdr) + 6;
    if (cs[p] === "\r") {
        p++;
    }
    if (cs[p] === "\n") {
        p++;
    }
    let e = cs.indexOf("endstream", p);
    if (cs[e - 1] === "\n") {
        e--;
    }
    if (cs[e - 1] === "\r") {
        e--;
    }
    const inflated = toLatin1(new Uint8Array(inflateSync(cpdf.slice(p, e))));
    assert.equal(inflated, wmSource, "form content round-trips");
    assertXrefIntegrity(cpdf);
});

test("form bbox defaults to the document page size", () => {
    const doc = new PdfDocumentBuilder({ width: 400, height: 500 });
    doc.registerFormXObject("q Q");
    doc.addPageFromString("BT ET");
    const s = toLatin1(doc.build());
    assert.ok(s.includes("/BBox [0 0 400 500]"), "default bbox = page size");
});

test("form Matrix is emitted only when provided", () => {
    const doc = new PdfDocumentBuilder();
    doc.registerFormXObject("q Q", { matrix: [1, 0, 0, 1, 25, 25] });
    doc.addPageFromString("BT ET");
    const s = toLatin1(doc.build());
    assert.ok(s.includes("/Matrix [1 0 0 1 25 25]"));
});
