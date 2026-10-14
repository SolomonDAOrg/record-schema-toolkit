/**
 * Wave 3a validation: embedded file attachments. node internals only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { createHash } from "node:crypto";

import DocMod from "../../lib/pdf/document.mjs";

const { PdfDocumentBuilder } = DocMod;
const dec = new TextDecoder("latin1");

/** @param {Uint8Array} b @returns {string} */
function toLatin1(b) {
    return dec.decode(b);
}

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

const INVOICE =
    '<?xml version="1.0"?>\n<Invoice><Total>42.00</Total></Invoice>\n';

test("attached file: embedded stream, filespec, name tree, and checksum", () => {
    const doc = new PdfDocumentBuilder({ title: "Factur-X", compress: false });
    doc.attachFile(INVOICE, "invoice.xml", {
        mimeType: "application/xml",
        description: "Structured invoice",
        relationship: "Data"
    });
    doc.addPageFromString("BT ET");
    const s = toLatin1(doc.build());

    assert.ok(s.includes("/Type /EmbeddedFile"), "embedded file stream");
    assert.ok(
        s.includes("/Subtype /application#2Fxml"),
        "MIME as escaped name"
    );
    assert.ok(s.includes("/Type /Filespec"), "filespec dict");
    assert.ok(s.includes("(invoice.xml)"), "filename /F");
    assert.ok(s.includes("/EmbeddedFiles <<"), "name tree in catalog names");
    assert.ok(s.includes("/AFRelationship /Data"), "AF relationship");
    assert.ok(/\/AF \[\d+ 0 R\]/.test(s), "catalog /AF array");
    assert.ok(s.includes("(Structured invoice)"), "description");

    // Size + checksum reflect the uncompressed bytes.
    const raw = new TextEncoder().encode(INVOICE);
    assert.ok(s.includes("/Size " + raw.length), "size in params");
    const md5 = createHash("md5").update(raw).digest("hex");
    assert.ok(s.includes("<" + md5 + ">"), "md5 checksum");

    // Uncompressed: file content is present verbatim.
    assert.ok(s.includes("<Total>42.00</Total>"), "raw content embedded");
    assertXrefIntegrity(doc.build());
});

test("attachment stream deflates back to the original bytes", () => {
    const doc = new PdfDocumentBuilder({ title: "z" });
    doc.attachFile(INVOICE, "invoice.xml", { mimeType: "application/xml" });
    doc.addPageFromString("BT ET");
    const pdf = doc.build();
    const s = toLatin1(pdf);
    assert.ok(s.includes("/Filter /FlateDecode"));

    const hdr = s.indexOf("/Type /EmbeddedFile");
    let p = s.indexOf("stream", hdr) + 6;
    if (s[p] === "\r") {
        p++;
    }
    if (s[p] === "\n") {
        p++;
    }
    let e = s.indexOf("endstream", p);
    if (s[e - 1] === "\n") {
        e--;
    }
    if (s[e - 1] === "\r") {
        e--;
    }
    const inflated = toLatin1(new Uint8Array(inflateSync(pdf.slice(p, e))));
    assert.equal(inflated, INVOICE, "embedded content round-trips");
    assertXrefIntegrity(pdf);
});

test("plain attachment (no relationship) has no /AF", () => {
    const doc = new PdfDocumentBuilder({ title: "z", compress: false });
    doc.attachFile("hello", "notes.txt", { mimeType: "text/plain" });
    doc.addPageFromString("BT ET");
    const s = toLatin1(doc.build());
    assert.ok(s.includes("/EmbeddedFiles <<"), "still in name tree");
    assert.ok(!/\/AF \[/.test(s), "no /AF without relationship");
    assert.ok(!s.includes("/AFRelationship"), "no relationship key");
});

test("name-tree keys are unique and sorted", () => {
    const doc = new PdfDocumentBuilder({ title: "z", compress: false });
    doc.attachFile("a", "dup.txt");
    doc.attachFile("b", "dup.txt"); // same name -> key collision
    doc.attachFile("c", "aaa.txt");
    doc.addPageFromString("BT ET");
    const s = toLatin1(doc.build());

    const names = s.match(/\/Names \[([^\]]*)\]/);
    assert.ok(names, "found name array");
    const arr = names[1];
    const iA = arr.indexOf("(aaa.txt)");
    const iB = arr.indexOf("(dup.txt)");
    const iC = arr.indexOf("(dup.txt \\(2\\))"); // collision-suffixed, parens escaped
    assert.ok(iA >= 0 && iB >= 0 && iC >= 0, "all three keys present");
    assert.ok(iA < iB && iB < iC, "keys sorted lexically");
});
