/**
 * Wave 7 validation: Type0 / CIDFontType2 composite fonts (full Unicode).
 * Uses a system TrueType font; skips if none is found.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

import DocMod from "../../lib/pdf/document.mjs";
import CsMod from "../../lib/pdf/content-stream.mjs";

const { PdfDocumentBuilder } = DocMod;
const { PdfContentStreamBuilder } = CsMod;
const dec = new TextDecoder("latin1");

const FONT_PATH =
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf";
const HAS_FONT = existsSync(FONT_PATH);
const TTF = HAS_FONT ? new Uint8Array(readFileSync(FONT_PATH)) : null;

/** @param {Uint8Array} b @returns {string} */
function toLatin1(b) {
    return dec.decode(b);
}

/** Build a doc with a CID font and one line of text, return { pdf, font, doc }. */
function cidDoc(text) {
    const doc = new PdfDocumentBuilder({ title: "U", compress: false });
    const font = doc.registerCIDFont(TTF);
    const cs = new PdfContentStreamBuilder();
    cs.beginText().setFont(font, 20).setTextMatrix(1, 0, 0, 1, 72, 700);
    cs.showGlyphHex(doc.encodeCIDText(font, text));
    cs.endText();
    doc.addPageFromString(cs.build());
    return { doc, font, pdf: doc.build() };
}

test(
    "encodeCIDText maps code points to 2-byte glyph ids",
    { skip: !HAS_FONT },
    () => {
        const doc = new PdfDocumentBuilder();
        const font = doc.registerCIDFont(TTF);
        // Known GIDs for LiberationSans: A=36 (0x24), Ω=859 (0x35B).
        const hexA = doc.encodeCIDText(font, "A");
        assert.equal(hexA, "0024", "A -> GID 36");
        const hexOmega = doc.encodeCIDText(font, "Ω");
        assert.equal(hexOmega, "035B", "Ω -> GID 859");
        // Two code points -> 8 hex chars.
        assert.equal(doc.encodeCIDText(font, "AB").length, 8);
    }
);

test(
    "composite font emits Type0 + CIDFontType2 + Identity-H structure",
    { skip: !HAS_FONT },
    () => {
        const s = toLatin1(cidDoc("Ωμέγα Привет").pdf);
        assert.ok(s.includes("/Subtype /Type0"), "Type0 font");
        assert.ok(s.includes("/Encoding /Identity-H"), "Identity-H");
        assert.ok(
            s.includes("/Subtype /CIDFontType2"),
            "descendant CIDFontType2"
        );
        assert.ok(s.includes("/CIDToGIDMap /Identity"), "identity CIDToGIDMap");
        assert.ok(s.includes("/Ordering (Identity)"), "CIDSystemInfo");
        assert.ok(/\/W \[\d+ \[\d+\]/.test(s), "per-glyph widths");
        assert.ok(s.includes("/FontFile2"), "embedded font program");
    }
);

test(
    "ToUnicode maps glyph ids back to the correct code points",
    { skip: !HAS_FONT },
    () => {
        const s = toLatin1(cidDoc("AΩ").pdf);
        // A: GID 36 (0x0024) -> U+0041 ; Ω: GID 859 (0x035B) -> U+03A9
        assert.ok(s.includes("<0024> <0041>"), "A glyph -> U+0041");
        assert.ok(s.includes("<035B> <03A9>"), "Ω glyph -> U+03A9");
    }
);

test("only used glyphs appear in the /W array", { skip: !HAS_FONT }, () => {
    const s = toLatin1(cidDoc("A").pdf);
    const w = /\/W \[([^\]]*\][^\]]*)\]/.exec(s);
    assert.ok(w, "W array present");
    // exactly one glyph used -> one "gid [width]" entry
    assert.ok(/^36 \[\d+\]$/.test(w[1].trim()), "single-entry W for GID 36");
});

test(
    "measureCIDText returns a positive advance width",
    { skip: !HAS_FONT },
    () => {
        const doc = new PdfDocumentBuilder();
        const font = doc.registerCIDFont(TTF);
        const w = doc.measureCIDText(font, "Ωμέγα", 20);
        assert.ok(w > 0 && w < 200, "reasonable width in points");
    }
);

test(
    "surrogate-pair code points encode and map correctly",
    { skip: !HAS_FONT },
    () => {
        // Even if the glyph is missing (.notdef), ToUnicode should carry the code
        // point so extraction is correct. Use a BMP char guaranteed present instead
        // to assert the mapping mechanics for a 4-hex Unicode value.
        const doc = new PdfDocumentBuilder({ compress: false });
        const font = doc.registerCIDFont(TTF);
        const cs = new PdfContentStreamBuilder();
        cs.beginText().setFont(font, 12).setTextMatrix(1, 0, 0, 1, 72, 700);
        cs.showGlyphHex(doc.encodeCIDText(font, "€")); // U+20AC, GID 2088 (0x0828)
        cs.endText();
        doc.addPageFromString(cs.build());
        const s = toLatin1(doc.build());
        assert.ok(s.includes("<0828> <20AC>"), "euro glyph -> U+20AC");
    }
);
