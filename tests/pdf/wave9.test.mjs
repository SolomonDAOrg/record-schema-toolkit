/**
 * Wave 8 validation: TrueType glyph subsetting. Uses a system font; skips if
 * none is found.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

import { subsetFont, subsetTag } from "../../lib/pdf/subset.mjs";
import { parseTtfFont } from "../../lib/pdf/font-embed.mjs";
import DocMod from "../../lib/pdf/document.mjs";
import CsMod from "../../lib/pdf/content-stream.mjs";

const { PdfDocumentBuilder } = DocMod;
const { PdfContentStreamBuilder } = CsMod;
const dec = new TextDecoder("latin1");

const FONT_PATH =
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf";
const HAS_FONT = existsSync(FONT_PATH);
const RAW = HAS_FONT ? new Uint8Array(readFileSync(FONT_PATH)) : null;
const PARSED = HAS_FONT ? parseTtfFont(RAW) : null;

function u16(d, o) {
    return (d[o] << 8) | d[o + 1];
}
function i16(d, o) {
    const v = u16(d, o);
    return v >= 0x8000 ? v - 0x10000 : v;
}
function u32(d, o) {
    return d[o] * 0x1000000 + (d[o + 1] << 16) + (d[o + 2] << 8) + d[o + 3];
}
/** whole-font / table checksum (big-endian uint32 sum, zero-padded) */
function checksum(d) {
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
        const v =
            (d[i] || 0) * 0x1000000 +
            ((d[i + 1] || 0) << 16) +
            ((d[i + 2] || 0) << 8) +
            (d[i + 3] || 0);
        sum = (sum + v) >>> 0;
    }
    return sum >>> 0;
}
function parseSfnt(buf) {
    const nt = u16(buf, 4);
    const tables = new Map();
    let o = 12;
    for (let i = 0; i < nt; i++) {
        const tag = String.fromCharCode(
            buf[o],
            buf[o + 1],
            buf[o + 2],
            buf[o + 3]
        );
        tables.set(tag, { off: u32(buf, o + 8), len: u32(buf, o + 12) });
        o += 16;
    }
    return { nt, tables };
}

test(
    "subset is dramatically smaller and a valid sfnt",
    { skip: !HAS_FONT },
    () => {
        const gids = new Set([0]);
        for (const ch of "Hello World") {
            gids.add(PARSED.glyphIdForCodePoint(ch.codePointAt(0)));
        }
        const sub = subsetFont(RAW, gids);
        assert.ok(sub.length < RAW.length * 0.2, "at least 80% smaller");

        assert.equal(u32(sub, 0), 0x00010000, "TrueType sfnt version");
        const { tables } = parseSfnt(sub);
        for (const t of ["head", "hhea", "maxp", "hmtx", "loca", "glyf"]) {
            assert.ok(tables.has(t), "has " + t);
        }

        // Table records must be sorted by tag.
        const tags = [...tables.keys()];
        const sorted = [...tags].sort();
        assert.deepEqual(tags, sorted, "table directory sorted by tag");
    }
);

test(
    "whole-font checksum invariant holds (checkSumAdjustment correct)",
    { skip: !HAS_FONT },
    () => {
        const gids = new Set([0, PARSED.glyphIdForCodePoint(0x41)]);
        const sub = subsetFont(RAW, gids);
        // After patching head.checkSumAdjustment, the sum over the entire file
        // must equal the magic constant. This is the definitive integrity check.
        assert.equal(checksum(sub), 0xb1b0afba, "font checksum == 0xB1B0AFBA");
    }
);

test(
    "head is switched to long loca and numGlyphs is trimmed",
    { skip: !HAS_FONT },
    () => {
        const gidA = PARSED.glyphIdForCodePoint(0x41); // 'A' = 36
        const sub = subsetFont(RAW, new Set([0, gidA]));
        const { tables } = parseSfnt(sub);
        const head = tables.get("head");
        const maxp = tables.get("maxp");
        assert.equal(u16(sub, head.off + 50), 1, "indexToLocFormat = long");
        assert.equal(
            u16(sub, maxp.off + 4),
            gidA + 1,
            "numGlyphs = maxGID + 1"
        );
    }
);

test(
    "used simple glyph keeps its exact outline data",
    { skip: !HAS_FONT },
    () => {
        const gidA = PARSED.glyphIdForCodePoint(0x41);
        const sub = subsetFont(RAW, new Set([0, gidA]));
        const { tables } = parseSfnt(sub);

        // subset glyph A
        const loca = tables.get("loca").off;
        const glyf = tables.get("glyf").off;
        const s = u32(sub, loca + gidA * 4);
        const e = u32(sub, loca + (gidA + 1) * 4);
        const subGlyphA = sub.slice(glyf + s, glyf + e);

        // original glyph A
        const o = parseSfnt(RAW);
        const oHead = o.tables.get("head").off;
        const oLocaFmt = u16(RAW, oHead + 50);
        const oLoca = o.tables.get("loca").off;
        const oGlyf = o.tables.get("glyf").off;
        const oStart =
            oLocaFmt === 0
                ? u16(RAW, oLoca + gidA * 2) * 2
                : u32(RAW, oLoca + gidA * 4);
        const oEnd =
            oLocaFmt === 0
                ? u16(RAW, oLoca + (gidA + 1) * 2) * 2
                : u32(RAW, oLoca + (gidA + 1) * 4);
        const origGlyphA = RAW.slice(oGlyf + oStart, oGlyf + oEnd);

        // subset may pad to even length; compare the meaningful bytes
        assert.ok(subGlyphA.length >= origGlyphA.length, "glyph present");
        for (let k = 0; k < origGlyphA.length; k++) {
            assert.equal(
                subGlyphA[k],
                origGlyphA[k],
                "glyph byte " + k + " preserved"
            );
        }
    }
);

test(
    "composite glyph pulls in its components (closure)",
    { skip: !HAS_FONT },
    () => {
        // é (U+00E9) is composite in LiberationSans (e + combining acute).
        const gidE = PARSED.glyphIdForCodePoint(0xe9);
        const sub = subsetFont(RAW, new Set([0, gidE]));
        const { tables } = parseSfnt(sub);
        const loca = tables.get("loca").off;
        const glyf = tables.get("glyf").off;

        const s = u32(sub, loca + gidE * 4);
        const g = glyf + s;
        assert.ok(i16(sub, g) < 0, "é glyph is composite");

        // Walk components; each referenced glyph must be present with real outlines.
        let o = g + 10;
        let checked = 0;
        for (;;) {
            const flags = u16(sub, o);
            const compGid = u16(sub, o + 2);
            o += 4;
            const cs = u32(sub, loca + compGid * 4);
            const ce = u32(sub, loca + (compGid + 1) * 4);
            assert.ok(
                ce > cs,
                "component glyph " + compGid + " has outline data"
            );
            checked++;
            o += flags & 0x0001 ? 4 : 2;
            if (flags & 0x0008) {
                o += 2;
            } else if (flags & 0x0040) {
                o += 4;
            } else if (flags & 0x0080) {
                o += 8;
            }
            if (!(flags & 0x0020)) {
                break;
            }
        }
        assert.ok(checked >= 2, "at least two components resolved");
    }
);

test(
    "subsetTag is 6 uppercase letters and deterministic",
    { skip: !HAS_FONT },
    () => {
        const a = subsetTag([0, 5, 12, 40]);
        const b = subsetTag([0, 5, 12, 40]);
        assert.match(a, /^[A-Z]{6}$/);
        assert.equal(a, b, "same glyphs -> same tag");
    }
);

test(
    "embedded CID font carries a subset-tagged BaseFont",
    { skip: !HAS_FONT },
    () => {
        const doc = new PdfDocumentBuilder({ compress: false });
        const f = doc.registerCIDFont(RAW);
        const cs = new PdfContentStreamBuilder();
        cs.beginText().setFont(f, 12).setTextMatrix(1, 0, 0, 1, 72, 700);
        cs.showGlyphHex(doc.encodeCIDText(f, "Ω café"));
        cs.endText();
        doc.addPageFromString(cs.build());
        const s = dec.decode(doc.build());
        assert.ok(
            /\/BaseFont \/[A-Z]{6}\+/.test(s),
            "subset prefix on BaseFont"
        );
    }
);
