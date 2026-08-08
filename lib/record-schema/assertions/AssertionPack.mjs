/**
 * Assertion packs.
 *
 * A pack is a YAML document declaring sources, named selectors, and rules. It
 * may import other packs; imports merge by identifier with the importing pack
 * winning, which lets a corpus ship a base pack and a series pack that narrows
 * it without either copying the other.
 *
 * A pack is data. It contains no code, no path into the host, and nothing the
 * loader executes - the only thing the toolkit does with a pack is read it.
 *
 * @module record-schema/assertions/AssertionPack
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseYaml } from "../../parsing/yaml.mjs";
import { isPlainObject } from "./Path.mjs";

/** @typedef {import("./types/general.mjs").AssertionRule} AssertionRule */
/** @typedef {import("./types/general.mjs").ResolvedPack} ResolvedPack */
/** @typedef {import("./types/general.mjs").SourceDefinition} SourceDefinition */

const RULE_KINDS = new Set([
    "forbid",
    "require",
    "pattern",
    "unique",
    "resolve",
    "agree",
    "derive",
    "count",
    "consistent",
    "reach",
    "cycle",
    "decode",
    "digest",
    "lex",
    "path",
    "format"
]);

const RULE_ID = /^[A-Z][A-Z0-9_]*(?:\/[A-Z][A-Z0-9_]*)?$/;

/**
 * A loaded, import-resolved assertion pack.
 */
export class AssertionPack {
    /**
     * @param {ResolvedPack} resolved
     */
    constructor(resolved) {
        /** @type {ResolvedPack} */
        this.resolved = resolved;
    }

    /**
     * Load a pack, resolving imports relative to the repository root.
     *
     * Every path a pack names is resolved inside the repository and rejected if
     * it escapes, is a symlink, or is not a regular file. A rule file is data
     * the toolkit trusts about the tree it is checking; letting it name
     * `../../etc` would make the gate a file-read primitive.
     *
     * @param {string} rootDirectory
     * @param {string[]} relativePaths
     * @returns {{ pack: AssertionPack, errors: string[] }}
     */
    static load(rootDirectory, relativePaths) {
        /** @type {string[]} */
        const errors = [];

        /** @type {ResolvedPack} */
        const merged = {
            source: null,
            pack_ids: [],
            default_source: null,
            sources: {},
            selectors: {},
            tables: {},
            languages: {},
            reports: {},
            rules: []
        };

        /** @type {Set<string>} */
        const visited = new Set();

        for (let i = 0, len = relativePaths.length; i < len; i++) {
            mergePack(rootDirectory, relativePaths[i], merged, visited, errors);
        }

        if (merged.source === null && relativePaths.length > 0) {
            merged.source = relativePaths[0];
        }

        errors.push(...validatePack(merged));

        return { pack: new AssertionPack(merged), errors };
    }

    /**
     * @returns {AssertionRule[]}
     */
    getRules() {
        return this.resolved.rules;
    }

    /**
     * @returns {string[]}
     */
    getPackIds() {
        return this.resolved.pack_ids;
    }

    /**
     * @returns {Record<string, unknown>}
     */
    getReports() {
        return this.resolved.reports;
    }
}

/**
 * @param {string} rootDirectory
 * @param {string} relativePath
 * @param {ResolvedPack} merged
 * @param {Set<string>} visited
 * @param {string[]} errors
 * @returns {void}
 */
function mergePack(rootDirectory, relativePath, merged, visited, errors) {
    const absolute = containedPath(rootDirectory, relativePath);
    if (absolute === null) {
        errors.push(
            `assertion pack "${relativePath}" does not resolve to a regular file inside the repository`
        );
        return;
    }

    const canonical = relative(rootDirectory, absolute).split(sep).join("/");
    if (visited.has(canonical)) {
        return;
    }
    visited.add(canonical);

    /** @type {unknown} */
    let data;
    try {
        data = parseYaml(readFileSync(absolute, "utf8"), {
            filename: canonical
        });
    } catch (error) {
        errors.push(
            `assertion pack "${canonical}": ${
                error instanceof Error ? error.message : String(error)
            }`
        );
        return;
    }

    if (!isPlainObject(data)) {
        errors.push(`assertion pack "${canonical}" is not a mapping`);
        return;
    }

    const pack = /** @type {Record<string, any>} */ (data);

    const imports = Array.isArray(pack.imports) ? pack.imports : [];
    for (let i = 0, len = imports.length; i < len; i++) {
        const target = String(imports[i]);
        const resolvedImport = target.startsWith("/")
            ? target.slice(1)
            : join(dirname(canonical), target).split(sep).join("/");
        mergePack(rootDirectory, resolvedImport, merged, visited, errors);
    }

    if (merged.source === null) {
        merged.source = canonical;
    }
    if (typeof pack.pack_id === "string") {
        merged.pack_ids.push(pack.pack_id);
    }
    if (typeof pack.default_source === "string") {
        merged.default_source = pack.default_source;
    }

    if (isPlainObject(pack.sources)) {
        const sources = /** @type {Record<string, any>} */ (pack.sources);
        const names = Object.keys(sources);
        for (let i = 0, len = names.length; i < len; i++) {
            merged.sources[names[i]] = /** @type {SourceDefinition} */ (
                sources[names[i]]
            );
        }
    }

    if (isPlainObject(pack.tables)) {
        const tables = /** @type {Record<string, any>} */ (pack.tables);
        const names = Object.keys(tables);
        for (let i = 0, len = names.length; i < len; i++) {
            merged.tables[names[i]] = tables[names[i]];
        }
    }

    if (isPlainObject(pack.languages)) {
        const languages = /** @type {Record<string, any>} */ (pack.languages);
        const names = Object.keys(languages);
        for (let i = 0, len = names.length; i < len; i++) {
            merged.languages[names[i]] = languages[names[i]];
        }
    }

    if (isPlainObject(pack.selectors)) {
        const selectors = /** @type {Record<string, any>} */ (pack.selectors);
        const names = Object.keys(selectors);
        for (let i = 0, len = names.length; i < len; i++) {
            merged.selectors[names[i]] = selectors[names[i]];
        }
    }

    if (isPlainObject(pack.reports)) {
        const reports = /** @type {Record<string, unknown>} */ (pack.reports);
        const names = Object.keys(reports);
        for (let i = 0, len = names.length; i < len; i++) {
            merged.reports[names[i]] = reports[names[i]];
        }
    }

    if (Array.isArray(pack.rules)) {
        for (let i = 0, len = pack.rules.length; i < len; i++) {
            const rule = /** @type {AssertionRule} */ (pack.rules[i]);
            if (!isPlainObject(rule)) {
                errors.push(
                    `assertion pack "${canonical}": rules[${i}] is not a mapping`
                );
                continue;
            }
            rule.source_pack = canonical;

            const existing = merged.rules.findIndex(
                (candidate) => candidate.id === rule.id
            );
            if (existing === -1) {
                merged.rules.push(rule);
                continue;
            }
            merged.rules[existing] = rule;
        }
    }
}

/**
 * @param {ResolvedPack} pack
 * @returns {string[]}
 */
function validatePack(pack) {
    /** @type {string[]} */
    const errors = [];
    /** @type {Set<string>} */
    const seen = new Set();

    const reportNames = Object.keys(pack.reports ?? {});
    for (let i = 0, len = reportNames.length; i < len; i++) {
        const name = reportNames[i];
        const report = pack.reports[name];
        if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
            errors.push(
                `${pack.source ?? "?"}: report id ${JSON.stringify(name)} must be lower-case kebab, snake, or plain text`
            );
        }
        if (!isPlainObject(report)) {
            errors.push(`${pack.source ?? "?"}: report "${name}" is not a mapping`);
            continue;
        }
        const sections = /** @type {Record<string, unknown>} */ (report).sections;
        if (!Array.isArray(sections) || sections.length === 0) {
            errors.push(
                `${pack.source ?? "?"}: report "${name}" needs a non-empty sections array`
            );
        }
    }

    for (let i = 0, len = pack.rules.length; i < len; i++) {
        const rule = pack.rules[i];
        const label = `${rule.source_pack ?? "?"} rules[${i}]`;

        if (typeof rule.id !== "string" || !RULE_ID.test(rule.id)) {
            errors.push(
                `${label}: id must be an uppercase token, got ${JSON.stringify(
                    rule.id
                )}`
            );
            continue;
        }
        if (seen.has(rule.id)) {
            errors.push(`${label}: duplicate rule id "${rule.id}"`);
        }
        seen.add(rule.id);

        if (!RULE_KINDS.has(String(rule.kind))) {
            errors.push(
                `${label} (${rule.id}): unknown kind "${String(rule.kind)}"`
            );
            continue;
        }

        if (
            rule.severity !== undefined &&
            rule.severity !== "error" &&
            rule.severity !== "warning" &&
            rule.severity !== "advisory"
        ) {
            errors.push(
                `${label} (${rule.id}): severity must be error, warning, or advisory`
            );
        }

        const modeSeverities = rule.severity_by_mode;
        if (modeSeverities !== undefined) {
            if (!isPlainObject(modeSeverities)) {
                errors.push(
                    `${label} (${rule.id}): severity_by_mode must be a mapping`
                );
            } else {
                const names = Object.keys(modeSeverities);
                for (let j = 0, count = names.length; j < count; j++) {
                    const value = /** @type {Record<string, unknown>} */ (
                        modeSeverities
                    )[names[j]];
                    if (
                        value !== "error" &&
                        value !== "warning" &&
                        value !== "advisory"
                    ) {
                        errors.push(
                            `${label} (${rule.id}): severity_by_mode.${names[j]} must be error, warning, or advisory`
                        );
                    }
                }
            }
        }

        if (rule.modes !== undefined) {
            const modes = Array.isArray(rule.modes) ? rule.modes : [rule.modes];
            if (
                modes.length === 0 ||
                modes.some(
                    (mode) => typeof mode !== "string" || mode.length === 0
                )
            ) {
                errors.push(
                    `${label} (${rule.id}): modes must be a non-empty string or array of non-empty strings`
                );
            }
        }

        if (typeof rule.message !== "string" || rule.message.length === 0) {
            errors.push(
                `${label} (${rule.id}): a rule with no message reports a token and no instruction`
            );
        }

        errors.push(...validateRuleShape(rule, label));
    }

    return errors;
}

/**
 * @param {AssertionRule} rule
 * @param {string} label
 * @returns {string[]}
 */
function validateRuleShape(rule, label) {
    /** @type {string[]} */
    const errors = [];

    /**
     * @param {string[]} names
     * @returns {void}
     */
    const requireAny = (names) => {
        for (let i = 0, len = names.length; i < len; i++) {
            if (rule[names[i]] !== undefined) {
                return;
            }
        }
        errors.push(
            `${label} (${rule.id}): needs one of ${names
                .map((name) => `\`${name}\``)
                .join(", ")}`
        );
    };

    switch (rule.kind) {
        case "forbid":
        case "pattern":
            requireAny(["select"]);
            break;
        case "require":
            requireAny(["scope", "select"]);
            requireAny(["must"]);
            break;
        case "unique":
            requireAny(["select"]);
            requireAny(["key"]);
            break;
        case "resolve":
            requireAny(["uses"]);
            requireAny(["defines"]);
            requireAny(["use_key", "key"]);
            requireAny(["define_key", "key"]);
            break;
        case "agree":
            requireAny(["left"]);
            requireAny(["right"]);
            break;
        case "derive":
            requireAny(["scope", "select"]);
            requireAny(["assert"]);
            break;
        case "count":
            requireAny(["select", "scope"]);
            requireAny(["min", "max"]);
            break;
        case "consistent":
            requireAny(["select"]);
            requireAny(["group"]);
            requireAny(["value"]);
            break;
        case "reach":
            requireAny(["nodes"]);
            requireAny(["edges"]);
            requireAny(["node_key", "key"]);
            break;
        case "cycle":
            requireAny(["nodes"]);
            requireAny(["edges"]);
            requireAny(["node_key", "key"]);
            break;
        case "decode":
            requireAny(["layouts"]);
            requireAny(["vectors"]);
            requireAny(["layout_key"]);
            requireAny(["vector_layout_key"]);
            requireAny(["hex"]);
            requireAny(["claims"]);
            break;
        case "digest":
            requireAny(["manifest"]);
            requireAny(["tracks"]);
            break;
        case "lex":
            requireAny(["select", "scope"]);
            requireAny(["language"]);
            break;
        case "path":
            requireAny(["select", "scope"]);
            requireAny(["value", "path_value"]);
            break;
        case "format":
            requireAny(["source"]);
            requireAny(["formatter", "operation"]);
            break;
        default:
            break;
    }

    return errors;
}

/**
 * Resolve a repository-relative path, refusing traversal, symlinks, and
 * anything that is not a regular file.
 *
 * @param {string} rootDirectory
 * @param {string} relativePath
 * @returns {string | null}
 */
function containedPath(rootDirectory, relativePath) {
    if (typeof relativePath !== "string" || relativePath.length === 0) {
        return null;
    }
    if (isAbsolute(relativePath)) {
        return null;
    }

    const root = resolve(rootDirectory);
    const absolute = resolve(root, relativePath);

    if (absolute !== root && !absolute.startsWith(root + sep)) {
        return null;
    }
    if (!existsSync(absolute)) {
        return null;
    }

    let stats;
    try {
        stats = statSync(absolute, { throwIfNoEntry: true });
    } catch {
        return null;
    }
    if (!stats.isFile()) {
        return null;
    }

    let canonical;
    try {
        canonical = realpathSync(absolute);
    } catch {
        return null;
    }
    if (canonical !== absolute) {
        return null;
    }

    return absolute;
}

/**
 * Validate every supplied assertion-pack document, including transitive
 * imports, against the normative JSON Schema resolved by the repository.
 *
 * Runtime shape checks remain in `validatePack` so the assertion engine can be
 * embedded without a schema-material checkout. The authoring `validate`
 * command calls this stricter surface and therefore rejects unknown fields,
 * wrong value kinds, and malformed report/materialization declarations before
 * any rule executes.
 *
 * @param {string} rootDirectory
 * @param {string[]} relativePaths
 * @param {import("../Schema.mjs").Schema} schema
 * @returns {string[]}
 */
export function validateAssertionPackDocuments(
    rootDirectory,
    relativePaths,
    schema
) {
    /** @type {string[]} */
    const errors = [];
    /** @type {Set<string>} */
    const visited = new Set();

    /**
     * @param {string} relativePath
     * @param {string | null} importer
     * @returns {void}
     */
    const visit = (relativePath, importer) => {
        const absolute = containedPath(rootDirectory, relativePath);
        if (absolute === null) {
            errors.push(
                `${importer ?? "assertion profile"}: assertion pack ${JSON.stringify(
                    relativePath
                )} does not resolve to a regular file inside the repository`
            );
            return;
        }
        const canonical = relative(rootDirectory, absolute)
            .split(sep)
            .join("/");
        if (visited.has(canonical)) return;
        visited.add(canonical);

        /** @type {unknown} */
        let data;
        try {
            data = parseYaml(readFileSync(absolute, "utf8"), {
                filename: canonical
            });
        } catch (error) {
            errors.push(
                `${canonical}: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            return;
        }

        const schemaErrors = schema.validate(data);
        for (let i = 0, len = schemaErrors.length; i < len; i++) {
            const issue = schemaErrors[i];
            errors.push(
                `${canonical}${issue.path.length > 0 ? issue.path : ""}: ${
                    issue.message
                }`
            );
        }

        if (!isPlainObject(data)) return;
        const imports = /** @type {Record<string, unknown>} */ (data).imports;
        if (!Array.isArray(imports)) return;
        for (let i = 0, len = imports.length; i < len; i++) {
            const target = String(imports[i]);
            const resolvedImport = target.startsWith("/")
                ? target.slice(1)
                : join(dirname(canonical), target).split(sep).join("/");
            visit(resolvedImport, canonical);
        }
    };

    for (let i = 0, len = relativePaths.length; i < len; i++) {
        visit(relativePaths[i], null);
    }
    return errors;
}

export { RULE_KINDS };
