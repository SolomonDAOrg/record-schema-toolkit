// @ts-check

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    globToRegExp,
    matchGlob,
    relPosix,
    toPosixPath
} from "../lib/index.mjs";

// ============================================================================
// Tests: toPosixPath
// ============================================================================

describe("toPosixPath", () => {
    it("converts backslashes to forward slashes", () => {
        assert.equal(toPosixPath("path\\to\\file"), "path/to/file");
    });

    it("handles multiple consecutive backslashes", () => {
        assert.equal(toPosixPath("path\\\\to\\\\file"), "path//to//file");
    });

    it("strips leading ./ prefix", () => {
        assert.equal(toPosixPath("./path/to/file"), "path/to/file");
    });

    it("strips multiple leading ./ prefixes", () => {
        assert.equal(toPosixPath("././path/to/file"), "path/to/file");
    });

    it("strips trailing slash", () => {
        assert.equal(toPosixPath("path/to/dir/"), "path/to/dir");
    });

    it("returns empty string unchanged", () => {
        assert.equal(toPosixPath(""), "");
    });

    it("handles already-posix paths", () => {
        assert.equal(toPosixPath("path/to/file"), "path/to/file");
    });

    it("handles single filename", () => {
        assert.equal(toPosixPath("file.txt"), "file.txt");
    });

    it("handles Windows-style absolute paths", () => {
        const result = toPosixPath("C:\\Users\\name\\file.txt");
        assert.equal(result, "C:/Users/name/file.txt");
    });

    it("handles mixed slashes", () => {
        assert.equal(toPosixPath("path\\to/mixed\\file"), "path/to/mixed/file");
    });

    it("handles path with only ./", () => {
        assert.equal(toPosixPath("./"), "");
    });

    it("preserves internal dots", () => {
        assert.equal(toPosixPath("path/./to/file"), "path/./to/file");
    });

    it("preserves parent directory references", () => {
        assert.equal(toPosixPath("../path/to/file"), "../path/to/file");
    });
});

// ============================================================================
// Tests: relPosix
// ============================================================================

describe("relPosix", () => {
    it("returns relative path from root", () => {
        const result = relPosix("/home/user", "/home/user/project/file.txt");
        assert.equal(result, "project/file.txt");
    });

    it("handles trailing slash on root", () => {
        const result = relPosix("/home/user/", "/home/user/project/file.txt");
        assert.equal(result, "project/file.txt");
    });

    it("returns full path when not under root", () => {
        const result = relPosix("/home/user", "/other/path/file.txt");
        // When path doesn't start with root, it returns the resolved absolute path
        assert.ok(result.includes("other/path/file.txt"));
    });

    it("handles same path as root", () => {
        const result = relPosix("/home/user", "/home/user");
        assert.equal(result, "");
    });

    it("handles nested directories", () => {
        const result = relPosix("/root", "/root/a/b/c/d/file.txt");
        assert.equal(result, "a/b/c/d/file.txt");
    });

    it("converts backslashes in result", () => {
        // The function normalizes to posix
        const result = relPosix("/home/user", "/home/user/path/to/file");
        assert.ok(!result.includes("\\"));
    });
});

// ============================================================================
// Tests: globToRegExp
// ============================================================================

describe("globToRegExp", () => {
    it("converts simple glob with single asterisk", () => {
        const re = globToRegExp("*.txt");
        assert.ok(re.test("file.txt"));
        assert.ok(re.test("document.txt"));
        assert.ok(!re.test("file.md"));
        assert.ok(!re.test("dir/file.txt"));
    });

    it("converts glob with question mark", () => {
        const re = globToRegExp("file?.txt");
        assert.ok(re.test("file1.txt"));
        assert.ok(re.test("fileA.txt"));
        assert.ok(!re.test("file.txt"));
        assert.ok(!re.test("file12.txt"));
    });

    it("converts glob with double asterisk", () => {
        const re = globToRegExp("**/*.txt");
        assert.ok(re.test("file.txt"));
        assert.ok(re.test("dir/file.txt"));
        assert.ok(re.test("a/b/c/file.txt"));
    });

    it("handles double asterisk at end", () => {
        const re = globToRegExp("src/**");
        assert.ok(re.test("src/file.txt"));
        assert.ok(re.test("src/dir/file.txt"));
        assert.ok(re.test("src/a/b/c"));
    });

    it("escapes regex special characters", () => {
        const re = globToRegExp("file.txt");
        assert.ok(re.test("file.txt"));
        assert.ok(!re.test("fileXtxt"));
    });

    it("escapes square brackets", () => {
        const re = globToRegExp("file[1].txt");
        assert.ok(re.test("file[1].txt"));
        assert.ok(!re.test("file1.txt"));
    });

    it("escapes parentheses", () => {
        const re = globToRegExp("file(1).txt");
        assert.ok(re.test("file(1).txt"));
    });

    it("escapes plus sign", () => {
        const re = globToRegExp("file+.txt");
        assert.ok(re.test("file+.txt"));
        assert.ok(!re.test("fileee.txt"));
    });

    it("escapes caret", () => {
        const re = globToRegExp("file^.txt");
        assert.ok(re.test("file^.txt"));
    });

    it("escapes dollar sign", () => {
        const re = globToRegExp("file$.txt");
        assert.ok(re.test("file$.txt"));
    });

    it("escapes pipe", () => {
        const re = globToRegExp("file|alt.txt");
        assert.ok(re.test("file|alt.txt"));
        assert.ok(!re.test("file.txt"));
        assert.ok(!re.test("alt.txt"));
    });

    it("escapes curly braces", () => {
        const re = globToRegExp("file{1}.txt");
        assert.ok(re.test("file{1}.txt"));
    });

    it("handles multiple wildcards", () => {
        const re = globToRegExp("*/*/*.txt");
        assert.ok(re.test("a/b/file.txt"));
        assert.ok(!re.test("file.txt"));
        assert.ok(!re.test("a/file.txt"));
        assert.ok(!re.test("a/b/c/file.txt"));
    });

    it("handles mixed wildcards", () => {
        const re = globToRegExp("src/**/test?.js");
        assert.ok(re.test("src/test1.js"));
        assert.ok(re.test("src/dir/testA.js"));
        assert.ok(re.test("src/a/b/testX.js"));
        assert.ok(!re.test("src/test.js"));
        assert.ok(!re.test("src/test12.js"));
    });

    it("converts backslashes before processing", () => {
        const re = globToRegExp("path\\to\\*.txt");
        assert.ok(re.test("path/to/file.txt"));
    });

    it("handles empty glob", () => {
        const re = globToRegExp("");
        assert.ok(re.test(""));
        assert.ok(!re.test("anything"));
    });

    it("handles glob with only asterisk", () => {
        const re = globToRegExp("*");
        assert.ok(re.test("anything"));
        assert.ok(re.test("file.txt"));
        assert.ok(!re.test("path/file"));
    });

    it("handles glob with only double asterisk", () => {
        const re = globToRegExp("**");
        assert.ok(re.test("anything"));
        assert.ok(re.test("path/to/file"));
    });
});

// ============================================================================
// Tests: matchGlob
// ============================================================================

describe("matchGlob", () => {
    it("matches simple extension pattern", () => {
        assert.equal(matchGlob("file.txt", "*.txt"), true);
        assert.equal(matchGlob("file.md", "*.txt"), false);
    });

    it("matches nested path with double asterisk", () => {
        assert.equal(matchGlob("src/components/Button.tsx", "**/*.tsx"), true);
        assert.equal(matchGlob("Button.tsx", "**/*.tsx"), true);
    });

    it("matches specific directory pattern", () => {
        assert.equal(matchGlob("src/index.js", "src/*.js"), true);
        assert.equal(matchGlob("lib/index.js", "src/*.js"), false);
    });

    it("matches with question mark wildcard", () => {
        assert.equal(matchGlob("v1.txt", "v?.txt"), true);
        assert.equal(matchGlob("v12.txt", "v?.txt"), false);
    });

    it("handles Windows-style paths", () => {
        assert.equal(matchGlob("path\\to\\file.txt", "**/*.txt"), true);
        assert.equal(matchGlob("path\\to\\file.txt", "path/to/*.txt"), true);
    });

    it("matches exact filename", () => {
        assert.equal(matchGlob("README.md", "README.md"), true);
        assert.equal(matchGlob("readme.md", "README.md"), false);
    });

    it("matches directory prefix", () => {
        assert.equal(
            matchGlob("node_modules/pkg/index.js", "node_modules/**"),
            true
        );
        assert.equal(matchGlob("src/index.js", "node_modules/**"), false);
    });

    it("handles complex patterns", () => {
        const pattern = "src/**/test/*.spec.ts";
        assert.equal(matchGlob("src/test/foo.spec.ts", pattern), true);
        assert.equal(
            matchGlob("src/components/test/bar.spec.ts", pattern),
            true
        );
        assert.equal(matchGlob("src/foo.spec.ts", pattern), false);
    });

    it("handles patterns with special characters in path", () => {
        assert.equal(matchGlob("file[1].txt", "file[1].txt"), true);
        assert.equal(matchGlob("file(test).txt", "file(test).txt"), true);
    });

    it("matches empty pattern against empty path", () => {
        assert.equal(matchGlob("", ""), true);
    });

    it("does not match empty path against non-empty pattern", () => {
        assert.equal(matchGlob("", "*.txt"), false);
    });
});

// ============================================================================
// Tests: Edge cases and integration
// ============================================================================

describe("general utilities edge cases", () => {
    it("toPosixPath handles unicode characters", () => {
        assert.equal(toPosixPath("path/тест/файл.txt"), "path/тест/файл.txt");
    });

    it("toPosixPath handles spaces in path", () => {
        assert.equal(toPosixPath("path/to/my file.txt"), "path/to/my file.txt");
    });

    it("globToRegExp anchors pattern to full string", () => {
        const re = globToRegExp("file.txt");
        assert.ok(!re.test("prefix_file.txt"));
        assert.ok(!re.test("file.txt_suffix"));
    });

    it("matchGlob is case-sensitive", () => {
        assert.equal(matchGlob("FILE.TXT", "*.txt"), false);
        assert.equal(matchGlob("FILE.TXT", "*.TXT"), true);
    });

    it("handles deeply nested paths", () => {
        const deepPath = "a/b/c/d/e/f/g/h/i/j/file.txt";
        assert.equal(matchGlob(deepPath, "**/*.txt"), true);
        assert.equal(matchGlob(deepPath, "a/**/file.txt"), true);
    });

    it("handles patterns with multiple extensions", () => {
        assert.equal(matchGlob("file.test.ts", "*.test.ts"), true);
        assert.equal(matchGlob("file.spec.ts", "*.test.ts"), false);
    });

    it("single asterisk does not cross directory boundaries", () => {
        const re = globToRegExp("src/*.js");
        assert.ok(re.test("src/index.js"));
        assert.ok(!re.test("src/lib/index.js"));
    });

    it("double asterisk crosses directory boundaries", () => {
        const re = globToRegExp("src/**/*.js");
        assert.ok(re.test("src/index.js"));
        assert.ok(re.test("src/lib/index.js"));
        assert.ok(re.test("src/a/b/c/index.js"));
    });
});
