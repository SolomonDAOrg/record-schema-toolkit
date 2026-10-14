import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdownDoc } from "../../lib/parsing/markdown.mjs";
import { convertMarkdownToDocument } from "../../lib/ast/converters/MarkdownToAstConverter.mjs";
import { createDocumentPipeline } from "../../lib/ast/pipelines/DocumentPipeline.mjs";
import { createTwoPassPdfRenderer } from "../../lib/ast/renderers/TwoPassPdfRenderer.mjs";
import { extractText } from "../../lib/pdf/extract-text.mjs";

for (const newline of ["\n", "\r\n", "\r"]) {
    test("a table preserves following blocks with line ending " + JSON.stringify(newline), () => {
        for (const following of ["Ownership remains with the Company.", "## Ownership", "<!-- pagebreak -->"]) {
            for (const gap of [newline, newline + newline]) {
                const source = ["| Item | Owner |", "|---|---|", "| Code | Company |"].join(newline) + gap + following;
                const parsed = parseMarkdownDoc(source, { softWrap: true });
                assert.equal(parsed.nodes.length, 2);
                assert.equal(parsed.nodes[0].type, "table");
                const expected = following.startsWith("<!--") ? "page-break" : following.startsWith("#") ? "heading" : "paragraph";
                assert.equal(parsed.nodes[1].type, expected);
                if (expected === "paragraph") assert.equal(parsed.nodes[1].content, following);
            }
        }
        const separated = ["| Item | Owner |", "|---|---|", "| Code | Company |", "", "This | is a separate paragraph."].join(newline);
        assert.equal(parseMarkdownDoc(separated).nodes[1].type, "paragraph");
    });
}

test("PDF output retains an ownership clause and a page break after tables", () => {
    const source = "| Item | Owner |\n|---|---|\n| Code | Company |\n\nOwnership remains with the Company.\n\n| Item | State |\n|---|---|\n| Code | Complete |\n\n<!-- pagebreak -->\n\n## Execution\n\nAuthorized execution.";
    const ast = convertMarkdownToDocument(parseMarkdownDoc(source));
    const pipeline = createDocumentPipeline().setRenderer(createTwoPassPdfRenderer({pageConfig:{size:"a4"}}));
    const result = pipeline.processSingle({id:"CON-00777",name:"Assignment",root:ast.root});
    assert.equal(result.success, true, result.errors.join("; "));
    const extracted = extractText(result.renderResult.output);
    assert.equal(extracted.pages.length, 2);
    assert.match(extracted.pages[0].replace(/\s+/g," "), /Ownership remains with the Company/);
    assert.match(extracted.pages[1], /Execution/);
});

test("placeholder underlines remain visible after a light table stroke", () => {
    const renderer = createTwoPassPdfRenderer({pageConfig:{size:"a4"}});
    const state = renderer.initializeState();
    renderer.newPage(state,"form");
    state.currentPage.contentBuilder.setStrokeGray(1);
    renderer.renderInlineRunsWrapped([{text:"[Name]",bold:false,italic:false,underline:false,monospace:false,formField:true,formFieldText:"Name"}],state,"form",40,700,200,10,1.2);
    const stream = state.currentPage.contentBuilder.build();
    assert.match(stream, /1 G[\s\S]*q\n0 G[\s\S]*S\nQ/);
    assert.equal(state.currentPage.linkAnnotations.length,1);
});

test("table completion prompts survive PDF text extraction", () => {
    const ast = convertMarkdownToDocument(parseMarkdownDoc("| Particular | Value |\n|---|---|\n| Licensee | [Full legal name] |\n| Protocol IP | [Exact asset identifiers] |"));
    const result = createDocumentPipeline().setRenderer(createTwoPassPdfRenderer({pageConfig:{size:"a4"}})).processSingle({id:"CON-00777",name:"Particulars",root:ast.root});
    assert.equal(result.success, true, result.errors.join("; "));
    const text = extractText(result.renderResult.output).text.replace(/\s+/g," ");
    assert.match(text, /\[Full legal name\]/);
    assert.match(text, /\[Exact asset identifiers\]/);
});
