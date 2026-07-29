/**
 * Document class for document files
 * @module classes/Document
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { DocumentMetadata } from "./DocumentMetadata.mjs";
import { Schema } from "./Schema.mjs";
import {
    normalizeBaseline as _normalizeBaseline,
    normalizeCanonicalAscii as _normalizeCanonicalAscii,
    findNonAscii as _findNonAscii
} from "./util/normalization.mjs";
import { parseMarkdownDoc, reflowMarkdown } from "../parsing/markdown.mjs";
import { convertMarkdownToDocument } from "../ast/converters/MarkdownToAstConverter.mjs";
import { isString, isArray, stringOr, enumOr } from "../util/general.mjs";

/** @typedef {import("./types/general.mjs").FileInfo} FileInfo */
/** @typedef {import("./types/general.mjs").NormalizeResult} NormalizeResult */
/** @typedef {import("./types/general.mjs").DocumentLintResult} LintResult */
/** @typedef {import("./types/general.mjs").SchemaError} SchemaError */
/** @typedef {import("../parsing/markdown.mjs").ReflowOptions} ReflowOptions */
/** @typedef {import("./types/general.mjs").PackEntry} PackEntry */
/** @typedef {import("./RenderPack.mjs").RenderPack} RenderPack */

/**
 * Document representing a file in the repository
 */
export class Document {
    /**
     * @param {string} text
     * @param {string | null} [source_path]
     */
    constructor(text, source_path = null) {
        /** @type {string} */
        this.text = text;

        /** @type {string | null} */
        this.source_path = source_path;

        /** @type {FileInfo | null} */
        this._file_info = null;

        /** @type {DocumentMetadata | null} */
        this._metadata = null;

        /** @type {boolean} */
        this._metadata_extracted = false;
    }

    // =========================================================================
    // Static Factory Methods
    // =========================================================================

    /**
     * Load document from file
     * @param {string} abs_path
     * @returns {Document}
     */
    static load(abs_path) {
        return new Document(readFileSync(abs_path, "utf8"), abs_path);
    }

    /**
     * Load document from file if it exists
     * @param {string} abs_path
     * @returns {Document | null}
     */
    static loadIfExists(abs_path) {
        if (!existsSync(abs_path)) {
            return null;
        }
        return Document.load(abs_path);
    }

    /**
     * Create document from text
     * @param {string} text
     * @param {string | null} [source_path]
     * @returns {Document}
     */
    static fromText(text, source_path = null) {
        return new Document(text, source_path);
    }

    /**
     * Create empty document
     * @returns {Document}
     */
    static empty() {
        return new Document("", null);
    }

    // =========================================================================
    // File Info
    // =========================================================================

    /**
     * Get file info (parsed from path)
     * @returns {FileInfo}
     */
    getFileInfo() {
        if (this._file_info) {
            return this._file_info;
        }
        this._file_info = Document.parseFileInfo(this.source_path || "");
        return this._file_info;
    }

    /**
     * Parse file info from path
     * @param {string} rel_path
     * @returns {FileInfo}
     */
    static parseFileInfo(rel_path) {
        const base = basename(rel_path);
        const ext_with_dot = extname(base);
        const ext =
            ext_with_dot.length > 0
                ? ext_with_dot.slice(1).toLowerCase()
                : null;
        const base_name =
            ext_with_dot.length > 0
                ? base.slice(0, -ext_with_dot.length)
                : base;

        // Prefer canonical record-schema names such as DEP-00001_PLAN-deployment.json.
        // Fall back to legacy names such as CHA-document.md.
        const record_prefixed_match = base_name.match(/^[A-Z]{2,5}-\d{5}_([A-Z]{2,5})(?:-|_|$)/);
        const legacy_match = base_name.match(/^([A-Z]{2,5})(?:-|_)/);
        const doc_type = record_prefixed_match ? record_prefixed_match[1] : legacy_match ? legacy_match[1] : null;

        // Extract record ID from path
        const record_match = rel_path.match(/([A-Z]{2,5}-\d{5})/);
        const record_id = record_match ? record_match[1] : null;

        // Extract version from filename
        const version_match = base_name.match(/[_-](v\d+|DRAFT|FINAL)$/i);
        const version = version_match ? version_match[1].toUpperCase() : null;

        return {
            base_name,
            ext,
            doc_type,
            record_id,
            version
        };
    }

    /**
     * Get file extension
     * @returns {string | null}
     */
    getExtension() {
        return this.getFileInfo().ext;
    }

    /**
     * Get base name
     * @returns {string}
     */
    getBaseName() {
        return this.getFileInfo().base_name;
    }

    /**
     * Get document type
     * @returns {string | null}
     */
    getDocType() {
        return this.getFileInfo().doc_type;
    }

    /**
     * Check if document is markdown
     * @returns {boolean}
     */
    isMarkdown() {
        return this.getExtension() === "md";
    }

    /**
     * Check if document is text-based
     * @returns {boolean}
     */
    isText() {
        const ext = this.getExtension();
        return (
            ext === "md" ||
            ext === "txt" ||
            ext === "yaml" ||
            ext === "yml" ||
            ext === "json" ||
            this.getBaseName() === "LICENSE"
        );
    }

    /**
     * Reload document content from source path
     * @returns {boolean} True if reloaded, false if no source path or file missing
     */
    reload() {
        if (!this.source_path || !existsSync(this.source_path)) {
            return false;
        }
        this.text = readFileSync(this.source_path, "utf8");

        // Invalidate cached metadata so it gets re-parsed on next access
        this._metadata = null;
        this._metadata_extracted = false;

        return true;
    }

    // =========================================================================
    // Metadata
    // =========================================================================

    /**
     * Get or extract document metadata
     * @returns {DocumentMetadata | null}
     */
    getMetadata() {
        if (this._metadata_extracted) {
            return this._metadata;
        }
        this._metadata_extracted = true;

        if (this.isMarkdown()) {
            this._metadata = DocumentMetadata.extractFromMarkdown(this.text);
            if (!this._metadata.isEmpty()) {
                return this._metadata;
            }
        }

        const extracted = DocumentMetadata.extractTrailing(this.text);
        this._metadata = extracted.metadata;
        return this._metadata;
    }

    /**
     * Get sidecar metadata if it exists
     * @returns {DocumentMetadata | null}
     */
    getSidecarMetadata() {
        if (!this.source_path) {
            return null;
        }
        return DocumentMetadata.loadSidecar(this.source_path);
    }

    /**
     * Check if document has embedded metadata
     * @returns {boolean}
     */
    hasEmbeddedMetadata() {
        const meta = this.getMetadata();
        return meta !== null && !meta.isEmpty();
    }

    /**
     * Check if document has sidecar metadata
     * @returns {boolean}
     */
    hasSidecarMetadata() {
        if (!this.source_path) {
            return false;
        }
        return existsSync(this.source_path + ".metadata");
    }

    // =========================================================================
    // Normalization
    // =========================================================================

    /**
     * Apply baseline normalization
     * @returns {Document}
     */
    normalizeBaseline() {
        return new Document(_normalizeBaseline(this.text), this.source_path);
    }

    /**
     * Apply canonical ASCII normalization
     * @returns {NormalizeResult}
     */
    normalizeCanonicalAscii() {
        return _normalizeCanonicalAscii(this.text);
    }

    /**
     * Reflow paragraph text to fit within maxWidth columns.
     * Only applies to Markdown files; preserves code fences, tables, headings,
     * lists, and blockquotes. No-op for non-Markdown.
     * @param {number} maxWidth
     * @param {ReflowOptions} [options]
     * @returns {{ text: string, changed: boolean }}
     */
    reflow(maxWidth, options) {
        if (!this.isMarkdown()) {
            return { text: this.text, changed: false };
        }
        return reflowMarkdown(this.text, maxWidth, options);
    }

    /**
     * Find non-ASCII characters in document
     * @returns {string[]}
     */
    findNonAscii() {
        return _findNonAscii(this.text);
    }

    // =========================================================================
    // Validation
    // =========================================================================

    /**
     * Validate embedded metadata against schema
     * @param {Schema} schema
     * @returns {SchemaError[]}
     */
    validateMetadata(schema) {
        const meta = this.getMetadata();
        if (!meta) {
            return [];
        }
        return meta.validate(schema);
    }

    /**
     * Validate sidecar metadata against schema
     * @param {Schema} schema
     * @returns {SchemaError[]}
     */
    validateSidecarMetadata(schema) {
        const meta = this.getSidecarMetadata();
        if (!meta) {
            return [];
        }
        return meta.validate(schema);
    }

    // =========================================================================
    // Content Operations
    // =========================================================================

    /**
     * Get body without metadata block
     * @returns {string}
     */
    getBody() {
        const extracted = DocumentMetadata.extractTrailing(this.text);
        return extracted.body;
    }

    /**
     * Check if document has footer delimiter
     * @returns {boolean}
     */
    hasFooterDelimiter() {
        const lines = this.text.split("\n");
        for (let i = lines.length - 1; i >= 0 && i > lines.length - 80; i--) {
            if (lines[i].trim() === "---") {
                return true;
            }
        }
        return false;
    }

    /**
     * Get lines as array
     * @returns {string[]}
     */
    getLines() {
        return this.text.split("\n");
    }

    /**
     * Get line count
     * @returns {number}
     */
    getLineCount() {
        return this.getLines().length;
    }

    // =========================================================================
    // Persistence
    // =========================================================================

    /**
     * Save document to its source path
     * @returns {boolean}
     */
    save() {
        if (!this.source_path) {
            return false;
        }
        writeFileSync(this.source_path, this.text, "utf8");
        return true;
    }

    /**
     * Save document to a specific path
     * @param {string} abs_path
     */
    saveTo(abs_path) {
        writeFileSync(abs_path, this.text, "utf8");
        this.source_path = abs_path;
        this._file_info = null;
    }

    // =========================================================================
    // Render Source Assembly
    // =========================================================================

    /**
     * Parse this document and apply render pack rules to produce a render source
     * object ready for the pipeline. Keeps RenderPack config in raw snake_case —
     * callers are responsible for converting at the renderer boundary.
     *
     * @param {RenderPack} render_pack
     * @param {PackEntry} entry
     * @param {string} rel_record_path - record rel_path used to build the file's rel_path
     * @param {{ disable_soft_wrap?: boolean }} [options]
     * @returns {{
     *     id: string,
     *     name: string,
     *     root: unknown,
     *     metadata: import("./types/general.mjs").Metadata,
     *     headerTitle: string,
     *     header_name: string | null,
     *     variables: import("./types/general.mjs").Metadata,
     *     break_mode: string | null,
     *     horizontal_rule_behavior: string | null
     * }}
     */
    toRenderSource(render_pack, entry, rel_record_path, options) {
        const ast = convertMarkdownToDocument(
            parseMarkdownDoc(
                this.text,
                options?.disable_soft_wrap === true
                    ? undefined
                    : { softWrap: true }
            )
        );

        const metadata = this.getMetadata()?.data || {};

        const raw_title = metadata.Title;
        const meta_title = isString(raw_title)
            ? raw_title
            : isArray(raw_title) && raw_title.length > 0
            ? raw_title[0]
            : null;

        const display_name =
            entry.label ||
            meta_title ||
            render_pack.deriveDocumentName(entry.path) ||
            basename(entry.path, ".md");

        const header_name =
            entry.short_label != null ? entry.short_label : null;

        const rel_source_path = rel_record_path.endsWith("/")
            ? `${rel_record_path}${entry.path}`
            : `${rel_record_path}/${entry.path}`;

        const src_ext_raw = extname(entry.path);
        const src_ext = src_ext_raw.startsWith(".")
            ? src_ext_raw.slice(1)
            : src_ext_raw;

        const resolved_doc_type =
            stringOr(entry.doc_type) ||
            stringOr(metadata?.doc_type) ||
            stringOr(metadata?.DocType) ||
            null;

        const doc_config =
            resolved_doc_type !== null
                ? render_pack.resolveForFile({
                      rel_path: rel_source_path,
                      doc_type: resolved_doc_type,
                      ext: src_ext || "md"
                  })
                : null;

        const break_mode =
            enumOr(doc_config?.break_mode, ["always", "part-only"], "") || null;

        const horizontal_rule_behavior =
            stringOr(doc_config?.horizontal_rule?.behavior) ?? null;

        return {
            id: entry.path,
            name: display_name,
            root: ast.root,
            metadata,
            headerTitle: display_name,
            header_name,
            variables: { break_mode: break_mode ?? "always" },
            break_mode,
            horizontal_rule_behavior
        };
    }

    // =========================================================================
    // Cloning
    // =========================================================================

    /**
     * Create a copy with new text
     * @param {string} text
     * @returns {Document}
     */
    withText(text) {
        return new Document(text, this.source_path);
    }

    /**
     * Clone the document
     * @returns {Document}
     */
    clone() {
        return new Document(this.text, this.source_path);
    }
}
