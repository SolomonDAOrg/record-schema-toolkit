/**
 * Language classification based on language-target rule records.
 * @module language-rules/LanguageClassifier
 */

import { extname } from "node:path";
import { matchGlob } from "../util/glob.mjs";
import { isArray, isString } from "../util/general.mjs";
import { isObject } from "../util/objects.mjs";
import { toPosixPath } from "../util/files.mjs";

/**
 * @typedef {object} LanguageTarget
 * @property {string} language_id
 * @property {string} language_family
 * @property {string[]} dialect_ids
 * @property {string[]} file_extensions
 * @property {string[]} parser_adapters
 * @property {Record<string, unknown>} rule
 */

/**
 * @typedef {object} ClassifiedSourceFile
 * @property {string} abs_path
 * @property {string} rel_path
 * @property {string} extension
 * @property {string} language_id
 * @property {string} language_family
 * @property {string} dialect_id
 * @property {string[]} parser_adapters
 */

const DEFAULT_TARGETS = [
    {
        language_id: "typescript",
        language_family: "ecmascript",
        dialect_ids: ["typescript"],
        file_extensions: ["ts", "tsx", "mts", "cts"],
        parser_adapters: ["parsers/typescript/Parser.mjs"],
        rule: {}
    },
    {
        language_id: "javascript",
        language_family: "ecmascript",
        dialect_ids: ["javascript"],
        file_extensions: ["js", "jsx", "mjs", "cjs"],
        parser_adapters: ["parsers/javascript/Parser.mjs"],
        rule: {}
    },
    {
        language_id: "rust",
        language_family: "rust",
        dialect_ids: ["rust"],
        file_extensions: ["rs"],
        parser_adapters: ["parsers/rust/Parser.mjs"],
        rule: {}
    },
    {
        language_id: "css-family",
        language_family: "stylesheet",
        dialect_ids: ["css", "less", "scss", "sass"],
        file_extensions: ["css", "less", "scss", "sass"],
        parser_adapters: ["parsers/css/Parser.mjs"],
        rule: {}
    },
    {
        language_id: "solidity",
        language_family: "solidity",
        dialect_ids: ["solidity"],
        file_extensions: ["sol"],
        parser_adapters: ["parsers/solidity/Parser.mjs"],
        rule: {}
    }
];

export class LanguageClassifier {
    /**
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule[]} languageTargetRules
     */
    constructor(languageTargetRules) {
        /** @type {LanguageTarget[]} */
        this.targets = this._createTargets(languageTargetRules);

        /** @type {Map<string, LanguageTarget>} */
        this.by_extension = new Map();
        for (let i = 0, len = this.targets.length; i < len; i++) {
            const target = this.targets[i];
            for (
                let j = 0, jLen = target.file_extensions.length;
                j < jLen;
                j++
            ) {
                const ext = target.file_extensions[j].toLowerCase();
                if (!this.by_extension.has(ext)) {
                    this.by_extension.set(ext, target);
                }
            }
        }
    }

    /**
     * @param {string} absPath
     * @param {string} relPath
     * @returns {ClassifiedSourceFile | null}
     */
    classify(absPath, relPath) {
        const extension = extname(relPath).replace(/^\./, "").toLowerCase();
        if (!extension) {
            return null;
        }
        const target = this.by_extension.get(extension);
        if (!target) {
            return null;
        }
        const dialect = this._dialectForExtension(extension, target);
        return {
            abs_path: absPath,
            rel_path: toPosixPath(relPath),
            extension,
            language_id: target.language_id,
            language_family: target.language_family,
            dialect_id: dialect,
            parser_adapters: target.parser_adapters.slice()
        };
    }

    /**
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule} normalizedRule
     * @param {ClassifiedSourceFile} sourceFile
     * @returns {boolean}
     */
    matchesRule(normalizedRule, sourceFile) {
        if (!normalizedRule.enabled) {
            return false;
        }
        return this.matchesTarget(normalizedRule.rule.target, sourceFile);
    }

    /**
     * @param {unknown} target
     * @param {ClassifiedSourceFile} sourceFile
     * @returns {boolean}
     */
    matchesTarget(target, sourceFile) {
        if (!isObject(target)) {
            return true;
        }
        if (isArray(target.file_extensions)) {
            let found = false;
            for (let i = 0, len = target.file_extensions.length; i < len; i++) {
                const item = target.file_extensions[i];
                if (!isString(item)) {
                    continue;
                }
                const value = item.startsWith(".")
                    ? item.slice(1).toLowerCase()
                    : item.toLowerCase();
                if (value === sourceFile.extension) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                return false;
            }
        }
        if (isArray(target.language_ids)) {
            let found = false;
            for (let i = 0, len = target.language_ids.length; i < len; i++) {
                if (target.language_ids[i] === sourceFile.language_id) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                return false;
            }
        }
        if (isArray(target.language_families)) {
            let found = false;
            for (
                let i = 0, len = target.language_families.length;
                i < len;
                i++
            ) {
                if (
                    target.language_families[i] === sourceFile.language_family
                ) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                return false;
            }
        }
        if (isArray(target.dialects)) {
            let found = false;
            for (let i = 0, len = target.dialects.length; i < len; i++) {
                if (target.dialects[i] === sourceFile.dialect_id) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                return false;
            }
        }
        if (isArray(target.file_globs)) {
            let found = false;
            for (let i = 0, len = target.file_globs.length; i < len; i++) {
                const glob = target.file_globs[i];
                if (isString(glob) && matchGlob(sourceFile.rel_path, glob)) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                return false;
            }
        }
        if (isArray(target.exclude_globs)) {
            for (let i = 0, len = target.exclude_globs.length; i < len; i++) {
                const glob = target.exclude_globs[i];
                if (isString(glob) && matchGlob(sourceFile.rel_path, glob)) {
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule[]} rules
     * @returns {LanguageTarget[]}
     */
    _createTargets(rules) {
        /** @type {LanguageTarget[]} */
        const out = [];
        for (let i = 0, len = rules.length; i < len; i++) {
            const rule = rules[i].rule;
            if (!isString(rule.language_id)) {
                continue;
            }
            out.push({
                language_id: rule.language_id,
                language_family: isString(rule.language_family)
                    ? rule.language_family
                    : "other",
                dialect_ids: this._stringArray(rule.dialect_ids),
                file_extensions: this._stringArray(rule.file_extensions),
                parser_adapters: this._stringArray(rule.parser_adapters),
                rule
            });
        }
        if (out.length > 0) {
            return out;
        }
        return DEFAULT_TARGETS.map((item) => ({
            language_id: item.language_id,
            language_family: item.language_family,
            dialect_ids: item.dialect_ids.slice(),
            file_extensions: item.file_extensions.slice(),
            parser_adapters: item.parser_adapters.slice(),
            rule: item.rule
        }));
    }

    /**
     * @param {unknown} value
     * @returns {string[]}
     */
    _stringArray(value) {
        if (!isArray(value)) {
            return [];
        }
        /** @type {string[]} */
        const out = [];
        for (let i = 0, len = value.length; i < len; i++) {
            if (isString(value[i])) {
                out.push(/** @type {string} */ (value[i]));
            }
        }
        return out;
    }

    /**
     * @param {string} extension
     * @param {LanguageTarget} target
     * @returns {string}
     */
    _dialectForExtension(extension, target) {
        if (extension === "tsx") {
            return "tsx";
        }
        if (extension === "jsx") {
            return "jsx";
        }
        if (
            extension === "scss" ||
            extension === "sass" ||
            extension === "less" ||
            extension === "css"
        ) {
            return extension;
        }
        return target.dialect_ids[0] ?? target.language_id;
    }
}
