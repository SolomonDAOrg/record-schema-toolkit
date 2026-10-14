/**
 * Deciding where a field's value sits inside its widget.
 *
 * This is the arithmetic an appearance stream needs and nothing else: the font
 * size when /DA asked for automatic sizing, the break points when the field is
 * multiline, the cell positions when it is a comb, and the baseline and start
 * offset that put a line where the field's quadding says it belongs. Keeping it
 * apart from stream emission means the placement can be checked as numbers
 * rather than by reading operators out of a stream.
 *
 * Coordinates are relative to the widget's bounding box, whose origin is its
 * lower-left corner, and the box is inset on every side so that a value does
 * not collide with the widget's own border.
 * @module AppearanceLayout
 */

import { measureFormText } from "./font-resource.mjs";

/** Inset applied on each side of the widget rectangle, in text-space units. */
export const PADDING = 2;

/**
 * Leading as a multiple of font size. The font dictionary carries no line gap,
 * so multiline fields need a stated figure; this is the spacing viewers apply
 * to form text.
 */
const LINE_HEIGHT_FACTOR = 1.15;

/** Largest size automatic sizing will choose. */
const AUTO_SIZE_MAXIMUM = 12;

/** Smallest size automatic sizing will choose before giving up on fitting. */
const AUTO_SIZE_MINIMUM = 4;

/** Step by which automatic sizing searches downward. */
const AUTO_SIZE_STEP = 0.25;

/**
 * @typedef {import("./font-resource.mjs").FormFont} FormFont
 */

/**
 * @typedef {Object} PlacedLine
 * @property {string} text
 * @property {number} x - Offset of the line's start from the box's left edge.
 * @property {number} y - Baseline offset from the box's bottom edge.
 */

/**
 * @typedef {Object} TextLayout
 * @property {number} fontSize - The size actually used, never 0.
 * @property {PlacedLine[]} lines
 */

/**
 * The height one line occupies at a given size.
 * @param {number} fontSize
 * @returns {number}
 */
export function lineHeight(fontSize) {
    return fontSize * LINE_HEIGHT_FACTOR;
}

/**
 * Baseline offset that centres a single line of text in a box.
 * @param {FormFont | null} font
 * @param {number} boxHeight
 * @param {number} fontSize
 * @returns {number}
 */
export function centredBaseline(font, boxHeight, fontSize) {
    const ascent = font === null ? 718 : font.ascent;
    const descent = font === null ? -207 : font.descent;
    const glyphHeight = ((ascent - descent) * fontSize) / 1000;
    return (boxHeight - glyphHeight) / 2 + (-descent * fontSize) / 1000;
}

/**
 * Offset of a line's start under a quadding value: 0 left, 1 centred, 2 right.
 * An unrecognised quadding is treated as left, which is the default the format
 * gives /Q.
 * @param {number} boxWidth
 * @param {number} textWidth
 * @param {number | null} quadding
 * @returns {number}
 */
export function alignmentOffset(boxWidth, textWidth, quadding) {
    if (quadding === 1) {
        return (boxWidth - textWidth) / 2;
    }
    if (quadding === 2) {
        return boxWidth - textWidth;
    }
    return 0;
}

/**
 * Break text into lines that fit `boxWidth`.
 *
 * Explicit line breaks in the value are honoured. A single word longer than the
 * box is split at the character that overflows rather than being left to run
 * past the edge, because the appearance is clipped and the remainder would
 * otherwise disappear silently.
 * @param {FormFont | null} font
 * @param {string} text
 * @param {number} fontSize
 * @param {number} boxWidth
 * @returns {string[]}
 */
export function wrapText(font, text, fontSize, boxWidth) {
    /** @type {string[]} */
    const lines = [];
    const paragraphs = text.split(/\r\n|\r|\n/);
    for (let p = 0, count = paragraphs.length; p < count; p++) {
        const words = paragraphs[p].split(" ");
        let current = "";
        for (let w = 0, total = words.length; w < total; w++) {
            const candidate =
                current.length === 0 ? words[w] : current + " " + words[w];
            if (measureFormText(font, candidate, fontSize) <= boxWidth) {
                current = candidate;
                continue;
            }
            if (current.length > 0) {
                lines.push(current);
                current = "";
            }
            let remainder = words[w];
            while (
                measureFormText(font, remainder, fontSize) > boxWidth &&
                remainder.length > 1
            ) {
                let cut = remainder.length - 1;
                while (
                    cut > 1 &&
                    measureFormText(font, remainder.slice(0, cut), fontSize) >
                        boxWidth
                ) {
                    cut = cut - 1;
                }
                lines.push(remainder.slice(0, cut));
                remainder = remainder.slice(cut);
            }
            current = remainder;
        }
        lines.push(current);
    }
    return lines;
}

/**
 * Lay out a single-line text value.
 * @param {FormFont | null} font
 * @param {string} text
 * @param {number} requestedSize - /DA size; 0 selects automatic sizing.
 * @param {number} boxWidth
 * @param {number} boxHeight
 * @param {number | null} quadding
 * @returns {TextLayout}
 */
export function layoutSingleLine(
    font,
    text,
    requestedSize,
    boxWidth,
    boxHeight,
    quadding
) {
    const innerWidth = boxWidth - PADDING * 2;
    const innerHeight = boxHeight - PADDING * 2;
    const fontSize =
        requestedSize > 0
            ? requestedSize
            : autoSizeSingleLine(font, text, innerWidth, innerHeight);
    const textWidth = measureFormText(font, text, fontSize);
    return {
        fontSize,
        lines: [
            {
                text,
                x: PADDING + alignmentOffset(innerWidth, textWidth, quadding),
                y: centredBaseline(font, boxHeight, fontSize)
            }
        ]
    };
}

/**
 * The largest size at or below the automatic-sizing cap at which `text` fits
 * the box on one line. Falls back to the minimum when nothing fits, so an
 * over-long value is drawn small and clipped rather than not drawn.
 * @param {FormFont | null} font
 * @param {string} text
 * @param {number} innerWidth
 * @param {number} innerHeight
 * @returns {number}
 */
function autoSizeSingleLine(font, text, innerWidth, innerHeight) {
    const ascent = font === null ? 718 : font.ascent;
    const descent = font === null ? -207 : font.descent;
    const heightLimit = (innerHeight * 1000) / (ascent - descent);
    let size = Math.min(AUTO_SIZE_MAXIMUM, heightLimit);
    if (text.length === 0) {
        return Math.max(size, AUTO_SIZE_MINIMUM);
    }
    while (
        size > AUTO_SIZE_MINIMUM &&
        measureFormText(font, text, size) > innerWidth
    ) {
        size = size - AUTO_SIZE_STEP;
    }
    return Math.max(size, AUTO_SIZE_MINIMUM);
}

/**
 * Lay out a multiline text value, top-aligned as viewers render one.
 * @param {FormFont | null} font
 * @param {string} text
 * @param {number} requestedSize - /DA size; 0 selects automatic sizing.
 * @param {number} boxWidth
 * @param {number} boxHeight
 * @param {number | null} quadding
 * @returns {TextLayout}
 */
export function layoutMultiLine(
    font,
    text,
    requestedSize,
    boxWidth,
    boxHeight,
    quadding
) {
    const innerWidth = boxWidth - PADDING * 2;
    const innerHeight = boxHeight - PADDING * 2;

    let fontSize = requestedSize > 0 ? requestedSize : AUTO_SIZE_MAXIMUM;
    let lines = wrapText(font, text, fontSize, innerWidth);
    if (requestedSize === 0) {
        while (
            fontSize > AUTO_SIZE_MINIMUM &&
            lines.length * lineHeight(fontSize) > innerHeight
        ) {
            fontSize = fontSize - AUTO_SIZE_STEP;
            lines = wrapText(font, text, fontSize, innerWidth);
        }
    }

    const ascent = font === null ? 718 : font.ascent;
    const step = lineHeight(fontSize);
    const firstBaseline = boxHeight - PADDING - (ascent * fontSize) / 1000;

    /** @type {PlacedLine[]} */
    const placed = [];
    for (let i = 0, len = lines.length; i < len; i++) {
        const width = measureFormText(font, lines[i], fontSize);
        placed.push({
            text: lines[i],
            x: PADDING + alignmentOffset(innerWidth, width, quadding),
            y: firstBaseline - i * step
        });
    }
    return { fontSize, lines: placed };
}

/**
 * Lay out a comb field: `cellCount` equal cells across the full box width, one
 * character centred in each. Characters beyond the cell count are dropped,
 * which is what the /MaxLen that defines the comb requires.
 * @param {FormFont | null} font
 * @param {string} text
 * @param {number} requestedSize - /DA size; 0 selects automatic sizing.
 * @param {number} boxWidth
 * @param {number} boxHeight
 * @param {number} cellCount
 * @returns {TextLayout}
 */
export function layoutComb(
    font,
    text,
    requestedSize,
    boxWidth,
    boxHeight,
    cellCount
) {
    const cellWidth = boxWidth / cellCount;
    const innerHeight = boxHeight - PADDING * 2;
    const fontSize =
        requestedSize > 0
            ? requestedSize
            : autoSizeSingleLine(font, "M", cellWidth, innerHeight);
    const baseline = centredBaseline(font, boxHeight, fontSize);

    /** @type {PlacedLine[]} */
    const placed = [];
    const characters = [...text].slice(0, cellCount);
    for (let i = 0, len = characters.length; i < len; i++) {
        const width = measureFormText(font, characters[i], fontSize);
        placed.push({
            text: characters[i],
            x: i * cellWidth + (cellWidth - width) / 2,
            y: baseline
        });
    }
    return { fontSize, lines: placed };
}

export default {
    PADDING,
    lineHeight,
    centredBaseline,
    alignmentOffset,
    wrapText,
    layoutSingleLine,
    layoutMultiLine,
    layoutComb
};
