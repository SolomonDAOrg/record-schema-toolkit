import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdownDoc } from "../../lib/parsing/markdown.mjs";
import { convertMarkdownToDocument } from "../../lib/ast/converters/MarkdownToAstConverter.mjs";
import { createPageSelectorPredicate } from "../../lib/ast/composers/DocumentComposer.mjs";
import { createDocumentPipeline } from "../../lib/ast/pipelines/DocumentPipeline.mjs";
import { createTwoPassPdfRenderer } from "../../lib/ast/renderers/TwoPassPdfRenderer.mjs";

/** @typedef {import("../../lib/ast/renderers/TwoPassPdfRenderer.mjs").PdfPage} PdfPage */
/** @typedef {import("../../lib/ast/nodes/BaseNode.mjs").BaseNode} BaseNode */

/** @param {string} markdown */
function render(markdown) {
    const document = convertMarkdownToDocument(
        parseMarkdownDoc(markdown, { softWrap: true })
    );
    const renderer = createTwoPassPdfRenderer({
        pageConfig: { size: "a4" },
        baseFontSize: 10,
        lineHeight: 1.5
    });
    /** @type {PdfPage[]} */
    let pages = [];
    const build = renderer.buildPdf.bind(renderer);
    renderer.buildPdf = (state) => {
        pages = state.pages;
        return build(state);
    };
    const result = createDocumentPipeline()
        .setRenderer(renderer)
        .processSingle({ id: "lists", name: "Lists", root: document.root });
    assert.equal(result.success, true, result.errors.join("; "));
    return { document, pages };
}

/** @param {string} stream */
function positions(stream) {
    return Array.from(
        stream.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm\n\(([^()]*)\) Tj/g),
        (match) => ({
            x: Number(match[1]),
            y: Number(match[2]),
            text: match[3]
        })
    );
}
/** @param {ReturnType<typeof positions>} text @param {string} value */
function at(text, value) {
    const position = text.find((candidate) => candidate.text === value);
    assert.ok(position, value + " was not drawn");
    return position;
}
/** @param {BaseNode} node @returns {string} */
function outline(node) {
    const children = node.children.filter(
        (child) =>
            child.type === "list" ||
            child.type === "list-item" ||
            child.type === "paragraph"
    );
    return (
        node.type +
        (children.length ? "(" + children.map(outline).join(",") + ")" : "")
    );
}

test("nested bullets render on their own lines, indented under their parent, without a gap", () => {
    const { pages } = render(
        "- parent\n  - child\n  - sibling\n    - grandchild\n- next\n"
    );
    const text = positions(pages[0].contentBuilder.build());
    const parent = at(text, "parent"),
        child = at(text, "child"),
        sibling = at(text, "sibling");
    const grandchild = at(text, "grandchild"),
        next = at(text, "next");
    assert.equal(parent.y - child.y, 15);
    assert.equal(child.y - sibling.y, 15);
    assert.equal(sibling.y - grandchild.y, 15);
    assert.equal(grandchild.y - next.y, 15);
    assert.equal(next.x, parent.x);
    assert.ok(child.x > parent.x, "child is not indented");
    assert.equal(sibling.x, child.x);
    assert.ok(grandchild.x > child.x, "grandchild is not indented");
});

test("a list indented after a continuation paragraph nests under that item", () => {
    const markdown =
        "- parent\n\n  continuation of the item\n\n  - child\n\n- second\n";
    const { document, pages } = render(markdown);
    assert.equal(
        document.root.children.map(outline).join(" "),
        "list(list-item(paragraph,list(list-item))) list(list-item)"
    );
    const text = positions(pages[0].contentBuilder.build());
    const parent = at(text, "parent"),
        child = at(text, "child"),
        second = at(text, "second");
    assert.ok(child.x > parent.x, "nested item is not indented");
    assert.equal(second.x, parent.x);
    assert.ok(
        child.y > second.y,
        "nested item follows its parent's continuation"
    );
});

test("a line that opens a numbered or lettered item is not soft-wrapped into the previous one", () => {
    const parsed = parseMarkdownDoc(
        "1. parent one\n    1. child a\n    2. child b\n2. parent two\n",
        { softWrap: true }
    );
    assert.deepEqual(
        parsed.nodes.map((node) => node.content),
        ["1. parent one", "1. child a", "2. child b", "2. parent two"]
    );
    const lettered = parseMarkdownDoc(
        "(a) first condition\n(b) second condition\n",
        { softWrap: true }
    );
    assert.deepEqual(
        lettered.nodes.map((node) => node.content),
        ["(a) first condition", "(b) second condition"]
    );
    const wrapped = parseMarkdownDoc(
        "A sentence that wraps\nonto the next line\n",
        { softWrap: true }
    );
    assert.deepEqual(
        wrapped.nodes.map((node) => node.content),
        ["A sentence that wraps onto the next line"]
    );
    const broken = parseMarkdownDoc("First  \n2. joined by a hard break\n", {
        softWrap: true
    });
    assert.deepEqual(
        broken.nodes.map((node) => node.content),
        ["First\n2. joined by a hard break"]
    );
});

test("section page selectors match the composer and the renderer alike", () => {
    assert.equal(
        createPageSelectorPredicate("section-first")(4, 9, 1, 3),
        true
    );
    assert.equal(
        createPageSelectorPredicate("section-first")(5, 9, 2, 3),
        false
    );
    assert.equal(
        createPageSelectorPredicate("section-not-first")(4, 9, 1, 3),
        false
    );
    assert.equal(
        createPageSelectorPredicate("section-not-first")(5, 9, 2, 3),
        true
    );
});
