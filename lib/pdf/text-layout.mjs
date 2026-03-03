/**
 * PDF Text Layout Engine - Word wrapping and text flow
 * Zero dependencies, pure ESM
 * @module PdfTextLayout
 */

import { measureTextWidth } from "./document.mjs";

// ============================================================================
// Type Definitions (JSDoc)
// ============================================================================

/**
 * @typedef {"normal" | "bold" | "italic" | "bolditalic" | "code"} FontStyle
 */

/**
 * @typedef {Object} TextSpan
 * @property {string} text
 * @property {FontStyle} style
 * @property {number} [fontSize]
 */

/**
 * @typedef {Object} LayoutLine
 * @property {TextSpan[]} spans
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} TextLayoutOptions
 * @property {number} maxWidth
 * @property {number} fontSize
 * @property {number} lineHeight
 * @property {string} fontFamily - Base font family (e.g., "Helvetica")
 */

/**
 * @typedef {Object} LayoutResult
 * @property {LayoutLine[]} lines
 * @property {number} totalHeight
 */

/**
 * @typedef {Object} WrappedTextResult
 * @property {string[]} lines
 * @property {number} totalHeight
 */

// ============================================================================
// Font Style Mapping
// ============================================================================

/**
 * Get PDF font name for style
 * @param {string} fontFamily
 * @param {FontStyle} style
 * @returns {string}
 */
export function getFontForStyle(fontFamily, style) {
    if (style === "code") {
        return "Courier";
    }
    if (fontFamily === "Helvetica") {
        if (style === "bold") {
            return "Helvetica-Bold";
        }
        if (style === "italic") {
            return "Helvetica-Oblique";
        }
        if (style === "bolditalic") {
            return "Helvetica-BoldOblique";
        }
        return "Helvetica";
    }
    if (fontFamily === "Courier") {
        if (style === "bold") {
            return "Courier-Bold";
        }
        if (style === "italic") {
            return "Courier-Oblique";
        }
        if (style === "bolditalic") {
            return "Courier-BoldOblique";
        }
        return "Courier";
    }
    if (fontFamily === "Times") {
        if (style === "bold") {
            return "Times-Bold";
        }
        if (style === "italic") {
            return "Times-Italic";
        }
        if (style === "bolditalic") {
            return "Times-BoldItalic";
        }
        return "Times-Roman";
    }
    return fontFamily;
}

// ============================================================================
// Text Tokenization
// ============================================================================

/**
 * @typedef {Object} TextToken
 * @property {string} text
 * @property {FontStyle} style
 * @property {number} fontSize
 * @property {boolean} isWhitespace
 * @property {boolean} isNewline
 */

/**
 * Tokenize text into words and whitespace
 * @param {TextSpan[]} spans
 * @param {number} defaultFontSize
 * @returns {TextToken[]}
 */
export function tokenizeSpans(spans, defaultFontSize) {
    /** @type {TextToken[]} */
    const tokens = [];

    for (let i = 0, len = spans.length; i < len; i++) {
        const span = spans[i];
        const text = span.text;
        const style = span.style;
        const fontSize =
            span.fontSize !== undefined ? span.fontSize : defaultFontSize;

        let pos = 0;
        const textLen = text.length;

        while (pos < textLen) {
            const ch = text.charCodeAt(pos);

            // Check for newline
            if (ch === 10 || ch === 13) {
                tokens.push({
                    text: "\n",
                    style,
                    fontSize,
                    isWhitespace: true,
                    isNewline: true
                });
                pos = pos + 1;
                // Handle CRLF
                if (ch === 13 && pos < textLen && text.charCodeAt(pos) === 10) {
                    pos = pos + 1;
                }
                continue;
            }

            // Check for whitespace
            if (ch === 32 || ch === 9) {
                let wsEnd = pos + 1;
                while (wsEnd < textLen) {
                    const wc = text.charCodeAt(wsEnd);
                    if (wc !== 32 && wc !== 9) {
                        break;
                    }
                    wsEnd = wsEnd + 1;
                }
                tokens.push({
                    text: text.slice(pos, wsEnd),
                    style,
                    fontSize,
                    isWhitespace: true,
                    isNewline: false
                });
                pos = wsEnd;
                continue;
            }

            // Word
            let wordEnd = pos + 1;
            while (wordEnd < textLen) {
                const wc = text.charCodeAt(wordEnd);
                if (wc === 32 || wc === 9 || wc === 10 || wc === 13) {
                    break;
                }
                wordEnd = wordEnd + 1;
            }
            tokens.push({
                text: text.slice(pos, wordEnd),
                style,
                fontSize,
                isWhitespace: false,
                isNewline: false
            });
            pos = wordEnd;
        }
    }

    return tokens;
}

// ============================================================================
// Text Layout
// ============================================================================

/**
 * Layout text spans into lines with word wrapping
 * @param {TextSpan[]} spans
 * @param {TextLayoutOptions} options
 * @returns {LayoutResult}
 */
export function layoutText(spans, options) {
    const { maxWidth, fontSize, lineHeight, fontFamily } = options;
    const tokens = tokenizeSpans(spans, fontSize);

    /** @type {LayoutLine[]} */
    const lines = [];
    /** @type {TextSpan[]} */
    let currentLineSpans = [];
    let currentLineWidth = 0;
    let currentLineHeight = lineHeight;

    /**
     * Finalize current line
     */
    const finishLine = () => {
        if (currentLineSpans.length > 0) {
            // Trim trailing whitespace from line
            while (currentLineSpans.length > 0) {
                const last = currentLineSpans[currentLineSpans.length - 1];
                if (last.text.trim().length === 0) {
                    currentLineSpans.pop();
                } else {
                    break;
                }
            }
            if (currentLineSpans.length > 0) {
                // Recalculate width without trailing whitespace
                let width = 0;
                for (let i = 0, len = currentLineSpans.length; i < len; i++) {
                    const span = currentLineSpans[i];
                    const font = getFontForStyle(fontFamily, span.style);
                    const spanFontSize =
                        span.fontSize !== undefined ? span.fontSize : fontSize;
                    width =
                        width + measureTextWidth(span.text, font, spanFontSize);
                }
                lines.push({
                    spans: currentLineSpans,
                    width,
                    height: currentLineHeight
                });
            }
        }
        currentLineSpans = [];
        currentLineWidth = 0;
        currentLineHeight = lineHeight;
    };

    for (let i = 0, len = tokens.length; i < len; i++) {
        const token = tokens[i];

        if (token.isNewline) {
            finishLine();
            continue;
        }

        const font = getFontForStyle(fontFamily, token.style);
        const tokenWidth = measureTextWidth(token.text, font, token.fontSize);

        // Skip leading whitespace at start of line
        if (token.isWhitespace && currentLineSpans.length === 0) {
            continue;
        }

        // Check if token fits
        if (
            currentLineWidth + tokenWidth <= maxWidth ||
            currentLineSpans.length === 0
        ) {
            // Fits or first word on line (must include even if too long)
            currentLineSpans.push({
                text: token.text,
                style: token.style,
                fontSize: token.fontSize
            });
            currentLineWidth = currentLineWidth + tokenWidth;
        } else {
            // Doesn't fit - start new line
            finishLine();

            // Skip whitespace at start of new line
            if (!token.isWhitespace) {
                currentLineSpans.push({
                    text: token.text,
                    style: token.style,
                    fontSize: token.fontSize
                });
                currentLineWidth = tokenWidth;
            }
        }
    }

    // Finish last line
    finishLine();

    // Calculate total height
    let totalHeight = 0;
    for (let i = 0, len = lines.length; i < len; i++) {
        totalHeight = totalHeight + lines[i].height;
    }

    return { lines, totalHeight };
}

// ============================================================================
// Simple Text Layout (single style)
// ============================================================================

/**
 * Layout plain text with word wrapping
 * Collapses all whitespace (including newlines) into single spaces for proper paragraph flow
 * @param {string} text
 * @param {number} maxWidth
 * @param {string} font
 * @param {number} fontSize
 * @param {number} lineHeight
 * @returns {WrappedTextResult}
 */
export function layoutPlainText(text, maxWidth, font, fontSize, lineHeight) {
    // Handle empty text
    if (text.length === 0) {
        return { lines: [], totalHeight: 0 };
    }

    // Collapse all whitespace (including newlines) into single spaces
    // This is the standard behavior for paragraph text flow
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
        return { lines: [], totalHeight: 0 };
    }

    /** @type {string[]} */
    const lines = [];
    let currentLine = "";
    let currentWidth = 0;
    const spaceWidth = measureTextWidth(" ", font, fontSize);

    for (let i = 0, len = words.length; i < len; i++) {
        const word = words[i];
        const wordWidth = measureTextWidth(word, font, fontSize);

        if (currentLine.length === 0) {
            // First word on line - check if it needs breaking
            if (wordWidth > maxWidth) {
                const parts = breakLongWord(word, maxWidth, font, fontSize);
                for (let j = 0, jlen = parts.length; j < jlen; j++) {
                    if (j === jlen - 1) {
                        // Last part becomes start of current line
                        currentLine = parts[j];
                        currentWidth = measureTextWidth(
                            parts[j],
                            font,
                            fontSize
                        );
                    } else {
                        lines.push(parts[j]);
                    }
                }
            } else {
                currentLine = word;
                currentWidth = wordWidth;
            }
        } else if (currentWidth + spaceWidth + wordWidth <= maxWidth) {
            currentLine = currentLine + " " + word;
            currentWidth = currentWidth + spaceWidth + wordWidth;
        } else {
            // Word doesn't fit - wrap
            lines.push(currentLine);

            // Check if new word needs breaking
            if (wordWidth > maxWidth) {
                const parts = breakLongWord(word, maxWidth, font, fontSize);
                for (let j = 0, jlen = parts.length; j < jlen; j++) {
                    if (j === jlen - 1) {
                        currentLine = parts[j];
                        currentWidth = measureTextWidth(
                            parts[j],
                            font,
                            fontSize
                        );
                    } else {
                        lines.push(parts[j]);
                    }
                }
            } else {
                currentLine = word;
                currentWidth = wordWidth;
            }
        }
    }

    if (currentLine.length > 0) {
        lines.push(currentLine);
    }

    return {
        lines,
        totalHeight: lines.length * lineHeight
    };
}

/**
 * Break a long word that doesn't fit on a line
 * @param {string} word
 * @param {number} maxWidth
 * @param {string} font
 * @param {number} fontSize
 * @returns {string[]}
 */
export function breakLongWord(word, maxWidth, font, fontSize) {
    /** @type {string[]} */
    const parts = [];
    let current = "";
    let currentWidth = 0;

    for (let i = 0, len = word.length; i < len; i++) {
        const ch = word.charAt(i);
        const charWidth = measureTextWidth(ch, font, fontSize);

        if (currentWidth + charWidth <= maxWidth || current.length === 0) {
            current = current + ch;
            currentWidth = currentWidth + charWidth;
        } else {
            parts.push(current);
            current = ch;
            currentWidth = charWidth;
        }
    }

    if (current.length > 0) {
        parts.push(current);
    }

    return parts;
}

/**
 * Wrap text for a title that might be too long
 * Centers each line individually
 * @param {string} text
 * @param {number} maxWidth
 * @param {string} font
 * @param {number} fontSize
 * @returns {string[]}
 */
export function wrapTitle(text, maxWidth, font, fontSize) {
    const textWidth = measureTextWidth(text, font, fontSize);

    // If it fits, return as-is
    if (textWidth <= maxWidth) {
        return [text];
    }

    // Try to break at natural break points
    /** @type {string[]} */
    const lines = [];
    const words = text.split(/\s+/);

    let currentLine = "";
    let currentWidth = 0;
    const spaceWidth = measureTextWidth(" ", font, fontSize);

    for (let i = 0, len = words.length; i < len; i++) {
        const word = words[i];
        const wordWidth = measureTextWidth(word, font, fontSize);

        if (currentLine.length === 0) {
            currentLine = word;
            currentWidth = wordWidth;
        } else if (currentWidth + spaceWidth + wordWidth <= maxWidth) {
            currentLine = currentLine + " " + word;
            currentWidth = currentWidth + spaceWidth + wordWidth;
        } else {
            lines.push(currentLine);
            currentLine = word;
            currentWidth = wordWidth;
        }
    }

    if (currentLine.length > 0) {
        lines.push(currentLine);
    }

    return lines;
}

// ============================================================================
// Export
// ============================================================================

export default {
    getFontForStyle,
    tokenizeSpans,
    layoutText,
    layoutPlainText,
    breakLongWord,
    wrapTitle
};
