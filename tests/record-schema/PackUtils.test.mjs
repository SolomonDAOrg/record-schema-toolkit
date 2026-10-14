// @ts-check

/**
 * Unit tests for PackUtils.
 *
 * Covers: matchGlob, rulesetMatchesFile, shouldIncludeEntry,
 * getEntryPath, getEntryPrecedence, collectCamelCaseKeys, assertNoCamelCaseKeys.
 *
 * @module tests/classes/PackUtils_test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    shouldIncludeEntry,
    assertNoCamelCaseKeys,
    collectCamelCaseKeys,
    matchGlob,
    rulesetMatchesFile,
    getEntryPath,
    getEntryPrecedence
} from "../../lib/record-schema/PackUtils.mjs";

// ============================================================================
// matchGlob
// ============================================================================

describe("matchGlob", () => {
    it("matches exact path", () => {
        assert.equal(matchGlob("README.md", "README.md"), true);
    });

    it("does not match different path", () => {
        assert.equal(matchGlob("LICENSE", "README.md"), false);
    });

    it("* matches any segment (not across /)", () => {
        assert.equal(matchGlob("docs/file.md", "docs/*.md"), true);
        assert.equal(matchGlob("docs/sub/file.md", "docs/*.md"), false);
    });

    it("** matches across path segments", () => {
        assert.equal(matchGlob("docs/sub/file.md", "docs/**/*.md"), true);
        assert.equal(matchGlob("docs/a/b/file.md", "docs/**/*.md"), true);
        assert.equal(matchGlob("other/sub/file.md", "docs/**/*.md"), false);
    });

    it("? matches any single character", () => {
        assert.equal(matchGlob("file1.md", "file?.md"), true);
        assert.equal(matchGlob("fileAB.md", "file?.md"), false);
    });

    it("escapes regex special chars in glob literal", () => {
        assert.equal(matchGlob("file.md", "file.md"), true);
        // the '.' in glob is literal, not regex wildcard
        assert.equal(matchGlob("fileXmd", "file.md"), false);
    });

    it("matches root-level file with bare glob", () => {
        assert.equal(matchGlob("LICENSE", "LICENSE"), true);
    });

    it("** at start matches any prefix with subdirectory", () => {
        assert.equal(matchGlob("a/b/c/file.yaml", "**/*.yaml"), true);
        assert.equal(matchGlob("docs/file.yaml", "**/*.yaml"), true);
        // bare file (no slash) does NOT match **/*.yaml in this implementation
        assert.equal(matchGlob("file.yaml", "**/*.yaml"), false);
    });
});

// ============================================================================
// rulesetMatchesFile
// ============================================================================

describe("rulesetMatchesFile", () => {
    /**
     * @param {Partial<{ rel_path: string, doc_type: string|null, ext: string|null, is_root_file: boolean }>} overrides
     */
    function makeFile(overrides = {}) {
        return {
            rel_path: "docs/file.md",
            doc_type: "CHA",
            ext: "md",
            is_root_file: false,
            ...overrides
        };
    }

    it("matches when no selectors specified (empty ruleset)", () => {
        assert.equal(rulesetMatchesFile({}, makeFile()), true);
    });

    it("matches when selectors object is empty", () => {
        assert.equal(rulesetMatchesFile({ selectors: {} }, makeFile()), true);
    });

    it("is_root_file: true matches root files only", () => {
        const ruleset = { selectors: { is_root_file: true } };
        assert.equal(
            rulesetMatchesFile(ruleset, makeFile({ is_root_file: true })),
            true
        );
        assert.equal(
            rulesetMatchesFile(ruleset, makeFile({ is_root_file: false })),
            false
        );
    });

    it("extensions selector matches file ext (case-insensitive)", () => {
        const ruleset = { selectors: { extensions: ["MD", "yaml"] } };
        assert.equal(
            rulesetMatchesFile(ruleset, makeFile({ ext: "md" })),
            true
        );
        assert.equal(
            rulesetMatchesFile(ruleset, makeFile({ ext: "yaml" })),
            true
        );
        assert.equal(
            rulesetMatchesFile(ruleset, makeFile({ ext: "pdf" })),
            false
        );
    });

    it("extensions selector rejects file with null ext", () => {
        const ruleset = { selectors: { extensions: ["md"] } };
        assert.equal(
            rulesetMatchesFile(ruleset, makeFile({ ext: null })),
            false
        );
    });

    it("doc_types selector matches file doc_type exactly", () => {
        const ruleset = { selectors: { doc_types: ["CHA", "SOP"] } };
        assert.equal(
            rulesetMatchesFile(ruleset, makeFile({ doc_type: "CHA" })),
            true
        );
        assert.equal(
            rulesetMatchesFile(ruleset, makeFile({ doc_type: "SOP" })),
            true
        );
        assert.equal(
            rulesetMatchesFile(ruleset, makeFile({ doc_type: "PROP" })),
            false
        );
    });

    it("doc_types selector rejects file with null doc_type", () => {
        const ruleset = { selectors: { doc_types: ["CHA"] } };
        assert.equal(
            rulesetMatchesFile(ruleset, makeFile({ doc_type: null })),
            false
        );
    });

    it("paths_glob selector matches via glob", () => {
        const ruleset = { selectors: { paths_glob: ["docs/**/*.md"] } };
        assert.equal(
            rulesetMatchesFile(
                ruleset,
                makeFile({ rel_path: "docs/sub/file.md" })
            ),
            true
        );
        assert.equal(
            rulesetMatchesFile(
                ruleset,
                makeFile({ rel_path: "other/file.md" })
            ),
            false
        );
    });

    it("all selectors must match (AND logic)", () => {
        const ruleset = {
            selectors: {
                extensions: ["md"],
                doc_types: ["CHA"]
            }
        };
        // both match
        assert.equal(
            rulesetMatchesFile(
                ruleset,
                makeFile({ ext: "md", doc_type: "CHA" })
            ),
            true
        );
        // ext matches, doc_type doesn't
        assert.equal(
            rulesetMatchesFile(
                ruleset,
                makeFile({ ext: "md", doc_type: "SOP" })
            ),
            false
        );
        // doc_type matches, ext doesn't
        assert.equal(
            rulesetMatchesFile(
                ruleset,
                makeFile({ ext: "yaml", doc_type: "CHA" })
            ),
            false
        );
    });

    it("paths_glob with multiple patterns uses OR within the list", () => {
        const ruleset = {
            selectors: {
                paths_glob: ["docs/*.md", "records/*.yaml"]
            }
        };
        assert.equal(
            rulesetMatchesFile(ruleset, makeFile({ rel_path: "docs/file.md" })),
            true
        );
        assert.equal(
            rulesetMatchesFile(
                ruleset,
                makeFile({ rel_path: "records/reg.yaml" })
            ),
            true
        );
        assert.equal(
            rulesetMatchesFile(
                ruleset,
                makeFile({ rel_path: "other/file.txt" })
            ),
            false
        );
    });
});

// ============================================================================
// shouldIncludeEntry
// ============================================================================

describe("shouldIncludeEntry", () => {
    it("returns true for plain string entry", () => {
        assert.equal(shouldIncludeEntry("path/to/file.md"), true);
    });

    it("returns true for object entry without include field", () => {
        assert.equal(shouldIncludeEntry({ path: "file.md" }), true);
    });

    it("returns true for object entry with include: true", () => {
        assert.equal(
            shouldIncludeEntry({ path: "file.md", include: true }),
            true
        );
    });

    it("returns false for object entry with include: false", () => {
        assert.equal(
            shouldIncludeEntry({ path: "file.md", include: false }),
            false
        );
    });

    it("returns false for null", () => {
        assert.equal(shouldIncludeEntry(null), false);
    });

    it("returns false for undefined", () => {
        assert.equal(shouldIncludeEntry(undefined), false);
    });

    it("returns false for number", () => {
        assert.equal(shouldIncludeEntry(42), false);
    });

    it("returns false for boolean", () => {
        assert.equal(shouldIncludeEntry(true), false);
    });
});

// ============================================================================
// getEntryPath
// ============================================================================

describe("getEntryPath", () => {
    it("returns string entry directly", () => {
        assert.equal(getEntryPath("docs/file.md"), "docs/file.md");
    });

    it("returns path from object entry", () => {
        assert.equal(
            getEntryPath({ path: "records/file.yaml" }),
            "records/file.yaml"
        );
    });

    it("returns null for object without path key", () => {
        assert.equal(getEntryPath({ other: "value" }), null);
    });

    it("returns null for object with non-string path", () => {
        assert.equal(getEntryPath({ path: 42 }), null);
    });

    it("returns null for null", () => {
        assert.equal(getEntryPath(null), null);
    });

    it("returns null for undefined", () => {
        assert.equal(getEntryPath(undefined), null);
    });

    it("returns null for number", () => {
        assert.equal(getEntryPath(42), null);
    });
});

// ============================================================================
// getEntryPrecedence
// ============================================================================

describe("getEntryPrecedence", () => {
    it("returns object.precedence when it is a number", () => {
        assert.equal(getEntryPrecedence({ precedence: 5 }, 0), 5);
    });

    it("returns index * 10 for string entry", () => {
        assert.equal(getEntryPrecedence("file.md", 3), 30);
    });

    it("returns index * 10 when object has no precedence", () => {
        assert.equal(getEntryPrecedence({ path: "file.md" }, 2), 20);
    });

    it("returns index * 10 when object precedence is non-number", () => {
        assert.equal(getEntryPrecedence({ precedence: "high" }, 1), 10);
    });

    it("returns index * 10 for null entry", () => {
        assert.equal(getEntryPrecedence(null, 4), 40);
    });

    it("returns 0 for object with precedence: 0 at index 5", () => {
        assert.equal(getEntryPrecedence({ precedence: 0 }, 5), 0);
    });
});

// ============================================================================
// collectCamelCaseKeys
// ============================================================================

describe("collectCamelCaseKeys", () => {
    it("returns empty array for plain object with snake_case keys", () => {
        const result = collectCamelCaseKeys({ snake_case: 1, another_key: 2 });
        assert.deepEqual(result, []);
    });

    it("detects camelCase key at top level", () => {
        const result = collectCamelCaseKeys({ camelCase: 1 });
        assert.equal(result.length, 1);
        assert.equal(result[0].key, "camelCase");
        assert.equal(result[0].path, "camelCase");
    });

    it("detects multiple camelCase keys", () => {
        const result = collectCamelCaseKeys({
            myKey: 1,
            anotherKey: 2,
            good_key: 3
        });
        assert.equal(result.length, 2);
        const keys = result.map((r) => r.key);
        assert.ok(keys.includes("myKey"));
        assert.ok(keys.includes("anotherKey"));
    });

    it("detects nested camelCase key with correct path", () => {
        const result = collectCamelCaseKeys({ outer: { innerCamel: true } });
        assert.equal(result.length, 1);
        assert.equal(result[0].key, "innerCamel");
        assert.equal(result[0].path, "outer.innerCamel");
    });

    it("traverses arrays and reports camelCase keys inside", () => {
        const result = collectCamelCaseKeys({
            items: [{ goodKey: "yes" }, { snake_key: "no" }]
        });
        assert.equal(result.length, 1);
        assert.ok(result[0].path.includes("[0]"));
        assert.equal(result[0].key, "goodKey");
    });

    it("does NOT flag locale-style keys like en-US", () => {
        const result = collectCamelCaseKeys({ "en-US": "English" });
        assert.deepEqual(result, []);
    });

    it("does NOT flag all-uppercase keys", () => {
        const result = collectCamelCaseKeys({ ID: "value", URL: "http://x" });
        assert.deepEqual(result, []);
    });

    it("does NOT flag all-lowercase keys", () => {
        const result = collectCamelCaseKeys({ name: "value", type: "string" });
        assert.deepEqual(result, []);
    });

    it("reports path from basePath parameter", () => {
        const result = collectCamelCaseKeys({ badKey: 1 }, "root");
        assert.equal(result[0].path, "root.badKey");
    });

    it("handles empty object", () => {
        assert.deepEqual(collectCamelCaseKeys({}), []);
    });

    it("handles non-object value", () => {
        assert.deepEqual(collectCamelCaseKeys("string"), []);
        assert.deepEqual(collectCamelCaseKeys(null), []);
        assert.deepEqual(collectCamelCaseKeys(42), []);
    });

    it("detects deeply nested camelCase key", () => {
        const result = collectCamelCaseKeys({
            a: { b: { c: { deepNested: true } } }
        });
        assert.equal(result.length, 1);
        assert.equal(result[0].path, "a.b.c.deepNested");
    });
});

// ============================================================================
// assertNoCamelCaseKeys
// ============================================================================

describe("assertNoCamelCaseKeys", () => {
    it("does not throw for snake_case only object", () => {
        assert.doesNotThrow(() =>
            assertNoCamelCaseKeys(
                { snake_case: 1, another_key: { nested_key: true } },
                "test"
            )
        );
    });

    it("throws for object with camelCase key", () => {
        assert.throws(
            () => assertNoCamelCaseKeys({ camelKey: 1 }, "myPack"),
            /camelCase/
        );
    });

    it("includes the source label in error message", () => {
        let msg = "";
        try {
            assertNoCamelCaseKeys({ badKey: 1 }, "mySource");
        } catch (err) {
            msg = /** @type {Error} */ (err).message;
        }
        assert.ok(msg.includes("mySource"));
    });

    it("includes the offending key path in error message", () => {
        let msg = "";
        try {
            assertNoCamelCaseKeys({ camelCase: 1 }, "src");
        } catch (err) {
            msg = /** @type {Error} */ (err).message;
        }
        assert.ok(msg.includes("camelCase"));
    });

    it("mentions underscore_case convention in error", () => {
        let msg = "";
        try {
            assertNoCamelCaseKeys({ myKey: 1 }, "src");
        } catch (err) {
            msg = /** @type {Error} */ (err).message;
        }
        assert.ok(msg.includes("underscore_case"));
    });

    it("throws for nested camelCase key", () => {
        assert.throws(
            () => assertNoCamelCaseKeys({ outer: { innerBad: true } }, "deep"),
            /camelCase/
        );
    });

    it("does not throw for empty object", () => {
        assert.doesNotThrow(() => assertNoCamelCaseKeys({}, "empty"));
    });

    it("reports +N more when violations exceed 10", () => {
        /** @type {Record<string, number>} */
        const obj = {};
        for (let i = 0; i < 15; i++) {
            obj[`camelKey${i}`] = i;
        }
        let msg = "";
        try {
            assertNoCamelCaseKeys(obj, "src");
        } catch (err) {
            msg = /** @type {Error} */ (err).message;
        }
        assert.ok(msg.includes("+5 more"));
    });

    it("does not throw for null (no keys to check)", () => {
        assert.doesNotThrow(() => assertNoCamelCaseKeys(null, "src"));
    });
});
