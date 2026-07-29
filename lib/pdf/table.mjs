/**
 * Table / flowable layout for PDF.
 * Turns column definitions + rows into content-stream operators, with cell text
 * wrapping, alignment, grid borders, header/zebra fills, and automatic page
 * breaks (repeating the header). Zero dependencies, pure ESM.
 *
 * Built on the content-stream builder and the text-layout wrapper, so it uses
 * the same number formatting and font-metric measurement as the rest of the
 * library. Fonts are referenced by resource name (e.g. "F1") for drawing and by
 * base-font name (e.g. "Helvetica") for width measurement.
 * @module Table
 */

import { PdfContentStreamBuilder } from "./content-stream.mjs";
import { layoutPlainText } from "./text-layout.mjs";
import { measureTextWidth } from "./document.mjs";

// ============================================================================
// Type Definitions (JSDoc)
// ============================================================================

/**
 * @typedef {Object} TableColumn
 * @property {number | "*"} [width] - fixed points, or "*" to share leftover width (default "*")
 * @property {string} [header] - header cell text (a header row is drawn if any column sets one)
 * @property {"left" | "right" | "center"} [align] - body alignment (default "left")
 * @property {"left" | "right" | "center"} [headerAlign] - header alignment (default = align)
 */

/**
 * @typedef {Object} TableFont
 * @property {string} resource - PDF font resource name used for drawing (e.g. "F1")
 * @property {number} size - size in points
 * @property {string} [baseFont] - base font for width measurement (default "Helvetica")
 */

/**
 * @typedef {Object} TableStyle
 * @property {TableFont} [font] - body font (default { resource:"F1", size:10, baseFont:"Helvetica" })
 * @property {TableFont} [headerFont] - header font (default body, base "Helvetica-Bold")
 * @property {number} [cellPaddingX] - horizontal cell padding (default 4)
 * @property {number} [cellPaddingY] - vertical cell padding (default 3)
 * @property {number} [lineHeight] - line spacing multiple of size (default 1.2)
 * @property {number} [borderWidth] - grid line width, 0 disables borders (default 0.5)
 * @property {number} [borderGray] - grid gray 0..1 (default 0)
 * @property {number} [headerFill] - header background gray 0..1 (default: none)
 * @property {number} [rowFill] - background gray for odd body rows / zebra 0..1 (default: none)
 * @property {number} [textGray] - text gray 0..1 (default 0)
 */

/**
 * @typedef {Object} TableSpec
 * @property {TableColumn[]} columns
 * @property {string[][]} rows - each row is an array of cell strings (one per column)
 * @property {number} width - total table width in points
 * @property {number} x - left edge
 * @property {number} top - top edge; rows flow downward from here
 * @property {number} [bottom] - lowest Y content may reach before a page break; omit for a single page
 * @property {boolean} [repeatHeader=true] - repeat the header row on every page
 * @property {TableStyle} [style]
 */

/**
 * @typedef {Object} TableLayout
 * @property {string[]} pages - content-stream operators, one string per page
 * @property {number[]} columnWidths - resolved column widths in points
 * @property {number} rowCount - number of body rows laid out
 */

// ============================================================================
// Internal helpers
// ============================================================================

const DEFAULT_FONT = { resource: "F1", size: 10, baseFont: "Helvetica" };

/**
 * @param {TableFont | undefined} font
 * @param {string} defaultBase
 * @returns {Required<TableFont>}
 */
function resolveFont(font, defaultBase) {
    /** @type {Partial<TableFont>} */
    const f = font || {};
    return {
        resource: f.resource !== undefined ? f.resource : DEFAULT_FONT.resource,
        size: f.size !== undefined ? f.size : DEFAULT_FONT.size,
        baseFont: f.baseFont !== undefined ? f.baseFont : defaultBase
    };
}

/**
 * Resolve fixed and flexible ("*") column widths to fit the total width.
 * @param {TableColumn[]} columns
 * @param {number} totalWidth
 * @returns {number[]}
 */
function resolveColumnWidths(columns, totalWidth) {
    let fixedSum = 0;
    let starCount = 0;
    for (let i = 0, len = columns.length; i < len; i++) {
        const w = columns[i].width;
        if (w === undefined || w === "*") {
            starCount = starCount + 1;
        } else {
            fixedSum = fixedSum + w;
        }
    }

    /** @type {number[]} */
    const widths = new Array(columns.length);

    if (starCount > 0) {
        const leftover = Math.max(0, totalWidth - fixedSum);
        const starWidth = leftover / starCount;
        for (let i = 0, len = columns.length; i < len; i++) {
            const w = columns[i].width;
            widths[i] = w === undefined || w === "*" ? starWidth : w;
        }
    } else if (fixedSum > totalWidth && fixedSum > 0) {
        // Overflowing fixed widths: scale them down proportionally to fit.
        const scale = totalWidth / fixedSum;
        for (let i = 0, len = columns.length; i < len; i++) {
            widths[i] = /** @type {number} */ (columns[i].width) * scale;
        }
    } else {
        for (let i = 0, len = columns.length; i < len; i++) {
            widths[i] = /** @type {number} */ (columns[i].width);
        }
        // Give any remaining width to the last column so borders align.
        if (columns.length > 0 && fixedSum < totalWidth) {
            widths[columns.length - 1] =
                widths[columns.length - 1] + (totalWidth - fixedSum);
        }
    }

    for (let i = 0, len = widths.length; i < len; i++) {
        widths[i] = Math.max(1, widths[i]);
    }
    return widths;
}

/**
 * Wrap one cell's text to an inner width, preserving explicit newlines.
 * @param {string} text
 * @param {number} innerWidth
 * @param {string} baseFont
 * @param {number} size
 * @param {number} lineHeight
 * @returns {string[]}
 */
function wrapCell(text, innerWidth, baseFont, size, lineHeight) {
    const segments = String(
        text === undefined || text === null ? "" : text
    ).split("\n");
    /** @type {string[]} */
    const out = [];
    for (let i = 0, len = segments.length; i < len; i++) {
        const seg = segments[i];
        if (seg.trim().length === 0) {
            out.push("");
            continue;
        }
        const wrapped = layoutPlainText(
            seg,
            Math.max(1, innerWidth),
            baseFont,
            size,
            lineHeight
        );
        if (wrapped.lines.length === 0) {
            out.push("");
        } else {
            for (let j = 0, jlen = wrapped.lines.length; j < jlen; j++) {
                out.push(wrapped.lines[j]);
            }
        }
    }
    return out;
}

/**
 * Compute a row's height and the wrapped lines for each cell.
 * @param {string[]} cells
 * @param {number[]} colWidths
 * @param {Required<TableFont>} font
 * @param {number} padX
 * @param {number} padY
 * @param {number} lineHeight
 * @returns {{ height: number; cellLines: string[][] }}
 */
function measureRow(cells, colWidths, font, padX, padY, lineHeight) {
    /** @type {string[][]} */
    const cellLines = [];
    let maxLines = 1;
    for (let i = 0, len = colWidths.length; i < len; i++) {
        const text = cells[i] !== undefined ? cells[i] : "";
        const lines = wrapCell(
            text,
            colWidths[i] - 2 * padX,
            font.baseFont,
            font.size,
            lineHeight
        );
        const n = Math.max(1, lines.length);
        if (n > maxLines) {
            maxLines = n;
        }
        cellLines.push(lines);
    }
    return { height: maxLines * lineHeight + 2 * padY, cellLines };
}

/**
 * Draw a single row (optional background fill + aligned wrapped text).
 * @param {PdfContentStreamBuilder} b
 * @param {string[][]} cellLines
 * @param {number[]} colWidths
 * @param {number} tableX
 * @param {number} rowTop
 * @param {number} rowHeight
 * @param {number} tableWidth
 * @param {("left" | "right" | "center")[]} aligns
 * @param {Required<TableFont>} font
 * @param {number} padX
 * @param {number} padY
 * @param {number} lineHeight
 * @param {number} textGray
 * @param {number | undefined} fillGray
 * @returns {void}
 */
function drawRow(
    b,
    cellLines,
    colWidths,
    tableX,
    rowTop,
    rowHeight,
    tableWidth,
    aligns,
    font,
    padX,
    padY,
    lineHeight,
    textGray,
    fillGray
) {
    if (fillGray !== undefined) {
        b.setFillGray(fillGray);
        b.rectangle(tableX, rowTop - rowHeight, tableWidth, rowHeight);
        b.fill();
    }

    b.setFillGray(textGray);
    const ascent = font.size * 0.8;
    let cellLeft = tableX;
    for (let i = 0, len = colWidths.length; i < len; i++) {
        const colWidth = colWidths[i];
        const lines = cellLines[i];
        const align = aligns[i];
        b.beginText();
        b.setFont(font.resource, font.size);
        for (let j = 0, jlen = lines.length; j < jlen; j++) {
            const line = lines[j];
            if (line.length === 0) {
                continue;
            }
            const baseline = rowTop - padY - ascent - j * lineHeight;
            let textX = cellLeft + padX;
            if (align === "right" || align === "center") {
                const w = measureTextWidth(line, font.baseFont, font.size);
                textX =
                    align === "right"
                        ? cellLeft + colWidth - padX - w
                        : cellLeft + (colWidth - w) / 2;
            }
            b.setTextMatrix(1, 0, 0, 1, textX, baseline);
            b.showText(line);
        }
        b.endText();
        cellLeft = cellLeft + colWidth;
    }
}

/**
 * Stroke the grid: horizontal lines at each supplied boundary Y and vertical
 * lines at each column boundary, spanning top..bottom.
 * @param {PdfContentStreamBuilder} b
 * @param {number[]} colWidths
 * @param {number} tableX
 * @param {number} tableWidth
 * @param {number[]} boundaryYs - descending list of row-boundary Y values (top first, bottom last)
 * @param {number} borderWidth
 * @param {number} borderGray
 * @returns {void}
 */
function strokeGrid(
    b,
    colWidths,
    tableX,
    tableWidth,
    boundaryYs,
    borderWidth,
    borderGray
) {
    if (borderWidth <= 0 || boundaryYs.length < 2) {
        return;
    }
    const top = boundaryYs[0];
    const bottom = boundaryYs[boundaryYs.length - 1];

    b.setLineWidth(borderWidth);
    b.setStrokeGray(borderGray);

    for (let i = 0, len = boundaryYs.length; i < len; i++) {
        b.moveTo(tableX, boundaryYs[i]);
        b.lineTo(tableX + tableWidth, boundaryYs[i]);
    }

    let x = tableX;
    b.moveTo(x, top);
    b.lineTo(x, bottom);
    for (let i = 0, len = colWidths.length; i < len; i++) {
        x = x + colWidths[i];
        b.moveTo(x, top);
        b.lineTo(x, bottom);
    }

    b.stroke();
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Lay out a table into one or more pages of content-stream operators.
 *
 * With `bottom` set, rows that would cross it move to a new page (the header is
 * repeated unless `repeatHeader` is false); without `bottom`, everything is
 * placed on a single page. The returned strings are ready for
 * PdfDocumentBuilder#addPageFromString (one page each) or can be concatenated
 * into a larger page's content.
 * @param {TableSpec} spec
 * @returns {TableLayout}
 */
export function layoutTable(spec) {
    const style = spec.style || {};
    const font = resolveFont(style.font, "Helvetica");
    const headerFont = resolveFont(style.headerFont, "Helvetica-Bold");
    const padX = style.cellPaddingX !== undefined ? style.cellPaddingX : 4;
    const padY = style.cellPaddingY !== undefined ? style.cellPaddingY : 3;
    const lineHeight =
        (style.lineHeight !== undefined ? style.lineHeight : 1.2) * font.size;
    const headerLineHeight =
        (style.lineHeight !== undefined ? style.lineHeight : 1.2) *
        headerFont.size;
    const borderWidth =
        style.borderWidth !== undefined ? style.borderWidth : 0.5;
    const borderGray = style.borderGray !== undefined ? style.borderGray : 0;
    const textGray = style.textGray !== undefined ? style.textGray : 0;
    const repeatHeader = spec.repeatHeader !== false;

    const columns = spec.columns;
    const colWidths = resolveColumnWidths(columns, spec.width);

    /** @type {("left" | "right" | "center")[]} */
    const bodyAligns = columns.map((c) => c.align || "left");
    /** @type {("left" | "right" | "center")[]} */
    const headerAligns = columns.map((c) => c.headerAlign || c.align || "left");

    // Header row (only if any column declares a header).
    const hasHeader = columns.some((c) => c.header !== undefined);
    /** @type {string[]} */
    const headerCells = columns.map((c) => c.header || "");
    const headerMeasured = hasHeader
        ? measureRow(
              headerCells,
              colWidths,
              headerFont,
              padX,
              padY,
              headerLineHeight
          )
        : null;

    // Pre-measure body rows.
    /** @type {{ height: number; cellLines: string[][] }[]} */
    const rowMeasures = [];
    for (let i = 0, len = spec.rows.length; i < len; i++) {
        rowMeasures.push(
            measureRow(spec.rows[i], colWidths, font, padX, padY, lineHeight)
        );
    }

    const paginate = spec.bottom !== undefined;
    const bottomLimit = paginate
        ? /** @type {number} */ (spec.bottom)
        : -Infinity;

    /** @type {string[]} */
    const pages = [];
    let i = 0;
    let firstPage = true;

    do {
        const b = new PdfContentStreamBuilder();
        let y = spec.top;
        /** @type {number[]} */
        const boundaryYs = [y];

        // Header on this page.
        if (headerMeasured && (firstPage || repeatHeader)) {
            drawRow(
                b,
                headerMeasured.cellLines,
                colWidths,
                spec.x,
                y,
                headerMeasured.height,
                spec.width,
                headerAligns,
                headerFont,
                padX,
                padY,
                headerLineHeight,
                textGray,
                style.headerFill
            );
            y = y - headerMeasured.height;
            boundaryYs.push(y);
        }

        let drewOnPage = 0;
        while (i < rowMeasures.length) {
            const rm = rowMeasures[i];
            if (paginate && drewOnPage > 0 && y - rm.height < bottomLimit) {
                break;
            }
            const zebra =
                style.rowFill !== undefined && i % 2 === 1
                    ? style.rowFill
                    : undefined;
            drawRow(
                b,
                rm.cellLines,
                colWidths,
                spec.x,
                y,
                rm.height,
                spec.width,
                bodyAligns,
                font,
                padX,
                padY,
                lineHeight,
                textGray,
                zebra
            );
            y = y - rm.height;
            boundaryYs.push(y);
            i = i + 1;
            drewOnPage = drewOnPage + 1;
        }

        strokeGrid(
            b,
            colWidths,
            spec.x,
            spec.width,
            boundaryYs,
            borderWidth,
            borderGray
        );

        pages.push(b.build());
        firstPage = false;
    } while (i < rowMeasures.length);

    return { pages, columnWidths: colWidths, rowCount: spec.rows.length };
}

export default { layoutTable };
