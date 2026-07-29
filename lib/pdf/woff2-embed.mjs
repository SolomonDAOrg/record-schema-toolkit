/**
 * WOFF2 Font Decompression and Embedding
 * Uses node:zlib Brotli (built-in since Node 10.16). No external dependencies.
 *
 * Implements the W3C WOFF2 specification:
 * https://www.w3.org/TR/WOFF2/
 *
 * Supports TrueType-outline WOFF2 fonts (flavor 0x00010000).
 * CFF-outline WOFF2 (flavor 'OTTO') is not supported.
 *
 * @module Woff2Embed
 */

import { brotliDecompressSync } from "node:zlib";
import { parseTtfFont } from "./font-embed.mjs";

// ============================================================================
// WOFF2 Known Table Tag Index  (Table 1 in the spec)
// ============================================================================

const KNOWN_TAGS = [
    "cmap",
    "head",
    "hhea",
    "hmtx",
    "maxp",
    "name",
    "OS/2",
    "post",
    "cvt ",
    "fpgm",
    "glyf",
    "loca",
    "prep",
    "CFF ",
    "VORG",
    "EBDT",
    "EBLC",
    "gasp",
    "hdmx",
    "kern",
    "LTSH",
    "PCLT",
    "VDMX",
    "vhea",
    "vmtx",
    "BASE",
    "GDEF",
    "GPOS",
    "GSUB",
    "EBSC",
    "JSTF",
    "MATH",
    "CBDT",
    "CBLC",
    "COLR",
    "CPAL",
    "SVG ",
    "sbix",
    "acnt",
    "avar",
    "bdat",
    "bloc",
    "bsln",
    "cvar",
    "fdsc",
    "feat",
    "fmtx",
    "fvar",
    "gvar",
    "hsty",
    "just",
    "lcar",
    "mort",
    "morx",
    "opbd",
    "prop",
    "trak",
    "Zapf",
    "Silf",
    "Glat",
    "Gloc",
    "Feat",
    "Sill"
];

// ============================================================================
// Binary Helpers
// ============================================================================

/** @param {Uint8Array} d @param {number} o @returns {number} */
function ru16(d, o) {
    return (d[o] << 8) | d[o + 1];
}

/** @param {Uint8Array} d @param {number} o @returns {number} */
function ri16(d, o) {
    const v = ru16(d, o);
    return v >= 0x8000 ? v - 0x10000 : v;
}

/** @param {Uint8Array} d @param {number} o @returns {number} */
function ru32(d, o) {
    return ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0;
}

/** @param {Uint8Array} buf @param {number} o @param {number} v */
function wu16(buf, o, v) {
    buf[o] = (v >> 8) & 0xff;
    buf[o + 1] = v & 0xff;
}

/** @param {Uint8Array} buf @param {number} o @param {number} v */
function wi16(buf, o, v) {
    if (v < 0) {
        v += 0x10000;
    }
    wu16(buf, o, v);
}

/** @param {Uint8Array} buf @param {number} o @param {number} v */
function wu32(buf, o, v) {
    v = v >>> 0;
    buf[o] = (v >> 24) & 0xff;
    buf[o + 1] = (v >> 16) & 0xff;
    buf[o + 2] = (v >> 8) & 0xff;
    buf[o + 3] = v & 0xff;
}

/**
 * @param {Uint8Array[]} arrays
 * @returns {Uint8Array}
 */
function concat(arrays) {
    let n = 0;
    for (let i = 0; i < arrays.length; i++) {
        n += arrays[i].length;
    }
    const out = new Uint8Array(n);
    let p = 0;
    for (let i = 0; i < arrays.length; i++) {
        out.set(arrays[i], p);
        p += arrays[i].length;
    }
    return out;
}

/**
 * Pad Uint8Array to 4-byte boundary with zero bytes.
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
function pad4(data) {
    const rem = data.length & 3;
    if (rem === 0) {
        return data;
    }
    const out = new Uint8Array(data.length + (4 - rem));
    out.set(data);
    return out;
}

// ============================================================================
// Variable-Length Integer Decoders
// ============================================================================

/**
 * Decode a UBase128 variable-length unsigned integer from byte stream.
 * Returns [value, newPos].
 * @param {Uint8Array} d
 * @param {number} pos
 * @returns {[number, number]}
 */
function readUBase128(d, pos) {
    let value = 0;
    for (let i = 0; i < 5; i++) {
        const b = d[pos++];
        if (i === 0 && b === 0x80) {
            throw new Error("WOFF2: invalid UBase128 (leading zero byte)");
        }
        value = (value << 7) | (b & 0x7f);
        if (!(b & 0x80)) {
            return [value >>> 0, pos];
        }
    }
    throw new Error("WOFF2: UBase128 overflow");
}

/**
 * Decode a 255UInt16 variable-length unsigned integer from byte stream.
 * Returns [value, newPos].
 * @param {Uint8Array} d
 * @param {number} pos
 * @returns {[number, number]}
 */
function read255UInt16(d, pos) {
    const b0 = d[pos++];
    if (b0 < 253) {
        return [b0, pos];
    }
    if (b0 === 253) {
        const v = (d[pos] << 8) | d[pos + 1];
        pos += 2;
        return [v, pos];
    }
    if (b0 === 254) {
        const v = (d[pos] << 8) | d[pos + 1];
        pos += 2;
        return [v + 506, pos]; // 506 = 2 × 253
    }
    // b0 === 255
    const b1 = d[pos++],
        b2 = d[pos++];
    return [b1 * 253 + b2, pos];
}

// ============================================================================
// WOFF2 Glyf Transform: Triplet Coordinate Decoder
// ============================================================================

/**
 * Decode a glyph point coordinate triplet.
 * Based on W3C WOFF2 spec Section 5.2.2.
 *
 * Ranges:
 *   xyFlag  0-9:  x=0, 1-byte y  (±1..±1280)
 *   xyFlag 10-19: 1-byte x, y=0  (±1..±1280)
 *   xyFlag 20-83: 1-byte x, 1-byte y (±1..±256 each, 6 significant bits per byte)
 *   xyFlag 84+:   2-byte signed int16 per axis (fallback for large deltas)
 *
 * @param {number} xyFlag - Lower 7 bits of point flag byte
 * @param {Uint8Array} gs - Glyph stream
 * @param {number} pos - Current position in glyph stream
 * @returns {[number, number, number]} [dx, dy, newPos]
 */
function decodeTriplet(xyFlag, gs, pos) {
    let dx = 0,
        dy = 0;

    if (xyFlag < 10) {
        // x = 0, y = 1 byte.  Groups of 5: [0..4] positive, [5..9] negative.
        const yb = gs[pos++];
        dy =
            xyFlag < 5 ? xyFlag * 256 + yb + 1 : -((xyFlag - 5) * 256 + yb + 1);
    } else if (xyFlag < 20) {
        // y = 0, x = 1 byte.  Same grouping.
        const f = xyFlag - 10;
        const xb = gs[pos++];
        dx = f < 5 ? f * 256 + xb + 1 : -((f - 5) * 256 + xb + 1);
    } else if (xyFlag < 84) {
        // Both x and y, 1 byte each (only low 6 bits meaningful per byte).
        // f (0..63) bit layout:
        //   bit 0:   x negative
        //   bit 1:   y negative
        //   bits 2-3: x sub-range (adds x_sub*64 to base)
        //   bits 4-5: y sub-range (adds y_sub*64 to base)
        const f = xyFlag - 20;
        const xb = gs[pos++] & 63;
        const yb = gs[pos++] & 63;
        const xNeg = (f & 1) !== 0;
        const yNeg = (f & 2) !== 0;
        const xOff = ((f >> 2) & 3) * 64;
        const yOff = ((f >> 4) & 3) * 64;
        dx = xNeg ? -(xOff + xb + 1) : xOff + xb + 1;
        dy = yNeg ? -(yOff + yb + 1) : yOff + yb + 1;
    } else {
        // Large deltas: signed int16 per axis.
        // xyFlag 84-127 are defined in the spec for larger values; we treat all as int16.
        const xRaw = (gs[pos] << 8) | gs[pos + 1];
        pos += 2;
        const yRaw = (gs[pos] << 8) | gs[pos + 1];
        pos += 2;
        dx = xRaw >= 0x8000 ? xRaw - 0x10000 : xRaw;
        dy = yRaw >= 0x8000 ? yRaw - 0x10000 : yRaw;
    }

    return [dx, dy, pos];
}

// ============================================================================
// WOFF2 Glyf Transform Reconstruction
// ============================================================================

/**
 * Decode a signed int16 bounding-box value from bboxStream.
 * @param {Uint8Array} bs
 * @param {number} pos
 * @returns {number}
 */
function readBboxVal(bs, pos) {
    const v = ru16(bs, pos);
    return v >= 0x8000 ? v - 0x10000 : v;
}

/**
 * Reconstruct TrueType glyf and loca tables from a WOFF2-transformed glyf stream.
 *
 * @param {Uint8Array} tg - Transformed glyf data from the decompressed WOFF2 stream
 * @param {number} numGlyphs
 * @param {number} indexFormat - 0 = short loca, 1 = long loca
 * @returns {{ glyfData: Uint8Array; locaData: Uint8Array }}
 */
function reconstructGlyfLoca(tg, numGlyphs, indexFormat) {
    // ---- Parse transform header (36 bytes) ----
    let pos = 0;
    // reserved (2), optionFlags (2), numGlyphs (2), indexFormat (2)
    pos += 8; // skip reserved, optionFlags, numGlyphs, indexFormat
    const nContourStreamSize = ru32(tg, pos);
    pos += 4;
    const nPointsStreamSize = ru32(tg, pos);
    pos += 4;
    const flagStreamSize = ru32(tg, pos);
    pos += 4;
    const glyphStreamSize = ru32(tg, pos);
    pos += 4;
    const compositeStreamSize = ru32(tg, pos);
    pos += 4;
    const bboxStreamSize = ru32(tg, pos);
    pos += 4;
    const instructionStreamSize = ru32(tg, pos);
    pos += 4;

    // ---- Slice streams ----
    const nContourStream = tg.subarray(pos, pos + nContourStreamSize);
    pos += nContourStreamSize;
    const nPointsStream = tg.subarray(pos, pos + nPointsStreamSize);
    pos += nPointsStreamSize;
    const flagStream = tg.subarray(pos, pos + flagStreamSize);
    pos += flagStreamSize;
    const glyphStream = tg.subarray(pos, pos + glyphStreamSize);
    pos += glyphStreamSize;
    const compositeStream = tg.subarray(pos, pos + compositeStreamSize);
    pos += compositeStreamSize;
    // bboxStream = bboxBitmap + actual bbox records
    const bboxBitmapSize = (numGlyphs + 7) >> 3;
    const bboxBitmap = tg.subarray(pos, pos + bboxBitmapSize);
    const bboxData = tg.subarray(pos + bboxBitmapSize, pos + bboxStreamSize);
    pos += bboxStreamSize;
    const instructionStream = tg.subarray(pos, pos + instructionStreamSize);

    // ---- Reconstruct per-glyph data ----
    /** @type {Uint8Array[]} */
    const glyfChunks = [];
    const glyfOffsets = new Int32Array(numGlyphs + 1);
    let currentOffset = 0;

    let ncPos = 0; // nContourStream cursor
    let npPos = 0; // nPointsStream cursor
    let flPos = 0; // flagStream cursor
    let gsPos = 0; // glyphStream cursor
    let csPos = 0; // compositeStream cursor
    let bboxPos = 0; // bboxData cursor (records only, not bitmap)
    let instPos = 0; // instructionStream cursor

    for (let g = 0; g < numGlyphs; g++) {
        glyfOffsets[g] = currentOffset;

        const ncRaw = ru16(nContourStream, ncPos);
        ncPos += 2;
        const nContours = ncRaw >= 0x8000 ? ncRaw - 0x10000 : ncRaw;

        const hasBbox = (bboxBitmap[g >> 3] & (0x80 >> (g & 7))) !== 0;

        // Read explicit bbox (8 bytes) if present
        let xMin = 0,
            yMin = 0,
            xMax = 0,
            yMax = 0;
        if (hasBbox) {
            xMin = readBboxVal(bboxData, bboxPos);
            yMin = readBboxVal(bboxData, bboxPos + 2);
            xMax = readBboxVal(bboxData, bboxPos + 4);
            yMax = readBboxVal(bboxData, bboxPos + 6);
            bboxPos += 8;
        }

        if (nContours === 0) {
            // Empty glyph — no glyf data, loca[g] == loca[g+1]
            continue;
        }

        if (nContours < 0) {
            // ---- Composite glyph ----
            // Read component records verbatim from compositeStream until we find one
            // without the MORE_COMPONENTS (0x0020) flag.
            const compStart = csPos;
            let hasInstBit = false;
            let more = true;
            while (more) {
                const cFlags = ru16(compositeStream, csPos);
                csPos += 2;
                csPos += 2; // glyphIndex
                // Argument sizes: ARG_1_AND_2_ARE_WORDS (0x0001)
                csPos += cFlags & 0x0001 ? 4 : 2;
                // Scale flags
                if (cFlags & 0x0008) {
                    csPos += 2; // WE_HAVE_A_SCALE
                } else if (cFlags & 0x0040) {
                    csPos += 4; // WE_HAVE_AN_X_AND_Y_SCALE
                } else if (cFlags & 0x0080) {
                    csPos += 8; // WE_HAVE_A_2X2
                }
                if (cFlags & 0x0100) {
                    hasInstBit = true;
                } // WE_HAVE_INSTRUCTIONS
                more = (cFlags & 0x0020) !== 0; // MORE_COMPONENTS
            }
            const compData = compositeStream.slice(compStart, csPos);

            // Optional instructions
            let instLen = 0;
            /** @type {Uint8Array} */
            let instBytes = new Uint8Array(0);
            if (hasInstBit) {
                instLen = ru16(instructionStream, instPos);
                instPos += 2;
                instBytes = instructionStream.slice(instPos, instPos + instLen);
                instPos += instLen;
            }

            // Build composite glyph binary: header(10) + compData + [instLen(2) + instBytes]
            const glyph = new Uint8Array(
                10 + compData.length + (hasInstBit ? 2 + instLen : 0)
            );
            let gp = 0;
            wi16(glyph, gp, -1);
            gp += 2;
            wi16(glyph, gp, xMin);
            gp += 2;
            wi16(glyph, gp, yMin);
            gp += 2;
            wi16(glyph, gp, xMax);
            gp += 2;
            wi16(glyph, gp, yMax);
            gp += 2;
            glyph.set(compData, gp);
            gp += compData.length;
            if (hasInstBit) {
                wu16(glyph, gp, instLen);
                gp += 2;
                glyph.set(instBytes, gp);
            }

            const padded = pad4(glyph);
            glyfChunks.push(padded);
            currentOffset += padded.length;
        } else {
            // ---- Simple glyph ----
            // Read per-contour point counts via 255UInt16
            let totalPoints = 0;
            const nPoints = new Int32Array(nContours);
            for (let c = 0; c < nContours; c++) {
                const [np, newNpPos] = read255UInt16(nPointsStream, npPos);
                npPos = newNpPos;
                nPoints[c] = np;
                totalPoints += np;
            }

            // Read triplet flags from flagStream
            const rawFlags = flagStream.subarray(flPos, flPos + totalPoints);
            flPos += totalPoints;

            // Decode coordinate triplets from glyphStream
            const xs = new Int32Array(totalPoints);
            const ys = new Int32Array(totalPoints);
            const onCurve = new Uint8Array(totalPoints);
            let ax = 0,
                ay = 0;
            for (let p = 0; p < totalPoints; p++) {
                const fb = rawFlags[p];
                onCurve[p] = (fb >> 7) & 1;
                const [dx, dy, newGsPos] = decodeTriplet(
                    fb & 0x7f,
                    glyphStream,
                    gsPos
                );
                gsPos = newGsPos;
                ax += dx;
                ay += dy;
                xs[p] = ax;
                ys[p] = ay;
            }

            // Read instructions (length-prefixed, from instructionStream)
            let instLen = 0;
            /** @type {Uint8Array} */
            let instBytes = new Uint8Array(0);
            if (instPos < instructionStream.length) {
                instLen = ru16(instructionStream, instPos);
                instPos += 2;
                instBytes = instructionStream.slice(instPos, instPos + instLen);
                instPos += instLen;
            }

            // Compute bbox if not provided by explicit record
            if (!hasBbox) {
                xMin = xs[0];
                xMax = xs[0];
                yMin = ys[0];
                yMax = ys[0];
                for (let p = 1; p < totalPoints; p++) {
                    if (xs[p] < xMin) {
                        xMin = xs[p];
                    }
                    if (xs[p] > xMax) {
                        xMax = xs[p];
                    }
                    if (ys[p] < yMin) {
                        yMin = ys[p];
                    }
                    if (ys[p] > yMax) {
                        yMax = ys[p];
                    }
                }
            }

            // Build endPtsOfContours
            const endPts = new Int32Array(nContours);
            let ptIdx = 0;
            for (let c = 0; c < nContours; c++) {
                ptIdx += nPoints[c];
                endPts[c] = ptIdx - 1;
            }

            // Encode coordinates as int16 deltas (long form — no short-vector encoding).
            // TrueType flag: bit 0 = on-curve; bits 1,2,4,5 = 0 → x and y are signed int16.
            const headerSz = 10;
            const endPtsSz = nContours * 2;
            const instSz = 2 + instLen;
            const flagsSz = totalPoints;
            const coordSz = totalPoints * 2;
            const glyphSz =
                headerSz + endPtsSz + instSz + flagsSz + coordSz * 2;
            const glyph = new Uint8Array(glyphSz);
            let gp = 0;

            wi16(glyph, gp, nContours);
            gp += 2;
            wi16(glyph, gp, xMin);
            gp += 2;
            wi16(glyph, gp, yMin);
            gp += 2;
            wi16(glyph, gp, xMax);
            gp += 2;
            wi16(glyph, gp, yMax);
            gp += 2;

            for (let c = 0; c < nContours; c++) {
                wu16(glyph, gp, endPts[c]);
                gp += 2;
            }

            wu16(glyph, gp, instLen);
            gp += 2;
            glyph.set(instBytes, gp);
            gp += instLen;

            for (let p = 0; p < totalPoints; p++) {
                glyph[gp++] = onCurve[p]; // on-curve flag only; long int16 form for coords
            }

            // x deltas
            let prevX = 0;
            for (let p = 0; p < totalPoints; p++) {
                wi16(glyph, gp, xs[p] - prevX);
                gp += 2;
                prevX = xs[p];
            }
            // y deltas
            let prevY = 0;
            for (let p = 0; p < totalPoints; p++) {
                wi16(glyph, gp, ys[p] - prevY);
                gp += 2;
                prevY = ys[p];
            }

            const padded = pad4(glyph);
            glyfChunks.push(padded);
            currentOffset += padded.length;
        }
    }

    glyfOffsets[numGlyphs] = currentOffset;

    // ---- Build glyf table ----
    const glyfData = concat(glyfChunks);

    // ---- Build loca table ----
    let locaData;
    if (indexFormat === 0) {
        // Short loca: offsets divided by 2 (unsigned uint16)
        locaData = new Uint8Array((numGlyphs + 1) * 2);
        for (let i = 0; i <= numGlyphs; i++) {
            wu16(locaData, i * 2, (glyfOffsets[i] >>> 1) & 0xffff);
        }
    } else {
        // Long loca: offsets as uint32
        locaData = new Uint8Array((numGlyphs + 1) * 4);
        for (let i = 0; i <= numGlyphs; i++) {
            wu32(locaData, i * 4, glyfOffsets[i]);
        }
    }

    return { glyfData, locaData };
}

// ============================================================================
// TTF Reconstruction
// ============================================================================

/**
 * Compute TrueType table checksum (sum of all uint32 words, ignoring overflow).
 * @param {Uint8Array} data
 * @returns {number}
 */
function tableChecksum(data) {
    let sum = 0;
    const words = Math.ceil(data.length / 4);
    for (let i = 0; i < words; i++) {
        const b = i * 4;
        const w =
            (((data[b] || 0) << 24) |
                ((data[b + 1] || 0) << 16) |
                ((data[b + 2] || 0) << 8) |
                (data[b + 3] || 0)) >>>
            0;
        sum = (sum + w) >>> 0;
    }
    return sum;
}

/**
 * Assemble a minimal valid TrueType font from a map of table tag → data.
 * @param {Map<string, Uint8Array>} tables
 * @returns {Uint8Array}
 */
function buildTtf(tables) {
    const tags = Array.from(tables.keys()).sort();
    const n = tags.length;

    // Powers of 2 for table directory
    const po2 = 1 << Math.floor(Math.log2(n));
    const searchRange = po2 * 16;
    const entrySelector = Math.floor(Math.log2(po2));
    const rangeShift = n * 16 - searchRange;

    const dirSize = 12 + n * 16;

    // Compute padded table data and starting offsets
    /** @type {Map<string, {padded: Uint8Array; offset: number}>} */
    const resolved = new Map();
    let off = dirSize;
    for (let i = 0; i < n; i++) {
        const tag = tags[i];
        const padded = pad4(/** @type {Uint8Array} */ (tables.get(tag)));
        resolved.set(tag, { padded, offset: off });
        off += padded.length;
    }

    const ttf = new Uint8Array(off);
    let p = 0;

    // Offset table
    wu32(ttf, p, 0x00010000);
    p += 4; // sfVersion = TrueType
    wu16(ttf, p, n);
    p += 2;
    wu16(ttf, p, searchRange);
    p += 2;
    wu16(ttf, p, entrySelector);
    p += 2;
    wu16(ttf, p, rangeShift);
    p += 2;

    // Table directory
    for (let i = 0; i < n; i++) {
        const tag = tags[i];
        const raw = /** @type {Uint8Array} */ (tables.get(tag));
        const { offset } = /** @type {{padded:Uint8Array;offset:number}} */ (
            resolved.get(tag)
        );
        for (let j = 0; j < 4; j++) {
            ttf[p + j] = tag.charCodeAt(j) || 0x20;
        }
        p += 4;
        wu32(ttf, p, tableChecksum(raw));
        p += 4;
        wu32(ttf, p, offset);
        p += 4;
        wu32(ttf, p, raw.length);
        p += 4;
    }

    // Table data
    for (const [tag, { padded, offset }] of resolved) {
        ttf.set(padded, offset);
    }

    return ttf;
}

// ============================================================================
// Main Public API
// ============================================================================

/**
 * Parse and decompress a WOFF2 font file, returning the same TtfParsed
 * structure as parseTtfFont() in font-embed.mjs.
 *
 * The raw embedded bytes in TtfParsed.rawBytes will be a reconstructed TTF
 * suitable for use as a PDF FontFile2 stream.
 *
 * Only TrueType-outline WOFF2 (flavor = 0x00010000) is supported.
 * Throws for CFF-outline WOFF2 (flavor = 0x4F54544F / 'OTTO').
 *
 * @param {Uint8Array} woff2Bytes
 * @returns {import("./font-embed.mjs").TtfParsed}
 */
export function parseWoff2(woff2Bytes) {
    const d = woff2Bytes;

    // ---- Validate header ----
    const sig = ru32(d, 0);
    if (sig !== 0x774f4632) {
        throw new Error(
            "WOFF2: invalid signature (expected 0x774F4632 'wOF2')"
        );
    }

    const flavor = ru32(d, 4);
    if (flavor === 0x4f54544f) {
        throw new Error(
            "WOFF2: CFF-outline fonts (flavor 'OTTO') are not supported; only TrueType outline WOFF2 is handled"
        );
    }

    const numTables = ru16(d, 12);
    const totalCompressedSize = ru32(d, 16);

    // ---- Parse variable-length table directory (starts at byte 48) ----
    /** @type {Array<{tag:string; origLength:number; transformLength:number; transformVersion:number}>} */
    const tableDir = [];
    let pos = 48;

    for (let i = 0; i < numTables; i++) {
        const flags = d[pos++];
        const tagIdx = flags & 0x3f;
        const transformVersion = (flags >> 6) & 3;

        let tag;
        if (tagIdx === 63) {
            tag = String.fromCharCode(
                d[pos],
                d[pos + 1],
                d[pos + 2],
                d[pos + 3]
            );
            pos += 4;
        } else {
            tag = KNOWN_TAGS[tagIdx];
            if (!tag) {
                throw new Error("WOFF2: unknown tag index " + tagIdx);
            }
        }

        const [origLength, pos1] = readUBase128(d, pos);
        pos = pos1;

        // transformLength is present only when:
        //   - glyf or loca table AND transformVersion == 0  (WOFF2 glyf transform)
        //   - any other table AND transformVersion != 0     (non-default transform)
        const isGlyfLoca = tag === "glyf" || tag === "loca";
        const hasTransformLength = isGlyfLoca
            ? transformVersion === 0
            : transformVersion !== 0;

        let transformLength = origLength;
        if (hasTransformLength) {
            const [tl, pos2] = readUBase128(d, pos);
            pos = pos2;
            transformLength = tl;
        }

        tableDir.push({ tag, origLength, transformLength, transformVersion });
    }

    // ---- Brotli-decompress the compressed font data block ----
    const compressedBlock = d.subarray(pos, pos + totalCompressedSize);
    const decompressed = brotliDecompressSync(compressedBlock);

    // ---- Slice decompressed data into per-table buffers ----
    /** @type {Map<string, {data:Uint8Array; entry:typeof tableDir[0]}>} */
    const rawTables = new Map();
    let decomp = 0;

    for (let i = 0, len = tableDir.length; i < len; i++) {
        const entry = tableDir[i];
        const data = decompressed.subarray(
            decomp,
            decomp + entry.transformLength
        );
        decomp += entry.transformLength;
        rawTables.set(entry.tag, { data, entry });
    }

    // ---- Reconstruct transformed glyf/loca if needed ----
    const glyfInfo = rawTables.get("glyf");
    const needsGlyfReconstruct =
        glyfInfo && glyfInfo.entry.transformVersion === 0;

    /** @type {Map<string, Uint8Array>} */
    const ttfTables = new Map();

    for (const [tag, info] of rawTables) {
        if (tag === "glyf" || tag === "loca") {
            continue;
        } // handled separately below
        ttfTables.set(tag, info.data);
    }

    if (needsGlyfReconstruct && glyfInfo) {
        const maxpData = ttfTables.get("maxp");
        const headData = ttfTables.get("head");
        if (!maxpData) {
            throw new Error(
                "WOFF2: missing maxp table (needed for glyf reconstruction)"
            );
        }
        if (!headData) {
            throw new Error(
                "WOFF2: missing head table (needed for glyf reconstruction)"
            );
        }

        const numGlyphs = ru16(maxpData, 4);
        const indexFormat = ru16(headData, 50); // indexToLocFormat: 0=short, 1=long

        const { glyfData, locaData } = reconstructGlyfLoca(
            glyfInfo.data,
            numGlyphs,
            indexFormat
        );
        ttfTables.set("glyf", glyfData);
        ttfTables.set("loca", locaData);
    } else {
        // Identity transform or no transform: use verbatim
        if (glyfInfo) {
            ttfTables.set("glyf", glyfInfo.data);
        }
        const locaInfo = rawTables.get("loca");
        if (locaInfo) {
            ttfTables.set("loca", locaInfo.data);
        }
    }

    const ttfBytes = buildTtf(ttfTables);
    return parseTtfFont(ttfBytes);
}

export default { parseWoff2 };
