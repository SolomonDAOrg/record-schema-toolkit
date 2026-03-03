/**
 * FormattingPackAdapter - Adapts FormattingPack rules to FormatAST
 * @module format-ast/adapters/FormattingPackAdapter
 */

/**
 * @typedef {import("../types/core.mjs").TextStyle} TextStyle
 * @typedef {import("../types/core.mjs").PageConfig} PageConfig
 * @typedef {import("../types/core.mjs").HeaderFooterConfig} HeaderFooterConfig
 * @typedef {import("../types/core.mjs").Margins} Margins
 */

/**
 * @typedef {import("../../record-schema/FormattingPack.mjs").FormattingPackData} FormattingPackData
 * @typedef {import("../../record-schema/FormattingPack.mjs").DocumentPolicy} DocumentPolicy
 */

/**
 * @typedef {Object} PdfRenderingConfig
 * @property {number} [base_font_size]
 * @property {number} [title_font_size]
 * @property {{ h1?: number, h2?: number, h3?: number, h4?: number }} [heading_scales]
 * @property {{ top?: number, right?: number, bottom?: number, left?: number }} [margins]
 * @property {string} [line_spacing]
 * @property {number} [paragraph_spacing_factor]
 * @property {number} [list_indent_per_level]
 * @property {number} [code_block_indent]
 * @property {{ width_factor?: number, thickness?: number, gray_value?: number }} [horizontal_rule]
 * @property {{ regular?: string, bold?: string, italic?: string, monospace?: string }} [fonts]
 */

/**
 * Adapts FormattingPack configuration to FormatAST types
 */
export class FormattingPackAdapter {
    /**
     * @param {FormattingPackData} pack
     */
    constructor(pack) {
        /** @type {FormattingPackData} */
        this.pack = pack;

        /** @type {DocumentPolicy} */
        this.policy = pack.document_policies || {};
    }

    // =========================================================================
    // Templates
    // =========================================================================

    /**
     * Get template by ID
     * @param {string} templateId
     * @returns {{ content: string[] } | undefined}
     */
    getTemplate(templateId) {
        return this.policy.templates?.[templateId];
    }

    /**
     * Render template with variables
     * @param {string} templateId
     * @param {Record<string, string>} variables
     * @returns {string[]}
     */
    renderTemplate(templateId, variables) {
        const template = this.getTemplate(templateId);
        if (!template) {
            return [];
        }

        return template.content.map((line) => {
            let result = line;
            for (const key of Object.keys(variables)) {
                result = result.replace(
                    new RegExp(`\\$\\{${key}\\}`, "g"),
                    variables[key]
                );
            }
            return result;
        });
    }

    // =========================================================================
    // Dialect / Spelling
    // =========================================================================

    /**
     * Get dialect pack
     * @param {string} packId
     * @returns {unknown}
     */
    getDialectPack(packId) {
        return this.policy.dialect_packs?.[packId];
    }

    /**
     * Get default dialect pack ID
     * @returns {string | undefined}
     */
    getDefaultDialect() {
        return /** @type {string | undefined} */ (
            this.policy.defaults?.dialect_pack
        );
    }

    // =========================================================================
    // Shapes
    // =========================================================================

    /**
     * Get shape definition
     * @param {string} shapeId
     * @returns {unknown}
     */
    getShape(shapeId) {
        return this.policy.shapes?.[shapeId];
    }

    // =========================================================================
    // Rulesets
    // =========================================================================

    /**
     * Get matching ruleset for file
     * @param {{ relPath: string, docType: string | null, ext: string | null }} file
     * @returns {unknown | null}
     */
    getMatchingRuleset(file) {
        const rulesets = this.policy.rulesets;
        if (!rulesets || !Array.isArray(rulesets)) {
            return null;
        }

        for (let i = 0, len = rulesets.length; i < len; i++) {
            const ruleset = rulesets[i];
            if (this._rulesetMatches(ruleset, file)) {
                return ruleset;
            }
        }

        return null;
    }

    /**
     * Check if ruleset matches file
     * @private
     * @param {unknown} ruleset
     * @param {{ relPath: string, docType: string | null, ext: string | null }} file
     * @returns {boolean}
     */
    _rulesetMatches(ruleset, file) {
        if (!ruleset || typeof ruleset !== "object") {
            return false;
        }

        const sel = /** @type {Record<string, unknown>} */ (ruleset).selectors;
        if (!sel || typeof sel !== "object") {
            return true; // No selectors = matches all
        }

        const selectors = /** @type {Record<string, unknown>} */ (sel);

        // Check extensions
        if (Array.isArray(selectors.extensions)) {
            if (!file.ext) {
                return false;
            }
            const exts = /** @type {string[]} */ (selectors.extensions);
            if (!exts.some((e) => e.toLowerCase() === file.ext)) {
                return false;
            }
        }

        // Check doc types
        if (Array.isArray(selectors.doc_types)) {
            if (!file.docType) {
                return false;
            }
            const types = /** @type {string[]} */ (selectors.doc_types);
            if (!types.includes(file.docType)) {
                return false;
            }
        }

        return true;
    }
}

/**
 * Create adapter from pack data
 * @param {FormattingPackData} pack
 * @returns {FormattingPackAdapter}
 */
export function createFormattingPackAdapter(pack) {
    return new FormattingPackAdapter(pack);
}
