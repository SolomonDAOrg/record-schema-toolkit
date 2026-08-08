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
    "decode",
    "digest"
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

    if (isPlainObject(pack.selectors)) {
        const selectors = /** @type {Record<string, any>} */ (pack.selectors);
        const names = Object.keys(selectors);
        for (let i = 0, len = names.length; i < len; i++) {
            merged.selectors[names[i]] = selectors[names[i]];
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

export { RULE_KINDS };
