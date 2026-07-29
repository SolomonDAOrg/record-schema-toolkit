/**
 * Pack class for formatting packs (base-v1.json)
 * @module classes/Pack
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import {
    rulesetMatchesFile,
    getEntryPath,
    shouldIncludeEntry,
    getEntryPrecedence,
    collectCamelCaseKeys
} from "./PackUtils.mjs";
import { isObject, mergeObjects } from "../util/objects.mjs";
import { isString, isNumber, isArray, arrayOr } from "../util/general.mjs";
import {
    DOC_TYPE_PATTERN,
    FORMATTING_PACK_SCHEMA_NAME,
    FORMATTING_PACK_SCHEMA_VERSION,
    PACK_ID_PATTERN
} from "./constants/constants.mjs";

// =============================================================================
// Type Definitions (from types/general.mjs)
// =============================================================================

/** @typedef {import("../util/objects.mjs").MergeFieldStrategy} MergeFieldStrategy */
/** @typedef {import("./types/general.mjs").LineWidthRule} LineWidthRule */
/** @typedef {import("./types/general.mjs").DefaultSettings} DefaultSettings */
/** @typedef {import("./types/general.mjs").ShapeField} ShapeField */
/** @typedef {import("./types/general.mjs").ShapeDef} ShapeDef */
/** @typedef {import("./types/general.mjs").DialectPair} DialectPair */
/** @typedef {import("./types/general.mjs").DialectPack} DialectPack */
/** @typedef {import("./types/general.mjs").StyleProfile} StyleProfile */
/** @typedef {import("./types/general.mjs").FormattingProfile} FormattingProfile */
/** @typedef {import("./types/general.mjs").TemplateDef} TemplateDef */
/** @typedef {import("./types/general.mjs").RulesetSelectors} RulesetSelectors */
/** @typedef {import("./types/general.mjs").RulesetEnforce} RulesetEnforce */
/** @typedef {import("./types/general.mjs").PackRuleset} PackRuleset */
/** @typedef {import("./types/general.mjs").FormattingDocumentPolicy} DocumentPolicy */
/** @typedef {import("./types/general.mjs").FormattingPackData} FormattingPackData */
/** @typedef {import("./types/general.mjs").ValidationError} ValidationError */
/** @typedef {import("./types/general.mjs").ValidationResult} ValidationResult */
/** @typedef {import("./types/general.mjs").LintIssue} LintIssue */
/** @typedef {import("./Document.mjs").Document} Document */

/** @type {MergeFieldStrategy} */
const POLICY_MERGE_STRATEGY = {
    arrayConcat: ["rulesets"],
    shallowMerge: [
        "dialect_packs",
        "style_profiles",
        "formatting_profiles",
        "shapes",
        "templates",
        "defaults"
    ]
};

/** @type {MergeFieldStrategy} */
const FORMATTING_MERGE_STRATEGY = {
    shallowMerge: ["line_width"]
};

// =============================================================================
// FormattingPack Class
// =============================================================================

/**
 * Formatting pack representing document policies and rules
 */
export class FormattingPack {
    /**
     * @param {FormattingPackData} data
     * @param {string | null} [sourcePath]
     */
    constructor(data, sourcePath = null) {
        /** @type {FormattingPackData} */
        this.data = data;
        /** @type {string | null} */
        this.sourcePath = sourcePath;
    }

    // =========================================================================
    // Static Factory Methods
    // =========================================================================

    /**
     * Load pack from JSON file
     * @param {string} absPath
     * @returns {FormattingPack}
     */
    static load(absPath) {
        const text = readFileSync(absPath, "utf8");
        const data = /** @type {FormattingPackData} */ (JSON.parse(text));
        return new FormattingPack(data, absPath);
    }

    /**
     * Load pack from JSON file if it exists
     * @param {string} absPath
     * @returns {FormattingPack | null}
     */
    static loadIfExists(absPath) {
        if (!existsSync(absPath)) {
            return null;
        }
        return FormattingPack.load(absPath);
    }

    /**
     * Load multiple packs with import resolution
     * @param {string} rootDir
     * @param {string[]} packPaths
     * @param {string[]} [searchRoots]
     * @returns {{ packs: FormattingPack[], policy: DocumentPolicy }}
     */
    static loadMerged(rootDir, packPaths, searchRoots = []) {
        /** @type {Set<string>} */
        const seen = new Set();
        /** @type {string[]} */
        const ordered = [];

        /**
         * @param {string} relOrAbs
         */
        function visit(relOrAbs) {
            let absPath;
            if (isAbsolute(relOrAbs)) {
                absPath = relOrAbs;
            } else {
                const roots = [rootDir].concat(searchRoots);
                for (let i = 0, len = roots.length; i < len; i++) {
                    const candidate = resolve(roots[i], relOrAbs);
                    if (existsSync(candidate)) {
                        absPath = candidate;
                        break;
                    }
                }
                absPath ??= resolve(rootDir, relOrAbs);
            }
            const abs = absPath;
            if (seen.has(abs)) {
                return;
            }
            seen.add(abs);
            const pack = FormattingPack.load(abs);
            const imps = pack.getImports();
            for (let i = 0, len = imps.length; i < len; i++) {
                visit(imps[i]);
            }
            ordered.push(abs);
        }

        for (let i = 0, len = packPaths.length; i < len; i++) {
            visit(packPaths[i]);
        }

        /** @type {FormattingPack[]} */
        const packs = [];
        /** @type {DocumentPolicy} */
        let merged = {};

        for (let i = 0, len = ordered.length; i < len; i++) {
            const pack = FormattingPack.load(ordered[i]);
            packs.push(pack);
            merged = FormattingPack._mergePolicy(
                merged,
                pack.getDocumentPolicies()
            );
        }

        return { packs, policy: merged };
    }

    /**
     * Create empty pack
     * @param {string} packId
     * @returns {FormattingPack}
     */
    static empty(packId) {
        return new FormattingPack(
            {
                schema: FORMATTING_PACK_SCHEMA_NAME,
                schema_version: FORMATTING_PACK_SCHEMA_VERSION,
                pack_id: packId,
                document_policies: {}
            },
            null
        );
    }

    // =========================================================================
    // Basic Accessors
    // =========================================================================

    /**
     * Get pack ID
     * @returns {string}
     */
    getId() {
        return this.data.pack_id;
    }

    /**
     * Get pack description
     * @returns {string | undefined}
     */
    getDescription() {
        return this.data.description;
    }

    /**
     * Get schema name
     * @returns {string}
     */
    getSchema() {
        return this.data.schema;
    }

    /**
     * Get schema version
     * @returns {number}
     */
    getSchemaVersion() {
        return this.data.schema_version;
    }

    /**
     * Get import paths
     * @returns {string[]}
     */
    getImports() {
        return arrayOr(this.data.imports);
    }

    /**
     * Check if pack has imports
     * @returns {boolean}
     */
    hasImports() {
        return this.getImports().length > 0;
    }

    // =========================================================================
    // Document Policies
    // =========================================================================

    /**
     * Get document policies
     * @returns {DocumentPolicy}
     */
    getDocumentPolicies() {
        return this.data.document_policies || {};
    }

    /**
     * Get defaults from document policies
     * @returns {DefaultSettings}
     */
    getDefaults() {
        return this.getDocumentPolicies().defaults || {};
    }

    /**
     * Get precedence notes
     * @returns {string | undefined}
     */
    getPrecedenceNotes() {
        return this.getDocumentPolicies().precedence_notes;
    }

    // =========================================================================
    // Rulesets
    // =========================================================================

    /**
     * Get rulesets from document policies
     * @returns {PackRuleset[]}
     */
    getRulesets() {
        return this.getDocumentPolicies().rulesets || [];
    }

    /**
     * Get a specific ruleset by ID
     * @param {string} rulesetId
     * @returns {PackRuleset | undefined}
     */
    getRuleset(rulesetId) {
        const rulesets = this.getRulesets();
        for (let i = 0, len = rulesets.length; i < len; i++) {
            if (rulesets[i].id === rulesetId) {
                return rulesets[i];
            }
        }
        return undefined;
    }

    // =========================================================================
    // Shapes
    // =========================================================================

    /**
     * Get shapes from document policies
     * @returns {Record<string, ShapeDef>}
     */
    getShapes() {
        return this.getDocumentPolicies().shapes || {};
    }

    /**
     * Get a specific shape by ID
     * @param {string} shapeId
     * @returns {ShapeDef | undefined}
     */
    getShape(shapeId) {
        return this.getShapes()[shapeId];
    }

    // =========================================================================
    // Style Profiles
    // =========================================================================

    /**
     * Get style profiles from document policies
     * @returns {Record<string, StyleProfile>}
     */
    getStyleProfiles() {
        return this.getDocumentPolicies().style_profiles || {};
    }

    /**
     * Get a specific style profile by ID
     * @param {string} profileId
     * @returns {StyleProfile | undefined}
     */
    getStyleProfile(profileId) {
        return this.getStyleProfiles()[profileId];
    }

    // =========================================================================
    // Formatting Profiles
    // =========================================================================

    /**
     * Get formatting profiles from document policies
     * @returns {Record<string, FormattingProfile>}
     */
    getFormattingProfiles() {
        return this.getDocumentPolicies().formatting_profiles || {};
    }

    /**
     * Get a specific formatting profile by ID
     * @param {string} profileId
     * @returns {FormattingProfile | undefined}
     */
    getFormattingProfile(profileId) {
        return this.getFormattingProfiles()[profileId];
    }

    // =========================================================================
    // Dialect Packs
    // =========================================================================

    /**
     * Get dialect packs from document policies
     * @returns {Record<string, DialectPack>}
     */
    getDialectPacks() {
        return this.getDocumentPolicies().dialect_packs || {};
    }

    /**
     * Get a specific dialect pack by ID
     * @param {string} dialectId
     * @returns {DialectPack | undefined}
     */
    getDialectPack(dialectId) {
        return this.getDialectPacks()[dialectId];
    }

    // =========================================================================
    // Templates
    // =========================================================================

    /**
     * Get templates from document policies
     * @returns {Record<string, TemplateDef>}
     */
    getTemplates() {
        return this.getDocumentPolicies().templates || {};
    }

    /**
     * Get a specific template by ID
     * @param {string} templateId
     * @returns {TemplateDef | undefined}
     */
    getTemplate(templateId) {
        return this.getTemplates()[templateId];
    }

    /**
     * Render a template with variable substitution
     * @param {string} templateId
     * @param {Record<string, string>} variables
     * @returns {string[] | null}
     */
    renderTemplate(templateId, variables) {
        const template = this.getTemplate(templateId);
        if (!template || !isArray(template.content)) {
            return null;
        }
        /** @type {string[]} */
        const result = [];
        for (let i = 0, len = template.content.length; i < len; i++) {
            let line = template.content[i];
            for (const key of Object.keys(variables)) {
                const placeholder = "${" + key + "}";
                line = line.split(placeholder).join(variables[key]);
            }
            result.push(line);
        }
        return result;
    }

    // =========================================================================
    // Pack Entry Helpers (for document list handling)
    // =========================================================================

    /**
     * Get path from pack entry
     * @param {unknown} entry
     * @returns {string | null}
     */
    static getEntryPath(entry) {
        return getEntryPath(entry);
    }

    /**
     * Check if pack entry should be included
     * @param {unknown} entry
     * @returns {boolean}
     */
    static shouldIncludeEntry(entry) {
        return shouldIncludeEntry(entry);
    }

    /**
     * Get pack entry precedence for sorting
     * @param {unknown} entry
     * @param {number} index
     * @returns {number}
     */
    static getEntryPrecedence(entry, index) {
        return getEntryPrecedence(entry, index);
    }

    // =========================================================================
    // File Policy Resolution
    // =========================================================================

    /**
     * Resolve effective policy for a file.
     *
     * Resolution layers (lowest -> highest precedence):
     *   1. document_policies.defaults
     *   2. document_policies.line_width_profiles  (first glob match for rel_path)
     *   3. document_policies.rulesets             (all matching, merged in order)
     *   4. metaOverrides                          (extensions.formatting.profile /
     *                                              extensions.language.locale from META.yaml)
     *
     * @param {DocumentPolicy} policy
     * @param {{ rel_path: string, doc_type: string | null, ext: string | null, is_root_file: boolean }} file
     * @param {{ formatting_profile?: string, language_locale?: string }} [metaOverrides]
     * @returns {{ effective: RulesetEnforce, applied: { id: string, severity: string }[] }}
     */
    static resolveFilePolicy(policy, file, metaOverrides) {
        const defaults = policy?.defaults ? policy.defaults : {};
        /** @type {RulesetEnforce} */
        let effective = { ...defaults };
        /** @type {{ id: string, severity: string }[]} */
        const applied = [];

        // Layer 2: line_width_profiles - glob-based line width, above defaults
        // but below explicit ruleset enforce blocks.
        const lwProfiles = policy?.line_width_profiles;
        if (isObject(lwProfiles)) {
            for (const [, lwp] of Object.entries(lwProfiles)) {
                if (!isObject(lwp)) {
                    continue;
                }
                const appliesTo = arrayOr(/** @type {any} */ (lwp).applies_to);
                for (let gi = 0, glen = appliesTo.length; gi < glen; gi++) {
                    if (
                        FormattingPack._globMatch(appliesTo[gi], file.rel_path)
                    ) {
                        /** @type {RulesetEnforce} */
                        const lwpEnforce = {
                            line_width: {
                                max: /** @type {any} */ (lwp).max,
                                ignore_blocks: /** @type {any} */ (lwp)
                                    .ignore_blocks
                            }
                        };
                        if (
                            /** @type {any} */ (lwp).soft_wrap_preferred ===
                            true
                        ) {
                            lwpEnforce.soft_wrap_preferred = true;
                        }
                        effective = FormattingPack._mergeEnforce(
                            effective,
                            lwpEnforce
                        );
                        break;
                    }
                }
            }
        }

        // Layer 3: rulesets
        const rulesets = arrayOr(policy?.rulesets);
        for (let i = 0, len = rulesets.length; i < len; i++) {
            const r = rulesets[i];
            if (!isObject(r)) {
                continue;
            }
            if (!FormattingPack._rulesetMatches(r, file)) {
                continue;
            }
            const enforce = r.enforce || {};
            effective = FormattingPack._mergeEnforce(effective, enforce);
            applied.push({
                id: isString(r.id) ? r.id : `ruleset#${i}`,
                severity: isString(r.severity) ? r.severity : "error"
            });
        }

        // Layer 4: META.yaml overrides (per-record, highest precedence)
        if (isObject(metaOverrides)) {
            if (isString(metaOverrides.formatting_profile)) {
                effective = FormattingPack._mergeEnforce(effective, {
                    formatting_profile: metaOverrides.formatting_profile
                });
            }
            if (isString(metaOverrides.language_locale)) {
                effective = FormattingPack._mergeEnforce(effective, {
                    language_locale: metaOverrides.language_locale
                });

                const localeKey = metaOverrides.language_locale;

                if (isObject(policy?.dialect_packs)) {
                    const dialectPacks = policy.dialect_packs;
                    // 1. exact match  2. first key prefixed with locale + "-"
                    const dialectId =
                        localeKey in dialectPacks
                            ? localeKey
                            : Object.keys(dialectPacks).find((k) =>
                                  k.startsWith(localeKey + "-")
                              ) ?? null;
                    if (dialectId !== null) {
                        effective = FormattingPack._mergeEnforce(effective, {
                            dialect_pack: dialectId
                        });
                    }
                }
            }
        }

        return { effective, applied };
    }

    /**
     * Resolve what format auto-fix actions apply to a file.
     * Owns all format-decision logic so Repository stays I/O-only.
     *
     * @param {DocumentPolicy | null} policy
     * @param {{ rel_path: string, doc_type: string | null, ext: string | null, is_root_file: boolean }} file
     * @param {{ formatting_profile?: string, language_locale?: string }} [metaOverrides]
     * @returns {{ normalizeBaseline: boolean, normalizeCanonicalAscii: boolean, softWrapPreferred: boolean, reflowMaxWidth: number | null, continuationIndent: string }}
     */
    static resolveFormatActions(policy, file, metaOverrides) {
        if (!policy) {
            return {
                normalizeBaseline: true,
                normalizeCanonicalAscii: false,
                softWrapPreferred: false,
                reflowMaxWidth: null,
                continuationIndent: ""
            };
        }
        const { effective } = FormattingPack.resolveFilePolicy(
            policy,
            file,
            metaOverrides
        );
        const fmtProfileId = effective.formatting_profile;
        const fmtProfile = isString(fmtProfileId)
            ? (policy.formatting_profiles || {})[fmtProfileId]
            : null;
        const softWrapPreferred = effective.soft_wrap_preferred === true;
        // Reflow whenever line_width.max is configured for a Markdown file.
        // soft_wrap_preferred is an editor display hint only — it suppresses
        // lint warnings but does not skip reflow.
        const lw = effective.line_width;
        const reflowMaxWidth =
            file.ext === "md" && isNumber(lw?.max) && lw.max < 9999
                ? lw.max
                : null;
        return {
            normalizeBaseline: true,
            // Only strip Unicode punctuation when:
            //  - file is Markdown
            //  - an explicit formatting_profile is resolved
            //  - that profile does NOT have unicode_allowed: true
            normalizeCanonicalAscii:
                file.ext === "md" &&
                fmtProfile != null &&
                fmtProfile.unicode_allowed !== true,
            // When true: suppress line-width lint issues.
            // Set by soft_wrap_preferred: true in a line_width_profiles entry.
            softWrapPreferred,
            // When non-null: reflow Markdown paragraphs to this column width.
            reflowMaxWidth,
            // Four-space gutter on continuation lines for soft-wrap legal docs;
            // zero indent for regular prose (editors handle the visual wrap).
            continuationIndent: softWrapPreferred ? "    " : ""
        };
    }

    /**
     * Test a file path against a glob pattern.
     * Supports * (any chars except /) and ** (any chars including /).
     * @param {string} pattern
     * @param {string} relPath
     * @returns {boolean}
     * @private
     */
    static _globMatch(pattern, relPath) {
        const p = relPath.replace(/\\/g, "/");
        const re = pattern
            .replace(/\\/g, "/")
            .replace(/[.+^${}()|[\]]/g, "\\$&")
            .replace(/\*\*/g, "\x00")
            .replace(/\*/g, "[^/]*")
            .replace(/\x00/g, ".*");
        return (
            new RegExp(`^${re}$`).test(p) || new RegExp(`(^|/)${re}$`).test(p)
        );
    }

    // =========================================================================
    // Validation
    // =========================================================================

    /**
     * Validate pack data against schema requirements
     * @returns {ValidationResult}
     */
    validate() {
        /** @type {ValidationError[]} */
        const errors = [];

        const camel = collectCamelCaseKeys(this.data);
        for (let i = 0, len = camel.length; i < len; i++) {
            errors.push({
                path: camel[i].path,
                message: `camelCase key "${camel[i].key}" is not allowed; use underscore_case.`
            });
        }

        // Required fields
        if (this.data.schema !== FORMATTING_PACK_SCHEMA_NAME) {
            errors.push({
                path: "schema",
                message: `Expected "${FORMATTING_PACK_SCHEMA_NAME}", got "${this.data.schema}"`
            });
        }

        if (
            !isNumber(this.data.schema_version) ||
            this.data.schema_version < 1
        ) {
            errors.push({
                path: "schema_version",
                message: "Must be a positive integer"
            });
        }

        if (
            !isString(this.data.pack_id) ||
            !PACK_ID_PATTERN.test(this.data.pack_id)
        ) {
            errors.push({
                path: "pack_id",
                message: "Must match pattern ^[a-z][a-z0-9-]{2,}$"
            });
        }

        // Imports validation
        if (this.data.imports !== undefined) {
            if (!isArray(this.data.imports)) {
                errors.push({
                    path: "imports",
                    message: "Must be an array"
                });
            } else {
                for (let i = 0, len = this.data.imports.length; i < len; i++) {
                    if (
                        !isString(this.data.imports[i]) ||
                        this.data.imports[i].length === 0
                    ) {
                        errors.push({
                            path: `imports[${i}]`,
                            message: "Must be a non-empty string"
                        });
                    }
                }
            }
        }

        // Document policies validation
        const policies = this.data.document_policies;
        if (policies !== undefined && policies !== null) {
            if (!isObject(policies)) {
                errors.push({
                    path: "document_policies",
                    message: "Must be an object"
                });
            } else {
                this._validateRulesets(policies.rulesets, errors);
                this._validateShapes(policies.shapes, errors);
                this._validateDialectPacks(policies.dialect_packs, errors);
                this._validateStyleProfiles(policies.style_profiles, errors);
                this._validateFormattingProfiles(
                    policies.formatting_profiles,
                    errors
                );
                this._validateTemplates(policies.templates, errors);
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Validate rulesets
     * @param {PackRuleset[] | undefined} rulesets
     * @param {ValidationError[]} errors
     * @private
     */
    _validateRulesets(rulesets, errors) {
        if (rulesets === undefined) {
            return;
        }
        if (!isArray(rulesets)) {
            errors.push({
                path: "document_policies.rulesets",
                message: "Must be an array"
            });
            return;
        }
        for (let i = 0, len = rulesets.length; i < len; i++) {
            const r = rulesets[i];
            const path = `document_policies.rulesets[${i}]`;
            if (!isObject(r)) {
                errors.push({ path, message: "Must be an object" });
                continue;
            }
            if (!isString(r.id) || r.id.length === 0) {
                errors.push({
                    path: `${path}.id`,
                    message: "Must be a non-empty string"
                });
            }
            if (!isObject(r.selectors)) {
                errors.push({
                    path: `${path}.selectors`,
                    message: "Must be an object"
                });
            } else {
                const sel = r.selectors;
                if (sel.doc_types !== undefined && isArray(sel.doc_types)) {
                    for (
                        let j = 0, jlen = sel.doc_types.length;
                        j < jlen;
                        j++
                    ) {
                        if (!DOC_TYPE_PATTERN.test(sel.doc_types[j])) {
                            errors.push({
                                path: `${path}.selectors.doc_types[${j}]`,
                                message: "Must match pattern ^[A-Z]{2,5}$"
                            });
                        }
                    }
                }
            }
            if (!isObject(r.enforce)) {
                errors.push({
                    path: `${path}.enforce`,
                    message: "Must be an object"
                });
            }
        }
    }

    /**
     * Validate shapes
     * @param {Record<string, ShapeDef> | undefined} shapes
     * @param {ValidationError[]} errors
     * @private
     */
    _validateShapes(shapes, errors) {
        if (shapes === undefined) {
            return;
        }
        if (!isObject(shapes)) {
            errors.push({
                path: "document_policies.shapes",
                message: "Must be an object"
            });
            return;
        }
        for (const key of Object.keys(shapes)) {
            const shape = shapes[key];
            const path = `document_policies.shapes.${key}`;
            if (!isObject(shape)) {
                errors.push({ path, message: "Must be an object" });
                continue;
            }
            if (!isString(shape.kind) || shape.kind.length === 0) {
                errors.push({
                    path: `${path}.kind`,
                    message: "Must be a non-empty string"
                });
            }
            if (shape.fields !== undefined && isArray(shape.fields)) {
                for (let i = 0, len = shape.fields.length; i < len; i++) {
                    const field = shape.fields[i];
                    if (!isObject(field)) {
                        errors.push({
                            path: `${path}.fields[${i}]`,
                            message: "Must be an object"
                        });
                    } else if (
                        !isString(field.name) ||
                        field.name.length === 0
                    ) {
                        errors.push({
                            path: `${path}.fields[${i}].name`,
                            message: "Must be a non-empty string"
                        });
                    }
                }
            }
        }
    }

    /**
     * Validate dialect packs
     * @param {Record<string, DialectPack> | undefined} dialectPacks
     * @param {ValidationError[]} errors
     * @private
     */
    _validateDialectPacks(dialectPacks, errors) {
        if (dialectPacks === undefined) {
            return;
        }
        if (!isObject(dialectPacks)) {
            errors.push({
                path: "document_policies.dialect_packs",
                message: "Must be an object"
            });
            return;
        }
        for (const key of Object.keys(dialectPacks)) {
            const pack = dialectPacks[key];
            const path = `document_policies.dialect_packs.${key}`;
            if (!isObject(pack)) {
                errors.push({ path, message: "Must be an object" });
                continue;
            }
            if (pack.preferred_terms !== undefined) {
                if (!isObject(pack.preferred_terms)) {
                    errors.push({
                        path: `${path}.preferred_terms`,
                        message: "Must be an object"
                    });
                }
            }
            if (
                pack.forbidden_terms !== undefined &&
                !isArray(pack.forbidden_terms)
            ) {
                errors.push({
                    path: `${path}.forbidden_terms`,
                    message: "Must be an array"
                });
            }
        }
    }

    /**
     * Validate style profiles
     * @param {Record<string, StyleProfile> | undefined} profiles
     * @param {ValidationError[]} errors
     * @private
     */
    _validateStyleProfiles(profiles, errors) {
        if (profiles === undefined) {
            return;
        }
        if (!isObject(profiles)) {
            errors.push({
                path: "document_policies.style_profiles",
                message: "Must be an object"
            });
            return;
        }
        for (const key of Object.keys(profiles)) {
            const profile = profiles[key];
            const path = `document_policies.style_profiles.${key}`;
            if (!isObject(profile)) {
                errors.push({ path, message: "Must be an object" });
            }
        }
    }

    /**
     * Validate formatting profiles
     * @param {Record<string, FormattingProfile> | undefined} profiles
     * @param {ValidationError[]} errors
     * @private
     */
    _validateFormattingProfiles(profiles, errors) {
        if (profiles === undefined) {
            return;
        }
        if (!isObject(profiles)) {
            errors.push({
                path: "document_policies.formatting_profiles",
                message: "Must be an object"
            });
            return;
        }
        for (const key of Object.keys(profiles)) {
            const profile = profiles[key];
            const path = `document_policies.formatting_profiles.${key}`;
            if (!isObject(profile)) {
                errors.push({ path, message: "Must be an object" });
            }
        }
    }

    /**
     * Validate templates
     * @param {Record<string, TemplateDef> | undefined} templates
     * @param {ValidationError[]} errors
     * @private
     */
    _validateTemplates(templates, errors) {
        if (templates === undefined) {
            return;
        }
        if (!isObject(templates)) {
            errors.push({
                path: "document_policies.templates",
                message: "Must be an object"
            });
            return;
        }
        for (const key of Object.keys(templates)) {
            const template = templates[key];
            const path = `document_policies.templates.${key}`;
            if (!isObject(template)) {
                errors.push({ path, message: "Must be an object" });
                continue;
            }
            if (!isArray(template.content)) {
                errors.push({
                    path: `${path}.content`,
                    message: "Must be an array"
                });
            }
        }
    }

    // =========================================================================
    // Linting
    // =========================================================================

    /**
     * Lint a document against resolved effective policy.
     *
     * @param {DocumentPolicy} policy - Merged policy from loaded packs
     * @param {Document} doc - Document to lint
     * @param {string} rel_path - Repo-relative file path
     * @param {{ doc_type: string | null, ext: string | null, is_root_file: boolean }} fileCtx
     * @param {{ formatting_profile?: string, language_locale?: string }} [metaOverrides]
     * @returns {LintIssue[]}
     */
    static lintDocument(policy, doc, rel_path, fileCtx, metaOverrides) {
        const { effective } = FormattingPack.resolveFilePolicy(
            policy,
            {
                rel_path,
                doc_type: fileCtx.doc_type,
                ext: fileCtx.ext,
                is_root_file: fileCtx.is_root_file
            },
            metaOverrides
        );

        /** @type {LintIssue[]} */
        const issues = [];

        if (doc.isText()) {
            FormattingPack._lintFormattingProfile(
                policy,
                effective,
                doc,
                rel_path,
                issues
            );
            FormattingPack._lintLineWidth(effective, doc, rel_path, issues);
            FormattingPack._lintDialect(
                policy,
                effective,
                doc,
                rel_path,
                issues
            );
            FormattingPack._lintFooterShape(
                policy,
                effective,
                doc,
                rel_path,
                issues
            );
            FormattingPack._lintMetadataBlock(
                policy,
                effective,
                doc,
                rel_path,
                issues
            );
        }

        return issues;
    }

    /**
     * Check characters against the resolved formatting profile.
     * Respects unicode_allowed, disallowed_characters, and allowed_non_ascii.
     *
     * @param {DocumentPolicy} policy
     * @param {RulesetEnforce} effective
     * @param {Document} doc
     * @param {string} rel_path
     * @param {LintIssue[]} issues
     * @private
     */
    static _lintFormattingProfile(policy, effective, doc, rel_path, issues) {
        const fmtProfileId = effective.formatting_profile;
        if (!fmtProfileId) {
            return;
        }
        const fmtProfile = (policy.formatting_profiles || {})[fmtProfileId];
        if (!fmtProfile) {
            return;
        }

        const allowedNonAscii = new Set(arrayOr(fmtProfile.allowed_non_ascii));
        const unicodeAllowed = fmtProfile.unicode_allowed === true;

        if (!unicodeAllowed) {
            // Collect specifically disallowed chars for severity
            const disallowed = new Set();
            const dc = fmtProfile.disallowed_characters;
            if (isObject(dc)) {
                for (const category of Object.values(dc)) {
                    if (isArray(category)) {
                        for (
                            let ci = 0, clen = category.length;
                            ci < clen;
                            ci++
                        ) {
                            disallowed.add(category[ci]);
                        }
                    }
                }
            }

            const nonAscii = doc.findNonAscii();
            /** @type {string[]} */
            const violations = [];
            for (let ni = 0, nlen = nonAscii.length; ni < nlen; ni++) {
                const ch = nonAscii[ni];
                if (allowedNonAscii.has(ch)) {
                    continue;
                }
                violations.push(ch);
            }

            if (violations.length > 0) {
                const severity = disallowed.size > 0 ? "error" : "warn";
                issues.push({
                    severity,
                    code: "format.chars.disallowed",
                    message: `Found ${
                        violations.length
                    } disallowed non-ASCII character(s): ${violations
                        .map(
                            (c) =>
                                `U+${c
                                    .codePointAt(0)
                                    .toString(16)
                                    .toUpperCase()
                                    .padStart(4, "0")}`
                        )
                        .join(", ")}`,
                    file: rel_path
                });
            }
        }

        // Emoji policy
        if (fmtProfile.emoji_policy === "forbid") {
            const emojiPattern =
                /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
            if (emojiPattern.test(doc.text)) {
                issues.push({
                    severity: "error",
                    code: "format.chars.emoji",
                    message:
                        "Emoji characters are forbidden by formatting profile",
                    file: rel_path
                });
            }
        }
    }

    /**
     * Check line widths against effective.line_width, respecting ignore_blocks.
     *
     * @param {RulesetEnforce} effective
     * @param {Document} doc
     * @param {string} rel_path
     * @param {LintIssue[]} issues
     * @private
     */
    static _lintLineWidth(effective, doc, rel_path, issues) {
        // soft_wrap_preferred means lines are intentionally long — skip entirely.
        if (effective.soft_wrap_preferred === true) {
            return;
        }
        const lw = effective.line_width;
        if (!lw || !isNumber(lw.max)) {
            return;
        }

        const ignoreBlocks = new Set(arrayOr(lw.ignore_blocks));
        const lines = doc.getLines();
        let inCodeBlock = false;

        for (let li = 0, llen = lines.length; li < llen; li++) {
            const line = lines[li];

            // Track fenced code blocks
            if (/^```/.test(line.trimStart())) {
                inCodeBlock = !inCodeBlock;
                continue;
            }
            if (inCodeBlock && ignoreBlocks.has("code")) {
                continue;
            }

            if (line.length <= lw.max) {
                continue;
            }

            const trimmed = line.trim();
            let ignored = false;

            if (ignoreBlocks.has("urls") && /https?:\/\/\S+/.test(trimmed)) {
                ignored = true;
            }
            if (ignoreBlocks.has("tables") && trimmed.startsWith("|")) {
                ignored = true;
            }
            if (
                ignoreBlocks.has("base58") &&
                /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/.test(
                    trimmed
                )
            ) {
                ignored = true;
            }
            if (
                ignoreBlocks.has("base64") &&
                /^[A-Za-z0-9+/=]+$/.test(trimmed)
            ) {
                ignored = true;
            }
            if (
                ignoreBlocks.has("legal_citations") &&
                /^\s*\[\d+\]/.test(trimmed)
            ) {
                ignored = true;
            }

            if (!ignored) {
                issues.push({
                    severity: "warn",
                    code: "format.line_width",
                    message: `Line ${li + 1} exceeds max width ${lw.max} (${
                        line.length
                    } chars)`,
                    file: rel_path,
                    line: li + 1
                });
            }
        }
    }

    /**
     * Check document text against dialect pack spelling rules.
     *
     * @param {DocumentPolicy} policy
     * @param {RulesetEnforce} effective
     * @param {Document} doc
     * @param {string} rel_path
     * @param {LintIssue[]} issues
     * @private
     */
    static _lintDialect(policy, effective, doc, rel_path, issues) {
        const dialectId = effective.dialect_pack;
        if (!dialectId) {
            return;
        }
        const dialectPack = (policy.dialect_packs || {})[dialectId];
        if (!dialectPack) {
            return;
        }

        const pairs = arrayOr(dialectPack.pairs);

        for (let pi = 0, plen = pairs.length; pi < plen; pi++) {
            const pair = pairs[pi];
            const forbidList = arrayOr(pair.forbid);
            for (let fi = 0, flen = forbidList.length; fi < flen; fi++) {
                const forbidden = forbidList[fi];
                const re = new RegExp(`\\b${forbidden}\\b`, "i");
                if (re.test(doc.text)) {
                    issues.push({
                        severity: "info",
                        code: "format.dialect.spelling",
                        message: `Use "${pair.preferred}" instead of "${forbidden}"`,
                        file: rel_path
                    });
                }
            }
        }
    }

    /**
     * Check footer shape when require_disclaimer_footer is set.
     *
     * @param {DocumentPolicy} policy
     * @param {RulesetEnforce} effective
     * @param {Document} doc
     * @param {string} rel_path
     * @param {LintIssue[]} issues
     * @private
     */
    static _lintFooterShape(policy, effective, doc, rel_path, issues) {
        if (!effective.require_disclaimer_footer) {
            return;
        }
        const footerShapeId = effective.footer_shape_id;
        if (!footerShapeId) {
            return;
        }
        const footerShape = (policy.shapes || {})[footerShapeId];
        if (!footerShape || !isArray(footerShape.required_trailing_lines)) {
            return;
        }

        const requiredLines = footerShape.required_trailing_lines;
        const docLines = doc.getLines();

        // Find last non-empty line
        let lastNonEmpty = docLines.length - 1;
        while (lastNonEmpty >= 0 && docLines[lastNonEmpty].trim() === "") {
            lastNonEmpty--;
        }

        let found = false;
        if (lastNonEmpty >= requiredLines.length - 1) {
            found = true;
            for (let ri = requiredLines.length - 1; ri >= 0; ri--) {
                const expected = requiredLines[ri];
                const offset = lastNonEmpty - (requiredLines.length - 1 - ri);
                const actual =
                    docLines[offset] !== undefined
                        ? docLines[offset].trim()
                        : "";
                if (actual !== expected.trim()) {
                    found = false;
                    break;
                }
            }
        }

        if (!found) {
            issues.push({
                severity: "error",
                code: "format.footer.missing",
                message: `Document missing required disclaimer footer (shape: ${footerShapeId})`,
                file: rel_path
            });
        }
    }

    /**
     * Check require_metadata_block + metadata_required_fields.
     * Detects block presence via BEGIN/END DOCUMENT METADATA delimiters.
     *
     * @param {DocumentPolicy} policy
     * @param {RulesetEnforce} effective
     * @param {Document} doc
     * @param {string} rel_path
     * @param {LintIssue[]} issues
     * @private
     */
    static _lintMetadataBlock(policy, effective, doc, rel_path, issues) {
        if (!effective.require_metadata_block) {
            return;
        }

        const BEGIN_DELIM =
            "----------------------------BEGIN DOCUMENT METADATA-----------------------------";
        const END_DELIM =
            "-----------------------------END DOCUMENT METADATA------------------------------";

        const hasBlock =
            doc.text.includes(BEGIN_DELIM) && doc.text.includes(END_DELIM);

        if (!hasBlock) {
            issues.push({
                severity: "error",
                code: "format.metadata_block.missing",
                message: "Document is missing required metadata block",
                file: rel_path
            });
            return;
        }

        const requiredFields = effective.metadata_required_fields;
        if (!isArray(requiredFields) || requiredFields.length === 0) {
            return;
        }

        // Extract field lines between delimiters
        const start = doc.text.indexOf(BEGIN_DELIM) + BEGIN_DELIM.length;
        const end = doc.text.indexOf(END_DELIM, start);
        const blockText = doc.text.slice(start, end);
        const fieldPattern = /^([A-Z][A-Za-z0-9]*(?:-[A-Z][A-Za-z0-9]*)*): /m;
        const presentFields = new Set(
            blockText
                .split("\n")
                .map((l) => l.trim())
                .filter((l) => fieldPattern.test(l))
                .map((l) => l.split(":")[0].trim())
        );

        for (let i = 0, len = requiredFields.length; i < len; i++) {
            const field = requiredFields[i];
            if (!presentFields.has(field)) {
                issues.push({
                    severity: "error",
                    code: "format.metadata_block.missing_field",
                    message: `Metadata block missing required field: ${field}`,
                    file: rel_path
                });
            }
        }
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    /**
     * Merge two policy objects
     * @param {DocumentPolicy} a
     * @param {DocumentPolicy} b
     * @returns {DocumentPolicy}
     * @private
     */
    static _mergePolicy(a, b) {
        if (!isObject(a)) {
            return b;
        }
        if (!isObject(b)) {
            return a;
        }

        return mergeObjects(a, b, POLICY_MERGE_STRATEGY);
    }

    /**
     * Merge enforce object into base
     * @param {RulesetEnforce} base
     * @param {RulesetEnforce} enforce
     * @returns {RulesetEnforce}
     * @private
     */
    static _mergeEnforce(base, enforce) {
        if (!isObject(base)) {
            base = {};
        }
        if (!isObject(enforce)) {
            return base;
        }

        return /** @type {RulesetEnforce} */ (
            mergeObjects(base, enforce, FORMATTING_MERGE_STRATEGY)
        );
    }

    /**
     * Check if a ruleset matches a file
     * @param {PackRuleset} ruleset
     * @param {{ rel_path: string, doc_type: string | null, ext: string | null, is_root_file: boolean }} file
     * @returns {boolean}
     * @private
     */
    static _rulesetMatches(ruleset, file) {
        return rulesetMatchesFile(ruleset, file);
    }
}
