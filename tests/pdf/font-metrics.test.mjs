import assert from "node:assert/strict";
import test from "node:test";
import { parseTtfFont } from "../../lib/pdf/font-embed.mjs";

/** A minimal metrics-only SFNT with distinct space, capital A and em-dash widths.
 * OS/2 fields follow https://learn.microsoft.com/en-us/typography/opentype/spec/os2.
 * @param {number} [os2Length] @returns {Uint8Array}
 */
function metricsFont(os2Length = 96) {
    const head = Buffer.alloc(54);
    head.writeUInt16BE(2000, 18);
    const horizontalHeader = Buffer.alloc(36);
    horizontalHeader.writeInt16BE(1974, 4);
    horizontalHeader.writeInt16BE(-426, 6);
    horizontalHeader.writeUInt16BE(4, 34);
    const horizontalMetrics = Buffer.alloc(16);
    [1000, 500, 1200, 1800].forEach((width, index) => horizontalMetrics.writeUInt16BE(width, index * 4));
    const characterMap = Buffer.alloc(64);
    characterMap.writeUInt16BE(1, 2);
    characterMap.writeUInt16BE(3, 4);
    characterMap.writeUInt16BE(10, 6);
    characterMap.writeUInt32BE(12, 8);
    characterMap.writeUInt16BE(12, 12);
    characterMap.writeUInt32BE(52, 16);
    characterMap.writeUInt32BE(3, 24);
    [0x20, 0x41, 0x2014].forEach((codePoint, index) => {
        const offset = 28 + index * 12;
        characterMap.writeUInt32BE(codePoint, offset);
        characterMap.writeUInt32BE(codePoint, offset + 4);
        characterMap.writeUInt32BE(index + 1, offset + 8);
    });
    const operatingSystem = Buffer.alloc(96);
    operatingSystem.writeUInt16BE(3, 0);
    operatingSystem.writeInt16BE(1026, 86);
    operatingSystem.writeInt16BE(1446, 88);
    operatingSystem.writeUInt16BE(0, 90);
    const locations = Buffer.alloc(10);
    [0, 0, 0, 5, 10].forEach((offset, index) => locations.writeUInt16BE(offset, index * 2));
    const outlines = Buffer.alloc(20);
    outlines.writeInt16BE(-20, 4);
    outlines.writeInt16BE(1446, 8);
    outlines.writeInt16BE(600, 14);
    outlines.writeInt16BE(700, 18);
    const tables = new Map([["head", head], ["hhea", horizontalHeader], ["hmtx", horizontalMetrics], ["cmap", characterMap], ["OS/2", operatingSystem], ["loca", locations], ["glyf", outlines]]);
    const directory = Buffer.alloc(12 + tables.size * 16);
    directory.writeUInt32BE(0x00010000, 0);
    directory.writeUInt16BE(tables.size, 4);
    let offset = directory.length, index = 0;
    for (const [tag, bytes] of tables) {
        const entry = 12 + index++ * 16;
        directory.write(tag, entry, 4, "ascii");
        directory.writeUInt32BE(offset, entry + 8);
        directory.writeUInt32BE(tag === "OS/2" ? os2Length : bytes.length, entry + 12);
        offset += bytes.length;
    }
    return Buffer.concat([directory, ...tables.values()]);
}

test("capital-height metrics read sCapHeight independently of the default character", () => {
    const font = parseTtfFont(metricsFont());
    assert.equal(font.capHeight, 1446);
    assert.equal(font.unitsPerEm, 2000);
    assert.equal(parseTtfFont(metricsFont(88)).capHeight, Math.round(1974 * 0.7), "A truncated table uses the fallback without reading beyond its bounds");
});

test("WinAnsi punctuation advances use the actual Unicode glyph width", () => {
    const font = parseTtfFont(metricsFont());
    assert.equal(font.charWidths[0x20], 250);
    assert.equal(font.charWidths[0x41], 600);
    assert.equal(font.charWidths[0x97], 900, "WinAnsi 0x97 selects the em dash, not a missing control glyph");
    assert.equal(font.charWidths[0x97], font.widthForCodePoint(0x2014));
});

test("glyph bounds distinguish cap outlines, elevated punctuation and empty spaces", () => {
    const font = parseTtfFont(metricsFont());
    assert.deepEqual(font.glyphBoundsForCodePoint(0x41), { yMin: -20, yMax: 1446 });
    assert.deepEqual(font.glyphBoundsForCodePoint(0x2014), { yMin: 600, yMax: 700 });
    assert.equal(font.glyphBoundsForCodePoint(0x20), null);
});
