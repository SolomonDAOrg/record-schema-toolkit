/**
 * DocumentMetadata class for inline or sidecar document metadata blocks
 * @module classes/DocumentMetadata
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { Schema } from "./Schema.mjs";
import { trimBom, normalizeEol } from "./util/normalization.mjs";
import {
    DOCUMENT_METADATA_BEGIN,
    DOCUMENT_METADATA_END
} from "./constants/constants.mjs";

/**
 * @typedef {import("../types/general.mjs").Metadata} Metadata
 * @typedef {import("./types/general.mjs").IndOptions} IndOptions
 * @typedef {import("./types/general.mjs").ExtractResult} ExtractResult
 * @typedef {import("./types/general.mjs").EnvelopeResult} EnvelopeResult
 * @typedef {import("./types/general.mjs").SchemaError} SchemaError
 **/

/**
 * DocumentMetadata representing inline or sidecar document metadata
 */
export class DocumentMetadata {
    /**
     * @param {Record<string, string|string[]>} data
     * @param {string | null} [sourcePath]
     */
    constructor(data, sourcePath = null) {
        /** @type {Record<string, string|string[]>} */
        this.data = data;
        /** @type {string | null} */
        this.sourcePath = sourcePath;
    }

    // =========================================================================
    // Static Factory Methods
    // =========================================================================

    /**
     * Load sidecar metadata file
     * @param {string} absPath
     * @returns {DocumentMetadata}
     */
    static load(absPath) {
        const src = readFileSync(absPath, "utf8");
        return DocumentMetadata.parseSidecar(src, absPath);
    }

    /**
     * Load sidecar metadata file if it exists
     * @param {string} absPath
     * @returns {DocumentMetadata | null}
     */
    static loadIfExists(absPath) {
        if (!existsSync(absPath)) {
            return null;
        }
        return DocumentMetadata.load(absPath);
    }

    /**
     * Load sidecar metadata for a document
     * @param {string} documentPath - Path to the document
     * @returns {DocumentMetadata | null}
     */
    static loadSidecar(documentPath) {
        const sidecarPath = documentPath + ".metadata";
        return DocumentMetadata.loadIfExists(sidecarPath);
    }

    /**
     * Parse KEY: VALUE block
     * @param {string} block
     * @param {string | null} [sourcePath]
     * @returns {DocumentMetadata}
     */
    static parse(block, sourcePath = null) {
        const data = DocumentMetadata._parseKeyValueLines(trimBom(block));
        return new DocumentMetadata(data, sourcePath);
    }

    /**
     * Parse sidecar metadata text (handles optional markers)
     * @param {string} text
     * @param {string | null} [sourcePath]
     * @returns {DocumentMetadata}
     */
    static parseSidecar(text, sourcePath = null) {
        const t = normalizeEol(text);
        const b = t.indexOf(DOCUMENT_METADATA_BEGIN);
        if (b !== -1) {
            const e = t.indexOf(DOCUMENT_METADATA_END, b);
            if (e !== -1) {
                const inner = t
                    .slice(b + DOCUMENT_METADATA_BEGIN.length, e)
                    .trim();
                return DocumentMetadata.parse(inner, sourcePath);
            }
        }
        return DocumentMetadata.parse(t, sourcePath);
    }

    /**
     * Extract trailing metadata from document text
     * @param {string} text
     * @returns {ExtractResult}
     */
    static extractTrailing(text) {
        const src = trimBom(text);
        const begin = src.lastIndexOf(DOCUMENT_METADATA_BEGIN);
        if (begin === -1) {
            return { body: src, metadata: null, raw_block: null };
        }
        const end = src.indexOf(DOCUMENT_METADATA_END, begin);
        if (end === -1) {
            return { body: src, metadata: null, raw_block: null };
        }
        const afterEnd = end + DOCUMENT_METADATA_END.length;
        const block = src
            .slice(begin + DOCUMENT_METADATA_BEGIN.length, end)
            .trim();
        const meta = DocumentMetadata.parse(block);
        const body = src.slice(0, begin).replace(/\s+$/g, "") + "\n";
        const raw_block = src.slice(begin, afterEnd);
        return { body, metadata: meta, raw_block };
    }

    /**
     * Extract markdown envelope (header, body, optional footer)
     * Per SPEC.md §5.5
     * @param {string} markdown
     * @returns {EnvelopeResult}
     */
    static extractEnvelope(markdown) {
        const lines = normalizeEol(markdown).split("\n");
        let headerEndIdx = -1;
        let footerStartIdx = -1;
        let metadataStartIdx = -1;

        // Find first delimiter (end of header)
        for (let i = 0, len = lines.length; i < len; i++) {
            if (lines[i].trim() === "---") {
                headerEndIdx = i;
                break;
            }
        }

        // Find metadata block start
        for (let i = 0, len = lines.length; i < len; i++) {
            if (lines[i].indexOf(DOCUMENT_METADATA_BEGIN) !== -1) {
                metadataStartIdx = i;
                break;
            }
        }

        // Find second delimiter (start of footer) - search backwards from end/metadata
        const searchEnd =
            metadataStartIdx !== -1 ? metadataStartIdx : lines.length;
        for (let i = searchEnd - 1; i > headerEndIdx; i--) {
            if (lines[i].trim() === "---") {
                footerStartIdx = i;
                break;
            }
        }

        // Build result
        const headerEnd = headerEndIdx !== -1 ? headerEndIdx : 0;
        const header = lines.slice(0, headerEnd + 1).join("\n");

        let bodyEnd = lines.length;
        if (metadataStartIdx !== -1) {
            bodyEnd = metadataStartIdx;
        }
        if (footerStartIdx !== -1 && footerStartIdx < bodyEnd) {
            bodyEnd = footerStartIdx;
        }

        const bodyStart = headerEndIdx !== -1 ? headerEndIdx + 1 : 0;
        const body = lines.slice(bodyStart, bodyEnd).join("\n").trim();

        let footer = null;
        if (footerStartIdx !== -1 && footerStartIdx > headerEndIdx) {
            const footerEnd =
                metadataStartIdx !== -1 ? metadataStartIdx : lines.length;
            footer = lines.slice(footerStartIdx, footerEnd).join("\n").trim();
        }

        return { header, body, footer };
    }

    /**
     * Extract metadata from markdown (YAML frontmatter or metadata block)
     * @param {string} markdown
     * @returns {DocumentMetadata}
     */
    static extractFromMarkdown(markdown) {
        /** @type {Record<string, string>} */
        const meta = {};

        // Try YAML frontmatter first
        const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
            const lines = frontmatterMatch[1].split("\n");
            for (let i = 0, len = lines.length; i < len; i++) {
                const line = lines[i].trim();
                const colonIdx = line.indexOf(":");
                if (colonIdx > 0) {
                    const key = line.slice(0, colonIdx).trim();
                    let value = line.slice(colonIdx + 1).trim();
                    if (
                        (value.startsWith('"') && value.endsWith('"')) ||
                        (value.startsWith("'") && value.endsWith("'"))
                    ) {
                        value = value.slice(1, -1);
                    }
                    if (key.length > 0 && value.length > 0) {
                        meta[key] = value;
                    }
                }
            }
            return new DocumentMetadata(meta);
        }

        // Try document metadata block
        const beginIdx = markdown.indexOf(DOCUMENT_METADATA_BEGIN);
        if (beginIdx === -1) {
            return new DocumentMetadata(meta);
        }

        const endIdx = markdown.indexOf(DOCUMENT_METADATA_END, beginIdx);
        if (endIdx === -1) {
            return new DocumentMetadata(meta);
        }

        const block = markdown.slice(
            beginIdx + DOCUMENT_METADATA_BEGIN.length,
            endIdx
        );
        const lines = block.split("\n");

        for (let i = 0, len = lines.length; i < len; i++) {
            const line = lines[i].trim();
            const colonIdx = line.indexOf(":");
            if (colonIdx > 0) {
                const key = line.slice(0, colonIdx).trim();
                const value = line.slice(colonIdx + 1).trim();
                if (key.length > 0 && value.length > 0) {
                    meta[key] = value;
                }
            }
        }

        return new DocumentMetadata(meta);
    }

    /**
     * Create empty document metadata
     * @returns {DocumentMetadata}
     */
    static empty() {
        return new DocumentMetadata({}, null);
    }

    // =========================================================================
    // Basic Accessors
    // =========================================================================

    /**
     * Get value by key
     * @param {string} key
     * @returns {string|string[]|undefined}
     */
    get(key) {
        return this.data[key];
    }

    /**
     * Get value as string (first value if array)
     * @param {string} key
     * @returns {string|undefined}
     */
    getString(key) {
        const v = this.data[key];
        if (typeof v === "string") {
            return v;
        }
        if (Array.isArray(v) && v.length > 0) {
            return v[0];
        }
        return undefined;
    }

    /**
     * Get value as array
     * @param {string} key
     * @returns {string[]}
     */
    getArray(key) {
        const v = this.data[key];
        if (typeof v === "string") {
            return [v];
        }
        if (Array.isArray(v)) {
            return v;
        }
        return [];
    }

    /**
     * Check if key exists
     * @param {string} key
     * @returns {boolean}
     */
    has(key) {
        return Object.prototype.hasOwnProperty.call(this.data, key);
    }

    /**
     * Get all keys
     * @returns {string[]}
     */
    keys() {
        return Object.keys(this.data);
    }

    /**
     * Check if metadata is empty
     * @returns {boolean}
     */
    isEmpty() {
        return Object.keys(this.data).length === 0;
    }

    // =========================================================================
    // Common Field Accessors
    // =========================================================================

    /**
     * Get Record-ID field
     * @returns {string|undefined}
     */
    getRecordId() {
        return (
            this.getString("Record-ID") ||
            this.getString("record_id") ||
            this.getString("RecordID")
        );
    }

    /**
     * Get Document-Type field
     * @returns {string|undefined}
     */
    getDocumentType() {
        return (
            this.getString("Document-Type") ||
            this.getString("doc_type") ||
            this.getString("DocType") ||
            this.getString("Type")
        );
    }

    /**
     * Get Version field
     * @returns {string|undefined}
     */
    getVersion() {
        return this.getString("Version") || this.getString("version");
    }

    /**
     * Get Effective-Date field
     * @returns {string|undefined}
     */
    getEffectiveDate() {
        return (
            this.getString("Effective-Date") || this.getString("effective_date")
        );
    }

    /**
     * Get Adopted-Date field
     * @returns {string|undefined}
     */
    getAdoptedDate() {
        return this.getString("Adopted-Date") || this.getString("adopted_date");
    }

    /**
     * Get Jurisdiction field
     * @returns {string|undefined}
     */
    getJurisdiction() {
        return this.getString("Jurisdiction") || this.getString("jurisdiction");
    }

    /**
     * Get Document-Index field
     * @returns {number|undefined}
     */
    getDocumentIndex() {
        const s =
            this.getString("Document-Index") || this.getString("doc_index");
        if (s) {
            const n = parseInt(s, 10);
            if (Number.isFinite(n)) {
                return n;
            }
        }
        return undefined;
    }

    /**
     * Get SPDX-LicenseIdentifier field
     * @returns {string|undefined}
     */
    getSpdxLicenseIdentifier() {
        return this.getString("SPDX-LicenseIdentifier");
    }

    /**
     * Get Title field
     * @returns {string|undefined}
     */
    getTitle() {
        return this.getString("Title") || this.getString("title");
    }

    /**
     * Get Canonical-URL field
     * @returns {string|undefined}
     */
    getCanonicalUrl() {
        return (
            this.getString("Canonical-URL") || this.getString("canonical_url")
        );
    }

    /**
     * Get Hash-SHA256-HEX field
     * @returns {string|undefined}
     */
    getHashSha256Hex() {
        return (
            this.getString("Hash-SHA256-HEX") ||
            this.getString("hash_sha256_hex")
        );
    }

    /**
     * Get Hash-SHA256-Base58 field
     * @returns {string|undefined}
     */
    getHashSha256Base58() {
        return (
            this.getString("Hash-SHA256-Base58") ||
            this.getString("hash_sha256_base58")
        );
    }

    /**
     * Get Content-Type field
     * @returns {string|undefined}
     */
    getContentType() {
        return this.getString("Content-Type") || this.getString("content_type");
    }

    /**
     * Get Content-Length field
     * @returns {number|undefined}
     */
    getContentLength() {
        const s =
            this.getString("Content-Length") ||
            this.getString("content_length");
        if (s) {
            const n = parseInt(s, 10);
            if (Number.isFinite(n) && n >= 0) {
                return n;
            }
        }
        return undefined;
    }

    // =========================================================================
    // IND Options Extraction
    // =========================================================================

    /**
     * Extract IND options from this metadata
     * @param {string} [record_id_override]
     * @returns {IndOptions | null}
     */
    toIndOptions(record_id_override) {
        const rid = record_id_override || this.getRecordId();
        if (!rid) {
            return null;
        }

        const doc_type_code = this.getDocumentType();
        if (!doc_type_code) {
            return null;
        }

        return {
            record_id: rid,
            doc_type_code,
            version: this.getVersion(),
            effective_date: this.getEffectiveDate(),
            jurisdiction: this.getJurisdiction(),
            doc_index: this.getDocumentIndex()
        };
    }

    // =========================================================================
    // Validation
    // =========================================================================

    /**
     * Validate against schema
     * @param {Schema} schema
     * @returns {SchemaError[]}
     */
    validate(schema) {
        return schema.validate(this.data);
    }

    /**
     * Check if valid against schema
     * @param {Schema} schema
     * @returns {boolean}
     */
    isValid(schema) {
        return this.validate(schema).length === 0;
    }

    // =========================================================================
    // Serialization
    // =========================================================================

    /**
     * Serialize to KEY: VALUE block
     * @returns {string}
     */
    serialize() {
        const keys = Object.keys(this.data).sort();
        /** @type {string[]} */
        const out = [];
        for (let i = 0, len = keys.length; i < len; i++) {
            const key = keys[i];
            const v = this.data[key];
            if (typeof v === "string") {
                out.push(`${key}: ${v}`);
            } else if (Array.isArray(v)) {
                for (let j = 0, jLen = v.length; j < jLen; j++) {
                    out.push(`${key}: ${v[j]}`);
                }
            }
        }
        return out.join("\n") + "\n";
    }

    /**
     * Serialize with PEM-style markers
     * @returns {string}
     */
    serializeWithMarkers() {
        return `${DOCUMENT_METADATA_BEGIN}\n${this.serialize()}${DOCUMENT_METADATA_END}\n`;
    }

    /**
     * Save as sidecar file
     * @param {string} documentPath
     */
    saveSidecar(documentPath) {
        const sidecarPath = documentPath + ".metadata";
        writeFileSync(sidecarPath, this.serializeWithMarkers(), "utf8");
        this.sourcePath = sidecarPath;
    }

    // =========================================================================
    // Static Constants
    // =========================================================================

    /**
     * Get begin marker
     * @returns {string}
     */
    static get BEGIN_MARKER() {
        return DOCUMENT_METADATA_BEGIN;
    }

    /**
     * Get end marker
     * @returns {string}
     */
    static get END_MARKER() {
        return DOCUMENT_METADATA_END;
    }

    // =========================================================================
    // Private Static Helpers
    // =========================================================================

    /**
     * Parse KEY: VALUE lines
     * @param {string} block
     * @returns {Record<string, string|string[]>}
     * @private
     */
    static _parseKeyValueLines(block) {
        const lines = block.split("\n");
        /** @type {Record<string, string|string[]>} */
        const out = {};
        for (let i = 0, len = lines.length; i < len; i++) {
            const line = lines[i].trim();
            if (line.length === 0) {
                continue;
            }
            const idx = line.indexOf(":");
            if (idx <= 0) {
                continue;
            }
            const key = line.slice(0, idx).trim();
            const value = line.slice(idx + 1).trim();
            if (key.length === 0 || value.length === 0) {
                continue;
            }
            const cur = out[key];
            if (typeof cur === "undefined") {
                out[key] = value;
                continue;
            }
            if (typeof cur === "string") {
                out[key] = [cur, value];
                continue;
            }
            cur.push(value);
        }
        return out;
    }
}
