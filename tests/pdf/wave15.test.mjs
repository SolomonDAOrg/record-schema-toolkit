/**
 * Wave 14 validation: cross-reference stream + object stream reading (modern
 * PDFs). Uses qpdf to produce xref-stream files; those tests skip if qpdf is
 * absent. The PNG-predictor decode is unit-tested directly. node internals only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

import DocMod from "../../lib/pdf/document.mjs";
import CsMod from "../../lib/pdf/content-stream.mjs";
import { loadPdf, applyPngPredictor } from "../../lib/pdf/reader.mjs";
import { mergePdfs } from "../../lib/pdf/merge.mjs";

const { PdfDocumentBuilder } = DocMod;
const { PdfContentStreamBuilder } = CsMod;
const dec = new TextDecoder("latin1");

let HAS_QPDF = true;
try {
    execSync("qpdf --version", { stdio: "ignore" });
} catch {
    HAS_QPDF = false;
}

/** Build a classic-xref PDF, then convert it to xref-stream + object-stream form. */
function xrefStreamPdf(label, pages) {
    const d = new PdfDocumentBuilder({ title: label });
    for (let i = 1; i <= pages; i++) {
        d.addPageFromString(`BT /F1 16 Tf 72 700 Td (${label}${i}) Tj ET\n`);
    }
    const cls = "/tmp/wt15_" + label + "_classic.pdf";
    const xs = "/tmp/wt15_" + label + "_xref.pdf";
    writeFileSync(cls, d.build());
    execSync(
        `qpdf --object-streams=generate --stream-data=preserve ${cls} ${xs}`,
        { stdio: "ignore" }
    );
    return new Uint8Array(readFileSync(xs));
}

test("PNG Up predictor is reconstructed correctly", () => {
    // 2 rows, 3 columns, 8bpc, 1 color. Up predictor (filter type 2): each row
    // stores the delta from the row above.
    // target rows: [10,20,30] then [11,19,33]
    // filtered:   ft=0 row0 raw; ft=2 row1 = [1,-1,3] as bytes
    const filtered = new Uint8Array([
        0,
        10,
        20,
        30, // filter 0 (none): 10,20,30
        2,
        1,
        255,
        3 //   filter 2 (up):   +1, -1(=255), +3
    ]);
    const out = applyPngPredictor(filtered, 3, 1, 8);
    assert.deepEqual([...out], [10, 20, 30, 11, 19, 33]);
});

test("Sub predictor reconstructs from left-neighbor deltas", () => {
    // Sub (filter 1): each byte is the delta from the byte to its left.
    // deltas [5,5,5] -> reconstructed [5,10,15].
    const sub = new Uint8Array([1, 5, 5, 5]);
    assert.deepEqual([...applyPngPredictor(sub, 3, 1, 8)], [5, 10, 15]);
});

test("reads page count from an xref-stream PDF", { skip: !HAS_QPDF }, () => {
    const ed = loadPdf(xrefStreamPdf("A", 3));
    assert.equal(ed.pageCount(), 3, "3 pages via xref stream");
    assert.ok(ed.compressed.size > 0, "some objects live in an object stream");
});

test(
    "objects inside an object stream are readable",
    { skip: !HAS_QPDF },
    () => {
        const ed = loadPdf(xrefStreamPdf("B", 1));
        // catalog is typically stored in the object stream by qpdf
        const cat = ed.getObjectRaw(ed.rootId);
        assert.ok(cat.dictPart.includes("/Type /Catalog"), "catalog readable");
        const leaves = ed.getPageTree().leafIds;
        const page = ed.getObjectRaw(leaves[0]);
        assert.ok(page.dictPart.includes("/Type /Page"), "page readable");
    }
);

test("merge works on xref-stream input", { skip: !HAS_QPDF }, () => {
    const merged = mergePdfs([xrefStreamPdf("M", 2), xrefStreamPdf("N", 1)]);
    const ed = loadPdf(merged);
    assert.equal(ed.pageCount(), 3, "2 + 1 pages");
    const s = dec.decode(merged);
    // merged output is classic xref and self-consistent
    assert.ok(/\bxref\b/.test(s), "merged output uses a classic xref table");
});

test(
    "stamping xref-stream input produces a valid incremental update",
    { skip: !HAS_QPDF },
    () => {
        const original = xrefStreamPdf("S", 2);
        const ed = loadPdf(original);
        ed.overlay(
            new PdfContentStreamBuilder()
                .beginText()
                .setFont("F1", 12)
                .setTextMatrix(1, 0, 0, 1, 72, 40)
                .showText("STAMP")
                .endText()
                .build()
        );
        const out = ed.save();
        // original bytes preserved, /Prev chains back to the xref stream
        for (let i = 0; i < original.length; i++) {
            assert.equal(
                out[i],
                original[i],
                "original byte " + i + " preserved"
            );
        }
        const s = dec.decode(out);
        assert.ok(/\/Prev \d+/.test(s), "incremental /Prev present");
        // reloading the stamped result still sees 2 pages
        assert.equal(loadPdf(out).pageCount(), 2);
    }
);
