/**
 * Concrete language-rule-set repository loader.
 * @module language-rules/LanguageRuleSetRepository
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { parseYaml } from "../parsing/yaml.mjs";
import { isArray, isString } from "../util/general.mjs";
import { isObject } from "../util/objects.mjs";
import { toPosixPath } from "../util/files.mjs";

/**
 * @typedef {object} LanguageRuleDocument
 * @property {string} abs_path
 * @property {string} rel_path
 * @property {Record<string, unknown>} data
 */

/**
 * @typedef {object} LanguageRuleSet
 * @property {string} abs_path
 * @property {string} rel_path
 * @property {string} category_type
 * @property {string} rule_set_id
 * @property {string} name
 * @property {Record<string, unknown>} defaults
 * @property {Record<string, unknown>} data
 */

/**
 * @typedef {object} NormalizedLanguageRule
 * @property {string} category_type
 * @property {string} rule_set_id
 * @property {string} rule_id
 * @property {string} name
 * @property {string} severity
 * @property {boolean} enabled
 * @property {Record<string, unknown>} rule
 * @property {LanguageRuleSet} rule_set
 */

const RULE_ARRAY_BY_CATEGORY = new Map([
    ["language-targets", "language_target_rules"],
    ["linting", "linting_rules"],
    ["style", "style_rules"],
    ["naming", "naming_rules"],
    ["ordering", "ordering_rules"],
    ["values", "value_rules"],
    ["banned-patterns", "banned_pattern_rules"],
    ["utility-catalogs", "utility_catalog_rules"],
    ["project-structure", "project_structure_rules"],
    ["transformers", "transformer_rules"]
]);

export class LanguageRuleSetRepository {
    /**
     * @param {string} root_dir
     */
    constructor(root_dir) {
        /** @type {string} */
        this.root_dir = resolve(root_dir);

        /** @type {LanguageRuleDocument[] | null} */
        this._documents = null;

        /** @type {LanguageRuleSet[] | null} */
        this._rule_sets = null;

        /** @type {NormalizedLanguageRule[] | null} */
        this._rules = null;
    }

    /**
     * @param {string} root_dir
     * @returns {LanguageRuleSetRepository}
     */
    static open(root_dir) {
        return new LanguageRuleSetRepository(root_dir);
    }

    /**
     * @returns {LanguageRuleDocument[]}
     */
    getDocuments() {
        if (this._documents) {
            return this._documents;
        }
        /** @type {LanguageRuleDocument[]} */
        const documents = [];
        const candidates = this._findYamlFiles(this.root_dir);
        for (let i = 0, len = candidates.length; i < len; i++) {
            const abs = candidates[i];
            const name = basename(abs);
            if (name.endsWith("_META.yaml") || name.endsWith("_META.yml")) {
                continue;
            }
            /** @type {unknown} */
            let parsed;
            try {
                parsed = parseYaml(readFileSync(abs, "utf8"), {
                    filename: abs
                });
            } catch {
                continue;
            }
            if (!isObject(parsed) || parsed.schema !== "language-rule-set") {
                continue;
            }
            documents.push({
                abs_path: abs,
                rel_path: this._rel(abs),
                data: parsed
            });
        }
        documents.sort((a, b) => a.rel_path.localeCompare(b.rel_path));
        this._documents = documents;
        return documents;
    }

    /**
     * @returns {LanguageRuleSet[]}
     */
    getRuleSets() {
        if (this._rule_sets) {
            return this._rule_sets;
        }
        const docs = this.getDocuments();
        /** @type {LanguageRuleSet[]} */
        const sets = [];
        for (let i = 0, len = docs.length; i < len; i++) {
            const doc = docs[i];
            const data = doc.data;
            if (!isString(data.category_type) || !isString(data.rule_set_id)) {
                continue;
            }
            sets.push({
                abs_path: doc.abs_path,
                rel_path: doc.rel_path,
                category_type: data.category_type,
                rule_set_id: data.rule_set_id,
                name: isString(data.name) ? data.name : data.rule_set_id,
                defaults: isObject(data.defaults) ? data.defaults : {},
                data
            });
        }
        this._rule_sets = sets;
        return sets;
    }

    /**
     * @returns {NormalizedLanguageRule[]}
     */
    getRules() {
        if (this._rules) {
            return this._rules;
        }
        const sets = this.getRuleSets();
        /** @type {NormalizedLanguageRule[]} */
        const out = [];
        for (let i = 0, len = sets.length; i < len; i++) {
            const set = sets[i];
            const field = RULE_ARRAY_BY_CATEGORY.get(set.category_type);
            if (!field) {
                continue;
            }
            const rawRules = set.data[field];
            if (!isArray(rawRules)) {
                continue;
            }
            for (let j = 0, jLen = rawRules.length; j < jLen; j++) {
                const raw = rawRules[j];
                if (!isObject(raw) || !isString(raw.rule_id)) {
                    continue;
                }
                const severity = isString(raw.severity)
                    ? raw.severity
                    : isString(set.defaults.severity)
                    ? set.defaults.severity
                    : "error";
                const enabled =
                    raw.enabled_by_default === false || severity === "off"
                        ? false
                        : set.defaults.enabled === false
                        ? false
                        : true;
                out.push({
                    category_type: set.category_type,
                    rule_set_id: set.rule_set_id,
                    rule_id: raw.rule_id,
                    name: isString(raw.name) ? raw.name : raw.rule_id,
                    severity,
                    enabled,
                    rule: raw,
                    rule_set: set
                });
            }
        }
        this._rules = out;
        return out;
    }

    /**
     * @param {string} categoryType
     * @returns {NormalizedLanguageRule[]}
     */
    getRulesByCategory(categoryType) {
        const rules = this.getRules();
        /** @type {NormalizedLanguageRule[]} */
        const out = [];
        for (let i = 0, len = rules.length; i < len; i++) {
            if (rules[i].category_type === categoryType) {
                out.push(rules[i]);
            }
        }
        return out;
    }

    /**
     * @returns {NormalizedLanguageRule[]}
     */
    getLanguageTargetRules() {
        return this.getRulesByCategory("language-targets");
    }

    /**
     * @returns {string[]}
     */
    getTargetExtensions() {
        /** @type {Set<string>} */
        const extensions = new Set();
        const rules = this.getRules();
        for (let i = 0, len = rules.length; i < len; i++) {
            const rule = rules[i].rule;
            this._collectExtensions(rule.target, extensions);
            this._collectExtensions(rule, extensions);
        }
        const out = Array.from(extensions);
        out.sort();
        return out;
    }

    /**
     * @param {unknown} value
     * @param {Set<string>} out
     */
    _collectExtensions(value, out) {
        if (!isObject(value) || !isArray(value.file_extensions)) {
            return;
        }
        const items = value.file_extensions;
        for (let i = 0, len = items.length; i < len; i++) {
            const item = items[i];
            if (isString(item) && item.length > 0) {
                out.add(
                    item.startsWith(".")
                        ? item.slice(1).toLowerCase()
                        : item.toLowerCase()
                );
            }
        }
    }

    /**
     * @param {string} dir
     * @returns {string[]}
     */
    _findYamlFiles(dir) {
        /** @type {string[]} */
        const out = [];
        if (!existsSync(dir)) {
            return out;
        }
        /** @type {string[]} */
        const stack = [dir];
        while (stack.length > 0) {
            const current = stack.pop() ?? dir;
            let entries;
            try {
                entries = readdirSync(current, { withFileTypes: true });
            } catch {
                continue;
            }
            for (let i = 0, len = entries.length; i < len; i++) {
                const entry = entries[i];
                const abs = resolve(current, entry.name);
                if (entry.isDirectory()) {
                    if (
                        entry.name === "node_modules" ||
                        entry.name === ".git"
                    ) {
                        continue;
                    }
                    stack.push(abs);
                    continue;
                }
                if (!entry.isFile()) {
                    continue;
                }
                const ext = extname(entry.name).toLowerCase();
                if (ext === ".yaml" || ext === ".yml") {
                    out.push(abs);
                }
            }
        }
        out.sort();
        return out;
    }

    /**
     * @param {string} abs
     * @returns {string}
     */
    _rel(abs) {
        return toPosixPath(
            abs.slice(this.root_dir.length).replace(/^[/\\]+/, "")
        );
    }
}
