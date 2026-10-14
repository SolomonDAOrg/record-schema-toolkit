/**
 * @typedef {Object} MarkdownEnvelopeRowConfiguration
 * @property {number} width
 * @property {number} labelWidth
 * @property {number} fontSize
 * @property {number} labelFontSize
 * @property {number} lineSpacing
 * @property {1 | 2 | "auto"} columns
 * @property {number} columnGap
 */
/** @typedef {{ entryIndex: number; offset: number; valueWidth: number; height: number }} MarkdownEnvelopeCell */
/** @typedef {{ cells: MarkdownEnvelopeCell[]; height: number }} MarkdownEnvelopeRow */

/**
 * Consecutive label/value pairs share a row only when both fit on one line in automatic mode.
 * Entries retain source order; an entry that needs more room receives the full row width.
 * @param {number} entryCount
 * @param {MarkdownEnvelopeRowConfiguration} configuration
 * @param {(entryIndex: number, valueWidth: number) => number} measureLines
 * @returns {MarkdownEnvelopeRow[]}
 */
export function layoutMarkdownEnvelopeRows(
    entryCount,
    configuration,
    measureLines
) {
    const {
        width,
        labelWidth,
        fontSize,
        labelFontSize,
        lineSpacing,
        columns,
        columnGap
    } = configuration;
    if (columns !== 1 && columns !== 2 && columns !== "auto")
        throw new Error("Markdown envelope columns must be 1, 2 or auto.");
    if (!Number.isFinite(columnGap) || columnGap < 0)
        throw new Error("Markdown envelope column gap must be non-negative.");
    const fullValueWidth = width - labelWidth;
    const columnWidth = (width - columnGap) / 2;
    const pairedValueWidth = columnWidth - labelWidth;
    const minimumValueWidth = fontSize * 8;
    if (
        fullValueWidth < minimumValueWidth ||
        (columns === 2 && pairedValueWidth < minimumValueWidth)
    )
        throw new Error(
            "Markdown envelope labels leave insufficient width for values."
        );
    /** @type {MarkdownEnvelopeRow[]} */
    const rows = [];
    for (let entryIndex = 0; entryIndex < entryCount; ) {
        const paired =
            columns === 2 ||
            (columns === "auto" &&
                entryIndex + 1 < entryCount &&
                pairedValueWidth >= minimumValueWidth &&
                measureLines(entryIndex, pairedValueWidth) <= 1 &&
                measureLines(entryIndex + 1, pairedValueWidth) <= 1);
        const count = paired ? Math.min(2, entryCount - entryIndex) : 1;
        const valueWidth = paired ? pairedValueWidth : fullValueWidth;
        /** @type {MarkdownEnvelopeCell[]} */
        const cells = [];
        for (let column = 0; column < count; column++) {
            const index = entryIndex + column;
            cells.push({
                entryIndex: index,
                offset: column * (columnWidth + columnGap),
                valueWidth,
                height:
                    Math.max(
                        measureLines(index, valueWidth) * fontSize,
                        labelFontSize
                    ) * lineSpacing
            });
        }
        rows.push({
            cells,
            height: Math.max(...cells.map((cell) => cell.height))
        });
        entryIndex += count;
    }
    return rows;
}
