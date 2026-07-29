#!/usr/bin/env node

import { resolve } from "node:path";
import { CLI } from "../lib/cli/cli.mjs";
import { Repository } from "../lib/record-schema/Repository.mjs";
import { FormattingPack } from "../lib/record-schema/FormattingPack.mjs";

const SCRIPT_NAME = "format";
const DESCRIPTION =
    "Format records (normalization, encoding, whitespace). " +
    "Pass --root to a repo root, series folder, or specific record directory.";

const schema = {
    flags: {
        "dry-run": {
            description: "Show what would be changed without writing",
            default: false
        },
        verbose: {
            aliases: ["v"],
            description: "Show per-line diffs for all changed files",
            default: false
        },
        rules: {
            description: "Print active rulesets before processing",
            default: false
        }
    },
    values: {
        root: {
            aliases: ["r"],
            description:
                "Repo root, series folder, or record directory to format",
            default: ".",
            type: "string"
        },
        packs: {
            description:
                "Formatting pack JSON paths (overrides profile discovery)",
            default: [],
            type: "array"
        }
    }
};

const options = CLI.handleCLI({
    scriptName: SCRIPT_NAME,
    description: DESCRIPTION,
    schema
});

const scanDir = resolve(process.cwd(), options.root);
const dryRun = options["dry-run"];
const showDiff = dryRun || options.verbose;

// =============================================================================
// ANSI helpers (only when stdout is a TTY)
// =============================================================================

/** @returns {boolean} */
function isTTY() {
    return process.stdout.isTTY === true;
}

const A = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    cyan: "\x1b[36m",
    bgRed: "\x1b[41m",
    bgGreen: "\x1b[42m"
};

/**
 * @param {string} code
 * @param {string} text
 * @returns {string}
 */
function ansi(code, text) {
    return isTTY() ? `${code}${text}${A.reset}` : text;
}

// =============================================================================
// Diff helpers
// =============================================================================

/**
 * Escape non-ASCII / non-printable chars so invisible changes are visible.
 * @param {string} line
 * @returns {string}
 */
function escapeLine(line) {
    let out = "";
    for (let i = 0, len = line.length; i < len; i++) {
        const cp = line.codePointAt(i) ?? 0;
        if (cp > 0xffff) {
            i++; // surrogate pair
        }
        if (cp >= 0x20 && cp <= 0x7e) {
            out += String.fromCodePoint(cp);
        } else if (cp === 0x09) {
            out += "\\t";
        } else if (cp === 0x0d) {
            out += "\\r";
        } else if (cp === 0xa0) {
            out += "\\u00A0";
        } else if (cp === 0xfeff) {
            out += "\\uFEFF";
        } else if (cp <= 0xffff) {
            out += `\\u${cp.toString(16).toUpperCase().padStart(4, "0")}`;
        } else {
            out += `\\U${cp.toString(16).toUpperCase().padStart(6, "0")}`;
        }
    }
    return out;
}

/**
 * Wrap the changed span within escaped old/new lines with ANSI background.
 * Finds longest common prefix + suffix, highlights the middle.
 * @param {string} escapedOld
 * @param {string} escapedNew
 * @returns {{ markedOld: string, markedNew: string }}
 */
function markInlineDiff(escapedOld, escapedNew) {
    const oa = [...escapedOld];
    const na = [...escapedNew];
    let lo = 0;
    const minLen = Math.min(oa.length, na.length);
    while (lo < minLen && oa[lo] === na[lo]) {
        lo++;
    }
    let ro = oa.length;
    let rn = na.length;
    while (ro > lo && rn > lo && oa[ro - 1] === na[rn - 1]) {
        ro--;
        rn--;
    }

    /**
     * @param {string} bg
     * @param {string[]} chars
     * @returns {string}
     */
    const hi = (bg, chars) =>
        chars.length > 0 ? `${A.bold}${bg}${chars.join("")}${A.reset}` : "";

    const markedOld =
        oa.slice(0, lo).join("") +
        hi(A.bgRed, oa.slice(lo, ro)) +
        oa.slice(ro).join("");

    const markedNew =
        na.slice(0, lo).join("") +
        hi(A.bgGreen, na.slice(lo, rn)) +
        na.slice(rn).join("");

    return { markedOld, markedNew };
}

/**
 * Myers diff: compute edit ops between two line arrays.
 * Returns array of { type: "equal"|"delete"|"insert", line: string }.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {Array<{ type: "equal"|"delete"|"insert", line: string }>}
 */
function myersDiff(a, b) {
    const N = a.length;
    const M = b.length;
    const MAX = N + M;
    if (MAX === 0) {
        return [];
    }

    /** @type {Int32Array[]} */
    const trace = [];
    const v = new Int32Array(2 * MAX + 2);

    outer: for (let d = 0; d <= MAX; d++) {
        trace.push(v.slice());
        for (let k = -d; k <= d; k += 2) {
            const idx = k + MAX;
            let x;
            if (k === -d || (k !== d && v[idx - 1] < v[idx + 1])) {
                x = v[idx + 1];
            } else {
                x = v[idx - 1] + 1;
            }
            let y = x - k;
            while (x < N && y < M && a[x] === b[y]) {
                x++;
                y++;
            }
            v[idx] = x;
            if (x >= N && y >= M) {
                trace.push(v.slice());
                break outer;
            }
        }
    }

    /** @type {Array<{ type: "equal"|"delete"|"insert", line: string }>} */
    const ops = [];
    let x = N;
    let y = M;
    for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
        const vv = trace[d];
        const k = x - y;
        const idx = k + MAX;
        let prevK;
        if (k === -d || (k !== d && vv[idx - 1] < vv[idx + 1])) {
            prevK = k + 1;
        } else {
            prevK = k - 1;
        }
        const prevX = vv[prevK + MAX];
        const prevY = prevX - prevK;
        while (x > prevX && y > prevY) {
            ops.push({ type: "equal", line: a[x - 1] });
            x--;
            y--;
        }
        if (d > 0) {
            if (x === prevX) {
                ops.push({ type: "insert", line: b[y - 1] });
                y--;
            } else {
                ops.push({ type: "delete", line: a[x - 1] });
                x--;
            }
        }
    }
    ops.reverse();
    return ops;
}

/**
 * Categorise character-level changes between two texts using LCS diff.
 * Returns label -> count across all changed lines.
 * @param {string} oldText
 * @param {string} newText
 * @returns {Map<string, number>}
 */
function classifyChanges(oldText, newText) {
    /** @type {Map<string, number>} */
    const counts = new Map();
    /** @param {string} label */
    const bump = (label) => counts.set(label, (counts.get(label) ?? 0) + 1);

    const oldLines = oldText.split("\n");
    const newLines = newText.split("\n");

    // Detect reflow: line count changed (lines split or joined)
    if (oldLines.length !== newLines.length) {
        const delta = newLines.length - oldLines.length;
        bump(`reflow (${delta > 0 ? "+" : ""}${delta} lines)`);
    }

    const ops = myersDiff(oldLines, newLines);

    // Pair up deletes+inserts to classify character-level changes
    /** @type {string[]} */
    const deleted = [];
    /** @type {string[]} */
    const inserted = [];

    const flush = () => {
        const pairLen = Math.min(deleted.length, inserted.length);
        for (let pi = 0; pi < pairLen; pi++) {
            const o = deleted[pi];
            const n = inserted[pi];
            if (o.trimEnd() === n && o !== n) {
                bump("trailing whitespace");
                continue;
            }
            for (let ci = 0, clen = o.length; ci < clen; ci++) {
                const cp = o.codePointAt(ci) ?? 0;
                switch (cp) {
                    case 0xa0:
                        bump("NBSP \\u00A0 \u2192 space");
                        break;
                    case 0x2013:
                        bump("en dash \\u2013 \u2192 -");
                        break;
                    case 0x2014:
                        bump("em dash \\u2014 \u2192 --");
                        break;
                    case 0x2018:
                    case 0x2019:
                        bump("curly single quote \u2192 '");
                        break;
                    case 0x201c:
                    case 0x201d:
                        bump('curly double quote \u2192 "');
                        break;
                    case 0x2026:
                        bump("ellipsis \\u2026 \u2192 ...");
                        break;
                    case 0xfeff:
                        bump("BOM removed");
                        break;
                    case 0x0d:
                        bump("CRLF \u2192 LF");
                        break;
                    default:
                        if (cp > 0x7e) {
                            bump(
                                `non-ASCII U+${cp
                                    .toString(16)
                                    .toUpperCase()
                                    .padStart(4, "0")} removed`
                            );
                        }
                }
            }
        }
        deleted.length = 0;
        inserted.length = 0;
    };

    for (let oi = 0, olen = ops.length; oi < olen; oi++) {
        const op = ops[oi];
        if (op.type === "equal") {
            flush();
        } else if (op.type === "delete") {
            deleted.push(op.line);
        } else {
            inserted.push(op.line);
        }
    }
    flush();

    return counts;
}

/**
 * Render a unified-style diff with inline char highlighting.
 * Uses LCS (Myers) diff so reflowed lines don't corrupt context.
 * @param {string} oldText
 * @param {string} newText
 * @param {string} filePath
 * @returns {{ diff: string, lineCount: number }}
 */
function renderDiff(oldText, newText, filePath) {
    const tty = isTTY();
    const oldLines = oldText.split("\n");
    const newLines = newText.split("\n");

    const ops = myersDiff(oldLines, newLines);

    // Count changed ops for early exit
    let changedCount = 0;
    for (let oi = 0, olen = ops.length; oi < olen; oi++) {
        if (ops[oi].type !== "equal") {
            changedCount++;
        }
    }
    if (changedCount === 0) {
        return { diff: "", lineCount: 0 };
    }

    // Build flat list of { kind: "ctx"|"del"|"ins", line, opIdx }
    // opIdx lets us group into hunks by proximity
    /** @type {Array<{ kind: string, line: string, opIdx: number }>} */
    const flat = [];
    for (let oi = 0, olen = ops.length; oi < olen; oi++) {
        const op = ops[oi];
        flat.push({
            kind:
                op.type === "equal"
                    ? "ctx"
                    : op.type === "delete"
                    ? "del"
                    : "ins",
            line: op.line,
            opIdx: oi
        });
    }

    const CONTEXT = 2;
    // Mark which op indices are "changed"
    /** @type {Set<number>} */
    const changedOpIdxs = new Set();
    for (let fi = 0, flen = flat.length; fi < flen; fi++) {
        if (flat[fi].kind !== "ctx") {
            changedOpIdxs.add(flat[fi].opIdx);
        }
    }

    // Collect op indices that should appear in output (changed ± CONTEXT)
    /** @type {Set<number>} */
    const visible = new Set();
    for (const ci of changedOpIdxs) {
        for (let di = -CONTEXT; di <= CONTEXT; di++) {
            const idx = ci + di;
            if (idx >= 0 && idx < ops.length) {
                visible.add(idx);
            }
        }
    }

    const out = [
        ansi(A.bold, `--- ${filePath}`),
        ansi(A.bold, `+++ ${filePath}`)
    ];

    // Walk ops, emit hunks. Track old/new line numbers separately.
    let oldLine = 1;
    let newLine = 1;

    // Group visible op indices into contiguous hunks
    const sortedVisible = Array.from(visible).sort((a, b) => a - b);
    /** @type {Array<[number, number]>} */
    const hunks = [];
    let hStart = -1,
        hEnd = -1;
    for (let si = 0, slen = sortedVisible.length; si < slen; si++) {
        const idx = sortedVisible[si];
        if (hStart === -1) {
            hStart = idx;
            hEnd = idx;
        } else if (idx === hEnd + 1) {
            hEnd = idx;
        } else {
            hunks.push([hStart, hEnd]);
            hStart = idx;
            hEnd = idx;
        }
    }
    if (hStart !== -1) {
        hunks.push([hStart, hEnd]);
    }

    // Pre-compute old/new line number at start of each op index
    const oldLineAt = new Int32Array(ops.length + 1);
    const newLineAt = new Int32Array(ops.length + 1);
    let ol = 1,
        nl = 1;
    for (let oi = 0, olen = ops.length; oi < olen; oi++) {
        oldLineAt[oi] = ol;
        newLineAt[oi] = nl;
        if (ops[oi].type !== "insert") {
            ol++;
        }
        if (ops[oi].type !== "delete") {
            nl++;
        }
    }
    oldLineAt[ops.length] = ol;
    newLineAt[ops.length] = nl;

    for (let hi = 0, hLen = hunks.length; hi < hLen; hi++) {
        const [from, to] = hunks[hi];
        // Compute old/new counts for hunk header
        let oldCount = 0,
            newCount = 0;
        for (let oi = from; oi <= to; oi++) {
            if (ops[oi].type !== "insert") {
                oldCount++;
            }
            if (ops[oi].type !== "delete") {
                newCount++;
            }
        }
        out.push(
            ansi(
                A.cyan,
                `@@ -${oldLineAt[from]},${oldCount} +${newLineAt[from]},${newCount} @@`
            )
        );
        for (let oi = from; oi <= to; oi++) {
            const op = ops[oi];
            const escaped = escapeLine(op.line);
            if (op.type === "equal") {
                out.push(` ${escaped}`);
            } else if (op.type === "delete") {
                if (tty) {
                    // Try to pair with the next insert for inline highlighting
                    const nextOp = oi + 1 < ops.length ? ops[oi + 1] : null;
                    if (nextOp && nextOp.type === "insert") {
                        const { markedOld } = markInlineDiff(
                            escaped,
                            escapeLine(nextOp.line)
                        );
                        out.push(`${A.red}-${markedOld}${A.reset}`);
                    } else {
                        out.push(`${A.red}-${escaped}${A.reset}`);
                    }
                } else {
                    out.push(`-${escaped}`);
                }
            } else {
                if (tty) {
                    const prevOp = oi - 1 >= 0 ? ops[oi - 1] : null;
                    if (prevOp && prevOp.type === "delete") {
                        const { markedNew } = markInlineDiff(
                            escapeLine(prevOp.line),
                            escaped
                        );
                        out.push(`${A.green}+${markedNew}${A.reset}`);
                    } else {
                        out.push(`${A.green}+${escaped}${A.reset}`);
                    }
                } else {
                    out.push(`+${escaped}`);
                }
            }
        }
    }

    return { diff: out.join("\n"), lineCount: changedCount };
}

// =============================================================================
// Rules printer
// =============================================================================

/**
 * Print a summary of the merged policy: defaults and each ruleset with its
 * selectors, so it's clear which rules are active before any changes happen.
 * @param {import("../lib/record-schema/types/general.mjs").FormattingDocumentPolicy | null} policy
 */
function printActiveRules(policy) {
    if (!policy) {
        console.log(ansi(A.bold, "No policy loaded."));
        return;
    }

    console.log(ansi(A.bold, "Active policy:"));

    // Defaults
    const defaults = policy.defaults;
    if (defaults && Object.keys(defaults).length > 0) {
        console.log(ansi(A.cyan, "  defaults:"));
        if (defaults.formatting_profile) {
            console.log(
                `    formatting_profile: ${defaults.formatting_profile}`
            );
        }
        if (defaults.language_locale) {
            console.log(`    language_locale:    ${defaults.language_locale}`);
        }
        if (defaults.dialect_pack) {
            console.log(`    dialect_pack:       ${defaults.dialect_pack}`);
        }
        if (defaults.line_width) {
            console.log(`    line_width.max:     ${defaults.line_width.max}`);
        }
        if (defaults.encoding) {
            console.log(`    encoding:           ${defaults.encoding}`);
        }
        if (defaults.newlines) {
            console.log(`    newlines:           ${defaults.newlines}`);
        }
        if (defaults.trailing_whitespace) {
            console.log(
                `    trailing_whitespace: ${defaults.trailing_whitespace}`
            );
        }
    }

    // line_width_profiles
    const lwp = policy.line_width_profiles;
    if (lwp && Object.keys(lwp).length > 0) {
        console.log(ansi(A.cyan, "  line_width_profiles:"));
        for (const [id, profile] of Object.entries(lwp)) {
            const applies = Array.isArray(profile.applies_to)
                ? profile.applies_to.join(", ")
                : "*";
            console.log(
                `    ${id}: max=${profile.max}  applies_to: ${applies}`
            );
        }
    }

    // Rulesets
    const rulesets = Array.isArray(policy.rulesets) ? policy.rulesets : [];
    if (rulesets.length === 0) {
        console.log("  (no rulesets)");
    } else {
        console.log(ansi(A.cyan, `  rulesets (${rulesets.length}):`));
        for (let i = 0, len = rulesets.length; i < len; i++) {
            const r = rulesets[i];
            const id = r.id ?? `#${i}`;
            const sev = r.severity ?? "error";
            const sevColor =
                sev === "error" ? A.red : sev === "warn" ? A.bold : A.cyan;

            /** @type {string[]} */
            const selParts = [];
            const sel = r.selectors ?? {};
            if (sel.doc_types) {
                selParts.push(`doc_types: ${sel.doc_types.join("|")}`);
            }
            if (sel.extensions) {
                selParts.push(`ext: ${sel.extensions.join("|")}`);
            }
            if (sel.paths_glob) {
                selParts.push(`glob: ${sel.paths_glob.join(", ")}`);
            }
            if (sel.is_root_file) {
                selParts.push("root_file");
            }

            /** @type {string[]} */
            const enfParts = [];
            const enf = r.enforce ?? {};
            if (enf.formatting_profile) {
                enfParts.push(`profile:${enf.formatting_profile}`);
            }
            if (enf.line_width) {
                enfParts.push(`lw:${enf.line_width.max}`);
            }
            if (enf.dialect_pack) {
                enfParts.push(`dialect:${enf.dialect_pack}`);
            }
            if (enf.require_disclaimer_footer) {
                enfParts.push("footer");
            }
            if (enf.require_metadata_block) {
                enfParts.push("metadata_block");
            }
            if (enf.metadata_required_fields) {
                enfParts.push(
                    `fields:[${enf.metadata_required_fields.join(",")}]`
                );
            }

            console.log(
                `    ${ansi(sevColor, `[${sev}]`)} ${ansi(A.bold, id)}` +
                    (selParts.length > 0 ? `  → ${selParts.join("  ")}` : "") +
                    (enfParts.length > 0 ? `  (${enfParts.join(", ")})` : "")
            );
        }
    }

    console.log("");
}

// =============================================================================
// Main
// =============================================================================

function run() {
    const repo = Repository.fromFolder(scanDir);

    if (options.packs && options.packs.length > 0) {
        repo.loadPacks(options.packs);
    }

    const policy = repo.getPolicy() ?? null;

    if (options.rules) {
        printActiveRules(policy);
    }

    console.error(`Formatting: ${scanDir}`);

    const results = repo.formatDocuments({ scanDir, dryRun });

    if (results.length === 0) {
        console.log("Nothing to format.");
        return;
    }

    /** @type {Map<string, number>} */
    const totalCounts = new Map();

    if (showDiff) {
        for (let i = 0, len = results.length; i < len; i++) {
            const { rel_path, original_text, new_text } = results[i];
            const { diff } = renderDiff(original_text, new_text, rel_path);
            if (diff) {
                console.log(diff);
            }
            const counts = classifyChanges(original_text, new_text);
            if (counts.size > 0) {
                /** @type {string[]} */
                const parts = [];
                for (const [label, count] of counts) {
                    totalCounts.set(
                        label,
                        (totalCounts.get(label) ?? 0) + count
                    );
                    parts.push(`${count}\u00d7 ${label}`);
                }
                console.log(
                    ansi(A.cyan, `  \u2514 ${rel_path}: ${parts.join(", ")}`)
                );
            }
        }
    } else {
        for (let i = 0, len = results.length; i < len; i++) {
            const counts = classifyChanges(
                results[i].original_text,
                results[i].new_text
            );
            for (const [label, count] of counts) {
                totalCounts.set(label, (totalCounts.get(label) ?? 0) + count);
            }
        }
    }

    // Summary block
    console.log("");
    const verb = dryRun ? "would change" : "changed";
    if (results.length > 0) {
        console.log(ansi(A.bold, `${results.length} file(s) ${verb}.`));
    } else {
        console.log("Nothing to format.");
    }

    if (totalCounts.size > 0) {
        for (const [label, count] of totalCounts) {
            console.log(`  ${count}\u00d7 ${label}`);
        }
    }

    if (dryRun && results.length > 0) {
        console.log("");
        for (let i = 0, len = results.length; i < len; i++) {
            console.log(`  - ${results[i].rel_path}`);
        }
    }

    // -------------------------------------------------------------------------
    // Lint pass — runs on post-format state (or current state in dry-run).
    // Format fixes most auto-correctable issues first, so lint results here
    // reflect what remains after normalization.
    // -------------------------------------------------------------------------
    console.log("");
    const lintIssues = repo.lintDocuments({ scanDir });

    const SEVERITY_COLOR = {
        error: A.red,
        warn: A.bold,
        info: A.cyan
    };

    if (lintIssues.length === 0) {
        console.log(ansi(A.green, "No lint issues."));
    } else {
        const errorCount = lintIssues.filter(
            (i) => i.severity === "error"
        ).length;
        const warnCount = lintIssues.filter(
            (i) => i.severity === "warn"
        ).length;
        const infoCount = lintIssues.filter(
            (i) => i.severity === "info"
        ).length;

        /** @type {string[]} */
        const parts = [];
        if (errorCount > 0) {
            parts.push(ansi(A.red, `${errorCount} error(s)`));
        }
        if (warnCount > 0) {
            parts.push(ansi(A.bold, `${warnCount} warning(s)`));
        }
        if (infoCount > 0) {
            parts.push(ansi(A.cyan, `${infoCount} info`));
        }
        console.log(parts.join("  "));
        console.log("");

        for (let i = 0, len = lintIssues.length; i < len; i++) {
            const issue = lintIssues[i];
            const loc = issue.line ? `:${issue.line}` : "";
            const sev = issue.severity.toUpperCase();
            const color = SEVERITY_COLOR[issue.severity] ?? "";
            console.log(
                `${ansi(color, `[${sev}]`)} ${issue.file}${loc}: ${
                    issue.message
                } (${issue.code})`
            );
        }
    }

    if (lintIssues.some((i) => i.severity === "error")) {
        process.exit(1);
    }
}

try {
    run();
} catch (err) {
    console.error(err);
    process.exit(1);
}
