import { measureTextWidth } from "../../../pdf/document.mjs";
import { formattedStyle, plainText } from "./inline.mjs";

/** @typedef {import("./content.mjs").DocxContentRenderer} DocxContentRenderer */
/** @typedef {import("../../../docx/styles.mjs").RunStyle} RunStyle */

/** @param {DocxContentRenderer} renderer @param {string} text @param {RunStyle} style @returns {number} */
export function measureText(renderer, text, style) {
    const fonts = renderer.configuration.fonts ?? {};
    const font = style.monospace
        ? fonts.monospace ?? "Courier"
        : style.bold && style.italic
        ? fonts.boldItalic ?? fonts.regular ?? "Times-BoldItalic"
        : style.bold
        ? fonts.bold ?? fonts.regular ?? "Times-Bold"
        : style.italic
        ? fonts.italic ?? fonts.regular ?? "Times-Italic"
        : fonts.regular ?? "Times-Roman";
    return Math.max(
        0,
        ...text
            .split(/\r?\n/)
            .map((line) => measureTextWidth(line, font, style.fontSize))
    );
}

/** Measure unwrapped inline content using the same run styles as DOCX rendering.
 * @param {DocxContentRenderer} renderer
 * @param {import("../../types/core.mjs").BaseNode} node
 * @param {RunStyle} inherited
 * @returns {number}
 */
export function measureInline(renderer, node, inherited) {
    let width = 0;
    let maximum = 0;
    /** @param {string} text @param {RunStyle} style */
    const append = (text, style) => {
        const lines = text.split(/\r?\n/);
        for (let index = 0; index < lines.length; index++) {
            if (index) {
                maximum = Math.max(maximum, width);
                width = 0;
            }
            width += measureText(renderer, lines[index], style);
        }
    };
    /** @param {import("../../types/core.mjs").BaseNode} current @param {RunStyle} parent */
    const visit = (current, parent) => {
        const style = renderer.style({ ...parent, ...current.textStyle });
        if (current.type === "inline-format") {
            const format =
                /** @type {import("../../nodes/ProseNode.mjs").InlineFormatNode} */ (
                    current
                );
            for (const child of current.children)
                visit(child, formattedStyle(format.formatType, style));
        } else if (current.type === "text") {
            const text =
                /** @type {import("../../nodes/BaseNode.mjs").TextNode} */ (
                    current
                );
            const formats = text.formats ?? [];
            const boundaries = [
                ...new Set([
                    0,
                    text.text.length,
                    ...formats.flatMap((format) => [format.start, format.end])
                ])
            ].sort((a, b) => a - b);
            if (boundaries[0] < 0 || boundaries.at(-1) > text.text.length)
                throw new Error("Invalid text formatting range");
            for (let index = 0; index < boundaries.length - 1; index++) {
                const start = boundaries[index];
                const end = boundaries[index + 1];
                const runStyle = formats
                    .filter(
                        (format) => format.start <= start && format.end >= end
                    )
                    .reduce(
                        (result, format) => formattedStyle(format.type, result),
                        style
                    );
                append(text.text.slice(start, end), renderer.style(runStyle));
            }
        } else if (current.type === "break" || current.type === "form-field") {
            append(plainText(current), style);
        } else {
            for (const child of current.children) visit(child, style);
        }
    };
    visit(node, inherited);
    return Math.max(maximum, width);
}
