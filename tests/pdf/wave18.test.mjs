/**
 * Wave 17 validation: page extraction, reordering, and removal. node internals
 * only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";

import DocMod from "../../lib/pdf/document.mjs";
import { extractPages, removePages } from "../../lib/pdf/merge.mjs";
import { loadPdf } from "../../lib/pdf/reader.mjs";

const { PdfDocumentBuilder } = DocMod;
const dec = new TextDecoder("latin1");

/** N-page doc where page i shows "PAGEi". */
function doc(n) {
    const d = new PdfDocumentBuilder({ title: "src" });
    for (let i = 1; i <= n; i++) {
        d.addPageFromString(`BT /F1 20 Tf 72 700 Td (PAGE${i}) Tj ET\n`);
    }
    return d.build();
}

/** Ordered list of "PAGEn" labels in a rendered doc's pages. */
function pageLabels(bytes) {
    const ed = loadPdf(bytes);
    return ed.getPageTree().leafIds.map((pid) => {
        const raw = ed.getObjectRaw(pid);
        const cid = parseInt(/\/Contents (\d+) 0 R/.exec(raw.dictPart)[1], 10);
        const c = ed.getObjectRaw(cid);
        let txt;
        try {
            txt = dec.decode(new Uint8Array(inflateSync(c.streamBytes)));
        } catch {
            txt = dec.decode(c.streamBytes);
        }
        return /\((PAGE\d+)\)/.exec(txt)[1];
    });
}

test("extractPages selects the requested pages in order", () => {
    const out = extractPages(doc(5), [2, 4]);
    assert.deepEqual(pageLabels(out), ["PAGE2", "PAGE4"]);
    assert.equal(loadPdf(out).pageCount(), 2);
});

test("extractPages can reorder pages", () => {
    assert.deepEqual(pageLabels(extractPages(doc(3), [3, 1, 2])), [
        "PAGE3",
        "PAGE1",
        "PAGE2"
    ]);
});

test("removePages drops the given pages, keeping order", () => {
    assert.deepEqual(pageLabels(removePages(doc(5), [2, 4])), [
        "PAGE1",
        "PAGE3",
        "PAGE5"
    ]);
});

test("out-of-range page throws", () => {
    assert.throws(() => extractPages(doc(3), [4]), /out of range/);
    assert.throws(() => extractPages(doc(3), [0]), /out of range/);
});

test("removing every page is refused", () => {
    assert.throws(() => removePages(doc(2), [1, 2]), /zero-page/);
});

test("extracted output has no dangling references", () => {
    const s = dec.decode(extractPages(doc(6), [1, 3, 5]));
    const defined = new Set(
        [...s.matchAll(/(\d+) 0 obj/g)].map((m) => parseInt(m[1], 10))
    );
    const referenced = new Set(
        [...s.matchAll(/(\d+) 0 R\b/g)].map((m) => parseInt(m[1], 10))
    );
    for (const r of referenced) {
        assert.ok(defined.has(r), "referenced object " + r + " is defined");
    }
    // and a well-formed catalog + page tree
    assert.ok(/1 0 obj\s*<<\s*\/Type \/Catalog/.test(s), "catalog");
    assert.ok(/2 0 obj\s*<<\s*\/Type \/Pages/.test(s), "page tree");
});

test("extraction is not larger than the source", () => {
    const src = doc(10);
    const out = extractPages(src, [1, 2]);
    assert.ok(out.length <= src.length, "subset is not bigger than the whole");
});

test("a single-page extract round-trips through the reader", () => {
    const out = extractPages(doc(4), [3]);
    const ed = loadPdf(out);
    assert.equal(ed.pageCount(), 1);
    assert.deepEqual(pageLabels(out), ["PAGE3"]);
});
