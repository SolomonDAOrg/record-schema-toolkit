/**
 * Language rule registry helpers for downstream rule schema validation.
 * @module classes/LanguageRuleRegistry
 */

import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { parseYaml } from "../parsing/yaml.mjs";
import { isArray, isString } from "../util/general.mjs";
import { isObject } from "../util/objects.mjs";
import { Schema } from "./Schema.mjs";

/** @typedef {import("./types/general.mjs").RecordInfo} RecordInfo */
/** @typedef {import("./types/general.mjs").ValidationIssue} ValidationIssue */
/** @typedef {import("./Registry.mjs").Registry} Registry */
/** @typedef {import("./Profile.mjs").Profile} Profile */

export class LanguageRuleRegistry {
    /**
     * @param {string} root_dir
     * @param {Registry | null} registry
     * @param {Profile | null} profile
     */
    constructor(root_dir, registry, profile) {
        /** @type {string} */
        this.root_dir = root_dir;

        /** @type {Registry | null} */
        this.registry = registry;

        /** @type {Profile | null} */
        this.profile = profile;

        /** @type {Map<string, { category_type: string, doc_type: string, schema_path: string }>} */
        this.schema_by_doc_type = new Map();

        /** @type {Map<string, { category_type: string, doc_type: string, schema_path: string }>} */
        this.schema_by_category_type = new Map();

        this._loadMaps();
    }

    /**
     * @returns {boolean}
     */
    hasLanguageRuleConfig() {
        return this.schema_by_doc_type.size > 0 || this._hasCategoryDefinitionSchema();
    }

    /**
     * @param {RecordInfo} record
     * @returns {ValidationIssue[]}
     */
    validateRecord(record) {
        /** @type {ValidationIssue[]} */
        const issues = [];
        const metafile = record.metafile;
        if (!metafile) {
            return issues;
        }

        const primaryRefs = metafile.getDocumentsByTier("primary");
        for (let i = 0, len = primaryRefs.length; i < len; i++) {
            const ref = primaryRefs[i];
            if (!isObject(ref) || !isString(ref.path)) {
                continue;
            }
            const abs = resolve(record.abs_path, ref.path);
            if (!existsSync(abs)) {
                continue;
            }
            const ext = extname(abs).toLowerCase();
            if (ext !== ".yaml" && ext !== ".yml" && ext !== ".json") {
                continue;
            }

            const docType = isString(ref.doc_type) ? ref.doc_type : null;
            const data = this._readData(abs);
            if (!isObject(data)) {
                continue;
            }

            const categoryType = this._getCategoryType(data, metafile.data);
            const schemaPath = this._resolveSchemaPath(data, docType, categoryType);
            if (!schemaPath) {
                continue;
            }

            if (docType && categoryType && data.schema !== "language-rule-category-definition") {
                const expectedDocType = this.getDocTypeForCategory(categoryType);
                if (expectedDocType && expectedDocType !== docType) {
                    issues.push({
                        severity: "error",
                        code: "language-rule.doc-type.mismatch",
                        message: `Category ${categoryType} expects ${expectedDocType}, got ${docType}`,
                        file: this._rel(abs)
                    });
                }
            }

            const schema = Schema.loadIfExists(schemaPath);
            if (!schema) {
                issues.push({
                    severity: "error",
                    code: "language-rule.schema.missing",
                    message: `Rule schema not found: ${this._rel(schemaPath)}`,
                    file: this._rel(abs)
                });
                continue;
            }

            const errors = schema.validate(data);
            for (let j = 0, jLen = errors.length; j < jLen; j++) {
                issues.push({
                    severity: "error",
                    code: "language-rule.schema",
                    message: `${errors[j].path}: ${errors[j].message}`,
                    file: this._rel(abs)
                });
            }
        }

        return issues;
    }

    /**
     * @param {string} categoryType
     * @returns {string | null}
     */
    getDocTypeForCategory(categoryType) {
        const entry = this.schema_by_category_type.get(categoryType);
        return entry ? entry.doc_type : null;
    }

    _loadMaps() {
        this._loadFromRegistryDocuments();
        this._loadFromConventionalSchemaMap();
        this._loadFromConventionalCategoryCatalog();
    }

    _loadFromRegistryDocuments() {
        if (!this.registry) {
            return;
        }
        const docs = this.registry.raw_documents;
        for (let i = 0, len = docs.length; i < len; i++) {
            const doc = docs[i];
            if (!isObject(doc)) {
                continue;
            }
            if (doc.schema === "language-rule-schema-map") {
                this._indexSchemaMapDocument(doc);
            } else if (doc.schema === "language-rule-category-type-catalog") {
                this._indexCategoryCatalogDocument(doc);
            }
        }
    }

    _loadFromConventionalSchemaMap() {
        const abs = resolve(this.root_dir, "registry/solomon-language-rule-schema-map.yaml");
        if (!existsSync(abs)) {
            return;
        }
        const doc = this._readData(abs);
        if (isObject(doc)) {
            this._indexSchemaMapDocument(doc);
        }
    }

    _loadFromConventionalCategoryCatalog() {
        const abs = resolve(this.root_dir, "registry/language-rule-category-types.yaml");
        if (!existsSync(abs)) {
            return;
        }
        const doc = this._readData(abs);
        if (isObject(doc)) {
            this._indexCategoryCatalogDocument(doc);
        }
    }

    /**
     * @param {Record<string, unknown>} doc
     */
    _indexSchemaMapDocument(doc) {
        const entries = doc.category_schemas;
        if (!isArray(entries)) {
            return;
        }
        for (let i = 0, len = entries.length; i < len; i++) {
            const entry = entries[i];
            if (!isObject(entry)) {
                continue;
            }
            this._addSchemaEntry(entry.category_type, entry.doc_type, entry.schema_path);
        }
    }

    /**
     * @param {Record<string, unknown>} doc
     */
    _indexCategoryCatalogDocument(doc) {
        const entries = doc.category_types;
        if (!isArray(entries)) {
            return;
        }
        for (let i = 0, len = entries.length; i < len; i++) {
            const entry = entries[i];
            if (!isObject(entry)) {
                continue;
            }
            this._addSchemaEntry(
                entry.category_type,
                entry.rule_document_type,
                entry.rule_schema_path
            );
        }
    }

    /**
     * @param {unknown} categoryType
     * @param {unknown} docType
     * @param {unknown} schemaPath
     */
    _addSchemaEntry(categoryType, docType, schemaPath) {
        if (!isString(categoryType) || !isString(docType) || !isString(schemaPath)) {
            return;
        }
        const abs = resolve(this.root_dir, schemaPath);
        const entry = { category_type: categoryType, doc_type: docType, schema_path: abs };
        this.schema_by_doc_type.set(docType, entry);
        this.schema_by_category_type.set(categoryType, entry);
    }

    /**
     * @param {Record<string, unknown>} data
     * @param {string | null} docType
     * @param {string | null} categoryType
     * @returns {string | null}
     */
    _resolveSchemaPath(data, docType, categoryType) {
        if (data.schema === "language-rule-category-definition") {
            const abs = resolve(
                this.root_dir,
                "schema/language-rule-registry/rule-category-definition.schema.json"
            );
            return existsSync(abs) ? abs : null;
        }
        if (categoryType && this.schema_by_category_type.has(categoryType)) {
            return this.schema_by_category_type.get(categoryType)?.schema_path || null;
        }
        if (docType && this.schema_by_doc_type.has(docType)) {
            return this.schema_by_doc_type.get(docType)?.schema_path || null;
        }
        return null;
    }

    /**
     * @returns {boolean}
     */
    _hasCategoryDefinitionSchema() {
        return existsSync(
            resolve(this.root_dir, "schema/language-rule-registry/rule-category-definition.schema.json")
        );
    }

    /**
     * @param {Record<string, unknown>} data
     * @param {Record<string, unknown>} meta
     * @returns {string | null}
     */
    _getCategoryType(data, meta) {
        if (isString(data.category_type)) {
            return data.category_type;
        }
        const extensions = meta.extensions;
        if (!isObject(extensions)) {
            return null;
        }
        const languageRuleRegistry = extensions.language_rule_registry;
        if (!isObject(languageRuleRegistry)) {
            return null;
        }
        return isString(languageRuleRegistry.category_type)
            ? languageRuleRegistry.category_type
            : null;
    }

    /**
     * @param {string} abs
     * @returns {unknown}
     */
    _readData(abs) {
        const text = readFileSync(abs, "utf8");
        if (extname(abs).toLowerCase() === ".json") {
            return JSON.parse(text);
        }
        return parseYaml(text, { filename: abs });
    }

    /**
     * @param {string} abs
     * @returns {string}
     */
    _rel(abs) {
        const rel = abs.startsWith(this.root_dir)
            ? abs.slice(this.root_dir.length).replace(/^[/\\]+/, "")
            : abs;
        return rel.replace(/\\/g, "/");
    }
}
