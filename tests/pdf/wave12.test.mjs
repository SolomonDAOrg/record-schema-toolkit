/**
 * Wave 11 validation: XMP metadata. node internals only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildXmp, formatXmpDate } from "../../lib/pdf/xmp.mjs";
import DocMod from "../../lib/pdf/document.mjs";

const { PdfDocumentBuilder } = DocMod;
const dec = new TextDecoder("latin1");

test("buildXmp emits a well-formed packet with the provided fields", () => {
    const xmp = buildXmp({
        title: "Doc",
        author: "Solomon Labs",
        subject: "Terms",
        creator: "Tool",
        producer: "Producer",
        keywords: "a, b"
    });
    assert.ok(xmp.startsWith("<?xpacket begin="), "xpacket header");
    assert.ok(xmp.includes("<x:xmpmeta"), "xmpmeta element");
    assert.ok(xmp.includes("<rdf:RDF"), "rdf");
    assert.ok(xmp.trimEnd().endsWith('<?xpacket end="w"?>'), "xpacket trailer");

    assert.ok(xmp.includes(">Doc<"), "title text");
    assert.ok(xmp.includes(">Solomon Labs<"), "creator/author");
    assert.ok(xmp.includes("<dc:description>"), "description");
    assert.ok(xmp.includes("<xmp:CreatorTool>Tool</xmp:CreatorTool>"));
    assert.ok(xmp.includes("<pdf:Producer>Producer</pdf:Producer>"));
    assert.ok(xmp.includes("<pdf:Keywords>a, b</pdf:Keywords>"));

    // Balanced open/close of the container elements.
    const opens = (xmp.match(/<rdf:Description/g) || []).length;
    const closes = (xmp.match(/<\/rdf:Description>/g) || []).length;
    assert.equal(opens, closes, "rdf:Description balanced");
});

test("special characters are XML-escaped", () => {
    const xmp = buildXmp({ title: "A & B <c> \"d\" 'e'" });
    assert.ok(xmp.includes("A &amp; B &lt;c&gt; &quot;d&quot; &apos;e&apos;"));
    assert.ok(!/>A & B/.test(xmp), "no raw ampersand in content");
});

test("formatXmpDate is ISO-8601 with a timezone offset", () => {
    const s = formatXmpDate(new Date("2026-07-18T09:30:00Z"));
    assert.match(s, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
});

test("PDF/A identification block is added only when requested", () => {
    const plain = buildXmp({ title: "x" });
    assert.ok(!plain.includes("pdfaid:part"), "no pdfaid by default");
    const pdfa = buildXmp({ title: "x", pdfaPart: 2, pdfaConformance: "B" });
    assert.ok(pdfa.includes("<pdfaid:part>2</pdfaid:part>"));
    assert.ok(pdfa.includes("<pdfaid:conformance>B</pdfaid:conformance>"));
});

test("metadata:true embeds an uncompressed /Metadata stream in the catalog", () => {
    const doc = new PdfDocumentBuilder({
        title: "Agreement",
        author: "Solomon Labs",
        metadata: true
        // compression defaults on: content is Flate'd, metadata must NOT be
    });
    doc.addPageFromString("BT /F1 12 Tf 72 700 Td (hi) Tj ET\n");
    const s = dec.decode(doc.build());

    assert.ok(/\/Metadata \d+ 0 R/.test(s), "catalog references /Metadata");
    assert.ok(s.includes("/Type /Metadata"), "metadata object");
    assert.ok(s.includes("/Subtype /XML"), "XML subtype");
    assert.ok(
        s.includes("<?xpacket begin="),
        "raw XMP embedded (uncompressed)"
    );

    // The metadata stream itself must be uncompressed.
    const objIdx = s.indexOf("/Type /Metadata");
    const dictEnd = s.indexOf(">>", objIdx);
    const metaDict = s.slice(objIdx, dictEnd);
    assert.ok(!metaDict.includes("/Filter"), "metadata stream not filtered");
});

test("no /Metadata when the option is off", () => {
    const doc = new PdfDocumentBuilder({ title: "x", author: "y" });
    doc.addPageFromString("BT ET");
    const s = dec.decode(doc.build());
    assert.ok(!/\/Metadata \d+ 0 R/.test(s), "no metadata reference");
    assert.ok(!s.includes("<?xpacket"), "no XMP packet");
});

test("XMP mirrors the document Info fields", () => {
    const doc = new PdfDocumentBuilder({
        title: "MyTitle",
        author: "MyAuthor",
        subject: "MySubject",
        metadata: true
    });
    doc.addPageFromString("BT ET");
    const s = dec.decode(doc.build());
    assert.ok(s.includes(">MyTitle<"), "title in XMP");
    assert.ok(s.includes(">MyAuthor<"), "author in XMP");
    assert.ok(s.includes(">MySubject<"), "subject in XMP");
    // and still present in the Info dict (which UTF-16BE hex-encodes strings)
    assert.ok(/\/Title\s*</.test(s), "title still in Info dict");
});
