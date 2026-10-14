import test from "node:test";
import assert from "node:assert/strict";
import { lexEmbeddedLanguage } from "../../lib/record-schema/assertions/EmbeddedLanguage.mjs";

test("embedded lexer classifies references, functions, and members", () => {
    const result = lexEmbeddedLanguage("choose(Account.owner, Limit + 1)", {
        keywords: ["true", "false"]
    });
    assert.deepEqual(
        result.tokens.filter((token) => token.kind === "identifier").map((token) => [token.text, token.role]),
        [
            ["choose", "function"],
            ["Account", "reference"],
            ["owner", "member"],
            ["Limit", "reference"]
        ]
    );
    assert.deepEqual(result.errors, []);
});

test("embedded lexer reports balance and token adjacency defects", () => {
    const result = lexEmbeddedLanguage("Alpha Beta(");
    assert.ok(result.errors.some((error) => error.message.includes("adjacent")));
    assert.ok(result.errors.some((error) => error.message.includes("unclosed")));
});
