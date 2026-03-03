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

/** @typedef {import("./types/general.mjs").FileInfo} FileInfo */
/** @typedef {import("./types/general.mjs").NormalizeResult} NormalizeResult */
/** @typedef {import("./types/general.mjs").DocumentLintResult} LintResult */
/** @typedef {import("./types/general.mjs").SchemaError} SchemaError */

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

        // Extract doc type from filename pattern like "CHA-document.md"
        const dt_match = base_name.match(/^([A-Z]{2,5})(?:-|_)/);
        const doc_type = dt_match ? dt_match[1] : null;

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
