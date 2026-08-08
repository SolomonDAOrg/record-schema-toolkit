/**
 * The assertion runner.
 *
 * One entry point that takes a repository root and a list of pack paths, and
 * returns findings. `validate` calls it, `assert` calls it, and a consumer
 * embedding the toolkit calls it; none of the three has to know how packs
 * merge or how the corpus is indexed.
 *
 * @module record-schema/assertions/AssertionRunner
 */

import { AssertionPack } from "./AssertionPack.mjs";
import { AssertionEngine } from "./AssertionEngine.mjs";
import { CorpusIndex } from "./CorpusIndex.mjs";
import { isPlainObject } from "./Path.mjs";

/** @typedef {import("./types/general.mjs").AssertionFinding} AssertionFinding */

/**
 * @typedef {object} AssertionRunOptions
 * @property {string[]} [packs] repository-relative pack paths
 * @property {string[]} [only] run only these rule ids
 * @property {string[]} [skip] skip these rule ids
 * @property {Record<string, string>} [severityOverrides]
 * @property {boolean} [promoteAdvisory] treat advisory findings as errors
 * @property {string} [mode] named execution mode, default development
 */

/**
 * @typedef {object} AssertionRunResult
 * @property {AssertionFinding[]} findings
 * @property {string[]} packs
 * @property {string[]} executed
 * @property {string[]} skipped
 * @property {string[]} loadErrors
 * @property {number} unitCount
 * @property {Record<string, number>} selectionCounts
 * @property {Record<string, number>} scopeCounts
 * @property {Record<string, { left: number, right: number, joined: number }>} joinCounts
 * @property {Record<string, { uses: number, defines: number }>} resolveCounts
 */

/**
 * Run assertion packs over a repository.
 *
 * @param {string} rootDirectory
 * @param {AssertionRunOptions} [options]
 * @returns {AssertionRunResult}
 */
export function runAssertions(rootDirectory, options = {}) {
    const packPaths = options.packs ?? [];

    if (packPaths.length === 0) {
        return {
            findings: [],
            packs: [],
            executed: [],
            skipped: [],
            loadErrors: [],
            unitCount: 0,
            selectionCounts: {},
            scopeCounts: {},
            joinCounts: {},
            resolveCounts: {}
        };
    }

    const { pack, errors } = AssertionPack.load(rootDirectory, packPaths);

    if (errors.length > 0) {
        return {
            findings: errors.map((message) => ({
                severity: "error",
                code: "PACK",
                rule: "PACK",
                file: null,
                path: null,
                message
            })),
            packs: pack.getPackIds(),
            executed: [],
            skipped: [],
            loadErrors: errors,
            unitCount: 0,
            selectionCounts: {},
            scopeCounts: {},
            joinCounts: {},
            resolveCounts: {}
        };
    }

    const index = new CorpusIndex(rootDirectory);
    const engine = new AssertionEngine(index, pack.resolved, {
        only: options.only,
        skip: options.skip,
        severityOverrides: options.severityOverrides,
        mode: options.mode
    });

    const outcome = engine.run();
    const findings =
        options.promoteAdvisory === true
            ? outcome.findings.map((finding) =>
                  finding.severity === "advisory"
                      ? Object.assign({}, finding, { severity: "error" })
                      : finding
              )
            : outcome.findings;

    findings.sort(compareFindings);

    return {
        findings,
        packs: pack.getPackIds(),
        executed: outcome.executed,
        skipped: outcome.skipped,
        loadErrors: [],
        unitCount: index.listFiles().length,
        selectionCounts: Object.fromEntries(outcome.selectionCounts),
        scopeCounts: Object.fromEntries(outcome.scopeCounts),
        joinCounts: Object.fromEntries(outcome.joinCounts),
        resolveCounts: Object.fromEntries(outcome.resolveCounts)
    };
}

/**
 * Read the assertion pack paths a profile declares.
 *
 * @param {unknown} profileData
 * @returns {string[]}
 */
export function assertionPacksFromProfile(profileData) {
    if (!isPlainObject(profileData)) {
        return [];
    }

    const rules = /** @type {Record<string, unknown>} */ (profileData).rules;
    if (!isPlainObject(rules)) {
        return [];
    }

    const declared = /** @type {Record<string, unknown>} */ (rules)
        .assertion_packs;

    if (typeof declared === "string") {
        return [declared];
    }
    if (!Array.isArray(declared)) {
        return [];
    }
    return declared.map(String);
}

/**
 * @param {AssertionFinding} left
 * @param {AssertionFinding} right
 * @returns {number}
 */
function compareFindings(left, right) {
    const rank = { error: 0, warning: 1, advisory: 2 };
    const leftRank = rank[/** @type {"error"} */ (left.severity)] ?? 3;
    const rightRank = rank[/** @type {"error"} */ (right.severity)] ?? 3;

    if (leftRank !== rightRank) {
        return leftRank - rightRank;
    }
    if (left.code !== right.code) {
        return left.code < right.code ? -1 : 1;
    }
    const leftFile = left.file ?? "";
    const rightFile = right.file ?? "";
    if (leftFile !== rightFile) {
        return leftFile < rightFile ? -1 : 1;
    }
    const leftPath = left.path ?? "";
    const rightPath = right.path ?? "";
    if (leftPath !== rightPath) {
        return leftPath < rightPath ? -1 : 1;
    }
    return left.message < right.message ? -1 : 1;
}
