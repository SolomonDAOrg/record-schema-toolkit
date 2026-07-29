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
function r16(d, o) {
    return (d[o] << 8) | d[o + 1];
}

/** @param {Uint8Array} d @param {number} o @returns {number} */
function ri16(d, o) {
    const v = (d[o] << 8) | d[o + 1];
    return v >= 0x8000 ? v - 0x10000 : v;
}

/** @param {Uint8Array} d @param {number} o @returns {number} */
function r32(d, o) {
    return ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
}

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
        const tag = String.fromCharCode(
            data[base],
            data[base + 1],
            data[base + 2],
            data[base + 3]
        );
        tables.set(tag, {
            offset: r32(data, base + 8),
            length: r32(data, base + 12)
        });
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
 * Build a glyph lookup for a cmap format 4 subtable.
 * @param {Uint8Array} d
 * @param {number} base - absolute byte offset of the format 4 subtable
 * @returns {(codePoint: number) => number}
 */
function parseCmapFmt4(d, base) {
    const segCount = r16(d, base + 6) >> 1;

    const endBase = base + 14;
    const startBase = endBase + 2 + segCount * 2;
    const deltaBase = startBase + segCount * 2;
    const rangeBase = deltaBase + segCount * 2;

    const endCodes = new Uint16Array(segCount);
    const startCodes = new Uint16Array(segCount);
    const idDeltas = new Int16Array(segCount);
    const idRangeOffsets = new Uint16Array(segCount);

    for (let i = 0; i < segCount; i++) {
        endCodes[i] = r16(d, endBase + i * 2);
        startCodes[i] = r16(d, startBase + i * 2);
        idDeltas[i] = ri16(d, deltaBase + i * 2);
        idRangeOffsets[i] = r16(d, rangeBase + i * 2);
    }

    return (codePoint) => {
        if (codePoint < 0 || codePoint > 0xffff) {
            return 0;
        }

        let lo = 0;
        let hi = segCount - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const endCode = endCodes[mid];
            if (codePoint > endCode) {
                lo = mid + 1;
                continue;
            }

            const startCode = startCodes[mid];
            if (codePoint < startCode) {
                hi = mid - 1;
                continue;
            }

            const rangeOffset = idRangeOffsets[mid];
            if (rangeOffset === 0) {
                return (codePoint + idDeltas[mid]) & 0xffff;
            }

            const pos =
                rangeBase + mid * 2 + rangeOffset + (codePoint - startCode) * 2;

            let glyphId = r16(d, pos);
            if (glyphId !== 0) {
                glyphId = (glyphId + idDeltas[mid]) & 0xffff;
            }
            return glyphId;
        }

        return 0;
    };
}

/**
 * Build a glyph lookup for a cmap format 12 subtable.
 * @param {Uint8Array} d
 * @param {number} base - absolute byte offset of the format 12 subtable
 * @returns {(codePoint: number) => number}
 */
function parseCmapFmt12(d, base) {
    const nGroups = r32(d, base + 12);
    const groupsBase = base + 16;

    const startCodes = new Uint32Array(nGroups);
    const endCodes = new Uint32Array(nGroups);
    const startGlyphIds = new Uint32Array(nGroups);

    for (let i = 0; i < nGroups; i++) {
        const groupBase = groupsBase + i * 12;
        startCodes[i] = r32(d, groupBase);
        endCodes[i] = r32(d, groupBase + 4);
        startGlyphIds[i] = r32(d, groupBase + 8);
    }

    return (codePoint) => {
        if (codePoint < 0) {
            return 0;
        }

        let lo = 0;
        let hi = nGroups - 1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (codePoint < startCodes[mid]) {
                hi = mid - 1;
                continue;
            }
            if (codePoint > endCodes[mid]) {
                lo = mid + 1;
                continue;
            }
            return startGlyphIds[mid] + (codePoint - startCodes[mid]);
        }

        return 0;
    };
}

/**
 * Find the best cmap subtable(s) and return a codePoint → glyphId lookup.
 * Prefers format 12 when available so supplementary-plane code points measure
 * correctly; otherwise falls back to format 4.
 * @param {Uint8Array} d
 * @param {number} offset - cmap table offset
 * @returns {(codePoint: number) => number}
 */
function parseCmap(d, offset) {
    const numTables = r16(d, offset + 2);

    /** @type {{ priority: number, subtableOffset: number } | null} */
    let bestFmt4 = null;
    /** @type {{ priority: number, subtableOffset: number } | null} */
    let bestFmt12 = null;

    for (let i = 0; i < numTables; i++) {
        const base = offset + 4 + i * 8;
        const platformId = r16(d, base);
        const encodingId = r16(d, base + 2);
        const subtableOff = r32(d, base + 4);
        const format = r16(d, offset + subtableOff);

        let priority = -1;
        if (format === 12) {
            if (platformId === 3 && encodingId === 10) {
                priority = 5;
            } else if (
                platformId === 0 &&
                (encodingId === 4 || encodingId === 6)
            ) {
                priority = 4;
            } else if (platformId === 0) {
                priority = 3;
            }

            if (priority > (bestFmt12?.priority ?? -1)) {
                bestFmt12 = { priority, subtableOffset: subtableOff };
            }
            continue;
        }

        if (format !== 4) {
            continue;
        }

        if (platformId === 3 && encodingId === 1) {
            priority = 3;
        } else if (platformId === 0 && encodingId === 3) {
            priority = 2;
        } else if (platformId === 0) {
            priority = 1;
        }

        if (priority > (bestFmt4?.priority ?? -1)) {
            bestFmt4 = { priority, subtableOffset: subtableOff };
        }
    }

    if (bestFmt12) {
        return parseCmapFmt12(d, offset + bestFmt12.subtableOffset);
    }
    if (bestFmt4) {
        return parseCmapFmt4(d, offset + bestFmt4.subtableOffset);
    }

    return (codePoint) => {
        return codePoint >= 0 && codePoint <= 0xffff ? codePoint : 0;
    };
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
        if (r16(d, base + 6) !== nameId) {
            continue;
        }
        const platformId = r16(d, base);
        const len = r16(d, base + 8);
        const strBase = storageBase + r16(d, base + 10);

        if (platformId === 3 || platformId === 0) {
            // UTF-16BE
            let s = "";
            for (let j = 0; j < len; j += 2) {
                s += String.fromCharCode(r16(d, strBase + j));
            }
            if (s.length > 0) {
                return s;
            }
        } else if (platformId === 1 && macResult.length === 0) {
            let s = "";
            for (let j = 0; j < len; j++) {
                s += String.fromCharCode(d[strBase + j]);
            }
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
 * @property {(codePoint: number) => number} glyphIdForCodePoint
 * @property {(codePoint: number) => number} widthForCodePoint
 * @property {(glyphId: number) => number} widthForGlyphId - per-1000 advance width by glyph id
 * @property {number} missingWidth - per-1000 width used when glyph lookup fails
 * @property {boolean} isCFF - true for OpenType-CFF (OTTO) fonts (vs TrueType outlines)
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
    if (!headEntry) {
        throw new Error("TTF: missing head table");
    }
    if (!hheaEntry) {
        throw new Error("TTF: missing hhea table");
    }
    if (!hmtxEntry) {
        throw new Error("TTF: missing hmtx table");
    }
    if (!cmapEntry) {
        throw new Error("TTF: missing cmap table");
    }

    const head = parseHead(fontBytes, headEntry.offset);
    const hhea = parseHhea(fontBytes, hheaEntry.offset);
    const getWidth = parseHmtx(
        fontBytes,
        hmtxEntry.offset,
        hhea.numberOfHMetrics
    );
    const glyphIdForCodePoint = parseCmap(fontBytes, cmapEntry.offset);
    const widthScale = 1000 / head.unitsPerEm;
    const glyphZeroWidth = getWidth(0);
    const missingWidth = glyphZeroWidth > 0 ? glyphZeroWidth * widthScale : 500;

    const widthForCodePoint = (codePoint) => {
        const glyphId = glyphIdForCodePoint(codePoint);
        if (glyphId > 0) {
            return getWidth(glyphId) * widthScale;
        }
        return missingWidth;
    };

    // Build per-char-code widths in per-1000 units (for PDF Widths array)
    const charWidths = new Float64Array(256);
    for (let c = 0; c < 256; c++) {
        charWidths[c] = widthForCodePoint(c);
    }

    // name table
    let familyName = "UnknownFont";
    let postScriptName = "UnknownFont";
    const nameEntry = tables.get("name");
    if (nameEntry) {
        const fam = extractName(fontBytes, nameEntry.offset, 1);
        if (fam.length > 0) {
            familyName = fam;
        }
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
            if (sCapHeight > 0) {
                capHeight = sCapHeight;
            }
        }
    }

    // post: italic angle (Fixed 16.16)
    let italicAngle = 0;
    const postEntry = tables.get("post");
    if (postEntry) {
        italicAngle =
            ri16(fontBytes, postEntry.offset + 4) +
            r16(fontBytes, postEntry.offset + 6) / 65536;
    }

    // PDF Flags: bit 6 = Nonsymbolic (32), bit 7 = Italic (64)
    let flags = 32;
    if (Math.abs(italicAngle) > 0.1) {
        flags |= 64;
    }

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
        glyphIdForCodePoint,
        widthForCodePoint,
        widthForGlyphId: (glyphId) => getWidth(glyphId) * widthScale,
        missingWidth,
        isCFF: tables.has("CFF ") || tables.has("CFF"),
        rawBytes: fontBytes
    };
}

// ============================================================================
// PDF Font Object Builders
// ============================================================================

/**
 * Windows-1252 (WinAnsiEncoding) code -> Unicode scalar, for the slots in
 * 0x80..0x9F where cp1252 differs from ISO-8859-1. Every other code in
 * 0x20..0xFF maps to itself (identity), so only the exceptions are listed.
 * Codes undefined in cp1252 (0x81/0x8D/0x8F/0x90/0x9D) fall back to identity.
 * @type {Record<number, number>}
 */
const WINANSI_TO_UNICODE_OVERRIDES = {
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

/** @param {number} n @returns {string} */
function hex2(n) {
    return n.toString(16).toUpperCase().padStart(2, "0");
}

/** @param {number} n @returns {string} */
function hex4(n) {
    return n.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Build a /ToUnicode CMap program mapping single-byte WinAnsi char codes
 * (0x20..0xFF) to Unicode, so extracted/copied text and screen readers get
 * real characters instead of raw glyph codes.
 *
 * The mapping is identical for every simple WinAnsi font, so one CMap stream
 * can be shared across all embedded fonts in a document.
 * @returns {string}
 */
export function buildToUnicodeCMap() {
    /** @type {{ code: number; uni: number }[]} */
    const entries = [];
    for (let c = 0x20; c <= 0xff; c++) {
        const override = WINANSI_TO_UNICODE_OVERRIDES[c];
        entries.push({ code: c, uni: override !== undefined ? override : c });
    }

    // bfchar blocks are limited to 100 entries each.
    let body = "";
    for (let i = 0, len = entries.length; i < len; i += 100) {
        const block = entries.slice(i, i + 100);
        body = body + block.length + " beginbfchar\n";
        for (let j = 0, blen = block.length; j < blen; j++) {
            body =
                body +
                "<" +
                hex2(block[j].code) +
                "> <" +
                hex4(block[j].uni) +
                ">\n";
        }
        body = body + "endbfchar\n";
    }

    return (
        "/CIDInit /ProcSet findresource begin\n" +
        "12 dict begin\n" +
        "begincmap\n" +
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n" +
        "/CMapName /Adobe-Identity-UCS def\n" +
        "/CMapType 2 def\n" +
        "1 begincodespacerange\n" +
        "<00> <FF>\n" +
        "endcodespacerange\n" +
        body +
        "endcmap\n" +
        "CMapName currentdict /CMap defineresource pop\n" +
        "end\n" +
        "end\n"
    );
}

/**
 * Build the TrueType font dictionary (references FontDescriptor).
 * Covers WinAnsiEncoding char codes 32..255.
 * @param {TtfParsed} parsed
 * @param {number} descriptorId
 * @param {number} [toUnicodeId] - object ID of a shared /ToUnicode CMap stream
 * @returns {string}
 */
export function buildTtfFontDict(parsed, descriptorId, toUnicodeId) {
    const widths = [];
    for (let c = 32; c <= 255; c++) {
        widths.push(String(Math.round(parsed.charWidths[c])));
    }
    /** @type {Record<string, string>} */
    const dict = {
        Type: "/Font",
        Subtype: "/TrueType",
        BaseFont: "/" + parsed.postScriptName,
        FirstChar: "32",
        LastChar: "255",
        Widths: formatArray(widths),
        FontDescriptor: formatRef(descriptorId),
        Encoding: "/WinAnsiEncoding"
    };
    if (toUnicodeId !== undefined) {
        dict.ToUnicode = formatRef(toUnicodeId);
    }
    return formatDictionary(dict);
}

/**
 * Build the FontDescriptor dictionary (references FontFile2 stream).
 * @param {TtfParsed} parsed
 * @param {number} fileStreamId
 * @returns {string}
 */
export function buildFontDescriptor(parsed, fileStreamId, fontName) {
    const scale = 1000 / parsed.unitsPerEm;
    return formatDictionary({
        Type: "/FontDescriptor",
        FontName: "/" + (fontName || parsed.postScriptName),
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

/**
 * FontDescriptor for a CFF (OpenType) font — references FontFile3 rather than
 * FontFile2.
 * @param {TtfParsed} parsed
 * @param {number} fileStreamId - FontFile3 stream id
 * @param {string} [fontName]
 * @returns {string}
 */
export function buildFontDescriptorCFF(parsed, fileStreamId, fontName) {
    const scale = 1000 / parsed.unitsPerEm;
    return formatDictionary({
        Type: "/FontDescriptor",
        FontName: "/" + (fontName || parsed.postScriptName),
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
        FontFile3: formatRef(fileStreamId)
    });
}

/**
 * Descendant CIDFontType0 dictionary for a CFF OpenType font. No CIDToGIDMap:
 * with an embedded name-keyed CFF the CID is used directly as the glyph index.
 * @param {TtfParsed} parsed
 * @param {number} descriptorId
 * @param {string} wArray
 * @param {string} [fontName]
 * @returns {string}
 */
export function buildCIDFontDictCFF(parsed, descriptorId, wArray, fontName) {
    /** @type {Record<string, string>} */
    const dict = {
        Type: "/Font",
        Subtype: "/CIDFontType0",
        BaseFont: "/" + (fontName || parsed.postScriptName),
        CIDSystemInfo:
            "<< /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>",
        FontDescriptor: formatRef(descriptorId),
        DW: "1000"
    };
    if (wArray && wArray !== "[]") {
        dict.W = wArray;
    }
    return formatDictionary(dict);
}

export default {
    parseTtfFont,
    buildTtfFontDict,
    buildFontDescriptor,
    buildToUnicodeCMap,
    buildType0FontDict,
    buildCIDFontDict,
    buildCIDWArray,
    buildCIDToUnicodeCMap
};

// ============================================================================
// Type0 / CIDFontType2 (full Unicode via Identity-H)
// ============================================================================

/**
 * Build the Type0 (composite) font dictionary. Uses Identity-H encoding, so the
 * content stream carries 2-byte glyph ids directly.
 * @param {TtfParsed} parsed
 * @param {number} cidFontId - descendant CIDFontType2 object id
 * @param {number} toUnicodeId - GID->Unicode CMap stream id
 * @returns {string}
 */
export function buildType0FontDict(parsed, cidFontId, toUnicodeId, fontName) {
    return formatDictionary({
        Type: "/Font",
        Subtype: "/Type0",
        BaseFont: "/" + (fontName || parsed.postScriptName),
        Encoding: "/Identity-H",
        DescendantFonts: "[" + formatRef(cidFontId) + "]",
        ToUnicode: formatRef(toUnicodeId)
    });
}

/**
 * Build the descendant CIDFontType2 dictionary.
 * @param {TtfParsed} parsed
 * @param {number} descriptorId
 * @param {string} wArray - the /W widths array (e.g. "[3 [600] 7 [500]]")
 * @returns {string}
 */
export function buildCIDFontDict(parsed, descriptorId, wArray, fontName) {
    /** @type {Record<string, string>} */
    const dict = {
        Type: "/Font",
        Subtype: "/CIDFontType2",
        BaseFont: "/" + (fontName || parsed.postScriptName),
        CIDSystemInfo:
            "<< /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>",
        FontDescriptor: formatRef(descriptorId),
        CIDToGIDMap: "/Identity",
        DW: "1000"
    };
    if (wArray && wArray !== "[]") {
        dict.W = wArray;
    }
    return formatDictionary(dict);
}

/**
 * Build the /W widths array for a set of used glyph ids (one entry per glyph).
 * @param {Iterable<number>} glyphIds
 * @param {TtfParsed} parsed
 * @returns {string}
 */
export function buildCIDWArray(glyphIds, parsed) {
    const gids = Array.from(glyphIds).sort((a, b) => a - b);
    let out = "[";
    for (let i = 0, len = gids.length; i < len; i++) {
        const gid = gids[i];
        const w = Math.round(parsed.widthForGlyphId(gid));
        out = out + (i > 0 ? " " : "") + gid + " [" + w + "]";
    }
    return out + "]";
}

/** @param {number} cp @returns {string} UTF-16BE hex (surrogate pair if needed) */
function utf16beHexCP(cp) {
    if (cp <= 0xffff) {
        return hex4(cp);
    }
    const v = cp - 0x10000;
    const hi = 0xd800 + (v >> 10);
    const lo = 0xdc00 + (v & 0x3ff);
    return hex4(hi) + hex4(lo);
}

/**
 * Build a /ToUnicode CMap for a composite font: maps each 2-byte glyph id (CID,
 * since CIDToGIDMap is Identity) to its Unicode scalar so extracted text is
 * correct even for glyphs beyond WinAnsi.
 * @param {Map<number, number>} glyphToCodePoint - gid -> Unicode code point
 * @returns {string}
 */
export function buildCIDToUnicodeCMap(glyphToCodePoint) {
    const entries = Array.from(glyphToCodePoint.entries())
        .filter(([gid]) => gid !== 0)
        .sort((a, b) => a[0] - b[0]);

    let body = "";
    for (let i = 0, len = entries.length; i < len; i += 100) {
        const block = entries.slice(i, i + 100);
        body = body + block.length + " beginbfchar\n";
        for (let j = 0, blen = block.length; j < blen; j++) {
            body =
                body +
                "<" +
                hex4(block[j][0]) +
                "> <" +
                utf16beHexCP(block[j][1]) +
                ">\n";
        }
        body = body + "endbfchar\n";
    }

    return (
        "/CIDInit /ProcSet findresource begin\n" +
        "12 dict begin\n" +
        "begincmap\n" +
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n" +
        "/CMapName /Adobe-Identity-UCS def\n" +
        "/CMapType 2 def\n" +
        "1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n" +
        body +
        "endcmap\n" +
        "CMapName currentdict /CMap defineresource pop\n" +
        "end\nend\n"
    );
}
