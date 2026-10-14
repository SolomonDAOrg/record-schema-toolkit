/**
 * WinAnsiEncoding (Windows-1252) codec for simple-font content streams.
 *
 * Simple Type1/TrueType fonts declared with /Encoding /WinAnsiEncoding address
 * glyphs by single bytes in the Windows-1252 code page. Text drawn into a form
 * field's appearance stream with such a font must therefore be encoded to those
 * byte values rather than written out as UTF-16 or Latin-1.
 *
 * The code page is Latin-1 outside 0x80-0x9F; only that window is remapped.
 * Characters with no Windows-1252 representation have no encoding and are
 * reported to the caller instead of being silently replaced.
 * @module WinAnsi
 */

/**
 * Unicode code points occupying the 0x80-0x9F window of Windows-1252.
 * 0x81, 0x8D, 0x8F, 0x90 and 0x9D are unassigned in the code page.
 * @type {Record<number, number>}
 */
const HIGH_RANGE_CODE_POINTS = {
    0x80: 0x20ac,
    0x82: 0x201a,
    0x83: 0x0192,
    0x84: 0x201e,
    0x85: 0x2026,
    0x86: 0x2020,
    0x87: 0x2021,
    0x88: 0x02c6,
    0x89: 0x2030,
    0x8a: 0x0160,
    0x8b: 0x2039,
    0x8c: 0x0152,
    0x8e: 0x017d,
    0x91: 0x2018,
    0x92: 0x2019,
    0x93: 0x201c,
    0x94: 0x201d,
    0x95: 0x2022,
    0x96: 0x2013,
    0x97: 0x2014,
    0x98: 0x02dc,
    0x99: 0x2122,
    0x9a: 0x0161,
    0x9b: 0x203a,
    0x9c: 0x0153,
    0x9e: 0x017e,
    0x9f: 0x0178
};

/** @type {Map<number, number>} code point -> byte, for the high window */
const HIGH_RANGE_BYTES = new Map(
    Object.keys(HIGH_RANGE_CODE_POINTS).map((key) => [
        HIGH_RANGE_CODE_POINTS[Number(key)],
        Number(key)
    ])
);

/**
 * The WinAnsi byte for a single code point, or null when the code page has no
 * representation for it.
 * @param {number} codePoint
 * @returns {number | null}
 */
export function winAnsiByteForCodePoint(codePoint) {
    const high = HIGH_RANGE_BYTES.get(codePoint);
    if (high !== undefined) {
        return high;
    }
    if (codePoint >= 0x20 && codePoint <= 0x7e) {
        return codePoint;
    }
    if (codePoint >= 0xa0 && codePoint <= 0xff) {
        return codePoint;
    }
    return null;
}

/**
 * Encode a string to WinAnsi bytes.
 *
 * Unrepresentable characters are collected in `unmapped` rather than replaced,
 * so a caller can refuse the value or pick a different font instead of writing
 * a lossy appearance.
 * @param {string} value
 * @returns {{ bytes: Uint8Array, unmapped: string[] }}
 */
export function encodeWinAnsi(value) {
    /** @type {number[]} */
    const bytes = [];
    /** @type {string[]} */
    const unmapped = [];
    for (const character of value) {
        const codePoint = character.codePointAt(0);
        if (codePoint === undefined) {
            continue;
        }
        const byte = winAnsiByteForCodePoint(codePoint);
        if (byte === null) {
            unmapped.push(character);
            continue;
        }
        bytes.push(byte);
    }
    return { bytes: new Uint8Array(bytes), unmapped };
}

/**
 * True when every character of `value` has a WinAnsi representation.
 * @param {string} value
 * @returns {boolean}
 */
export function isWinAnsiRepresentable(value) {
    for (const character of value) {
        const codePoint = character.codePointAt(0);
        if (codePoint === undefined) {
            continue;
        }
        if (winAnsiByteForCodePoint(codePoint) === null) {
            return false;
        }
    }
    return true;
}

export default {
    winAnsiByteForCodePoint,
    encodeWinAnsi,
    isWinAnsiRepresentable
};
