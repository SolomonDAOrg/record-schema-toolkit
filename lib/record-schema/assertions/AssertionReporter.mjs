/**
 * Compatibility exports for declarative assertion reports.
 *
 * The implementation lives in AssertionReport.mjs. Keeping these aliases
 * avoids two report evaluators drifting while preserving the original public
 * names used by early callers.
 */

import { generateAssertionReport } from "./AssertionReport.mjs";

export { generateAssertionReport };

/**
 * @param {string} rootDirectory
 * @param {{ packs: string[], report: string, verbose?: boolean }} options
 * @returns {import("./AssertionReport.mjs").AssertionReportResult}
 */
export function runAssertionReport(rootDirectory, options) {
    return generateAssertionReport(rootDirectory, options);
}

/**
 * @param {import("./AssertionReport.mjs").AssertionReportResult} result
 * @returns {string}
 */
export function renderAssertionReport(result) {
    return result.text;
}
