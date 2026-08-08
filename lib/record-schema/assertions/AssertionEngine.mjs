/**
 * The corpus assertion engine.
 *
 * Sixteen rule kinds, each describing a defect shape rather than a corpus
 * subject. A corpus declares which paths play each role and the engine applies
 * the generic operation without domain-specific knowledge.
 *
 * The kinds:
 *
 *   forbid      selected rows are findings
 *   require     every scoped row satisfies a predicate
 *   pattern     selected values satisfy a regular form
 *   unique      rendered keys are unique within a partition
 *   consistent  rows in one group render one value
 *   resolve     uses resolve to declarations, exemptions, and activations
 *   agree       joined projections carry the declared relation
 *   derive      a closed expression holds for every scoped row
 *   count       group cardinality remains within bounds
 *   reach       graph nodes reach an accepted tier or baseline category
 *   cycle       graph components contain no prohibited cycle
 *   decode      bytes decode through declared layouts and claims
 *   digest      a manifest commits to an exact raw-byte inventory
 *   lex         embedded text satisfies a declared language
 *   path        repository paths resolve safely to the requested kind
 *   format      source text satisfies a deterministic formatter
 *
 * @module record-schema/assertions/AssertionEngine
 */

import { evaluatePath, evaluatePathValues, isPlainObject } from "./Path.mjs";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import { evaluatePredicate, looseEqual, coerceNumber } from "./Predicate.mjs";
import { renderKey, renderTemplate } from "./Template.mjs";
import { evaluateExpression } from "./Expression.mjs";
import { CorpusIndex } from "./CorpusIndex.mjs";
import { decodeLayout } from "./Decoder.mjs";
import { lexEmbeddedLanguage } from "./EmbeddedLanguage.mjs";
import { analyzeYamlFlowMappingSpacing } from "./YamlFormatting.mjs";
import {
    buildDigestEntries,
    computeDigestCommitment,
    hexToBytes
} from "./Manifest.mjs";

/** @typedef {import("./types/general.mjs").AssertionFinding} AssertionFinding */
/** @typedef {import("./types/general.mjs").AssertionRule} AssertionRule */
/** @typedef {import("./types/general.mjs").CorpusUnit} CorpusUnit */
/** @typedef {import("./types/general.mjs").SelectorRow} SelectorRow */
/** @typedef {import("./types/general.mjs").ReachAnalysis} ReachAnalysis */
/** @typedef {import("./types/general.mjs").ReachBaseline} ReachBaseline */
/** @typedef {import("./types/general.mjs").ReachNode} ReachNode */
/** @typedef {import("./types/general.mjs").ReachRow} ReachRow */

const DEFAULT_SEVERITY = "error";

/**
 * Executes a resolved assertion pack against a corpus index.
 */
export class AssertionEngine {
    /**
     * @param {CorpusIndex} index
     * @param {import("./types/general.mjs").ResolvedPack} pack
     * @param {{ severityOverrides?: Record<string, string>, only?: string[], skip?: string[], mode?: string }} [options]
     */
    constructor(index, pack, options = {}) {
        /** @type {CorpusIndex} */
        this.index = index;

        /** @type {import("./types/general.mjs").ResolvedPack} */
        this.pack = pack;

        /** @type {Record<string, string>} */
        this.severityOverrides = options.severityOverrides ?? {};

        /** @type {string[] | null} */
        this.only = options.only ?? null;

        /** @type {string[]} */
        this.skip = options.skip ?? [];

        /** @type {string} */
        this.mode = options.mode ?? "development";

        /** @type {Map<string, SelectorRow[]>} */
        this._selectorCache = new Map();

        /** @type {Map<string, number>} */
        this._scopeCache = new Map();

        /** @type {Map<string, Record<string, unknown>>} */
        this._tableCache = new Map();

        /** @type {Set<string>} */
        this._tableResolutionStack = new Set();

        // An `agree` rule can select rows on both sides and still compare
        // nothing, because every key on the left resolved to no key on the
        // right. Scope and match counts cannot see that; the join can only be
        // observed at the join.
        /** @type {Map<string, { left: number, right: number, joined: number }>} */
        this.joinCounts = new Map();

        // `resolve` has the same blind spot as `agree`, one level further in: a
        // rule that selects three hundred declarations and zero uses reports
        // clean, and the single row count cannot show which side the rows came
        // from. Both sides are counted separately for that reason.
        /** @type {Map<string, { uses: number, defines: number }>} */
        this.resolveCounts = new Map();

        // A rule that selects nothing reports clean because it found nothing,
        // not because nothing is wrong. Counting rows per rule is what makes
        // the difference visible; `assert --stats` prints it.
        /** @type {Map<string, number>} */
        this.selectionCounts = new Map();

        // Rows that survived `where` is the wrong non-vacuity signal for a ban:
        // a `forbid` rule passes by selecting nothing. What proves a ban was
        // pointed at the corpus rather than past it is how much of the corpus it
        // looked at, so scope is counted separately from matches.
        /** @type {Map<string, number>} */
        this.scopeCounts = new Map();

        /** @type {string | null} */
        this._currentRule = null;
    }

    /**
     * Run every enabled rule.
     *
     * @returns {{ findings: AssertionFinding[], executed: string[], skipped: string[]; selectionCounts: Map<string, number>; scopeCounts: Map<string, number>; joinCounts: Map<string, {left: number; right: number; joined: number; }>; resolveCounts: Map<string, { uses: number; defines: number; }> }}
     */
    run() {
        /** @type {AssertionFinding[]} */
        const findings = [];
        /** @type {string[]} */
        const executed = [];
        /** @type {string[]} */
        const skipped = [];

        const rules = this.pack.rules;

        for (let i = 0, len = rules.length; i < len; i++) {
            const rule = rules[i];

            if (rule.enabled === false || !ruleAppliesInMode(rule, this.mode)) {
                skipped.push(rule.id);
                continue;
            }
            if (this.only !== null && !this.only.includes(rule.id)) {
                skipped.push(rule.id);
                continue;
            }
            if (this.skip.includes(rule.id)) {
                skipped.push(rule.id);
                continue;
            }

            executed.push(rule.id);
            this._currentRule = rule.id;
            if (!this.selectionCounts.has(rule.id)) {
                this.selectionCounts.set(rule.id, 0);
            }
            if (!this.scopeCounts.has(rule.id)) {
                this.scopeCounts.set(rule.id, 0);
            }

            try {
                this._runRule(rule, findings);
            } catch (error) {
                findings.push({
                    severity: "error",
                    code: `${rule.id}/ENGINE`,
                    rule: rule.id,
                    file: this.pack.source ?? null,
                    path: null,
                    message: `rule failed to execute: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                });
            } finally {
                this._selectorCache.clear();
                this._scopeCache.clear();
                this._tableCache.clear();
                this._tableResolutionStack.clear();
            }
        }

        const parseErrors = this.index.parseErrors;
        for (let i = 0, len = parseErrors.length; i < len; i++) {
            findings.push({
                severity: "error",
                code: "PARSE",
                rule: "PARSE",
                file: parseErrors[i].file,
                path: null,
                message: parseErrors[i].message
            });
        }

        this._currentRule = null;

        return {
            findings,
            executed,
            skipped,
            selectionCounts: this.selectionCounts,
            scopeCounts: this.scopeCounts,
            joinCounts: this.joinCounts,
            resolveCounts: this.resolveCounts
        };
    }

    /**
     * Evaluate the selected and bound rows of a derive rule without emitting
     * findings. Materializers consume this directly so validation and repair
     * cannot disagree about the computed value.
     *
     * @param {AssertionRule} rule
     * @returns {{ row: SelectorRow, bindings: Record<string, unknown>, outcome: unknown }[]}
     */
    evaluateDerive(rule) {
        let rows = this._selectMany(rule.scope ?? rule.select);
        if (typeof rule.dedupe_by === "string") {
            const seen = new Set();
            rows = rows.filter((row) => {
                const key = renderKey(rule.dedupe_by, row.value, row.bindings);
                if (key === null || seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }

        const bindSpec = isPlainObject(rule.bind)
            ? /** @type {Record<string, unknown>} */ (rule.bind)
            : {};
        const assertion = requireString(
            rule.assert,
            "derive rule needs `assert`"
        );
        const guard = typeof rule.when === "string" ? rule.when : null;
        const tables = this._resolveRuleTables(rule);
        const bindNames = Object.keys(bindSpec);
        const evaluated = [];

        for (let i = 0, len = rows.length; i < len; i++) {
            const row = rows[i];
            /** @type {Record<string, unknown>} */
            const bindings = Object.assign({}, tables, row.bindings);
            let incomplete = false;

            for (let j = 0, count = bindNames.length; j < count; j++) {
                const name = bindNames[j];
                const specification = bindSpec[name];
                if (
                    typeof specification === "string" &&
                    specification.startsWith("$")
                ) {
                    const values = evaluatePathValues(row.value, specification);
                    if (isPluralPath(specification)) {
                        bindings[name] = values.map(numeric);
                        bindings[`#${name}`] = bindings[name];
                        continue;
                    }
                    if (values.length === 0) {
                        if (rule.require_bindings === false) {
                            bindings[name] = null;
                            bindings[`#${name}`] = null;
                            continue;
                        }
                        incomplete = true;
                        break;
                    }
                    bindings[name] = values.length === 1 ? values[0] : values;
                    bindings[`#${name}`] = bindings[name];
                    continue;
                }

                const resolved = resolveSelectorValue(
                    specification,
                    row,
                    bindings
                );
                if (resolved === undefined) {
                    if (rule.require_bindings === false) {
                        bindings[name] = null;
                        bindings[`#${name}`] = null;
                        continue;
                    }
                    incomplete = true;
                    break;
                }
                bindings[name] = resolved;
                bindings[`#${name}`] = resolved;
            }

            if (incomplete) continue;
            if (
                guard !== null &&
                evaluateExpression(guard, bindings) !== true
            ) {
                continue;
            }
            evaluated.push({
                row,
                bindings,
                outcome: evaluateExpression(assertion, bindings)
            });
        }

        return evaluated;
    }

    /**
     * Project selector rows for declarative reports.
     *
     * @param {unknown} projection
     * @returns {{ row: SelectorRow, bindings: Record<string, unknown> }[]}
     */
    evaluateProjection(projection) {
        if (!isPlainObject(projection)) {
            throw new Error("report projection must be a mapping");
        }
        const specification = /** @type {Record<string, any>} */ (projection);
        const rows = this._selectMany(
            specification.select ?? specification.scope ?? specification
        );
        const tables = this._resolveTables(
            arrayOfStrings(specification.with_tables)
        );
        /** @type {{ row: SelectorRow, bindings: Record<string, unknown> }[]} */
        const out = [];

        for (let i = 0, len = rows.length; i < len; i++) {
            const row = rows[i];
            const prepared = {
                unit: row.unit,
                match: row.match,
                value: row.value,
                bindings: Object.assign({}, tables, row.bindings)
            };
            const bound = this._bindSelectorRow(specification.bind, prepared);
            out.push({ row: bound, bindings: bound.bindings });
        }
        return out;
    }

    /**
     * Resolve one value against a projected report row.
     *
     * @param {unknown} specification
     * @param {{ row: SelectorRow, bindings: Record<string, unknown> }} projection
     * @returns {unknown}
     */
    evaluateProjectionValue(specification, projection) {
        const row = {
            unit: projection.row.unit,
            match: projection.row.match,
            value: projection.row.value,
            bindings: projection.bindings
        };
        return resolveSelectorValue(specification, row, projection.bindings);
    }

    // =========================================================================
    // Rule dispatch
    // =========================================================================

    /**
     * @param {AssertionRule} rule
     * @param {AssertionFinding[]} findings
     * @returns {void}
     */
    _runRule(rule, findings) {
        switch (rule.kind) {
            case "forbid":
                return this._runForbid(rule, findings);
            case "require":
                return this._runRequire(rule, findings);
            case "pattern":
                return this._runPattern(rule, findings);
            case "unique":
                return this._runUnique(rule, findings);
            case "resolve":
                return this._runResolve(rule, findings);
            case "agree":
                return this._runAgree(rule, findings);
            case "derive":
                return this._runDerive(rule, findings);
            case "count":
                return this._runCount(rule, findings);
            case "reach":
                return this._runReach(rule, findings);
            case "cycle":
                return this._runCycle(rule, findings);
            case "decode":
                return this._runDecode(rule, findings);
            case "consistent":
                return this._runConsistent(rule, findings);
            case "digest":
                return this._runDigest(rule, findings);
            case "lex":
                return this._runLex(rule, findings);
            case "path":
                return this._runPath(rule, findings);
            case "format":
                return this._runFormat(rule, findings);
            default:
                throw new Error(`unknown rule kind "${String(rule.kind)}"`);
        }
    }

    // =========================================================================
    // Kinds
    // =========================================================================

    /**
     * @param {AssertionRule} rule
     * @param {AssertionFinding[]} findings
     * @returns {void}
     */
    _runForbid(rule, findings) {
        const rows = this._selectMany(rule.select);
        for (let i = 0, len = rows.length; i < len; i++) {
            findings.push(this._finding(rule, rows[i]));
        }
    }

    /**
     * @param {AssertionRule} rule
     * @param {AssertionFinding[]} findings
     * @returns {void}
     */
    _runRequire(rule, findings) {
        const rows = this._selectMany(rule.scope ?? rule.select);
        const must = rule.must;

        for (let i = 0, len = rows.length; i < len; i++) {
            const row = rows[i];
            if (evaluatePredicate(must, row.value, row.bindings)) {
                continue;
            }
            findings.push(this._finding(rule, row));
        }
    }

    /**
     * @param {AssertionRule} rule
     * @param {AssertionFinding[]} findings
     * @returns {void}
     */
    _runPattern(rule, findings) {
        const rows = this._selectMany(rule.select);
        const expression =
            rule.match !== undefined ? rule.match : rule.not_match;
        if (expression === undefined) {
            throw new Error("pattern rule needs `match` or `not_match`");
        }
        const expected = rule.match !== undefined;
        const regex = new RegExp(String(expression), String(rule.flags ?? ""));

        for (let i = 0, len = rows.length; i < len; i++) {
            const row = rows[i];
            const text =
                typeof row.value === "string"
                    ? row.value
                    : row.value === null || row.value === undefined
                    ? ""
                    : String(row.value);

            if (regex.test(text) === expected) {
                continue;
            }
            findings.push(this._finding(rule, row));
        }
    }

    /**
     * @param {AssertionRule} rule
     * @param {AssertionFinding[]} findings
     * @returns {void}
     */
    _runUnique(rule, findings) {
        const rows = this._selectMany(rule.select);
        const keyTemplate = requireString(rule.key, "unique rule needs `key`");
        const groupTemplate = rule.within ?? null;

        /** @type {Map<string, SelectorRow[]>} */
        const buckets = new Map();

        for (let i = 0, len = rows.length; i < len; i++) {
            const row = rows[i];
            const key = renderKey(keyTemplate, row.value, row.bindings);
            if (key === null) {
                continue;
            }
            const group =
                groupTemplate === null
                    ? ""
                    : renderKey(groupTemplate, row.value, row.bindings) ?? "";
            const bucketKey = `${group}\u0000${key}`;
            const bucket = buckets.get(bucketKey);
            if (bucket === undefined) {
                buckets.set(bucketKey, [row]);
                continue;
            }
            bucket.push(row);
        }

        for (const [bucketKey, bucket] of buckets) {
            if (bucket.length <= 1) {
                continue;
            }
            const key = bucketKey.slice(bucketKey.indexOf("\u0000") + 1);
            const sites = bucket
                .map((row) => `${row.unit.file}:${row.match.path}`)
                .join(", ");
            findings.push(
                this._finding(
                    bucket[0],
                    bucket[0],
                    {
                        "#key": key,
                        "#count": bucket.length,
                        "#sites": sites
                    },
                    rule
                )
            );
        }
    }

    /**
     * Every row in a group carries the same value.
     *
     * The inverse of `unique`, and a different question: `unique` asks whether
     * two rows collide on a key, this asks whether rows that share a key
     * disagree about something else. A segment file holding both a stable and a
     * per-block segment is rewritten at the faster of the two rates, and the
     * budget the stable one was sized against stops being the budget it gets.
     *
     * @param {AssertionRule} rule
     * @param {AssertionFinding[]} findings
     * @returns {void}
     */
    _runConsistent(rule, findings) {
        const rows = this._selectMany(rule.select);
        const groupTemplate = requireString(
            rule.group,
            "consistent rule needs `group`"
        );
        const valueTemplate = requireString(
            rule.value,
            "consistent rule needs `value`"
        );

        /** @type {Map<string, Map<string, SelectorRow[]>>} */
        const groups = new Map();

        for (let i = 0, len = rows.length; i < len; i++) {
            const row = rows[i];
            const group = renderKey(groupTemplate, row.value, row.bindings);
            const value = renderKey(valueTemplate, row.value, row.bindings);
            if (group === null || value === null) {
                continue;
            }
            let bucket = groups.get(group);
            if (bucket === undefined) {
                bucket = new Map();
                groups.set(group, bucket);
            }
            const seen = bucket.get(value);
            if (seen === undefined) {
                bucket.set(value, [row]);
                continue;
            }
            seen.push(row);
        }

        for (const [group, bucket] of groups) {
            if (bucket.size <= 1) {
                continue;
            }
            /** @type {SelectorRow[]} */
            const anchors = [];
            for (const [, bucketRows] of bucket) {
                anchors.push(bucketRows[0]);
            }
            const sites = anchors
                .map((row) => `${row.unit.file}:${row.match.path}`)
                .join(", ");

            findings.push(
                this._finding(rule, anchors[0], {
                    "#group": group,
                    "#values": [...bucket.keys()].join(", "),
                    "#count": bucket.size,
                    "#sites": sites
                })
            );
        }
    }

    /**
     * @param {AssertionRule} rule
     * @param {AssertionFinding[]} findings
     * @returns {void}
     */
    _runResolve(rule, findings) {
        const uses = this._selectMany(rule.uses);
        const definitions = this._selectMany(rule.defines);

        this.resolveCounts.set(rule.id, {
            uses: uses.length,
            defines: definitions.length
        });

        const useKeyTemplate = requireString(
            rule.use_key ?? rule.key,
            "resolve rule needs `use_key`"
        );
        const defineKeyTemplate = requireString(
            rule.define_key ?? rule.key,
            "resolve rule needs `define_key`"
        );
        const useScope = rule.use_scope ?? null;
        const defineScope = rule.define_scope ?? null;

        /** @type {Map<string, Set<string>>} */
        const declared = new Map();

        for (let i = 0, len = definitions.length; i < len; i++) {
            const row = definitions[i];
            const key = renderKey(defineKeyTemplate, row.value, row.bindings);
            if (key === null) {
                continue;
            }
            const scope =
                defineScope === null
                    ? ""
                    : renderKey(defineScope, row.value, row.bindings) ?? "";
            const bucket = declared.get(scope);
            if (bucket === undefined) {
                declared.set(scope, new Set([key]));
                continue;
            }
            bucket.add(key);
        }

        const extraKeys = arrayOfStrings(rule.also_declared);
        if (extraKeys.length > 0) {
            const bucket = declared.get("") ?? new Set();
            for (let i = 0, len = extraKeys.length; i < len; i++) {
                bucket.add(extraKeys[i]);
            }
            declared.set("", bucket);
        }

        const ignore = arrayOfStrings(rule.ignore);
        const ignorePattern =
            rule.ignore_pattern === undefined
                ? null
                : new RegExp(String(rule.ignore_pattern));

        /** @type {Map<string, Set<string>>} */
        const activators = new Map();
        if (rule.activation_defines !== undefined) {
            const activationRows = this._selectMany(rule.activation_defines);
            const activationKeyTemplate = requireString(
                rule.activation_key,
                "resolve rule with `activation_defines` needs `activation_key`"
            );
            const activationScopeTemplate = rule.activation_scope ?? null;
            for (let i = 0, len = activationRows.length; i < len; i++) {
                const row = activationRows[i];
                const key = renderKey(
                    activationKeyTemplate,
                    row.value,
                    row.bindings
                );
                if (key === null) continue;
                const scope =
                    activationScopeTemplate === null
                        ? ""
                        : renderKey(
                              activationScopeTemplate,
                              row.value,
                              row.bindings
                          ) ?? "";
                const bucket = activators.get(scope);
                if (bucket === undefined) activators.set(scope, new Set([key]));
                else bucket.add(key);
            }
        }

        /** @type {Map<string, Set<string>>} */
        const exempted = new Map();
        if (rule.exempts !== undefined) {
            const exemptions = this._selectMany(rule.exempts);
            const exemptKeyTemplate = requireString(
                rule.exempt_key,
                "resolve rule with `exempts` needs `exempt_key`"
            );
            const exemptScopeTemplate = rule.exempt_scope ?? null;
            for (let i = 0, len = exemptions.length; i < len; i++) {
                const row = exemptions[i];
                const key = renderKey(
                    exemptKeyTemplate,
                    row.value,
                    row.bindings
                );
                if (key === null) continue;
                const scope =
                    exemptScopeTemplate === null
                        ? ""
                        : renderKey(
                              exemptScopeTemplate,
                              row.value,
                              row.bindings
                          ) ?? "";
                const bucket = exempted.get(scope);
                if (bucket === undefined) exempted.set(scope, new Set([key]));
                else bucket.add(key);
            }
        }

        const useExemptKeyTemplate = rule.use_exempt_key ?? null;
        const useExemptScopeTemplate = rule.use_exempt_scope ?? useScope;
        const useActivationKeyTemplate = rule.use_activation_key ?? null;
        const useActivationScopeTemplate =
            rule.use_activation_scope ?? useScope;
        const seenUses = rule.dedupe_uses === true ? new Set() : null;

        for (let i = 0, len = uses.length; i < len; i++) {
            const row = uses[i];
            const key = renderKey(useKeyTemplate, row.value, row.bindings);
            if (key === null) {
                continue;
            }
            if (ignore.includes(key)) {
                continue;
            }
            if (ignorePattern !== null && ignorePattern.test(key)) {
                continue;
            }

            const scope =
                useScope === null
                    ? ""
                    : renderKey(useScope, row.value, row.bindings) ?? "";

            if (seenUses !== null) {
                const identity = `${scope}\u0000${key}`;
                if (seenUses.has(identity)) continue;
                seenUses.add(identity);
            }

            if (useActivationKeyTemplate !== null) {
                const activationKey = renderKey(
                    useActivationKeyTemplate,
                    row.value,
                    row.bindings
                );
                const activationScope =
                    useActivationScopeTemplate === null
                        ? ""
                        : renderKey(
                              useActivationScopeTemplate,
                              row.value,
                              row.bindings
                          ) ?? "";
                const local = activators.get(activationScope);
                const globalActivators =
                    useActivationScopeTemplate === null
                        ? local
                        : activators.get("");
                if (
                    activationKey === null ||
                    !(
                        (local !== undefined && local.has(activationKey)) ||
                        (globalActivators !== undefined &&
                            globalActivators.has(activationKey))
                    )
                ) {
                    continue;
                }
            }

            if (useExemptKeyTemplate !== null) {
                const exemptKey = renderKey(
                    useExemptKeyTemplate,
                    row.value,
                    row.bindings
                );
                const exemptScope =
                    useExemptScopeTemplate === null
                        ? ""
                        : renderKey(
                              useExemptScopeTemplate,
                              row.value,
                              row.bindings
                          ) ?? "";
                const local = exempted.get(exemptScope);
                const globalExemptions =
                    useExemptScopeTemplate === null ? local : exempted.get("");
                if (
                    exemptKey !== null &&
                    ((local !== undefined && local.has(exemptKey)) ||
                        (globalExemptions !== undefined &&
                            globalExemptions.has(exemptKey)))
                ) {
                    continue;
                }
            }

            const bucket = declared.get(scope);
            const global = useScope === null ? bucket : declared.get("");

            if (
                (bucket !== undefined && bucket.has(key)) ||
                (global !== undefined && global.has(key))
            ) {
                continue;
            }

            findings.push(
                this._finding(rule, row, { "#key": key, "#scope": scope })
            );
        }
    }

    /**
     * @param {AssertionRule} rule
     * @param {AssertionFinding[]} findings
     * @returns {void}
     */
    _runAgree(rule, findings) {
        const left = this._project(rule.left, "left");
        const right = this._project(rule.right, "right");

        let joined = 0;
        for (const key of left.keys()) {
            if (right.has(key)) {
                joined += 1;
            }
        }
        this.joinCounts.set(rule.id, {
            left: left.size,
            right: right.size,
            joined
        });

        const requireRight = rule.require_right !== false;
        const requireLeft = rule.require_left === true;

        for (const [key, leftEntry] of left) {
            const rightEntry = right.get(key);

            if (rightEntry === undefined) {
                if (requireRight) {
                    findings.push(
                        this._finding(rule, leftEntry.row, {
                            "#key": key,
                            "#left": stringifyValue(leftEntry.value),
                            "#right": "<absent>",
                            "#right_file": "<absent>"
                        })
                    );
                }
                continue;
            }

            if (this._valuesAgree(rule, leftEntry.value, rightEntry.value)) {
                continue;
            }

            findings.push(
                this._finding(rule, leftEntry.row, {
                    "#key": key,
                    "#left": stringifyValue(leftEntry.value),
                    "#right": stringifyValue(rightEntry.value),
                    "#right_file": rightEntry.row.unit.file,
                    "#right_path": rightEntry.row.match.path
                })
            );
        }

        if (!requireLeft) {
            return;
        }

        for (const [key, rightEntry] of right) {
            if (left.has(key)) {
                continue;
            }
            findings.push(
                this._finding(rule, rightEntry.row, {
                    "#key": key,
                    "#left": "<absent>",
                    "#right": stringifyValue(rightEntry.value),
                    "#right_file": rightEntry.row.unit.file
                })
            );
        }
    }

    /**
     * @param {AssertionRule} rule
     * @param {AssertionFinding[]} findings
     * @returns {void}
     */
    _runDerive(rule, findings) {
        const rows = this._selectMany(rule.scope ?? rule.select);
        const bindSpec = isPlainObject(rule.bind)
            ? /** @type {Record<string, string>} */ (rule.bind)
            : {};
        const assertion = requireString(
            rule.assert,
            "derive rule needs `assert`"
        );
        const guard = typeof rule.when === "string" ? rule.when : null;
        const tables = this._resolveRuleTables(rule);
        const bindNames = Object.keys(bindSpec);
        const dedupeSpecification = rule.dedupe_by;
        /** @type {Set<string>} */
        const dedupeKeys = new Set();

        for (let i = 0, len = rows.length; i < len; i++) {
            const row = rows[i];

            if (dedupeSpecification !== undefined) {
                const rendered =
                    typeof dedupeSpecification === "string"
                        ? renderKey(
                              dedupeSpecification,
                              row.value,
                              row.bindings
                          )
                        : stringifyValue(
                              resolveSelectorValue(
                                  dedupeSpecification,
                                  row,
                                  row.bindings
                              )
                          );
                if (rendered !== null) {
                    if (dedupeKeys.has(rendered)) {
                        continue;
                    }
                    dedupeKeys.add(rendered);
                }
            }

            /** @type {Record<string, unknown>} */
            const bindings = Object.assign({}, tables, row.bindings);
            let incomplete = false;

            for (let j = 0, count = bindNames.length; j < count; j++) {
                const name = bindNames[j];
                const spec = bindSpec[name];

                if (typeof spec === "string" && spec.startsWith("$")) {
                    const values = evaluatePathValues(row.value, spec);
                    if (isPluralPath(spec)) {
                        bindings[name] = values.map(numeric);
                        continue;
                    }
                    if (values.length === 0) {
                        if (rule.require_bindings === false) {
                            bindings[name] = null;
                            continue;
                        }
                        incomplete = true;
                        break;
                    }
                    bindings[name] = values.length === 1 ? values[0] : values;
                    continue;
                }

                const resolved = resolveSelectorValue(spec, row, bindings);
                if (resolved === undefined) {
                    if (rule.require_bindings === false) {
                        bindings[name] = null;
                        continue;
                    }
                    incomplete = true;
                    break;
                }
                bindings[name] = resolved;
            }

            if (incomplete) {
                continue;
            }

            const expressionBindings = selectorExpressionBindings(
                row,
                bindings
            );

            // `when` decides whether the assertion applies at all. A row whose
            // widths this pack cannot resolve is not a row that fails; it is a
            // row the check has nothing to say about, and reporting it as a
            // defect is how a gate teaches people to silence it.
            if (
                guard !== null &&
                evaluateExpression(guard, expressionBindings) !== true
            ) {
                continue;
            }

            const outcome = evaluateExpression(assertion, expressionBindings);
            if (outcome === true || outcome === 1) {
                continue;
            }

            /** @type {Record<string, unknown>} */
            const extra = { "#result": stringifyValue(outcome) };
            for (let j = 0, count = bindNames.length; j < count; j++) {
                extra[`#${bindNames[j]}`] = stringifyValue(
                    bindings[bindNames[j]]
                );
            }

            findings.push(this._finding(rule, row, extra));
        }
    }

    /**
     * @param {AssertionRule} rule
     * @param {AssertionFinding[]} findings
     * @returns {void}
     */
    _runCount(rule, findings) {
        const rows = this._selectMany(rule.select ?? rule.scope);
        const groupTemplate = rule.group ?? "{#file}";

        /** @type {Map<string, SelectorRow[]>} */
        const groups = new Map();

        for (let i = 0, len = rows.length; i < len; i++) {
            const row = rows[i];
            const group =
                renderKey(groupTemplate, row.value, row.bindings) ?? "";
            const bucket = groups.get(group);
            if (bucket === undefined) {
                groups.set(group, [row]);
                continue;
            }
            bucket.push(row);
        }

        if (rule.over !== undefined) {
            const universe = this._select(rule.over);
            for (let i = 0, len = universe.length; i < len; i++) {
                const row = universe[i];
                const group =
                    renderKey(groupTemplate, row.value, row.bindings) ?? "";
                if (!groups.has(group)) {
                    groups.set(group, []);
                }
            }
        }

        const min = rule.min === undefined ? null : Number(rule.min);
        const max = rule.max === undefined ? null : Number(rule.max);

        for (const [group, bucket] of groups) {
            const size = bucket.length;
            if (
                (min === null || size >= min) &&
                (max === null || size <= max)
            ) {
                continue;
            }

            const anchor =
                bucket.length > 0 ? bucket[0] : this._anchorFor(rule, group);

            findings.push(
                this._finding(rule, anchor, {
                    "#group": group,
                    "#count": size,
                    "#min": min === null ? "" : min,
                    "#max": max === null ? "" : max
                })
            );
        }
    }

    /**
     * @param {AssertionRule} rule
     * @param {AssertionFinding[]} findings
     * @returns {void}
     */
    _runCycle(rule, findings) {
        const nodeRows = this._selectMany(rule.nodes);
        const nodeKeyTemplate = requireString(
            rule.node_key ?? rule.key,
            "cycle rule needs `node_key`"
        );

        /** @type {Map<string, SelectorRow>} */
        const nodes = new Map();
        for (let i = 0, len = nodeRows.length; i < len; i++) {
            const row = nodeRows[i];
            const key = renderKey(nodeKeyTemplate, row.value, row.bindings);
            if (key !== null && !nodes.has(key)) {
                nodes.set(key, row);
            }
        }

        /** @type {Map<string, Set<string>>} */
        const adjacency = new Map();
        for (const key of nodes.keys()) {
            adjacency.set(key, new Set());
        }

        const edgeSpecifications = Array.isArray(rule.edges)
            ? rule.edges
            : [rule.edges];
        for (
            let i = 0, specificationCount = edgeSpecifications.length;
            i < specificationCount;
            i++
        ) {
            const raw = edgeSpecifications[i];
            if (!isPlainObject(raw)) {
                continue;
            }
            const specification = /** @type {Record<string, unknown>} */ (raw);
            const edgeRows = this._selectMany(
                specification.select ?? specification
            );
            const fromTemplate = requireString(
                specification.from,
                "cycle edge needs `from`"
            );
            const toTemplate = requireString(
                specification.to,
                "cycle edge needs `to`"
            );

            for (let j = 0, edgeCount = edgeRows.length; j < edgeCount; j++) {
                const row = edgeRows[j];
                const from = renderKey(fromTemplate, row.value, row.bindings);
                const to = renderKey(toTemplate, row.value, row.bindings);
                if (
                    from === null ||
                    to === null ||
                    !nodes.has(from) ||
                    !nodes.has(to)
                ) {
                    continue;
                }
                adjacency.get(from)?.add(to);
            }
        }

        const components = stronglyConnectedComponents(adjacency);
        const minimumSize = Number(rule.minimum_size ?? 2);
        const includeSelf = rule.include_self === true;

        for (let i = 0, len = components.length; i < len; i++) {
            const members = components[i];
            const selfCycle =
                members.length === 1 &&
                adjacency.get(members[0])?.has(members[0]) === true;
            if (
                members.length < minimumSize ||
                (members.length === 1 && (!includeSelf || !selfCycle))
            ) {
                continue;
            }
            findings.push(
                this._finding(rule, nodes.get(members[0]) ?? null, {
                    "#count": members.length,
                    "#members": members.join(", ")
                })
            );
        }
    }

    /**
     * @param {AssertionRule} rule
     * @returns {ReachAnalysis}
     */
    analyzeReach(rule) {
        const nodeRows = this._selectMany(rule.nodes);
        const nodeKeyTemplate = requireString(
            rule.node_key ?? rule.key,
            "reach rule needs `node_key`"
        );
        const tierOrder = arrayOfStrings(rule.tiers);
        const unreachableTier = String(rule.unreachable_tier ?? "dead");

        /** @type {Map<string, ReachNode>} */
        const nodes = new Map();
        /** @type {Map<string, string[]>} */
        const aliasIndex = new Map();
        /** @type {Map<string, string[]>} */
        const contextIndex = new Map();
        for (let i = 0, len = nodeRows.length; i < len; i++) {
            const row = nodeRows[i];
            const key = renderKey(nodeKeyTemplate, row.value, row.bindings);
            if (key === null || nodes.has(key)) {
                continue;
            }
            const aliases = uniqueStrings([
                key,
                ...resolveReachValues(rule.node_aliases, row)
            ]);
            const context = resolveReachValue(rule.node_context, row);
            nodes.set(key, {
                row,
                aliases,
                origin: resolveReachValue(rule.node_origin, row),
                group: resolveReachValue(rule.node_group, row),
                context
            });
            for (let j = 0, aliasCount = aliases.length; j < aliasCount; j++) {
                const alias = aliases[j];
                const indexed = aliasIndex.get(alias);
                if (indexed === undefined) {
                    aliasIndex.set(alias, [key]);
                } else {
                    indexed.push(key);
                }
            }
            const contexts = uniqueStrings(flattenReachValue(context));
            for (
                let j = 0, contextCount = contexts.length;
                j < contextCount;
                j++
            ) {
                const named = contextIndex.get(contexts[j]);
                if (named === undefined) {
                    contextIndex.set(contexts[j], [key]);
                } else {
                    named.push(key);
                }
            }
        }

        const aliasMatcher = createReachMatcher(Array.from(aliasIndex.keys()));
        const contextMatcher = createReachMatcher(
            Array.from(contextIndex.keys())
        );

        /** @type {Map<string, string>} */
        const reachedTiers = new Map();

        /**
         * @param {string[]} observedValues
         * @param {unknown} observedOrigin
         * @param {unknown} observedGroup
         * @param {Record<string, unknown>} specification
         * @param {string} tier
         * @returns {void}
         */
        const markReachObservation = (
            observedValues,
            observedOrigin,
            observedGroup,
            specification,
            tier
        ) => {
            const mode = String(specification.match ?? "exact");
            const boundary = String(specification.boundary ?? "identifier");

            if (mode === "exact") {
                for (
                    let i = 0, valueCount = observedValues.length;
                    i < valueCount;
                    i++
                ) {
                    const candidates = aliasIndex.get(observedValues[i]);
                    if (candidates === undefined) {
                        continue;
                    }
                    for (
                        let j = 0, candidateCount = candidates.length;
                        j < candidateCount;
                        j++
                    ) {
                        const key = candidates[j];
                        const node = nodes.get(key);
                        if (
                            node === undefined ||
                            !reachRelationMatches(
                                node.origin,
                                observedOrigin,
                                specification.exclude_same_origin === true,
                                specification.origin_relation
                            ) ||
                            !reachRelationMatches(
                                node.group,
                                observedGroup,
                                false,
                                specification.group_relation
                            )
                        ) {
                            continue;
                        }
                        assignReachTier(reachedTiers, key, tier, tierOrder);
                    }
                }
                return;
            }

            if (mode === "word") {
                const matchedAliases = matchReachTextValues(
                    observedValues,
                    aliasMatcher,
                    boundary
                );
                for (
                    let i = 0, aliasCount = matchedAliases.length;
                    i < aliasCount;
                    i++
                ) {
                    const candidates = aliasIndex.get(matchedAliases[i]);
                    if (candidates === undefined) {
                        continue;
                    }
                    for (
                        let j = 0, candidateCount = candidates.length;
                        j < candidateCount;
                        j++
                    ) {
                        const key = candidates[j];
                        const node = nodes.get(key);
                        if (
                            node === undefined ||
                            !reachRelationMatches(
                                node.origin,
                                observedOrigin,
                                specification.exclude_same_origin === true,
                                specification.origin_relation
                            ) ||
                            !reachRelationMatches(
                                node.group,
                                observedGroup,
                                false,
                                specification.group_relation
                            )
                        ) {
                            continue;
                        }
                        assignReachTier(reachedTiers, key, tier, tierOrder);
                    }
                }
                return;
            }

            if (mode !== "nearby") {
                throw new Error(`unknown reach match mode "${mode}"`);
            }

            const lines = splitReachLines(observedValues);
            /** @type {Map<string, number[]>} */
            const aliasLines = new Map();
            for (let i = 0, lineCount = lines.length; i < lineCount; i++) {
                const matchedAliases = matchReachText(
                    lines[i],
                    aliasMatcher,
                    boundary
                );
                for (
                    let j = 0, aliasCount = matchedAliases.length;
                    j < aliasCount;
                    j++
                ) {
                    const candidates = aliasIndex.get(matchedAliases[j]);
                    if (candidates === undefined) {
                        continue;
                    }
                    for (
                        let candidateIndex = 0,
                            candidateCount = candidates.length;
                        candidateIndex < candidateCount;
                        candidateIndex++
                    ) {
                        const key = candidates[candidateIndex];
                        const node = nodes.get(key);
                        if (
                            node === undefined ||
                            !reachRelationMatches(
                                node.origin,
                                observedOrigin,
                                specification.exclude_same_origin === true,
                                specification.origin_relation
                            ) ||
                            !reachRelationMatches(
                                node.group,
                                observedGroup,
                                false,
                                specification.group_relation
                            )
                        ) {
                            continue;
                        }
                        appendReachLine(aliasLines, key, i);
                    }
                }
            }

            if (aliasLines.size === 0) {
                return;
            }

            /** @type {Map<string, number[]>} */
            const contextLines = new Map();
            for (let i = 0, lineCount = lines.length; i < lineCount; i++) {
                const matchedContexts = matchReachText(
                    lines[i],
                    contextMatcher,
                    boundary
                );
                for (
                    let j = 0, contextCount = matchedContexts.length;
                    j < contextCount;
                    j++
                ) {
                    const candidates = contextIndex.get(matchedContexts[j]);
                    if (candidates === undefined) {
                        continue;
                    }
                    for (
                        let candidateIndex = 0,
                            candidateCount = candidates.length;
                        candidateIndex < candidateCount;
                        candidateIndex++
                    ) {
                        const key = candidates[candidateIndex];
                        if (!aliasLines.has(key)) {
                            continue;
                        }
                        appendReachLine(contextLines, key, i);
                    }
                }
            }

            const window = Math.max(0, Number(specification.window ?? 0));
            const candidates = Array.from(aliasLines.entries());
            for (
                let i = 0, candidateCount = candidates.length;
                i < candidateCount;
                i++
            ) {
                const [key, matchedAliasLines] = candidates[i];
                const node = nodes.get(key);
                if (node === undefined) {
                    continue;
                }
                const contexts = flattenReachValue(node.context);
                if (
                    contexts.length === 0 ||
                    reachLinesWithinWindow(
                        matchedAliasLines,
                        contextLines.get(key) ?? [],
                        window
                    )
                ) {
                    assignReachTier(reachedTiers, key, tier, tierOrder);
                }
            }
        };

        const edgeSpecifications = Array.isArray(rule.edges)
            ? rule.edges
            : rule.edges === undefined
            ? []
            : [rule.edges];

        for (
            let i = 0, specificationCount = edgeSpecifications.length;
            i < specificationCount;
            i++
        ) {
            const raw = edgeSpecifications[i];
            if (!isPlainObject(raw)) {
                continue;
            }
            const specification = /** @type {Record<string, unknown>} */ (raw);
            const edgeRows = this._selectMany(
                specification.select ?? specification
            );
            const tier = String(specification.tier ?? "reached");

            if (specification.key !== undefined) {
                const keyTemplate = requireString(
                    specification.key,
                    "reach edge needs `key`"
                );
                const fromTemplate =
                    typeof specification.from === "string"
                        ? specification.from
                        : null;
                for (let j = 0, count = edgeRows.length; j < count; j++) {
                    const row = edgeRows[j];
                    const target = renderKey(
                        keyTemplate,
                        row.value,
                        row.bindings
                    );
                    if (target === null || !nodes.has(target)) {
                        continue;
                    }
                    if (fromTemplate !== null) {
                        const origin = renderKey(
                            fromTemplate,
                            row.value,
                            row.bindings
                        );
                        if (origin !== null && origin === target) {
                            continue;
                        }
                    }
                    assignReachTier(reachedTiers, target, tier, tierOrder);
                }
                continue;
            }

            for (let j = 0, count = edgeRows.length; j < count; j++) {
                const row = edgeRows[j];
                const observedValues = resolveReachValues(
                    specification.value ?? "{#value}",
                    row
                );
                const observedOrigin = resolveReachValue(
                    specification.origin,
                    row
                );
                const observedGroup = resolveReachValue(
                    specification.group,
                    row
                );

                markReachObservation(
                    observedValues,
                    observedOrigin,
                    observedGroup,
                    specification,
                    tier
                );
            }
        }

        const propagationSpecifications = Array.isArray(rule.propagations)
            ? rule.propagations
            : rule.propagations === undefined
            ? []
            : [rule.propagations];
        for (
            let i = 0, specificationCount = propagationSpecifications.length;
            i < specificationCount;
            i++
        ) {
            const raw = propagationSpecifications[i];
            if (!isPlainObject(raw)) {
                continue;
            }
            const specification = /** @type {Record<string, unknown>} */ (raw);
            const declarations = this._selectMany(specification.declarations);
            const activations = this._selectMany(specification.activations);
            const tier = String(specification.tier ?? "reached");

            /** @type {{ row: SelectorRow, names: string[], origin: unknown }[]} */
            const declarationMetadata = [];
            /** @type {Map<string, number[]>} */
            const declarationNameIndex = new Map();
            for (
                let j = 0, declarationCount = declarations.length;
                j < declarationCount;
                j++
            ) {
                const declaration = declarations[j];
                const names = uniqueStrings(
                    resolveReachValues(
                        specification.name ?? "{#value}",
                        declaration
                    )
                );
                if (names.length === 0) {
                    continue;
                }
                const metadataIndex = declarationMetadata.length;
                declarationMetadata.push({
                    row: declaration,
                    names,
                    origin: resolveReachValue(specification.origin, declaration)
                });
                for (let k = 0, nameCount = names.length; k < nameCount; k++) {
                    const indexed = declarationNameIndex.get(names[k]);
                    if (indexed === undefined) {
                        declarationNameIndex.set(names[k], [metadataIndex]);
                    } else {
                        indexed.push(metadataIndex);
                    }
                }
            }

            const declarationNameMatcher = createReachMatcher(
                Array.from(declarationNameIndex.keys())
            );
            const boundary = String(specification.boundary ?? "identifier");
            const activated = new Set();
            for (
                let j = 0, activationCount = activations.length;
                j < activationCount;
                j++
            ) {
                const activation = activations[j];
                const activationOrigin = resolveReachValue(
                    specification.activation_origin,
                    activation
                );
                const activationTexts = resolveReachValues(
                    specification.activation_text ?? "{#value}",
                    activation
                );
                const matchedNames = matchReachTextValues(
                    activationTexts,
                    declarationNameMatcher,
                    boundary
                );
                for (
                    let k = 0, nameCount = matchedNames.length;
                    k < nameCount;
                    k++
                ) {
                    const candidateDeclarations = declarationNameIndex.get(
                        matchedNames[k]
                    );
                    if (candidateDeclarations === undefined) {
                        continue;
                    }
                    for (
                        let candidateIndex = 0,
                            candidateCount = candidateDeclarations.length;
                        candidateIndex < candidateCount;
                        candidateIndex++
                    ) {
                        const metadataIndex =
                            candidateDeclarations[candidateIndex];
                        const metadata = declarationMetadata[metadataIndex];
                        if (
                            !reachRelationMatches(
                                metadata.origin,
                                activationOrigin,
                                specification.exclude_same_origin === true,
                                specification.origin_relation
                            )
                        ) {
                            continue;
                        }
                        activated.add(metadataIndex);
                    }
                }
            }

            const activatedDeclarations = Array.from(activated);
            for (
                let j = 0, activatedCount = activatedDeclarations.length;
                j < activatedCount;
                j++
            ) {
                const metadata = declarationMetadata[activatedDeclarations[j]];
                const values = resolveReachValues(
                    specification.values ?? "{#value}",
                    metadata.row
                );
                markReachObservation(
                    values,
                    null,
                    null,
                    {
                        match: specification.match ?? "exact",
                        boundary: specification.boundary,
                        window: specification.window
                    },
                    tier
                );
            }
        }

        const baseline = this._loadBaseline(rule);
        /** @type {ReachRow[]} */
        const rows = [];
        for (const [key, node] of nodes) {
            const tier = reachedTiers.get(key) ?? unreachableTier;
            rows.push({
                key,
                reached: reachedTiers.has(key),
                tier,
                node
            });
        }
        return { rows, baseline };
    }

    /**
     * @param {AssertionRule} rule
     * @param {AssertionFinding[]} findings
     * @returns {void}
     */
    _runReach(rule, findings) {
        const analysis = this.analyzeReach(rule);
        /** @type {Map<string, { key: string, reached: boolean, tier: string, node: { row: SelectorRow } }>} */
        const nodes = new Map();
        for (let i = 0, len = analysis.rows.length; i < len; i++) {
            nodes.set(analysis.rows[i].key, analysis.rows[i]);
        }

        for (let i = 0, len = analysis.rows.length; i < len; i++) {
            const subject = analysis.rows[i];
            if (subject.reached) {
                continue;
            }

            const entry = analysis.baseline.entries.get(subject.key);
            if (entry === undefined) {
                findings.push(
                    this._finding(rule, subject.node.row, {
                        "#key": subject.key,
                        "#tier": subject.tier,
                        "#baseline": analysis.baseline.file ?? "<none>"
                    })
                );
                continue;
            }

            if (
                analysis.baseline.categories.length > 0 &&
                !analysis.baseline.categories.includes(
                    String(entry.category ?? "")
                )
            ) {
                findings.push({
                    severity: this._severity(rule),
                    code: `${rule.id}/CATEGORY`,
                    rule: rule.id,
                    file: analysis.baseline.file,
                    path: subject.key,
                    message: `baseline entry "${subject.key}" carries ${
                        entry.category === undefined
                            ? "no category"
                            : `category "${String(entry.category)}"`
                    }; an uncategorised exemption reads as accepted and names no edit that would remove it`
                });
            }
        }

        for (const [key] of analysis.baseline.entries) {
            const subject = nodes.get(key);
            if (subject === undefined || subject.reached) {
                findings.push({
                    severity: this._severity(rule),
                    code: `${rule.id}/STALE`,
                    rule: rule.id,
                    file: analysis.baseline.file,
                    path: key,
                    message: `baseline still exempts "${key}", which is now reached or gone; a stale exemption re-accepts the next regression under the same name`
                });
            }
        }
    }

    /**
     * @param {AssertionRule} rule
     * @param {AssertionFinding[]} findings
     * @returns {void}
     */
    _runDecode(rule, findings) {
        const layoutRows = this._select(rule.layouts);
        const layoutKeyTemplate = requireString(
            rule.layout_key,
            "decode rule needs `layout_key`"
        );

        /** @type {Map<string, SelectorRow>} */
        const layouts = new Map();
        for (let i = 0, len = layoutRows.length; i < len; i++) {
            const row = layoutRows[i];
            const key = renderKey(layoutKeyTemplate, row.value, row.bindings);
            if (key === null) {
                continue;
            }
            layouts.set(key, row);
        }

        const vectorRows = this._select(rule.vectors);
        const vectorLayoutTemplate = requireString(
            rule.vector_layout_key,
            "decode rule needs `vector_layout_key`"
        );
        const hexPath = requireString(rule.hex, "decode rule needs `hex`");
        const claimsPath = requireString(
            rule.claims,
            "decode rule needs `claims`"
        );

        const fieldsPath = String(rule.layout_fields ?? "$.members[*]");
        const fieldName = String(rule.field_name ?? "$.name");
        const fieldOffset = String(rule.field_offset ?? "$.offset");
        const fieldWidth = String(rule.field_width ?? "$.width");
        const fieldEncoding = String(rule.field_encoding ?? "$.encoding");
        const fieldConst = String(rule.field_const ?? "$.value");

        for (let i = 0, len = vectorRows.length; i < len; i++) {
            const row = vectorRows[i];
            const layoutKey = renderKey(
                vectorLayoutTemplate,
                row.value,
                row.bindings
            );
            if (layoutKey === null) {
                continue;
            }

            const layoutRow = layouts.get(layoutKey);
            if (layoutRow === undefined) {
                findings.push(
                    this._finding(rule, row, {
                        "#key": layoutKey,
                        "#detail": "names no declared layout"
                    })
                );
                continue;
            }

            const hex = evaluatePathValues(row.value, hexPath)[0];
            if (typeof hex !== "string") {
                continue;
            }

            const result = decodeLayout({
                hex,
                layout: layoutRow.value,
                fieldsPath,
                fieldName,
                fieldOffset,
                fieldWidth,
                fieldEncoding,
                fieldConst
            });

            if (result.error !== null) {
                findings.push(
                    this._finding(rule, row, {
                        "#key": layoutKey,
                        "#detail": result.error
                    })
                );
                continue;
            }

            // A layout member pinned to a value is checked first, and against
            // every fixture. This is the family that survives a fixture set
            // going stale: the layout states the constant, the bytes state it
            // again, and neither is read by the other.
            const constantNames = Object.keys(result.constants);
            for (let j = 0, count = constantNames.length; j < count; j++) {
                const name = constantNames[j];
                if (looseEqual(result.fields[name], result.constants[name])) {
                    continue;
                }
                findings.push(
                    this._finding(rule, row, {
                        "#key": layoutKey,
                        "#detail": `bytes put ${stringifyValue(
                            result.fields[name]
                        )} in "${name}", which the layout pins to ${stringifyValue(
                            result.constants[name]
                        )}`
                    })
                );
            }

            const claims = evaluatePathValues(row.value, claimsPath)[0];
            if (!isPlainObject(claims)) {
                continue;
            }

            // A fixture's expectation block carries derived facts alongside the
            // fields - a total length, a decode disposition - and those are not
            // claims about this layout. Only the names the layout declares are
            // checked; `strict_claims` turns the rest into findings for a
            // fixture set that is meant to be exhaustive.
            const claimed = /** @type {Record<string, unknown>} */ (claims);
            const names = Object.keys(claimed);
            const strict = rule.strict_claims === true;

            for (let j = 0, count = names.length; j < count; j++) {
                const name = names[j];
                if (
                    !Object.prototype.hasOwnProperty.call(result.fields, name)
                ) {
                    if (strict) {
                        findings.push(
                            this._finding(rule, row, {
                                "#key": layoutKey,
                                "#detail": `claims field "${name}", which "${layoutKey}" does not declare`
                            })
                        );
                    }
                    continue;
                }

                if (looseEqual(result.fields[name], claimed[name])) {
                    continue;
                }

                findings.push(
                    this._finding(rule, row, {
                        "#key": layoutKey,
                        "#detail": `field "${name}" decodes to ${stringifyValue(
                            result.fields[name]
                        )}, the fixture claims ${stringifyValue(claimed[name])}`
                    })
                );
            }
        }
    }

    /**
     * Require repository-relative paths selected from declarations to resolve.
     *
     * @param {AssertionRule} rule
     * @param {AssertionFinding[]} findings
     * @returns {void}
     */
    _runPath(rule, findings) {
        const rows = this._selectMany(rule.select ?? rule.scope);
        const template = requireString(
            rule.value ?? rule.path_value,
            "path rule needs `value`"
        );
        const expected = String(rule.path_kind ?? "any");

        for (let i = 0, len = rows.length; i < len; i++) {
            const row = rows[i];
            const rendered = renderKey(template, row.value, row.bindings);
            if (rendered === null) continue;
            const absolute = containedRepositoryPath(this.index.root, rendered);
            let matches = false;
            if (absolute !== null && existsSync(absolute)) {
                const stats = statSync(absolute);
                matches =
                    expected === "any" ||
                    (expected === "file" && stats.isFile()) ||
                    (expected === "directory" && stats.isDirectory());
            }
            if (matches) continue;
            findings.push(
                this._finding(rule, row, {
                    "#target": rendered,
                    "#expected_kind": expected
                })
            );
        }
    }

    /**
     * @param {AssertionRule} rule
     * @param {AssertionFinding[]} findings
     * @returns {void}
     */
    _runFormat(rule, findings) {
        const formatter = String(rule.formatter ?? "");
        if (formatter !== "yaml_flow_mapping_spacing") {
            throw new Error(`unknown formatter "${formatter}"`);
        }
        const units = this.index.resolveSource(
            this._sourceDefinition(rule.source)
        );
        this._countSelection(units.length, units.length);

        for (let i = 0, len = units.length; i < len; i++) {
            const unit = units[i];
            const analysis = analyzeYamlFlowMappingSpacing(unit.text, {
                lineBudget: Number(rule.line_budget ?? 200),
                filename: unit.file
            });
            if (analysis.accepted.length === 0) {
                continue;
            }
            const lineNumbers = analysis.accepted.map((line) => line + 1);
            const omitted = Math.max(
                0,
                analysis.candidates.length - analysis.accepted.length
            );
            const row = {
                unit,
                match: {
                    path: "$",
                    value: unit.data,
                    parent: null,
                    key: null
                },
                value: unit.data,
                bindings: Object.assign({}, CorpusIndex.bindingsFor(unit), {
                    "#path": "$",
                    "#document": unit.data,
                    "#value": unit.data
                })
            };
            findings.push(
                this._finding(rule, row, {
                    "#lines": lineNumbers.join(", "),
                    "#remainder": omitted === 0 ? "" : ` and ${omitted} more`
                })
            );
        }
    }

    /**
     * Validate an embedded language and, optionally, resolve identifier tokens
     * against corpus declarations.
     *
     * @param {AssertionRule} rule
     * @param {AssertionFinding[]} findings
     * @returns {void}
     */
    _runLex(rule, findings) {
        const rows = this._selectMany(rule.select ?? rule.scope);
        const language = this._languageDefinition(rule.language);
        const syntax = rule.syntax !== false;
        const checkReferences = rule.defines !== undefined;
        const roles = new Set(
            arrayOfStrings(rule.reference_roles ?? ["reference"])
        );
        const ignored = new Set(arrayOfStrings(rule.ignore));
        const ignorePattern =
            rule.ignore_pattern === undefined
                ? null
                : new RegExp(String(rule.ignore_pattern));
        const sourcePath = String(rule.value_path ?? "$");

        /** @type {Map<string, Set<string>>} */
        const definitions = new Map();
        let definitionCount = 0;
        if (checkReferences) {
            const definitionRows = this._selectMany(rule.defines);
            definitionCount = definitionRows.length;
            const defineKey = requireString(
                rule.define_key ?? "{#value}",
                "lex rule definitions need `define_key`"
            );
            const defineScope = rule.define_scope ?? null;
            for (let i = 0, len = definitionRows.length; i < len; i++) {
                const row = definitionRows[i];
                const key = renderKey(defineKey, row.value, row.bindings);
                if (key === null) continue;
                const scope =
                    defineScope === null
                        ? ""
                        : renderKey(defineScope, row.value, row.bindings) ?? "";
                const bucket = definitions.get(scope);
                if (bucket === undefined)
                    definitions.set(scope, new Set([key]));
                else bucket.add(key);
            }
            this.resolveCounts.set(rule.id, {
                uses: rows.length,
                defines: definitionCount
            });
        }

        for (let i = 0, len = rows.length; i < len; i++) {
            const row = rows[i];
            const selected = evaluatePathValues(row.value, sourcePath);
            if (selected.length === 0) continue;
            const source = String(selected[0] ?? "");
            const result = lexEmbeddedLanguage(source, language);

            if (syntax) {
                const maximum = Number(rule.max_syntax_findings ?? 8);
                for (
                    let j = 0, count = Math.min(result.errors.length, maximum);
                    j < count;
                    j++
                ) {
                    const error = result.errors[j];
                    findings.push(
                        this._finding(rule, row, {
                            "#detail": error.message,
                            "#offset": error.index,
                            "#expression": source
                        })
                    );
                }
            }

            if (!checkReferences) continue;
            const useScope =
                rule.use_scope === undefined
                    ? ""
                    : renderKey(rule.use_scope, row.value, row.bindings) ?? "";
            const scoped = definitions.get(useScope);
            const global = definitions.get("");
            const seen = new Set();
            for (let j = 0, count = result.tokens.length; j < count; j++) {
                const token = result.tokens[j];
                if (
                    token.kind !== "identifier" ||
                    !roles.has(token.role ?? "")
                ) {
                    continue;
                }
                const key = token.text;
                if (seen.has(key)) continue;
                seen.add(key);
                if (ignored.has(key)) continue;
                if (ignorePattern !== null && ignorePattern.test(key)) continue;
                if (scoped?.has(key) || global?.has(key)) continue;
                findings.push(
                    this._finding(rule, row, {
                        "#detail": `unresolved ${
                            token.role ?? "identifier"
                        } '${key}'`,
                        "#token": key,
                        "#offset": token.start,
                        "#expression": source,
                        "#scope": useScope
                    })
                );
            }
        }
    }

    /**
     * @param {AssertionRule} rule
     * @param {AssertionFinding[]} findings
     * @returns {void}
     */
    _runDigest(rule, findings) {
        const manifestUnits = this.index.resolveSource(
            this._sourceDefinition(rule.manifest)
        );
        if (manifestUnits.length === 0) {
            findings.push({
                severity: this._severity(rule),
                code: rule.id,
                rule: rule.id,
                file: null,
                path: null,
                message: "no manifest document resolved"
            });
            this._countSelection(0, 0);
            return;
        }
        if (manifestUnits.length > 1) {
            findings.push({
                severity: this._severity(rule),
                code: `${rule.id}/MULTIPLE`,
                rule: rule.id,
                file: manifestUnits[0].file,
                path: null,
                message: `manifest source resolved ${manifestUnits.length} documents; a commitment has one authoritative root`
            });
        }

        const entryPath = String(rule.entries ?? "$.files[*]");
        const pathTemplate = String(rule.entry_path ?? "{$.path}");
        const digestTemplate = String(rule.entry_digest ?? "{$.sha256}");
        const algorithm = String(rule.algorithm ?? "sha256");
        const tracked = this.index.resolveSource(
            this._sourceDefinition(rule.tracks)
        );
        const actualEntries = buildDigestEntries(tracked, algorithm);
        const actual = new Map(
            actualEntries.map((entry) => [entry.path, entry])
        );

        const manifest = manifestUnits[0];
        const entries = evaluatePath(manifest.data, entryPath);
        this._countSelection(
            entries.length,
            tracked.length + manifestUnits.length
        );

        /** @type {Set<string>} */
        const seen = new Set();
        let previousPath = null;
        const requireSorted = rule.sorted !== false;

        for (let i = 0, len = entries.length; i < len; i++) {
            const entry = entries[i];
            const bindings = CorpusIndex.bindingsFor(manifest);
            const file = renderKey(pathTemplate, entry.value, bindings);
            const digest = renderKey(digestTemplate, entry.value, bindings);

            if (file === null || file.length === 0) {
                findings.push({
                    severity: this._severity(rule),
                    code: `${rule.id}/PATH`,
                    rule: rule.id,
                    file: manifest.file,
                    path: entry.path,
                    message: "manifest entry carries no path"
                });
                continue;
            }
            if (seen.has(file)) {
                findings.push({
                    severity: this._severity(rule),
                    code: `${rule.id}/DUPLICATE`,
                    rule: rule.id,
                    file: manifest.file,
                    path: entry.path,
                    message: `manifest lists "${file}" more than once`
                });
            }
            seen.add(file);

            if (
                requireSorted &&
                previousPath !== null &&
                previousPath >= file
            ) {
                findings.push({
                    severity: this._severity(rule),
                    code: `${rule.id}/ORDER`,
                    rule: rule.id,
                    file: manifest.file,
                    path: entry.path,
                    message: `manifest path "${file}" is not strictly ordered after "${previousPath}"`
                });
            }
            previousPath = file;

            const observed = actual.get(file);
            if (observed === undefined) {
                findings.push({
                    severity: this._severity(rule),
                    code: `${rule.id}/MISSING`,
                    rule: rule.id,
                    file: manifest.file,
                    path: entry.path,
                    message: `manifest names "${file}", which the tree does not carry`
                });
                continue;
            }
            if (digest === null || hexToBytes(digest) === null) {
                findings.push({
                    severity: this._severity(rule),
                    code: `${rule.id}/DIGEST`,
                    rule: rule.id,
                    file: manifest.file,
                    path: entry.path,
                    message: `manifest digest for "${file}" is absent or not even-length hexadecimal`
                });
                continue;
            }
            if (digest.toLowerCase() !== observed.digest) {
                findings.push({
                    severity: this._severity(rule),
                    code: `${rule.id}/DRIFT`,
                    rule: rule.id,
                    file: manifest.file,
                    path: entry.path,
                    message: `manifest digest for "${file}" is ${digest.slice(
                        0,
                        12
                    )}…, the tree hashes to ${observed.digest.slice(0, 12)}…`
                });
            }
        }

        for (let i = 0, len = actualEntries.length; i < len; i++) {
            const file = actualEntries[i].path;
            if (seen.has(file)) continue;
            findings.push({
                severity: this._severity(rule),
                code: `${rule.id}/UNLISTED`,
                rule: rule.id,
                file: manifest.file,
                path: null,
                message: `"${file}" is in the tree and absent from the manifest`
            });
        }

        if (rule.count_path !== undefined) {
            const declared = evaluatePathValues(
                manifest.data,
                String(rule.count_path)
            )[0];
            const count = coerceNumber(declared);
            if (count === null || count !== actualEntries.length) {
                findings.push({
                    severity: this._severity(rule),
                    code: `${rule.id}/COUNT`,
                    rule: rule.id,
                    file: manifest.file,
                    path: String(rule.count_path),
                    message: `manifest file count is ${String(
                        declared
                    )}; the tracked tree contains ${actualEntries.length}`
                });
            }
        }

        if (rule.root_path !== undefined) {
            const declared = evaluatePathValues(
                manifest.data,
                String(rule.root_path)
            )[0];
            const commitment = isPlainObject(rule.commitment)
                ? Object.assign({}, rule.commitment, {
                      algorithm: String(
                          /** @type {Record<string, unknown>} */ (
                              rule.commitment
                          ).algorithm ?? algorithm
                      )
                  })
                : { algorithm };
            let observed;
            try {
                observed = computeDigestCommitment(actualEntries, commitment);
            } catch (error) {
                findings.push({
                    severity: this._severity(rule),
                    code: `${rule.id}/CONFIG`,
                    rule: rule.id,
                    file: rule.source_pack ?? null,
                    path: null,
                    message:
                        error instanceof Error ? error.message : String(error)
                });
                return;
            }
            if (
                typeof declared !== "string" ||
                declared.toLowerCase() !== observed
            ) {
                findings.push({
                    severity: this._severity(rule),
                    code: `${rule.id}/ROOT`,
                    rule: rule.id,
                    file: manifest.file,
                    path: String(rule.root_path),
                    message: `manifest root is ${String(declared).slice(
                        0,
                        12
                    )}…, the tracked tree commits to ${observed.slice(0, 12)}…`
                });
            }
        }
    }

    // =========================================================================
    // Selection
    // =========================================================================

    /**
     * Select over one selector or a list of them.
     *
     * A symbol reaches the corpus through more than one shape - a record is
     * declared by its META and named by the registry; a type is used by a
     * `type:` and by a `reference:` - and a rule that admits only one shape
     * reports every declaration made in the other as dangling.
     *
     * @param {unknown} selector
     * @returns {SelectorRow[]}
     */
    _selectMany(selector) {
        if (typeof selector === "string") {
            const named = this.pack.selectors[selector];
            if (named === undefined) {
                throw new Error(`unknown selector "${selector}"`);
            }
            if (Array.isArray(named)) {
                return this._selectMany(named);
            }
        }

        if (!Array.isArray(selector)) {
            return this._select(selector);
        }

        /** @type {SelectorRow[]} */
        const rows = [];
        for (let i = 0, len = selector.length; i < len; i++) {
            const part = this._selectMany(selector[i]);
            for (let j = 0, count = part.length; j < count; j++) {
                rows.push(part[j]);
            }
        }
        return rows;
    }

    /**
     * @param {unknown} selector
     * @returns {SelectorRow[]}
     */
    _select(selector) {
        const resolved = this._resolveSelector(selector);
        const cacheKey = JSON.stringify(resolved);
        const cached = this._selectorCache.get(cacheKey);
        if (cached !== undefined) {
            this._countSelection(
                cached.length,
                this._scopeCache.get(cacheKey) ?? 0
            );
            return cached;
        }

        const units = this.index.resolveSource(
            this._sourceDefinition(resolved.source)
        );
        const tableNames = arrayOfStrings(resolved.with_tables);
        const tableBindings =
            tableNames.length === 0 ? {} : this._resolveTables(tableNames);

        /** @type {SelectorRow[]} */
        const rows = [];
        const pathExpression = resolved.path ?? "$";
        let scanned = 0;

        for (let i = 0, len = units.length; i < len; i++) {
            const unit = units[i];
            const bindings = Object.assign(
                {},
                tableBindings,
                CorpusIndex.bindingsFor(unit)
            );

            if (
                resolved.unit_where !== undefined &&
                !evaluatePredicate(resolved.unit_where, unit.data, bindings)
            ) {
                continue;
            }

            const matches = evaluateSelectorPath(unit.data, pathExpression);
            scanned += matches.length;

            for (let j = 0, count = matches.length; j < count; j++) {
                const match = matches[j];

                const rowBindings = Object.assign({}, bindings, {
                    "#path": match.path,
                    "#parent": match.parent,
                    "#key": match.key === null ? "" : String(match.key),
                    "#value": match.value,
                    "#document": unit.data
                });

                if (
                    resolved.where !== undefined &&
                    !evaluatePredicate(resolved.where, match.value, rowBindings)
                ) {
                    continue;
                }

                // `each` narrows a second time, from a scope to its children.
                // Some conditions are properties of the scope - whether an enum
                // is a dense ordinal registry at all - and cannot be decided
                // from a child. Selecting the scope, filtering it, and only then
                // descending is what lets one rule carry both.
                if (resolved.each === undefined) {
                    this._appendSelectionRows(
                        resolved,
                        {
                            unit,
                            match,
                            value: match.value,
                            bindings: rowBindings
                        },
                        rows
                    );
                    continue;
                }

                const children = evaluateSelectorPath(
                    match.value,
                    resolved.each,
                    match.path
                );
                scanned += children.length;

                // A child often has to be identified by something only its
                // scope carries - a member's ordinal means nothing without the
                // enum it belongs to - and the scope is gone by the time a key
                // template runs. `scope_key` renders against the scope and
                // travels with every child as `#scope_key`.
                const scopeKey =
                    typeof resolved.scope_key === "string"
                        ? renderKey(
                              resolved.scope_key,
                              match.value,
                              rowBindings
                          )
                        : null;

                for (
                    let k = 0, childCount = children.length;
                    k < childCount;
                    k++
                ) {
                    const child = children[k];
                    const childBindings = Object.assign({}, bindings, {
                        "#path": child.path,
                        "#scope_path": match.path,
                        "#scope_key": scopeKey ?? "",
                        "#scope_value": match.value,
                        "#parent": child.parent,
                        "#key": child.key === null ? "" : String(child.key),
                        "#value": child.value,
                        "#document": unit.data
                    });

                    if (
                        resolved.each_where !== undefined &&
                        !evaluatePredicate(
                            resolved.each_where,
                            child.value,
                            childBindings
                        )
                    ) {
                        continue;
                    }

                    this._appendSelectionRows(
                        resolved,
                        {
                            unit,
                            match: child,
                            value: child.value,
                            bindings: childBindings
                        },
                        rows
                    );
                }
            }
        }

        this._selectorCache.set(cacheKey, rows);
        this._scopeCache.set(cacheKey, scanned);
        this._countSelection(rows.length, scanned);
        return rows;
    }

    /**
     * Apply selector bindings, regular-expression extraction, projection, and
     * post-selection predicates to one structural row.
     *
     * @param {Record<string, any>} selector
     * @param {SelectorRow} row
     * @param {SelectorRow[]} out
     * @returns {void}
     */
    _appendSelectionRows(selector, row, out) {
        const bound = this._bindSelectorRow(selector.bind, row);
        const expanded = this._expandSelectorRows(selector.expand, bound);
        /** @type {SelectorRow[]} */
        const extracted = [];
        for (let i = 0, len = expanded.length; i < len; i++) {
            const rows = this._extractSelectorRows(
                selector.extract,
                expanded[i]
            );
            for (let j = 0, count = rows.length; j < count; j++) {
                extracted.push(rows[j]);
            }
        }
        /** @type {SelectorRow[]} */
        const transformed = [];
        for (let i = 0, len = extracted.length; i < len; i++) {
            const lexical = this._lexSelectorRows(selector.lex, extracted[i]);
            for (let j = 0, count = lexical.length; j < count; j++) {
                transformed.push(lexical[j]);
            }
        }

        for (let i = 0, len = transformed.length; i < len; i++) {
            let candidate = transformed[i];
            if (
                selector.post_where !== undefined &&
                !evaluatePredicate(
                    selector.post_where,
                    candidate.value,
                    candidate.bindings
                )
            ) {
                continue;
            }

            if (selector.project !== undefined) {
                const projected = resolveSelectorProjection(
                    selector.project,
                    candidate
                );
                candidate = {
                    unit: candidate.unit,
                    match: candidate.match,
                    value: projected,
                    bindings: Object.assign({}, candidate.bindings, {
                        "#value": projected
                    })
                };
            }
            out.push(candidate);
        }
    }

    /**
     * @param {unknown} bindSpec
     * @param {SelectorRow} row
     * @returns {SelectorRow}
     */
    /**
     * Expand one structural row across one or more bound lists. Expansion is
     * a declarative cross product: each mapping key becomes a binding on every
     * emitted row. Scalars produce one row, arrays produce one row per item,
     * and an empty or absent value produces no row.
     *
     * @param {unknown} expandSpec
     * @param {SelectorRow} row
     * @returns {SelectorRow[]}
     */
    _expandSelectorRows(expandSpec, row) {
        if (!isPlainObject(expandSpec)) {
            return [row];
        }

        let rows = [row];
        const names = Object.keys(
            /** @type {Record<string, unknown>} */ (expandSpec)
        );
        for (let i = 0, len = names.length; i < len; i++) {
            const name = names[i];
            /** @type {SelectorRow[]} */
            const next = [];
            for (let j = 0, count = rows.length; j < count; j++) {
                const candidate = rows[j];
                const resolved = resolveSelectorValue(
                    /** @type {Record<string, unknown>} */ (expandSpec)[name],
                    candidate,
                    candidate.bindings
                );
                const values = Array.isArray(resolved)
                    ? resolved
                    : resolved === null || resolved === undefined
                    ? []
                    : [resolved];
                for (
                    let k = 0, valueCount = values.length;
                    k < valueCount;
                    k++
                ) {
                    const bindings = Object.assign({}, candidate.bindings, {
                        [name]: values[k],
                        [`#${name}`]: values[k],
                        [`#${name}_index`]: k
                    });
                    next.push({
                        unit: candidate.unit,
                        match: candidate.match,
                        value: candidate.value,
                        bindings
                    });
                }
            }
            rows = next;
            if (rows.length === 0) break;
        }
        return rows;
    }

    _bindSelectorRow(bindSpec, row) {
        if (!isPlainObject(bindSpec)) {
            return row;
        }

        const bindings = Object.assign({}, row.bindings);
        const names = Object.keys(
            /** @type {Record<string, unknown>} */ (bindSpec)
        );
        for (let i = 0, len = names.length; i < len; i++) {
            const name = names[i];
            const resolved = resolveSelectorValue(
                /** @type {Record<string, unknown>} */ (bindSpec)[name],
                row,
                bindings
            );
            bindings[name] = resolved;
            bindings[`#${name}`] = resolved;
        }

        return {
            unit: row.unit,
            match: row.match,
            value: row.value,
            bindings
        };
    }

    /**
     * @param {unknown} lexSpec
     * @param {SelectorRow} row
     * @returns {SelectorRow[]}
     */
    _lexSelectorRows(lexSpec, row) {
        if (lexSpec === undefined || lexSpec === null) return [row];
        const spec =
            typeof lexSpec === "string"
                ? { language: lexSpec }
                : isPlainObject(lexSpec)
                ? /** @type {Record<string, any>} */ (lexSpec)
                : null;
        if (spec === null) {
            throw new Error(
                "selector lex must name a language or be a mapping"
            );
        }
        const language = this._languageDefinition(spec.language ?? spec);
        const from =
            spec.from === undefined
                ? row.value
                : resolveSelectorValue(spec.from, row, row.bindings);
        const source = String(from ?? "");
        const result = lexEmbeddedLanguage(source, language);
        const kinds = new Set(arrayOfStrings(spec.kinds ?? ["identifier"]));
        const roles = new Set(arrayOfStrings(spec.roles));
        /** @type {SelectorRow[]} */
        const out = [];
        let ordinal = 0;
        for (let i = 0, len = result.tokens.length; i < len; i++) {
            const token = result.tokens[i];
            if (!kinds.has(token.kind)) continue;
            if (roles.size > 0 && !roles.has(token.role ?? "")) continue;
            const value =
                spec.emit === "object"
                    ? {
                          text: token.text,
                          kind: token.kind,
                          role: token.role,
                          start: token.start,
                          end: token.end
                      }
                    : token.text;
            const path = `${row.match.path}#token[${ordinal}]`;
            const bindings = Object.assign({}, row.bindings, {
                "#path": path,
                "#key": String(ordinal),
                "#value": value,
                "#token": token.text,
                "#token_kind": token.kind,
                "#token_role": token.role ?? "",
                "#token_start": token.start,
                "#token_end": token.end,
                "#expression": source
            });
            out.push({
                unit: row.unit,
                match: {
                    path,
                    value,
                    parent: row.value,
                    key: ordinal
                },
                value,
                bindings
            });
            ordinal += 1;
        }
        return out;
    }

    /**
     * @param {unknown} extractSpec
     * @param {SelectorRow} row
     * @returns {SelectorRow[]}
     */
    _extractSelectorRows(extractSpec, row) {
        if (extractSpec === undefined || extractSpec === null) {
            return [row];
        }

        const spec =
            typeof extractSpec === "string"
                ? { pattern: extractSpec }
                : isPlainObject(extractSpec)
                ? /** @type {Record<string, any>} */ (extractSpec)
                : null;
        if (spec === null || typeof spec.pattern !== "string") {
            throw new Error(
                "selector extract needs a regular-expression pattern"
            );
        }

        const from =
            spec.from === undefined
                ? row.value
                : resolveSelectorValue(spec.from, row, row.bindings);
        const text =
            typeof from === "string"
                ? from
                : from === null || from === undefined
                ? ""
                : String(from);
        const requestedFlags = String(spec.flags ?? "");
        const global = spec.global !== false;
        const flags =
            global && !requestedFlags.includes("g")
                ? `${requestedFlags}g`
                : requestedFlags;
        const expression = new RegExp(spec.pattern, flags);
        /** @type {SelectorRow[]} */
        const out = [];
        let ordinal = 0;

        for (;;) {
            const match = expression.exec(text);
            if (match === null) break;
            const bindings = Object.assign({}, row.bindings, {
                "#match": match[0],
                "#match_index": match.index,
                "#match_ordinal": ordinal
            });

            if (match.groups !== undefined) {
                const groupNames = Object.keys(match.groups);
                for (let i = 0, len = groupNames.length; i < len; i++) {
                    const name = groupNames[i];
                    bindings[name] = match.groups[name];
                    bindings[`#${name}`] = match.groups[name];
                }
            }

            if (isPlainObject(spec.groups)) {
                const groupNames = Object.keys(spec.groups);
                for (let i = 0, len = groupNames.length; i < len; i++) {
                    const name = groupNames[i];
                    const index = spec.groups[name];
                    const captured =
                        typeof index === "number"
                            ? match[index]
                            : match.groups?.[String(index)];
                    bindings[name] = captured;
                    bindings[`#${name}`] = captured;
                }
            }

            /** @type {unknown} */
            let value = match[0];
            if (spec.group !== undefined) {
                value =
                    typeof spec.group === "number"
                        ? match[spec.group]
                        : match.groups?.[String(spec.group)];
            } else if (
                spec.groups !== undefined ||
                match.groups !== undefined
            ) {
                /** @type {Record<string, unknown>} */
                const captured = {
                    match: match[0],
                    index: match.index,
                    groups: Array.from(match).slice(1)
                };
                if (match.groups !== undefined) {
                    Object.assign(captured, match.groups);
                }
                if (isPlainObject(spec.groups)) {
                    const names = Object.keys(spec.groups);
                    for (let i = 0, len = names.length; i < len; i++) {
                        captured[names[i]] = bindings[names[i]];
                    }
                }
                value = captured;
            }

            const path = `${row.match.path}#match[${ordinal}]`;
            const candidate = {
                unit: row.unit,
                match: {
                    path,
                    value,
                    parent: row.value,
                    key: ordinal
                },
                value,
                bindings: Object.assign(bindings, {
                    "#path": path,
                    "#key": String(ordinal),
                    "#value": value
                })
            };

            if (spec.project !== undefined) {
                const projected = resolveSelectorProjection(
                    spec.project,
                    candidate
                );
                candidate.value = projected;
                candidate.match.value = projected;
                candidate.bindings["#value"] = projected;
            }
            out.push(candidate);
            ordinal += 1;

            if (!global) break;
            if (match[0].length === 0) expression.lastIndex += 1;
        }

        return out;
    }

    /**
     * @param {number} count
     * @param {number} scanned
     * @returns {void}
     */
    _countSelection(count, scanned) {
        if (this._currentRule === null) {
            return;
        }
        const previous = this.selectionCounts.get(this._currentRule) ?? 0;
        this.selectionCounts.set(this._currentRule, previous + count);

        const previousScope = this.scopeCounts.get(this._currentRule) ?? 0;
        this.scopeCounts.set(this._currentRule, previousScope + scanned);
    }

    /**
     * Resolve every declared table once, as a plain mapping.
     *
     * A table is either written out in the pack or projected from the corpus.
     * The second form is the one that matters: a width table the corpus itself
     * declares cannot drift from the corpus, and a table copied into a rule
     * pack can.
     *
     * @returns {Record<string, Record<string, unknown>>}
     */
    _resolveTables(requestedNames = null) {
        const owner = this._currentRule;
        this._currentRule = null;

        try {
            /** @type {Record<string, Record<string, unknown>>} */
            const out = {};
            const declared = this.pack.tables ?? {};
            const names =
                requestedNames === null
                    ? Object.keys(declared)
                    : requestedNames;

            for (let i = 0, len = names.length; i < len; i++) {
                const name = names[i];
                if (!Object.prototype.hasOwnProperty.call(declared, name)) {
                    throw new Error(`unknown table "${name}"`);
                }
                out[name] = this._resolveTable(name, declared);
            }
            return out;
        } finally {
            this._currentRule = owner;
        }
    }

    /**
     * Resolve the tables a rule explicitly requests or references by name.
     * Explicit declarations remain authoritative; name discovery retains the
     * compact pack form while avoiding unrelated table projection.
     *
     * @param {AssertionRule} rule
     * @returns {Record<string, Record<string, unknown>>}
     */
    _resolveRuleTables(rule) {
        if (Object.prototype.hasOwnProperty.call(rule, "with_tables")) {
            return this._resolveTables(arrayOfStrings(rule.with_tables));
        }

        const declaredNames = Object.keys(this.pack.tables ?? {});
        if (declaredNames.length === 0) {
            return {};
        }

        const source = JSON.stringify({
            bind: rule.bind,
            when: rule.when,
            assert: rule.assert
        });
        const referencedNames = [];
        for (let i = 0, len = declaredNames.length; i < len; i++) {
            const name = declaredNames[i];
            const pattern = new RegExp(
                `(^|[^A-Za-z0-9_])${escapeRegularExpression(
                    name
                )}([^A-Za-z0-9_]|$)`
            );
            if (pattern.test(source)) {
                referencedNames.push(name);
            }
        }
        return this._resolveTables(referencedNames);
    }

    /**
     * @param {string} name
     * @param {Record<string, unknown>} declared
     * @returns {Record<string, unknown>}
     */
    _resolveTable(name, declared) {
        const cached = this._tableCache.get(name);
        if (cached !== undefined) {
            return cached;
        }
        if (this._tableResolutionStack.has(name)) {
            const chain = Array.from(this._tableResolutionStack);
            chain.push(name);
            throw new Error(`cyclic table dependency: ${chain.join(" -> ")}`);
        }

        this._tableResolutionStack.add(name);
        try {
            const spec = declared[name];
            /** @type {Record<string, unknown>} */
            const table = {};

            if (
                isPlainObject(spec) &&
                isPlainObject(
                    /** @type {Record<string, unknown>} */ (spec).entries
                )
            ) {
                Object.assign(
                    table,
                    /** @type {Record<string, unknown>} */ (
                        /** @type {Record<string, unknown>} */ (spec).entries
                    )
                );
            } else if (isPlainObject(spec)) {
                const definition = /** @type {Record<string, any>} */ (spec);
                const dependencyNames = arrayOfStrings(definition.with_tables);
                const dependencies =
                    dependencyNames.length === 0
                        ? {}
                        : this._resolveTables(dependencyNames);
                const selectedRows = this._selectMany(
                    definition.select ?? definition
                );
                const keyTemplate = requireString(
                    definition.key,
                    `table "${name}" needs \`key\``
                );
                const valueSpec = definition.value ?? "{#value}";
                const mode = String(definition.mode ?? "scalar");
                const duplicate = String(definition.on_duplicate ?? "last");

                for (let i = 0, len = selectedRows.length; i < len; i++) {
                    const selected = selectedRows[i];
                    const row = {
                        unit: selected.unit,
                        match: selected.match,
                        value: selected.value,
                        bindings: Object.assign(
                            {},
                            dependencies,
                            selected.bindings
                        )
                    };
                    const key = renderKey(keyTemplate, row.value, row.bindings);
                    const value = resolveTableValue(valueSpec, row);
                    if (key === null || value === null || value === undefined) {
                        continue;
                    }
                    mergeTableValue(table, key, value, mode, duplicate, name);
                }

                if (mode === "set") {
                    const keys = Object.keys(table);
                    for (let i = 0, len = keys.length; i < len; i++) {
                        table[keys[i]] = Array.from(
                            /** @type {Set<unknown>} */ (table[keys[i]])
                        );
                    }
                }
            }

            this._tableCache.set(name, table);
            return table;
        } finally {
            this._tableResolutionStack.delete(name);
        }
    }

    /**
     * @param {unknown} selector
     * @returns {Record<string, any>}
     */
    _resolveSelector(selector) {
        if (typeof selector === "string") {
            const named = this.pack.selectors[selector];
            if (named === undefined) {
                throw new Error(`unknown selector "${selector}"`);
            }
            return this._resolveSelector(named);
        }
        if (!isPlainObject(selector)) {
            throw new Error("selector must be a mapping or a selector id");
        }

        const spec = /** @type {Record<string, any>} */ (selector);

        if (typeof spec.extends === "string") {
            const base = this._resolveSelector(spec.extends);
            const merged = Object.assign({}, base, spec);
            delete merged.extends;
            if (base.where !== undefined && spec.where !== undefined) {
                merged.where = { all: [base.where, spec.where] };
            }
            if (
                base.unit_where !== undefined &&
                spec.unit_where !== undefined
            ) {
                merged.unit_where = {
                    all: [base.unit_where, spec.unit_where]
                };
            }
            return merged;
        }

        return spec;
    }

    /**
     * @param {unknown} language
     * @returns {Record<string, unknown>}
     */
    _languageDefinition(language) {
        if (typeof language === "string") {
            const named = this.pack.languages?.[language];
            if (!isPlainObject(named)) {
                throw new Error(`unknown embedded language "${language}"`);
            }
            return /** @type {Record<string, unknown>} */ (named);
        }
        if (isPlainObject(language)) {
            return /** @type {Record<string, unknown>} */ (language);
        }
        return {};
    }

    /**
     * @param {unknown} source
     * @returns {import("./types/general.mjs").SourceDefinition}
     */
    _sourceDefinition(source) {
        if (source === undefined || source === null) {
            const fallback = this.pack.sources[this.pack.default_source ?? ""];
            if (fallback === undefined) {
                throw new Error("selector has no source and no default exists");
            }
            return fallback;
        }
        if (typeof source === "string") {
            const named = this.pack.sources[source];
            if (named === undefined) {
                throw new Error(`unknown source "${source}"`);
            }
            return named;
        }
        return /** @type {import("./types/general.mjs").SourceDefinition} */ (
            source
        );
    }

    /**
     * @param {unknown} projection
     * @param {string} side
     * @returns {Map<string, { row: SelectorRow, value: unknown }>}
     */
    _project(projection, side) {
        if (!isPlainObject(projection)) {
            throw new Error(`agree rule needs a \`${side}\` projection`);
        }
        const spec = /** @type {Record<string, any>} */ (projection);
        const rows = this._selectMany(spec.select ?? spec);
        const keyTemplate = requireString(
            spec.key,
            `agree \`${side}\` needs \`key\``
        );
        const valueTemplate = spec.value ?? "{#value}";

        /** @type {Map<string, { row: SelectorRow, value: unknown }>} */
        const out = new Map();

        /** @type {Set<string>} */
        const ambiguous = new Set();
        const duplicatePolicy = String(spec.on_duplicate ?? "ambiguous");

        for (let i = 0, len = rows.length; i < len; i++) {
            const row = rows[i];
            const key = renderKey(keyTemplate, row.value, row.bindings);
            if (key === null) {
                continue;
            }
            const value = renderKey(valueTemplate, row.value, row.bindings);
            if (value === null) {
                continue;
            }
            const existing = out.get(key);
            if (existing === undefined) {
                out.set(key, { row, value });
                continue;
            }
            if (duplicatePolicy === "last") {
                out.set(key, { row, value });
                continue;
            }
            if (duplicatePolicy === "first") {
                continue;
            }
            if (duplicatePolicy === "error") {
                if (!looseEqual(existing.value, value)) {
                    throw new Error(
                        `agree ${side} key "${key}" resolves to conflicting values`
                    );
                }
                continue;
            }
            if (duplicatePolicy !== "ambiguous") {
                throw new Error(
                    `agree ${side} has unknown duplicate policy "${duplicatePolicy}"`
                );
            }
            if (!looseEqual(existing.value, value)) {
                ambiguous.add(key);
            }
        }

        for (const key of ambiguous) {
            out.delete(key);
        }

        return out;
    }

    /**
     * @param {AssertionRule} rule
     * @param {unknown} left
     * @param {unknown} right
     * @returns {boolean}
     */
    _valuesAgree(rule, left, right) {
        const compare = String(rule.compare ?? "loose");
        if (compare === "strict") {
            return left === right;
        }
        if (
            compare === "lte" ||
            compare === "lt" ||
            compare === "gte" ||
            compare === "gt"
        ) {
            // A join is not always an equality. A declared ceiling and the
            // thing it bounds are joined on the same key and related by an
            // inequality, and forcing that into an equality check reports every
            // store that is comfortably inside its budget as disagreeing with
            // it.
            const leftNumber = coerceNumber(left);
            const rightNumber = coerceNumber(right);
            if (leftNumber === null || rightNumber === null) {
                return false;
            }
            if (compare === "lte") {
                return leftNumber <= rightNumber;
            }
            if (compare === "lt") {
                return leftNumber < rightNumber;
            }
            if (compare === "gte") {
                return leftNumber >= rightNumber;
            }
            return leftNumber > rightNumber;
        }
        if (compare === "number") {
            const leftNumber = coerceNumber(left);
            const rightNumber = coerceNumber(right);
            return (
                leftNumber !== null &&
                rightNumber !== null &&
                leftNumber === rightNumber
            );
        }
        if (compare === "case_insensitive") {
            return String(left).toLowerCase() === String(right).toLowerCase();
        }
        return looseEqual(left, right);
    }

    /**
     * @param {AssertionRule} rule
     * @returns {ReachBaseline}
     */
    _loadBaseline(rule) {
        /** @type {Map<string, Record<string, unknown>>} */
        const entries = new Map();
        const categories = arrayOfStrings(rule.baseline_categories);

        if (rule.baseline === undefined) {
            return { file: null, entries, categories };
        }

        const units = this.index.resolveSource(
            this._sourceDefinition(rule.baseline)
        );
        if (units.length === 0) {
            return { file: null, entries, categories };
        }

        const unit = units[0];
        const entryPath = String(rule.baseline_entries ?? "$.entries[*]");
        const keyTemplate = String(rule.baseline_key ?? "{$.name}");
        const categoryField = String(rule.baseline_category ?? "category");

        const matches = evaluatePath(unit.data, entryPath);
        const bindings = CorpusIndex.bindingsFor(unit);

        for (let i = 0, len = matches.length; i < len; i++) {
            const key = renderKey(keyTemplate, matches[i].value, bindings);
            if (key === null) {
                continue;
            }
            const value = isPlainObject(matches[i].value)
                ? /** @type {Record<string, unknown>} */ (matches[i].value)
                : {};
            entries.set(key, {
                category: value[categoryField]
            });
        }

        return { file: unit.file, entries, categories };
    }

    /**
     * @param {AssertionRule} rule
     * @param {string} group
     * @returns {SelectorRow | null}
     */
    _anchorFor(rule, group) {
        if (rule.over === undefined) {
            return null;
        }
        const rows = this._select(rule.over);
        const groupTemplate = rule.group ?? "{#file}";
        for (let i = 0, len = rows.length; i < len; i++) {
            const candidate =
                renderKey(groupTemplate, rows[i].value, rows[i].bindings) ?? "";
            if (candidate === group) {
                return rows[i];
            }
        }
        return null;
    }

    // =========================================================================
    // Findings
    // =========================================================================

    /**
     * @param {AssertionRule | SelectorRow} ruleOrRow
     * @param {SelectorRow | null} row
     * @param {Record<string, unknown>} [extra]
     * @param {AssertionRule} [explicitRule]
     * @returns {AssertionFinding}
     */
    _finding(ruleOrRow, row, extra = {}, explicitRule = undefined) {
        const rule = /** @type {AssertionRule} */ (explicitRule ?? ruleOrRow);
        const anchor = /** @type {SelectorRow | null} */ (row);

        const bindings = Object.assign(
            {},
            anchor === null ? {} : anchor.bindings,
            extra
        );

        const template = rule.message ?? `${rule.id}: {#file}{#path}`;

        return {
            severity: this._severity(rule),
            code: rule.id,
            rule: rule.id,
            file: anchor === null ? null : anchor.unit.file,
            path: anchor === null ? null : anchor.match.path,
            message: renderTemplate(
                template,
                anchor === null ? null : anchor.value,
                bindings
            )
        };
    }

    /**
     * @param {AssertionRule} rule
     * @returns {string}
     */
    _severity(rule) {
        const override = this.severityOverrides[rule.id];
        if (override !== undefined) {
            return override;
        }
        const byMode = rule.severity_by_mode;
        if (isPlainObject(byMode)) {
            const selected = /** @type {Record<string, unknown>} */ (byMode)[
                this.mode
            ];
            if (typeof selected === "string") {
                return selected;
            }
        }
        return String(rule.severity ?? DEFAULT_SEVERITY);
    }
}

/**
 * @param {string} rootDirectory
 * @param {string} repositoryPath
 * @returns {string | null}
 */
function containedRepositoryPath(rootDirectory, repositoryPath) {
    if (isAbsolute(repositoryPath)) return null;
    const root = resolve(rootDirectory);
    const absolute = resolve(root, repositoryPath);
    if (absolute !== root && !absolute.startsWith(root + sep)) return null;
    return absolute;
}

/**
 * @param {AssertionRule} rule
 * @param {string} mode
 * @returns {boolean}
 */
/**
 * Evaluate one path or a declarative list of alternative paths.
 *
 * Compiled paths are arrays of segment mappings, while assertion packs use
 * arrays of strings to mean alternatives. Distinguishing the element shape
 * preserves the compiled-path API and lets a selector cover equivalent
 * declaration shapes without duplicating the selector itself.
 *
 * @param {unknown} root
 * @param {unknown} expression
 * @param {string} [basePath]
 * @returns {import("./types/general.mjs").PathMatch[]}
 */
function evaluateSelectorPath(root, expression, basePath = "$") {
    if (
        Array.isArray(expression) &&
        expression.every((part) => typeof part === "string")
    ) {
        /** @type {import("./types/general.mjs").PathMatch[]} */
        const matches = [];
        for (let i = 0, len = expression.length; i < len; i++) {
            const partMatches = evaluatePath(root, expression[i], basePath);
            for (let j = 0, count = partMatches.length; j < count; j++) {
                matches.push(partMatches[j]);
            }
        }
        return matches;
    }

    if (typeof expression === "string" || Array.isArray(expression)) {
        return evaluatePath(root, expression, basePath);
    }
    throw new Error("selector path must be a string or list of strings");
}

function ruleAppliesInMode(rule, mode) {
    const modes = rule.modes;
    if (modes === undefined) {
        return true;
    }
    const declared = Array.isArray(modes) ? modes.map(String) : [String(modes)];
    return declared.includes(mode);
}

/**
 * @param {Map<string, Set<string>>} adjacency
 * @returns {string[][]}
 */
function stronglyConnectedComponents(adjacency) {
    let nextIndex = 0;
    /** @type {Map<string, number>} */
    const indexes = new Map();
    /** @type {Map<string, number>} */
    const lowLinks = new Map();
    /** @type {string[]} */
    const stack = [];
    /** @type {Set<string>} */
    const onStack = new Set();
    /** @type {string[][]} */
    const components = [];

    /** @param {string} node */
    function visit(node) {
        indexes.set(node, nextIndex);
        lowLinks.set(node, nextIndex);
        nextIndex += 1;
        stack.push(node);
        onStack.add(node);

        const neighbours = Array.from(adjacency.get(node) ?? []).sort();
        for (let i = 0, len = neighbours.length; i < len; i++) {
            const neighbour = neighbours[i];
            if (!indexes.has(neighbour)) {
                visit(neighbour);
                lowLinks.set(
                    node,
                    Math.min(
                        lowLinks.get(node) ?? 0,
                        lowLinks.get(neighbour) ?? 0
                    )
                );
                continue;
            }
            if (onStack.has(neighbour)) {
                lowLinks.set(
                    node,
                    Math.min(
                        lowLinks.get(node) ?? 0,
                        indexes.get(neighbour) ?? 0
                    )
                );
            }
        }

        if (lowLinks.get(node) !== indexes.get(node)) {
            return;
        }
        /** @type {string[]} */
        const component = [];
        for (;;) {
            const member = stack.pop();
            if (member === undefined) {
                break;
            }
            onStack.delete(member);
            component.push(member);
            if (member === node) {
                break;
            }
        }
        component.sort();
        components.push(component);
    }

    const nodes = Array.from(adjacency.keys()).sort();
    for (let i = 0, len = nodes.length; i < len; i++) {
        if (!indexes.has(nodes[i])) {
            visit(nodes[i]);
        }
    }
    components.sort((left, right) =>
        String(left[0] ?? "").localeCompare(String(right[0] ?? ""))
    );
    return components;
}

/**
 * @param {unknown} specification
 * @param {SelectorRow} row
 * @returns {unknown}
 */
function resolveReachValue(specification, row) {
    if (specification === undefined || specification === null) {
        return null;
    }
    if (typeof specification === "string" && specification.includes("{")) {
        return renderKey(specification, row.value, row.bindings);
    }
    return resolveSelectorValue(specification, row, row.bindings);
}

/**
 * @param {unknown} specification
 * @param {SelectorRow} row
 * @returns {string[]}
 */
function resolveReachValues(specification, row) {
    if (specification === undefined || specification === null) {
        return [];
    }
    if (Array.isArray(specification)) {
        /** @type {string[]} */
        const values = [];
        for (let i = 0, len = specification.length; i < len; i++) {
            values.push(...resolveReachValues(specification[i], row));
        }
        return values;
    }
    return flattenReachValue(resolveReachValue(specification, row));
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function flattenReachValue(value) {
    if (value === undefined || value === null) {
        return [];
    }
    if (Array.isArray(value)) {
        /** @type {string[]} */
        const values = [];
        for (let i = 0, len = value.length; i < len; i++) {
            values.push(...flattenReachValue(value[i]));
        }
        return values;
    }
    if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "bigint" ||
        typeof value === "boolean"
    ) {
        return [String(value)];
    }
    return [];
}

/**
 * @param {unknown[]} values
 * @returns {string[]}
 */
function uniqueStrings(values) {
    /** @type {string[]} */
    const out = [];
    const seen = new Set();
    for (let i = 0, len = values.length; i < len; i++) {
        const value = String(values[i]);
        if (value.length === 0 || seen.has(value)) {
            continue;
        }
        seen.add(value);
        out.push(value);
    }
    return out;
}

/**
 * @param {Map<string, string>} reachedTiers
 * @param {string} key
 * @param {string} tier
 * @param {string[]} order
 * @returns {void}
 */
function assignReachTier(reachedTiers, key, tier, order) {
    const current = reachedTiers.get(key);
    if (current === undefined) {
        reachedTiers.set(key, tier);
        return;
    }
    const currentIndex = reachTierIndex(current, order);
    const candidateIndex = reachTierIndex(tier, order);
    if (candidateIndex < currentIndex) {
        reachedTiers.set(key, tier);
    }
}

/**
 * @param {string} tier
 * @param {string[]} order
 * @returns {number}
 */
function reachTierIndex(tier, order) {
    const index = order.indexOf(tier);
    if (index >= 0) {
        return index;
    }
    return order.length + 1;
}

/**
 * @param {unknown} nodeValue
 * @param {unknown} observedValue
 * @param {boolean} excludeSame
 * @param {unknown} relation
 * @returns {boolean}
 */
function reachRelationMatches(nodeValue, observedValue, excludeSame, relation) {
    const nodeDefined = nodeValue !== null && nodeValue !== undefined;
    const observedDefined =
        observedValue !== null && observedValue !== undefined;
    const equal =
        nodeDefined && observedDefined && looseEqual(nodeValue, observedValue);

    if (excludeSame && equal) {
        return false;
    }
    const mode = relation === undefined ? "" : String(relation);
    if (mode === "same") {
        return nodeDefined && observedDefined && equal;
    }
    if (mode === "different") {
        return nodeDefined && observedDefined && !equal;
    }
    if (mode.length > 0) {
        throw new Error(`unknown reach relation "${mode}"`);
    }
    return true;
}

/**
 * @param {{ aliases: string[], context: unknown }} node
 * @param {string[]} observedValues
 * @param {Record<string, unknown>} specification
 * @returns {boolean}
 */
function reachObservationMatches(node, observedValues, specification) {
    const mode = String(specification.match ?? "exact");
    const boundary = String(specification.boundary ?? "identifier");
    if (mode === "exact") {
        return node.aliases.some((alias) =>
            observedValues.some((value) => value === alias)
        );
    }
    if (mode === "word") {
        return node.aliases.some((alias) =>
            observedValues.some((value) =>
                containsReachWord(value, alias, boundary)
            )
        );
    }
    if (mode === "nearby") {
        const lines = [];
        for (let i = 0, len = observedValues.length; i < len; i++) {
            lines.push(...String(observedValues[i]).split(/\r?\n/));
        }
        const contexts = flattenReachValue(node.context);
        if (contexts.length === 0) {
            return node.aliases.some((alias) =>
                lines.some((line) => containsReachWord(line, alias, boundary))
            );
        }
        const window = Math.max(0, Number(specification.window ?? 0));
        /** @type {number[]} */
        const contextLines = [];
        /** @type {number[]} */
        const aliasLines = [];
        for (let i = 0, len = lines.length; i < len; i++) {
            const line = lines[i];
            if (
                contexts.some((context) =>
                    containsReachWord(line, context, boundary)
                )
            ) {
                contextLines.push(i);
            }
            if (
                node.aliases.some((alias) =>
                    containsReachWord(line, alias, boundary)
                )
            ) {
                aliasLines.push(i);
            }
        }
        for (let i = 0, len = contextLines.length; i < len; i++) {
            for (let j = 0, count = aliasLines.length; j < count; j++) {
                if (Math.abs(contextLines[i] - aliasLines[j]) <= window) {
                    return true;
                }
            }
        }
        return false;
    }
    throw new Error(`unknown reach match mode "${mode}"`);
}

/**
 * @param {string} text
 * @param {string} value
 * @param {string} boundary
 * @returns {boolean}
 */
function containsReachWord(text, value, boundary) {
    if (value.length === 0) {
        return false;
    }
    if (boundary === "none") {
        return text.includes(value);
    }
    const characterClass =
        boundary === "identifier_hyphen"
            ? "A-Za-z0-9_-"
            : boundary === "identifier"
            ? "A-Za-z0-9_"
            : null;
    if (characterClass === null) {
        throw new Error(`unknown reach boundary "${boundary}"`);
    }
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expression = new RegExp(
        `(^|[^${characterClass}])${escaped}(?=$|[^${characterClass}])`
    );
    return expression.test(text);
}

/**
 * @param {string[]} values
 * @returns {{ states: { next: Map<string, number>, fail: number, outputs: string[] }[] }}
 */
function createReachMatcher(values) {
    /** @type {{ next: Map<string, number>, fail: number, outputs: string[] }[]} */
    const states = [{ next: new Map(), fail: 0, outputs: [] }];
    const uniqueValues = uniqueStrings(values);

    for (let i = 0, valueCount = uniqueValues.length; i < valueCount; i++) {
        const value = uniqueValues[i];
        let stateIndex = 0;
        for (
            let j = 0, characterCount = value.length;
            j < characterCount;
            j++
        ) {
            const character = value[j];
            const state = states[stateIndex];
            let nextIndex = state.next.get(character);
            if (nextIndex === undefined) {
                nextIndex = states.length;
                state.next.set(character, nextIndex);
                states.push({ next: new Map(), fail: 0, outputs: [] });
            }
            stateIndex = nextIndex;
        }
        states[stateIndex].outputs.push(value);
    }

    const queue = [];
    const rootChildren = Array.from(states[0].next.values());
    for (let i = 0, len = rootChildren.length; i < len; i++) {
        queue.push(rootChildren[i]);
    }

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
        const stateIndex = queue[queueIndex];
        const transitions = Array.from(states[stateIndex].next.entries());
        for (let i = 0, len = transitions.length; i < len; i++) {
            const [character, nextIndex] = transitions[i];
            queue.push(nextIndex);

            let fallbackIndex = states[stateIndex].fail;
            while (
                fallbackIndex !== 0 &&
                !states[fallbackIndex].next.has(character)
            ) {
                fallbackIndex = states[fallbackIndex].fail;
            }
            const fallbackTransition =
                states[fallbackIndex].next.get(character);
            if (
                fallbackTransition !== undefined &&
                fallbackTransition !== nextIndex
            ) {
                states[nextIndex].fail = fallbackTransition;
            }

            const inheritedOutputs = states[states[nextIndex].fail].outputs;
            for (
                let j = 0, outputCount = inheritedOutputs.length;
                j < outputCount;
                j++
            ) {
                states[nextIndex].outputs.push(inheritedOutputs[j]);
            }
        }
    }

    return { states };
}

/**
 * @param {string[]} texts
 * @param {{ states: { next: Map<string, number>, fail: number, outputs: string[] }[] }} matcher
 * @param {string} boundary
 * @returns {string[]}
 */
function matchReachTextValues(texts, matcher, boundary) {
    const matches = new Set();
    for (let i = 0, len = texts.length; i < len; i++) {
        const textMatches = matchReachText(texts[i], matcher, boundary);
        for (let j = 0, count = textMatches.length; j < count; j++) {
            matches.add(textMatches[j]);
        }
    }
    return Array.from(matches);
}

/**
 * @param {string} text
 * @param {{ states: { next: Map<string, number>, fail: number, outputs: string[] }[] }} matcher
 * @param {string} boundary
 * @returns {string[]}
 */
function matchReachText(text, matcher, boundary) {
    validateReachBoundary(boundary);
    const matches = new Set();
    const states = matcher.states;
    let stateIndex = 0;

    for (let i = 0, len = text.length; i < len; i++) {
        const character = text[i];
        while (stateIndex !== 0 && !states[stateIndex].next.has(character)) {
            stateIndex = states[stateIndex].fail;
        }
        const transition = states[stateIndex].next.get(character);
        stateIndex = transition === undefined ? 0 : transition;

        const outputs = states[stateIndex].outputs;
        for (let j = 0, outputCount = outputs.length; j < outputCount; j++) {
            const value = outputs[j];
            const end = i + 1;
            const start = end - value.length;
            if (reachBoundaryMatches(text, start, end, boundary)) {
                matches.add(value);
            }
        }
    }

    return Array.from(matches);
}

/**
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @param {string} boundary
 * @returns {boolean}
 */
function reachBoundaryMatches(text, start, end, boundary) {
    if (boundary === "none") {
        return true;
    }
    return (
        (start === 0 ||
            !isReachIdentifierCharacter(text[start - 1], boundary)) &&
        (end === text.length ||
            !isReachIdentifierCharacter(text[end], boundary))
    );
}

/**
 * @param {string} character
 * @param {string} boundary
 * @returns {boolean}
 */
function isReachIdentifierCharacter(character, boundary) {
    const code = character.charCodeAt(0);
    return (
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        code === 95 ||
        (boundary === "identifier_hyphen" && code === 45)
    );
}

/**
 * @param {string} boundary
 * @returns {void}
 */
function validateReachBoundary(boundary) {
    if (
        boundary !== "none" &&
        boundary !== "identifier" &&
        boundary !== "identifier_hyphen"
    ) {
        throw new Error(`unknown reach boundary "${boundary}"`);
    }
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function splitReachLines(values) {
    const lines = [];
    for (let i = 0, len = values.length; i < len; i++) {
        lines.push(...String(values[i]).split(/\r?\n/));
    }
    return lines;
}

/**
 * @param {Map<string, number[]>} linesByKey
 * @param {string} key
 * @param {number} line
 * @returns {void}
 */
function appendReachLine(linesByKey, key, line) {
    const lines = linesByKey.get(key);
    if (lines === undefined) {
        linesByKey.set(key, [line]);
        return;
    }
    if (lines[lines.length - 1] !== line) {
        lines.push(line);
    }
}

/**
 * @param {number[]} left
 * @param {number[]} right
 * @param {number} window
 * @returns {boolean}
 */
function reachLinesWithinWindow(left, right, window) {
    let leftIndex = 0;
    let rightIndex = 0;
    while (leftIndex < left.length && rightIndex < right.length) {
        const difference = left[leftIndex] - right[rightIndex];
        if (Math.abs(difference) <= window) {
            return true;
        }
        if (difference < 0) {
            leftIndex++;
        } else {
            rightIndex++;
        }
    }
    return false;
}

/**
 * @param {unknown} spec
 * @param {SelectorRow} row
 * @returns {unknown}
 */
function resolveTableValue(spec, row) {
    if (typeof spec === "string") {
        if (spec.startsWith("$") || spec.startsWith("#")) {
            return resolveSelectorValue(spec, row, row.bindings);
        }
        const rendered = renderKey(spec, row.value, row.bindings);
        if (rendered === null) return null;
        const numericValue = coerceNumber(rendered);
        return numericValue === null ? rendered : numericValue;
    }
    return resolveSelectorProjection(spec, row);
}

/**
 * @param {Record<string, unknown>} table
 * @param {string} key
 * @param {unknown} value
 * @param {string} mode
 * @param {string} duplicate
 * @param {string} tableName
 * @returns {void}
 */
function mergeTableValue(table, key, value, mode, duplicate, tableName) {
    if (mode === "list") {
        const existing = table[key];
        if (existing === undefined) {
            table[key] = [value];
            return;
        }
        /** @type {unknown[]} */ (existing).push(value);
        return;
    }
    if (mode === "set") {
        const existing = table[key];
        if (existing === undefined) {
            table[key] = new Set([value]);
            return;
        }
        /** @type {Set<unknown>} */ (existing).add(value);
        return;
    }
    if (mode === "count") {
        table[key] = Number(table[key] ?? 0) + 1;
        return;
    }
    if (mode === "sum" || mode === "min" || mode === "max") {
        const numberValue = coerceNumber(value);
        if (numberValue === null) {
            throw new Error(
                `table "${tableName}" ${mode} value for "${key}" is not numeric`
            );
        }
        const existing = coerceNumber(table[key]);
        if (mode === "sum") {
            table[key] = (existing ?? 0) + numberValue;
        } else if (mode === "min") {
            table[key] =
                existing === null
                    ? numberValue
                    : Math.min(existing, numberValue);
        } else {
            table[key] =
                existing === null
                    ? numberValue
                    : Math.max(existing, numberValue);
        }
        return;
    }
    if (mode !== "scalar") {
        throw new Error(`table "${tableName}" has unknown mode "${mode}"`);
    }

    if (table[key] === undefined || duplicate === "last") {
        table[key] = value;
        return;
    }
    if (duplicate === "first") {
        return;
    }
    if (duplicate === "error" && !looseEqual(table[key], value)) {
        throw new Error(
            `table "${tableName}" key "${key}" resolves to conflicting values`
        );
    }
}

/**
 * Resolve one selector binding or projection value.
 *
 * Strings beginning with `$` are paths over the selected value. Strings
 * beginning with `#` are existing bindings. Mapping forms may explicitly read
 * from the document, scope, parent, or selected value; may render a template;
 * or may carry a literal. Plural paths return arrays.
 *
 * @param {unknown} spec
 * @param {SelectorRow} row
 * @param {Record<string, unknown>} bindings
 * @returns {unknown}
 */
function resolveSelectorValue(spec, row, bindings) {
    if (typeof spec === "string") {
        if (spec.startsWith("#")) {
            return bindings[spec];
        }
        if (spec.startsWith("$")) {
            const values = evaluatePathValues(row.value, spec);
            if (isPluralPath(spec)) return values;
            return values.length === 0
                ? null
                : values.length === 1
                ? values[0]
                : values;
        }
        return spec;
    }
    if (!isPlainObject(spec)) {
        return spec;
    }

    const definition = /** @type {Record<string, any>} */ (spec);
    if (Object.prototype.hasOwnProperty.call(definition, "literal")) {
        return definition.literal;
    }
    if (typeof definition.template === "string") {
        return renderTemplate(definition.template, row.value, bindings);
    }
    if (typeof definition.expression === "string") {
        return evaluateExpression(
            definition.expression,
            selectorExpressionBindings(row, bindings)
        );
    }

    let root = row.value;
    switch (definition.from) {
        case "document":
            root = bindings["#document"];
            break;
        case "scope":
            root = bindings["#scope_value"];
            break;
        case "parent":
            root = bindings["#parent"];
            break;
        case "bindings":
            root = bindings;
            break;
        case "value":
        case undefined:
            break;
        default:
            throw new Error(
                `unknown selector binding source "${String(definition.from)}"`
            );
    }

    const path = String(definition.path ?? "$");
    const values = evaluatePathValues(root, path);
    const many = definition.many === true || isPluralPath(path);
    if (many) return values;
    if (values.length === 0) {
        return Object.prototype.hasOwnProperty.call(definition, "default")
            ? definition.default
            : null;
    }
    return values.length === 1 ? values[0] : values;
}

/**
 * @param {SelectorRow} row
 * @param {Record<string, unknown>} bindings
 * @returns {Record<string, unknown>}
 */
function selectorExpressionBindings(row, bindings) {
    /** @type {Record<string, unknown>} */
    const out = {};
    const names = Object.keys(bindings);
    for (let i = 0, len = names.length; i < len; i++) {
        const name = names[i];
        out[name] = bindings[name];
        if (name.startsWith("#") && name.length > 1) {
            out[name.slice(1)] = bindings[name];
        }
    }
    out.value = row.value;
    out.document = bindings["#document"];
    out.parent = bindings["#parent"];
    out.scope = bindings["#scope_value"];
    return out;
}

/**
 * @param {unknown} spec
 * @param {SelectorRow} row
 * @returns {unknown}
 */
function resolveSelectorProjection(spec, row) {
    if (
        !isPlainObject(spec) ||
        Object.prototype.hasOwnProperty.call(spec, "path") ||
        Object.prototype.hasOwnProperty.call(spec, "template") ||
        Object.prototype.hasOwnProperty.call(spec, "literal") ||
        Object.prototype.hasOwnProperty.call(spec, "expression") ||
        Object.prototype.hasOwnProperty.call(spec, "from")
    ) {
        return resolveSelectorValue(spec, row, row.bindings);
    }

    /** @type {Record<string, unknown>} */
    const projected = {};
    const fields = Object.keys(/** @type {Record<string, unknown>} */ (spec));
    for (let i = 0, len = fields.length; i < len; i++) {
        const field = fields[i];
        projected[field] = resolveSelectorValue(
            /** @type {Record<string, unknown>} */ (spec)[field],
            row,
            row.bindings
        );
    }
    return projected;
}

/**
 * @param {unknown} value
 * @param {string} message
 * @returns {string}
 */
function requireString(value, message) {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(message);
    }
    return value;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function arrayOfStrings(value) {
    if (value === undefined || value === null) {
        return [];
    }
    return Array.isArray(value) ? value.map(String) : [String(value)];
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegularExpression(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A path that can select more than one value binds a list, even when it
 * currently selects none.
 *
 * The distinction matters at zero: a singular path selecting nothing means the
 * row has no such field and the assertion has nothing to say, while a plural
 * path selecting nothing means the row has none of them - which is often
 * exactly the condition being asserted. Collapsing the two skipped every row a
 * `when` guard was written to admit.
 *
 * @param {string} expression
 * @returns {boolean}
 */
function isPluralPath(expression) {
    return (
        expression.includes("[*]") ||
        expression.includes("..") ||
        expression.includes(".*")
    );
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function numeric(value) {
    const coerced = coerceNumber(value);
    return coerced === null ? value : coerced;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stringifyValue(value) {
    if (typeof value === "string") {
        return value;
    }
    if (value === undefined) {
        return "<absent>";
    }
    return JSON.stringify(value);
}
