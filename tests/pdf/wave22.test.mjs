/**
 * Wave 21 validation: true redaction — removing text inside rectangles (not just
 * covering it) and rewriting the whole document. node internals only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";

import DocMod from "../../lib/pdf/document.mjs";
import CsMod from "../../lib/pdf/content-stream.mjs";
import { redactRegions } from "../../lib/pdf/redact.mjs";
import { extractText } from "../../lib/pdf/extract-text.mjs";
import { loadPdf } from "../../lib/pdf/reader.mjs";

const { PdfDocumentBuilder } = DocMod;
const { PdfContentStreamBuilder } = CsMod;
const dec = new TextDecoder("latin1");

/** Three lines of text at known y positions (720 / 690 / 660). */
function threeLineDoc(encryption) {
    const d = new PdfDocumentBuilder({ title: "r", encryption });
    const cs = new PdfContentStreamBuilder();
    cs.beginText()
        .setFont("F1", 14)
        .setTextMatrix(1, 0, 0, 1, 72, 720)
        .showText("PUBLIC one visible")
        .setTextMatrix(1, 0, 0, 1, 72, 690)
        .showText("SECRET redact this")
        .setTextMatrix(1, 0, 0, 1, 72, 660)
        .showText("PUBLIC two visible")
        .endText();
    d.addPageFromString(cs.build());
    return d.build();
}

/** Inflate all content streams and concatenate. */
function contentText(bytes) {
    const s = dec.decode(bytes);
    let out = "";
    const re = /stream\r?\n/g;
    let m;
    while ((m = re.exec(s)) !== null) {
        const start = m.index + m[0].length;
        const end = s.indexOf("endstream", start);
        try {
            out =
                out +
                dec.decode(
                    new Uint8Array(inflateSync(bytes.subarray(start, end)))
                );
        } catch {
            /* not a flate stream */
        }
    }
    return out;
}

const MIDDLE = { page: 1, x: 60, y: 683, width: 440, height: 20 };

test("redacted text is removed from extraction", () => {
    const out = redactRegions(threeLineDoc(), [MIDDLE]);
    const { text } = extractText(out);
    assert.ok(!text.includes("SECRET"), "secret text gone");
    assert.ok(text.includes("PUBLIC one visible"), "line above kept");
    assert.ok(text.includes("PUBLIC two visible"), "line below kept");
});

test("redacted text is removed from the raw bytes (true redaction)", () => {
    const out = redactRegions(threeLineDoc(), [MIDDLE]);
    const raw = dec.decode(out);
    assert.ok(!raw.includes("SECRET"), "no trace in the file");
    assert.ok(!raw.includes("redact this"), "phrase gone entirely");
});

test("an opaque box is painted over the region", () => {
    const out = redactRegions(threeLineDoc(), [MIDDLE]);
    const content = contentText(out);
    assert.ok(/0 0 0 rg/.test(content), "black fill color set");
    assert.ok(/60 683 440 20 re f/.test(content), "box rectangle filled");
});

test("output is a single revision (no /Prev, no leftover content)", () => {
    const out = redactRegions(threeLineDoc(), [MIDDLE]);
    assert.ok(!dec.decode(out).includes("/Prev"), "no incremental /Prev");
    assert.equal(loadPdf(out).pageCount(), 1);
});

test("a custom box color is honored", () => {
    const out = redactRegions(threeLineDoc(), [
        { ...MIDDLE, color: [1, 0, 0] }
    ]);
    assert.ok(/1 0 0 rg/.test(contentText(out)), "red box");
});

test("only the targeted line is affected, others untouched", () => {
    // redact the TOP line instead
    const out = redactRegions(threeLineDoc(), [
        { page: 1, x: 60, y: 713, width: 440, height: 20 }
    ]);
    const { text } = extractText(out);
    assert.ok(!text.includes("PUBLIC one"), "top line removed");
    assert.ok(text.includes("SECRET"), "middle line kept");
    assert.ok(text.includes("PUBLIC two"), "bottom line kept");
});

test("redaction accounts for cm coordinate transforms", () => {
    const d = new PdfDocumentBuilder({ title: "cm" });
    // text drawn at (0,0) but shifted to (100,100) by a cm translate
    d.addPageFromString(
        "q 1 0 0 1 100 100 cm BT /F1 14 Tf 0 0 Td (SHIFTEDSECRET) Tj ET Q\n"
    );
    const src = d.build();
    // a rect at the ORIGINAL (0,0) must NOT catch it
    const miss = redactRegions(src, [
        { page: 1, x: 0, y: 0, width: 40, height: 20 }
    ]);
    assert.ok(
        extractText(miss).text.includes("SHIFTEDSECRET"),
        "not caught at origin"
    );
    // a rect at the TRANSFORMED (100,100) must catch it
    const hit = redactRegions(src, [
        { page: 1, x: 90, y: 90, width: 200, height: 30 }
    ]);
    assert.ok(
        !extractText(hit).text.includes("SHIFTEDSECRET"),
        "caught at transformed position"
    );
});

test("redacts multiple regions across pages", () => {
    const d = new PdfDocumentBuilder({ title: "multi" });
    for (let p = 1; p <= 2; p++) {
        d.addPageFromString(
            `BT /F1 14 Tf 72 700 Td (SECRET page ${p}) Tj 0 -30 Td (keep page ${p}) Tj ET\n`
        );
    }
    const out = redactRegions(d.build(), [
        { page: 1, x: 60, y: 693, width: 300, height: 20 },
        { page: 2, x: 60, y: 693, width: 300, height: 20 }
    ]);
    const { pages } = extractText(out);
    assert.ok(!pages[0].includes("SECRET"), "page 1 secret gone");
    assert.ok(pages[0].includes("keep page 1"), "page 1 keep");
    assert.ok(!pages[1].includes("SECRET"), "page 2 secret gone");
    assert.ok(pages[1].includes("keep page 2"), "page 2 keep");
});

test("out-of-range page throws", () => {
    assert.throws(
        () =>
            redactRegions(threeLineDoc(), [
                { page: 5, x: 0, y: 0, width: 10, height: 10 }
            ]),
        /out of range/
    );
});

test("redacts an encrypted PDF (empty password), output is plaintext", () => {
    const enc = threeLineDoc({ algorithm: "aes-256" });
    const out = redactRegions(enc, [MIDDLE]);
    const raw = dec.decode(out);
    assert.ok(!raw.includes("/Encrypt"), "output not encrypted");
    assert.ok(!extractText(out).text.includes("SECRET"), "secret removed");
    assert.ok(
        extractText(out).text.includes("PUBLIC one visible"),
        "rest intact"
    );
});
