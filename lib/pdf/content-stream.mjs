/**
 * PDF Content Stream Builder - Graphics and text operations
 * Zero dependencies, pure ESM
 * @module PdfContentStream
 */

import { escapePdfString } from "./primitives.mjs";

// ============================================================================
// Type Definitions (JSDoc)
// ============================================================================

/**
 * @typedef {Object} PdfTextState
 * @property {string} font
 * @property {number} fontSize
 * @property {number} leading
 * @property {number} charSpace
 * @property {number} wordSpace
 * @property {number} rise
 */

/**
 * @typedef {Object} PdfGraphicsState
 * @property {number} lineWidth
 * @property {number[]} strokeColor - RGB 0-1
 * @property {number[]} fillColor - RGB 0-1
 */

// ============================================================================
// Content Stream Builder Class
// ============================================================================

export class PdfContentStreamBuilder {
    constructor() {
        /** @type {string[]} */
        this.operations = [];
    }

    // ========================================================================
    // Graphics State
    // ========================================================================

    /**
     * Save graphics state
     * @returns {this}
     */
    saveState() {
        this.operations.push("q");
        return this;
    }

    /**
     * Restore graphics state
     * @returns {this}
     */
    restoreState() {
        this.operations.push("Q");
        return this;
    }

    /**
     * Set line width
     * @param {number} width
     * @returns {this}
     */
    setLineWidth(width) {
        this.operations.push(`${formatNum(width)} w`);
        return this;
    }

    /**
     * Set stroke color (RGB)
     * @param {number} r - 0-1
     * @param {number} g - 0-1
     * @param {number} b - 0-1
     * @returns {this}
     */
    setStrokeColor(r, g, b) {
        this.operations.push(
            `${formatNum(r)} ${formatNum(g)} ${formatNum(b)} RG`
        );
        return this;
    }

    /**
     * Set fill color (RGB)
     * @param {number} r - 0-1
     * @param {number} g - 0-1
     * @param {number} b - 0-1
     * @returns {this}
     */
    setFillColor(r, g, b) {
        this.operations.push(
            `${formatNum(r)} ${formatNum(g)} ${formatNum(b)} rg`
        );
        return this;
    }

    /**
     * Set stroke color (grayscale)
     * @param {number} gray - 0-1
     * @returns {this}
     */
    setStrokeGray(gray) {
        this.operations.push(`${formatNum(gray)} G`);
        return this;
    }

    /**
     * Set fill color (grayscale)
     * @param {number} gray - 0-1
     * @returns {this}
     */
    setFillGray(gray) {
        this.operations.push(`${formatNum(gray)} g`);
        return this;
    }

    // ========================================================================
    // Path Construction
    // ========================================================================

    /**
     * Move to point
     * @param {number} x
     * @param {number} y
     * @returns {this}
     */
    moveTo(x, y) {
        this.operations.push(`${formatNum(x)} ${formatNum(y)} m`);
        return this;
    }

    /**
     * Line to point
     * @param {number} x
     * @param {number} y
     * @returns {this}
     */
    lineTo(x, y) {
        this.operations.push(`${formatNum(x)} ${formatNum(y)} l`);
        return this;
    }

    /**
     * Cubic bezier curve
     * @param {number} x1
     * @param {number} y1
     * @param {number} x2
     * @param {number} y2
     * @param {number} x3
     * @param {number} y3
     * @returns {this}
     */
    curveTo(x1, y1, x2, y2, x3, y3) {
        this.operations.push(
            `${formatNum(x1)} ${formatNum(y1)} ${formatNum(x2)} ${formatNum(
                y2
            )} ${formatNum(x3)} ${formatNum(y3)} c`
        );
        return this;
    }

    /**
     * Close path
     * @returns {this}
     */
    closePath() {
        this.operations.push("h");
        return this;
    }

    /**
     * Rectangle
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @param {number} height
     * @returns {this}
     */
    rectangle(x, y, width, height) {
        this.operations.push(
            `${formatNum(x)} ${formatNum(y)} ${formatNum(width)} ${formatNum(
                height
            )} re`
        );
        return this;
    }

    // ========================================================================
    // Path Painting
    // ========================================================================

    /**
     * Stroke path
     * @returns {this}
     */
    stroke() {
        this.operations.push("S");
        return this;
    }

    /**
     * Close and stroke path
     * @returns {this}
     */
    closeAndStroke() {
        this.operations.push("s");
        return this;
    }

    /**
     * Fill path (non-zero winding)
     * @returns {this}
     */
    fill() {
        this.operations.push("f");
        return this;
    }

    /**
     * Fill path (even-odd rule)
     * @returns {this}
     */
    fillEvenOdd() {
        this.operations.push("f*");
        return this;
    }

    /**
     * Fill and stroke path
     * @returns {this}
     */
    fillAndStroke() {
        this.operations.push("B");
        return this;
    }

    /**
     * End path without filling or stroking
     * @returns {this}
     */
    endPath() {
        this.operations.push("n");
        return this;
    }

    // ========================================================================
    // Text Objects
    // ========================================================================

    /**
     * Begin text object
     * @returns {this}
     */
    beginText() {
        this.operations.push("BT");
        return this;
    }

    /**
     * End text object
     * @returns {this}
     */
    endText() {
        this.operations.push("ET");
        return this;
    }

    /**
     * Set font and size
     * @param {string} fontName - Resource name (e.g., "F1")
     * @param {number} size
     * @returns {this}
     */
    setFont(fontName, size) {
        this.operations.push(`/${fontName} ${formatNum(size)} Tf`);
        return this;
    }

    /**
     * Set text leading
     * @param {number} leading
     * @returns {this}
     */
    setTextLeading(leading) {
        this.operations.push(`${formatNum(leading)} TL`);
        return this;
    }

    /**
     * Set character spacing
     * @param {number} spacing
     * @returns {this}
     */
    setCharacterSpacing(spacing) {
        this.operations.push(`${formatNum(spacing)} Tc`);
        return this;
    }

    /**
     * Set word spacing
     * @param {number} spacing
     * @returns {this}
     */
    setWordSpacing(spacing) {
        this.operations.push(`${formatNum(spacing)} Tw`);
        return this;
    }

    /**
     * Set text rise (superscript/subscript)
     * @param {number} rise
     * @returns {this}
     */
    setTextRise(rise) {
        this.operations.push(`${formatNum(rise)} Ts`);
        return this;
    }

    /**
     * Set text rendering mode
     * @param {number} mode - 0=fill, 1=stroke, 2=fill+stroke, 3=invisible
     * @returns {this}
     */
    setTextRenderingMode(mode) {
        this.operations.push(`${mode} Tr`);
        return this;
    }

    /**
     * Move text position
     * @param {number} x
     * @param {number} y
     * @returns {this}
     */
    moveTextPosition(x, y) {
        this.operations.push(`${formatNum(x)} ${formatNum(y)} Td`);
        return this;
    }

    /**
     * Move text position and set leading
     * @param {number} x
     * @param {number} y
     * @returns {this}
     */
    moveTextPositionSetLeading(x, y) {
        this.operations.push(`${formatNum(x)} ${formatNum(y)} TD`);
        return this;
    }

    /**
     * Set text matrix
     * @param {number} a
     * @param {number} b
     * @param {number} c
     * @param {number} d
     * @param {number} e
     * @param {number} f
     * @returns {this}
     */
    setTextMatrix(a, b, c, d, e, f) {
        this.operations.push(
            `${formatNum(a)} ${formatNum(b)} ${formatNum(c)} ${formatNum(
                d
            )} ${formatNum(e)} ${formatNum(f)} Tm`
        );
        return this;
    }

    /**
     * Move to next line
     * @returns {this}
     */
    nextLine() {
        this.operations.push("T*");
        return this;
    }

    /**
     * Show text string
     * @param {string} text
     * @returns {this}
     */
    showText(text) {
        const escaped = escapePdfString(text);
        this.operations.push(`(${escaped}) Tj`);
        return this;
    }

    /**
     * Show text and move to next line
     * @param {string} text
     * @returns {this}
     */
    showTextNextLine(text) {
        const escaped = escapePdfString(text);
        this.operations.push(`(${escaped}) '`);
        return this;
    }

    /**
     * Show text with individual glyph positioning
     * @param {Array<string | number>} items - Strings and positioning adjustments
     * @returns {this}
     */
    showTextWithPositioning(items) {
        let array = "[";
        for (let i = 0, len = items.length; i < len; i++) {
            const item = items[i];
            if (typeof item === "string") {
                array = array + "(" + escapePdfString(item) + ")";
            } else {
                array = array + formatNum(item);
            }
            if (i < len - 1) {
                array = array + " ";
            }
        }
        array = array + "]";
        this.operations.push(`${array} TJ`);
        return this;
    }

    /**
     * Draw an image XObject at a given position and size.
     * Places the image with its bottom-left corner at (x, y) in PDF coordinates.
     * @param {string} xObjectName - Resource name (e.g. "Im1")
     * @param {number} x
     * @param {number} y
     * @param {number} width  - rendered width in points
     * @param {number} height - rendered height in points
     * @returns {this}
     */
    drawImage(xObjectName, x, y, width, height) {
        this.operations.push("q");
        // cm: scale to (width, height), translate to (x, y)
        this.operations.push(
            `${formatNum(width)} 0 0 ${formatNum(height)} ${formatNum(
                x
            )} ${formatNum(y)} cm`
        );
        this.operations.push(`/${xObjectName} Do`);
        this.operations.push("Q");
        return this;
    }

    // ========================================================================
    // Transformations
    // ========================================================================

    /**
     * Concatenate transformation matrix
     * @param {number} a
     * @param {number} b
     * @param {number} c
     * @param {number} d
     * @param {number} e
     * @param {number} f
     * @returns {this}
     */
    transform(a, b, c, d, e, f) {
        this.operations.push(
            `${formatNum(a)} ${formatNum(b)} ${formatNum(c)} ${formatNum(
                d
            )} ${formatNum(e)} ${formatNum(f)} cm`
        );
        return this;
    }

    /**
     * Translate
     * @param {number} x
     * @param {number} y
     * @returns {this}
     */
    translate(x, y) {
        return this.transform(1, 0, 0, 1, x, y);
    }

    /**
     * Scale
     * @param {number} sx
     * @param {number} sy
     * @returns {this}
     */
    scale(sx, sy) {
        return this.transform(sx, 0, 0, sy, 0, 0);
    }

    /**
     * Rotate (radians)
     * @param {number} angle
     * @returns {this}
     */
    rotate(angle) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return this.transform(cos, sin, -sin, cos, 0, 0);
    }

    // ========================================================================
    // Output
    // ========================================================================

    /**
     * Build the content stream string
     * @returns {string}
     */
    build() {
        return this.operations.join("\n");
    }

    /**
     * Build the content stream string (alias for build)
     * @returns {string}
     */
    toString() {
        return this.build();
    }

    /**
     * Clear operations
     * @returns {this}
     */
    clear() {
        this.operations.length = 0;
        return this;
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format number for PDF (limited precision, no trailing zeros)
 * @param {number} n
 * @returns {string}
 */
function formatNum(n) {
    if (Number.isInteger(n)) {
        return String(n);
    }
    // 4 decimal places max
    const fixed = n.toFixed(4);
    // Remove trailing zeros
    let end = fixed.length - 1;
    while (end > 0 && fixed.charAt(end) === "0") {
        end = end - 1;
    }
    if (fixed.charAt(end) === ".") {
        end = end - 1;
    }
    return fixed.slice(0, end + 1);
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Draw a horizontal line
 * @param {PdfContentStreamBuilder} builder
 * @param {number} x1
 * @param {number} y
 * @param {number} x2
 * @param {number} lineWidth
 * @param {number} gray
 * @returns {PdfContentStreamBuilder}
 */
export function drawHorizontalLine(builder, x1, y, x2, lineWidth, gray) {
    builder
        .saveState()
        .setLineWidth(lineWidth)
        .setStrokeGray(gray)
        .moveTo(x1, y)
        .lineTo(x2, y)
        .stroke()
        .restoreState();
    return builder;
}

/**
 * Draw a filled rectangle
 * @param {PdfContentStreamBuilder} builder
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {number} gray
 * @returns {PdfContentStreamBuilder}
 */
export function drawFilledRect(builder, x, y, width, height, gray) {
    builder
        .saveState()
        .setFillGray(gray)
        .rectangle(x, y, width, height)
        .fill()
        .restoreState();
    return builder;
}

/**
 * Draw a stroked rectangle
 * @param {PdfContentStreamBuilder} builder
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {number} lineWidth
 * @param {number} gray
 * @returns {PdfContentStreamBuilder}
 */
export function drawStrokedRect(builder, x, y, width, height, lineWidth, gray) {
    builder
        .saveState()
        .setLineWidth(lineWidth)
        .setStrokeGray(gray)
        .rectangle(x, y, width, height)
        .stroke()
        .restoreState();
    return builder;
}

// ============================================================================
// Export
// ============================================================================

export default {
    PdfContentStreamBuilder,
    drawHorizontalLine,
    drawFilledRect,
    drawStrokedRect
};
