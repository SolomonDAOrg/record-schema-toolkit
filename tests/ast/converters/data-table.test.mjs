import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DataTable } from "../../../lib/record-schema/DataTable.mjs";
import { MarkdownToAstConverter, convertMarkdownToDocument } from "../../../lib/ast/converters/MarkdownToAstConverter.mjs";
import { parseMarkdownDoc, reflowMarkdown } from "../../../lib/parsing/markdown.mjs";
import { FormattingPack } from "../../../lib/record-schema/FormattingPack.mjs";
import { Document } from "../../../lib/record-schema/Document.mjs";
import { createDocumentPipeline } from "../../../lib/ast/pipelines/DocumentPipeline.mjs";
import { createTwoPassPdfRenderer } from "../../../lib/ast/renderers/TwoPassPdfRenderer.mjs";
import { extractText } from "../../../lib/pdf/extract-text.mjs";

/** @typedef {import("../../../lib/record-schema/DataTable.mjs").DataTableDecimalColumn} DataTableDecimalColumn */
/** @typedef {import("../../../lib/ast/renderers/TwoPassPdfRenderer.mjs").PdfPage} PdfPage */

/** @param {import("node:test").TestContext} t @param {string} relativePath @param {string} definitionSource @param {((relativePath: string) => string) | undefined} readSource */
function convertDataTable(t, relativePath, definitionSource, readSource) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "data-table-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const sourceDocument = readSource ? Document.fromText("", path.join(directory, "document.md")) : undefined;
    if (readSource) fs.writeFileSync(path.join(directory, relativePath), readSource(relativePath));
    return new MarkdownToAstConverter({sourceDocument})._convertDataTable({
        type: "directive", content: definitionSource, attrs: {name: "data-table", title: relativePath}, children: []
    });
}

const definition = "columns:\n  - { header: Date, type: date, format: DD MMM YYYY, align: center, width: max-content }\n  - { header: Description, type: text, align: left, width: auto }\n  - { header: Amount, type: decimal, decimal_places: 2, rounding: half-up, grouping: true, align: right, width: max-content }\nstriped_rows: true\n";
const markdown = "# Income\n\n:::data-table income.tsv\n" + definition + ":::\n\nFollowing text.\n";

/** @type {DataTableDecimalColumn} */
const amount = { header: "Amount", type: "decimal", decimal_places: 2, rounding: "half-up", grouping: true, align: "right", width: "auto" };

test("amounts use exact decimal rounding and dates reject impossible calendar values", () => {
    assert.equal(DataTable.formatValue("9007199254740993.005", amount), "9,007,199,254,740,993.01");
    assert.equal(DataTable.formatValue("-1.005", amount), "-1.01");
    assert.equal(DataTable.formatValue("-0.001", amount), "0.00");
    assert.equal(DataTable.formatValue("12", amount), "12.00");
    assert.equal(DataTable.formatValue("", { ...amount, nullable: true }), "");
    for (const value of ["", "1e3", "USD 10", "1,000", "NaN"]) assert.throws(() => DataTable.formatValue(value, amount));
    assert.throws(() => DataTable.formatValue("1.005", { ...amount, rounding: "reject" }), /precision/);
    const date = DataTable.parseDefinition(definition).columns[0];
    assert.equal(DataTable.formatValue("2024-02-29", date), "29 Feb 2024");
    assert.equal(DataTable.formatValue("0001-01-01", date), "01 Jan 0001");
    assert.equal(DataTable.formatValue("0099-12-31", date), "31 Dec 0099");
    assert.equal(DataTable.formatValue("2000-02-29", date), "29 Feb 2000");
    assert.equal(DataTable.formatValue("9999-12-31", date), "31 Dec 9999");
    for (const value of ["2025-02-29", "1900-02-29", "2026-04-31", "0000-01-01", "2026-00-01", "2026-13-01", "2026-01-00", "2026-01-32", "08/09/2026"]) assert.throws(() => DataTable.formatValue(value, date));
});

test("referenced table headings, columns, records and literal contents remain explicit", (t) => {
    const table = convertDataTable(t, "income.tsv", definition, () => "Date\tDescription\tAmount\n2026-09-08\t[Literal] **text**\t10.005\n");
    assert.equal(table.headerRow, true);
    assert.equal(table.stripedRows, true);
    assert.equal(table.getCell(1, 0).getTextContent(), "08 Sep 2026");
    assert.equal(table.getCell(1, 1).getTextContent(), "[Literal] **text**");
    assert.equal(table.getCell(1, 2).getTextContent(), "10.01");
    assert.equal(table.getCell(1, 2).align, "right");
    assert.equal(convertDataTable(t, "income.csv", definition, () => "Date,Description,Amount\n").rowCount(), 1);
    assert.throws(() => convertDataTable(t, "income.csv", definition, () => "Description,Date,Amount\n"), /headings/);
    assert.throws(() => convertDataTable(t, "income.csv", definition, () => "Date,Description,Amount\n2026-09-08,short\n"), /field count/);
    assert.throws(() => convertDataTable(t, "income.csv", definition, () => "Date,Description,Amount\n2026-09-08,fee,wrong\n"), /record 2, Amount/);
    assert.throws(() => convertDataTable(t, "income.csv", definition, undefined), /source document/);
    assert.throws(() => DataTable.parseDefinition(definition + "guess_types: true\n"), /requires columns/);
    assert.throws(() => DataTable.parseDefinition(definition.replace("rounding: half-up", "rounding: implicit")), /rounding/);
});

test("document validation and reflow retain the bound data-table reference", (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "record-table-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const sourcePath = path.join(directory, "CON-00002_DOC-income.md");
    fs.writeFileSync(sourcePath, markdown);
    fs.writeFileSync(path.join(directory, "income.tsv"), "Date\tDescription\tAmount\n2026-09-08\tService fee\t1000\n");
    const sourceDocument = Document.load(sourcePath);
    const ast = convertMarkdownToDocument(parseMarkdownDoc(markdown), { sourceDocument });
    assert.equal(ast.root.children[1].type, "table");
    assert.doesNotThrow(() => DataTable.validateMarkdown(Document.load(sourcePath)));
    const reflowed = reflowMarkdown(markdown, 72).text;
    assert.match(reflowed, /rounding: half-up/);
    assert.doesNotThrow(() => DataTable.validateMarkdown(sourceDocument.withText(reflowed)));
    assert.throws(() => sourceDocument.loadResource("../outside.csv"), /leaves/);
    assert.throws(() => sourceDocument.loadResource("https://example.com/income.csv"), /Invalid/);
    fs.symlinkSync(path.join(directory, ".."), path.join(directory, "escape"));
    assert.throws(() => sourceDocument.loadResource("escape/outside.csv"));
    fs.writeFileSync(path.join(directory, "income.tsv"), "Date\tDescription\tAmount\n2026-02-30\tFee\t10\n");
    assert.throws(() => DataTable.validateMarkdown(Document.load(sourcePath)), /income.tsv: record 2, Date/);
    fs.unlinkSync(path.join(directory, "income.tsv"));
    assert.throws(() => DataTable.validateMarkdown(Document.load(sourcePath)), /ENOENT/);
});

test("referenced tables repeat headers and alternate data-row fills across pages", (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "data-table-pages-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const records = "Date\tDescription\tAmount\n" + Array.from({ length: 90 }, (_, index) => "2026-09-08\tEntry " + index + "\t1000.005\n").join("");
    fs.writeFileSync(path.join(directory, "income.tsv"), records);
    const sourceDocument = Document.fromText(markdown, path.join(directory, "document.md"));
    const ast = convertMarkdownToDocument(parseMarkdownDoc(markdown), { sourceDocument });
    const renderer = createTwoPassPdfRenderer({ pageConfig: { size: "a4" }, table: { zebra: { enabled: true, oddBackground: "#FFFFFF", evenBackground: "#F1F5F7" } } });
    /** @type {PdfPage[]} */
    let renderedPages = [];
    const build = renderer.buildPdf.bind(renderer);
    renderer.buildPdf = state => { renderedPages = state.pages; return build(state); };
    const result = createDocumentPipeline().setRenderer(renderer).processSingle({ id: "CON-00002", name: "Income", root: ast.root });
    assert.equal(result.success, true, result.errors.join("; "));
    const pages = extractText(result.renderResult.output).pages;
    assert.ok(pages.length > 1);
    for (let index = 0; index < pages.length; index++) {
        assert.match(pages[index], /Date/);
        assert.match(pages[index], /Amount/);
        assert.match(renderedPages[index].contentBuilder.build(), /0\.9451 0\.9608 0\.9686 rg/);
    }
    assert.equal((pages.join(" ").match(/1,000.01/g) ?? []).length, 90);
    assert.match(pages.at(-1), /Following/);
});

test("dialect lint leaves declared data-table syntax alone and checks surrounding prose", () => {
    const policy = { defaults: { dialect_pack: "british" }, dialect_packs: { british: { pairs: [{ preferred: "centre", forbid: ["center"] }] } } };
    const lint = text => FormattingPack.lintDocument(policy, Document.fromText(text, "CON-00002_DOC-income.md"), "CON-00002_DOC-income.md", { doc_type: "DOC", ext: "md", is_root_file: false });
    assert.equal(lint(markdown).filter(issue => issue.code === "format.dialect.spelling").length, 0);
    assert.equal(lint(markdown + "\nThe center of the page.\n").filter(issue => issue.code === "format.dialect.spelling").length, 1);
});

test("native PDF places decimal values against a common right edge and centers dates", (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "data-table-pages-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const records = "Date\tDescription\tAmount\n2026-09-08\tFirst\t10\n2026-09-09\tSecond\t10000\n";
    fs.writeFileSync(path.join(directory, "income.tsv"), records);
    const sourceDocument = Document.fromText(markdown, path.join(directory, "document.md"));
    const ast = convertMarkdownToDocument(parseMarkdownDoc(markdown), { sourceDocument });
    const renderer = createTwoPassPdfRenderer({ pageConfig: { size: "a4" } });
    let stream = "";
    const build = renderer.buildPdf.bind(renderer);
    renderer.buildPdf = state => { stream = state.pages[0].contentBuilder.build(); return build(state); };
    const result = createDocumentPipeline().setRenderer(renderer).processSingle({ id: "CON-00002", name: "Income", root: ast.root });
    assert.equal(result.success, true, result.errors.join("; "));
    const x = value => {
        const match = Array.from(stream.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm\n\(([^\n]*)\) Tj/g)).find(item => item[3] === value);
        assert.ok(match, value);
        return Number(match[1]);
    };
    assert.ok(x("10.00") > x("10,000.00"));
    assert.ok(x("Date") > x("08 Sep 2026"));
});


test("referenced CSV and TSV columns accept padded intrinsic widths", (t) => {
    const padded = definition.replaceAll("width: max-content", "width: max-content-padded");
    for (const [name, separator] of [["income.csv", ","], ["income.tsv", "\t"]]) {
        const table = convertDataTable(t, name, padded, () => ["Date", "Description", "Amount"].join(separator) + "\n" + ["2026-09-08", "Entry", "1000"].join(separator) + "\n");
        assert.equal(table.columns[0].widthType, "max-content-padded");
        assert.equal(table.columns[2].widthType, "max-content-padded");
        assert.equal(table.getCell(1, 2).getTextContent(), "1,000.00");
    }
});
