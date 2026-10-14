/**
 * Resolving the font a /DA names, and measuring text in it.
 *
 * The resource name in a /DA string is meaningless on its own: it indexes the
 * /Font sub-dictionary of the form's /DR, and only the font dictionary found
 * there says which glyphs exist and how wide they are. Measurement decides
 * where a line starts under right or centre alignment and what size automatic
 * sizing settles on, so it is taken from the file's own /Widths whenever the
 * font supplies them, and only falls back to the built-in metrics for the
 * standard 14 fonts, which carry no /Widths by design.
 *
 * Widths are indexed by character code, so a code has to be obtained the same
 * way the appearance stream will write it — through the font's encoding.
 *
 * Vertical metrics come from the /FontDescriptor and decide where a baseline
 * sits inside a widget. The standard 14 fonts carry no descriptor, so their
 * published values stand in.
 * @module FontResource
 */

import { measureTextWidth } from "../document.mjs";
import { encodeWinAnsi } from "../encoding/index.mjs";
import {
    parseValue,
    dictionaryEntry,
    asName,
    asNumber
} from "../object-values.mjs";
import { getRaw, refId } from "../reader.mjs";

import { resolveValue } from "./field-tree.mjs";

/** Glyph-space units per text-space unit for simple fonts. */
const GLYPH_UNITS = 1000;

/** Published ascent of Helvetica, used when no /FontDescriptor is present. */
const FALLBACK_ASCENT = 718;

/** Published descent of Helvetica, used when no /FontDescriptor is present. */
const FALLBACK_DESCENT = -207;

/**
 * @typedef {Object} FormFont
 * @property {string} resourceName - The name used in the appearance stream's `Tf`.
 * @property {number | null} objectId - Object id of the font dictionary, when indirect.
 * @property {string | null} baseFont - /BaseFont, for the standard-14 metric fallback.
 * @property {number[] | null} widths - /Widths in glyph space, indexed from `firstChar`.
 * @property {number} firstChar - /FirstChar, 0 when the font supplies no /Widths.
 * @property {boolean} winAnsi - True when the font declares /WinAnsiEncoding.
 * @property {number} ascent - /FontDescriptor /Ascent in glyph space.
 * @property {number} descent - /FontDescriptor /Descent in glyph space, negative.
 */

/**
 * @typedef {import("../reader.mjs").PdfEditor} PdfEditor
 */

/**
 * Look a font up in a /DR resource dictionary.
 *
 * `defaultResources` is the raw /DR value, which producers write either inline
 * or as a reference; both are accepted. Returns null when the form declares no
 * font under that name, which leaves the caller to refuse the fill rather than
 * draw with a font the viewer will not find.
 * @param {PdfEditor} editor
 * @param {string | null} defaultResources - Raw /DR value.
 * @param {string} resourceName
 * @returns {FormFont | null}
 */
export function resolveFormFont(editor, defaultResources, resourceName) {
    if (defaultResources === null) {
        return null;
    }
    const resources = resolveValue(editor, defaultResources);
    const fontsRaw = dictionaryEntry(resources, "Font");
    if (fontsRaw === undefined) {
        return null;
    }
    const fonts = resolveValue(editor, fontsRaw);
    const fontRaw = dictionaryEntry(fonts, resourceName);
    if (fontRaw === undefined) {
        return null;
    }

    const objectId = refId(fontRaw);
    const font = resolveValue(editor, fontRaw);
    if (font.kind !== "dictionary") {
        return null;
    }

    const baseFont = asName(
        resolveValue(editor, dictionaryEntry(font, "BaseFont"))
    );
    const encoding = resolveValue(editor, dictionaryEntry(font, "Encoding"));
    const encodingName =
        encoding.kind === "dictionary"
            ? asName(
                  parseValue(dictionaryEntry(encoding, "BaseEncoding") || "")
              )
            : asName(encoding);

    const firstCharValue = asNumber(
        resolveValue(editor, dictionaryEntry(font, "FirstChar"))
    );
    const widthsValue = resolveValue(editor, dictionaryEntry(font, "Widths"));
    /** @type {number[] | null} */
    let widths = null;
    if (widthsValue.kind === "array" && widthsValue.items.length > 0) {
        widths = [];
        for (let i = 0, len = widthsValue.items.length; i < len; i++) {
            const width = asNumber(widthsValue.items[i]);
            widths.push(width === null ? 0 : width);
        }
    }

    const descriptor = resolveValue(
        editor,
        dictionaryEntry(font, "FontDescriptor")
    );
    const ascentValue = asNumber(
        resolveValue(editor, dictionaryEntry(descriptor, "Ascent"))
    );
    const descentValue = asNumber(
        resolveValue(editor, dictionaryEntry(descriptor, "Descent"))
    );

    return {
        resourceName,
        objectId,
        baseFont,
        widths,
        firstChar: firstCharValue === null ? 0 : firstCharValue,
        winAnsi: encodingName === "WinAnsiEncoding",
        ascent: ascentValue === null ? FALLBACK_ASCENT : ascentValue,
        descent: descentValue === null ? FALLBACK_DESCENT : descentValue
    };
}

/**
 * The advance width of `text` at `fontSize`, in text-space units.
 *
 * With /Widths present the file's own metrics are used and a code outside the
 * declared range contributes nothing, matching what a viewer draws. Without
 * them the standard-14 tables answer, and an unrecognised base font falls back
 * to Helvetica's, which is what a viewer substitutes.
 * @param {FormFont | null} font
 * @param {string} text
 * @param {number} fontSize
 * @returns {number}
 */
export function measureFormText(font, text, fontSize) {
    if (font !== null && font.widths !== null) {
        const codes = encodeWinAnsi(text).bytes;
        let glyphWidth = 0;
        for (let i = 0, len = codes.length; i < len; i++) {
            const index = codes[i] - font.firstChar;
            if (index >= 0 && index < font.widths.length) {
                glyphWidth = glyphWidth + font.widths[index];
            }
        }
        return (glyphWidth * fontSize) / GLYPH_UNITS;
    }
    const baseFont =
        font === null || font.baseFont === null ? "Helvetica" : font.baseFont;
    return measureTextWidth(text, baseFont, fontSize);
}

export default { resolveFormFont, measureFormText };
