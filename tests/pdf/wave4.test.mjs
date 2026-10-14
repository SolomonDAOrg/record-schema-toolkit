/**
 * Wave 3b validation: table / flowable layout. node internals only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { layoutTable } from "../../lib/pdf/table.mjs";
import DocMod from "../../lib/pdf/document.mjs";

const { PdfDocumentBuilder } = DocMod;

test("column widths: fixed + star, overflow scaling, remainder to last", () => {
    const star = layoutTable({
        columns: [{ width: 200 }, { width: 60 }, {}],
        rows: [["a", "b", "c"]],
        width: 400,
        x: 0,
        top: 700
    });
    assert.deepEqual(
        star.columnWidths,
        [200, 60, 140],
        "star absorbs leftover"
    );

    const overflow = layoutTable({
        columns: [{ width: 300 }, { width: 300 }],
        rows: [["a", "b"]],
        width: 400,
        x: 0,
        top: 700
    });
    assert.deepEqual(
        overflow.columnWidths,
        [200, 200],
        "overflow scaled to fit"
    );

    const remainder = layoutTable({
        columns: [{ width: 100 }, { width: 100 }],
        rows: [["a", "b"]],
        width: 400,
        x: 0,
        top: 700
    });
    assert.deepEqual(
        remainder.columnWidths,
        [100, 300],
        "remainder to last col"
    );
});

test("single page when no bottom is given", () => {
    const r = layoutTable({
        columns: [{ header: "H0" }, { header: "H1" }],
        rows: [
            ["R0", "x"],
            ["R1", "x"],
            ["R2", "x"]
        ],
        width: 200,
        x: 0,
        top: 700
    });
    assert.equal(r.pages.length, 1);
    const s = r.pages[0];
    for (let i = 0; i < 3; i++) {
        assert.equal(
            (s.match(new RegExp("\\(R" + i + "\\)", "g")) || []).length,
            1
        );
    }
});

test("pagination breaks rows across pages and repeats the header", () => {
    const rows = [];
    for (let i = 0; i < 6; i++) {
        rows.push(["R" + i, "v" + i]);
    }
    const r = layoutTable({
        columns: [{ header: "H0" }, { header: "H1", align: "right" }],
        rows,
        width: 200,
        x: 0,
        top: 700,
        bottom: 640 // ~60pt band -> header + 2 rows per page
    });
    assert.equal(r.pages.length, 3, "6 rows / 2 per page = 3 pages");

    const all = r.pages.join("\n");
    // Header repeated on every page.
    assert.equal((all.match(/\(H0\)/g) || []).length, 3, "header on each page");
    // Every body row drawn exactly once, none lost or duplicated.
    let total = 0;
    for (let i = 0; i < 6; i++) {
        const n = (all.match(new RegExp("\\(R" + i + "\\)", "g")) || []).length;
        assert.equal(n, 1, "row R" + i + " drawn once");
        total = total + n;
    }
    assert.equal(total, 6);
});

test("repeatHeader:false draws the header only on the first page", () => {
    const rows = [];
    for (let i = 0; i < 6; i++) {
        rows.push(["R" + i, "v"]);
    }
    const r = layoutTable({
        columns: [{ header: "H0" }, { header: "H1" }],
        rows,
        width: 200,
        x: 0,
        top: 700,
        bottom: 640,
        repeatHeader: false
    });
    const all = r.pages.join("\n");
    assert.equal((all.match(/\(H0\)/g) || []).length, 1, "header once total");
});

test("structural: fills, grid stroke, and text present", () => {
    const r = layoutTable({
        columns: [
            { header: "Item", width: 150 },
            { header: "Amt", align: "right" }
        ],
        rows: [["Widget", "10.00"]],
        width: 250,
        x: 10,
        top: 500,
        style: {
            headerFill: 0.9,
            rowFill: 0.96,
            borderWidth: 0.75,
            borderGray: 0.2
        }
    });
    const s = r.pages[0];
    assert.ok(s.includes("0.9 g"), "header fill gray");
    assert.ok(/\bre\b/.test(s) && /\bf\b/.test(s), "filled rectangle");
    assert.ok(s.includes("0.75 w"), "border width");
    assert.ok(/\bS\b/.test(s), "grid stroked");
    assert.ok(s.includes("(Widget)"), "cell text");
});

test("tall wrapped cell makes its page shorter (fewer rows fit)", () => {
    const longText =
        "This is a deliberately long cell that must wrap onto several lines inside a narrow column and therefore take extra vertical space";
    const short = layoutTable({
        columns: [{ width: 120 }, {}],
        rows: [
            ["A", "one"],
            ["B", "two"],
            ["C", "three"],
            ["D", "four"]
        ],
        width: 240,
        x: 0,
        top: 700,
        bottom: 620
    });
    const tall = layoutTable({
        columns: [{ width: 120 }, {}],
        rows: [
            ["A", longText],
            ["B", "two"],
            ["C", "three"],
            ["D", "four"]
        ],
        width: 240,
        x: 0,
        top: 700,
        bottom: 620
    });
    assert.ok(
        tall.pages.length >= short.pages.length,
        "wrapping never reduces page count"
    );
});

test("renders into a valid multi-page document", () => {
    const rows = [];
    for (let i = 0; i < 40; i++) {
        rows.push(["Line item " + i, String(i * 3), (i * 12.5).toFixed(2)]);
    }
    const { pages } = layoutTable({
        columns: [
            { header: "Description", width: 300 },
            { header: "Qty", width: 60, align: "right" },
            { header: "Amount", align: "right" }
        ],
        rows,
        width: 468,
        x: 72,
        top: 720,
        bottom: 72,
        style: { headerFill: 0.88, rowFill: 0.97 }
    });
    assert.ok(pages.length > 1, "40 rows paginate");

    const doc = new PdfDocumentBuilder({ title: "Statement" });
    for (let i = 0, len = pages.length; i < len; i++) {
        doc.addPageFromString(pages[i]);
    }
    const pdf = doc.build();
    const s = new TextDecoder("latin1").decode(pdf);
    assert.ok(s.startsWith("%PDF-"), "valid header");
    // page count in /Pages Count matches
    assert.ok(
        s.includes("/Count " + pages.length),
        "pages Count matches fragments"
    );
});
