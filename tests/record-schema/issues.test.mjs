import assert from "node:assert/strict";
import test from "node:test";

import { deduplicateIssues } from "../../lib/record-schema/util/issues.mjs";

test("deduplicateIssues removes exact duplicates and preserves order", () => {
    const first = {
        severity: "error",
        code: "schema.invalid",
        message: "Invalid value",
        file: "record.yaml",
        line: 4
    };
    const second = {
        severity: "warn",
        code: "schema.deprecated",
        message: "Deprecated value",
        file: "record.yaml"
    };
    const result = deduplicateIssues([
        first,
        { ...first },
        second,
        { ...second }
    ]);

    assert.deepEqual(result, [first, second]);
});

test("deduplicateIssues retains diagnostics that differ materially", () => {
    const issues = [
        {
            severity: "error",
            code: "schema.invalid",
            message: "Invalid value",
            file: "one.yaml",
            line: 1
        },
        {
            severity: "error",
            code: "schema.invalid",
            message: "Invalid value",
            file: "one.yaml",
            line: 2
        },
        {
            severity: "error",
            code: "schema.invalid",
            message: "Different value",
            file: "one.yaml",
            line: 1
        }
    ];

    assert.deepEqual(deduplicateIssues(issues), issues);
});
