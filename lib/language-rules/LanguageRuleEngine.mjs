/**
 * Language rule application engine.
 * @module language-rules/LanguageRuleEngine
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { matchGlob } from "../util/glob.mjs";
import { isArray, isString } from "../util/general.mjs";
import { isObject } from "../util/objects.mjs";
import { LanguageClassifier } from "./LanguageClassifier.mjs";
import { LanguageRuleSetRepository } from "./LanguageRuleSetRepository.mjs";
import { ParserAdapterRegistry } from "./ParserAdapterRegistry.mjs";
import { SourceFileScanner } from "./SourceFileScanner.mjs";
import {
    applyTextEdits,
    createLineStarts,
    excerptAt,
    getLineRange,
    offsetToPosition,
    splitLines
} from "./SourceText.mjs";

/**
 * @typedef {object} LanguageRuleDiagnostic
 * @property {string} severity
 * @property {string} code
 * @property {string} rule_id
 * @property {string} category_type
 * @property {string} message
 * @property {string} file
 * @property {number} line
 * @property {number} column
 * @property {number} start
 * @property {number} end
 * @property {string} [suggestion]
 * @property {import("./SourceText.mjs").TextEdit} [fix]
 */

/**
 * @typedef {object} LanguageRuleRunResult
 * @property {{ files: number, parsed: number, changed: number, diagnostics: number }} stats
 * @property {LanguageRuleDiagnostic[]} diagnostics
 */

/**
 * @typedef {object} LanguageRuleEngineOptions
 * @property {string} rules_root
 * @property {string} source_root
 * @property {string | null} [parser_root]
 * @property {boolean} [fix]
 * @property {boolean} [require_parsers]
 * @property {string[]} [include_globs]
 * @property {string[]} [exclude_globs]
 */

const TYPE_KINDS = new Set([
    "ExportInterface",
    "Interface",
    "ExportTypeAlias",
    "TypeAlias",
    "JsdocTypedef",
    "DeclareFunction",
    "DeclareClass",
    "DeclareVariable",
    "DeclareModule",
    "DeclareNamespace"
]);

const RUNTIME_KINDS = new Set([
    "ExportFunction",
    "ExportConstObject",
    "ExportEnum",
    "ExportClass",
    "ExportDefault",
    "ExportNamed",
    "Function",
    "Class",
    "VariableDeclaration",
    "ExportConstEnum",
    "ConstEnum",
    "Namespace"
]);

export class LanguageRuleEngine {
    /**
     * @param {LanguageRuleEngineOptions} options
     */
    constructor(options) {
        /** @type {string} */
        this.rules_root = resolve(options.rules_root);
        /** @type {string} */
        this.source_root = resolve(options.source_root);
        /** @type {string | null} */
        this.parser_root = options.parser_root
            ? resolve(options.parser_root)
            : null;
        /** @type {boolean} */
        this.fix = options.fix === true;
        /** @type {boolean} */
        this.require_parsers = options.require_parsers === true;
        /** @type {string[]} */
        this.include_globs = options.include_globs ?? [];
        /** @type {string[]} */
        this.exclude_globs = options.exclude_globs ?? [];
    }

    /**
     * @returns {Promise<LanguageRuleRunResult>}
     */
    async run() {
        const repository = LanguageRuleSetRepository.open(this.rules_root);
        const rules = repository.getRules();
        const classifier = new LanguageClassifier(
            repository.getLanguageTargetRules()
        );
        const parserRegistry = new ParserAdapterRegistry({
            parser_root: this.parser_root,
            require_parsers: this.require_parsers
        });
        const extensions = repository.getTargetExtensions();
        const scanner = new SourceFileScanner(this.source_root, extensions, {
            include_globs: this.include_globs,
            exclude_globs: this.exclude_globs
        });
        const files = scanner.scan();
        /** @type {LanguageRuleDiagnostic[]} */
        const diagnostics = [];
        let parsed = 0;
        let changed = 0;
        for (let i = 0, len = files.length; i < len; i++) {
            const entry = files[i];
            const classified = classifier.classify(
                entry.abs_path,
                entry.rel_path
            );
            if (!classified) {
                continue;
            }
            const text = readFileSync(entry.abs_path, "utf8");
            const applicable = this._applicableRules(
                rules,
                classifier,
                classified
            );
            const result = await this._applyToFile(
                classified,
                text,
                applicable,
                parserRegistry
            );
            diagnostics.push(...result.diagnostics);
            if (result.parsed) {
                parsed += 1;
            }
            if (this.fix && result.edits.length > 0) {
                const applied = applyTextEdits(text, result.edits);
                if (applied.applied > 0 && applied.text !== text) {
                    writeFileSync(entry.abs_path, applied.text);
                    changed += 1;
                }
            }
        }
        return {
            stats: {
                files: files.length,
                parsed,
                changed,
                diagnostics: diagnostics.length
            },
            diagnostics
        };
    }

    /**
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule[]} rules
     * @param {LanguageClassifier} classifier
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @returns {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule[]}
     */
    _applicableRules(rules, classifier, sourceFile) {
        /** @type {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule[]} */
        const out = [];
        for (let i = 0, len = rules.length; i < len; i++) {
            if (rules[i].category_type === "language-targets") {
                continue;
            }
            if (classifier.matchesRule(rules[i], sourceFile)) {
                out.push(rules[i]);
            }
        }
        return out;
    }

    /**
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @param {string} text
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule[]} rules
     * @param {ParserAdapterRegistry} parserRegistry
     * @returns {Promise<{ diagnostics: LanguageRuleDiagnostic[], edits: import("./SourceText.mjs").TextEdit[], parsed: boolean }>}
     */
    async _applyToFile(sourceFile, text, rules, parserRegistry) {
        /** @type {LanguageRuleDiagnostic[]} */
        const diagnostics = [];
        /** @type {import("./SourceText.mjs").TextEdit[]} */
        const edits = [];
        const lineStarts = createLineStarts(text);

        this._applyTextRules(
            sourceFile,
            text,
            lineStarts,
            rules,
            diagnostics,
            edits
        );

        const needsParser = this._needsParser(rules);
        let parsed = false;
        /** @type {Record<string, unknown> | null} */
        let ast = null;
        if (needsParser) {
            const parsedResult = await parserRegistry.parse(sourceFile, text);
            if (parsedResult.ast) {
                parsed = true;
                ast = parsedResult.ast;
            }
            for (
                let i = 0, len = parsedResult.diagnostics.length;
                i < len;
                i++
            ) {
                const diagnostic = parsedResult.diagnostics[i];
                diagnostics.push(
                    this._diagnostic({
                        sourceFile,
                        lineStarts,
                        start: 0,
                        end: 0,
                        category_type: "parser",
                        rule_id: diagnostic.code,
                        severity: diagnostic.severity,
                        code: diagnostic.code,
                        message: diagnostic.message
                    })
                );
            }
        }
        if (ast) {
            this._applyAstRules(
                sourceFile,
                text,
                lineStarts,
                ast,
                rules,
                diagnostics,
                edits
            );
        }
        return { diagnostics, edits, parsed };
    }

    /**
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule[]} rules
     * @returns {boolean}
     */
    _needsParser(rules) {
        for (let i = 0, len = rules.length; i < len; i++) {
            const rule = rules[i];
            if (rule.category_type === "linting") {
                const kind = rule.rule.lint_kind;
                if (
                    kind === "return-types" ||
                    kind === "unused-symbols" ||
                    kind === "imports" ||
                    kind === "parser-diagnostics"
                ) {
                    return true;
                }
            }
            if (
                rule.category_type === "style" ||
                rule.category_type === "naming" ||
                rule.category_type === "ordering"
            ) {
                return true;
            }
            if (
                rule.category_type === "project-structure" &&
                rule.rule.structure_kind === "separation-of-concerns"
            ) {
                return true;
            }
            if (
                rule.category_type === "values" &&
                sourceLikeValueKind(rule.rule.value_kind)
            ) {
                return true;
            }
        }
        return false;
    }

    /**
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @param {string} text
     * @param {number[]} lineStarts
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule[]} rules
     * @param {LanguageRuleDiagnostic[]} diagnostics
     * @param {import("./SourceText.mjs").TextEdit[]} edits
     */
    _applyTextRules(sourceFile, text, lineStarts, rules, diagnostics, edits) {
        for (let i = 0, len = rules.length; i < len; i++) {
            const normalizedRule = rules[i];
            const rule = normalizedRule.rule;
            if (normalizedRule.category_type === "linting") {
                if (rule.lint_kind === "indentation") {
                    this._checkIndentation(
                        sourceFile,
                        text,
                        lineStarts,
                        normalizedRule,
                        diagnostics,
                        edits
                    );
                } else if (rule.lint_kind === "line-width") {
                    this._checkLineWidth(
                        sourceFile,
                        text,
                        lineStarts,
                        normalizedRule,
                        diagnostics
                    );
                }
            } else if (normalizedRule.category_type === "banned-patterns") {
                this._checkBannedPattern(
                    sourceFile,
                    text,
                    lineStarts,
                    normalizedRule,
                    diagnostics
                );
            } else if (normalizedRule.category_type === "utility-catalogs") {
                this._checkUtilityCatalog(
                    sourceFile,
                    text,
                    lineStarts,
                    normalizedRule,
                    diagnostics
                );
            } else if (normalizedRule.category_type === "project-structure") {
                this._checkProjectStructureText(
                    sourceFile,
                    text,
                    lineStarts,
                    normalizedRule,
                    diagnostics
                );
            } else if (
                normalizedRule.category_type === "values" &&
                sourceFile.language_family === "stylesheet"
            ) {
                this._checkStylesheetValueText(
                    sourceFile,
                    text,
                    lineStarts,
                    normalizedRule,
                    diagnostics
                );
            } else if (
                normalizedRule.category_type === "naming" &&
                sourceFile.language_family === "stylesheet"
            ) {
                this._checkStylesheetNamingText(
                    sourceFile,
                    text,
                    lineStarts,
                    normalizedRule,
                    diagnostics
                );
            }
        }
    }

    /**
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @param {string} text
     * @param {number[]} lineStarts
     * @param {Record<string, unknown>} ast
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule[]} rules
     * @param {LanguageRuleDiagnostic[]} diagnostics
     * @param {import("./SourceText.mjs").TextEdit[]} edits
     */
    _applyAstRules(
        sourceFile,
        text,
        lineStarts,
        ast,
        rules,
        diagnostics,
        edits
    ) {
        for (let i = 0, len = rules.length; i < len; i++) {
            const normalizedRule = rules[i];
            const rule = normalizedRule.rule;
            if (normalizedRule.category_type === "linting") {
                if (rule.lint_kind === "return-types") {
                    this._checkReturnTypes(
                        sourceFile,
                        lineStarts,
                        ast,
                        normalizedRule,
                        diagnostics
                    );
                } else if (rule.lint_kind === "imports") {
                    this._checkImportHygiene(
                        sourceFile,
                        lineStarts,
                        ast,
                        normalizedRule,
                        diagnostics
                    );
                } else if (rule.lint_kind === "parser-diagnostics") {
                    this._checkParserDiagnostics(
                        sourceFile,
                        lineStarts,
                        ast,
                        normalizedRule,
                        diagnostics
                    );
                }
            } else if (normalizedRule.category_type === "style") {
                this._checkStyle(
                    sourceFile,
                    lineStarts,
                    ast,
                    normalizedRule,
                    diagnostics
                );
            } else if (normalizedRule.category_type === "naming") {
                this._checkNaming(
                    sourceFile,
                    lineStarts,
                    ast,
                    normalizedRule,
                    diagnostics
                );
            } else if (normalizedRule.category_type === "ordering") {
                this._checkOrdering(
                    sourceFile,
                    lineStarts,
                    ast,
                    normalizedRule,
                    diagnostics
                );
            } else if (normalizedRule.category_type === "project-structure") {
                this._checkProjectStructureAst(
                    sourceFile,
                    lineStarts,
                    ast,
                    normalizedRule,
                    diagnostics
                );
            } else if (normalizedRule.category_type === "values") {
                this._checkAstValues(
                    sourceFile,
                    lineStarts,
                    ast,
                    normalizedRule,
                    diagnostics
                );
            }
        }
    }

    /**
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @param {string} text
     * @param {number[]} lineStarts
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule} normalizedRule
     * @param {LanguageRuleDiagnostic[]} diagnostics
     * @param {import("./SourceText.mjs").TextEdit[]} edits
     */
    _checkIndentation(
        sourceFile,
        text,
        lineStarts,
        normalizedRule,
        diagnostics,
        edits
    ) {
        const enforce = isObject(normalizedRule.rule.enforce)
            ? normalizedRule.rule.enforce
            : {};
        if (enforce.disallow_tabs !== true) {
            return;
        }
        const indentWidth =
            typeof enforce.indent_width === "number" ? enforce.indent_width : 4;
        for (let i = 0, len = lineStarts.length; i < len; i++) {
            const range = getLineRange(text, lineStarts, i);
            let tabEnd = range.start;
            while (tabEnd < range.end && text.charCodeAt(tabEnd) === 9) {
                tabEnd += 1;
            }
            if (tabEnd === range.start) {
                continue;
            }
            const spaces = " ".repeat((tabEnd - range.start) * indentWidth);
            diagnostics.push(
                this._diagnostic({
                    sourceFile,
                    lineStarts,
                    start: range.start,
                    end: tabEnd,
                    category_type: normalizedRule.category_type,
                    rule_id: normalizedRule.rule_id,
                    severity: normalizedRule.severity,
                    code: "language-rule.indentation.tabs",
                    message: "Leading tab indentation is not allowed.",
                    suggestion: `Replace leading tabs with ${indentWidth} spaces each.`,
                    fix: { start: range.start, end: tabEnd, text: spaces }
                })
            );
            edits.push({ start: range.start, end: tabEnd, text: spaces });
        }
    }

    /**
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @param {string} text
     * @param {number[]} lineStarts
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule} normalizedRule
     * @param {LanguageRuleDiagnostic[]} diagnostics
     */
    _checkLineWidth(sourceFile, text, lineStarts, normalizedRule, diagnostics) {
        const enforce = isObject(normalizedRule.rule.enforce)
            ? normalizedRule.rule.enforce
            : {};
        const maxColumns =
            typeof enforce.max_columns === "number" ? enforce.max_columns : 120;
        for (let i = 0, len = lineStarts.length; i < len; i++) {
            const range = getLineRange(text, lineStarts, i);
            const line = text.slice(range.start, range.end);
            if (line.length <= maxColumns) {
                continue;
            }
            const trimmed = line.trimStart();
            if (
                enforce.ignore_import_export_lines === true &&
                (trimmed.startsWith("import ") || trimmed.startsWith("export "))
            ) {
                continue;
            }
            diagnostics.push(
                this._diagnostic({
                    sourceFile,
                    lineStarts,
                    start: range.start + maxColumns,
                    end: range.end,
                    category_type: normalizedRule.category_type,
                    rule_id: normalizedRule.rule_id,
                    severity: normalizedRule.severity,
                    code: "language-rule.line-width",
                    message: `Line exceeds ${maxColumns} columns (${line.length}).`
                })
            );
        }
    }

    /**
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @param {string} text
     * @param {number[]} lineStarts
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule} normalizedRule
     * @param {LanguageRuleDiagnostic[]} diagnostics
     */
    _checkBannedPattern(
        sourceFile,
        text,
        lineStarts,
        normalizedRule,
        diagnostics
    ) {
        const rule = normalizedRule.rule;
        if (rule.pattern_kind === "semantic-probe") {
            const matches = findPointlessTypeofMemberProbes(text);
            for (let i = 0, len = matches.length; i < len; i++) {
                diagnostics.push(
                    this._diagnostic({
                        sourceFile,
                        lineStarts,
                        start: matches[i].start,
                        end: matches[i].end,
                        category_type: normalizedRule.category_type,
                        rule_id: normalizedRule.rule_id,
                        severity: normalizedRule.severity,
                        code: "language-rule.banned.semantic-probe",
                        message: isString(rule.why_banned)
                            ? rule.why_banned
                            : "Banned semantic probe pattern.",
                        suggestion: firstString(rule.allowed_replacements)
                    })
                );
            }
            return;
        }
        /** @type {string[]} */
        const patterns = [];
        if (isString(rule.pattern)) {
            patterns.push(rule.pattern);
        }
        if (isArray(rule.patterns)) {
            for (let i = 0, len = rule.patterns.length; i < len; i++) {
                if (isString(rule.patterns[i])) {
                    patterns.push(/** @type {string} */ (rule.patterns[i]));
                }
            }
        }
        for (let i = 0, len = patterns.length; i < len; i++) {
            this._findLiteralPattern(
                sourceFile,
                text,
                lineStarts,
                normalizedRule,
                diagnostics,
                patterns[i],
                "language-rule.banned.pattern"
            );
        }
    }

    /**
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @param {string} text
     * @param {number[]} lineStarts
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule} normalizedRule
     * @param {LanguageRuleDiagnostic[]} diagnostics
     */
    _checkUtilityCatalog(
        sourceFile,
        text,
        lineStarts,
        normalizedRule,
        diagnostics
    ) {
        const aliases = isArray(normalizedRule.rule.banned_aliases)
            ? normalizedRule.rule.banned_aliases
            : [];
        for (let i = 0, len = aliases.length; i < len; i++) {
            const alias = aliases[i];
            if (!isString(alias)) {
                continue;
            }
            this._findLiteralPattern(
                sourceFile,
                text,
                lineStarts,
                normalizedRule,
                diagnostics,
                alias,
                "language-rule.utility.banned-alias"
            );
        }
    }

    /**
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @param {string} text
     * @param {number[]} lineStarts
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule} normalizedRule
     * @param {LanguageRuleDiagnostic[]} diagnostics
     * @param {string} pattern
     * @param {string} code
     */
    _findLiteralPattern(
        sourceFile,
        text,
        lineStarts,
        normalizedRule,
        diagnostics,
        pattern,
        code
    ) {
        if (pattern.length === 0 || pattern.includes("...")) {
            return;
        }
        let idx = text.indexOf(pattern);
        while (idx >= 0) {
            diagnostics.push(
                this._diagnostic({
                    sourceFile,
                    lineStarts,
                    start: idx,
                    end: idx + pattern.length,
                    category_type: normalizedRule.category_type,
                    rule_id: normalizedRule.rule_id,
                    severity: normalizedRule.severity,
                    code,
                    message: `Banned pattern found: ${pattern}`,
                    suggestion: firstString(
                        normalizedRule.rule.allowed_replacements
                    )
                })
            );
            idx = text.indexOf(pattern, idx + pattern.length);
        }
    }

    /**
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @param {string} text
     * @param {number[]} lineStarts
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule} normalizedRule
     * @param {LanguageRuleDiagnostic[]} diagnostics
     */
    _checkProjectStructureText(
        sourceFile,
        text,
        lineStarts,
        normalizedRule,
        diagnostics
    ) {
        const rule = normalizedRule.rule;
        if (!matchesPathGlobs(sourceFile.rel_path, rule.path_globs)) {
            return;
        }
        if (
            rule.structure_kind === "file-naming" &&
            isString(rule.file_name_regex)
        ) {
            let re;
            try {
                re = new RegExp(rule.file_name_regex);
            } catch {
                return;
            }
            if (!re.test(basename(sourceFile.rel_path))) {
                diagnostics.push(
                    this._diagnostic({
                        sourceFile,
                        lineStarts,
                        start: 0,
                        end: 0,
                        category_type: normalizedRule.category_type,
                        rule_id: normalizedRule.rule_id,
                        severity: normalizedRule.severity,
                        code: "language-rule.project.file-name",
                        message: `File name does not match ${rule.file_name_regex}`
                    })
                );
            }
        } else if (
            rule.structure_kind === "max-lines" &&
            typeof rule.max_lines === "number"
        ) {
            if (
                matchesPathGlobs(sourceFile.rel_path, rule.generated_exemptions)
            ) {
                return;
            }
            const count = splitLines(text).length;
            if (count > rule.max_lines) {
                diagnostics.push(
                    this._diagnostic({
                        sourceFile,
                        lineStarts,
                        start: text.length,
                        end: text.length,
                        category_type: normalizedRule.category_type,
                        rule_id: normalizedRule.rule_id,
                        severity: normalizedRule.severity,
                        code: "language-rule.project.max-lines",
                        message: `File has ${count} lines; maximum is ${rule.max_lines}.`
                    })
                );
            }
        }
    }

    /**
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @param {string} text
     * @param {number[]} lineStarts
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule} normalizedRule
     * @param {LanguageRuleDiagnostic[]} diagnostics
     */
    _checkStylesheetValueText(
        sourceFile,
        text,
        lineStarts,
        normalizedRule,
        diagnostics
    ) {
        const rule = normalizedRule.rule;
        if (isArray(rule.banned_literals)) {
            for (let i = 0, len = rule.banned_literals.length; i < len; i++) {
                const literal = rule.banned_literals[i];
                if (!isString(literal)) {
                    continue;
                }
                this._findLiteralPattern(
                    sourceFile,
                    text,
                    lineStarts,
                    normalizedRule,
                    diagnostics,
                    literal,
                    "language-rule.value.banned-literal"
                );
            }
        }
        if (
            rule.prefer_custom_properties === true &&
            rule.value_kind === "css-custom-property"
        ) {
            const matches = findRawStylesheetValues(text);
            for (let i = 0, len = matches.length; i < len; i++) {
                diagnostics.push(
                    this._diagnostic({
                        sourceFile,
                        lineStarts,
                        start: matches[i].start,
                        end: matches[i].end,
                        category_type: normalizedRule.category_type,
                        rule_id: normalizedRule.rule_id,
                        severity: normalizedRule.severity,
                        code: "language-rule.value.prefer-custom-property",
                        message: `Prefer token/custom property value over raw literal: ${matches[i].value}`,
                        suggestion:
                            "Use var(--token-name) when a matching token exists."
                    })
                );
            }
        }
    }

    /**
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @param {string} text
     * @param {number[]} lineStarts
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule} normalizedRule
     * @param {LanguageRuleDiagnostic[]} diagnostics
     */
    _checkStylesheetNamingText(
        sourceFile,
        text,
        lineStarts,
        normalizedRule,
        diagnostics
    ) {
        const rule = normalizedRule.rule;
        if (rule.naming_kind !== "casing" || !isArray(rule.required_prefixes)) {
            return;
        }
        const matches = findCssCustomProperties(text);
        for (let i = 0, len = matches.length; i < len; i++) {
            const name = matches[i].name;
            if (!isKebabCssCustomProperty(name)) {
                diagnostics.push(
                    this._diagnostic({
                        sourceFile,
                        lineStarts,
                        start: matches[i].start,
                        end: matches[i].end,
                        category_type: normalizedRule.category_type,
                        rule_id: normalizedRule.rule_id,
                        severity: normalizedRule.severity,
                        code: "language-rule.naming.css-custom-property-casing",
                        message: `CSS custom property is not lower kebab-case: ${name}`
                    })
                );
                continue;
            }
            let prefixMatched = false;
            for (
                let j = 0, jLen = rule.required_prefixes.length;
                j < jLen;
                j++
            ) {
                if (
                    isString(rule.required_prefixes[j]) &&
                    name.startsWith(
                        /** @type {string} */ (rule.required_prefixes[j])
                    )
                ) {
                    prefixMatched = true;
                    break;
                }
            }
            if (!prefixMatched) {
                diagnostics.push(
                    this._diagnostic({
                        sourceFile,
                        lineStarts,
                        start: matches[i].start,
                        end: matches[i].end,
                        category_type: normalizedRule.category_type,
                        rule_id: normalizedRule.rule_id,
                        severity: normalizedRule.severity,
                        code: "language-rule.naming.css-custom-property-prefix",
                        message: `CSS custom property lacks a configured namespace prefix: ${name}`
                    })
                );
            }
        }
    }

    /**
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @param {number[]} lineStarts
     * @param {Record<string, unknown>} ast
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule} normalizedRule
     * @param {LanguageRuleDiagnostic[]} diagnostics
     */
    _checkReturnTypes(
        sourceFile,
        lineStarts,
        ast,
        normalizedRule,
        diagnostics
    ) {
        const nodes = getAstNodes(ast);
        for (let i = 0, len = nodes.length; i < len; i++) {
            const node = nodes[i];
            if (!isObject(node)) {
                continue;
            }
            if (node.kind === "ExportFunction" && !node.returnType) {
                diagnostics.push(
                    this._nodeDiagnostic(
                        sourceFile,
                        lineStarts,
                        node,
                        normalizedRule,
                        "language-rule.return-type.missing",
                        `Exported function ${
                            node.name ?? "(anonymous)"
                        } is missing an explicit return type.`
                    )
                );
            } else if (
                node.kind === "ExportConstObject" &&
                isObject(node.arrowSignature) &&
                !node.arrowSignature.returnType
            ) {
                diagnostics.push(
                    this._nodeDiagnostic(
                        sourceFile,
                        lineStarts,
                        node,
                        normalizedRule,
                        "language-rule.return-type.missing",
                        `Exported arrow function ${
                            node.name ?? "(anonymous)"
                        } is missing an explicit return type.`
                    )
                );
            }
        }
    }

    /**
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @param {number[]} lineStarts
     * @param {Record<string, unknown>} ast
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule} normalizedRule
     * @param {LanguageRuleDiagnostic[]} diagnostics
     */
    _checkImportHygiene(
        sourceFile,
        lineStarts,
        ast,
        normalizedRule,
        diagnostics
    ) {
        const nodes = getAstNodes(ast);
        /** @type {Map<string, Record<string, unknown>>} */
        const seen = new Map();
        for (let i = 0, len = nodes.length; i < len; i++) {
            const node = nodes[i];
            if (
                !isObject(node) ||
                node.kind !== "Import" ||
                !isString(node.source)
            ) {
                continue;
            }
            const key = node.source;
            if (seen.has(key)) {
                diagnostics.push(
                    this._nodeDiagnostic(
                        sourceFile,
                        lineStarts,
                        node,
                        normalizedRule,
                        "language-rule.import.duplicate",
                        `Duplicate import source: ${key}`
                    )
                );
            } else {
                seen.set(key, node);
            }
            if (
                node.importType === "namespace" &&
                getNestedBoolean(
                    normalizedRule.rule,
                    "enforce.disallow_namespace_imports_unless_allowed"
                ) === true
            ) {
                diagnostics.push(
                    this._nodeDiagnostic(
                        sourceFile,
                        lineStarts,
                        node,
                        normalizedRule,
                        "language-rule.import.namespace",
                        `Namespace import is not allowed by default: ${key}`
                    )
                );
            }
        }
    }

    /**
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @param {number[]} lineStarts
     * @param {Record<string, unknown>} ast
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule} normalizedRule
     * @param {LanguageRuleDiagnostic[]} diagnostics
     */
    _checkParserDiagnostics(
        sourceFile,
        lineStarts,
        ast,
        normalizedRule,
        diagnostics
    ) {
        if (!isArray(ast.diagnostics)) {
            return;
        }
        for (let i = 0, len = ast.diagnostics.length; i < len; i++) {
            const item = ast.diagnostics[i];
            if (!isObject(item)) {
                continue;
            }
            const start = typeof item.start === "number" ? item.start : 0;
            const end = typeof item.end === "number" ? item.end : start;
            diagnostics.push(
                this._diagnostic({
                    sourceFile,
                    lineStarts,
                    start,
                    end,
                    category_type: normalizedRule.category_type,
                    rule_id: normalizedRule.rule_id,
                    severity: normalizedRule.severity,
                    code: "language-rule.parser-diagnostic",
                    message: isString(item.message)
                        ? item.message
                        : "Parser recovery diagnostic."
                })
            );
        }
    }

    /**
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @param {number[]} lineStarts
     * @param {Record<string, unknown>} ast
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule} normalizedRule
     * @param {LanguageRuleDiagnostic[]} diagnostics
     */
    _checkStyle(sourceFile, lineStarts, ast, normalizedRule, diagnostics) {
        const rule = normalizedRule.rule;
        const nodes = getAstNodes(ast);
        for (let i = 0, len = nodes.length; i < len; i++) {
            const node = nodes[i];
            if (!isObject(node)) {
                continue;
            }
            if (
                rule.rule_id === "export-function-declaration" &&
                node.kind === "ExportConstObject" &&
                isObject(node.arrowSignature)
            ) {
                diagnostics.push(
                    this._nodeDiagnostic(
                        sourceFile,
                        lineStarts,
                        node,
                        normalizedRule,
                        "language-rule.style.export-function-declaration",
                        `Use export function declaration instead of exported const arrow for ${
                            node.name ?? "(anonymous)"
                        }.`
                    )
                );
            } else if (
                rule.rule_id === "no-default-exports" &&
                (node.kind === "ExportDefault" || node.isDefault === true)
            ) {
                diagnostics.push(
                    this._nodeDiagnostic(
                        sourceFile,
                        lineStarts,
                        node,
                        normalizedRule,
                        "language-rule.style.no-default-export",
                        "Default export is not allowed."
                    )
                );
            }
        }
    }

    /**
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @param {number[]} lineStarts
     * @param {Record<string, unknown>} ast
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule} normalizedRule
     * @param {LanguageRuleDiagnostic[]} diagnostics
     */
    _checkNaming(sourceFile, lineStarts, ast, normalizedRule, diagnostics) {
        const rule = normalizedRule.rule;
        const nodes = getAstNodes(ast);
        for (let i = 0, len = nodes.length; i < len; i++) {
            const node = nodes[i];
            if (
                !isObject(node) ||
                !isString(node.name) ||
                node.name.length === 0
            ) {
                continue;
            }
            const symbolKind = symbolKindForNode(node);
            if (
                rule.naming_kind === "casing" &&
                isObject(rule.case_policy_by_symbol_kind)
            ) {
                const expected = rule.case_policy_by_symbol_kind[symbolKind];
                if (isString(expected) && !matchesCasing(node.name, expected)) {
                    diagnostics.push(
                        this._nodeDiagnostic(
                            sourceFile,
                            lineStarts,
                            node,
                            normalizedRule,
                            "language-rule.naming.casing",
                            `${symbolKind} ${node.name} must use ${expected}.`
                        )
                    );
                }
            } else if (rule.naming_kind === "brevity") {
                const minimum =
                    typeof rule.min_identifier_length === "number"
                        ? rule.min_identifier_length
                        : 0;
                const maximum =
                    typeof rule.max_identifier_length === "number"
                        ? rule.max_identifier_length
                        : 9999;
                if (
                    node.name.length < minimum &&
                    !stringArrayContains(
                        rule.allowed_short_local_names,
                        node.name
                    ) &&
                    !stringArrayContains(
                        rule.allowed_standard_abbreviations,
                        node.name
                    )
                ) {
                    diagnostics.push(
                        this._nodeDiagnostic(
                            sourceFile,
                            lineStarts,
                            node,
                            normalizedRule,
                            "language-rule.naming.too-short",
                            `Identifier is too short: ${node.name}`
                        )
                    );
                } else if (node.name.length > maximum) {
                    diagnostics.push(
                        this._nodeDiagnostic(
                            sourceFile,
                            lineStarts,
                            node,
                            normalizedRule,
                            "language-rule.naming.too-long",
                            `Identifier is too long: ${node.name}`
                        )
                    );
                }
            } else if (rule.naming_kind === "vocabulary") {
                if (stringArrayContains(rule.banned_terms, node.name)) {
                    diagnostics.push(
                        this._nodeDiagnostic(
                            sourceFile,
                            lineStarts,
                            node,
                            normalizedRule,
                            "language-rule.naming.banned-term",
                            `Banned project vocabulary term: ${node.name}`
                        )
                    );
                }
                if (isObject(rule.preferred_terms)) {
                    const replacement = rule.preferred_terms[node.name];
                    if (isString(replacement)) {
                        const d = this._nodeDiagnostic(
                            sourceFile,
                            lineStarts,
                            node,
                            normalizedRule,
                            "language-rule.naming.preferred-term",
                            `Use ${replacement} instead of ${node.name}.`
                        );
                        d.suggestion = replacement;
                        diagnostics.push(d);
                    }
                }
            }
        }
    }

    /**
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @param {number[]} lineStarts
     * @param {Record<string, unknown>} ast
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule} normalizedRule
     * @param {LanguageRuleDiagnostic[]} diagnostics
     */
    _checkOrdering(sourceFile, lineStarts, ast, normalizedRule, diagnostics) {
        const rule = normalizedRule.rule;
        if (
            rule.ordered_surface !== "imports" ||
            rule.order_strategy !== "grouped"
        ) {
            return;
        }
        const imports = getAstNodes(ast).filter(
            (node) =>
                isObject(node) &&
                node.kind === "Import" &&
                isString(node.source)
        );
        let lastKey = "";
        for (let i = 0, len = imports.length; i < len; i++) {
            const node = imports[i];
            const source = String(node.source);
            const key = `${importGroupRank(source)}:${source.toLowerCase()}`;
            if (lastKey && key < lastKey) {
                diagnostics.push(
                    this._nodeDiagnostic(
                        sourceFile,
                        lineStarts,
                        node,
                        normalizedRule,
                        "language-rule.ordering.imports",
                        `Import is not in grouped sorted order: ${source}`
                    )
                );
            }
            lastKey = key;
        }
    }

    /**
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @param {number[]} lineStarts
     * @param {Record<string, unknown>} ast
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule} normalizedRule
     * @param {LanguageRuleDiagnostic[]} diagnostics
     */
    _checkProjectStructureAst(
        sourceFile,
        lineStarts,
        ast,
        normalizedRule,
        diagnostics
    ) {
        const rule = normalizedRule.rule;
        if (rule.structure_kind !== "separation-of-concerns") {
            return;
        }
        if (!matchesPathGlobs(sourceFile.rel_path, rule.path_globs)) {
            return;
        }
        if (matchesPathGlobs(sourceFile.rel_path, rule.allowed_mixed_files)) {
            return;
        }
        const nodes = getAstNodes(ast);
        let hasType = false;
        let hasRuntime = false;
        for (let i = 0, len = nodes.length; i < len; i++) {
            const node = nodes[i];
            if (!isObject(node) || !isString(node.kind)) {
                continue;
            }
            if (TYPE_KINDS.has(node.kind)) {
                hasType = true;
            } else if (RUNTIME_KINDS.has(node.kind)) {
                hasRuntime = true;
            }
        }
        if (
            hasType &&
            hasRuntime &&
            rule.disallow_mixed_type_and_runtime_exports === true
        ) {
            diagnostics.push(
                this._diagnostic({
                    sourceFile,
                    lineStarts,
                    start: 0,
                    end: 0,
                    category_type: normalizedRule.category_type,
                    rule_id: normalizedRule.rule_id,
                    severity: normalizedRule.severity,
                    code: "language-rule.project.mixed-type-runtime",
                    message:
                        "File mixes exported type surfaces and runtime implementation."
                })
            );
        }
    }

    /**
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @param {number[]} lineStarts
     * @param {Record<string, unknown>} ast
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule} normalizedRule
     * @param {LanguageRuleDiagnostic[]} diagnostics
     */
    _checkAstValues(sourceFile, lineStarts, ast, normalizedRule, diagnostics) {
        const rule = normalizedRule.rule;
        if (rule.value_kind === "literal-number" && isArray(ast.numbers)) {
            for (let i = 0, len = ast.numbers.length; i < len; i++) {
                const item = ast.numbers[i];
                if (!isObject(item) || !isString(item.value)) {
                    continue;
                }
                if (stringArrayContains(rule.allowed_value_refs, item.value)) {
                    continue;
                }
                diagnostics.push(
                    this._diagnostic({
                        sourceFile,
                        lineStarts,
                        start: typeof item.start === "number" ? item.start : 0,
                        end: typeof item.end === "number" ? item.end : 0,
                        category_type: normalizedRule.category_type,
                        rule_id: normalizedRule.rule_id,
                        severity: normalizedRule.severity,
                        code: "language-rule.value.magic-number",
                        message: `Numeric literal should be reviewed: ${item.value}`
                    })
                );
            }
        }
        if (sourceFile.language_family === "stylesheet") {
            const declarations = collectCssDeclarations(ast);
            for (let i = 0, len = declarations.length; i < len; i++) {
                const declaration = declarations[i];
                if (!isString(declaration.valueText)) {
                    continue;
                }
                if (
                    rule.prefer_custom_properties === true &&
                    declaration.isCustomProperty !== true &&
                    looksLikeRawCssValue(declaration.valueText)
                ) {
                    diagnostics.push(
                        this._diagnostic({
                            sourceFile,
                            lineStarts,
                            start:
                                typeof declaration.start === "number"
                                    ? declaration.start
                                    : 0,
                            end:
                                typeof declaration.end === "number"
                                    ? declaration.end
                                    : 0,
                            category_type: normalizedRule.category_type,
                            rule_id: normalizedRule.rule_id,
                            severity: normalizedRule.severity,
                            code: "language-rule.value.css-raw-value",
                            message: `CSS declaration should use a custom property when tokenised: ${
                                declaration.property ?? "property"
                            }`
                        })
                    );
                }
            }
        }
    }

    /**
     * @param {object} args
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} args.sourceFile
     * @param {number[]} args.lineStarts
     * @param {number} args.start
     * @param {number} args.end
     * @param {string} args.category_type
     * @param {string} args.rule_id
     * @param {string} args.severity
     * @param {string} args.code
     * @param {string} args.message
     * @param {string} [args.suggestion]
     * @param {import("./SourceText.mjs").TextEdit} [args.fix]
     * @returns {LanguageRuleDiagnostic}
     */
    _diagnostic(args) {
        const pos = offsetToPosition(args.lineStarts, args.start);
        /** @type {LanguageRuleDiagnostic} */
        const diagnostic = {
            severity: args.severity,
            code: args.code,
            rule_id: args.rule_id,
            category_type: args.category_type,
            message: args.message,
            file: args.sourceFile.rel_path,
            line: pos.line,
            column: pos.column,
            start: args.start,
            end: args.end
        };
        if (args.suggestion) {
            diagnostic.suggestion = args.suggestion;
        }
        if (args.fix) {
            diagnostic.fix = args.fix;
        }
        return diagnostic;
    }

    /**
     * @param {import("./LanguageClassifier.mjs").ClassifiedSourceFile} sourceFile
     * @param {number[]} lineStarts
     * @param {Record<string, unknown>} node
     * @param {import("./LanguageRuleSetRepository.mjs").NormalizedLanguageRule} normalizedRule
     * @param {string} code
     * @param {string} message
     * @returns {LanguageRuleDiagnostic}
     */
    _nodeDiagnostic(
        sourceFile,
        lineStarts,
        node,
        normalizedRule,
        code,
        message
    ) {
        const start = typeof node.start === "number" ? node.start : 0;
        const end = typeof node.end === "number" ? node.end : start;
        return this._diagnostic({
            sourceFile,
            lineStarts,
            start,
            end,
            category_type: normalizedRule.category_type,
            rule_id: normalizedRule.rule_id,
            severity: normalizedRule.severity,
            code,
            message
        });
    }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function sourceLikeValueKind(value) {
    return value === "literal-number";
}

/**
 * @param {Record<string, unknown>} ast
 * @returns {unknown[]}
 */
function getAstNodes(ast) {
    return isArray(ast.nodes) ? ast.nodes : [];
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function firstString(value) {
    if (!isArray(value)) {
        return undefined;
    }
    for (let i = 0, len = value.length; i < len; i++) {
        if (isString(value[i])) {
            return /** @type {string} */ (value[i]);
        }
    }
    return undefined;
}

/**
 * @param {unknown} value
 * @param {string} needle
 * @returns {boolean}
 */
function stringArrayContains(value, needle) {
    if (!isArray(value)) {
        return false;
    }
    for (let i = 0, len = value.length; i < len; i++) {
        if (value[i] === needle) {
            return true;
        }
    }
    return false;
}

/**
 * @param {string} relPath
 * @param {unknown} globs
 * @returns {boolean}
 */
function matchesPathGlobs(relPath, globs) {
    if (!isArray(globs) || globs.length === 0) {
        return true;
    }
    for (let i = 0, len = globs.length; i < len; i++) {
        const glob = globs[i];
        if (isString(glob) && matchGlob(relPath, glob)) {
            return true;
        }
    }
    return false;
}

/**
 * @param {Record<string, unknown>} data
 * @param {string} path
 * @returns {boolean | null}
 */
function getNestedBoolean(data, path) {
    const parts = path.split(".");
    /** @type {unknown} */
    let current = data;
    for (let i = 0, len = parts.length; i < len; i++) {
        if (!isObject(current)) {
            return null;
        }
        current = current[parts[i]];
    }
    return typeof current === "boolean" ? current : null;
}

/**
 * @param {Record<string, unknown>} node
 * @returns {string}
 */
function symbolKindForNode(node) {
    if (node.kind === "ExportClass" || node.kind === "Class") {
        return "class";
    }
    if (node.kind === "ExportInterface" || node.kind === "Interface") {
        return "interface";
    }
    if (node.kind === "ExportTypeAlias" || node.kind === "TypeAlias") {
        return "type-alias";
    }
    if (node.kind === "ExportEnum") {
        return "enum";
    }
    if (node.kind === "ExportConstEnum" || node.kind === "ConstEnum") {
        return "const-enum";
    }
    if (node.kind === "ExportFunction" || node.kind === "Function") {
        return "function";
    }
    return "variable";
}

/**
 * @param {string} value
 * @param {string} casing
 * @returns {boolean}
 */
function matchesCasing(value, casing) {
    if (casing === "camelCase") {
        return /^[a-z][A-Za-z0-9]*$/.test(value);
    }
    if (casing === "PascalCase") {
        return /^[A-Z][A-Za-z0-9]*$/.test(value);
    }
    if (casing === "SCREAMING_SNAKE_CASE") {
        return /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(value);
    }
    if (casing === "kebab-case") {
        return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);
    }
    return true;
}

/**
 * @param {string} source
 * @returns {number}
 */
function importGroupRank(source) {
    if (source.startsWith("./")) {
        return 5;
    }
    if (source.startsWith("../")) {
        return 4;
    }
    if (source.startsWith("@solomon-labs/")) {
        return 2;
    }
    if (source.startsWith("@") || source.includes("/")) {
        return 1;
    }
    return 0;
}

/**
 * @param {string} text
 * @returns {{ start: number, end: number }[]}
 */
function findPointlessTypeofMemberProbes(text) {
    /** @type {{ start: number, end: number }[]} */
    const out = [];
    const re =
        /typeof\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\s*(?:===|!==)\s*["'][^"']+["']/g;
    let match = re.exec(text);
    while (match) {
        out.push({ start: match.index, end: match.index + match[0].length });
        match = re.exec(text);
    }
    return out;
}

/**
 * @param {string} text
 * @returns {{ start: number, end: number, value: string }[]}
 */
function findRawStylesheetValues(text) {
    /** @type {{ start: number, end: number, value: string }[]} */
    const out = [];
    const re =
        /:\s*(#[0-9a-fA-F]{3,8}|\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%)|white|black)\b/g;
    let match = re.exec(text);
    while (match) {
        const offset = match[0].indexOf(match[1]);
        out.push({
            start: match.index + offset,
            end: match.index + offset + match[1].length,
            value: match[1]
        });
        match = re.exec(text);
    }
    return out;
}

/**
 * @param {string} text
 * @returns {{ start: number, end: number, name: string }[]}
 */
function findCssCustomProperties(text) {
    /** @type {{ start: number, end: number, name: string }[]} */
    const out = [];
    const re = /--[A-Za-z0-9_-]+/g;
    let match = re.exec(text);
    while (match) {
        out.push({
            start: match.index,
            end: match.index + match[0].length,
            name: match[0]
        });
        match = re.exec(text);
    }
    return out;
}

/**
 * @param {string} name
 * @returns {boolean}
 */
function isKebabCssCustomProperty(name) {
    return /^--[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name);
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function looksLikeRawCssValue(value) {
    return /#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%)\b|\b(?:white|black)\b/.test(
        value
    );
}

/**
 * @param {Record<string, unknown>} ast
 * @returns {Record<string, unknown>[]}
 */
function collectCssDeclarations(ast) {
    /** @type {Record<string, unknown>[]} */
    const out = [];
    const visit = (/** @type {unknown} */ value) => {
        if (!isObject(value)) {
            return;
        }
        if (
            value.kind === "Declaration" ||
            value.kind === "InvalidDeclaration"
        ) {
            out.push(value);
        }
        const body = value.body;
        if (isObject(body)) {
            if (isArray(body.declarations)) {
                for (let i = 0, len = body.declarations.length; i < len; i++) {
                    visit(body.declarations[i]);
                }
            }
            if (isArray(body.children)) {
                for (let i = 0, len = body.children.length; i < len; i++) {
                    visit(body.children[i]);
                }
            }
            if (isArray(body.statements)) {
                for (let i = 0, len = body.statements.length; i < len; i++) {
                    visit(body.statements[i]);
                }
            }
            if (isArray(body.rules)) {
                for (let i = 0, len = body.rules.length; i < len; i++) {
                    visit(body.rules[i]);
                }
            }
        }
        if (isObject(value.statement)) {
            visit(value.statement);
        }
        if (isObject(value.declaration)) {
            visit(value.declaration);
        }
        if (isObject(value.rule)) {
            visit(value.rule);
        }
    };
    const nodes = getAstNodes(ast);
    for (let i = 0, len = nodes.length; i < len; i++) {
        visit(nodes[i]);
    }
    return out;
}
