import assert from "node:assert/strict";
import test from "node:test";
import { createDocxRenderer } from "../../lib/ast/renderers/DocxRenderer.mjs";
import { createDocumentPipeline } from "../../lib/ast/pipelines/DocumentPipeline.mjs";
import { convertMarkdownToDocument } from "../../lib/ast/converters/MarkdownToAstConverter.mjs";
import { parseMarkdownDoc } from "../../lib/parsing/markdown.mjs";
import { readPackage, readXmlPart } from "./package-support.mjs";

test("packet TOC keeps every level bold with configured sizes and indentation", () => {
    const document = convertMarkdownToDocument(
        parseMarkdownDoc("# Terms\n\nText.\n\n## Details\n\nMore text.")
    );
    const renderer = createDocxRenderer({
        pageConfig: { size: "letter", margins: { left: 72, right: 72 } },
        baseFontSize: 10,
        fonts: { regular: "Helvetica", bold: "Helvetica-Bold" },
        tocConfig: {
            levelStyles: {
                1: { bold: true, fontSizeScale: 1.1, indent: 0 },
                h2: { bold: true, fontSizeScale: 0.9, indent: 24 },
                3: { bold: false, fontSizeScale: 0.8, indent: 48 }
            }
        }
    });
    const result = createDocumentPipeline()
        .setRenderer(renderer)
        .setCompositionConfig({
            sections: [],
            variables: {},
            toc: {
                title: "Contents",
                levels: [1, 2],
                sectionDocuments: [{ sectionId: "terms", name: "Agreement" }]
            }
        })
        .processSingle({ id: "terms", name: "Agreement", root: document.root });
    assert.equal(result.success, true, result.errors.join("; "));
    const archive = readPackage(result.renderResult.output);
    const paragraphs = [
        ...readXmlPart(archive, "word/document.xml").matchAll(
            /<w:p>([\s\S]*?)<\/w:p>/g
        )
    ]
        .map((match) => match[1])
        .filter((value) => value.includes("<w:hyperlink"));
    assert.equal(paragraphs.length, 3);
    for (const [index, title] of ["Agreement", "Terms", "Details"].entries()) {
        const paragraph = paragraphs[index];
        const link = /<w:hyperlink[^>]*>([\s\S]*?)<\/w:hyperlink>/.exec(
            paragraph
        )[1];
        assert.ok(link.includes(title));
        assert.match(link, new RegExp('<w:b w:val="' + 1 + '"/>'));
        assert.match(
            link,
            new RegExp('<w:sz w:val="' + [22, 18, 16][index] + '"/>')
        );
        assert.match(link, /w:rFonts w:ascii="Arial"/);
        assert.match(
            paragraph,
            new RegExp('<w:ind w:left="' + [0, 480, 960][index] + '"/>')
        );
        assert.match(paragraph, /PAGEREF Record/);
    }
});

test("physical numbering uses standard page fields for the TOC and footer", () => {
    const document = convertMarkdownToDocument(
        parseMarkdownDoc("# Terms\n\nText.\n\n## Details\n\nMore text.")
    );
    const renderer = createDocxRenderer({
        pageConfig: { size: "letter" },
        pageNumbering: { docxMode: "physical" },
        defaultFooters: [
            {
                location: "footer",
                pages: "all",
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
        ]
    });
    const result = createDocumentPipeline()
        .setRenderer(renderer)
        .setCompositionConfig({
            sections: [],
            toc: { title: "Contents", levels: [1, 2] }
        })
        .processSingle({ id: "terms", root: document.root });
    assert.equal(result.success, true, result.errors.join("; "));
    const archive = readPackage(result.renderResult.output);
    const xml = /** @type {string} **/ (archive.get("word/document.xml"));
    assert.match(xml, /PAGEREF Record\d+ \\h/);
    assert.doesNotMatch(xml, /PAGEREF NumberingStart/);
    const footers = [...archive]
        .filter(([name]) => /^word\/footer.*\.xml$/.test(name))
        .map(([, value]) => value)
        .join("");
    assert.match(footers, /> PAGE <\/w:instrText>/);
    assert.match(footers, /> NUMPAGES <\/w:instrText>/);
    assert.doesNotMatch(footers, /PAGEREF|\{page\}|\{total\}/);
});
