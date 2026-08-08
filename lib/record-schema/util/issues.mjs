/**
 * Remove duplicate diagnostics while preserving first-seen order.
 *
 * @template {{ severity: string, code: string, message: string, file?: string, line?: number }} Issue
 * @param {Issue[]} issues
 * @returns {Issue[]}
 */
export function deduplicateIssues(issues) {
    const seen = new Set();
    /** @type {Issue[]} */
    const result = [];

    for (let i = 0, len = issues.length; i < len; i++) {
        const issue = issues[i];
        const key = `${issue.severity}\u0000${issue.code}\u0000${
            issue.file || ""
        }\u0000${issue.line || ""}\u0000${issue.message}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(issue);
    }

    return result;
}
