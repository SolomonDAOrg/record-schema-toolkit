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
     * Set the line dash pattern. Empty array => solid line.
     * @param {number[]} pattern - dash/gap lengths, e.g. [3, 2]
     * @param {number} [phase=0] - offset into the pattern
     * @returns {this}
     */
    setDash(pattern, phase) {
        const arr = (pattern || []).map((n) => formatNum(n)).join(" ");
        this.operations.push(`[${arr}] ${formatNum(phase || 0)} d`);
        return this;
    }

    /**
     * Set the line cap style.
     * @param {0 | 1 | 2} cap - 0 butt, 1 round, 2 projecting square
     * @returns {this}
     */
    setLineCap(cap) {
        this.operations.push(`${cap} J`);
        return this;
    }

    /**
     * Set the line join style.
     * @param {0 | 1 | 2} join - 0 miter, 1 round, 2 bevel
     * @returns {this}
     */
    setLineJoin(join) {
        this.operations.push(`${join} j`);
        return this;
    }

    /**
     * Set the miter limit.
     * @param {number} limit
     * @returns {this}
     */
    setMiterLimit(limit) {
        this.operations.push(`${formatNum(limit)} M`);
        return this;
    }

    /**
     * Use the current path as a clipping region (nonzero winding). Call after
     * constructing a path and before the content it should clip; this both sets
     * the clip and ends the path without painting it.
     * @returns {this}
     */
    clip() {
        this.operations.push("W n");
        return this;
    }

    /**
     * Use the current path as a clipping region (even-odd rule).
     * @returns {this}
     */
    clipEvenOdd() {
        this.operations.push("W* n");
        return this;
    }

    /**
     * Apply a registered graphics state (transparency, blend mode, etc.).
     * @param {string} name - resource name from PdfDocumentBuilder#registerExtGState
     * @returns {this}
     */
    setExtGState(name) {
        this.operations.push(`/${name} gs`);
        return this;
    }

    /**
     * Begin a marked-content sequence with a structure tag and MCID, linking
     * this content to a structure element (for tagged/accessible PDF). Pair with
     * endMarkedContent().
     * @param {string} tag - structure type (e.g. "P", "H1", "Span", "Figure")
     * @param {number} mcid - marked-content id, unique per page
     * @returns {this}
     */
    beginMarkedContent(tag, mcid) {
        this.operations.push(`/${tag} <</MCID ${mcid}>> BDC`);
        return this;
    }

    /**
     * Begin an artifact marked-content sequence (decorative content excluded
     * from the reading order — headers, footers, backgrounds). Pair with
     * endMarkedContent().
     * @returns {this}
     */
    beginArtifact() {
        this.operations.push("/Artifact BDC");
        return this;
    }

    /**
     * End the current marked-content sequence.
     * @returns {this}
     */
    endMarkedContent() {
        this.operations.push("EMC");
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
     * Set fill color in DeviceCMYK (each component 0-1).
     * @param {number} c @param {number} m @param {number} y @param {number} k
     * @returns {this}
     */
    setFillCMYK(c, m, y, k) {
        this.operations.push(
            `${formatNum(c)} ${formatNum(m)} ${formatNum(y)} ${formatNum(k)} k`
        );
        return this;
    }

    /**
     * Set stroke color in DeviceCMYK (each component 0-1).
     * @param {number} c @param {number} m @param {number} y @param {number} k
     * @returns {this}
     */
    setStrokeCMYK(c, m, y, k) {
        this.operations.push(
            `${formatNum(c)} ${formatNum(m)} ${formatNum(y)} ${formatNum(k)} K`
        );
        return this;
    }

    /**
     * Select a fill color space by resource name (e.g. a registered spot color).
     * @param {string} name
     * @returns {this}
     */
    setFillColorSpace(name) {
        this.operations.push(`/${name} cs`);
        return this;
    }

    /**
     * Select a stroke color space by resource name.
     * @param {string} name
     * @returns {this}
     */
    setStrokeColorSpace(name) {
        this.operations.push(`/${name} CS`);
        return this;
    }

    /**
     * Set fill color components in the current color space (scn operator). For a
     * spot color this is a single tint value 0-1.
     * @param {...number} components
     * @returns {this}
     */
    setFillColorN(...components) {
        this.operations.push(
            `${components.map((n) => formatNum(n)).join(" ")} scn`
        );
        return this;
    }

    /**
     * Set stroke color components in the current color space (SCN operator).
     * @param {...number} components
     * @returns {this}
     */
    setStrokeColorN(...components) {
        this.operations.push(
            `${components.map((n) => formatNum(n)).join(" ")} SCN`
        );
        return this;
    }

    /**
     * Convenience: fill with a registered spot color at a given tint (0-1).
     * @param {string} name - name from PdfDocumentBuilder#registerSpotColor
     * @param {number} tint - 0 (none) .. 1 (full)
     * @returns {this}
     */
    setFillSpot(name, tint) {
        return this.setFillColorSpace(name).setFillColorN(tint);
    }

    /**
     * Convenience: stroke with a registered spot color at a given tint (0-1).
     * @param {string} name
     * @param {number} tint
     * @returns {this}
     */
    setStrokeSpot(name, tint) {
        return this.setStrokeColorSpace(name).setStrokeColorN(tint);
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

    /**
     * Paint a shading object in current user space.
     * The shading must be registered in the document Shading resource dict.
     * Typically called after clipping via text rendering mode 7.
     * @param {string} shadingName - Resource name in /Shading dict (e.g. "Sh1")
     * @returns {this}
     */
    paintShading(shadingName) {
        this.operations.push(`/${shadingName} sh`);
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
     * Show pre-encoded glyphs as a hex string. Used with composite (Type0)
     * fonts, where the string is a sequence of 2-byte glyph ids produced by
     * PdfDocumentBuilder#encodeCIDText.
     * @param {string} glyphHex - hex digits (e.g. "00240041")
     * @returns {this}
     */
    showGlyphHex(glyphHex) {
        this.operations.push(`<${glyphHex}> Tj`);
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

    /**
     * Paint a Form XObject (reusable vector/text content).
     * The form draws in its own coordinate space (its /BBox). Use x/y to
     * translate and scaleX/scaleY to scale; pass an explicit 6-value matrix for
     * full control (rotation/skew). With no placement it is painted at the
     * origin unscaled.
     * @param {string} xObjectName - Resource name (e.g. "Fm1")
     * @param {{ x?: number, y?: number, scaleX?: number, scaleY?: number, matrix?: [number, number, number, number, number, number] }} [placement]
     * @returns {this}
     */
    drawForm(xObjectName, placement) {
        const p = placement || {};
        this.operations.push("q");
        if (p.matrix) {
            const m = p.matrix;
            this.operations.push(
                `${formatNum(m[0])} ${formatNum(m[1])} ${formatNum(
                    m[2]
                )} ${formatNum(m[3])} ${formatNum(m[4])} ${formatNum(m[5])} cm`
            );
        } else {
            const sx = p.scaleX !== undefined ? p.scaleX : 1;
            const sy = p.scaleY !== undefined ? p.scaleY : 1;
            const x = p.x !== undefined ? p.x : 0;
            const y = p.y !== undefined ? p.y : 0;
            if (sx !== 1 || sy !== 1 || x !== 0 || y !== 0) {
                this.operations.push(
                    `${formatNum(sx)} 0 0 ${formatNum(sy)} ${formatNum(
                        x
                    )} ${formatNum(y)} cm`
                );
            }
        }
        this.operations.push(`/${xObjectName} Do`);
        this.operations.push("Q");
        return this;
    }

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
