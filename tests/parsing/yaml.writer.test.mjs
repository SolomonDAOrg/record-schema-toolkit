import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseYaml, stringifyYaml } from "../../lib/parsing/yaml.mjs";

// =============================================================================
// Nesting depth
//
// Each writer produced a fragment carrying its own absolute depth, and the
// caller then indented that fragment by its child depth as well. The two
// compounded: at indent 2 a four-deep document came out at 0, 2, 6, 12 instead
// of 0, 2, 4, 6. It parsed back, because a block only has to be internally
// consistent, so round-trip tests never saw it.
// =============================================================================

/**
 * The distinct leading-space widths of a document's non-empty lines.
 * @param {string} text
 * @returns {number[]}
 */
function indents(text) {
    const widths = new Set();
    for (const line of text.split("\n")) {
        if (line.trim().length > 0) {
            widths.add(line.length - line.trimStart().length);
        }
    }
    return [...widths].sort((a, b) => a - b);
}

describe("mapping indentation", () => {
    it("adds one step per level", () =>
        assert.deepEqual(
            indents(stringifyYaml({ a: { b: { c: { d: "e" } } } })),
            [0, 2, 4, 6]
        ));

    it("honours the indent width at every level", () =>
        assert.deepEqual(
            indents(
                stringifyYaml({ a: { b: { c: { d: "e" } } } }, { indent: 4 })
            ),
            [0, 4, 8, 12]
        ));

    it("writes each level exactly where it belongs", () =>
        assert.equal(
            stringifyYaml({ a: { b: { c: "d" } } }),
            "a:\n  b:\n    c: d\n"
        ));

    it("keeps an empty mapping inline", () =>
        assert.equal(stringifyYaml({ a: {}, b: 1 }), "a: {}\nb: 1\n"));
});

describe("sequence indentation", () => {
    it("indents items one step under their key", () =>
        assert.equal(
            stringifyYaml({ items: ["a", "b"] }),
            "items:\n  - a\n  - b\n"
        ));

    it("adds one step per level for nested sequences", () =>
        assert.deepEqual(
            indents(stringifyYaml({ a: { b: { c: ["d", "e"] } } })),
            [0, 2, 4, 6]
        ));

    it("keeps an empty sequence inline", () =>
        assert.equal(stringifyYaml({ a: [], b: 1 }), "a: []\nb: 1\n"));
});

// The writer puts the block indicator on its own line rather than after the
// key. That is unconventional but valid, and both this parser and an outside
// one read it the same; only the depth of the block's content is at issue here.
describe("block scalar indentation", () => {
    it("indents a literal block one step under its indicator", () =>
        assert.deepEqual(
            indents(stringifyYaml({ text: "one\ntwo\n" })),
            [0, 2, 4]
        ));

    it("adds one step per level for a nested literal block", () =>
        assert.deepEqual(
            indents(stringifyYaml({ outer: { text: "one\ntwo\n" } })),
            [0, 2, 4, 6]
        ));

    it("reads the block back unchanged", () => {
        const document = { outer: { text: "one\ntwo\n" } };
        assert.deepEqual(parseYaml(stringifyYaml(document)), document);
    });
});

describe("round trips survive the indentation", () => {
    const shapes = {
        "four-deep mapping": { a: { b: { c: { d: "e" } } } },
        "nested sequences": { a: { b: [["x", "y"], ["z"]] } },
        "sequence of mappings": { m: [{ a: 1, b: 2, c: 3 }, { d: 4 }] },
        "literal block": { a: { b: "one\ntwo\nthree\n" } },
        mixed: { a: { b: [{ c: { d: ["e", "f"] } }] } },
        "empty containers": { o: {}, a: [], s: "" }
    };

    for (const [label, document] of Object.entries(shapes)) {
        it(`preserves ${label} at indent 2`, () =>
            assert.deepEqual(parseYaml(stringifyYaml(document)), document));
        it(`preserves ${label} at indent 4`, () =>
            assert.deepEqual(
                parseYaml(stringifyYaml(document, { indent: 4 })),
                document
            ));
    }
});

// =============================================================================
// Scalars a reader would take for something other than a string
//
// The writer already quoted the YAML 1.2 spellings. It did not quote the 1.1
// boolean words, so a string "Yes" was written bare and a reader honouring
// YAML 1.1 read it back as true — which matters because these files get
// edited
// and linted by tools other than this one.
// =============================================================================

describe("ambiguous scalars", () => {
    const words = [
        "y",
        "n",
        "Y",
        "N",
        "yes",
        "no",
        "Yes",
        "No",
        "YES",
        "on",
        "off",
        "On",
        "Off",
        "true",
        "false",
        "null",
        "~"
    ];

    for (const word of words) {
        it(`quotes ${JSON.stringify(word)}`, () => {
            const text = stringifyYaml({ value: word });
            assert.match(
                text,
                /^value: ["']/,
                `expected a quoted scalar, got ${JSON.stringify(text)}`
            );
            assert.equal(parseYaml(text).value, word);
        });
    }

    it("leaves ordinary words unquoted", () => {
        for (const word of ["Maybe", "Yesterday", "nope", "online", "north"]) {
            assert.equal(
                stringifyYaml({ value: word }),
                `value: ${word}\n`,
                word
            );
        }
    });

    it("quotes the words wherever they appear", () => {
        const document = {
            labels: { true_label: "Yes", false_label: "No" },
            list: ["on", "off"]
        };
        const text = stringifyYaml(document);
        assert.match(text, /true_label: "Yes"/);
        assert.match(text, /- "on"/);
        assert.deepEqual(parseYaml(text), document);
    });
});

// =============================================================================
// Tagged block nodes
//
// A tag whose line ends after it is followed by its node on the lines beneath.
// The parser read on from the tag without taking that step, so it consumed only
// the first scalar: !!set came back empty and !!omap came back as its first
// key. Flow nodes and same-line scalars were unaffected, which is why the tag
// handling looked correct.
// =============================================================================

/**
 * The members of a parsed set, sorted.
 * @param {*} value
 * @returns {string[]}
 */
function members(value) {
    assert.ok(value instanceof Set, `expected a Set, got ${typeof value}`);
    return [...value].sort();
}

describe("tagged block nodes", () => {
    it("reads a set tagged on its key's line", () =>
        assert.deepEqual(
            members(parseYaml("s: !!set\n  a: null\n  b: null\n").s),
            ["a", "b"]
        ));

    it("reads a set tagged on a line of its own", () =>
        assert.deepEqual(
            members(parseYaml("s:\n  !!set\n    a: null\n    b: null\n").s),
            ["a", "b"]
        ));

    it("reads a set at the top of a document", () =>
        assert.deepEqual(members(parseYaml("!!set\n  a: null\n  b: null\n")), [
            "a",
            "b"
        ]));

    it("still reads a set written in flow style", () =>
        assert.deepEqual(
            members(parseYaml("s: !!set {a: null, b: null}\n").s),
            ["a", "b"]
        ));

    it("reads a mapping under a tag rather than its first key", () =>
        assert.deepEqual(parseYaml("m: !!omap\n  a: 1\n  b: 2\n").m, {
            a: 1,
            b: 2
        }));

    it("reads a sequence under a tag", () =>
        assert.deepEqual(parseYaml("s: !!seq\n  - a\n  - b\n").s, ["a", "b"]));

    it("leaves a same-line scalar tag alone", () =>
        assert.equal(parseYaml("s: !!str hello\n").s, "hello"));

    it("gives a tag with nothing beneath it no value", () =>
        assert.deepEqual(parseYaml("a: !!set\nb: 1\n"), {
            a: new Set(),
            b: 1
        }));
});

describe("sets survive a round trip", () => {
    const shapes = {
        "a set in a mapping": { s: new Set(["a", "b"]) },
        "a nested set": { a: { b: new Set(["x", "y"]) } },
        "a set among other keys": {
            before: 1,
            s: new Set(["a"]),
            after: 2
        },
        "two sets": { p: new Set(["a"]), q: new Set(["b", "c"]) },
        "a set inside a sequence": { list: [new Set(["a", "b"])] },
        "a deeply nested set": { a: { b: { c: { s: new Set(["deep"]) } } } }
    };

    for (const [label, document] of Object.entries(shapes)) {
        for (const indent of [2, 4]) {
            it(`preserves ${label} at indent ${indent}`, () => {
                const text = stringifyYaml(document, { indent });
                const parsed = parseYaml(text);
                assert.deepEqual(parsed, document);
            });
        }
    }

    it("preserves a set at the top of a document", () =>
        assert.deepEqual(
            parseYaml(stringifyYaml(new Set(["a", "b", "c"]))),
            new Set(["a", "b", "c"])
        ));

    it("keeps the other keys of a mapping that holds a set", () => {
        const document = { before: 1, s: new Set(["a"]), after: 2 };
        const parsed = parseYaml(stringifyYaml(document));
        assert.equal(parsed.before, 1);
        assert.equal(parsed.after, 2);
        assert.deepEqual(members(parsed.s), ["a"]);
    });
});
