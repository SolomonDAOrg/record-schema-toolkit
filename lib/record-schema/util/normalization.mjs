/**
 * Text normalization utilities for linting
 * @module util/normalization
 */

import { UNICODE_REPLACEMENTS } from "../constants/constants.mjs";

/** @typedef {import("../types/general.mjs").NormalizeResult} NormalizeResult */

/**
 * Remove BOM from text
 * @param {string} text
 * @returns {string}
 */
function trimBom(text) {
    if (text.length > 0 && text.charCodeAt(0) === 0xfeff) {
        return text.slice(1);
    }
    return text;
}

/**
 * Normalize line endings to LF
 * @param {string} text
 * @returns {string}
 */
function normalizeEol(text) {
    // CRLF -> LF, CR -> LF
    let out = text.replace(/\r\n/g, "\n");
    out = out.replace(/\r/g, "\n");
    return out;
}

/**
 * Remove trailing whitespace from lines, with one exception:
 * a single trailing space immediately after [:.;] is preserved as the
 * deliberate clause-break signal (see FORMATTING.md §4.4).  Multiple
 * trailing spaces after such punctuation are normalised to exactly one.
 * @param {string} text
 * @returns {string}
 */
function normalizeTrailingWhitespace(text) {
    const lines = text.split("\n");
    for (let i = 0, len = lines.length; i < len; i++) {
        const line = lines[i];
        // Clause-break signal: [:.;] followed by one or more spaces at EOL.
        // Preserve as exactly one trailing space so reflowMarkdown can detect it.
        if (/[:.;][ \t]+$/.test(line)) {
            lines[i] = line.replace(/([:.;])[ \t]+$/, "$1 ");
        } else {
            lines[i] = line.replace(/[ \t]+$/g, "");
        }
    }
    return lines.join("\n");
}

/**
 * Ensure text ends with exactly one newline
 * @param {string} text
 * @returns {string}
 */
function ensureFinalNewline(text) {
    if (text.length === 0) {
        return "\n";
    }
    return text.endsWith("\n") ? text : text + "\n";
}

/**
 * Canonical ASCII profile: normalize common unicode punctuation and spaces.
 * @param {string} text
 * @returns {NormalizeResult}
 */
function normalizeCanonicalAscii(text) {
    let out = text;
    /** @type {string[]} */
    const notes = [];
    for (let i = 0, len = UNICODE_REPLACEMENTS.length; i < len; i++) {
        const from = UNICODE_REPLACEMENTS[i][0];
        const to = UNICODE_REPLACEMENTS[i][1];
        if (out.indexOf(from) !== -1) {
            out = out.split(from).join(to);
            notes.push(
                `replace ${JSON.stringify(from)} -> ${JSON.stringify(to)}`
            );
        }
    }
    // tabs -> 4 spaces
    if (out.indexOf("\t") !== -1) {
        out = out.split("\t").join("    ");
        notes.push("replace tabs -> 4 spaces");
    }
    return { changed: notes.length > 0, text: out, notes };
}

/**
 * Find non-ASCII characters in text
 * @param {string} text
 * @returns {string[]}
 */
function findNonAscii(text) {
    /** @type {Set<string>} */
    const found = new Set();
    for (let i = 0, len = text.length; i < len; i++) {
        const code = text.charCodeAt(i);
        if (code > 127) {
            found.add(text[i]);
        }
    }
    return Array.from(found);
}

/**
 * Apply baseline normalization: BOM removal, LF line endings, trailing whitespace removal, final newline
 * @param {string} text
 * @returns {string}
 */
function normalizeBaseline(text) {
    let out = trimBom(text);
    out = normalizeEol(out);

    // If the input is whitespace-only but contains at least one space/tab,
    // preserve the visual empty-line structure after trimming.
    // Example: "   \n\t\t\n" -> "\n\n\n".
    const hadNonNewlineWhitespace = /[ \t]/.test(out);

    out = normalizeTrailingWhitespace(out);

    if (hadNonNewlineWhitespace && out.length > 0 && /^[\n]+$/.test(out)) {
        // We already have line breaks; keep them and ensure one more terminal LF.
        out += "\n";
    }

    out = ensureFinalNewline(out);
    return out;
}

export {
    trimBom,
    ensureFinalNewline,
    findNonAscii,
    normalizeEol,
    normalizeBaseline,
    normalizeCanonicalAscii,
    normalizeTrailingWhitespace
};
