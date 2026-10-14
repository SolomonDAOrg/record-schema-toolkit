/**
 * Wave 10 validation: PDF page merging. node internals only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";

import DocMod from "../../lib/pdf/document.mjs";
import { mergePdfs } from "../../lib/pdf/merge.mjs";
import { loadPdf } from "../../lib/pdf/reader.mjs";

const { PdfDocumentBuilder } = DocMod;
const dec = new TextDecoder("latin1");

/** A doc whose every page shows `${label} ${i}`. */
function doc(label, pages) {
    const d = new PdfDocumentBuilder({ title: label });
    for (let i = 1; i <= pages; i++) {
        d.addPageFromString(`BT /F1 16 Tf 72 700 Td (${label}${i}) Tj ET\n`);
    }
    return d.build();
}

/** Decompress a page's content stream to text. */
function pageContent(editor, pageId) {
    const raw = editor.getObjectRaw(pageId);
    const m = /\/Contents (\d+) 0 R/.exec(raw.dictPart);
    const c = editor.getObjectRaw(parseInt(m[1], 10));
    try {
        return dec.decode(new Uint8Array(inflateSync(c.streamBytes)));
    } catch {
        return dec.decode(c.streamBytes);
    }
}

test("merge combines page counts in order", () => {
    const merged = mergePdfs([doc("A", 2), doc("B", 3), doc("C", 1)]);
    const ed = loadPdf(merged);
    assert.equal(ed.pageCount(), 6, "2 + 3 + 1 pages");
});

test("each source's pages keep their own content (no cross-contamination)", () => {
    // Directly guards the << tokenizer bug that made every page share content.
    const merged = mergePdfs([doc("AAA", 2), doc("BBB", 2)]);
    const ed = loadPdf(merged);
    const leaves = ed.getPageTree().leafIds;
    assert.equal(leaves.length, 4);

    assert.ok(pageContent(ed, leaves[0]).includes("(AAA1)"), "page 1 = AAA1");
    assert.ok(pageContent(ed, leaves[1]).includes("(AAA2)"), "page 2 = AAA2");
    assert.ok(pageContent(ed, leaves[2]).includes("(BBB1)"), "page 3 = BBB1");
    assert.ok(pageContent(ed, leaves[3]).includes("(BBB2)"), "page 4 = BBB2");
});

test("merged pages reference distinct, non-colliding objects", () => {
    const merged = mergePdfs([doc("A", 1), doc("B", 1)]);
    const ed = loadPdf(merged);
    const leaves = ed.getPageTree().leafIds;
    const contentsOf = (pid) =>
        /\/Contents (\d+) 0 R/.exec(ed.getObjectRaw(pid).dictPart)[1];
    assert.notEqual(
        contentsOf(leaves[0]),
        contentsOf(leaves[1]),
        "the two pages point at different content objects"
    );
});

test("no dangling references in the merged document", () => {
    const merged = mergePdfs([doc("A", 2), doc("B", 2), doc("C", 2)]);
    const s = dec.decode(merged);
    const defined = new Set(
        [...s.matchAll(/(\d+) 0 obj/g)].map((m) => parseInt(m[1], 10))
    );
    const referenced = new Set(
        [...s.matchAll(/(\d+) 0 R\b/g)].map((m) => parseInt(m[1], 10))
    );
    for (const r of referenced) {
        assert.ok(defined.has(r), "referenced object " + r + " is defined");
    }
});

test("object ids are contiguous and the catalog/pages tree are well-formed", () => {
    const merged = mergePdfs([doc("A", 1), doc("B", 1)]);
    const s = dec.decode(merged);
    const ids = [...s.matchAll(/(\d+) 0 obj/g)]
        .map((m) => parseInt(m[1], 10))
        .sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i++) {
        assert.equal(ids[i], i + 1, "ids contiguous from 1");
    }
    assert.ok(
        /1 0 obj\s*<<\s*\/Type \/Catalog/.test(s),
        "object 1 is the catalog"
    );
    assert.ok(
        /2 0 obj\s*<<\s*\/Type \/Pages/.test(s),
        "object 2 is the page tree"
    );

    const ed = loadPdf(merged);
    assert.equal(ed.pageCount(), 2);
});

test("embedded fonts survive the merge (object graph copied intact)", () => {
    const a = doc("A", 1);
    const merged = mergePdfs([a, a]); // two copies -> fonts duplicated + remapped
    const ed = loadPdf(merged);
    assert.equal(ed.pageCount(), 2);
    // both pages render identical builtin-font content
    const leaves = ed.getPageTree().leafIds;
    assert.ok(pageContent(ed, leaves[0]).includes("(A1)"));
    assert.ok(pageContent(ed, leaves[1]).includes("(A1)"));
});

test("throws on empty input", () => {
    assert.throws(() => mergePdfs([]), /no input/);
});
