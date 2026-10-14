import test from "node:test";
import assert from "node:assert/strict";
import { parseMarkdownForAssertions } from "../../lib/record-schema/assertions/MarkdownCorpusParser.mjs";

test("markdown parser exposes headings, sections, tables, code, links, and prose", () => {
    const parsed = parseMarkdownForAssertions(`# Title\n\nIntro with \`Token\` and [link](target.md).\n\n## Matrix\n\n| Name | Width |\n|---|---:|\n| Header | 8 |\n\n- one\n\n\`\`\`text\nbody\n\`\`\`\n`);
    assert.deepEqual(parsed.headings.map((heading) => heading.text), ["Title", "Matrix"]);
    assert.equal(parsed.sections.length, 2);
    assert.equal(parsed.tables.length, 1);
    assert.deepEqual(parsed.tables[0].rows[0].values, { Name: "Header", Width: "8" });
    assert.equal(parsed.code_blocks[0].language, "text");
    assert.equal(parsed.inline_code[0].text, "Token");
    assert.equal(parsed.links[0].target, "target.md");
    assert.equal(parsed.list_items[0].text, "one");
    assert.equal(parsed.blocks.some((block) => block.text === "- one"), true);
});
