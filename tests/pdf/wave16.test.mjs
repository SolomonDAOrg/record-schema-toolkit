/**
 * Wave 15 validation: tagged (accessible) PDF — marked content + structure tree.
 * Structural checks; full PDF/UA conformance needs a validator (veraPDF), not in
 * this suite. node internals only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import DocMod from "../../lib/pdf/document.mjs";
import CsMod from "../../lib/pdf/content-stream.mjs";

const { PdfDocumentBuilder } = DocMod;
const { PdfContentStreamBuilder } = CsMod;
const dec = new TextDecoder("latin1");

test("marked-content operators emit BDC/EMC with MCID", () => {
    const s = new PdfContentStreamBuilder()
        .beginMarkedContent("P", 3)
        .endMarkedContent()
        .build();
    assert.equal(s, "/P <</MCID 3>> BDC\nEMC");
});

test("artifact marked content has no MCID", () => {
    const s = new PdfContentStreamBuilder()
        .beginArtifact()
        .endMarkedContent()
        .build();
    assert.equal(s, "/Artifact BMC\nEMC");
});

/** Build a one-page tagged doc; return its bytes as latin1. */
function taggedDoc() {
    const doc = new PdfDocumentBuilder({ title: "A11y" });
    const cs = new PdfContentStreamBuilder();
    cs.beginMarkedContent("H1", 0)
        .beginText()
        .setFont("F1", 20)
        .setTextMatrix(1, 0, 0, 1, 72, 720)
        .showText("Title")
        .endText()
        .endMarkedContent();
    cs.beginMarkedContent("P", 1)
        .beginText()
        .setFont("F1", 12)
        .setTextMatrix(1, 0, 0, 1, 72, 690)
        .showText("Body")
        .endText()
        .endMarkedContent();
    doc.addTaggedPage(cs.build(), [
        { type: "H1", mcid: 0, alt: "Title heading" },
        { type: "P", mcid: 1 }
    ]);
    return dec.decode(doc.build());
}

test("tagged doc has MarkInfo and a StructTreeRoot", () => {
    const s = taggedDoc();
    assert.ok(s.includes("/MarkInfo << /Marked true >>"), "MarkInfo");
    assert.ok(
        /\/StructTreeRoot \d+ 0 R/.test(s),
        "catalog references StructTreeRoot"
    );
    assert.ok(s.includes("/Type /StructTreeRoot"), "StructTreeRoot object");
    assert.ok(/\/ParentTreeNextKey 1/.test(s), "one tagged page");
});

test("structure elements carry type, page, MCID, and alt text", () => {
    const s = taggedDoc();
    const elems = [...s.matchAll(/\/Type \/StructElem[^]*?>>/g)].map(
        (m) => m[0]
    );
    assert.equal(elems.length, 2, "two structure elements");
    const h1 = elems.find((e) => e.includes("/S /H1"));
    const p = elems.find((e) => e.includes("/S /P"));
    assert.ok(h1, "H1 element");
    assert.ok(/\/Pg \d+ 0 R/.test(h1), "H1 has a page ref");
    assert.ok(/\/K 0\b/.test(h1), "H1 links MCID 0");
    assert.ok(h1.includes("(Title heading)"), "H1 alt text");
    assert.ok(/\/K 1\b/.test(p), "P links MCID 1");
});

test("the page carries a /StructParents index", () => {
    assert.ok(/\/StructParents 0\b/.test(taggedDoc()), "StructParents 0");
});

test("ParentTree maps the page's MCIDs to the structure elements", () => {
    const s = taggedDoc();
    const m = /\/Nums \[0 \[(\d+) 0 R (\d+) 0 R\]\]/.exec(s);
    assert.ok(m, "Nums maps StructParents 0 to two elem refs (by MCID order)");
});

test("multiple tagged pages get distinct StructParents", () => {
    const doc = new PdfDocumentBuilder({ title: "multi" });
    const mk = (label) =>
        new PdfContentStreamBuilder()
            .beginMarkedContent("P", 0)
            .beginText()
            .setFont("F1", 12)
            .setTextMatrix(1, 0, 0, 1, 72, 700)
            .showText(label)
            .endText()
            .endMarkedContent()
            .build();
    doc.addTaggedPage(mk("one"), [{ type: "P", mcid: 0 }]);
    doc.addTaggedPage(mk("two"), [{ type: "P", mcid: 0 }]);
    const s = dec.decode(doc.build());
    assert.ok(/\/StructParents 0\b/.test(s), "page 1 StructParents 0");
    assert.ok(/\/StructParents 1\b/.test(s), "page 2 StructParents 1");
    assert.ok(/\/ParentTreeNextKey 2/.test(s), "two tagged pages");
    assert.equal(
        (s.match(/\/Type \/StructElem/g) || []).length,
        2,
        "two elems"
    );
});

test("xref offsets stay valid with the structure objects appended last", () => {
    const s = taggedDoc();
    const startxref = parseInt(/startxref\s+(\d+)/.exec(s)[1], 10);
    const xrefBody = s.slice(startxref);
    // spot check: every 'n' entry offset points at "<id> 0 obj"
    const entries = [...xrefBody.matchAll(/^(\d{10}) (\d{5}) n\s*$/gm)];
    assert.ok(entries.length > 5, "has object entries");
    for (let i = 1; i < entries.length; i++) {
        const off = parseInt(entries[i][1], 10);
        if (off === 0) {
            continue;
        }
        assert.ok(
            /^\d+ 0 obj/.test(s.slice(off, off + 20)),
            "offset -> obj header"
        );
    }
});

test("a plain document has no structure tree", () => {
    const doc = new PdfDocumentBuilder({ title: "plain" });
    doc.addPageFromString("BT /F1 12 Tf 72 700 Td (hi) Tj ET\n");
    const s = dec.decode(doc.build());
    assert.ok(!s.includes("/StructTreeRoot"), "no struct tree");
    assert.ok(!s.includes("/MarkInfo"), "no mark info");
});
