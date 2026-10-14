/**
 * Wave 1 validation: stream compression, ToUnicode, per-page size/rotation,
 * Adam7 PNG de-interlace, Adobe CMYK JPEG inversion. Uses only node internals.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync, deflateSync } from "node:zlib";

import DocMod from "../../lib/pdf/document.mjs";
import {
    buildToUnicodeCMap,
    buildTtfFontDict
} from "../../lib/pdf/font-embed.mjs";
import {
    parseJpeg,
    buildJpegXObjectDict,
    parsePng
} from "../../lib/pdf/image-embed.mjs";

const { PdfDocumentBuilder } = DocMod;
const dec = new TextDecoder("latin1");

/** @param {Uint8Array} bytes @returns {string} */
function toLatin1(bytes) {
    return dec.decode(bytes);
}

/**
 * Verify every in-use xref offset points at "<id> 0 obj".
 * @param {Uint8Array} pdf
 * @returns {void}
 */
function assertXrefIntegrity(pdf) {
    const s = toLatin1(pdf);
    const sx = s.lastIndexOf("startxref");
    const xrefOff = parseInt(
        s
            .slice(sx + 9)
            .trim()
            .split(/\s/)[0],
        10
    );
    assert.equal(s.slice(xrefOff, xrefOff + 4), "xref", "xref at startxref");

    const header = s.slice(xrefOff).match(/xref\s+(\d+)\s+(\d+)/);
    assert.ok(header, "xref subsection header");
    const count = parseInt(header[2], 10);
    // Entries are fixed 20-byte records after the "N M\n" line.
    const entriesStart = xrefOff + header[0].length + 1;
    for (let id = 1; id < count; id++) {
        const rec = s.slice(
            entriesStart + id * 20,
            entriesStart + id * 20 + 20
        );
        if (rec[17] !== "n") {
            continue; // free entry
        }
        const off = parseInt(rec.slice(0, 10), 10);
        const got = s.slice(off, off + 24);
        assert.ok(
            new RegExp("^" + id + " 0 obj").test(got),
            `object ${id} at offset ${off} (saw: ${JSON.stringify(got)})`
        );
    }
}

/** Extract the bytes of the first `stream`...`endstream` after a match index. */
function streamAfter(pdf, fromIndex) {
    const s = toLatin1(pdf);
    const start = s.indexOf("stream", fromIndex);
    // skip "stream" + CRLF/LF
    let p = start + 6;
    if (s[p] === "\r") {
        p++;
    }
    if (s[p] === "\n") {
        p++;
    }
    const end = s.indexOf("endstream", p);
    // trailing EOL before endstream is not part of the data
    let e = end;
    if (s[e - 1] === "\n") {
        e--;
    }
    if (s[e - 1] === "\r") {
        e--;
    }
    return pdf.slice(p, e);
}

test("content streams are Flate-compressed and round-trip", () => {
    const doc = new PdfDocumentBuilder({ title: "x" });
    const content = "BT /F1 12 Tf 72 700 Td (Hello World) Tj ET\n";
    doc.addPageFromString(content);
    const pdf = doc.build();
    const s = toLatin1(pdf);

    assert.ok(s.includes("/Filter /FlateDecode"), "has FlateDecode filter");
    const idx = s.indexOf("Contents");
    const streamBytes = streamAfter(pdf, s.indexOf("/Length", idx));
    const inflated = toLatin1(new Uint8Array(inflateSync(streamBytes)));
    assert.equal(inflated, content, "inflated content matches original");
    assertXrefIntegrity(pdf);
});

test("compress:false leaves raw operators and no filter", () => {
    const doc = new PdfDocumentBuilder({ title: "x", compress: false });
    doc.addPageFromString("BT /F1 12 Tf 10 10 Td (hi) Tj ET\n");
    const pdf = doc.build();
    const s = toLatin1(pdf);
    assert.ok(!s.includes("/FlateDecode"), "no filter when compress:false");
    assert.ok(s.includes("(hi) Tj"), "raw operators present");
    assertXrefIntegrity(pdf);
});

test("per-page size and rotation", () => {
    const doc = new PdfDocumentBuilder({ width: 612, height: 792 });
    doc.addPageFromString("BT ET\n"); // default size
    doc.addPageFromString("BT ET\n", [], {
        width: 300,
        height: 900,
        rotate: 90
    });
    const pdf = doc.build();
    const s = toLatin1(pdf);
    assert.ok(s.includes("[0 0 612 792]"), "default MediaBox");
    assert.ok(s.includes("[0 0 300 900]"), "custom MediaBox");
    assert.ok(s.includes("/Rotate 90"), "rotation emitted");
    assertXrefIntegrity(pdf);
});

test("rotation must be a multiple of 90", () => {
    const doc = new PdfDocumentBuilder();
    assert.throws(
        () => doc.addPageFromString("x", [], { rotate: 45 }),
        /multiple of 90/
    );
});

test("ToUnicode CMap covers 0x20..0xFF with WinAnsi overrides", () => {
    const cmap = buildToUnicodeCMap();
    assert.ok(cmap.includes("beginbfchar") && cmap.includes("endcmap"));
    assert.ok(cmap.includes("<00> <FF>"), "single-byte codespace");
    assert.ok(cmap.includes("<41> <0041>"), "A -> U+0041");
    assert.ok(cmap.includes("<80> <20AC>"), "0x80 -> euro");
    assert.ok(cmap.includes("<A0> <00A0>"), "0xA0 -> NBSP identity");
    assert.ok(cmap.includes("<FF> <00FF>"), "0xFF -> y-diaeresis");
    const mappings = (cmap.match(/<[0-9A-F]{2}> <[0-9A-F]{4}>/g) || []).length;
    assert.equal(mappings, 224, "0x20..0xFF inclusive = 224 entries");
});

test("embedded font dict references shared ToUnicode when id given", () => {
    const parsed = {
        charWidths: new Float64Array(256).fill(500),
        postScriptName: "Test"
    };
    const withTU = buildTtfFontDict(parsed, 5, 7);
    const withoutTU = buildTtfFontDict(parsed, 5);
    assert.ok(withTU.includes("/ToUnicode 7 0 R"));
    assert.ok(!withoutTU.includes("/ToUnicode"));
});

test("Adobe CMYK JPEG gets an inverting /Decode; plain CMYK does not", () => {
    /** @param {boolean} withAdobe */
    function makeJpeg(withAdobe) {
        const out = [0xff, 0xd8]; // SOI
        if (withAdobe) {
            out.push(
                0xff,
                0xee,
                0x00,
                0x0e, // APP14, len 14
                0x41,
                0x64,
                0x6f,
                0x62,
                0x65, // "Adobe"
                0x00,
                0x64,
                0x00,
                0x00,
                0x00,
                0x00,
                0x02 // ver/flags/transform=YCCK
            );
        }
        // SOF0: len 20, precision 8, H=16, W=32, 4 comps (+12 comp bytes)
        out.push(0xff, 0xc0, 0x00, 0x14, 0x08, 0x00, 0x10, 0x00, 0x20, 0x04);
        for (let k = 0; k < 12; k++) {
            out.push(0x00);
        }
        return new Uint8Array(out);
    }

    const adobe = parseJpeg(makeJpeg(true));
    assert.equal(adobe.colorSpace, "DeviceCMYK");
    assert.equal(adobe.adobe, true);
    assert.equal(adobe.width, 32);
    assert.equal(adobe.height, 16);
    assert.ok(buildJpegXObjectDict(adobe).Decode === "[1 0 1 0 1 0 1 0]");

    const plain = parseJpeg(makeJpeg(false));
    assert.equal(plain.adobe, false);
    assert.equal(buildJpegXObjectDict(plain).Decode, undefined);
});

// --- Minimal grayscale-8bpc PNG encoder (filter 0), optional Adam7 --------

const ADAM7 = [
    [0, 0, 8, 8],
    [4, 0, 8, 8],
    [0, 4, 4, 8],
    [2, 0, 4, 4],
    [0, 2, 2, 4],
    [1, 0, 2, 2],
    [0, 1, 1, 2]
];

/** @param {number[]} arr @param {number} n */
function pushU32(arr, n) {
    arr.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

/** @param {string} tag @param {number[]} data @returns {number[]} */
function chunk(tag, data) {
    const out = [];
    pushU32(out, data.length);
    for (let i = 0; i < tag.length; i++) {
        out.push(tag.charCodeAt(i));
    }
    for (let i = 0; i < data.length; i++) {
        out.push(data[i]);
    }
    pushU32(out, 0); // CRC ignored by parser
    return out;
}

/**
 * @param {number} w @param {number} h @param {(x:number,y:number)=>number} val
 * @param {boolean} interlace
 * @returns {Uint8Array}
 */
function encodeGrayPng(w, h, val, interlace) {
    const raw = [];
    if (!interlace) {
        for (let y = 0; y < h; y++) {
            raw.push(0); // filter none
            for (let x = 0; x < w; x++) {
                raw.push(val(x, y) & 0xff);
            }
        }
    } else {
        for (let p = 0; p < 7; p++) {
            const [xs, ys, xstep, ystep] = ADAM7[p];
            if (xs >= w || ys >= h) {
                continue;
            }
            const pw = Math.ceil((w - xs) / xstep);
            const ph = Math.ceil((h - ys) / ystep);
            for (let py = 0; py < ph; py++) {
                raw.push(0);
                for (let px = 0; px < pw; px++) {
                    raw.push(val(xs + px * xstep, ys + py * ystep) & 0xff);
                }
            }
        }
    }
    const idat = Array.from(deflateSync(new Uint8Array(raw)));
    const ihdr = [];
    pushU32(ihdr, w);
    pushU32(ihdr, h);
    ihdr.push(8, 0, 0, 0, interlace ? 1 : 0); // depth, colorType 0, comp, filt, interlace

    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return new Uint8Array([
        ...sig,
        ...chunk("IHDR", ihdr),
        ...chunk("IDAT", idat),
        ...chunk("IEND", [])
    ]);
}

test("Adam7 interlaced PNG decodes identically to non-interlaced", () => {
    const w = 9;
    const h = 7;
    const val = (x, y) => (x * 31 + y * 17) & 0xff;

    const plain = parsePng(encodeGrayPng(w, h, val, false));
    const laced = parsePng(encodeGrayPng(w, h, val, true));

    assert.equal(plain.width, w);
    assert.equal(laced.width, w);
    assert.equal(laced.height, h);

    const a = new Uint8Array(inflateSync(plain.streamData));
    const b = new Uint8Array(inflateSync(laced.streamData));
    assert.equal(a.length, w * h);
    assert.equal(b.length, w * h);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            assert.equal(b[y * w + x], val(x, y), `pixel ${x},${y}`);
            assert.equal(a[y * w + x], b[y * w + x], `parity ${x},${y}`);
        }
    }
});
