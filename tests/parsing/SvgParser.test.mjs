import assert from "node:assert/strict";
import test from "node:test";

import { SvgParser } from "../../lib/parsing/SvgParser.mjs";

test("normalizes relative paths, implicit lines, exponents and closed subpaths", () => {
    assert.deepEqual(
        SvgParser.parseSvgPath("m1e1,20 5-5 h10 v5 z m2 3 l.5-.5"),
        [
            { command: "M", x: 10, y: 20 },
            { command: "L", x: 15, y: 15 },
            { command: "L", x: 25, y: 15 },
            { command: "L", x: 25, y: 20 },
            { command: "Z" },
            { command: "M", x: 12, y: 23 },
            { command: "L", x: 12.5, y: 22.5 }
        ]
    );
});

test("reflects cubic controls only after a cubic or smooth cubic segment", () => {
    assert.deepEqual(
        SvgParser.parseSvgPath(
            "M0 0 c1 2 3 4 5 6 s2 3 4 5 L20 20 S21 22 23 24"
        ),
        [
            { command: "M", x: 0, y: 0 },
            { command: "C", x1: 1, y1: 2, x2: 3, y2: 4, x: 5, y: 6 },
            { command: "C", x1: 7, y1: 8, x2: 7, y2: 9, x: 9, y: 11 },
            { command: "L", x: 20, y: 20 },
            { command: "C", x1: 20, y1: 20, x2: 21, y2: 22, x: 23, y: 24 }
        ]
    );
});

test("converts quadratic and smooth quadratic controls to cubic curves", () => {
    assert.deepEqual(SvgParser.parseSvgPath("M0 0 Q3 6 6 0 t6 0"), [
        { command: "M", x: 0, y: 0 },
        { command: "C", x1: 2, y1: 4, x2: 4, y2: 4, x: 6, y: 0 },
        { command: "C", x1: 8, y1: -4, x2: 10, y2: -4, x: 12, y: 0 }
    ]);
});

test("rejects unsupported commands and malformed path data explicitly", () => {
    for (const source of [
        "L0 0",
        "M0",
        "M0 0 L1",
        "M0 0 C1 2 3 4 5",
        "M0 0 A1 1 0 0 0 2 2",
        "M0 0 Z 4",
        "M0 0 ? 4",
        "M1e999 0"
    ]) {
        assert.throws(() => SvgParser.parseSvgPath(source), /SVG path/);
    }
    assert.deepEqual(SvgParser.parseSvgPath(""), []);
});

test("parses nested SVG elements and quoted attributes through the same class", () => {
    assert.deepEqual(
        SvgParser.parse(
            '<svg viewBox="0 0 10 20"><g><path d="M0 0L1 2"/></g><text>A &amp; B</text></svg>'
        ),
        {
            tag: "#root",
            attrs: {},
            text: "",
            children: [
                {
                    tag: "svg",
                    attrs: { viewBox: "0 0 10 20" },
                    text: "",
                    children: [
                        {
                            tag: "g",
                            attrs: {},
                            text: "",
                            children: [
                                {
                                    tag: "path",
                                    attrs: { d: "M0 0L1 2" },
                                    text: "",
                                    children: []
                                }
                            ]
                        },
                        { tag: "text", attrs: {}, text: "A & B", children: [] }
                    ]
                }
            ]
        }
    );
});
