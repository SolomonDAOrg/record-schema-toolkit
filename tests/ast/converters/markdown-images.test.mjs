import assert from "node:assert/strict";
import {
    mkdirSync,
    mkdtempSync,
    rmSync,
    symlinkSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { convertMarkdownToDocument } from "../../../lib/ast/converters/MarkdownToAstConverter.mjs";
import { createDocumentPipeline } from "../../../lib/ast/pipelines/DocumentPipeline.mjs";
import { createTwoPassPdfRenderer } from "../../../lib/ast/renderers/TwoPassPdfRenderer.mjs";
import {
    parseMarkdownDoc,
    reflowMarkdown
} from "../../../lib/parsing/markdown.mjs";
import { extractText } from "../../../lib/pdf/extract-text.mjs";
import { getRaw, loadPdf, scanDict } from "../../../lib/pdf/reader.mjs";
import { Document } from "../../../lib/record-schema/Document.mjs";
import { RenderPack } from "../../../lib/record-schema/RenderPack.mjs";

/** @typedef {import("../../../lib/ast/nodes/BaseNode.mjs").BaseNode} BaseNode */
/** @typedef {import("../../../lib/parsing/markdown.mjs").MarkdownNode} MarkdownNode */

const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
);
const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><path fill="#1256AB" d="M0 0H20V10H0Z"/></svg>'
);
const definition =
    "columns:\n  - { header: Item, type: text, align: left, width: auto }\n";
const table = `:::data-table records.tsv\n${definition}:::\n`;

/** @param {MarkdownNode[]} nodes @returns {MarkdownNode[]} */
function images(nodes) {
    return nodes.flatMap((node) =>
        node.type === "image" ? [node] : images(node.children)
    );
}

/** @param {BaseNode} root */
function render(root) {
    const renderer = createTwoPassPdfRenderer({ pageConfig: { size: "a4" } });
    const result = createDocumentPipeline()
        .setRenderer(renderer)
        .processSingle({ id: "DOC-001", name: "Assets", root });
    assert.equal(result.success, true, result.errors.join("; "));
    return result.renderResult.output;
}

/** @param {Uint8Array} bytes @returns {string[]} */
function pageStreams(bytes) {
    const pdf = loadPdf(bytes);
    return pdf.getPageTree().leafIds.map((id) => {
        const references = getRaw(pdf.getDict(id).entries, "Contents") ?? "";
        return Array.from(references.matchAll(/(\d+) \d+ R/g), (match) => {
            const raw = pdf.getObjectRaw(Number(match[1]));
            return new TextDecoder("latin1").decode(
                pdf.decodeStreamBytes(
                    scanDict(raw.dictPart, 0).entries,
                    raw.streamBytes
                )
            );
        }).join("\n");
    });
}

test("image syntax preserves destinations, titles, surrounding prose and source break modes", () => {
    for (const softWrap of [false, true]) {
        for (const ending of ["\n", "\r\n", "\r"]) {
            const parsed = parseMarkdownDoc(
                [
                    "Before",
                    '![A [nested] label](<art/logo (large).png> "Company mark")',
                    "After"
                ].join(ending),
                { softWrap }
            );
            assert.deepEqual(
                images(parsed.nodes).map((node) => [node.content, node.attrs]),
                [
                    [
                        "A [nested] label",
                        { src: "art/logo (large).png", title: "Company mark" }
                    ]
                ]
            );
        }
    }
    const escaped = parseMarkdownDoc(String.raw`![A \] label](logo\(v2\).svg)`);
    assert.equal(images(escaped.nodes)[0].attrs.src, "logo(v2).svg");
    assert.equal(images(escaped.nodes)[0].content, "A ] label");
    for (const literal of [
        String.raw`\![A](logo.png)`,
        "\u0060![A](logo.png)\u0060",
        "\u0060\u0060\u0060\n![A](logo.png)\n\u0060\u0060\u0060",
        "![A](broken",
        "[ordinary](logo.png)"
    ]) {
        assert.equal(
            images(parseMarkdownDoc(literal).nodes).length,
            0,
            literal
        );
    }
    const text =
        'Before\n![A](<art/a long image name.png> "A long title")\nAfter\n';
    assert.equal(reflowMarkdown(text, 12).text, text);
});

test("images and tables load through their document and survive removal of their source files", (t) => {
    const directory = mkdtempSync(join(tmpdir(), "markdown-resources-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    mkdirSync(join(directory, "art"));
    writeFileSync(join(directory, "art", "mark.png"), png);
    writeFileSync(join(directory, "records.tsv"), "Item\nResource row\n");
    const markdown = `Before ![Mark](art/mark.png) after.\n\n${table}`;
    const sourcePath = join(directory, "DOC-00001_DOC-assets.md");
    writeFileSync(sourcePath, markdown);
    const sourceDocument = Document.load(sourcePath);
    const document = convertMarkdownToDocument(parseMarkdownDoc(markdown), {
        sourceDocument
    });
    assert.deepEqual(
        document.root.children[0].children[1].attrs.sourceBytes,
        png
    );
    assert.equal(
        document.root.children[1].children[1].children[0].getTextContent(),
        "Resource row"
    );
    assert.deepEqual(
        document.root.children[0].children.map((node) => node.type),
        ["paragraph", "image", "paragraph"]
    );
    const pack = new RenderPack({
        schema: "record-schema-render-pack",
        schema_version: 1,
        pack_id: "assets",
        document_policies: {}
    });
    const source = Document.load(sourcePath).toRenderSource(
        pack,
        { path: "DOC-00001_DOC-assets.md", doc_type: "DOC" },
        "DOC-00001"
    );
    rmSync(join(directory, "art"), { recursive: true });
    rmSync(join(directory, "records.tsv"));
    const bytes = render(source.root);
    assert.match(extractText(bytes).text, /Resource row/);
    assert.match(Buffer.from(bytes).toString("latin1"), /\/Subtype \/Image/);
});

test("PNG and SVG images render through the native renderer with page breaks", (t) => {
    const directory = mkdtempSync(join(tmpdir(), "markdown-images-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    writeFileSync(join(directory, "mark.png"), png);
    writeFileSync(join(directory, "mark.svg"), svg);
    const references = Array.from({ length: 8 }, (_, index) =>
        index % 2 ? "![Vector](mark.svg)" : "![Raster](mark.png)"
    );
    const document = convertMarkdownToDocument(
        parseMarkdownDoc(`${references.join("\n\n")}\n\nFinal text.`),
        {
            sourceDocument: Document.fromText(
                "",
                join(directory, "document.md")
            )
        }
    );
    const bytes = render(document.root);
    const pages = extractText(bytes).pages;
    assert.ok(pages.length > 1);
    const streams = pageStreams(bytes).join("\n");
    assert.equal((streams.match(/\/IMG_[A-Za-z0-9_]+ Do/g) ?? []).length, 4);
    assert.equal(
        (streams.match(/0\.0706 0\.3373 0\.6706 rg/g) ?? []).length,
        4
    );
    assert.match(pages.at(-1), /Final\s+text/);
    assert.doesNotMatch(pages.join("\n"), /\[Image:/);
});

test("document resource loading rejects missing files, directories, URLs and escaping paths", (t) => {
    const directory = mkdtempSync(join(tmpdir(), "markdown-resource-paths-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const sourcePath = join(directory, "document.md");
    const sourceDocument = Document.fromText("", sourcePath);
    mkdirSync(join(directory, "directory.png"));
    symlinkSync(tmpdir(), join(directory, "escape"));
    for (const reference of [
        "missing.png",
        "directory.png",
        "../outside.png",
        "/absolute.png",
        "https://example.test/a.png",
        "escape/outside.png"
    ]) {
        assert.throws(
            () =>
                convertMarkdownToDocument(
                    parseMarkdownDoc(`![Mark](${reference})`),
                    { sourceDocument }
                ),
            undefined,
            reference
        );
    }
    assert.throws(
        () => convertMarkdownToDocument(parseMarkdownDoc("![Mark](mark.png)")),
        /source document/
    );
    assert.throws(
        () =>
            convertMarkdownToDocument(parseMarkdownDoc("![Mark](mark.gif)"), {
                sourceDocument
            }),
        /PNG, JPEG or SVG/
    );
    for (const extension of ["png", "svg"]) {
        writeFileSync(join(directory, `mark.${extension}`), "invalid image");
        const invalid = convertMarkdownToDocument(
            parseMarkdownDoc(`![Mark](mark.${extension})`),
            { sourceDocument }
        );
        const result = createDocumentPipeline()
            .setRenderer(
                createTwoPassPdfRenderer({ pageConfig: { size: "a4" } })
            )
            .processSingle({
                id: "invalid",
                name: "Invalid",
                root: invalid.root
            });
        assert.equal(result.success, false);
    }
});

test("SVG resources render in a fixed composition region", (t) => {
    const directory = mkdtempSync(join(tmpdir(), "markdown-svg-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    writeFileSync(join(directory, "mark.svg"), svg);
    const document = convertMarkdownToDocument(
        parseMarkdownDoc("# Artwork\n\n![Mark](mark.svg)"),
        {
            sourceDocument: Document.fromText(
                "",
                join(directory, "document.md")
            )
        }
    );
    const renderer = createTwoPassPdfRenderer({
        pageConfig: { size: "a4" },
        pageComposition: {
            mode: "fixed",
            regions: [
                {
                    sourceHeading: "Artwork",
                    x: 40,
                    top: 40,
                    width: 240,
                    height: 100,
                    fontSize: 10
                }
            ]
        }
    });
    const result = createDocumentPipeline()
        .setRenderer(renderer)
        .processSingle({ id: "art", name: "Artwork", root: document.root });
    assert.equal(result.success, true, result.errors.join("; "));
    assert.equal(result.renderResult.pageCount, 1);
    assert.match(
        pageStreams(result.renderResult.output)[0],
        /0\.0706 0\.3373 0\.6706 rg/
    );
});

test("unsupported inline image contexts fail instead of dropping the image", () => {
    for (const markdown of [
        "# ![Mark](mark.png)",
        "**![Mark](mark.png)**",
        "- ![Mark](mark.png)",
        "| Image | Detail |\n|---|---|\n| ![Mark](mark.png) | Mark |"
    ]) {
        assert.throws(
            () => convertMarkdownToDocument(parseMarkdownDoc(markdown)),
            /Markdown images/
        );
    }
});
