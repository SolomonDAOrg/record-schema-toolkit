import assert from "node:assert/strict";
import {
    reflowMarkdown,
    isLegalSubItemStart,
    isListItem
} from "../../lib/parsing/markdown.mjs";
import { describe, it } from "node:test";

// =============================================================================
// isLegalSubItemStart
// =============================================================================

describe("isLegalSubItemStart", () => {
    it("matches (a) style", () =>
        assert.ok(isLegalSubItemStart("(a) some text")));
    it("matches (b) style", () => assert.ok(isLegalSubItemStart("(b) text")));
    it("matches (i) roman lower", () =>
        assert.ok(isLegalSubItemStart("(i) text")));
    it("matches (IV) roman upper", () =>
        assert.ok(isLegalSubItemStart("(IV) text")));
    it("matches (1) numeric", () => assert.ok(isLegalSubItemStart("(1) text")));
    it("matches a. style", () => assert.ok(isLegalSubItemStart("a. text")));
    it("matches A. style", () => assert.ok(isLegalSubItemStart("A. text")));
    it("matches a) style", () => assert.ok(isLegalSubItemStart("a) text")));
    it("does not match plain paragraph", () =>
        assert.ok(!isLegalSubItemStart("some paragraph text")));
    it("does not match heading-like", () =>
        assert.ok(!isLegalSubItemStart("## heading")));
});

// =============================================================================
// reflowMarkdown - legal sub-items
// =============================================================================

describe("reflowMarkdown - legal sub-items preserved as-is", () => {
    it("preserves (a)/(b) lines without indent", () => {
        const input = [
            "(a) do not contain prohibited statements;",
            "(b) do not attribute operations to the IP Owner;",
            "(c) do not identify Operator; and",
            "(d) include the required legend."
        ].join("\n");
        const { text, changed } = reflowMarkdown(input, 80);
        assert.equal(text, input);
        assert.equal(changed, false);
    });

    it("preserves (a)/(b) lines with leading indent", () => {
        const input = [
            "   (a) do not contain prohibited statements;",
            "   (b) do not attribute operations to the IP Owner;",
            "   (c) do not identify Operator; and"
        ].join("\n");
        const { text, changed } = reflowMarkdown(input, 80);
        assert.equal(text, input);
        assert.equal(changed, false);
    });

    it("does not merge (a)/(b) lines into preceding paragraph", () => {
        const input = [
            "The Operator warrants that all materials:",
            "   (a) do not contain prohibited statements;",
            "   (b) do not attribute operations to the IP Owner;"
        ].join("\n");
        const { text } = reflowMarkdown(input, 120);
        const lines = text.split("\n");
        assert.ok(
            lines.some((l) => l.includes("(a)")),
            "lost (a) line"
        );
        assert.ok(
            lines.some((l) => l.includes("(b)")),
            "lost (b) line"
        );
        // (a) must NOT appear on the same line as the preceding paragraph
        const paraLine = lines.find((l) => l.includes("The Operator warrants"));
        assert.ok(paraLine !== undefined);
        assert.ok(
            !paraLine.includes("(a)"),
            `(a) was merged into paragraph: ${paraLine}`
        );
    });

    it("does not merge indented (a)/(b) into a list item continuation", () => {
        // A list item followed by indented legal sub-items
        const input = [
            "- The Operator represents and warrants that all Operator Materials:",
            "   (a) do not contain prohibited statements in Section 2;",
            "   (b) do not attribute Operator operations to the IP Owner; and",
            "   (c) do not identify Operator or imply any user is a counterparty."
        ].join("\n");
        const { text } = reflowMarkdown(input, 80);
        const lines = text.split("\n");
        assert.ok(
            lines.some((l) => l.includes("(a)")),
            "lost (a) line"
        );
        assert.ok(
            lines.some((l) => l.includes("(b)")),
            "lost (b) line"
        );
        assert.ok(
            lines.some((l) => l.includes("(c)")),
            "lost (c) line"
        );
        // Crucially: none of the sub-items should appear on the same line as
        // the list item opener
        const listLine = lines.find((l) =>
            l.includes("The Operator represents")
        );
        assert.ok(listLine !== undefined);
        assert.ok(
            !listLine.includes("(a)"),
            `(a) was merged into list item: ${listLine}`
        );
    });

    it("preserves leading indent on (a)/(b) lines", () => {
        const input = [
            "Condition:",
            "   (a) first condition here;",
            "   (b) second condition here."
        ].join("\n");
        const { text } = reflowMarkdown(input, 80);
        const lines = text.split("\n");
        const aLine = lines.find((l) => l.includes("(a)"));
        assert.ok(aLine !== undefined);
        assert.ok(
            aLine.startsWith("   "),
            `expected leading indent, got: "${aLine}"`
        );
    });
});

// =============================================================================
// reflowMarkdown - normal paragraph reflow still works
// =============================================================================

describe("reflowMarkdown - paragraph reflow", () => {
    it("wraps long paragraph lines", () => {
        const input =
            "This is a very long paragraph line that definitely exceeds eighty characters and should be wrapped.";
        const { text, changed } = reflowMarkdown(input, 80);
        assert.ok(changed);
        const lines = text.split("\n");
        for (const l of lines) {
            assert.ok(l.length <= 80, `line too long: "${l}"`);
        }
    });

    it("joins short lines in the same paragraph", () => {
        const input = [
            "Short line one.",
            "Short line two.",
            "Short line three."
        ].join("\n");
        const { text } = reflowMarkdown(input, 120);
        assert.ok(
            !text.includes("\nShort line two"),
            "lines should have been joined"
        );
    });

    it("does not join across blank lines", () => {
        const input = ["Paragraph one.", "", "Paragraph two."].join("\n");
        const { text } = reflowMarkdown(input, 120);
        assert.ok(
            text.includes("\n\n"),
            "blank line separator must be preserved"
        );
    });

    it("preserves code fence content unchanged", () => {
        const input = [
            "```js",
            "const x = 1;  // long line that would exceed max width for sure right here",
            "```"
        ].join("\n");
        const { text, changed } = reflowMarkdown(input, 40);
        assert.equal(text, input);
        assert.equal(changed, false);
    });

    it("preserves headings unchanged", () => {
        const input =
            "## 12.1 This Is A Heading That Is Quite Long But Should Not Be Reflowed At All";
        const { text, changed } = reflowMarkdown(input, 40);
        assert.equal(text, input);
        assert.equal(changed, false);
    });
});

// =============================================================================
// reflowMarkdown - list items
// =============================================================================

describe("reflowMarkdown - list items", () => {
    it("wraps long list item content", () => {
        const input =
            "- This is a list item with very long content that exceeds the max width and needs wrapping here.";
        const { text, changed } = reflowMarkdown(input, 60);
        assert.ok(changed);
        const lines = text.split("\n");
        assert.ok(lines[0].startsWith("- "));
        for (const l of lines) {
            assert.ok(l.length <= 60, `line too long: "${l}"`);
        }
    });

    it("preserves short list items", () => {
        const input = ["- item one", "- item two", "- item three"].join("\n");
        const { text, changed } = reflowMarkdown(input, 80);
        assert.equal(text, input);
        assert.equal(changed, false);
    });

    it("does not merge separate list items", () => {
        const input = ["- first item", "- second item"].join("\n");
        const { text } = reflowMarkdown(input, 120);
        const lines = text.split("\n");
        assert.equal(lines.filter((l) => l.startsWith("- ")).length, 2);
    });
});
