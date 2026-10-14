/**
 * PDF text-string and name-object codec.
 *
 * A PDF text string (ISO 32000-1 7.9.2.2) is stored either as UTF-16BE behind a
 * U+FEFF byte-order mark or as PDFDocEncoding, and reaches this module already
 * unwrapped to bytes. Form field names and text field values are text strings,
 * so decoding them correctly is what makes a field addressable by the name an
 * authoring tool gave it.
 *
 * PDFDocEncoding is Latin-1 except for the 0x18-0x1F and 0x80-0x9F windows and
 * two unassigned positions; those windows carry the typographic characters
 * listed in ISO 32000-1 Annex D.2.
 * @module TextString
 */

import { encodePdfHexString, escapePdfString } from "../primitives.mjs";

/**
 * Code points for the PDFDocEncoding positions that differ from Latin-1.
 * 0x9F and 0xAD are unassigned and decode to nothing.
 * @type {Record<number, number>}
 */
const PDF_DOC_CODE_POINTS = {
    0x18: 0x02d8,
    0x19: 0x02c7,
    0x1a: 0x02c6,
    0x1b: 0x02d9,
    0x1c: 0x02dd,
    0x1d: 0x02db,
    0x1e: 0x02da,
    0x1f: 0x02dc,
    0x80: 0x2022,
    0x81: 0x2020,
    0x82: 0x2021,
    0x83: 0x2026,
    0x84: 0x2014,
    0x85: 0x2013,
    0x86: 0x0192,
    0x87: 0x2044,
    0x88: 0x2039,
    0x89: 0x203a,
    0x8a: 0x2212,
    0x8b: 0x2030,
    0x8c: 0x201e,
    0x8d: 0x201c,
    0x8e: 0x201d,
    0x8f: 0x2018,
    0x90: 0x2019,
    0x91: 0x201a,
    0x92: 0x2122,
    0x93: 0xfb01,
    0x94: 0xfb02,
    0x95: 0x0141,
    0x96: 0x0152,
    0x97: 0x0160,
    0x98: 0x0178,
    0x99: 0x017d,
    0x9a: 0x0131,
    0x9b: 0x0142,
    0x9c: 0x0153,
    0x9d: 0x0161,
    0x9e: 0x017e,
    0xa0: 0x20ac
};

/** Positions with no assigned character in PDFDocEncoding. */
const PDF_DOC_UNASSIGNED = new Set([0x9f, 0xad]);

/**
 * Decode PDFDocEncoding bytes.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function decodePdfDocEncoding(bytes) {
    let out = "";
    for (let i = 0, len = bytes.length; i < len; i++) {
        const byte = bytes[i];
        if (PDF_DOC_UNASSIGNED.has(byte)) {
            continue;
        }
        const mapped = PDF_DOC_CODE_POINTS[byte];
        out = out + String.fromCodePoint(mapped === undefined ? byte : mapped);
    }
    return out;
}

/**
 * Decode UTF-16 bytes, honouring the byte-order mark. Surrogate pairs survive
 * because the units are appended verbatim.
 * @param {Uint8Array} bytes
 * @param {boolean} bigEndian
 * @returns {string}
 */
function decodeUtf16(bytes, bigEndian) {
    let out = "";
    for (let i = 2; i + 1 < bytes.length; i = i + 2) {
        const unit = bigEndian
            ? (bytes[i] << 8) | bytes[i + 1]
            : (bytes[i + 1] << 8) | bytes[i];
        out = out + String.fromCharCode(unit);
    }
    return out;
}

/**
 * Decode the bytes of a PDF text string.
 *
 * A leading U+FEFF or U+FFFE mark selects UTF-16; anything else is read as
 * PDFDocEncoding.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function decodeTextStringBytes(bytes) {
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        return decodeUtf16(bytes, true);
    }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        return decodeUtf16(bytes, false);
    }
    return decodePdfDocEncoding(bytes);
}

/**
 * Encode a string as a PDF text-string token ready to place in a dictionary.
 *
 * ASCII values are written as literal strings because they stay readable in the
 * file; everything else becomes a UTF-16BE hex string, which every conforming
 * reader accepts for text strings.
 * @param {string} value
 * @returns {string}
 */
export function encodeTextString(value) {
    if (/^[\x20-\x7e]*$/.test(value)) {
        return "(" + escapePdfString(value) + ")";
    }
    return encodePdfHexString(value);
}

/**
 * Decode a name object's raw token (`/Name`) to its character string, resolving
 * the `#xx` escapes PDF 1.2 introduced.
 * @param {string} raw
 * @returns {string}
 */
export function decodeName(raw) {
    const token = raw.trim();
    const body = token.startsWith("/") ? token.slice(1) : token;
    return body.replace(/#([0-9A-Fa-f]{2})/g, (_match, hex) =>
        String.fromCharCode(parseInt(hex, 16))
    );
}

export default { decodeTextStringBytes, encodeTextString, decodeName };
