import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdownDoc } from "../../lib/parsing/markdown.mjs";
import { convertMarkdownToDocument } from "../../lib/ast/converters/MarkdownToAstConverter.mjs";
import { createDocumentPipeline } from "../../lib/ast/pipelines/DocumentPipeline.mjs";
import { createTwoPassPdfRenderer } from "../../lib/ast/renderers/TwoPassPdfRenderer.mjs";
import { extractText } from "../../lib/pdf/extract-text.mjs";

/** @typedef {import("../../lib/ast/renderers/TwoPassPdfRenderer.mjs").PdfPage} PdfPage */
/** @typedef {import("../../lib/ast/types/core.mjs").SpacingPolicy} SpacingPolicy */
/** @type {SpacingPolicy} */
const spacing = { basis: "ink", beforeRules: [
    { prev: "heading", next: "table", pt: 7, priority: 1 },
    { prev: "*", next: "paragraph", pt: 6 },
    { prev: "*", next: "heading", pt: 14 }
] };

/** @param {string} markdown @param {boolean} [limitedSpace] */
function render(markdown, limitedSpace = false) {
    const document = convertMarkdownToDocument(parseMarkdownDoc(markdown, { softWrap: true }));
    const renderer = createTwoPassPdfRenderer({
        pageConfig: { size: "a4" }, baseFontSize: 10, lineHeight: 1.35,
        headingScales: { h1: 2, h2: 1.2 }, spacingPolicy: spacing,
        table: { fontSize: 10, lineHeight: 1.2, cellPadding: 5, cellVAlign: "middle", minimumBodyRows: 3,
            header: { backgroundColor: "#213C51", textColor: "#FFFFFF" } },
        markdownEnvelopeStyle: { labels: ["Reference / case", "Period covered"], fontSize: 10, labelFontSize: 10,
            padding: 8, rowGap: 4, spacingBefore: 12, spacingAfter: 10, backgroundColor: "#F5F8FA" }
    });
    /** @type {PdfPage[]} */
    let pages = [];
    const build = renderer.buildPdf.bind(renderer);
    renderer.buildPdf = state => { pages = state.pages; return build(state); };
    if (limitedSpace) {
        const renderSection = renderer.renderSection.bind(renderer);
        renderer.renderSection = (section, state, layout) => {
            section.config.startsNewPage = false;
            renderer.newPage(state, section.id);
            renderer.renderTextAt(state.currentPage.contentBuilder, state, "Earlier text", state.margins.left,
                state.margins.bottom + 35, 10, renderer.getFont(state, false));
            state.currentY = state.margins.bottom + 20;
            state.lastNodeType = "paragraph";
            renderSection(section, state, layout);
        };
    }
    const result = createDocumentPipeline().setRenderer(renderer).processSingle({ id: "spacing", name: "Statement", root: document.root });
    assert.equal(result.success, true, result.errors.join("; "));
    return { output: result.renderResult.output, pages };
}

/** @param {string} stream */
function positions(stream) {
    return Array.from(stream.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm\n\(([^()]*)\) Tj/g), match => ({ x: Number(match[1]), y: Number(match[2]), text: match[3] }));
}
/** @param {number} actual @param {number} expected */
function near(actual, expected) { assert.ok(Math.abs(actual - expected) < 0.02, actual + " differs from " + expected); }

const table = "| Reference | Type | Amount |\n|---|---|---:|\n| T006 | Transfer | 100.00 |\n";

test("ink gaps distinguish section spacing from heading-to-table and paragraph spacing", () => {
    const { pages } = render("# Transaction records\n\n**Reference / case:** CASE-001\n\n**Period covered:** September\n\nOverview.\n\nSecond paragraph.\n\n## Selected movements\n\n" + table + "\nFollowing description.\n\n## Next section\n\nClosing text.\n");
    assert.equal(pages.length, 1);
    const stream = pages[0].contentBuilder.build(), text = positions(stream);
    const rectangles = Array.from(stream.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re/g), match => ({ bottom: Number(match[2]), height: Number(match[4]) }));
    const metadata = rectangles[0], header = rectangles[1];
    const y = value => text.find(position => position.text === value).y;
    near(y("Transaction records") - metadata.bottom - metadata.height, 12);
    near(metadata.bottom - y("Overview.") - 7, 10);
    near(y("Overview.") - y("Second") - 7, 6);
    near(y("paragraph.") - 2 - y("Selected movements") - 8.4, 14);
    near(y("Selected movements") - header.bottom - header.height, 7);
    const bodyBottom = header.bottom - 22;
    near(bodyBottom - y("Following") - 7, 6);
    near(y("description.") - 2 - y("Next section") - 8.4, 14);
});

test("middle-aligned header cells share a baseline and center the row's complete ink height", () => {
    const { pages } = render(table);
    const stream = pages[0].contentBuilder.build(), text = positions(stream);
    const header = Array.from(stream.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re/g))[0];
    const baseline = text.find(position => position.text === "Reference").y;
    assert.equal(text.find(position => position.text === "Type").y, baseline);
    assert.equal(text.find(position => position.text === "Amount").y, baseline);
    const middle = Number(header[2]) + Number(header[4]) / 2;
    near((baseline + 7 + baseline - 2) / 2, middle);
});

test("ink spacing moves a heading with the minimum table opening at a page boundary", () => {
    const rows = Array.from({ length: 8 }, (_, index) => "| Row " + index + " | 100 |\n").join("");
    const { output } = render("## Selected movements\n\n| Reference | Amount |\n|---|---:|\n" + rows, true);
    const pages = extractText(output).pages;
    assert.equal(pages.length, 2);
    assert.match(pages[0], /Earlier text/);
    assert.doesNotMatch(pages[0], /Selected movements/);
    assert.match(pages[1], /Selected movements/);
    assert.match(pages[1], /Row 2/);
});

test("a continuing paragraph moves when only one opening line fits", () => {
    const { output } = render("Opening statement. " + "The complete supporting explanation remains readable. ".repeat(35), true);
    const pages = extractText(output).pages;
    assert.equal(pages.length, 2);
    assert.match(pages[0], /Earlier text/);
    assert.doesNotMatch(pages[0], /Opening\s+statement/);
    assert.match(pages[1], /Opening\s+statement/);
});
