/**
 * Declarative assertion reports.
 *
 * A report is a named collection of sections in an assertion pack. Table
 * sections aggregate projected selector rows; reach sections render the same
 * analysis used by reach rules. No report contains corpus-specific JavaScript.
 */

import { AssertionEngine } from "./AssertionEngine.mjs";
import { AssertionPack } from "./AssertionPack.mjs";
import { CorpusIndex } from "./CorpusIndex.mjs";
import { evaluateExpression } from "./Expression.mjs";
import { isPlainObject } from "./Path.mjs";
import { renderKey, renderTemplate } from "./Template.mjs";

/**
 * @typedef {object} AssertionReportResult
 * @property {string[]} packs
 * @property {string} report
 * @property {unknown[]} sections
 * @property {string} text
 * @property {string[]} errors
 */

/**
 * @param {string} rootDirectory
 * @param {{ packs: string[], report: string, verbose?: boolean }} options
 * @returns {AssertionReportResult}
 */
export function generateAssertionReport(rootDirectory, options) {
    const { pack, errors } = AssertionPack.load(rootDirectory, options.packs);
    if (errors.length > 0) {
        return {
            packs: pack.getPackIds(),
            report: options.report,
            sections: [],
            text: "",
            errors
        };
    }

    const index = new CorpusIndex(rootDirectory);
    const engine = new AssertionEngine(index, pack.resolved);
    return generateAssertionReportWithContext(pack, engine, options);
}

/**
 * Render a report using an already loaded pack and assertion engine.
 *
 * @param {AssertionPack} pack
 * @param {AssertionEngine} engine
 * @param {{ report: string, verbose?: boolean }} options
 * @returns {AssertionReportResult}
 */
export function generateAssertionReportWithContext(pack, engine, options) {
    /** @type {string[]} */
    const errors = [];
    const reports = pack.getReports();
    const raw = reports[options.report];
    if (!isPlainObject(raw)) {
        return {
            packs: pack.getPackIds(),
            report: options.report,
            sections: [],
            text: "",
            errors: [`unknown assertion report "${options.report}"`]
        };
    }

    const definition = /** @type {Record<string, unknown>} */ (raw);
    const rawSections = Array.isArray(definition.sections)
        ? definition.sections
        : [];
    const rules = new Map(pack.getRules().map((rule) => [rule.id, rule]));
    /** @type {unknown[]} */
    const sections = [];
    /** @type {string[]} */
    const textSections = [];

    try {
        if (typeof definition.title === "string") {
            textSections.push(definition.title);
        }
        for (let i = 0, len = rawSections.length; i < len; i++) {
            const section = rawSections[i];
            if (!isPlainObject(section)) {
                throw new Error(`sections[${i}] is not a mapping`);
            }
            const resolved = /** @type {Record<string, unknown>} */ (section);
            const kind = String(resolved.kind ?? "table");
            if (kind === "table") {
                const output = buildTableSection(
                    engine,
                    resolved,
                    options.verbose === true
                );
                sections.push(output.data);
                if (output.text.length > 0) textSections.push(output.text);
                continue;
            }
            if (kind === "reach_summary") {
                const output = buildReachSummarySection(
                    engine,
                    rules,
                    resolved
                );
                sections.push(output.data);
                if (output.text.length > 0) textSections.push(output.text);
                continue;
            }
            if (kind === "reach_catalogue") {
                const output = buildReachCatalogueSection(
                    engine,
                    rules,
                    resolved
                );
                sections.push(output.data);
                if (output.text.length > 0) textSections.push(output.text);
                continue;
            }
            if (kind === "text") {
                const text = String(resolved.text ?? "");
                sections.push({ kind, text });
                if (text.length > 0) textSections.push(text);
                continue;
            }
            throw new Error(`unknown report section kind "${kind}"`);
        }
    } catch (error) {
        errors.push(
            `${options.report}: ${
                error instanceof Error ? error.message : String(error)
            }`
        );
    }

    return {
        packs: pack.getPackIds(),
        report: options.report,
        sections,
        text:
            textSections.filter((text) => text.length > 0).join("\n\n") +
            (textSections.length > 0 ? "\n" : ""),
        errors
    };
}

/**
 * @param {AssertionEngine} engine
 * @param {Record<string, unknown>} section
 * @param {boolean} verbose
 * @returns {{ data: unknown, text: string }}
 */
function buildTableSection(engine, section, verbose) {
    const projections = engine.evaluateProjection(section);
    const groupTemplate = String(section.group ?? "{#file}");
    const columns = arrayOfMappings(section.columns, "table columns");
    const details =
        section.details === undefined
            ? []
            : arrayOfMappings(section.details, "table details");

    /** @type {Map<string, { key: string, first: { row: import("./types/general.mjs").SelectorRow, bindings: Record<string, unknown> }, projections: { row: import("./types/general.mjs").SelectorRow, bindings: Record<string, unknown> }[] }>} */
    const groups = new Map();
    for (let i = 0, len = projections.length; i < len; i++) {
        const projection = projections[i];
        const key = renderKey(
            groupTemplate,
            projection.row.value,
            projection.bindings
        );
        if (key === null) continue;
        const group = groups.get(key);
        if (group === undefined) {
            groups.set(key, {
                key,
                first: projection,
                projections: [projection]
            });
        } else {
            group.projections.push(projection);
        }
    }

    /** @type {Record<string, unknown>[]} */
    const rows = [];
    /** @type {Map<string, Record<string, unknown>[]>} */
    const detailsByGroup = new Map();
    for (const group of groups.values()) {
        /** @type {Record<string, unknown>} */
        const row = { key: group.key };
        for (let i = 0, len = columns.length; i < len; i++) {
            const column = columns[i];
            const key = requiredString(column.key, "table column needs key");
            const orderedProjections =
                column.order_by === undefined
                    ? group.projections
                    : group.projections.slice().sort((left, right) => {
                          const leftValue = resolveProjectionValue(
                              engine,
                              column.order_by,
                              left
                          );
                          const rightValue = resolveProjectionValue(
                              engine,
                              column.order_by,
                              right
                          );
                          if (
                              typeof leftValue === "number" &&
                              typeof rightValue === "number"
                          ) {
                              return leftValue - rightValue;
                          }
                          return String(leftValue ?? "").localeCompare(
                              String(rightValue ?? "")
                          );
                      });
            const values = orderedProjections.map((projection) =>
                resolveProjectionValue(
                    engine,
                    column.value ?? `#${key}`,
                    projection
                )
            );
            row[key] = aggregateValues(
                String(column.aggregate ?? "first"),
                values,
                column
            );
        }
        const computed = isPlainObject(section.computed)
            ? /** @type {Record<string, unknown>} */ (section.computed)
            : {};
        const computedNames = Object.keys(computed);
        for (let i = 0, len = computedNames.length; i < len; i++) {
            const name = computedNames[i];
            const specification = computed[name];
            row[name] =
                isPlainObject(specification) &&
                typeof (
                    /** @type {Record<string, unknown>} */ (specification)
                        .expression
                ) === "string"
                    ? evaluateExpression(
                          String(
                              /** @type {Record<string, unknown>} */ (
                                  specification
                              ).expression
                          ),
                          row
                      )
                    : specification;
        }
        rows.push(row);

        if (verbose && details.length > 0) {
            const groupDetails = [];
            for (let i = 0, len = group.projections.length; i < len; i++) {
                const projection = group.projections[i];
                if (
                    section.detail_include !== undefined &&
                    !Boolean(
                        resolveProjectionValue(
                            engine,
                            section.detail_include,
                            projection
                        )
                    )
                ) {
                    continue;
                }
                /** @type {Record<string, unknown>} */
                const detail = {};
                for (let j = 0, count = details.length; j < count; j++) {
                    const column = details[j];
                    const key = requiredString(
                        column.key,
                        "table detail needs key"
                    );
                    detail[key] = resolveProjectionValue(
                        engine,
                        column.value ?? `#${key}`,
                        projection
                    );
                }
                groupDetails.push(detail);
            }
            detailsByGroup.set(group.key, groupDetails);
        }
    }

    sortReportRows(rows, section.sort);
    const title = typeof section.title === "string" ? section.title : "";
    const rendered = renderTable(
        rows,
        columns,
        verbose ? detailsByGroup : new Map(),
        details,
        section
    );
    const text = [title, rendered].filter((part) => part.length > 0).join("\n");
    return {
        data: {
            kind: "table",
            title,
            rows,
            details: Object.fromEntries(detailsByGroup)
        },
        text
    };
}

/**
 * @param {AssertionEngine} engine
 * @param {Map<string, import("./types/general.mjs").AssertionRule>} rules
 * @param {Record<string, unknown>} section
 * @returns {{ data: unknown, text: string }}
 */
function buildReachSummarySection(engine, rules, section) {
    const ruleIds = arrayOfStrings(section.rules ?? section.rule);
    /** @type {Record<string, unknown>[]} */
    const rows = [];
    for (let i = 0, len = ruleIds.length; i < len; i++) {
        const rule = rules.get(ruleIds[i]);
        if (rule === undefined) {
            throw new Error(`reach summary names unknown rule "${ruleIds[i]}"`);
        }
        if (rule.kind !== "reach") {
            throw new Error(`report rule "${ruleIds[i]}" is not reach`);
        }
        const analysis = engine.analyzeReach(rule);
        /** @type {Record<string, number>} */
        const tiers = {};
        for (let j = 0, count = analysis.rows.length; j < count; j++) {
            const tier = analysis.rows[j].tier;
            tiers[tier] = (tiers[tier] ?? 0) + 1;
        }
        /** @type {Record<string, number>} */
        const categories = {};
        for (const entry of analysis.baseline.entries.values()) {
            const category = String(entry.category ?? "<uncategorised>");
            categories[category] = (categories[category] ?? 0) + 1;
        }
        rows.push({
            rule: rule.id,
            nodes: analysis.rows.length,
            reached: analysis.rows.filter((row) => row.reached).length,
            unreachable: analysis.rows.filter((row) => !row.reached).length,
            accepted: analysis.baseline.entries.size,
            tiers,
            categories
        });
    }

    if (Array.isArray(section.lines)) {
        /** @type {Record<string, unknown>} */
        const bindings = {};
        /** @type {Record<string, number>} */
        const combinedCategories = {};
        for (let i = 0, len = rows.length; i < len; i++) {
            const row = rows[i];
            const prefix = `#${reportBindingName(String(row.rule))}`;
            bindings[`${prefix}_nodes`] = row.nodes;
            bindings[`${prefix}_reached`] = row.reached;
            bindings[`${prefix}_unreachable`] = row.unreachable;
            bindings[`${prefix}_accepted`] = row.accepted;

            const tiers = /** @type {Record<string, number>} */ (row.tiers);
            const tierNames = Object.keys(tiers);
            for (let j = 0, count = tierNames.length; j < count; j++) {
                bindings[`${prefix}_tier_${reportBindingName(tierNames[j])}`] =
                    tiers[tierNames[j]];
            }

            const categories = /** @type {Record<string, number>} */ (
                row.categories
            );
            const categoryNames = Object.keys(categories);
            for (let j = 0, count = categoryNames.length; j < count; j++) {
                const category = categoryNames[j];
                combinedCategories[category] =
                    (combinedCategories[category] ?? 0) + categories[category];
            }
        }

        const categoryNames = Object.keys(combinedCategories);
        for (let i = 0, len = categoryNames.length; i < len; i++) {
            const category = categoryNames[i];
            bindings[`#category_${reportBindingName(category)}`] =
                combinedCategories[category];
        }

        const groups = Array.isArray(section.category_groups)
            ? section.category_groups
            : [];
        for (let i = 0, len = groups.length; i < len; i++) {
            if (!isPlainObject(groups[i])) {
                throw new Error(`category_groups[${i}] is not a mapping`);
            }
            const group = /** @type {Record<string, unknown>} */ (groups[i]);
            const key = requiredString(
                group.key,
                `category_groups[${i}] needs key`
            );
            const categories = arrayOfStrings(group.categories);
            let total = 0;
            for (let j = 0, count = categories.length; j < count; j++) {
                const categoryBinding = `#category_${reportBindingName(
                    categories[j]
                )}`;
                if (bindings[categoryBinding] === undefined) {
                    bindings[categoryBinding] = 0;
                }
                total += combinedCategories[categories[j]] ?? 0;
            }
            bindings[`#category_group_${reportBindingName(key)}`] = total;
        }

        const lines = section.lines.map((line, index) => {
            if (typeof line !== "string") {
                throw new Error(`lines[${index}] is not a string`);
            }
            return renderTemplate(line, null, bindings);
        });
        return {
            data: { kind: "reach_summary", rows },
            text: lines.join("\n")
        };
    }

    const title = String(section.title ?? "reachability summary");
    const lines = [title];
    for (let i = 0, len = rows.length; i < len; i++) {
        const row = rows[i];
        lines.push(
            `  ${String(row.rule).padEnd(24)} ${String(row.nodes).padStart(
                6
            )} nodes, ${String(row.unreachable).padStart(
                5
            )} unreachable (${String(row.accepted)} accepted)`
        );
        const tiers = /** @type {Record<string, number>} */ (row.tiers);
        const tierNames = Object.keys(tiers);
        for (let j = 0, count = tierNames.length; j < count; j++) {
            lines.push(
                `    ${tierNames[j].padEnd(30)}${String(
                    tiers[tierNames[j]]
                ).padStart(6)}`
            );
        }
        const categories = /** @type {Record<string, number>} */ (
            row.categories
        );
        const categoryNames = Object.keys(categories).sort();
        if (categoryNames.length > 0) {
            lines.push("    accepted by category");
            for (let j = 0, count = categoryNames.length; j < count; j++) {
                lines.push(
                    `      ${categoryNames[j].padEnd(28)}${String(
                        categories[categoryNames[j]]
                    ).padStart(6)}`
                );
            }
        }
    }
    return { data: { kind: "reach_summary", rows }, text: lines.join("\n") };
}

/**
 * @param {AssertionEngine} engine
 * @param {Map<string, import("./types/general.mjs").AssertionRule>} rules
 * @param {Record<string, unknown>} section
 * @returns {{ data: unknown, text: string }}
 */
function buildReachCatalogueSection(engine, rules, section) {
    const ruleId = requiredString(section.rule, "reach catalogue needs rule");
    const rule = rules.get(ruleId);
    if (rule === undefined || rule.kind !== "reach") {
        throw new Error(`reach catalogue names unknown reach rule "${ruleId}"`);
    }
    const analysis = engine.analyzeReach(rule);
    const groupTemplate = String(section.group ?? "{#group}|{#context}");
    const labelTemplate = String(section.label ?? "{#group} {#context}");
    const memberTemplate = String(section.member ?? "{#key}");
    const realisedTiers = new Set(arrayOfStrings(section.realised_tiers));
    const shownTiers = new Set(arrayOfStrings(section.show_tiers));
    /** @type {Map<string, { label: string, rows: { member: string, tier: string }[] }>} */
    const groups = new Map();

    for (let i = 0, len = analysis.rows.length; i < len; i++) {
        const subject = analysis.rows[i];
        const bindings = Object.assign({}, subject.node.row.bindings, {
            "#key": subject.key,
            "#tier": subject.tier,
            "#group": subject.node.group ?? "",
            "#context": subject.node.context ?? ""
        });
        const group = renderKey(
            groupTemplate,
            subject.node.row.value,
            bindings
        );
        if (group === null) continue;
        const label = renderTemplate(
            labelTemplate,
            subject.node.row.value,
            bindings
        );
        const member = renderTemplate(
            memberTemplate,
            subject.node.row.value,
            bindings
        );
        const bucket = groups.get(group);
        if (bucket === undefined) {
            groups.set(group, {
                label,
                rows: [{ member, tier: subject.tier }]
            });
        } else {
            bucket.rows.push({ member, tier: subject.tier });
        }
    }

    const rows = Array.from(groups.values()).map((group) => ({
        label: group.label,
        total: group.rows.length,
        realised: group.rows.filter((row) => realisedTiers.has(row.tier))
            .length,
        weak: group.rows.filter((row) => shownTiers.has(row.tier))
    }));
    if (String(section.order ?? "label") === "label") {
        rows.sort((left, right) => left.label.localeCompare(right.label));
    }

    const title = String(section.title ?? "catalogue:");
    const lines = [title];
    for (let i = 0, len = rows.length; i < len; i++) {
        const row = rows[i];
        lines.push(
            `  ${row.label}: ${row.realised}/${row.total} realised${
                row.weak.length === 0
                    ? ""
                    : ` — ${row.weak
                          .map((entry) => `${entry.member}[${entry.tier}]`)
                          .join(", ")}`
            }`
        );
    }
    return { data: { kind: "reach_catalogue", rows }, text: lines.join("\n") };
}

/**
 * @param {string} value
 * @returns {string}
 */
function reportBindingName(value) {
    return value.replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * @param {AssertionEngine} engine
 * @param {unknown} specification
 * @param {{ row: import("./types/general.mjs").SelectorRow, bindings: Record<string, unknown> }} projection
 * @returns {unknown}
 */
function resolveProjectionValue(engine, specification, projection) {
    return engine.evaluateProjectionValue(specification, projection);
}

/**
 * @param {string} operation
 * @param {unknown[]} values
 * @param {Record<string, unknown>} specification
 * @returns {unknown}
 */
function aggregateValues(operation, values, specification) {
    const compact = values.filter(
        (value) => value !== null && value !== undefined
    );
    switch (operation) {
        case "first":
            return compact.length === 0 ? null : compact[0];
        case "last":
            return compact.length === 0 ? null : compact[compact.length - 1];
        case "count":
            return specification.count_all === true
                ? values.length
                : compact.length;
        case "sum":
            return compact.reduce(
                (sum, value) => Number(sum) + Number(value),
                0
            );
        case "min":
            return compact.length === 0
                ? null
                : Math.min(...compact.map(Number));
        case "max":
            return compact.length === 0
                ? null
                : Math.max(...compact.map(Number));
        case "any":
            return compact.some(Boolean);
        case "all":
            return compact.length > 0 && compact.every(Boolean);
        case "list":
            return compact;
        case "unique_list":
            return Array.from(new Set(compact.map(String)));
        case "join": {
            const strings = compact
                .map(String)
                .filter((value) => value.length > 0);
            const selected =
                specification.unique === false
                    ? strings
                    : Array.from(new Set(strings));
            return selected.join(String(specification.separator ?? "; "));
        }
        default:
            throw new Error(`unknown report aggregate "${operation}"`);
    }
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {unknown} specification
 * @returns {void}
 */
function sortReportRows(rows, specification) {
    if (specification === undefined) return;
    const specs = Array.isArray(specification)
        ? specification
        : [specification];
    rows.sort((left, right) => {
        for (let i = 0, len = specs.length; i < len; i++) {
            const spec = isPlainObject(specs[i])
                ? /** @type {Record<string, unknown>} */ (specs[i])
                : { by: String(specs[i]) };
            const key = String(spec.by ?? "key");
            const direction =
                String(spec.direction ?? "ascending") === "descending" ? -1 : 1;
            const leftValue = left[key];
            const rightValue = right[key];
            if (
                typeof leftValue === "number" &&
                typeof rightValue === "number"
            ) {
                if (leftValue !== rightValue)
                    return (leftValue - rightValue) * direction;
                continue;
            }
            const compared = String(leftValue ?? "").localeCompare(
                String(rightValue ?? "")
            );
            if (compared !== 0) return compared * direction;
        }
        return 0;
    });
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {Record<string, unknown>[]} columns
 * @param {Map<string, Record<string, unknown>[]>} detailsByGroup
 * @param {Record<string, unknown>[]} details
 * @param {Record<string, unknown>} section
 * @returns {string}
 */
function renderTable(rows, columns, detailsByGroup, details, section) {
    const visible = columns.filter((column) => column.hidden !== true);
    const header = visible
        .map((column, index) =>
            renderCell(String(column.title ?? column.key ?? ""), column, index)
        )
        .join("");
    const lines = [header];
    for (let i = 0, len = rows.length; i < len; i++) {
        const row = rows[i];
        lines.push(
            visible
                .map((column, index) => {
                    const key = String(column.key ?? "");
                    const presentIf =
                        column.present_if === undefined
                            ? true
                            : Boolean(row[String(column.present_if)]);
                    const value = presentIf ? row[key] : null;
                    return renderCell(value, column, index);
                })
                .join("")
        );
        const groupDetails = detailsByGroup.get(String(row.key));
        if (groupDetails === undefined) continue;
        for (let j = 0, count = groupDetails.length; j < count; j++) {
            const detail = groupDetails[j];
            lines.push(
                String(section.detail_prefix ?? "    ") +
                    details
                        .filter((column) => column.hidden !== true)
                        .map((column, index) =>
                            renderCell(
                                detail[String(column.key ?? "")],
                                column,
                                index
                            )
                        )
                        .join("")
            );
        }
    }
    return lines.join("\n");
}

/**
 * @param {unknown} value
 * @param {Record<string, unknown>} column
 * @param {number} index
 * @returns {string}
 */
function renderCell(value, column, index) {
    const nullText = String(column.null ?? "-");
    const text =
        value === null || value === undefined || value === ""
            ? nullText
            : Array.isArray(value)
            ? value.map(String).join(String(column.separator ?? ", "))
            : String(value);
    const width = Number(column.width ?? 0);
    const align = String(column.align ?? "left");
    const padded =
        width <= 0
            ? text
            : align === "right"
            ? text.padStart(width)
            : text.padEnd(width);
    const gap = Number(column.gap_before ?? (index === 0 ? 0 : 2));
    return " ".repeat(Math.max(0, gap)) + padded;
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {Record<string, unknown>[]}
 */
function arrayOfMappings(value, label) {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error(`${label} must be a non-empty array`);
    }
    const out = [];
    for (let i = 0, len = value.length; i < len; i++) {
        if (!isPlainObject(value[i])) {
            throw new Error(`${label}[${i}] is not a mapping`);
        }
        out.push(/** @type {Record<string, unknown>} */ (value[i]));
    }
    return out;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function arrayOfStrings(value) {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value.map(String) : [String(value)];
}

/**
 * @param {unknown} value
 * @param {string} message
 * @returns {string}
 */
function requiredString(value, message) {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(message);
    }
    return value;
}
