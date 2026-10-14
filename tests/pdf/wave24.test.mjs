/**
 * Wave 23 validation: OpenType-CFF (.otf) embedding as a CIDFontType0 with
 * FontFile3 /Subtype /OpenType. Uses a TeX Gyre OTF; skips if none is found.
 * CFF fonts are embedded whole (no subsetting). node internals only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

import DocMod from "../../lib/pdf/document.mjs";
import CsMod from "../../lib/pdf/content-stream.mjs";
import { parseTtfFont } from "../../lib/pdf/font-embed.mjs";
import { extractText } from "../../lib/pdf/extract-text.mjs";

const { PdfDocumentBuilder } = DocMod;
const { PdfContentStreamBuilder } = CsMod;
const dec = new TextDecoder("latin1");

const OTF_PATH =
    "/usr/share/texmf/fonts/opentype/public/tex-gyre/texgyretermes-regular.otf";
const TTF_PATH =
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf";
const HAS_OTF = existsSync(OTF_PATH);
const OTF = HAS_OTF ? new Uint8Array(readFileSync(OTF_PATH)) : null;

/** Build a doc that renders `text` with the embedded OTF. */
function otfDoc(text) {
    const d = new PdfDocumentBuilder({ title: "otf" });
    const f = d.registerCIDFont(OTF);
    const cs = new PdfContentStreamBuilder();
    cs.beginText().setFont(f, 20).setTextMatrix(1, 0, 0, 1, 72, 700);
    cs.showGlyphHex(d.encodeCIDText(f, text));
    cs.endText();
    d.addPageFromString(cs.build());
    return d.build();
}

test("parseTtfFont flags a CFF OpenType font", { skip: !HAS_OTF }, () => {
    const p = parseTtfFont(OTF);
    assert.equal(p.isCFF, true, "OTTO/CFF detected");
    // metrics still parse (cmap/hmtx are format-identical to TrueType)
    assert.ok(p.glyphIdForCodePoint(0x41) > 0, "cmap resolves 'A'");
    assert.ok(p.widthForCodePoint(0x41) > 0, "hmtx gives a width");
});

test(
    "a plain TrueType font is not flagged CFF",
    { skip: !existsSync(TTF_PATH) },
    () => {
        const p = parseTtfFont(new Uint8Array(readFileSync(TTF_PATH)));
        assert.equal(p.isCFF, false);
    }
);

test(
    "embeds an OTF as CIDFontType0 + FontFile3 /Subtype /OpenType",
    { skip: !HAS_OTF },
    () => {
        const s = dec.decode(otfDoc("OpenType CFF"));
        assert.ok(s.includes("/Subtype /Type0"), "composite Type0");
        assert.ok(
            s.includes("/Subtype /CIDFontType0"),
            "CIDFontType0 descendant"
        );
        assert.ok(s.includes("/FontFile3"), "FontFile3 stream");
        assert.ok(
            /\/FontFile3[^]*?\/Subtype \/OpenType/.test(s) ||
                s.includes("/Subtype /OpenType"),
            "OpenType subtype"
        );
        assert.ok(!s.includes("/FontFile2"), "no TrueType FontFile2");
        assert.ok(!s.includes("/CIDToGIDMap"), "no CIDToGIDMap for CFF");
    }
);

test(
    "the whole OTF is embedded (CFF is not subset)",
    { skip: !HAS_OTF },
    () => {
        const pdf = otfDoc("A");
        // the embedded stream should be about the size of the source font (compressed),
        // i.e. the document is much bigger than a subset-only TrueType doc would be.
        assert.ok(pdf.length > OTF.length / 3, "carries the full font program");
        assert.ok(dec.decode(pdf).includes("/DW 1000"), "default width set");
    }
);

test(
    "text set in an OTF round-trips through extraction",
    { skip: !HAS_OTF },
    () => {
        // characters this font covers: Latin + basic Greek + accented Latin
        const text = "Times OTF: Ωμγα café";
        const { text: extracted } = extractText(otfDoc(text));
        assert.equal(extracted, text);
    }
);

test("the /W widths array is present for the OTF", { skip: !HAS_OTF }, () => {
    const s = dec.decode(otfDoc("Width test"));
    assert.ok(/\/W \[/.test(s), "per-glyph widths emitted");
});

test(
    "an OTF-embedded document is structurally sound (xref intact)",
    { skip: !HAS_OTF },
    () => {
        const s = dec.decode(otfDoc("Structure"));
        const startxref = parseInt(/startxref\s+(\d+)/.exec(s)[1], 10);
        const entries = [
            ...s.slice(startxref).matchAll(/^(\d{10}) (\d{5}) n\s*$/gm)
        ];
        assert.ok(entries.length > 5, "has object entries");
        for (let i = 1; i < entries.length; i++) {
            const off = parseInt(entries[i][1], 10);
            if (off !== 0) {
                assert.ok(
                    /^\d+ 0 obj/.test(s.slice(off, off + 20)),
                    "offset -> obj"
                );
            }
        }
    }
);
