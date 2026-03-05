/**
 * TrueType / OpenType (TT outlines) Font Embedding for PDF
 * Zero external dependencies, pure ESM.
 * @module FontEmbed
 */

import { formatDictionary, formatArray, formatRef } from "./primitives.mjs";

// ============================================================================
// Binary Readers
// ============================================================================

/** @param {Uint8Array} d @param {number} o @returns {number} */
function r16(d, o) { return (d[o] << 8) | d[o + 1]; }

/** @param {Uint8Array} d @param {number} o @returns {number} */
function ri16(d, o) { const v = (d[o] << 8) | d[o + 1]; return v >= 0x8000 ? v - 0x10000 : v; }

/** @param {Uint8Array} d @param {number} o @returns {number} */
function r32(d, o) { return ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0; }

// ============================================================================
// Table Directory
// ============================================================================

/**
 * @typedef {Object} TtfTableEntry
 * @property {number} offset
 * @property {number} length
 */

/**
 * @param {Uint8Array} data
 * @returns {Map<string, TtfTableEntry>}
 */
function parseTables(data) {
    const numTables = r16(data, 4);
    /** @type {Map<string, TtfTableEntry>} */
    const tables = new Map();
    for (let i = 0; i < numTables; i++) {
        const base = 12 + i * 16;
        const tag = String.fromCharCode(data[base], data[base + 1], data[base + 2], data[base + 3]);
        tables.set(tag, { offset: r32(data, base + 8), length: r32(data, base + 12) });
    }
    return tables;
}

// ============================================================================
// head / hhea
// ============================================================================

/**
 * @param {Uint8Array} d @param {number} o
 * @returns {{ unitsPerEm: number; xMin: number; yMin: number; xMax: number; yMax: number }}
 */
function parseHead(d, o) {
    return {
        unitsPerEm: r16(d, o + 18),
        xMin: ri16(d, o + 36),
        yMin: ri16(d, o + 38),
        xMax: ri16(d, o + 40),
        yMax: ri16(d, o + 42)
    };
}

/**
 * @param {Uint8Array} d @param {number} o
 * @returns {{ ascender: number; descender: number; numberOfHMetrics: number }}
 */
function parseHhea(d, o) {
    return {
        ascender: ri16(d, o + 4),
        descender: ri16(d, o + 6),
        numberOfHMetrics: r16(d, o + 34)
    };
}

// ============================================================================
// hmtx - returns a per-glyphId advance width lookup
// ============================================================================

/**
 * @param {Uint8Array} d
 * @param {number} offset
 * @param {number} numberOfHMetrics
 * @returns {(glyphId: number) => number}
 */
function parseHmtx(d, offset, numberOfHMetrics) {
    const lastWidth = r16(d, offset + (numberOfHMetrics - 1) * 4);
    return (glyphId) => {
        if (glyphId < numberOfHMetrics) {
            return r16(d, offset + glyphId * 4);
        }
        return lastWidth;
    };
}

// ============================================================================
// cmap - format 4 (Windows/Unicode BMP)
// ============================================================================

/**
 * Parse cmap format 4 subtable.
 * Returns a Uint16Array[256] mapping char codes 0-255 to glyph IDs.
 * @param {Uint8Array} d
 * @param {number} base - absolute byte offset of the format 4 subtable
 * @returns {Uint16Array}
 */
function parseCmapFmt4(d, base) {
    const glyphIds = new Uint16Array(256);
    const segCount = r16(d, base + 6) >> 1;

    const endBase = base + 14;
    const startBase = endBase + 2 + segCount * 2;
    const deltaBase = startBase + segCount * 2;
    const rangeBase = deltaBase + segCount * 2;

    for (let c = 0; c < 256; c++) {
        let segIdx = -1;
        for (let s = 0; s < segCount; s++) {
            if (c <= r16(d, endBase + s * 2)) {
                if (c >= r16(d, startBase + s * 2)) {
                    segIdx = s;
                }
                break;
            }
        }
        if (segIdx < 0) { continue; }

        const rangeOffset = r16(d, rangeBase + segIdx * 2);
        let gid;
        if (rangeOffset === 0) {
            gid = (c + ri16(d, deltaBase + segIdx * 2)) & 0xffff;
        } else {
            // idRangeOffset is relative to the position of that entry in the array
            const pos = rangeBase + segIdx * 2 + rangeOffset + (c - r16(d, startBase + segIdx * 2)) * 2;
            gid = r16(d, pos);
            if (gid !== 0) {
                gid = (gid + ri16(d, deltaBase + segIdx * 2)) & 0xffff;
            }
        }
        glyphIds[c] = gid;
    }
    return glyphIds;
}

/**
 * Find best format-4 cmap subtable and return char-to-glyphId for 0..255.
 * @param {Uint8Array} d
 * @param {number} offset - cmap table offset
 * @returns {Uint16Array}
 */
function parseCmap(d, offset) {
    const numTables = r16(d, offset + 2);
    let bestOffset = -1;
    let bestPriority = -1;

    for (let i = 0; i < numTables; i++) {
        const base = offset + 4 + i * 8;
        const platformId = r16(d, base);
        const encodingId = r16(d, base + 2);
        const subtableOff = r32(d, base + 4);
        if (r16(d, offset + subtableOff) !== 4) { continue; }

        let priority = 0;
        if (platformId === 3 && encodingId === 1) { priority = 3; }       // Windows Unicode BMP
        else if (platformId === 0 && encodingId === 3) { priority = 2; }   // Unicode 2.0 BMP
        else if (platformId === 0) { priority = 1; }

        if (priority > bestPriority) {
            bestPriority = priority;
            bestOffset = subtableOff;
        }
    }

    if (bestOffset < 0) {
        // Identity fallback
        const ids = new Uint16Array(256);
        for (let i = 0; i < 256; i++) { ids[i] = i; }
        return ids;
    }
    return parseCmapFmt4(d, offset + bestOffset);
}

// ============================================================================
// name table
// ============================================================================

/**
 * Extract a name record by nameId.
 * Prefers platform 3 (Windows/UTF-16BE), falls back to platform 1 (Mac Roman).
 * @param {Uint8Array} d
 * @param {number} offset
 * @param {number} nameId
 * @returns {string}
 */
function extractName(d, offset, nameId) {
    const count = r16(d, offset + 2);
    const storageBase = offset + r16(d, offset + 4);
    let macResult = "";

    for (let i = 0; i < count; i++) {
        const base = offset + 6 + i * 12;
        if (r16(d, base + 6) !== nameId) { continue; }
        const platformId = r16(d, base);
        const len = r16(d, base + 8);
        const strBase = storageBase + r16(d, base + 10);

        if (platformId === 3 || platformId === 0) {
            // UTF-16BE
            let s = "";
            for (let j = 0; j < len; j += 2) { s += String.fromCharCode(r16(d, strBase + j)); }
            if (s.length > 0) { return s; }
        } else if (platformId === 1 && macResult.length === 0) {
            let s = "";
            for (let j = 0; j < len; j++) { s += String.fromCharCode(d[strBase + j]); }
            macResult = s;
        }
    }
    return macResult;
}

// ============================================================================
// Main Parse Function
// ============================================================================

/**
 * @typedef {Object} TtfParsed
 * @property {string} familyName
 * @property {string} postScriptName - no spaces, suitable for use as PDF BaseFont
 * @property {number} unitsPerEm
 * @property {number} ascender     - in font units
 * @property {number} descender    - in font units (negative)
 * @property {number} capHeight    - in font units
 * @property {number} italicAngle
 * @property {number} xMin  - scaled to per-1000
 * @property {number} yMin  - scaled to per-1000
 * @property {number} xMax  - scaled to per-1000
 * @property {number} yMax  - scaled to per-1000
 * @property {number} flags - PDF FontDescriptor flags bitmask
 * @property {Float64Array} charWidths - per-1000 advance widths, indexed by char code 0..255
 * @property {Uint8Array} rawBytes
 */

/**
 * Parse a TrueType / OpenType (TT outlines) font file.
 * @param {Uint8Array} fontBytes
 * @returns {TtfParsed}
 */
export function parseTtfFont(fontBytes) {
    const tables = parseTables(fontBytes);

    const headEntry = tables.get("head");
    const hheaEntry = tables.get("hhea");
    const hmtxEntry = tables.get("hmtx");
    const cmapEntry = tables.get("cmap");
    if (!headEntry) { throw new Error("TTF: missing head table"); }
    if (!hheaEntry) { throw new Error("TTF: missing hhea table"); }
    if (!hmtxEntry) { throw new Error("TTF: missing hmtx table"); }
    if (!cmapEntry) { throw new Error("TTF: missing cmap table"); }

    const head = parseHead(fontBytes, headEntry.offset);
    const hhea = parseHhea(fontBytes, hheaEntry.offset);
    const getWidth = parseHmtx(fontBytes, hmtxEntry.offset, hhea.numberOfHMetrics);
    const charToGlyph = parseCmap(fontBytes, cmapEntry.offset);

    // Build per-char-code widths in per-1000 units (for PDF Widths array)
    const charWidths = new Float64Array(256);
    for (let c = 0; c < 256; c++) {
        const gid = charToGlyph[c];
        charWidths[c] = gid > 0 ? (getWidth(gid) / head.unitsPerEm) * 1000 : 0;
    }

    // name table
    let familyName = "UnknownFont";
    let postScriptName = "UnknownFont";
    const nameEntry = tables.get("name");
    if (nameEntry) {
        const fam = extractName(fontBytes, nameEntry.offset, 1);
        if (fam.length > 0) { familyName = fam; }
        const ps = extractName(fontBytes, nameEntry.offset, 6);
        postScriptName = ps.length > 0 ? ps : familyName.replace(/\s+/g, "-");
    }

    // OS/2: capHeight (v2+)
    let capHeight = Math.round(hhea.ascender * 0.7); // fallback estimate
    const os2Entry = tables.get("OS/2");
    if (os2Entry) {
        const version = r16(fontBytes, os2Entry.offset);
        if (version >= 2) {
            const sCapHeight = ri16(fontBytes, os2Entry.offset + 90);
            if (sCapHeight > 0) { capHeight = sCapHeight; }
        }
    }

    // post: italic angle (Fixed 16.16)
    let italicAngle = 0;
    const postEntry = tables.get("post");
    if (postEntry) {
        italicAngle = ri16(fontBytes, postEntry.offset + 4) +
            r16(fontBytes, postEntry.offset + 6) / 65536;
    }

    // PDF Flags: bit 6 = Nonsymbolic (32), bit 7 = Italic (64)
    let flags = 32;
    if (Math.abs(italicAngle) > 0.1) { flags |= 64; }

    const scale = 1000 / head.unitsPerEm;
    return {
        familyName,
        postScriptName,
        unitsPerEm: head.unitsPerEm,
        ascender: hhea.ascender,
        descender: hhea.descender,
        capHeight,
        italicAngle,
        xMin: Math.round(head.xMin * scale),
        yMin: Math.round(head.yMin * scale),
        xMax: Math.round(head.xMax * scale),
        yMax: Math.round(head.yMax * scale),
        flags,
        charWidths,
        rawBytes: fontBytes
    };
}

// ============================================================================
// PDF Font Object Builders
// ============================================================================

/**
 * Build the TrueType font dictionary (references FontDescriptor).
 * Covers WinAnsiEncoding char codes 32..255.
 * @param {TtfParsed} parsed
 * @param {number} descriptorId
 * @returns {string}
 */
export function buildTtfFontDict(parsed, descriptorId) {
    const widths = [];
    for (let c = 32; c <= 255; c++) {
        widths.push(String(Math.round(parsed.charWidths[c])));
    }
    return formatDictionary({
        Type: "/Font",
        Subtype: "/TrueType",
        BaseFont: "/" + parsed.postScriptName,
        FirstChar: "32",
        LastChar: "255",
        Widths: formatArray(widths),
        FontDescriptor: formatRef(descriptorId),
        Encoding: "/WinAnsiEncoding"
    });
}

/**
 * Build the FontDescriptor dictionary (references FontFile2 stream).
 * @param {TtfParsed} parsed
 * @param {number} fileStreamId
 * @returns {string}
 */
export function buildFontDescriptor(parsed, fileStreamId) {
    const scale = 1000 / parsed.unitsPerEm;
    return formatDictionary({
        Type: "/FontDescriptor",
        FontName: "/" + parsed.postScriptName,
        Flags: String(parsed.flags),
        FontBBox: formatArray([
            String(parsed.xMin),
            String(parsed.yMin),
            String(parsed.xMax),
            String(parsed.yMax)
        ]),
        ItalicAngle: String(parsed.italicAngle),
        Ascent: String(Math.round(parsed.ascender * scale)),
        Descent: String(Math.round(parsed.descender * scale)),
        CapHeight: String(Math.round(parsed.capHeight * scale)),
        StemV: "80",
        FontFile2: formatRef(fileStreamId)
    });
}

export default { parseTtfFont, buildTtfFontDict, buildFontDescriptor };
