import assert from "node:assert/strict";
import test from "node:test";
import { TableNode } from "../../lib/ast/nodes/TabularNode.mjs";
import { createTwoPassPdfRenderer } from "../../lib/ast/renderers/TwoPassPdfRenderer.mjs";
import { convertMarkdownToDocument } from "../../lib/ast/converters/MarkdownToAstConverter.mjs";
import { parseMarkdownDoc } from "../../lib/parsing/markdown.mjs";
import { createDocumentPipeline } from "../../lib/ast/pipelines/DocumentPipeline.mjs";
import { extractText } from "../../lib/pdf/extract-text.mjs";

/** @typedef {import("../../lib/ast/types/core.mjs").TableRenderConfig} TableRenderConfig */

/** @param {number} count @param {boolean} [headerRow] */
function makeTable(count, headerRow = true) {
    const table = new TableNode({ headerRow, columns: [{ widthType: "auto" }] });
    if (headerRow) table.addHeaderRow(["HEADER"]);
    for (let index = 1; index <= count; index++) table.addRow(["Record " + index]);
    return table;
}

/** @param {TableRenderConfig} [table] */
function makeRenderer(table = {}) {
    const renderer = createTwoPassPdfRenderer({
        pageConfig: { size: "a4" },
        table: { fontSize: 10, autoShrink: false, lineHeight: 1, cellPadding: 0, borderWidth: 0, ...table }
    });
    const state = renderer.initializeState();
    renderer.newPage(state, "body");
    return { renderer, state };
}

for (const remaining of [30, 39.9, 40]) {
    test("three-row table opening with " + remaining + " points remaining", () => {
        const { renderer, state } = makeRenderer({ minimumBodyRows: 3 });
        state.currentY = state.margins.bottom + remaining;
        renderer.renderTable(makeTable(6), state, "body", null);
        assert.equal(state.pages.length, 2);
        const first = state.pages[0].contentBuilder.build();
        const second = state.pages[1].contentBuilder.build();
        if (remaining < 40) {
            assert.doesNotMatch(first, /HEADER|Record/);
            for (let index = 1; index <= 6; index++) assert.ok(second.includes("(Record " + index + ") Tj"));
        } else {
            assert.match(first, /HEADER/);
            assert.match(first, /Record 3/);
            assert.doesNotMatch(first, /Record 4/);
            assert.match(second, /HEADER/);
            assert.match(second, /Record 4/);
        }
    });
}

test("short tables and headerless tables keep only their required available rows", () => {
    /** @type {[number, boolean, number][]} */
    const cases = [[2, true, 30], [0, true, 10], [3, false, 30]];
    for (const [count, headerRow, remaining] of cases) {
        const { renderer, state } = makeRenderer({ minimumBodyRows: 3 });
        state.currentY = state.margins.bottom + remaining;
        renderer.renderTable(makeTable(count, headerRow), state, "body", null);
        assert.equal(state.pages.length, 1);
    }
    const { renderer, state } = makeRenderer();
    state.currentY = state.margins.bottom + 30;
    renderer.renderTable(makeTable(6), state, "body", null);
    assert.match(state.pages[0].contentBuilder.build(), /Record 2/);
});

test("wrapped opening rows are measured and the requested group is limited to full-page capacity", () => {
    const { renderer, state } = makeRenderer({ minimumBodyRows: 3 });
    const table = makeTable(0);
    table.addRow(["First"]);
    table.addRow(["Second\nWrapped"]);
    table.addRow(["Third"]);
    state.currentY = state.margins.bottom + 40;
    renderer.renderTable(table, state, "body", null);
    assert.equal(state.pages.length, 2);
    assert.doesNotMatch(state.pages[0].contentBuilder.build(), /HEADER/);
    assert.match(state.pages[1].contentBuilder.build(), /Third/);
    const oversized = makeTable(0);
    for (let index = 0; index < 3; index++) oversized.addRow([Array(30).fill("Wrapped line").join("\n")]);
    const fresh = makeRenderer({ minimumBodyRows: 3 });
    fresh.renderer.renderTable(oversized, fresh.state, "body", null);
    assert.equal(fresh.state.pages.length, 2);
    assert.match(fresh.state.pages[0].contentBuilder.build(), /Wrapped line/);
    assert.match(fresh.state.pages[1].contentBuilder.build(), /HEADER/);
});

test("invalid opening-row counts fail explicitly", () => {
    for (const minimumBodyRows of [0, -1, 1.5, NaN, Infinity]) {
        const { renderer, state } = makeRenderer({ minimumBodyRows });
        assert.throws(() => renderer.renderTable(makeTable(2), state, "body", null), /positive integer/);
    }
});

test("a preceding heading moves with its three-row table opening", () => {
    const source = "Opening text.\n\n## Records\n\n| HEADER |\n|---|\n| First |\n| Second |\n| Third |\n| Fourth |";
    const ast = convertMarkdownToDocument(parseMarkdownDoc(source));
    const { renderer } = makeRenderer({ minimumBodyRows: 3 });
    const renderParagraph = renderer.renderParagraph.bind(renderer);
    renderer.renderParagraph = (node, state, section, layout) => {
        renderParagraph(node, state, section, layout);
        if (renderer.extractText(node) === "Opening text.") state.currentY = state.margins.bottom + 55;
    };
    const result = createDocumentPipeline().setRenderer(renderer).processSingle({ id: "CON-00002", name: "Records", root: ast.root });
    assert.equal(result.success, true, result.errors.join("; "));
    const pages = extractText(result.renderResult.output).pages;
    assert.equal(pages.length, 2);
    assert.doesNotMatch(pages[0], /Records|HEADER/);
    assert.match(pages[1], /Records/);
    assert.match(pages[1], /Third/);
});

test("padded intrinsic columns consume spare width without crowding auto-column contents", () => {
    const { renderer, state } = makeRenderer();
    const measurement = { state, fontSize: 10, bodyPadding: { top: 4, right: 4, bottom: 4, left: 4 }, headerPadding: { top: 4, right: 4, bottom: 4, left: 4 }, borderWidth: 0.5 };
    const table = new TableNode({ columns: [{ widthType: "max-content-padded" }, { widthType: "max-content-padded" }, { widthType: "auto" }] });
    table.addHeaderRow(["Start", "End", "Amount"]);
    table.addRow(["01 Jun 2026", "02 Jun 2026", "1,000.00"]);
    const natural = [0, 1, 2].map(index => renderer.measureTableColumnWidth(table, index, measurement));
    const required = natural.reduce((sum, width) => sum + width, 0);
    for (const spare of [0, 10, 100]) {
        const widths = renderer.calculateColumnWidths(table, required + spare, 3, measurement);
        const extra = spare === 100 ? 20 : spare / 2;
        assert.ok(Math.abs(widths[0] - natural[0] - extra) < 0.001);
        assert.ok(Math.abs(widths[1] - natural[1] - extra) < 0.001);
        assert.ok(widths[2] >= natural[2] - 0.001);
        assert.ok(Math.abs(widths.reduce((sum, width) => sum + width, 0) - required - spare) < 0.001);
    }
    const constrained = renderer.calculateColumnWidths(table, required - 10, 3, measurement);
    table.setColumns([{ widthType: "max-content" }, { widthType: "max-content" }, { widthType: "auto" }]);
    assert.deepEqual(constrained, renderer.calculateColumnWidths(table, required - 10, 3, measurement));
    const unpadded = renderer.calculateColumnWidths(table, required + 100, 3, measurement);
    assert.equal(unpadded[0], natural[0]);
    assert.equal(unpadded[1], natural[1]);
});

test("Markdown table directives accept padded intrinsic columns", () => {
    const ast = convertMarkdownToDocument(parseMarkdownDoc(":::table max-content-padded auto\n| Date | Detail |\n|---|---|\n| 01 Jun 2026 | Entry |\n:::"));
    const { renderer } = makeRenderer();
    const result = createDocumentPipeline().setRenderer(renderer).processSingle({ id: "CON-00002", name: "Records", root: ast.root });
    assert.equal(result.success, true, result.errors.join("; "));
    assert.match(extractText(result.renderResult.output).text, /01 Jun 2026/);
});
