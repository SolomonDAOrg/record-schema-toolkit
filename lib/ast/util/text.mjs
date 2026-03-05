// =============================================================================
// Text Measurement Utilities
// =============================================================================

import { TYPOGRAPHY_SUBSTITUTIONS } from "../constants/core.mjs";

/**
 * Approximate character width ratios for common characters
 * Based on typical proportional fonts
 */
const CHAR_WIDTH_RATIOS = {
    narrow: 0.3, // i, l, I, 1, |, etc.
    normal: 0.55, // Most lowercase letters
    wide: 0.7, // m, w, M, W, etc.
    space: 0.25,
    default: 0.55
};

/**
 * Estimate width of a character
 * @param {string} char
 * @param {number} fontSize
 * @returns {number}
 */
function estimateCharWidth(char, fontSize) {
    if (char === " " || char === "\t") {
        return fontSize * CHAR_WIDTH_RATIOS.space;
    }
    if (/[ilI1|!.,;:'`]/.test(char)) {
        return fontSize * CHAR_WIDTH_RATIOS.narrow;
    }
    if (/[mwMWÆŒ@]/.test(char)) {
        return fontSize * CHAR_WIDTH_RATIOS.wide;
    }
    return fontSize * CHAR_WIDTH_RATIOS.default;
}

/**
 * Estimate width of a text string
 * @param {string} text
 * @param {number} fontSize
 * @returns {number}
 */
function estimateTextWidth(text, fontSize) {
    let width = 0;
    for (let i = 0, len = text.length; i < len; i++) {
        width += estimateCharWidth(text[i], fontSize);
    }
    return width;
}

/**
 * Wrap text to fit within maxWidth
 * Respects existing newlines in the text
 * @param {string} text
 * @param {number} maxWidth
 * @param {number} fontSize
 * @returns {string[]}
 */
function wrapText(text, maxWidth, fontSize) {
    // Split on existing newlines first
    const inputLines = text.split(/\n/);
    /** @type {string[]} */
    const outputLines = [];

    for (let i = 0, len = inputLines.length; i < len; i++) {
        const line = inputLines[i].trim();
        if (line.length === 0) {
            outputLines.push("");
            continue;
        }

        const lineWidth = estimateTextWidth(line, fontSize);
        if (lineWidth <= maxWidth) {
            outputLines.push(line);
            continue;
        }

        // Need to wrap this line
        const words = line.split(/\s+/);
        let currentLine = "";
        let currentWidth = 0;

        for (let j = 0, jlen = words.length; j < jlen; j++) {
            const word = words[j];
            const wordWidth = estimateTextWidth(word, fontSize);
            const spaceWidth = currentLine
                ? estimateTextWidth(" ", fontSize)
                : 0;

            if (currentWidth + spaceWidth + wordWidth <= maxWidth) {
                currentLine = currentLine ? currentLine + " " + word : word;
                currentWidth += spaceWidth + wordWidth;
            } else {
                // Word doesn't fit, start new line
                if (currentLine) {
                    outputLines.push(currentLine);
                }
                // Handle very long words that exceed maxWidth
                if (wordWidth > maxWidth) {
                    // Break the word
                    let remaining = word;
                    while (remaining.length > 0) {
                        let breakPoint = 0;
                        let accWidth = 0;
                        for (let k = 0; k < remaining.length; k++) {
                            const cw = estimateCharWidth(
                                remaining[k],
                                fontSize
                            );
                            if (accWidth + cw > maxWidth && breakPoint > 0) {
                                break;
                            }
                            accWidth += cw;
                            breakPoint = k + 1;
                        }
                        outputLines.push(remaining.slice(0, breakPoint));
                        remaining = remaining.slice(breakPoint);
                    }
                    currentLine = "";
                    currentWidth = 0;
                } else {
                    currentLine = word;
                    currentWidth = wordWidth;
                }
            }
        }
        if (currentLine) {
            outputLines.push(currentLine);
        }
    }

    return outputLines;
}

// =============================================================================
// Typography
// =============================================================================

/**
 * Apply standard typography substitutions to a string:
 * `---` and `--` → em dash, `->` → right guillemet (»).
 * @param {string} text
 * @returns {string}
 */
function applyTypographySubstitutions(text) {
    for (let i = 0, len = TYPOGRAPHY_SUBSTITUTIONS.length; i < len; i++) {
        text = text.replace(
            TYPOGRAPHY_SUBSTITUTIONS[i][0],
            TYPOGRAPHY_SUBSTITUTIONS[i][1]
        );
    }
    return text;
}

export {
    applyTypographySubstitutions,
    estimateTextWidth,
    estimateCharWidth,
    wrapText
};
