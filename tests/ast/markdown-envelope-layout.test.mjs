import assert from "node:assert/strict";
import test from "node:test";
import { layoutMarkdownEnvelopeRows } from "../../lib/ast/layout/markdown-envelope.mjs";

/** @type {import("../../lib/ast/layout/markdown-envelope.mjs").MarkdownEnvelopeRowConfiguration} */
const configuration = {
    width: 480,
    labelWidth: 90,
    fontSize: 10,
    labelFontSize: 9,
    lineSpacing: 1.35,
    columns: "auto",
    columnGap: 24
};

test("automatic metadata falls back to full rows when two value columns cannot fit", () => {
    const rows = layoutMarkdownEnvelopeRows(
        4,
        { ...configuration, width: 260 },
        () => 1
    );
    assert.deepEqual(
        rows.map((row) => row.cells.map((cell) => cell.entryIndex)),
        [[0], [1], [2], [3]]
    );
    assert.ok(rows.every((row) => row.cells[0].valueWidth === 170));
    assert.throws(
        () =>
            layoutMarkdownEnvelopeRows(
                4,
                { ...configuration, width: 260, columns: 2 },
                () => 1
            ),
        /insufficient width/
    );
});

test("explicit paired metadata reserves the tallest wrapped value and retains an odd last entry", () => {
    const lines = [1, 3, 2];
    const rows = layoutMarkdownEnvelopeRows(
        3,
        { ...configuration, columns: 2 },
        (index) => lines[index]
    );
    assert.deepEqual(
        rows.map((row) => row.cells.map((cell) => cell.entryIndex)),
        [[0, 1], [2]]
    );
    assert.equal(rows[0].height, 3 * 10 * 1.35);
    assert.equal(rows[1].height, 2 * 10 * 1.35);
    assert.equal(rows[0].cells[1].offset, 252);
    assert.equal(rows[1].cells[0].valueWidth, 138);
});
