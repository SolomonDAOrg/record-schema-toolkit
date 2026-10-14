/**
 * Wave 18 validation: per-page resource pruning during extraction. Uses a system
 * font for the embedded-font case; those checks skip if none is found. node
 * internals only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { inflateSync } from "node:zlib";

import DocMod from "../../lib/pdf/document.mjs";
import CsMod from "../../lib/pdf/content-stream.mjs";
import { extractPages } from "../../lib/pdf/merge.mjs";
import { loadPdf } from "../../lib/pdf/reader.mjs";

const { PdfDocumentBuilder } = DocMod;
const { PdfContentStreamBuilder } = CsMod;
const dec = new TextDecoder("latin1");

const FONT_PATH =
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf";
const HAS_FONT = existsSync(FONT_PATH);
const TTF = HAS_FONT ? new Uint8Array(readFileSync(FONT_PATH)) : null;

/** Doc: pages 1..n use builtin fonts; page n+1 uses an embedded CID font. */
function mixedDoc(n) {
    const d = new PdfDocumentBuilder({ title: "mixed" });
    for (let i = 1; i <= n; i++) {
        d.addPageFromString(`BT /F1 20 Tf 72 700 Td (PAGE${i}) Tj ET\n`);
    }
    const f = d.registerCIDFont(TTF);
    const cs = new PdfContentStreamBuilder();
    cs.beginText().setFont(f, 20).setTextMatrix(1, 0, 0, 1, 72, 700);
    cs.showGlyphHex(d.encodeCIDText(f, "EMBED Ωμέγα"));
    cs.endText();
    d.addPageFromString(cs.build());
    return d.build();
}

function objCount(bytes) {
    return loadPdf(bytes).allObjectIds().length;
}

function firstPageText(bytes) {
    const ed = loadPdf(bytes);
    const pid = ed.getPageTree().leafIds[0];
    const cid = parseInt(
        /\/Contents (\d+) 0 R/.exec(ed.getObjectRaw(pid).dictPart)[1],
        10
    );
    const c = ed.getObjectRaw(cid);
    try {
        return dec.decode(new Uint8Array(inflateSync(c.streamBytes)));
    } catch {
        return dec.decode(c.streamBytes);
    }
}

test(
    "extracting a builtin-font page drops the unused embedded font",
    { skip: !HAS_FONT },
    () => {
        const src = mixedDoc(4); // page 5 has the embedded font
        const out = extractPages(src, [2]); // page 2 uses only a builtin font
        const s = dec.decode(out);
        assert.ok(
            !s.includes("/FontFile2"),
            "no embedded font program carried over"
        );
        assert.ok(
            objCount(out) < objCount(src),
            "far fewer objects than the source"
        );
        assert.ok(out.length < src.length / 2, "substantially smaller");
        assert.ok(firstPageText(out).includes("(PAGE2)"), "content intact");
    }
);

test(
    "extracting the embedded-font page keeps its font program",
    { skip: !HAS_FONT },
    () => {
        const src = mixedDoc(4);
        const out = extractPages(src, [5]); // the CID-font page
        const s = dec.decode(out);
        assert.ok(
            s.includes("/FontFile2"),
            "embedded font travels with its page"
        );
        assert.ok(s.includes("/Subtype /Type0"), "Type0 font present");
        // CID content is a glyph-hex show, not literal text
        assert.ok(
            /<[0-9A-Fa-f]+> Tj/.test(firstPageText(out)),
            "glyph-hex content intact"
        );
    }
);

test(
    "pruned resources keep only the referenced font",
    { skip: !HAS_FONT },
    () => {
        // The source registers many builtin fonts (F1..F14) + the CID font; a page
        // using only /F1 should end up with just /F1 in its resources.
        const src = mixedDoc(2);
        const out = extractPages(src, [1]);
        const s = dec.decode(out);
        const res = /\/Resources <<[^]*?\/Font <<([^>]*)>>/.exec(s);
        assert.ok(res, "pruned resources present");
        assert.ok(res[1].includes("/F1"), "keeps the used font");
        // no other font names beyond F1 (e.g. F2, F3 dropped)
        const fontNames = [...res[1].matchAll(/\/(F\d+)/g)].map((m) => m[1]);
        assert.deepEqual(fontNames, ["F1"], "only the used font remains");
    }
);

test(
    "pruned extraction has no dangling references",
    { skip: !HAS_FONT },
    () => {
        const out = extractPages(mixedDoc(3), [1, 2]);
        const s = dec.decode(out);
        const defined = new Set(
            [...s.matchAll(/(\d+) 0 obj/g)].map((m) => parseInt(m[1], 10))
        );
        for (const m of s.matchAll(/(\d+) 0 R\b/g)) {
            assert.ok(
                defined.has(parseInt(m[1], 10)),
                "ref " + m[1] + " defined"
            );
        }
    }
);

test("pruning still works without any embedded fonts (builtin only)", () => {
    const d = new PdfDocumentBuilder({ title: "b" });
    for (let i = 1; i <= 3; i++) {
        d.addPageFromString(`BT /F1 12 Tf 72 700 Td (P${i}) Tj ET\n`);
    }
    const out = extractPages(d.build(), [2]);
    assert.equal(loadPdf(out).pageCount(), 1);
    assert.ok(firstPageText(out).includes("(P2)"), "content intact");
});
