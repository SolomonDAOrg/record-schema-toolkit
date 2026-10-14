/**
 * Placement arithmetic for field values: baselines, alignment, wrapping,
 * automatic sizing and comb cells.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    PADDING,
    centredBaseline,
    alignmentOffset,
    wrapText,
    layoutSingleLine,
    layoutMultiLine,
    layoutComb
} from "../../../lib/pdf/forms/appearance-layout.mjs";
import { measureFormText } from "../../../lib/pdf/forms/font-resource.mjs";

/** Helvetica's published metrics, standing in for a resolved form font. */
const HELVETICA = {
    resourceName: "Helv",
    objectId: 4,
    baseFont: "Helvetica",
    widths: null,
    firstChar: 0,
    winAnsi: true,
    ascent: 718,
    descent: -207
};

/** A font whose widths come from the file rather than a built-in table. */
const EMBEDDED = {
    resourceName: "Emb",
    objectId: 5,
    baseFont: "Custom",
    widths: new Array(256).fill(500),
    firstChar: 0,
    winAnsi: true,
    ascent: 900,
    descent: -200
};

test("a single line is centred on the box's vertical midpoint", () => {
    const boxHeight = 20;
    const fontSize = 10;
    const baseline = centredBaseline(HELVETICA, boxHeight, fontSize);
    const glyphHeight = ((718 + 207) * fontSize) / 1000;
    const spaceAbove = boxHeight - (baseline + (718 * fontSize) / 1000);
    const spaceBelow = baseline - (207 * fontSize) / 1000;
    assert.ok(Math.abs(spaceAbove - spaceBelow) < 1e-9, "equal margins");
    assert.ok(baseline > 0 && baseline + glyphHeight < boxHeight);
});

test("alignment places a line by its quadding", () => {
    assert.equal(alignmentOffset(100, 40, 0), 0, "left");
    assert.equal(alignmentOffset(100, 40, 1), 30, "centred");
    assert.equal(alignmentOffset(100, 40, 2), 60, "right");
    assert.equal(alignmentOffset(100, 40, null), 0, "unset is left");
    assert.equal(alignmentOffset(100, 40, 9), 0, "unrecognised is left");
});

test("embedded widths measure text instead of the built-in tables", () => {
    assert.equal(measureFormText(EMBEDDED, "abcd", 10), 20);
    assert.notEqual(
        measureFormText(HELVETICA, "abcd", 10),
        measureFormText(EMBEDDED, "abcd", 10)
    );
});

test("wrapping breaks between words and never exceeds the width", () => {
    const width = 100;
    const lines = wrapText(
        HELVETICA,
        "the quick brown fox jumps over the lazy dog",
        10,
        width
    );
    assert.ok(lines.length > 1);
    for (const line of lines) {
        assert.ok(
            measureFormText(HELVETICA, line, 10) <= width,
            "line fits: " + line
        );
    }
    assert.equal(
        lines.join(" "),
        "the quick brown fox jumps over the lazy dog"
    );
});

test("wrapping honours explicit line breaks", () => {
    assert.deepEqual(wrapText(HELVETICA, "one\ntwo", 10, 1000), ["one", "two"]);
    assert.deepEqual(wrapText(HELVETICA, "one\r\ntwo", 10, 1000), [
        "one",
        "two"
    ]);
});

test("a word wider than the box is split rather than left to overflow", () => {
    const width = 40;
    const lines = wrapText(HELVETICA, "Pneumonoultramicroscopic", 10, width);
    assert.ok(lines.length > 1);
    for (const line of lines) {
        assert.ok(measureFormText(HELVETICA, line, 10) <= width, line);
    }
    assert.equal(lines.join(""), "Pneumonoultramicroscopic");
});

test("an explicit /DA size is used as given", () => {
    const layout = layoutSingleLine(HELVETICA, "value", 9, 200, 20, 0);
    assert.equal(layout.fontSize, 9);
    assert.equal(layout.lines.length, 1);
    assert.equal(layout.lines[0].x, PADDING);
});

test("automatic sizing shrinks a long value until it fits the width", () => {
    const short = layoutSingleLine(HELVETICA, "ab", 0, 200, 20, 0);
    const long = layoutSingleLine(
        HELVETICA,
        "a value far too long for this narrow box",
        0,
        200,
        20,
        0
    );
    assert.ok(long.fontSize < short.fontSize, "long value sized down");
    assert.ok(
        measureFormText(HELVETICA, long.lines[0].text, long.fontSize) <=
            200 - PADDING * 2 + 1e-9
    );
});

test("automatic sizing is bounded by the box height", () => {
    const layout = layoutSingleLine(HELVETICA, "a", 0, 500, 8, 0);
    const glyphHeight = ((718 + 207) * layout.fontSize) / 1000;
    assert.ok(glyphHeight <= 8 - PADDING * 2 + 1e-9, "fits the inner height");
});

test("a right-aligned line ends at the box's inner right edge", () => {
    const boxWidth = 200;
    const layout = layoutSingleLine(HELVETICA, "right", 9, boxWidth, 20, 2);
    const width = measureFormText(HELVETICA, "right", 9);
    assert.ok(
        Math.abs(layout.lines[0].x + width - (boxWidth - PADDING)) < 1e-9
    );
});

test("multiline text runs downward from the top of the box", () => {
    const layout = layoutMultiLine(
        HELVETICA,
        "the quick brown fox jumps over the lazy dog",
        9,
        150,
        60,
        0
    );
    assert.ok(layout.lines.length > 1);
    for (let i = 1; i < layout.lines.length; i++) {
        assert.ok(
            layout.lines[i].y < layout.lines[i - 1].y,
            "each line sits below the last"
        );
    }
    assert.ok(layout.lines[0].y < 60, "first baseline is inside the box");
});

test("automatic sizing shrinks a multiline value until it fits", () => {
    const tall = layoutMultiLine(HELVETICA, "one two three", 0, 150, 200, 0);
    const short = layoutMultiLine(
        HELVETICA,
        "one two three four five six seven eight nine ten",
        0,
        150,
        24,
        0
    );
    assert.ok(short.fontSize < tall.fontSize);
});

test("comb cells are evenly spaced and hold one character each", () => {
    const boxWidth = 120;
    const cells = 6;
    const layout = layoutComb(HELVETICA, "ABC123", 9, boxWidth, 20, cells);
    assert.equal(layout.lines.length, 6);
    const cellWidth = boxWidth / cells;
    for (let i = 0; i < layout.lines.length; i++) {
        const line = layout.lines[i];
        assert.equal(line.text.length, 1);
        const centre = line.x + measureFormText(HELVETICA, line.text, 9) / 2;
        assert.ok(
            Math.abs(centre - (i + 0.5) * cellWidth) < 1e-9,
            "character " + i + " centred in its cell"
        );
    }
});

test("a comb value longer than its cell count is cut at the last cell", () => {
    const layout = layoutComb(HELVETICA, "ABCDEFGH", 9, 120, 20, 3);
    assert.equal(layout.lines.length, 3);
    assert.deepEqual(
        layout.lines.map((line) => line.text),
        ["A", "B", "C"]
    );
});

test("every comb character shares one baseline", () => {
    const layout = layoutComb(HELVETICA, "AB", 9, 60, 20, 2);
    assert.equal(layout.lines[0].y, layout.lines[1].y);
});
