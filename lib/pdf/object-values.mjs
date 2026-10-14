/**
 * Raw PDF object text to JavaScript values.
 *
 * The reader keeps dictionary entries as the verbatim substring that spelled
 * each value, which is what lets it write an incremental update byte-for-byte.
 * Anything that has to reason about a value — a field's option list, a
 * button's appearance states, a default-appearance colour — needs that
 * substring parsed.
 * This module is that step, and nothing more: it resolves no references and
 * reads no objects, so it stays usable on detached fragments.
 *
 * Values are tagged unions rather than bare JavaScript values, because a PDF
 * name, a text string and a reference are all distinct things that would
 * otherwise collapse into a JavaScript string.
 * @module ObjectValues
 */

import { decodeTextStringBytes, decodeName } from "./encoding/index.mjs";
import { scanValue, decodePdfStringBytes } from "./reader.mjs";

/**
 * @typedef {(
 *   | { kind: "null" }
 *   | { kind: "boolean", value: boolean }
 *   | { kind: "number", value: number }
 *   | { kind: "string", text: string, bytes: Uint8Array }
 *   | { kind: "name", name: string }
 *   | { kind: "array", items: PdfValue[] }
 *   | { kind: "dictionary", entries: { key: string, raw: string }[] }
 *   | { kind: "reference", id: number, generation: number }
 * )} PdfValue
 */

/** @type {PdfValue} */
const NULL_VALUE = { kind: "null" };

/**
 * Parse the first object value in `raw`.
 *
 * Text that spells no value — an empty entry, a stray keyword — parses as
 * null rather than throwing, because a malformed entry in one field of a
 * large form should not make the rest of the form unreadable.
 * @param {string | undefined} raw
 * @returns {PdfValue}
 */
export function parseValue(raw) {
    if (raw === undefined) {
        return NULL_VALUE;
    }
    const token = raw.trim();
    if (token.length === 0) {
        return NULL_VALUE;
    }

    const reference = /^(\d+)\s+(\d+)\s+R$/.exec(token);
    if (reference) {
        return {
            kind: "reference",
            id: parseInt(reference[1], 10),
            generation: parseInt(reference[2], 10)
        };
    }
    if (token === "true" || token === "false") {
        return { kind: "boolean", value: token === "true" };
    }
    if (token === "null") {
        return NULL_VALUE;
    }
    if (token.startsWith("/")) {
        return { kind: "name", name: decodeName(token) };
    }
    if (token.startsWith("<<")) {
        return { kind: "dictionary", entries: parseDictionaryEntries(token) };
    }
    if (token.startsWith("(") || token.startsWith("<")) {
        const bytes = decodePdfStringBytes(token);
        return { kind: "string", text: decodeTextStringBytes(bytes), bytes };
    }
    if (token.startsWith("[")) {
        return { kind: "array", items: parseArrayItems(token) };
    }
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token)) {
        return { kind: "number", value: parseFloat(token) };
    }
    return NULL_VALUE;
}

/**
 * Split an array's raw text into its element values.
 * @param {string} raw - text beginning with `[`
 * @returns {PdfValue[]}
 */
export function parseArrayItems(raw) {
    const token = raw.trim();
    if (!token.startsWith("[")) {
        return [];
    }
    const body = token.slice(1, token.lastIndexOf("]"));
    /** @type {PdfValue[]} */
    const items = [];
    let position = 0;
    while (position < body.length) {
        const scanned = scanValue(body, position);
        if (scanned.end <= position) {
            break;
        }
        if (scanned.raw.trim().length > 0) {
            items.push(parseValue(scanned.raw));
        }
        position = scanned.end;
    }
    return items;
}

/**
 * Split a dictionary's raw text into key/raw pairs.
 *
 * Keys arrive with their `#xx` escapes resolved and without the leading
 * solidus, matching the reader's own dictionary entries.
 * @param {string} raw - text beginning with `<<`
 * @returns {{ key: string, raw: string }[]}
 */
export function parseDictionaryEntries(raw) {
    const token = raw.trim();
    if (!token.startsWith("<<")) {
        return [];
    }
    const body = token.slice(2, token.lastIndexOf(">>"));
    /** @type {{ key: string, raw: string }[]} */
    const entries = [];
    let position = 0;
    while (position < body.length) {
        const keyScan = scanValue(body, position);
        if (keyScan.end <= position) {
            break;
        }
        const keyToken = keyScan.raw.trim();
        if (!keyToken.startsWith("/")) {
            position = keyScan.end;
            continue;
        }
        const valueScan = scanValue(body, keyScan.end);
        if (valueScan.end <= keyScan.end) {
            break;
        }
        entries.push({ key: decodeName(keyToken), raw: valueScan.raw.trim() });
        position = valueScan.end;
    }
    return entries;
}

/**
 * The raw text for a key of a parsed dictionary value, or undefined.
 * @param {PdfValue} value
 * @param {string} key
 * @returns {string | undefined}
 */
export function dictionaryEntry(value, key) {
    if (value.kind !== "dictionary") {
        return undefined;
    }
    for (let i = 0, len = value.entries.length; i < len; i++) {
        if (value.entries[i].key === key) {
            return value.entries[i].raw;
        }
    }
    return undefined;
}

/**
 * The name a value carries, or null when it is not a name object.
 * @param {PdfValue} value
 * @returns {string | null}
 */
export function asName(value) {
    return value.kind === "name" ? value.name : null;
}

/**
 * The text a value carries, or null when it is not a string object.
 * @param {PdfValue} value
 * @returns {string | null}
 */
export function asText(value) {
    return value.kind === "string" ? value.text : null;
}

/**
 * The number a value carries, or null when it is not a numeric object.
 * @param {PdfValue} value
 * @returns {number | null}
 */
export function asNumber(value) {
    return value.kind === "number" ? value.value : null;
}

/**
 * The object id a value references, or null when it is not a reference.
 * @param {PdfValue} value
 * @returns {number | null}
 */
export function asReference(value) {
    return value.kind === "reference" ? value.id : null;
}

export default {
    parseValue,
    parseArrayItems,
    parseDictionaryEntries,
    dictionaryEntry,
    asName,
    asText,
    asNumber,
    asReference
};
