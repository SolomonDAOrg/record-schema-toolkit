import assert from "node:assert/strict";
import test from "node:test";
import { createDocxRenderer } from "../../lib/ast/renderers/DocxRenderer.mjs";
import { tableFontSize } from "../../lib/ast/layout/table-typography.mjs";
import { createTwoPassPdfRenderer } from "../../lib/ast/renderers/TwoPassPdfRenderer.mjs";
import { convertMarkdownToDocument } from "../../lib/ast/converters/MarkdownToAstConverter.mjs";
import { parseMarkdownDoc } from "../../lib/parsing/markdown.mjs";
import { TableNode } from "../../lib/ast/nodes/TabularNode.mjs";
import { readPackage, readXmlPart } from "./package-support.mjs";

/** @type {import("../../lib/ast/renderers/types/document.mjs").DocumentRendererConfig} */
const configuration = {
    pageConfig: { size: "letter", margins: { left: 72, right: 72 } },
    fonts: { regular: "Helvetica", bold: "Helvetica-Bold" },
    baseFontSize: 10,
    table: { fontSize: 10, cellPadding: 4, borderWidth: 0.5 }
};

/** @param {TableNode} table @param {import("../../lib/ast/renderers/types/document.mjs").DocumentRendererConfig} [options] */
function render(table, options = configuration) {
    const result = createDocxRenderer(options).render([
        { id: "table", config: { id: "table" }, content: [table] }
    ]);
    assert.equal(result.success, true, result.errors.join("; "));
    return readXmlPart(readPackage(result.output), "word/document.xml");
}

for (const width of ["max-content", "max-content-padded"]) {
    test(
        "DOCX " +
            width +
            " columns reserve label width and leave the rest for values",
        () => {
            const document = convertMarkdownToDocument(
                parseMarkdownDoc(
                    ":::table " +
                        width +
                        " auto\n| PARTICULAR | DETAIL |\n|---|---|\n| Legal name | A complete value that needs more than half the table width |\n| Notice address | Postal address |\n:::"
                )
            );
            const table = document.root.children[0];
            assert.ok(table instanceof TableNode);
            const xml = render(table);
            const widths = [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map(
                (match) => Number(match[1])
            );
            assert.equal(widths.length, 2);
            assert.equal(widths[0] + widths[1], 9360);
            assert.ok(widths[0] < widths[1] / 2);
            assert.match(xml, /<w:tblLayout w:type="fixed"\/>/);
            assert.match(
                xml,
                /A complete value that needs more than half the table width/
            );
            const pdf = createTwoPassPdfRenderer(configuration);
            const state = pdf.initializeState();
            const padding = { top: 4, right: 4, bottom: 4, left: 4 };
            const expected = pdf.calculateColumnWidths(table, 468, 2, {
                state,
                fontSize: 10,
                bodyPadding: padding,
                headerPadding: padding,
                borderWidth: 0.5
            });
            assert.deepEqual(
                widths,
                expected.map((value) => Math.round(value * 20))
            );
        }
    );
}

test("DOCX retains parser column proportions and alignment from table attributes", () => {
    const table = new TableNode();
    table.attrs.columns = [
        { widthType: "percent", width: 20, align: "left" },
        { widthType: "percent", width: "80%", align: "right" }
    ];
    table.addHeaderRow(["Code", "Detail"]);
    table.addRow(["A", "Value"]);
    const xml = render(table);
    assert.deepEqual(
        [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((match) =>
            Number(match[1])
        ),
        [1872, 7488]
    );
    assert.match(xml, /<w:jc w:val="right"\/>/);
});

test("wide DOCX tables apply the PDF font-size limits instead of squeezing full-size text", () => {
    const table = new TableNode({
        columns: Array.from({ length: 12 }, () => ({ widthType: "auto" }))
    });
    table.addHeaderRow(
        Array.from({ length: 12 }, (_, index) => "Header " + index)
    );
    table.addRow(Array.from({ length: 12 }, (_, index) => String(index)));
    const options = {
        ...configuration,
        table: { autoShrink: true, minFontSize: 6, maxFontSize: 10 }
    };
    const xml = render(table, options);
    assert.equal([...xml.matchAll(/<w:gridCol w:w="780"\/>/g)].length, 12);
    assert.match(xml, /<w:sz w:val="12"\/>/);
    assert.equal(Math.round(tableFontSize(options.table, 10, 39) * 2), 12);
});

test("DOCX table cells keep bold runs, external hyperlinks and matching intrinsic widths", () => {
    const signature =
        "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz".repeat(2);
    const url = "https://solscan.io/tx/" + signature;
    const document = convertMarkdownToDocument(
        parseMarkdownDoc(
            ":::table max-content auto\n| Label | Details |\n|---|---|\n" +
                "| **Wide bold label** and text | **Signature:** [" +
                signature +
                "](" +
                url +
                ") (external link) |\n:::"
        )
    );
    const table = document.root.children[0];
    assert.ok(table instanceof TableNode);
    const result = createDocxRenderer(configuration).render([
        { id: "table", config: { id: "table" }, content: [table] }
    ]);
    assert.equal(result.success, true, result.errors.join("; "));
    const archive = readPackage(result.output);
    const xml = readXmlPart(archive, "word/document.xml");
    const signatureRun = [...xml.matchAll(/<w:r>[^]*?<\/w:r>/g)].find((match) =>
        match[0].includes(">Signature:</w:t>")
    );
    assert.ok(signatureRun);
    assert.ok(signatureRun[0].includes('<w:b w:val="1"/>'));
    assert.ok(xml.includes("<w:hyperlink r:id="));
    assert.ok(xml.includes(signature));
    const relationships = readXmlPart(archive, "word/_rels/document.xml.rels");
    assert.ok(relationships.includes('Target="' + url + '"'));
    assert.ok(relationships.includes('TargetMode="External"'));
    const widths = [...xml.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map(
        (match) => Number(match[1])
    );
    const pdf = createTwoPassPdfRenderer(configuration);
    const state = pdf.initializeState();
    const padding = { top: 4, right: 4, bottom: 4, left: 4 };
    const expected = pdf.calculateColumnWidths(table, 468, 2, {
        state,
        fontSize: 10,
        bodyPadding: padding,
        headerPadding: padding,
        borderWidth: 0.5
    });
    assert.deepEqual(
        widths,
        expected.map((value) => Math.round(value * 20))
    );
});
