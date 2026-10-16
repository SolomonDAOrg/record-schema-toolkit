import { measureTextWidth } from "../../../pdf/document.mjs";

/** @typedef {import("../TwoPassPdfRenderer.mjs").TwoPassPdfRenderer} PdfRenderer */
/** @typedef {import("../TwoPassPdfRenderer.mjs").PdfBuildState} PdfBuildState */
/** @typedef {import("../../nodes/TabularNode.mjs").CellNode} CellNode */
/** @typedef {ReturnType<PdfRenderer["buildInlineRuns"]>[number]} InlineRun */
/** @typedef {{ text: string; font: string; width: number; run: InlineRun }} CellFragment */
/** @typedef {{ fragments: CellFragment[]; width: number }} CellLine */

/** @param {PdfRenderer} renderer @param {CellNode | undefined} cell @param {boolean} header @returns {InlineRun[]} */
function cellRuns(renderer, cell, header) {
    const base = renderer.mergeTextStyle(
        { bold: header, italic: false, underline: false, monospace: false },
        { ...cell?.textStyle, ...cell?.style?.text }
    );
    if (!cell) return [];
    // Literal data-table text must not acquire smart punctuation or field semantics.
    if (cell.children.every((node) => node.type === "text")) {
        return cell.children.map((node) => ({
            ...renderer.mergeTextStyle(base, node.textStyle),
            text: node.getTextContent()
        }));
    }
    /** @type {InlineRun[]} */
    const runs = [];
    renderer.collectInlineRunsInto(runs, cell, base);
    return runs;
}

/**
 * Lay out a cell without mutating page state. Intrinsic widths, row heights and
 * drawing all use these same font-aware lines; a row remains the pagination unit.
 * @param {PdfRenderer} renderer
 * @param {PdfBuildState} state
 * @param {CellNode | undefined} cell
 * @param {boolean} header
 * @param {number} fontSize
 * @param {number} width
 * @returns {CellLine[]}
 */
export function layoutTableCell(
    renderer,
    state,
    cell,
    header,
    fontSize,
    width
) {
    /** @type {CellLine[]} */
    const lines = [];
    /** @type {CellLine} */
    let line = { fragments: [], width: 0 };
    /** @type {CellFragment | undefined} */
    let space;
    /** @type {CellFragment[]} */
    let word = [];
    const advance = () => {
        lines.push(line);
        line = { fragments: [], width: 0 };
        space = undefined;
    };
    /** @param {CellFragment} fragment */
    const append = (fragment) => {
        const previous = line.fragments.at(-1);
        if (
            previous &&
            previous.run === fragment.run &&
            previous.font === fragment.font
        ) {
            previous.text += fragment.text;
            previous.width += fragment.width;
        } else {
            line.fragments.push({ ...fragment });
        }
        line.width += fragment.width;
    };
    const flushWord = () => {
        if (!word.length) return;
        const wordWidth = word.reduce(
            (sum, fragment) => sum + fragment.width,
            0
        );
        if (line.width && line.width + (space?.width ?? 0) + wordWidth > width)
            advance();
        if (line.width && space) append(space);
        space = undefined;
        for (const fragment of word) {
            if (wordWidth <= width) {
                append(fragment);
                continue;
            }
            // Machine identifiers may exceed the cell width. Keep every character
            // and its link/style when splitting them across physical lines.
            for (const character of fragment.text) {
                const characterWidth = measureTextWidth(
                    character,
                    fragment.font,
                    fontSize
                );
                if (line.width && line.width + characterWidth > width)
                    advance();
                append({ ...fragment, text: character, width: characterWidth });
            }
        }
        word = [];
    };
    for (const run of cellRuns(renderer, cell, header)) {
        const font = renderer.getFont(
            state,
            run.bold,
            run.italic,
            run.monospace,
            header ? "table_header" : "table_body"
        );
        for (const token of renderer.tokenizeInlineText(run.text)) {
            if (token.kind === "newline") {
                flushWord();
                advance();
            } else if (token.kind === "space") {
                flushWord();
                space = {
                    text: " ",
                    font,
                    width: measureTextWidth(" ", font, fontSize),
                    run
                };
            } else {
                word.push({
                    text: token.text,
                    font,
                    width: measureTextWidth(token.text, font, fontSize),
                    run
                });
            }
        }
    }
    flushWord();
    lines.push(line);
    return lines;
}

/** @param {PdfRenderer} renderer @param {PdfBuildState} state @param {CellLine} line @param {number} fontSize @returns {{ascent: number; descent: number}} */
export function tableLineInk(renderer, state, line, fontSize) {
    let ascent = 0;
    let descent = 0;
    for (const fragment of line.fragments) {
        const ink = renderer.measureTextInk(
            state,
            fragment.text,
            fragment.font,
            fontSize
        );
        ascent = Math.max(ascent, ink.ascent);
        descent = Math.max(descent, ink.descent);
    }
    return { ascent, descent };
}

/** @param {PdfRenderer} renderer @param {PdfBuildState} state @param {CellLine} line @param {number} x @param {number} y @param {number} fontSize @returns {void} */
export function renderTableCellLine(renderer, state, line, x, y, fontSize) {
    for (const fragment of line.fragments) {
        renderer.renderInlineToken(
            state,
            fragment.text,
            x,
            y,
            fontSize,
            fragment.font,
            fragment.run
        );
        const href = fragment.run.linkHref;
        if (href && fragment.width > 0) {
            const internal = href.startsWith("#");
            const ink = renderer.measureTextInk(
                state,
                fragment.text,
                fragment.font,
                fontSize
            );
            renderer.addLinkAnnotation(state, {
                type: internal ? "internal" : "external",
                x,
                y: y - Math.max(ink.descent, fontSize * 0.2),
                width: fragment.width,
                height: Math.max(ink.ascent + ink.descent, fontSize),
                url: internal ? undefined : href,
                targetNodeId: internal ? href.slice(1) : undefined
            });
        }
        x += fragment.width;
    }
}
