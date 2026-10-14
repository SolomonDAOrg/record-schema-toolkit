import assert from "node:assert/strict";
import test from "node:test";

import { parseInlineContent, parseMarkdownDoc } from "../lib/parsing/markdown.mjs";

function flattenInlineText(nodes) {
    let result = "";
    for (let i = 0, len = nodes.length; i < len; i++) {
        const node = nodes[i];
        if (node.children.length > 0) {
            result += flattenInlineText(node.children);
        } else {
            result += node.content;
        }
    }
    return result;
}

test("escaped Markdown metacharacters preserve exact evidence values", () => {
    const statusNodes = parseInlineContent(String.raw`FINALIZED\_AND\_READ\_BACK`);
    assert.equal(flattenInlineText(statusNodes), "FINALIZED_AND_READ_BACK");
    assert.equal(statusNodes.some((node) => node.type === "italic"), false);

    const pathNodes = parseInlineContent(String.raw`$.deployment\_transaction\_signature`);
    assert.equal(flattenInlineText(pathNodes), "$.deployment_transaction_signature");
    assert.equal(pathNodes.some((node) => node.type === "italic"), false);

    const literalNodes = parseInlineContent(String.raw`a\*b\_c\`d\|e\\f\[g\]\(h\)`);
    assert.equal(flattenInlineText(literalNodes), "a*b_c`d|e\\f[g](h)");
});


test("pipe tables preserve inline escapes outside escaped delimiters", () => {
    const parsed = parseMarkdownDoc(String.raw`| Status | JSON path | Literal |
|---|---|---|
| FINALIZED\_AND\_READ\_BACK | $.deployment\_transaction\_signature | left\|right |`);
    const table = parsed.nodes.find((node) => node.type === "table");
    assert.notEqual(table, undefined);
    const dataRow = table.children[1];
    assert.equal(flattenInlineText(dataRow.children[0].children), "FINALIZED_AND_READ_BACK");
    assert.equal(flattenInlineText(dataRow.children[1].children), "$.deployment_transaction_signature");
    assert.equal(flattenInlineText(dataRow.children[2].children), "left|right");
    assert.equal(dataRow.children[0].children.some((node) => node.type === "italic"), false);
});
