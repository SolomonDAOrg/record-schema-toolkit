import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdownDoc } from "../../lib/parsing/markdown.mjs";
import { convertMarkdownToDocument } from "../../lib/ast/converters/MarkdownToAstConverter.mjs";
import { createDocumentPipeline } from "../../lib/ast/pipelines/DocumentPipeline.mjs";
import { createTwoPassPdfRenderer } from "../../lib/ast/renderers/TwoPassPdfRenderer.mjs";
import { loadPdf, getRaw } from "../../lib/pdf/reader.mjs";

/** @typedef {import("../../lib/ast/renderers/TwoPassPdfRenderer.mjs").PdfRendererConfig} PdfRendererConfig */
/** @typedef {import("../../lib/ast/renderers/TwoPassPdfRenderer.mjs").PdfPage} PdfPage */

const refs = raw => Array.from((raw ?? "").matchAll(/(\d+) 0 R/g), match => Number(match[1]));

/** @param {string} source @param {Partial<PdfRendererConfig>} [configuration] */
function render(source, configuration = {}) {
    const ast = convertMarkdownToDocument(parseMarkdownDoc(source, { softWrap: true }));
    const renderer = createTwoPassPdfRenderer({ pageConfig: { size: "a4" }, ...configuration });
    /** @type {PdfPage[]} */
    let pages = [];
    const build = renderer.buildPdf.bind(renderer);
    renderer.buildPdf = state => { pages = state.pages; return build(state); };
    const result = createDocumentPipeline().setRenderer(renderer).processSingle({ id: "TPL-00000", name: "Form", root: ast.root });
    return { result, pages };
}

test("form fields share a column and evenly spaced interactive rectangles", () => {
    const { result, pages } = render(":::form-fields\n**Company:** [Full legal name]\n\n**Jurisdiction and registration number:** [Company registration number]\n\n**Contact:** [Email address]\n:::\n\nFollowing provision.", {
        directiveStyles: { "form-fields": { rowHeight: 24, fieldLabelWidth: 40, padding: 10 } }
    });
    assert.equal(result.success, true, result.errors.join("; "));
    assert.equal(pages.length, 1);
    const pdf = loadPdf(result.renderResult.output);
    const page = pdf.getDict(pdf.getPageTree().leafIds[0]);
    const form = pdf.getDict(refs(getRaw(pdf.getDict(pdf.rootId).entries, "AcroForm"))[0]);
    const fields = refs(getRaw(form.entries, "Fields"));
    assert.deepEqual(refs(getRaw(page.entries, "Annots")), fields);
    assert.equal(fields.length, 3);
    const rectangles = fields.map(id => getRaw(pdf.getDict(id).entries, "Rect").match(/-?[\d.]+/g).map(Number));
    assert.equal(new Set(rectangles.map(rectangle => rectangle[0])).size, 1);
    assert.equal(new Set(rectangles.map(rectangle => rectangle[2])).size, 1);
    assert.equal(rectangles[0][1] - rectangles[1][1], 24);
    assert.equal(rectangles[1][1] - rectangles[2][1], 24);
    assert.ok(rectangles[0][0] > 150);
    for (const id of fields) {
        const field = pdf.getDict(id);
        assert.equal(getRaw(field.entries, "FT"), "/Tx");
        assert.equal(refs(getRaw(field.entries, "AP")).length, 1);
    }
    const following = pages[0].contentBuilder.build().match(/1 0 0 1 [\d.]+ ([\d.]+) Tm\n\(Following\) Tj/);
    assert.ok(following);
    assert.ok(Number(following[1]) < rectangles[2][1]);
});

test("form fields require an explicit label and exactly one placeholder per row", () => {
    for (const source of [
        ":::form-fields\nCompany: [Name]\n:::",
        ":::form-fields\n**Company** [Name]\n:::",
        ":::form-fields\n**Company:** [Name] [Number]\n:::",
        ":::form-fields\n**Company:** Arbitrary prose.\n:::",
        ":::form-fields Unexpected title\n**Company:** [Name]\n:::"
    ]) {
        assert.throws(() => convertMarkdownToDocument(parseMarkdownDoc(source)), /form-fields/);
    }
});

test("oversized field groups and labels fail without clipping", () => {
    const oversized = ":::form-fields\n" + Array.from({ length: 60 }, (_, index) => "**Field " + index + ":** [Name]\n\n").join("") + ":::";
    const heightFailure = render(oversized).result;
    assert.equal(heightFailure.success, false);
    assert.match(heightFailure.errors.join("; "), /fit on one page/);
    const widthFailure = render(":::form-fields\n**" + "Long label ".repeat(30) + ":** [Name]\n:::").result;
    assert.equal(widthFailure.success, false);
    assert.match(widthFailure.errors.join("; "), /insufficient width/);
});

test("default signature fields provide at least sixty points of writable height", () => {
    const { result } = render(":::signature-block Company\nSignature:\nName:\nDate:\n:::");
    assert.equal(result.success, true, result.errors.join("; "));
    const pdf = loadPdf(result.renderResult.output);
    const page = pdf.getDict(pdf.getPageTree().leafIds[0]);
    const fields = refs(getRaw(page.entries, "Annots")).map(id => pdf.getDict(id));
    const signature = fields.find(field => getRaw(field.entries, "FT") === "/Sig");
    assert.ok(signature);
    const rectangle = getRaw(signature.entries, "Rect").match(/-?[\d.]+/g).map(Number);
    assert.ok(rectangle[3] - rectangle[1] >= 60);
    for (const field of fields.filter(field => getRaw(field.entries, "FT") === "/Tx")) {
        const textRectangle = getRaw(field.entries, "Rect").match(/-?[\d.]+/g).map(Number);
        assert.ok(textRectangle[3] <= rectangle[1]);
    }
});
