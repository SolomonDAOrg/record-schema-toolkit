import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseYaml, stringifyYaml } from "../../lib/parsing/yaml.mjs";

// =============================================================================
// Flow context: multi-line plain scalars
//
// A plain scalar inside a flow collection folds across line breaks. Previously
// the scalar terminated at the newline and the parser then reported
// "Expected ',' or '}' in flow mapping".
// =============================================================================

describe("flow scalar folding", () => {
    it("folds a plain scalar across one line break", () =>
        assert.deepEqual(parseYaml("m: { a: Hello\n      world. }\n"), {
            m: { a: "Hello world." }
        }));

    it("folds a plain scalar inside a block sequence entry", () =>
        assert.deepEqual(
            parseYaml(
                "docs:\n" +
                    "    - { path: a.yaml, label: State store - pool position\n" +
                    "        aggregate }\n"
            ),
            {
                docs: [
                    {
                        path: "a.yaml",
                        label: "State store - pool position aggregate"
                    }
                ]
            }
        ));

    it("keeps a blank line as a break when folding", () =>
        assert.deepEqual(parseYaml("m: { a: one\n\n      two }\n"), {
            m: { a: "one\ntwo" }
        }));

    it("does not fold past a closing brace", () =>
        assert.deepEqual(parseYaml("m: { a: one }\nb: two\n"), {
            m: { a: "one" },
            b: "two"
        }));

    it("does not fold past a comma onto the next entry", () =>
        assert.deepEqual(parseYaml("m: { a: one,\n     b: two }\n"), {
            m: { a: "one", b: "two" }
        }));

    it("terminates a folded scalar at a comment", () =>
        assert.deepEqual(parseYaml("m: { a: one # note\n     , b: two }\n"), {
            m: { a: "one", b: "two" }
        }));
});

// =============================================================================
// Flow context: implicit single-pair mappings in sequences
//
// `[ key: value ]` is a sequence holding a single-pair mapping. Previously the
// whole entry was captured as the string "key: value".
// =============================================================================

describe("flow sequence single-pair mappings", () => {
    it("wraps a lone implicit pair", () =>
        assert.deepEqual(parseYaml("records: [record: CreatePosition]\n"), {
            records: [{ record: "CreatePosition" }]
        }));

    it("wraps several implicit pairs", () =>
        assert.deepEqual(parseYaml("records: [record: a, record: b]\n"), {
            records: [{ record: "a" }, { record: "b" }]
        }));

    it("wraps implicit pairs whose values are flow mappings", () =>
        assert.deepEqual(
            parseYaml("action: [read: { tier: Hot }, read: { tier: Cold }]\n"),
            { action: [{ read: { tier: "Hot" } }, { read: { tier: "Cold" } }] }
        ));

    it("folds an implicit pair value across a line break", () =>
        assert.deepEqual(
            parseYaml("records: [record: a, record: \n    b_continued]\n"),
            { records: [{ record: "a" }, { record: "b_continued" }] }
        ));

    it("leaves plain sequence entries unwrapped", () =>
        assert.deepEqual(parseYaml("items: [one, two, 3]\n"), {
            items: ["one", "two", 3]
        }));

    it("does not treat a colon inside a URL as a pair colon", () =>
        assert.deepEqual(parseYaml("items: [http://example.test/x]\n"), {
            items: ["http://example.test/x"]
        }));
});

// =============================================================================
// Block sequences: multi-line plain scalar entries
//
// A plain scalar entry continues while its lines out-indent the `-` indicator.
// Previously the bound was the indicator column plus two, so a continuation at
// exactly that column ended the scalar, dropped the remaining entries, and
// dropped the following sibling key.
// =============================================================================

describe("block sequence plain scalar entries", () => {
    it("continues an entry indented to the content column", () =>
        assert.deepEqual(
            parseYaml(
                "root:\n" +
                    "  items:\n" +
                    "    - first line\n" +
                    "      continues here.\n" +
                    "    - second\n" +
                    "  other: kept\n"
            ),
            {
                root: {
                    items: ["first line continues here.", "second"],
                    other: "kept"
                }
            }
        ));

    it("continues an entry when the sequence sits at the parent indent", () =>
        assert.deepEqual(
            parseYaml(
                "root:\n" +
                    "    items:\n" +
                    "    - first line\n" +
                    "      continues here.\n" +
                    "    - second\n" +
                    "    other: kept\n"
            ),
            {
                root: {
                    items: ["first line continues here.", "second"],
                    other: "kept"
                }
            }
        ));

    it("does not let a nested mapping swallow the following entry", () =>
        assert.deepEqual(
            parseYaml(
                "items:\n" +
                    "  - name: a\n" +
                    "    kind: x\n" +
                    "  - name: b\n" +
                    "    kind: y\n"
            ),
            {
                items: [
                    { name: "a", kind: "x" },
                    { name: "b", kind: "y" }
                ]
            }
        ));

    it("keeps a machine expression on one line", () =>
        assert.deepEqual(
            parseYaml(
                "invariants:\n" +
                    "  - expression: count(slot[*].live == 1\n" +
                    "      && slot[*].asset == asset) == 1\n"
            ),
            {
                invariants: [
                    {
                        expression:
                            "count(slot[*].live == 1 && slot[*].asset == asset) == 1"
                    }
                ]
            }
        ));
});

// =============================================================================
// Folded block scalars
//
// A run of N blank lines yields N breaks, not N + 1. Breaks adjacent to a
// more-indented line are never folded.
// =============================================================================

describe("folded block scalars", () => {
    it("folds a single blank line to one break", () =>
        assert.deepEqual(parseYaml("a: >-\n  one\n\n  two\n"), {
            a: "one\ntwo"
        }));

    it("folds two blank lines to two breaks", () =>
        assert.deepEqual(parseYaml("a: >-\n  one\n\n\n  two\n"), {
            a: "one\n\ntwo"
        }));

    it("joins adjacent text lines with a space", () =>
        assert.deepEqual(parseYaml("a: >-\n  one\n  two\n"), {
            a: "one two"
        }));

    it("preserves a more-indented line and its breaks", () =>
        assert.deepEqual(parseYaml("a: >-\n  one\n    kept\n  two\n"), {
            a: "one\n  kept\ntwo"
        }));

    it("does not fold breaks around a more-indented block", () =>
        assert.deepEqual(parseYaml("a: >-\n  one\n\n    kept\n\n  two\n"), {
            a: "one\n\n  kept\n\ntwo"
        }));

    it("clips the trailing break by default", () =>
        assert.deepEqual(parseYaml("a: >\n  one\n\n  two\n"), {
            a: "one\ntwo\n"
        }));

    it("keeps trailing breaks with the keep indicator", () =>
        assert.deepEqual(parseYaml("a: >+\n  one\n\n"), { a: "one\n\n" }));

    it("leaves literal block scalars unfolded", () =>
        assert.deepEqual(parseYaml("a: |\n  one\n\n  two\n"), {
            a: "one\n\ntwo\n"
        }));
});

// =============================================================================
// Quoted scalars
//
// An unescaped line break inside a quoted scalar folds: surrounding inline
// whitespace is dropped and a single break becomes a space.
// =============================================================================

describe("quoted scalar folding", () => {
    it("folds a double-quoted scalar across a line break", () =>
        assert.deepEqual(parseYaml('a: "one\n   two"\n'), { a: "one two" }));

    it("folds a blank line in a double-quoted scalar to a break", () =>
        assert.deepEqual(parseYaml('a: "one\n\n   two"\n'), { a: "one\ntwo" }));

    it("folds a double-quoted scalar inside a flow mapping", () =>
        assert.deepEqual(parseYaml('m: { label: "one\n     two" }\n'), {
            m: { label: "one two" }
        }));

    it("folds a single-quoted scalar across a line break", () =>
        assert.deepEqual(parseYaml("a: 'one\n   two'\n"), { a: "one two" }));

    it("honours an escaped line continuation", () =>
        assert.deepEqual(parseYaml('a: "one\\\n   two"\n'), { a: "onetwo" }));

    it("leaves a single-line quoted scalar untouched", () =>
        assert.deepEqual(parseYaml('a: "one  two"\n'), { a: "one  two" }));

    it("preserves an escaped newline", () =>
        assert.deepEqual(parseYaml('a: "one\\ntwo"\n'), { a: "one\ntwo" }));
});

describe("serialized long scalar values", () => {
    it("preserves paths, prose and significant whitespace through round trips", () => {
        const values = ["/records/" + "long-directory/".repeat(8) + "pack.json", "A statement with many words. ".repeat(8).trim(), "Repeated  spaces ".repeat(8).trim(), "Tabbed\tvalues ".repeat(8).trim()];
        const document = {profile:values[0],values,nested:{text:values[1]}};
        assert.deepEqual(parseYaml(stringifyYaml(document)),document);
    });
});
