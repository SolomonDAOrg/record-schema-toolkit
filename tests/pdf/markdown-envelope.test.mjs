import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdownDoc } from "../../lib/parsing/markdown.mjs";
import { convertMarkdownToDocument } from "../../lib/ast/converters/MarkdownToAstConverter.mjs";
import { createDocumentPipeline } from "../../lib/ast/pipelines/DocumentPipeline.mjs";
import { createTwoPassPdfRenderer } from "../../lib/ast/renderers/TwoPassPdfRenderer.mjs";
import { extractText } from "../../lib/pdf/extract-text.mjs";
import { loadPdf, getRaw } from "../../lib/pdf/reader.mjs";

/** @typedef {import("../../lib/ast/renderers/TwoPassPdfRenderer.mjs").PdfRendererConfig} PdfRendererConfig */
/** @typedef {import("../../lib/ast/renderers/TwoPassPdfRenderer.mjs").PdfPage} PdfPage */

/** @type {PdfRendererConfig["markdownEnvelopeStyle"]} */
const style = {
    fontSize: 9.2,
    labelFontSize: 8.3,
    lineSpacing: 1.35,
    rowGap: 3,
    labelGap: 14,
    padding: 10,
    labelColor: "#52616B",
    valueColor: "#263238",
    backgroundColor: "#F5F8FA",
    topRule: { width: 0.6, color: "#213C51" },
    bottomRule: { width: 0.3, color: "#D3DCE2" },
    spacingBefore: 8,
    spacingAfter: 14
};
const source =
    "# Agreement\n\n**Status:** Draft\n**Owner:** Company\n**Applies to:** Licensee\n**Related:** [Framework](https://example.com/framework)\n\n---\n\n## Opening provision\n\nThe opening provision remains with the metadata.\n";

/** @param {string} markdown @param {Partial<PdfRendererConfig>} [configuration] @param {boolean} [limitedSpace] */
function render(markdown, configuration = {}, limitedSpace = false) {
    const ast = convertMarkdownToDocument(
        parseMarkdownDoc(markdown, { softWrap: true })
    );
    const renderer = createTwoPassPdfRenderer({
        pageConfig: { size: "a4" },
        markdownEnvelopeStyle: style,
        ...configuration
    });
    /** @type {PdfPage[]} */
    let pages = [];
    const build = renderer.buildPdf.bind(renderer);
    renderer.buildPdf = (state) => {
        pages = state.pages;
        return build(state);
    };
    if (limitedSpace) {
        const renderSection = renderer.renderSection.bind(renderer);
        renderer.renderSection = (section, state, layout) => {
            section.config.startsNewPage = false;
            renderer.newPage(state, section.id);
            renderer.renderTextAt(
                state.currentPage.contentBuilder,
                state,
                "Earlier content",
                state.margins.left,
                state.currentY,
                10,
                renderer.getFont(state, false)
            );
            state.currentY = state.margins.bottom + 145;
            renderSection(section, state, layout);
        };
    }
    const result = createDocumentPipeline()
        .setRenderer(renderer)
        .processSingle({ id: "CON-00123", name: "Agreement", root: ast.root });
    return { result, pages };
}

test("metadata labels and wrapped values have independent typography and a shared value column", () => {
    const markdown = source.replace(
        "Licensee\n",
        "Licensee " + "obligations ".repeat(100) + "\n"
    );
    const { result, pages } = render(markdown);
    assert.equal(result.success, true, result.errors.join("; "));
    assert.equal(pages.length, 1);
    const stream = pages[0].contentBuilder.build();
    assert.match(stream, /8\.3 Tf/);
    assert.match(stream, /9\.2 Tf/);
    assert.match(stream, /0\.6 w/);
    assert.match(stream, /0\.3 w/);
    assert.match(stream, /0\.9608 0\.9725 0\.9804 rg/);
    const positions = Array.from(
        stream.matchAll(
            /1 0 0 1 ([\d.]+) ([\d.]+) Tm\n\((Draft|Company|Licensee|obligations|Framework)\) Tj/g
        )
    );
    const lineStarts = new Map();
    for (const match of positions)
        lineStarts.set(
            match[2],
            Math.min(lineStarts.get(match[2]) ?? Infinity, Number(match[1]))
        );
    assert.ok(lineStarts.size > 4);
    assert.equal(new Set(lineStarts.values()).size, 1);
    assert.equal((stream.match(/\nS\n/g) ?? []).length, 2);
    const text = extractText(result.renderResult.output).text.replace(
        /\s+/g,
        " "
    );
    assert.match(text, /Status: Draft Owner: Company Applies to: Licensee/);
    assert.match(
        text,
        /Related: Framework Opening provision The opening provision/
    );
    const pdf = loadPdf(result.renderResult.output);
    const page = pdf.getDict(pdf.getPageTree().leafIds[0]);
    const references = Array.from(
        (getRaw(page.entries, "Annots") ?? "").matchAll(/(\d+) 0 R/g),
        (match) => Number(match[1])
    );
    assert.equal(references.length, 1);
    assert.match(
        getRaw(pdf.getDict(references[0]).entries, "A"),
        /https:\/\/example.com\/framework/
    );
});

test("metadata moves with its title, following heading and opening paragraph", () => {
    const { result } = render(source, {}, true);
    assert.equal(result.success, true, result.errors.join("; "));
    const pages = extractText(result.renderResult.output).pages.map((page) =>
        page.replace(/\s+/g, " ")
    );
    assert.equal(pages.length, 2);
    assert.match(pages[0], /Earlier content/);
    assert.doesNotMatch(pages[0], /Agreement|Status:/);
    assert.match(pages[1], /Agreement Status: Draft/);
    assert.match(
        pages[1],
        /Opening provision The opening provision remains with the metadata/
    );
});

test("explicit envelope page breaks are preserved", () => {
    const { result } = render(source, {
        horizontalRule: { behavior: "page-break" }
    });
    assert.equal(result.success, true, result.errors.join("; "));
    const pages = extractText(result.renderResult.output).pages;
    assert.equal(pages.length, 2);
    assert.match(pages[0], /Status:/);
    assert.doesNotMatch(pages[0], /Opening provision/);
    assert.match(pages[1], /Opening provision/);
});

test("oversized metadata fails before drawing a clipped block", () => {
    const oversized = source.replace(
        "Licensee\n",
        "Licensee " + "obligations ".repeat(2000) + "\n"
    );
    const { result } = render(oversized);
    assert.equal(result.success, false);
    assert.match(
        result.errors.join("; "),
        /Markdown envelope must fit on one page/
    );
});

test("omitted or disabled metadata styling retains the existing aligned rows", () => {
    const plain = render(source, { markdownEnvelopeStyle: undefined });
    const disabled = render(source, {
        markdownEnvelopeStyle: { enabled: false }
    });
    assert.equal(plain.result.success, true, plain.result.errors.join("; "));
    assert.equal(
        disabled.result.success,
        true,
        disabled.result.errors.join("; ")
    );
    assert.equal(
        plain.pages[0].contentBuilder.build(),
        disabled.pages[0].contentBuilder.build()
    );
});

test("metadata bottom clearance separates the box from the following paragraph ink", () => {
    const { result, pages } = render(
        "# Statement\n\n**Status:** Draft\n**Owner:** Company\n\nFollowing paragraph.\n",
        {
            baseFontSize: 10,
            markdownEnvelopeStyle: { ...style, padding: 0, spacingAfter: 12 }
        }
    );
    assert.equal(result.success, true, result.errors.join("; "));
    const stream = pages[0].contentBuilder.build();
    const box = Array.from(
        stream.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re/g)
    )[0];
    const paragraph = /1 0 0 1 [\d.]+ ([\d.]+) Tm\n\(Following\) Tj/.exec(
        stream
    );
    assert.ok(box);
    assert.ok(paragraph);
    const glyphTop = Number(paragraph[1]) + 10 * 0.718;
    assert.ok(
        Number(box[2]) - glyphTop >= 12,
        "The requested gap remains clear above the paragraph glyphs"
    );
});

/** @param {string} stream @param {string} text */
function textPosition(stream, text) {
    const position = Array.from(
        stream.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm\n\(([^)]+)\) Tj/g)
    ).find((match) => match[3] === text);
    assert.ok(position, "Rendered text missing: " + text);
    return { x: Number(position[1]), y: Number(position[2]) };
}

test("automatic metadata columns place four consecutive entries on two aligned rows", () => {
    const { result, pages } = render(source, {
        markdownEnvelopeStyle: { ...style, columns: "auto", columnGap: 24 }
    });
    assert.equal(result.success, true, result.errors.join("; "));
    const stream = pages[0].contentBuilder.build();
    const positions = ["Draft", "Company", "Licensee", "Framework"].map(
        (text) => textPosition(stream, text)
    );
    assert.equal(positions[0].y, positions[1].y);
    assert.equal(positions[2].y, positions[3].y);
    assert.ok(positions[0].y > positions[2].y);
    assert.equal(positions[0].x, positions[2].x);
    assert.equal(positions[1].x, positions[3].x);
    assert.ok(positions[1].x > positions[0].x + 100);
    const text = extractText(result.renderResult.output).text.replace(
        /\s+/g,
        " "
    );
    assert.match(
        text,
        /Status: Draft Owner: Company Applies to: Licensee Related: Framework/
    );
    const pdf = loadPdf(result.renderResult.output);
    const page = pdf.getDict(pdf.getPageTree().leafIds[0]);
    const references = Array.from(
        (getRaw(page.entries, "Annots") ?? "").matchAll(/(\d+) 0 R/g),
        (match) => Number(match[1])
    );
    assert.equal(references.length, 1);
    assert.match(
        getRaw(pdf.getDict(references[0]).entries, "A"),
        /https:\/\/example.com\/framework/
    );
});

test("automatic columns give a long value the full row and preserve the following pair and odd entry", () => {
    const markdown =
        "# Statement\n\n**Status:** Draft\n**Owner:** AVeryLongCompanyNameWithoutAnyBreaksThatNeedsTheFullAvailableRow\n**Applies to:** Licensee\n**Related:** Framework\n**Status:** Final\n\nFollowing paragraph.\n";
    const { result, pages } = render(markdown, {
        markdownEnvelopeStyle: { ...style, columns: "auto" }
    });
    assert.equal(result.success, true, result.errors.join("; "));
    const stream = pages[0].contentBuilder.build();
    const draft = textPosition(stream, "Draft");
    const company = textPosition(
        stream,
        "AVeryLongCompanyNameWithoutAnyBreaksThatNeedsTheFullAvailableRow"
    );
    const licensee = textPosition(stream, "Licensee");
    const framework = textPosition(stream, "Framework");
    const final = textPosition(stream, "Final");
    assert.ok(
        draft.y > company.y && company.y > licensee.y && licensee.y > final.y
    );
    assert.equal(licensee.y, framework.y);
    assert.equal(draft.x, company.x);
    assert.equal(company.x, licensee.x);
    assert.equal(licensee.x, final.x);
    assert.ok(framework.x > licensee.x);
});

test("paired metadata preserves clear space above and below its box with ink spacing", () => {
    const { result, pages } = render(
        "# Statement\n\n**Status:** Draft\n**Owner:** Company\n\nFollowing paragraph.\n",
        {
            baseFontSize: 10,
            spacingPolicy: { basis: "ink" },
            markdownEnvelopeStyle: {
                ...style,
                columns: "auto",
                padding: 0,
                spacingBefore: 16,
                spacingAfter: 28
            }
        }
    );
    assert.equal(result.success, true, result.errors.join("; "));
    const stream = pages[0].contentBuilder.build();
    const box = Array.from(
        stream.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re/g)
    )[0];
    assert.ok(box);
    const heading = textPosition(stream, "Statement");
    const paragraph = textPosition(stream, "Following");
    const top = Number(box[2]) + Number(box[4]);
    assert.ok(
        heading.y - top >= 16,
        "Metadata keeps the requested space after the heading"
    );
    assert.ok(
        Number(box[2]) - (paragraph.y + 10 * 0.7) >= 27.99,
        "Metadata keeps the requested space before paragraph ink"
    );
});
