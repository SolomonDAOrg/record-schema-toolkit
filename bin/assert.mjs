#!/usr/bin/env node

/**
 * Run corpus assertion packs over a repository.
 *
 * Structural validation - naming, META, per-document schemas - is `validate`.
 * This is the cross-document layer: the checks that hold between two
 * declarations rather than inside one. A repository declares which packs apply
 * in its profile, so the usual invocation names no packs at all.
 */

import { resolve } from "node:path";
import { CLI } from "../lib/cli/cli.mjs";
import { Repository } from "../lib/record-schema/Repository.mjs";
import { AssertionPack } from "../lib/record-schema/assertions/AssertionPack.mjs";
import {
    runAssertions,
    assertionPacksFromProfile
} from "../lib/record-schema/assertions/AssertionRunner.mjs";

const SCRIPT_NAME = "assert";
const DESCRIPTION =
    "Run corpus assertion packs: cross-document agreement, closure, and reachability";

const schema = {
    flags: {
        json: { description: "Machine-readable JSON output", default: false },
        "fail-on-warn": {
            description: "Exit non-zero on warnings",
            default: true
        },
        advisory: {
            description: "Promote advisory findings to errors",
            default: false
        },
        list: {
            description: "List the rules that would run, then exit",
            default: false
        },
        summary: {
            description: "Print a per-rule finding count",
            default: false
        },
        stats: {
            description:
                "Print rows selected per rule; a rule selecting nothing reports clean because it found nothing",
            default: false
        },
        "fail-on-vacuous": {
            description: "Exit non-zero when any rule selected no rows",
            default: false
        },
        production: {
            description: "Alias for --mode production",
            default: false
        }
    },
    values: {
        root: {
            aliases: ["r"],
            description: "Repository root",
            default: ".",
            type: "string"
        },
        profile: {
            aliases: ["p"],
            description: "Registry profile YAML path (repo-relative)",
            default: null,
            type: "string"
        },
        packs: {
            aliases: ["pack", "assertions"],
            description:
                "Assertion pack paths (comma-separated); defaults to the profile's declared packs",
            default: [],
            type: "array"
        },
        only: {
            description: "Run only these rule ids (comma-separated)",
            default: [],
            type: "array"
        },
        skip: {
            description: "Skip these rule ids (comma-separated)",
            default: [],
            type: "array"
        },
        mode: {
            description: "Named assertion mode",
            default: "development",
            type: "string"
        }
    }
};

const options = CLI.handleCLI({
    scriptName: SCRIPT_NAME,
    description: DESCRIPTION,
    schema
});

const root_dir = resolve(process.cwd(), options.root);

function resolvePackPaths() {
    if (options.packs.length > 0) {
        return options.packs;
    }

    const repo = Repository.fromFolder(root_dir, {});
    if (options.profile !== null) {
        repo.loadProfile(options.profile);
    }

    const profile = repo.getProfile();
    if (profile === null || profile === undefined) {
        return [];
    }

    return assertionPacksFromProfile(profile.data);
}

function run() {
    const packs = resolvePackPaths();

    if (packs.length === 0) {
        console.error(
            "No assertion packs declared. Add `rules.assertion_packs` to the profile, or pass --packs."
        );
        process.exit(2);
    }

    const mode = options.production ? "production" : options.mode;

    if (options.list) {
        const loaded = AssertionPack.load(root_dir, packs);
        if (loaded.errors.length > 0) {
            for (let i = 0, len = loaded.errors.length; i < len; i++) {
                console.error(loaded.errors[i]);
            }
            process.exit(2);
        }
        const allRules = loaded.pack.getRules();
        const rules = [];
        const skipped = [];
        for (let i = 0, len = allRules.length; i < len; i++) {
            const rule = allRules[i];
            const declaredModes = rule.modes === undefined
                ? null
                : Array.isArray(rule.modes)
                    ? rule.modes.map(String)
                    : [String(rule.modes)];
            const enabled = rule.enabled !== false &&
                (declaredModes === null || declaredModes.includes(mode)) &&
                (options.only.length === 0 || options.only.includes(rule.id)) &&
                !options.skip.includes(rule.id);
            if (enabled) rules.push(rule.id);
            else skipped.push(rule.id);
        }
        if (options.json) {
            console.log(
                JSON.stringify(
                    {
                        mode,
                        packs: loaded.pack.getPackIds(),
                        rules,
                        skipped
                    },
                    null,
                    2
                )
            );
        } else {
            for (let i = 0, len = rules.length; i < len; i++) {
                console.log(rules[i]);
            }
        }
        return;
    }

    console.error(`Running corpus assertions from ${packs.join(", ")}...`);

    const result = runAssertions(root_dir, {
        packs,
        only: options.only.length > 0 ? options.only : undefined,
        skip: options.skip,
        promoteAdvisory: options.advisory,
        mode
    });

    // A ban passes by matching nothing, so matches are not the vacuity signal.
    // Scope is: a rule that examined no nodes was pointed past the corpus.
    const vacuous = result.executed.filter((id) => {
        if ((result.scopeCounts[id] ?? 0) === 0) {
            return true;
        }
        const join = result.joinCounts[id];
        if (join !== undefined && join.joined === 0) {
            return true;
        }
        const resolve = result.resolveCounts[id];
        return resolve !== undefined && resolve.uses === 0;
    });

    if (options.stats && !options.json) {
        printStats(result, vacuous);
    }

    if (options.json) {
        console.log(
            JSON.stringify(
                {
                    mode,
                    packs: result.packs,
                    executed: result.executed.length,
                    skipped: result.skipped.length,
                    files: result.unitCount,
                    vacuous,
                    scope_counts: result.scopeCounts,
                    join_counts: result.joinCounts,
                    resolve_counts: result.resolveCounts,
                    selection_counts: result.selectionCounts,
                    findings: result.findings
                },
                null,
                2
            )
        );
    } else {
        printHumanReadable(result);
    }

    const errorCount = countBySeverity(result.findings, "error");
    const warnCount =
        countBySeverity(result.findings, "warning") +
        countBySeverity(result.findings, "warn");

    if (options["fail-on-vacuous"] && vacuous.length > 0) {
        console.error(
            `${vacuous.length} rules examined nothing: ${vacuous.join(", ")}`
        );
        process.exit(1);
    }

    if (errorCount > 0 || (options["fail-on-warn"] && warnCount > 0)) {
        process.exit(1);
    }
}

/**
 * @param {import("../lib/record-schema/assertions/AssertionRunner.mjs").AssertionRunResult} result
 * @param {string[]} vacuous
 * @returns {void}
 */
function printStats(result, vacuous) {
    const ids = result.executed.slice().sort();
    console.log("\nnodes examined and matched per rule:");
    for (let i = 0, len = ids.length; i < len; i++) {
        const scope = result.scopeCounts[ids[i]] ?? 0;
        const count = result.selectionCounts[ids[i]] ?? 0;
        console.log(
            `  ${ids[i].padEnd(28)} scope ${String(scope).padStart(7)}  matched ${String(
                count
            ).padStart(6)}${renderJoin(result.joinCounts[ids[i]])}${renderResolve(
                result.resolveCounts[ids[i]]
            )}${
                scope === 0 ? "   <- examined nothing" : ""
            }`
        );
    }
    if (vacuous.length > 0) {
        console.log(
            `\n${vacuous.length} of ${ids.length} rules selected no rows.`
        );
    }
}

/**
 * @param {import("../lib/record-schema/assertions/AssertionRunner.mjs").AssertionRunResult} result
 * @returns {void}
 */
function printHumanReadable(result) {
    console.log(
        `Ran ${result.executed.length} rules over ${result.unitCount} files.`
    );

    if (result.findings.length === 0) {
        console.log("No findings.");
        return;
    }

    /** @type {Record<string, import("../lib/record-schema/assertions/types/general.mjs").AssertionFinding[]>} */
    const byRule = {};
    for (let i = 0, len = result.findings.length; i < len; i++) {
        const finding = result.findings[i];
        const bucket = byRule[finding.rule];
        if (bucket === undefined) {
            byRule[finding.rule] = [finding];
            continue;
        }
        bucket.push(finding);
    }

    const ruleIds = Object.keys(byRule).sort();

    for (let i = 0, len = ruleIds.length; i < len; i++) {
        const bucket = byRule[ruleIds[i]];
        console.log(`\n${ruleIds[i]} (${bucket.length}):`);

        if (options.summary) {
            continue;
        }

        for (let j = 0, count = bucket.length; j < count; j++) {
            const finding = bucket[j];
            const where =
                finding.file === null
                    ? ""
                    : ` ${finding.file}${
                          finding.path === null ? "" : `:${finding.path}`
                      }`;
            console.log(
                `  [${finding.severity.toUpperCase()}]${where}\n      ${
                    finding.message
                }`
            );
        }
    }

    console.log("");
}

/**
 * @param {{ uses: number, defines: number } | undefined} resolve
 * @returns {string}
 */
function renderResolve(resolve) {
    if (resolve === undefined) {
        return "";
    }
    return `  uses ${String(resolve.uses).padStart(5)} defs ${String(
        resolve.defines
    ).padStart(5)}${resolve.uses === 0 ? "   <- resolved nothing" : ""}`;
}

/**
 * @param {{ left: number, right: number, joined: number } | undefined} join
 * @returns {string}
 */
function renderJoin(join) {
    if (join === undefined) {
        return "";
    }
    return `  joined ${String(join.joined).padStart(5)} of ${join.left}/${
        join.right
    }${join.joined === 0 ? "   <- compared nothing" : ""}`;
}

/**
 * @param {import("../lib/record-schema/assertions/types/general.mjs").AssertionFinding[]} findings
 * @param {string} severity
 * @returns {number}
 */
function countBySeverity(findings, severity) {
    let total = 0;
    for (let i = 0, len = findings.length; i < len; i++) {
        if (findings[i].severity === severity) {
            total += 1;
        }
    }
    return total;
}

try {
    run();
} catch (error) {
    console.error(error);
    process.exit(1);
}
