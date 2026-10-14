import assert from "node:assert/strict";
import test from "node:test";
import {
    parseMarkdownDoc,
    reflowMarkdown
} from "../../lib/parsing/markdown.mjs";
import { normalizeBaseline } from "../../lib/record-schema/util/normalization.mjs";

/** @typedef {import("../../lib/parsing/markdown.mjs").MarkdownNode} MarkdownNode */
/** @param {MarkdownNode[]} nodes @returns {string} */
function inlineText(nodes) {
    return nodes
        .map((node) =>
            node.type === "line-break"
                ? "\n"
                : node.children.length
                  ? inlineText(node.children)
                  : node.content
        )
        .join("");
}
/** @param {string} source @param {boolean} [softWrap] @returns {MarkdownNode[]} */
function paragraphs(source, softWrap = true) {
    return parseMarkdownDoc(source, { softWrap }).nodes.filter(
        (node) => node.type === "paragraph"
    );
}

test("soft wrapping joins plain source lines and preserves the established punctuation opt-out", () => {
    assert.equal(
        paragraphs("First line\nsecond line")[0].content,
        "First line second line"
    );
    assert.equal(paragraphs("First line\nsecond line", false).length, 2);
    assert.equal(parseMarkdownDoc("First line\nsecond line").nodes.length, 2);
    for (const punctuation of [".", "?", "!", ":", ";", ")"]) {
        assert.equal(
            paragraphs("First" + punctuation + "\nSecond").length,
            2,
            punctuation
        );
        assert.equal(
            paragraphs("First" + punctuation + " \nSecond")[0].content,
            "First" + punctuation + "  Second"
        );
    }
    assert.equal(paragraphs("First,\nsecond")[0].content, "First, second");
});

for (const ending of ["\n", "\r\n", "\r"]) {
    for (const softWrap of [true, false]) {
        test(
            "explicit breaks survive subsequent continuations: " +
                JSON.stringify({ ending, softWrap }),
            () => {
                for (const marker of ["  ", "    ", "\\"]) {
                    const source = ["First" + marker, "second", "  third"].join(
                        ending
                    );
                    const nodes = paragraphs(source, softWrap);
                    assert.equal(nodes.length, 1);
                    assert.equal(
                        inlineText(nodes[0].children),
                        softWrap
                            ? "First\nsecond third"
                            : "First\nsecond\nthird"
                    );
                }
                const escaped = paragraphs(
                    "First\\\\" + ending + "second",
                    true
                );
                assert.equal(inlineText(escaped[0].children), "First\\ second");
                const terminal = paragraphs("First\\", softWrap);
                assert.equal(inlineText(terminal[0].children), "First\\");
            }
        );
    }
}

test("inline spans remain intact across soft joins and explicit hard breaks", () => {
    const bold = paragraphs("**First\nsecond**")[0];
    assert.equal(bold.children[0].type, "bold");
    assert.equal(inlineText(bold.children), "First second");
    const brokenBold = paragraphs("**First  \nsecond\nthird**")[0];
    assert.equal(brokenBold.children[0].type, "bold");
    assert.equal(inlineText(brokenBold.children), "First\nsecond third");
    const link = paragraphs("[First\nsecond](https://example.test)")[0];
    assert.equal(link.children[0].type, "link");
    assert.equal(inlineText(link.children), "First second");
});

test("blank lines and structural blocks terminate paragraph joining", () => {
    for (const separator of ["\n\n", "\n  \n"]) {
        assert.equal(paragraphs("First" + separator + "Second").length, 2);
        assert.equal(paragraphs("First  " + separator + "Second").length, 2);
    }
    for (const block of [
        "# Heading",
        "- List item",
        "---",
        ":::notice\nNotice\n:::",
        "| Label | Detail |\n|---|---|\n| Value | Detail |",
        "\u0060\u0060\u0060\nCode\n\u0060\u0060\u0060"
    ]) {
        const nodes = paragraphs("First\n" + block + "\nSecond");
        assert.equal(nodes[0].content, "First", block);
        assert.equal(nodes.at(-1).content, "Second", block);
    }
});

test("list and legal continuations retain explicit breaks and their own join state", () => {
    const list = parseMarkdownDoc("- First  \n  second\n  third", {
        softWrap: true
    }).nodes[0];
    assert.equal(inlineText(list.children), "First\nsecond third");
    const nodes = paragraphs("Parent.\n  (a) First\n    second", true);
    assert.equal(nodes.length, 2);
    assert.equal(nodes[1].content, "(a) First second");
    const separated = parseMarkdownDoc("- Item\n\n  Independent", {
        softWrap: true
    }).nodes;
    assert.equal(separated.at(-1).type, "paragraph");
    assert.equal(separated.at(-1).content, "Independent");
});

test("arbitrary bold field labels form separate rows without named metadata special cases", () => {
    const nodes = paragraphs(
        "**Arbitrary field:** Alpha\n**Another field:** Beta\ncontinuation"
    );
    assert.equal(nodes.length, 2);
    assert.equal(nodes[0].content, "**Arbitrary field:** Alpha");
    assert.equal(nodes[1].content, "**Another field:** Beta continuation");
});

test("nested directives inherit the requested soft-wrap mode", () => {
    for (const softWrap of [true, false]) {
        const source = ":::notice\n:::notice\nFirst\nsecond\n:::\n:::";
        const inner = parseMarkdownDoc(source, { softWrap }).nodes[0]
            .children[0];
        assert.equal(inner.children.length, softWrap ? 1 : 2);
        assert.equal(
            inlineText(inner.children),
            softWrap ? "First second" : "Firstsecond"
        );
    }
});

test("normalization retains the established trailing-whitespace policy", () => {
    assert.equal(
        normalizeBaseline(
            "First   \nSecond.   \nThird;\t\nFourth:\t\nFifth! \nSixth? \nSeventh) \n"
        ),
        "First\nSecond. \nThird; \nFourth: \nFifth!\nSixth?\nSeventh)\n"
    );
    assert.equal(normalizeBaseline("First\\\nsecond\n"), "First\\\nsecond\n");
});

test("reflow preserves nested directive definitions and embedded closing-fence text", () => {
    const directive =
        ":::notice\n:::data-table records.tsv\ncolumns:\n  - { header: Name, type: text, align: left, width: auto }\n:::\n\u0060\u0060\u0060\n:::\n\u0060\u0060\u0060\n:::";
    const source = "Before\n\n" + directive + "\n\nAfter\n";
    assert.equal(reflowMarkdown(source, 20).text, source);
});
