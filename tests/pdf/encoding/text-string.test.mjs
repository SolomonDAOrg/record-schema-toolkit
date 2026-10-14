/**
 * PDF text-string and name decoding: the UTF-16BE and PDFDocEncoding forms a
 * field name or value arrives in, and the `#xx` escapes a name object may use.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    decodeTextStringBytes,
    encodeTextString,
    decodeName
} from "../../../lib/pdf/encoding/text-string.mjs";
import {
    encodeWinAnsi,
    isWinAnsiRepresentable,
    winAnsiByteForCodePoint
} from "../../../lib/pdf/encoding/win-ansi.mjs";

/** @param {number[]} values @returns {Uint8Array} */
function bytes(values) {
    return new Uint8Array(values);
}

/** @param {string} value @returns {Uint8Array} */
function utf16be(value) {
    const out = [0xfe, 0xff];
    for (let i = 0; i < value.length; i++) {
        const unit = value.charCodeAt(i);
        out.push(unit >> 8, unit & 0xff);
    }
    return new Uint8Array(out);
}

test("a byte-order mark selects UTF-16BE", () => {
    assert.equal(
        decodeTextStringBytes(utf16be("topmostSubform[0]")),
        "topmostSubform[0]"
    );
});

test("UTF-16BE keeps astral characters intact through surrogates", () => {
    const decoded = decodeTextStringBytes(utf16be("a\u{1F600}b"));
    assert.equal(decoded, "a\u{1F600}b");
});

test("little-endian UTF-16 is decoded from its own mark", () => {
    assert.equal(decodeTextStringBytes(bytes([0xff, 0xfe, 0x41, 0x00])), "A");
});

test("bytes without a mark decode as PDFDocEncoding", () => {
    assert.equal(decodeTextStringBytes(bytes([0x41, 0x42])), "AB");
    assert.equal(decodeTextStringBytes(bytes([0x80])), "•", "bullet");
    assert.equal(decodeTextStringBytes(bytes([0x92])), "™", "trademark");
    assert.equal(decodeTextStringBytes(bytes([0xa0])), "€", "euro");
    assert.equal(decodeTextStringBytes(bytes([0xe9])), "é", "Latin-1 tail");
});

test("PDFDocEncoding drops its unassigned positions", () => {
    assert.equal(decodeTextStringBytes(bytes([0x41, 0x9f, 0x42])), "AB");
    assert.equal(decodeTextStringBytes(bytes([0x41, 0xad, 0x42])), "AB");
});

test("an empty string decodes to nothing", () => {
    assert.equal(decodeTextStringBytes(bytes([])), "");
});

test("printable ASCII encodes as a literal string", () => {
    assert.equal(encodeTextString("Acme Pty Ltd"), "(Acme Pty Ltd)");
});

test("a literal string escapes its delimiters", () => {
    assert.equal(encodeTextString("a(b)c\\d"), "(a\\(b\\)c\\\\d)");
});

test("non-ASCII encodes as UTF-16BE hex", () => {
    assert.equal(encodeTextString("Zürich"), "<FEFF005A00FC0072006900630068>");
});

test("encoded text survives a decode round trip", () => {
    for (const value of ["plain", "Zürich", "naïve — dash", "日本語"]) {
        const encoded = encodeTextString(value);
        const inner = encoded.startsWith("<")
            ? encoded.slice(1, -1)
            : encoded.slice(1, -1);
        const raw = encoded.startsWith("<")
            ? new Uint8Array(Buffer.from(inner, "hex"))
            : new Uint8Array(Buffer.from(inner, "latin1"));
        assert.equal(decodeTextStringBytes(raw), value, value);
    }
});

test("name objects resolve their hash escapes", () => {
    assert.equal(decodeName("/Helv"), "Helv");
    assert.equal(decodeName("/On#20Two"), "On Two");
    assert.equal(decodeName("/A#2FB"), "A/B");
});

test("WinAnsi maps its high window away from Latin-1", () => {
    assert.equal(winAnsiByteForCodePoint(0x20ac), 0x80, "euro");
    assert.equal(winAnsiByteForCodePoint(0x2019), 0x92, "right quote");
    assert.equal(winAnsiByteForCodePoint(0x41), 0x41);
    assert.equal(winAnsiByteForCodePoint(0xe9), 0xe9);
});

test("WinAnsi reports what it cannot encode instead of substituting", () => {
    const encoded = encodeWinAnsi("ok日本");
    assert.deepEqual([...encoded.bytes], [0x6f, 0x6b]);
    assert.deepEqual(encoded.unmapped, ["日", "本"]);
    assert.equal(isWinAnsiRepresentable("ok"), true);
    assert.equal(isWinAnsiRepresentable("日"), false);
});
