import assert from "node:assert/strict";
import test from "node:test";
import { createDocxRenderer } from "../../lib/ast/renderers/DocxRenderer.mjs";
import { createDocumentRenderer } from "../../lib/ast/renderers/document-renderer.mjs";
import { createDocumentPipeline } from "../../lib/ast/pipelines/DocumentPipeline.mjs";
import { convertMarkdownToDocument } from "../../lib/ast/converters/MarkdownToAstConverter.mjs";
import { parseMarkdownDoc } from "../../lib/parsing/markdown.mjs";
import { createContainer } from "../../lib/ast/nodes/BaseNode.mjs";
import {
    createList,
    createParagraph,
    createImage,
    createItalic
} from "../../lib/ast/nodes/ProseNode.mjs";
import {
    TableNode,
    CellNode,
    RowNode
} from "../../lib/ast/nodes/TabularNode.mjs";
import { readPackage, readXmlPart } from "./package-support.mjs";

/** @param {string} source @param {object} [configuration] */
function render(source, configuration = {}) {
    const document = convertMarkdownToDocument(parseMarkdownDoc(source));
    const renderer = createDocxRenderer({
        pageConfig: { size: "a4" },
        metadata: { includeDates: false },
        ...configuration
    });
    return createDocumentPipeline()
        .setRenderer(renderer)
        .processSingle({
            id: "document",
            name: "Example",
            root: document.root
        });
}

/** @param {ReturnType<typeof render>} result */
function parts(result) {
    assert.equal(result.success, true, result.errors.join("; "));
    assert.equal(
        result.renderResult.mimeType,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    return readPackage(result.renderResult.output);
}

test("DOCX retains Unicode, inline formatting, links, tables, paragraphs and form controls", () => {
    const result = render(
        "# Register\n\nLiteral <tag> & “quote” 東京 😀 **bold** *italic* [external](https://example.com/?a=1&b=2).\n\n| Reference | Amount |\n|---|---|\n|ABC|12.50|\n\n:::form-fields\n**Email:** [Email]\n:::"
    );
    const archive = parts(result);
    const document = readXmlPart(archive, "word/document.xml");
    assert.match(document, /東京 😀/u);
    assert.match(document, /&lt;tag&gt; &amp;/);
    assert.match(document, /<w:b w:val="1"\/>/);
    assert.match(document, /<w:tbl>/);
    assert.match(document, /<w:tblHeader\/>/);
    assert.match(document, />12.50<\/w:t>/);
    assert.match(document, /<w:sdt>/);
    assert.match(document, /w:tag w:val="email"/);
    assert.match(
        readXmlPart(archive, "word/_rels/document.xml.rels"),
        /TargetMode="External"/
    );
    assert.match(
        readXmlPart(archive, "word/_rels/document.xml.rels"),
        /a=1&amp;b=2/
    );
    assert.equal(result.renderResult.pageCount, 0);
    assert.match(readXmlPart(archive, "word/settings.xml"), /updateFields/);
});

test("native nested lists preserve numbering starts and restart each independent list", () => {
    const root = createContainer();
    root.appendChild(createParagraph([createItalic("Italic text")]));
    const list = createList("ordered", { startNumber: 4 });
    list.addItem("First");
    const item = list.addItem("Second");
    const nested = createList("unordered");
    nested.addItem("Nested");
    item.appendChild(nested);
    root.appendChild(list);
    const second = createList("ordered");
    second.addItem("Restart");
    root.appendChild(second);
    const output = createDocxRenderer({
        pageConfig: { size: "letter" }
    }).render([{ id: "list", config: { id: "list" }, content: root.children }]);
    assert.equal(output.success, true, output.errors.join("; "));
    const archive = readPackage(output.output);
    assert.match(
        readXmlPart(archive, "word/document.xml"),
        /<w:i w:val="1"\/>/
    );
    assert.match(
        readXmlPart(archive, "word/numbering.xml"),
        /w:start w:val="4"/
    );
    assert.match(
        readXmlPart(archive, "word/numbering.xml"),
        /w:numFmt w:val="bullet"/
    );
    assert.match(readXmlPart(archive, "word/document.xml"), /w:ilvl w:val="1"/);
    assert.match(
        readXmlPart(archive, "word/document.xml"),
        /w:numId w:val="3"/
    );
});

test("DOCX retains merged cells and scales column proportions to the content width", () => {
    const table = new TableNode({
        columns: [
            { width: 120, widthType: "fixed" },
            { width: 120, widthType: "fixed" }
        ]
    });
    const first = new RowNode();
    first.appendChild(new CellNode("Across", { colspan: 2 }));
    table.appendChild(first);
    const second = new RowNode();
    second.appendChild(new CellNode("Down", { rowspan: 2 }));
    second.appendChild(new CellNode("Right one"));
    table.appendChild(second);
    const third = new RowNode();
    third.appendChild(new CellNode("Right two"));
    table.appendChild(third);
    const result = createDocxRenderer({ pageConfig: { size: "a4" } }).render([
        { id: "table", config: { id: "table" }, content: [table] }
    ]);
    assert.equal(result.success, true, result.errors.join("; "));
    const document = readXmlPart(
        readPackage(result.output),
        "word/document.xml"
    );
    assert.match(document, /<w:gridSpan w:val="2"\/>/);
    assert.match(document, /<w:vMerge w:val="restart"\/>/);
    assert.match(document, /<w:vMerge\/>/);
    assert.match(document, /<w:gridCol w:w="4950"\/>/);
});

test("cover, TOC, body and final signing page remain ordered with isolated furniture", () => {
    const renderer = createDocxRenderer({
        pageConfig: { size: "a4" },
        metadata: { includeDates: false },
        coverConfig: {
            suppressHeader: true,
            suppressFooter: true,
            suppressPageNumbering: true
        },
        defaultHeaders: [
            {
                pages: "all",
                location: "header",
                columns: { left: { content: "BODY HEADER" } }
            }
        ],
        defaultFooters: [
            {
                pages: "all",
                location: "footer",
                columns: {
                    right: {
                        content: [
                            "Page ",
                            { type: "variable", name: "page" },
                            " of ",
                            { type: "variable", name: "totalPages" }
                        ]
                    }
                }
            }
        ],
        signingPage: {
            enabled: true,
            witnessClause: "Execution witness",
            parties: [{ label: "COMPANY", signatories: [{ name: "Ada" }] }]
        }
    });
    const document = convertMarkdownToDocument(
        parseMarkdownDoc("# Terms\n\nBody only.")
    );
    const pipeline = createDocumentPipeline()
        .setRenderer(renderer)
        .setCompositionConfig({
            sections: [],
            variables: {},
            defaultPageConfig: { size: "a4" },
            coverPage: {
                elements: [
                    {
                        type: "text",
                        content: "COVER ONLY",
                        style: { fontSize: 24 }
                    }
                ]
            },
            toc: { title: "Contents", levels: [1] }
        });
    const result = pipeline.processSingle({
        id: "terms",
        name: "Terms",
        root: document.root
    });
    const archive = parts(result);
    const xml = readXmlPart(archive, "word/document.xml");
    assert.ok(xml.indexOf("COVER ONLY") < xml.indexOf("Contents"));
    assert.ok(xml.indexOf("Contents") < xml.indexOf("Body only."));
    assert.ok(xml.indexOf("Body only.") < xml.indexOf("Execution witness"));
    assert.ok(
        xml.indexOf('w:name="BodyEnd"') < xml.indexOf("Execution witness")
    );
    assert.match(xml, /PAGEREF Record/);
    assert.match(xml, /Ada/);
    const footers = [...archive]
        .filter(([name]) => /word\/footer/.test(name))
        .map(([, value]) => value)
        .join("");
    assert.match(footers, /PAGEREF NumberingStart/);
    assert.match(footers, /PAGEREF BodyEnd/);
    assert.doesNotMatch(footers, /\{ PAGE \}/);
});

test("DOCX embeds PNG and SVG resources with local relationships", () => {
    const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
    );
    const svg = Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="#123456"/></svg>'
    );
    const content = [
        createImage("", { src: "", sourceBytes: png, width: 12, height: 12 }),
        createImage("", { src: "", sourceBytes: svg, width: 40, height: 20 })
    ];
    const result = createDocxRenderer({ pageConfig: { size: "a4" } }).render([
        { id: "images", config: { id: "images" }, content }
    ]);
    assert.equal(result.success, true, result.errors.join("; "));
    const archive = readPackage(result.output);
    assert.equal(
        [...archive.keys()].filter((path) => path.startsWith("word/media/"))
            .length,
        2
    );
    assert.match(
        readXmlPart(archive, "[Content_Types].xml"),
        /image\/svg\+xml/
    );
    assert.match(readXmlPart(archive, "word/document.xml"), /svgBlip/);
});

test("positioned first page retains continuation and a final signing directive", () => {
    const result = render(
        "# Issuer\n\nExample company\n\n# Records\n\nSome records.\n\n:::signing-page\n## Execution\n\nSignature here.\n:::",
        {
            pageComposition: {
                mode: "first-page",
                continuationHeading: "Records",
                regions: [
                    {
                        sourceHeading: "Issuer",
                        x: 40,
                        top: 40,
                        width: 400,
                        height: 70,
                        fontSize: 12
                    }
                ]
            },
            pageTracking: { enabled: true, identifier: "DOC-001/1" },
            variables: { documentId: "DOC-001/1" }
        }
    );
    const archive = parts(result);
    const document = readXmlPart(archive, "word/document.xml");
    assert.match(document, /w:txbxContent/);
    assert.ok(
        document.indexOf("Example company") < document.indexOf("Some records.")
    );
    assert.ok(
        document.indexOf("Some records.") < document.indexOf("Signature here.")
    );
    const footers = [...archive]
        .filter(([name]) => name.startsWith("word/footer"))
        .map(([, part]) => part)
        .join("");
    assert.match(footers, /DISPLAYBARCODE/);
    assert.match(footers, /NUMPAGES/);
    assert.match(footers, /DOC-001\/1\|/);
});

test("rendering is deterministic when metadata dates are disabled and rejects invalid inputs", () => {
    assert.deepEqual(
        render("Hello").renderResult.output,
        render("Hello").renderResult.output
    );
    assert.equal(render("Hello\u0001").success, false);
    const result = render("# A\n\nContent", {
        pageComposition: {
            mode: "fixed",
            regions: [
                {
                    sourceHeading: "Absent",
                    x: 40,
                    top: 40,
                    width: 400,
                    height: 80,
                    fontSize: 12
                }
            ]
        }
    });
    assert.equal(result.success, false);
    assert.match(result.errors.join(" "), /Missing source heading/);
    assert.throws(() => {
        // @ts-expect-error Exercise rejection of an unsupported output format.
        return createDocumentRenderer("html", { pageConfig: { size: "a4" } });
    }, /Unsupported/);
});
