import { measureTextWidth } from "../../../pdf/document.mjs";

/** @typedef {import("./content.mjs").DocxContentRenderer} DocxContentRenderer */
/** @typedef {import("../../../docx/styles.mjs").RunStyle} RunStyle */

/** @param {DocxContentRenderer} renderer @param {string} text @param {RunStyle} style @returns {number} */
export function measureText(renderer, text, style) {
    const fonts = renderer.configuration.fonts ?? {};
    const font = style.monospace ? fonts.monospace ?? "Courier" :
        style.bold && style.italic ? fonts.boldItalic ?? fonts.regular ?? "Times-BoldItalic" :
        style.bold ? fonts.bold ?? fonts.regular ?? "Times-Bold" :
        style.italic ? fonts.italic ?? fonts.regular ?? "Times-Italic" : fonts.regular ?? "Times-Roman";
    return Math.max(0, ...text.split(/\r?\n/).map(line => measureTextWidth(line, font, style.fontSize)));
}
