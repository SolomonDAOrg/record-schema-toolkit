/**
 * TrueType glyph subsetting for CIDFontType2 embedding.
 *
 * Produces a minimal sfnt that keeps only the requested glyphs (plus .notdef and
 * the transitive closure of composite-glyph components) at their ORIGINAL glyph
 * ids — required because the PDF uses /CIDToGIDMap /Identity, so glyph ids must
 * not be renumbered. Rebuilds glyf/loca/head/hhea/maxp/hmtx and copies the
 * hinting tables (cvt/fpgm/prep) verbatim; drops cmap/name/OS2/post, which an
 * embedded CIDFontType2 does not need. No dependencies.
 * @module Subset
 */

/** @param {Uint8Array} d @param {number} o @returns {number} */
function u16(d, o) {
    return (d[o] << 8) | d[o + 1];
}
/** @param {Uint8Array} d @param {number} o @returns {number} */
function i16(d, o) {
    const v = u16(d, o);
    return v >= 0x8000 ? v - 0x10000 : v;
}
/** @param {Uint8Array} d @param {number} o @returns {number} */
function u32(d, o) {
    return d[o] * 0x1000000 + (d[o + 1] << 16) + (d[o + 2] << 8) + d[o + 3];
}
/** @param {Uint8Array} d @param {number} o @param {number} v */
function wU16(d, o, v) {
    d[o] = (v >> 8) & 0xff;
    d[o + 1] = v & 0xff;
}
/** @param {Uint8Array} d @param {number} o @param {number} v */
function wU32(d, o, v) {
    d[o] = (v >>> 24) & 0xff;
    d[o + 1] = (v >>> 16) & 0xff;
    d[o + 2] = (v >>> 8) & 0xff;
    d[o + 3] = v & 0xff;
}
/** @param {number} n @returns {number} */
function align4(n) {
    return (n + 3) & ~3;
}
/** @param {Uint8Array[]} parts @returns {Uint8Array} */
function concat(parts) {
    let total = 0;
    for (let i = 0, len = parts.length; i < len; i++) {
        total = total + parts[i].length;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (let i = 0, len = parts.length; i < len; i++) {
        out.set(parts[i], off);
        off = off + parts[i].length;
    }
    return out;
}

/**
 * sfnt table checksum: sum of big-endian uint32s over the data zero-padded to a
 * 4-byte boundary, mod 2^32.
 * @param {Uint8Array} data
 * @returns {number}
 */
function tableChecksum(data) {
    let sum = 0;
    const n = data.length;
    for (let i = 0; i < n; i += 4) {
        const b0 = data[i] || 0;
        const b1 = data[i + 1] || 0;
        const b2 = data[i + 2] || 0;
        const b3 = data[i + 3] || 0;
        sum = (sum + (b0 * 0x1000000 + (b1 << 16) + (b2 << 8) + b3)) >>> 0;
    }
    return sum >>> 0;
}

/**
 * Subset a TrueType font to a set of glyph ids (original ids preserved).
 * @param {Uint8Array} raw - original .ttf bytes
 * @param {Iterable<number>} glyphIds - glyph ids to keep
 * @returns {Uint8Array} subset .ttf
 */
export function subsetFont(raw, glyphIds) {
    // Table directory.
    const numTables = u16(raw, 4);
    /** @type {Map<string, { offset: number, length: number }>} */
    const tables = new Map();
    let p = 12;
    for (let i = 0; i < numTables; i++) {
        const tag = String.fromCharCode(
            raw[p],
            raw[p + 1],
            raw[p + 2],
            raw[p + 3]
        );
        tables.set(tag, { offset: u32(raw, p + 8), length: u32(raw, p + 12) });
        p = p + 16;
    }

    const head = tables.get("head");
    const maxp = tables.get("maxp");
    const loca = tables.get("loca");
    const glyf = tables.get("glyf");
    const hmtx = tables.get("hmtx");
    const hhea = tables.get("hhea");
    if (!head || !maxp || !loca || !glyf || !hmtx || !hhea) {
        // Not a glyf-based font (e.g. CFF/OpenType) — cannot subset here.
        return raw;
    }

    const locFormat = u16(raw, head.offset + 50); // 0 short, 1 long
    /** @param {number} gid @returns {number} */
    const locaOffset = (gid) =>
        locFormat === 0
            ? u16(raw, loca.offset + gid * 2) * 2
            : u32(raw, loca.offset + gid * 4);

    // Transitive closure over composite-glyph components.
    /** @type {Set<number>} */
    const keep = new Set();
    /** @param {number} gid */
    const addGlyph = (gid) => {
        if (keep.has(gid)) {
            return;
        }
        keep.add(gid);
        const start = locaOffset(gid);
        const end = locaOffset(gid + 1);
        if (end <= start) {
            return; // empty glyph
        }
        const g = glyf.offset + start;
        if (i16(raw, g) >= 0) {
            return; // simple glyph
        }
        // composite: walk components
        let o = g + 10;
        for (;;) {
            const flags = u16(raw, o);
            const compGid = u16(raw, o + 2);
            o = o + 4;
            addGlyph(compGid);
            o = o + (flags & 0x0001 ? 4 : 2); // ARG_1_AND_2_ARE_WORDS
            if (flags & 0x0008) {
                o = o + 2; // WE_HAVE_A_SCALE
            } else if (flags & 0x0040) {
                o = o + 4; // X_AND_Y_SCALE
            } else if (flags & 0x0080) {
                o = o + 8; // TWO_BY_TWO
            }
            if (!(flags & 0x0020)) {
                break; // MORE_COMPONENTS
            }
        }
    };
    keep.add(0);
    for (const gid of glyphIds) {
        addGlyph(gid);
    }

    let maxGID = 0;
    for (const gid of keep) {
        if (gid > maxGID) {
            maxGID = gid;
        }
    }
    const newNumGlyphs = maxGID + 1;

    // Rebuild glyf + long loca (glyph ids preserved; unused glyphs are empty).
    const newLoca = new Uint32Array(newNumGlyphs + 1);
    /** @type {Uint8Array[]} */
    const glyfChunks = [];
    let gOff = 0;
    for (let gid = 0; gid < newNumGlyphs; gid++) {
        newLoca[gid] = gOff;
        if (keep.has(gid)) {
            const start = locaOffset(gid);
            const end = locaOffset(gid + 1);
            if (end > start) {
                let data = raw.slice(glyf.offset + start, glyf.offset + end);
                if (data.length % 2 !== 0) {
                    const padded = new Uint8Array(data.length + 1);
                    padded.set(data);
                    data = padded;
                }
                glyfChunks.push(data);
                gOff = gOff + data.length;
            }
        }
    }
    newLoca[newNumGlyphs] = gOff;
    const newGlyf = concat(glyfChunks);

    const locaBytes = new Uint8Array((newNumGlyphs + 1) * 4);
    for (let i = 0; i <= newNumGlyphs; i++) {
        wU32(locaBytes, i * 4, newLoca[i]);
    }

    // hmtx (advance + lsb) for every glyph 0..maxGID.
    const origHMetrics = u16(raw, hhea.offset + 34);
    /** @param {number} gid @returns {number} */
    const advance = (gid) =>
        gid < origHMetrics
            ? u16(raw, hmtx.offset + gid * 4)
            : u16(raw, hmtx.offset + (origHMetrics - 1) * 4);
    /** @param {number} gid @returns {number} */
    const lsb = (gid) =>
        gid < origHMetrics
            ? i16(raw, hmtx.offset + gid * 4 + 2)
            : i16(
                  raw,
                  hmtx.offset + origHMetrics * 4 + (gid - origHMetrics) * 2
              );
    const hmtxBytes = new Uint8Array(newNumGlyphs * 4);
    for (let gid = 0; gid < newNumGlyphs; gid++) {
        wU16(hmtxBytes, gid * 4, advance(gid));
        const l = lsb(gid);
        wU16(hmtxBytes, gid * 4 + 2, l < 0 ? l + 0x10000 : l);
    }

    // head (long loca, zeroed checkSumAdjustment), hhea, maxp copies with fixups.
    const headBytes = raw.slice(head.offset, head.offset + head.length);
    wU32(headBytes, 8, 0); // checkSumAdjustment
    wU16(headBytes, 50, 1); // indexToLocFormat = long
    const hheaBytes = raw.slice(hhea.offset, hhea.offset + hhea.length);
    wU16(hheaBytes, 34, newNumGlyphs); // numberOfHMetrics
    const maxpBytes = raw.slice(maxp.offset, maxp.offset + maxp.length);
    wU16(maxpBytes, 4, newNumGlyphs); // numGlyphs

    /** @type {[string, Uint8Array][]} */
    const outTables = [
        ["head", headBytes],
        ["hhea", hheaBytes],
        ["maxp", maxpBytes],
        ["hmtx", hmtxBytes],
        ["loca", locaBytes],
        ["glyf", newGlyf]
    ];
    for (const tag of ["cvt ", "fpgm", "prep"]) {
        const t = tables.get(tag);
        if (t) {
            outTables.push([tag, raw.slice(t.offset, t.offset + t.length)]);
        }
    }
    outTables.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

    // Assemble sfnt.
    const n = outTables.length;
    let maxPow2 = 1;
    let es = 0;
    while (maxPow2 * 2 <= n) {
        maxPow2 = maxPow2 * 2;
        es = es + 1;
    }
    const searchRange = maxPow2 * 16;
    const rangeShift = n * 16 - searchRange;

    let cursor = 12 + 16 * n;
    /** @type {{ tag: string, checksum: number, offset: number, length: number }[]} */
    const records = [];
    for (let i = 0; i < n; i++) {
        const data = outTables[i][1];
        records.push({
            tag: outTables[i][0],
            checksum: tableChecksum(data),
            offset: cursor,
            length: data.length
        });
        cursor = cursor + align4(data.length);
    }

    const out = new Uint8Array(cursor);
    wU32(out, 0, 0x00010000);
    wU16(out, 4, n);
    wU16(out, 6, searchRange);
    wU16(out, 8, es);
    wU16(out, 10, rangeShift);
    let rp = 12;
    for (let i = 0; i < n; i++) {
        const r = records[i];
        out[rp] = r.tag.charCodeAt(0);
        out[rp + 1] = r.tag.charCodeAt(1);
        out[rp + 2] = r.tag.charCodeAt(2);
        out[rp + 3] = r.tag.charCodeAt(3);
        wU32(out, rp + 4, r.checksum);
        wU32(out, rp + 8, r.offset);
        wU32(out, rp + 12, r.length);
        rp = rp + 16;
        out.set(outTables[i][1], r.offset);
    }

    // head.checkSumAdjustment = 0xB1B0AFBA - (whole-font checksum).
    const fontChecksum = tableChecksum(out);
    const headRec = records.find((r) => r.tag === "head");
    wU32(out, headRec.offset + 8, (0xb1b0afba - fontChecksum) >>> 0);

    return out;
}

/**
 * A 6-uppercase-letter subset tag derived from the kept glyph ids, for the
 * conventional "ABCDEF+FontName" BaseFont prefix.
 * @param {Iterable<number>} glyphIds
 * @returns {string}
 */
export function subsetTag(glyphIds) {
    let h = 0x811c9dc5;
    for (const gid of glyphIds) {
        h = (h ^ gid) >>> 0;
        h = (h * 0x01000193) >>> 0;
    }
    let tag = "";
    for (let i = 0; i < 6; i++) {
        tag = tag + String.fromCharCode(65 + (h % 26));
        h = Math.floor(h / 26);
    }
    return tag;
}

export default { subsetFont, subsetTag };
