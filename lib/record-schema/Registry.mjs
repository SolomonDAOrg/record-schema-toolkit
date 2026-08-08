/**
 * Registry class for YAML registry files (core-series.yaml, doc-types.yaml)
 * @module classes/Registry
 */

import { readFileSync, existsSync } from "node:fs";
import { parseYamlAll } from "../parsing/yaml.mjs";
import { isObject, hasPropertyOfType } from "../util/objects.mjs";
import { isString, isArray, arrayOr } from "../util/general.mjs";

/** @typedef {import("./types/general.mjs").DocTypeEntry} DocTypeEntry */
/** @typedef {import("./types/general.mjs").SeriesEntry} SeriesEntry */
/** @typedef {import("./types/general.mjs").CommitmentKindEntry} CommitmentKindEntry */

/**
 * Registry file representing series, doc types, and commitment kinds
 */
export class Registry {
    /**
     * @param {string | null} source_path
     */
    constructor(source_path = null) {
        /** @type {string | null} */
        this.source_path = source_path;

        /** @type {Map<string, SeriesEntry>} */
        this.series_by_code = new Map();

        /** @type {Map<string, DocTypeEntry>} */
        this.doc_types_by_code = new Map();

        /** @type {Map<string, CommitmentKindEntry>} */
        this.commitment_kinds_by_code = new Map();

        /** @type {unknown[]} */
        this.raw_documents = [];

        /** @type {(string | null)[]} */
        this.raw_document_sources = [];
    }

    // =========================================================================
    // Static Factory Methods
    // =========================================================================

    /**
     * Load registry from YAML file
     * @param {string} abs_path
     * @returns {Registry}
     */
    static load(abs_path) {
        return Registry.parse(readFileSync(abs_path, "utf8"), abs_path);
    }

    /**
     * Load registry from YAML file if it exists
     * @param {string} abs_path
     * @returns {Registry|null}
     */
    static loadIfExists(abs_path) {
        if (!existsSync(abs_path)) {
            return null;
        }
        return Registry.load(abs_path);
    }

    /**
     * Load and merge multiple registry files
     * @param {string[]} abs_paths
     * @returns {Registry}
     */
    static loadMerged(abs_paths) {
        const merged = new Registry(abs_paths[0] || null);
        for (let i = 0, len = abs_paths.length; i < len; i++) {
            const reg = Registry.loadIfExists(abs_paths[i]);
            if (reg) {
                merged._merge(reg);
            }
        }
        return merged;
    }

    /**
     * Parse registry from YAML string
     * @param {string} src
     * @param {string | null} [source_path]
     * @returns {Registry}
     */
    static parse(src, source_path = null) {
        const docs = Registry._parseDocuments(src, source_path);
        const registry = new Registry(source_path);
        registry.raw_documents = docs;
        registry.raw_document_sources = docs.map(() => source_path);
        registry._indexDocuments(docs);
        return registry;
    }

    /**
     * Create empty registry
     * @returns {Registry}
     */
    static empty() {
        return new Registry(null);
    }

    /**
     * Get the source file associated with a parsed registry document.
     * @param {number} index
     * @returns {string | null}
     */
    getRawDocumentSource(index) {
        return this.raw_document_sources[index] || this.source_path;
    }

    // =========================================================================
    // Series Methods
    // =========================================================================

    /**
     * Get series entry by code
     * @param {string} code
     * @returns {SeriesEntry|undefined}
     */
    getSeries(code) {
        return this.series_by_code.get(code);
    }

    /**
     * Get series name by code
     * @param {string} code
     * @returns {string}
     */
    getSeriesName(code) {
        const entry = this.series_by_code.get(code);
        return entry?.name || code;
    }

    /**
     * Get series description by code
     * @param {string} code
     * @returns {string | undefined}
     */
    getSeriesDescription(code) {
        const entry = this.series_by_code.get(code);
        return entry?.description;
    }

    /**
     * Check if series code exists
     * @param {string} code
     * @returns {boolean}
     */
    hasSeries(code) {
        return this.series_by_code.has(code);
    }

    /**
     * Validate that series code exists
     * @param {string} code
     * @returns {boolean}
     */
    isValidSeriesCode(code) {
        if (!isString(code) || !/^[A-Z]{2,5}$/.test(code)) {
            return false;
        }
        if (this.series_by_code.size === 0) {
            return true;
        }
        return this.series_by_code.has(code);
    }

    /**
     * Get all series codes
     * @returns {string[]}
     */
    getAllSeriesCodes() {
        return Array.from(this.series_by_code.keys());
    }

    /**
     * Get all series entries
     * @returns {SeriesEntry[]}
     */
    getAllSeries() {
        return Array.from(this.series_by_code.values());
    }

    /**
     * Get series by tier
     * @param {string} tier
     * @returns {SeriesEntry[]}
     */
    getSeriesByTier(tier) {
        /** @type {SeriesEntry[]} */
        const result = [];
        for (const entry of this.series_by_code.values()) {
            if (entry.tier === tier) {
                result.push(entry);
            }
        }
        return result;
    }

    /**
     * Get recommended doc types for a series
     * @param {string} series_code
     * @returns {string[]}
     */
    getRecommendedDocTypes(series_code) {
        const series = this.series_by_code.get(series_code);
        if (!series) {
            return [];
        }
        const recommended = arrayOr(series.recommended_doc_types);
        if (recommended.length > 0) {
            return recommended;
        }
        return arrayOr(series.allowed_doc_types);
    }

    // =========================================================================
    // Doc Type Methods
    // =========================================================================

    /**
     * Get doc type entry by code
     * @param {string} code
     * @returns {DocTypeEntry|undefined}
     */
    getDocType(code) {
        return this.doc_types_by_code.get(code);
    }

    /**
     * Get doc type name by code
     * @param {string} code
     * @returns {string}
     */
    getDocTypeName(code) {
        const entry = this.doc_types_by_code.get(code);
        return entry?.name || code;
    }

    /**
     * Get doc type description by code
     * @param {string} code
     * @returns {string | undefined}
     */
    getDocTypeDescription(code) {
        const entry = this.doc_types_by_code.get(code);
        return entry?.description;
    }

    /**
     * Check if doc type code exists
     * @param {string} code
     * @returns {boolean}
     */
    hasDocType(code) {
        return this.doc_types_by_code.has(code);
    }

    /**
     * Validate that doc type code exists
     * @param {string} code
     * @returns {boolean}
     */
    isValidDocTypeCode(code) {
        if (!isString(code) || !/^[A-Z]{2,5}$/.test(code)) {
            return false;
        }
        if (this.doc_types_by_code.size === 0) {
            return true;
        }
        return this.doc_types_by_code.has(code);
    }

    /**
     * Get all doc type codes
     * @returns {string[]}
     */
    getAllDocTypeCodes() {
        return Array.from(this.doc_types_by_code.keys());
    }

    /**
     * Get all doc type entries
     * @returns {DocTypeEntry[]}
     */
    getAllDocTypes() {
        return Array.from(this.doc_types_by_code.values());
    }

    /**
     * Get recommended extensions for doc type
     * @param {string} code
     * @returns {string[]}
     */
    getRecommendedExtensions(code) {
        const entry = this.doc_types_by_code.get(code);
        return arrayOr(entry?.recommended_extensions);
    }

    /**
     * Get markdown envelope ID for doc type
     * @param {string} code
     * @returns {string | undefined}
     */
    getMarkdownEnvelope(code) {
        const entry = this.doc_types_by_code.get(code);
        return entry?.markdown_envelope;
    }

    /**
     * Get recommended header fields for doc type
     * @param {string} code
     * @returns {string[]}
     */
    getRecommendedHeaderFields(code) {
        const entry = this.doc_types_by_code.get(code);
        return arrayOr(entry?.recommended_header_fields);
    }

    /**
     * Get recommended slug for doc type
     * @param {string} code
     * @returns {string | undefined}
     */
    getRecommendedSlug(code) {
        const entry = this.doc_types_by_code.get(code);
        return entry?.recommended_slug;
    }

    /**
     * Check if doc type is a filing type
     * @param {string} code
     * @returns {boolean}
     */
    isFilingDocType(code) {
        const entry = this.doc_types_by_code.get(code);
        if (!entry) {
            return false;
        }
        return entry.filing === true || entry.exclude_ind === true;
    }

    /**
     * Check if IND should be excluded from PDF for this doc type
     * @param {string} code
     * @returns {boolean}
     */
    shouldExcludeIndFromPdf(code) {
        const entry = this.doc_types_by_code.get(code);
        if (!entry) {
            return false;
        }
        return entry.exclude_ind === true || entry.filing === true;
    }

    /**
     * Get all filing doc type codes
     * @returns {string[]}
     */
    getFilingDocTypeCodes() {
        /** @type {string[]} */
        const result = [];
        for (const [code, entry] of this.doc_types_by_code) {
            if (entry.filing === true || entry.exclude_ind === true) {
                result.push(code);
            }
        }
        return result;
    }

    // =========================================================================
    // Cross-Reference Methods
    // =========================================================================

    /**
     * Check if a doc type is allowed in a series
     * @param {string} doc_type_code
     * @param {string} series_code
     * @returns {boolean}
     */
    isDocTypeAllowedInSeries(doc_type_code, series_code) {
        const series = this.series_by_code.get(series_code);
        const allowed = arrayOr(series?.allowed_doc_types);
        if (allowed.length > 0 && !allowed.includes(doc_type_code)) {
            return false;
        }

        const doc_type = this.doc_types_by_code.get(doc_type_code);
        const allowedSeries = arrayOr(doc_type?.allowed_series);
        if (allowedSeries.length > 0 && !allowedSeries.includes(series_code)) {
            return false;
        }

        return true;
    }

    // =========================================================================
    // Commitment Kind Methods
    // =========================================================================

    /**
     * Get commitment kind entry by code
     * @param {string} code
     * @returns {CommitmentKindEntry|undefined}
     */
    getCommitmentKind(code) {
        return this.commitment_kinds_by_code.get(code);
    }

    /**
     * Get commitment kind name by code
     * @param {string} code
     * @returns {string}
     */
    getCommitmentKindName(code) {
        const entry = this.commitment_kinds_by_code.get(code);
        return entry?.name || code;
    }

    /**
     * Check if commitment kind code exists
     * @param {string} code
     * @returns {boolean}
     */
    hasCommitmentKind(code) {
        return this.commitment_kinds_by_code.has(code);
    }

    /**
     * Get all commitment kind codes
     * @returns {string[]}
     */
    getAllCommitmentKindCodes() {
        return Array.from(this.commitment_kinds_by_code.keys());
    }

    /**
     * Get all commitment kind entries
     * @returns {CommitmentKindEntry[]}
     */
    getAllCommitmentKinds() {
        return Array.from(this.commitment_kinds_by_code.values());
    }

    /**
     * Get required fields for commitment kind
     * @param {string} code
     * @returns {string[]}
     */
    getCommitmentRequiredOneOf(code) {
        const entry = this.commitment_kinds_by_code.get(code);
        return arrayOr(entry?.required_one_of);
    }

    /**
     * Get recommended fields for commitment kind
     * @param {string} code
     * @returns {string[]}
     */
    getCommitmentRecommendedFields(code) {
        const entry = this.commitment_kinds_by_code.get(code);
        return arrayOr(entry?.recommended_fields);
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    /**
     * Merge another registry into this one
     * @param {Registry} other
     * @private
     */
    _merge(other) {
        for (const [code, entry] of other.series_by_code) {
            this.series_by_code.set(code, entry);
        }
        for (const [code, entry] of other.doc_types_by_code) {
            this.doc_types_by_code.set(code, entry);
        }
        for (const [code, entry] of other.commitment_kinds_by_code) {
            this.commitment_kinds_by_code.set(code, entry);
        }
        this.raw_documents = this.raw_documents.concat(other.raw_documents);
        const otherSources = [];
        for (let i = 0, len = other.raw_documents.length; i < len; i++) {
            otherSources.push(other.getRawDocumentSource(i));
        }
        this.raw_document_sources =
            this.raw_document_sources.concat(otherSources);
    }

    /**
     * Parse registry documents handling combined format
     * @param {string} src
     * @param {string | null} source_path
     * @returns {unknown[]}
     * @private
     */
    static _parseDocuments(src, source_path) {
        const norm = src.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

        if (norm.trim().length === 0) {
            return [null];
        }

        let text = norm;
        if (!/^---\n/m.test(text)) {
            const re = /^schema:\s*record-schema-registry\b/gm;
            let seen = 0;
            text = text.replace(re, (m) => {
                seen += 1;
                if (seen === 1) {
                    return m;
                }
                return `---\n${m}`;
            });
        }

        return parseYamlAll(text, { filename: source_path || undefined });
    }

    /**
     * Index parsed documents into maps
     * @param {unknown[]} docs
     * @private
     */
    _indexDocuments(docs) {
        for (let i = 0, len = docs.length; i < len; i++) {
            const d = docs[i];
            if (!isObject(d)) {
                continue;
            }

            // @ts-ignore
            const series = d.series;
            if (isArray(series)) {
                for (let j = 0, j_len = series.length; j < j_len; j++) {
                    const s = series[j];
                    if (!isObject(s)) {
                        continue;
                    }
                    // @ts-ignore
                    const code = s.code;
                    if (isString(code) && code.length > 0) {
                        this.series_by_code.set(
                            code,
                            /** @type {SeriesEntry} */ (s)
                        );
                    }
                }
            }

            // @ts-ignore
            const doc_types = d.doc_types;
            if (isArray(doc_types)) {
                for (let j = 0, j_len = doc_types.length; j < j_len; j++) {
                    const t = doc_types[j];
                    if (!isObject(t)) {
                        continue;
                    }
                    // @ts-ignore
                    const code = t.code;
                    if (isString(code) && code.length > 0) {
                        this.doc_types_by_code.set(
                            code,
                            /** @type {DocTypeEntry} */ (t)
                        );
                    }
                }
            }

            // @ts-ignore
            const kinds = d.commitment_kinds;
            if (isArray(kinds)) {
                for (let j = 0, j_len = kinds.length; j < j_len; j++) {
                    const k = kinds[j];
                    if (!isObject(k)) {
                        continue;
                    }
                    // @ts-ignore
                    const code = k.code;
                    if (isString(code) && code.length > 0) {
                        this.commitment_kinds_by_code.set(
                            code,
                            /** @type {CommitmentKindEntry} */ (k)
                        );
                    }
                }
            }
        }
    }
}
