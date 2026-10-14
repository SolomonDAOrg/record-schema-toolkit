/**
 * Building the appearance stream a filled field draws itself with.
 *
 * A field's value in /V is what the document means; the appearance stream in
 * /AP is what anyone sees. A viewer will regenerate appearances when the form
 * asks it to, but printing, extraction and every non-interactive reader show
 * what /AP holds, so a fill that sets only /V is invisible in exactly the
 * places a filled form usually ends up. This module produces that stream.
 *
 * The stream is a Form XObject whose bounding box matches the widget, marked
 * with /Tx BMC as ISO 32000-1 12.7.3.3 requires for variable text, and clipped
 * to the box so an over-long value is cut at the field's edge rather than
 * drawn across the page. Text is written in the encoding the /DA font declares.
 * @module Appearance
 */

import { encodeWinAnsi } from "../encoding/index.mjs";
import { escapePdfString } from "../primitives.mjs";

import { PADDING } from "./appearance-layout.mjs";

/**
 * @typedef {import("./appearance-layout.mjs").TextLayout} TextLayout
 * @typedef {import("./font-resource.mjs").FormFont} FormFont
 * @typedef {import("./default-appearance.mjs").DefaultAppearance} DefaultAppearance
 */

/**
 * Write a string as a content-stream operand in the /DA font's encoding.
 *
 * Characters the encoding cannot represent are reported, not substituted: a
 * caller filling a name with a character the form's font lacks needs to know
 * that the appearance will not show what the value says.
 * @param {FormFont | null} font
 * @param {string} text
 * @returns {{ operand: string, unmapped: string[] }}
 */
export function encodeAppearanceText(font, text) {
    if (font !== null && font.winAnsi === false && font.widths === null) {
        return { operand: "(" + escapePdfString(text) + ")", unmapped: [] };
    }
    const encoded = encodeWinAnsi(text);
    let literal = "";
    for (let i = 0, len = encoded.bytes.length; i < len; i++) {
        literal = literal + String.fromCharCode(encoded.bytes[i]);
    }
    return {
        operand: "(" + escapePdfString(literal) + ")",
        unmapped: encoded.unmapped
    };
}

/**
 * Format a number for a content stream, trimming the trailing zeros that a
 * fixed precision would leave behind.
 * @param {number} value
 * @returns {string}
 */
function formatNumber(value) {
    const rounded = Number(value.toFixed(4));
    return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/**
 * Compose the variable-text appearance stream for a laid-out value.
 * @param {TextLayout} layout
 * @param {FormFont | null} font
 * @param {DefaultAppearance} defaultAppearance
 * @param {number} boxWidth
 * @param {number} boxHeight
 * @returns {{ content: string, unmapped: string[] }}
 */
export function buildTextAppearanceStream(
    layout,
    font,
    defaultAppearance,
    boxWidth,
    boxHeight
) {
    const resourceName =
        defaultAppearance.fontResource === null
            ? "Helv"
            : defaultAppearance.fontResource;

    /** @type {string[]} */
    const operators = ["/Tx BMC", "q"];
    operators.push(
        formatNumber(PADDING) +
            " " +
            formatNumber(PADDING) +
            " " +
            formatNumber(Math.max(boxWidth - PADDING * 2, 0)) +
            " " +
            formatNumber(Math.max(boxHeight - PADDING * 2, 0)) +
            " re W n"
    );
    operators.push("BT");
    if (defaultAppearance.colourOperator !== null) {
        operators.push(defaultAppearance.colourOperator);
    }
    operators.push(
        "/" + resourceName + " " + formatNumber(layout.fontSize) + " Tf"
    );

    /** @type {string[]} */
    const unmapped = [];
    for (let i = 0, len = layout.lines.length; i < len; i++) {
        const line = layout.lines[i];
        const encoded = encodeAppearanceText(font, line.text);
        for (let j = 0; j < encoded.unmapped.length; j++) {
            if (!unmapped.includes(encoded.unmapped[j])) {
                unmapped.push(encoded.unmapped[j]);
            }
        }
        operators.push(
            "1 0 0 1 " +
                formatNumber(line.x) +
                " " +
                formatNumber(line.y) +
                " Tm"
        );
        operators.push(encoded.operand + " Tj");
    }
    operators.push("ET", "Q", "EMC");
    return { content: operators.join("\n") + "\n", unmapped };
}

/**
 * The Form XObject dictionary wrapping an appearance stream.
 *
 * The font is referenced through the appearance's own /Resources rather than
 * relied on from the form's /DR, because a viewer resolves an appearance
 * stream's names against the stream's resources first and some resolve them
 * nowhere else.
 * @param {number} boxWidth
 * @param {number} boxHeight
 * @param {string} resourceName
 * @param {number | null} fontObjectId
 * @param {number} streamLength
 * @returns {string}
 */
export function buildAppearanceXObject(
    boxWidth,
    boxHeight,
    resourceName,
    fontObjectId,
    streamLength
) {
    const resources =
        fontObjectId === null
            ? "<< >>"
            : "<< /Font << /" +
              resourceName +
              " " +
              fontObjectId +
              " 0 R >> >>";
    return (
        "<< /Type /XObject /Subtype /Form /FormType 1" +
        " /BBox [0 0 " +
        formatNumber(boxWidth) +
        " " +
        formatNumber(boxHeight) +
        "]" +
        " /Resources " +
        resources +
        " /Length " +
        streamLength +
        " >>"
    );
}

export default {
    encodeAppearanceText,
    buildTextAppearanceStream,
    buildAppearanceXObject
};
