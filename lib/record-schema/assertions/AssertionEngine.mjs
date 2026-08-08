/**
 * The corpus assertion engine.
 *
 * Eleven rule kinds, each a shape of defect rather than a subject. A corpus
 * declares which of its own paths play which role and the engine does the rest,
 * so the engine never learns what a "packed struct" or an "ordinal registry"
 * is. That ignorance is the point: a check the engine can only run because it
 * knows one corpus is a check that corpus has to keep alive itself.
 *
 * The kinds:
 *
 *   forbid    a selector that matches at all is the finding
 *   require   every unit in scope must satisfy a predicate
 *   pattern   every selected value must match, or not match, a regular form
 *   unique    keys are unique within their group
 *   resolve   every use resolves to a declaration
 *   agree     two projections joined on a key carry the same value
 *   derive    a computed value equals the declared one
 *   count     a group's cardinality falls within bounds
 *   reach     every node is reached, modulo a categorised baseline
 *   decode    declared bytes decode to the claimed fields
 *   digest    a committed manifest matches the tree it names
 *
 * @module record-schema/assertions/AssertionEngine
 */

import { createHash } from "node:crypto";
import { evaluatePath, evaluatePathValues, isPlainObject } from "./Path.mjs";
import { evaluatePredicate, looseEqual, coerceNumber } from "./Predicate.mjs";
import { renderKey, renderTemplate } from "./Template.mjs";
import { evaluateExpression } from "./Expression.mjs";
import { CorpusIndex } from "./CorpusIndex.mjs";
import { decodeLayout } from "./Decoder.mjs";

/** @typedef {import("./types/general.mjs").AssertionFinding} AssertionFinding */
/** @typedef {import("./types/general.mjs").AssertionRule} AssertionRule */
/** @typedef {import("./types/general.mjs").CorpusUnit} CorpusUnit */
/** @typedef {import("./types/general.mjs").SelectorRow} SelectorRow */

const DEFAULT_SEVERITY = "error";

/**
 * Executes a resolved assertion pack against a corpus index.
 */
export class AssertionEngine {
    /**
     * @param {CorpusIndex} index
     * @param {import("./types/general.mjs").ResolvedPack} pack
     * @param {{ severityOverrides?: Record<string, string>, only?: string[], skip?: string[] }} [options]
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

        /** @type {Map<string, SelectorRow[]>} */
        this._selectorCache = new Map();

        /** @type {Map<string, number>} */
        this._scopeCache = new Map();

        /** @type {Map<string, Record<string, unknown>>} */
        this._tableCache = new Map();

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

            if (rule.enabled === false) {
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
            case "decode":
                return this._runDecode(rule, findings);
            case "consistent":
                return this._runConsistent(rule, findings);
            case "digest":
                return this._runDigest(rule, findings);
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
        const tables = this._resolveTables();
        const bindNames = Object.keys(bindSpec);

        for (let i = 0, len = rows.length; i < len; i++) {
            const row = rows[i];

            /** @type {Record<string, unknown>} */
            const bindings = Object.assign({}, tables);
            let incomplete = false;

            for (let j = 0, count = bindNames.length; j < count; j++) {
                const name = bindNames[j];
                const spec = bindSpec[name];
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
            }

            if (incomplete) {
                continue;
            }

            // `when` decides whether the assertion applies at all. A row whose
            // widths this pack cannot resolve is not a row that fails; it is a
            // row the check has nothing to say about, and reporting it as a
            // defect is how a gate teaches people to silence it.
            if (
                guard !== null &&
                evaluateExpression(guard, bindings) !== true
            ) {
                continue;
            }

            const outcome = evaluateExpression(assertion, bindings);
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
    _runReach(rule, findings) {
        const nodeRows = this._selectMany(rule.nodes);
        const nodeKeyTemplate = requireString(
            rule.node_key ?? rule.key,
            "reach rule needs `node_key`"
        );

        /** @type {Map<string, SelectorRow>} */
        const nodes = new Map();
        for (let i = 0, len = nodeRows.length; i < len; i++) {
            const row = nodeRows[i];
            const key = renderKey(nodeKeyTemplate, row.value, row.bindings);
            if (key === null || nodes.has(key)) {
                continue;
            }
            nodes.set(key, row);
        }

        /** @type {Set<string>} */
        const reached = new Set();
        const edgeSpecs = Array.isArray(rule.edges) ? rule.edges : [];

        for (let i = 0, len = edgeSpecs.length; i < len; i++) {
            const spec = /** @type {Record<string, unknown>} */ (edgeSpecs[i]);
            const edgeRows = this._selectMany(spec.select ?? spec);
            const template = requireString(
                spec.key,
                "reach rule edge needs `key`"
            );
            const selfTemplate =
                typeof spec.from === "string" ? spec.from : null;

            for (let j = 0, count = edgeRows.length; j < count; j++) {
                const row = edgeRows[j];
                const target = renderKey(template, row.value, row.bindings);
                if (target === null) {
                    continue;
                }
                if (selfTemplate !== null) {
                    const origin = renderKey(
                        selfTemplate,
                        row.value,
                        row.bindings
                    );
                    if (origin !== null && origin === target) {
                        continue;
                    }
                }
                reached.add(target);
            }
        }

        const baseline = this._loadBaseline(rule);

        for (const [key, row] of nodes) {
            if (reached.has(key)) {
                continue;
            }

            const entry = baseline.entries.get(key);
            if (entry === undefined) {
                findings.push(
                    this._finding(rule, row, {
                        "#key": key,
                        "#baseline": baseline.file ?? "<none>"
                    })
                );
                continue;
            }

            if (
                baseline.categories.length > 0 &&
                !baseline.categories.includes(String(entry.category ?? ""))
            ) {
                findings.push({
                    severity: this._severity(rule),
                    code: `${rule.id}/CATEGORY`,
                    rule: rule.id,
                    file: baseline.file,
                    path: key,
                    message: `baseline entry "${key}" carries ${
                        entry.category === undefined
                            ? "no category"
                            : `category "${String(entry.category)}"`
                    }; an uncategorised exemption reads as accepted and names no edit that would remove it`
                });
            }
        }

        for (const [key] of baseline.entries) {
            if (!nodes.has(key) || reached.has(key)) {
                findings.push({
                    severity: this._severity(rule),
                    code: `${rule.id}/STALE`,
                    rule: rule.id,
                    file: baseline.file,
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
            return;
        }

        const entryPath = String(rule.entries ?? "$.files[*]");
        const pathTemplate = String(rule.entry_path ?? "{$.path}");
        const digestTemplate = String(rule.entry_digest ?? "{$.sha256}");
        const algorithm = String(rule.algorithm ?? "sha256");

        const tracked = this.index.resolveSource(
            this._sourceDefinition(rule.tracks)
        );

        /** @type {Map<string, string>} */
        const actual = new Map();
        for (let i = 0, len = tracked.length; i < len; i++) {
            const unit = tracked[i];
            actual.set(
                unit.file,
                createHash(algorithm).update(unit.text, "utf8").digest("hex")
            );
        }

        const manifest = manifestUnits[0];
        const entries = evaluatePath(manifest.data, entryPath);

        /** @type {Set<string>} */
        const seen = new Set();

        for (let i = 0, len = entries.length; i < len; i++) {
            const entry = entries[i];
            const bindings = CorpusIndex.bindingsFor(manifest);
            const file = renderKey(pathTemplate, entry.value, bindings);
            const digest = renderKey(digestTemplate, entry.value, bindings);

            if (file === null) {
                continue;
            }
            seen.add(file);

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
            if (digest !== null && digest !== observed) {
                findings.push({
                    severity: this._severity(rule),
                    code: `${rule.id}/DRIFT`,
                    rule: rule.id,
                    file: manifest.file,
                    path: entry.path,
                    message: `manifest digest for "${file}" is ${digest.slice(
                        0,
                        12
                    )}…, the tree hashes to ${observed.slice(0, 12)}…`
                });
            }
        }

        for (const [file] of actual) {
            if (seen.has(file)) {
                continue;
            }
            findings.push({
                severity: this._severity(rule),
                code: `${rule.id}/UNLISTED`,
                rule: rule.id,
                file: manifest.file,
                path: null,
                message: `"${file}" is in the tree and absent from the manifest`
            });
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
        if (!Array.isArray(selector)) {
            return this._select(selector);
        }

        /** @type {SelectorRow[]} */
        const rows = [];
        for (let i = 0, len = selector.length; i < len; i++) {
            const part = this._select(selector[i]);
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

        /** @type {SelectorRow[]} */
        const rows = [];
        const pathExpression = resolved.path ?? "$";
        let scanned = 0;

        for (let i = 0, len = units.length; i < len; i++) {
            const unit = units[i];
            const bindings = CorpusIndex.bindingsFor(unit);

            if (
                resolved.unit_where !== undefined &&
                !evaluatePredicate(resolved.unit_where, unit.data, bindings)
            ) {
                continue;
            }

            const matches = evaluatePath(unit.data, pathExpression);
            scanned += matches.length;

            for (let j = 0, count = matches.length; j < count; j++) {
                const match = matches[j];

                const rowBindings = Object.assign({}, bindings, {
                    "#path": match.path,
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
                    rows.push({
                        unit,
                        match,
                        value: match.value,
                        bindings: rowBindings
                    });
                    continue;
                }

                const children = evaluatePath(
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
                        ? renderKey(resolved.scope_key, match.value, bindings)
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

                    rows.push({
                        unit,
                        match: child,
                        value: child.value,
                        bindings: childBindings
                    });
                }
            }
        }

        this._selectorCache.set(cacheKey, rows);
        this._scopeCache.set(cacheKey, scanned);
        this._countSelection(rows.length, scanned);
        return rows;
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
    _resolveTables() {
        // Table resolution is not part of any one rule's scope. Counting it
        // there credits whichever rule happened to run first with rows it never
        // examined, which is the opposite of what the count is for.
        const owner = this._currentRule;
        this._currentRule = null;

        /** @type {Record<string, Record<string, unknown>>} */
        const out = {};
        const declared = this.pack.tables ?? {};
        const names = Object.keys(declared);

        for (let i = 0, len = names.length; i < len; i++) {
            const name = names[i];
            const cached = this._tableCache.get(name);
            if (cached !== undefined) {
                out[name] = cached;
                continue;
            }

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
                const rows = this._selectMany(definition.select ?? definition);
                const keyTemplate = requireString(
                    definition.key,
                    `table "${name}" needs \`key\``
                );
                const valueTemplate = definition.value ?? "{#value}";

                for (let j = 0, count = rows.length; j < count; j++) {
                    const row = rows[j];
                    const key = renderKey(keyTemplate, row.value, row.bindings);
                    const value = renderKey(
                        valueTemplate,
                        row.value,
                        row.bindings
                    );
                    if (key === null || value === null) {
                        continue;
                    }
                    const numericValue = coerceNumber(value);
                    table[key] = numericValue === null ? value : numericValue;
                }
            }

            this._tableCache.set(name, table);
            out[name] = table;
        }

        this._currentRule = owner;
        return out;
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
        const rows = this._select(spec.select ?? spec);
        const keyTemplate = requireString(
            spec.key,
            `agree \`${side}\` needs \`key\``
        );
        const valueTemplate = spec.value ?? "{#value}";

        /** @type {Map<string, { row: SelectorRow, value: unknown }>} */
        const out = new Map();

        /** @type {Set<string>} */
        const ambiguous = new Set();

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
            if (!looseEqual(existing.value, value)) {
                // A key that resolves to two different values is not a key. On
                // the definition side that is an ambiguous name, and joining
                // against whichever copy was read first would report the other
                // half of the corpus as disagreeing with an arbitrary winner.
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
     * @returns {{ file: string | null, entries: Map<string, Record<string, unknown>>, categories: string[] }}
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
        return String(rule.severity ?? DEFAULT_SEVERITY);
    }
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
