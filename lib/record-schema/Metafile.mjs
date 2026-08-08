/**
 * Metafile class for _META.yaml documents
 * @module classes/Metafile
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { parseYaml, writeYaml } from "../parsing/yaml.mjs";
import { Schema } from "./Schema.mjs";
import { Registry } from "./Registry.mjs";
import { isObject, hasPropertyOfType } from "../util/objects.mjs";
import { isString, isArray, arrayOr } from "../util/general.mjs";

/** @typedef {import("./types/general.mjs").Metadata} Metadata */
/** @typedef {import("./types/general.mjs").StatusInfo} StatusInfo */
/** @typedef {import("./types/general.mjs").CommitmentEntry} CommitmentEntry */
/** @typedef {import("./types/general.mjs").DocumentRef} DocumentRef */
/** @typedef {import("./types/general.mjs").AssemblyPackEntry} AssemblyPackEntry */
/** @typedef {import("./types/general.mjs").AssemblyPacketInfo} AssemblyPacketInfo */
/** @typedef {import("./types/general.mjs").AssemblyInfo} AssemblyInfo */
/** @typedef {import("./types/general.mjs").DocumentsInfo} DocumentsInfo */
/** @typedef {import("./types/general.mjs").FormattingInfo} FormattingInfo */
/** @typedef {import("./types/general.mjs").ExtensionsInfo} ExtensionsInfo */
/** @typedef {import("./types/general.mjs").EntityInfo} EntityInfo */
/** @typedef {import("./types/general.mjs").DocumentFieldInfo} DocumentFieldInfo */
/** @typedef {import("./types/general.mjs").Timeline} Timeline */
/** @typedef {import("./types/general.mjs").MetafileData} MetafileData */
/** @typedef {import("./types/general.mjs").ValidationIssue} ValidationIssue */
/** @typedef {import("./types/general.mjs").BucketConstraints} BucketConstraints */

/**
 * Metafile representing a record's _META.yaml
 */
export class Metafile {
    /**
     * @param {MetafileData} data
     * @param {string | null} [source_path]
     */
    constructor(data, source_path = null) {
        /** @type {MetafileData} */
        this.data = data;

        /** @type {string | null} */
        this.source_path = source_path;
    }

    // =========================================================================
    // Static Factory Methods
    // =========================================================================

    /**
     * Load metafile from YAML file
     * @param {string} abs_path
     * @returns {Metafile}
     */
    static load(abs_path) {
        return new Metafile(
            /** @type {MetafileData} */ (
                parseYaml(readFileSync(abs_path, "utf8"), {
                    filename: abs_path
                })
            ),
            abs_path
        );
    }

    /**
     * Load metafile from YAML file if it exists
     * @param {string} abs_path
     * @returns {Metafile | null}
     */
    static loadIfExists(abs_path) {
        if (!existsSync(abs_path)) {
            return null;
        }
        return Metafile.load(abs_path);
    }

    /**
     * Load metafile from record directory
     * @param {string} record_dir
     * @param {string} record_id
     * @returns {Metafile | null}
     */
    static loadFromRecord(record_dir, record_id) {
        const meta_path = resolve(record_dir, `${record_id}_META.yaml`);
        return Metafile.loadIfExists(meta_path);
    }

    /**
     * Find and load metafile from record directory (auto-detect filename)
     * @param {string} record_dir
     * @returns {Metafile | null}
     */
    static findInDirectory(record_dir) {
        const dir_name = basename(record_dir);
        const record_id = Metafile.dirNameToRecordId(dir_name);
        if (!record_id) {
            return null;
        }
        return Metafile.loadFromRecord(record_dir, record_id);
    }

    /**
     * Parse metafile from YAML string
     * @param {string} src
     * @param {string | null} [source_path]
     * @returns {Metafile}
     */
    static parse(src, source_path = null) {
        const data = /** @type {MetafileData} */ (
            parseYaml(src, { filename: source_path || undefined })
        );

        return new Metafile(data, source_path);
    }

    /**
     * Create empty metafile
     * @returns {Metafile}
     */
    static empty() {
        return new Metafile({}, null);
    }

    /**
     * Extract record ID from directory name
     * @param {string} dir_name
     * @returns {string | null}
     */
    static dirNameToRecordId(dir_name) {
        const match = dir_name.match(/^([A-Z]{2,5}-\d{5})/);
        return match ? match[1] : null;
    }

    // =========================================================================
    // Basic Accessors
    // =========================================================================

    /**
     * Get record ID
     * @returns {string|undefined}
     */
    getId() {
        return this.data.id;
    }

    /**
     * Get series code
     * @returns {string|undefined}
     */
    getSeriesCode() {
        return this.data.series_code;
    }

    /**
     * Get series number
     * @returns {string|undefined}
     */
    getSeriesNumber() {
        return this.data.series;
    }

    /**
     * Get status info
     * @returns {StatusInfo|undefined}
     */
    getStatus() {
        return this.data.status;
    }

    /**
     * Get status phase
     * @returns {string|undefined}
     */
    getPhase() {
        return this.data.status?.phase;
    }

    /**
     * Get confidentiality level
     * @returns {string|undefined}
     */
    getConfidentiality() {
        return this.data.status?.confidentiality;
    }

    /**
     * Get commitments
     * @returns {CommitmentEntry[]}
     */
    getCommitments() {
        return arrayOr(this.data.commitments);
    }

    /**
     * Get documents info
     * @returns {DocumentsInfo|undefined}
     */
    getDocuments() {
        return this.data.documents;
    }

    /**
     * Get title
     * @returns {string|undefined}
     */
    getTitle() {
        return this.data.title;
    }

    /**
     * Get root-level version
     * @returns {string|undefined}
     */
    getVersion() {
        return this.data.version;
    }

    /**
     * Get root-level entity_name
     * @returns {string|undefined}
     */
    getEntityName() {
        return this.data.entity_name;
    }

    /**
     * Get entity info block
     * @returns {EntityInfo|undefined}
     */
    getEntity() {
        return this.data.entity;
    }

    /**
     * Get document field info block
     * @returns {DocumentFieldInfo|undefined}
     */
    getDocumentFieldInfo() {
        return this.data.document;
    }

    /**
     * Get timeline info
     * @returns {Timeline|undefined}
     */
    getTimeline() {
        return this.data.timeline;
    }

    // =========================================================================
    // Title Resolution
    // =========================================================================

    /**
     * Resolve the document title with fallback chain:
     *   data.title → data.document.title →
     *   data.assembly.packet.title → pkt_cfg.default_document_title →
     *   "FILING PACKET"
     *
     * @param {{ default_document_title?: string }} [pkt_cfg]
     * @returns {string}
     */
    determineDocumentTitle(pkt_cfg) {
        if (isString(this.data.title) && this.data.title.trim().length > 0) {
            return this.data.title.trim();
        }
        const doc = this.data.document;
        if (
            isObject(doc) &&
            isString(doc.title) &&
            doc.title.trim().length > 0
        ) {
            return doc.title.trim();
        }
        const pkt = this.data.assembly?.packet;
        if (
            isObject(pkt) &&
            isString(pkt.label) &&
            pkt.label.trim().length > 0
        ) {
            return pkt.label.trim();
        }
        return pkt_cfg && isString(pkt_cfg.default_document_title)
            ? pkt_cfg.default_document_title
            : "FILING PACKET";
    }

    /**
     * Get primary document path (first entry in documents.primary array)
     * @returns {string | null}
     */
    getPrimaryDocumentPath() {
        const arr = this.data.documents?.primary;
        if (isArray(arr) && arr.length > 0) {
            const first = arr[0];
            if (isString(first)) {
                return first;
            }
            if (isObject(first) && isString(first.path)) {
                return first.path;
            }
        }
        // Legacy: single string or object
        const p =
            /** @type {Record<string, unknown> | string | null | undefined} */ (
                arr
            );
        if (isString(p)) {
            return p;
        }
        if (isObject(p) && !isArray(p) && isString(p.path)) {
            return p.path;
        }
        return null;
    }

    /**
     * Get all primary document paths
     * @returns {string[]}
     */
    getPrimaryDocumentPaths() {
        const arr = this.data.documents?.primary;
        if (!isArray(arr)) {
            const single = this.getPrimaryDocumentPath();
            return single ? [single] : [];
        }
        /** @type {string[]} */
        const paths = [];
        for (let i = 0, len = arr.length; i < len; i++) {
            const ref = arr[i];
            const p = isString(ref) ? ref : ref?.path;
            if (isString(p) && p.length > 0) {
                paths.push(p);
            }
        }
        return paths;
    }

    /**
     * Get document refs for a given tier
     * @param {"primary"|"secondary"|"tertiary"|"supplemental"} tier
     * @returns {DocumentRef[]}
     */
    getDocumentsByTier(tier) {
        return arrayOr(this.data.documents?.[tier]);
    }

    /**
     * Get all document paths across all tiers (ordered: primary → supplemental)
     * @returns {string[]}
     */
    getAllDocumentPaths() {
        /** @type {string[]} */
        const paths = [];
        const tiers = /** @type {const} */ ([
            "primary",
            "secondary",
            "tertiary",
            "supplemental"
        ]);
        for (let t = 0; t < tiers.length; t++) {
            const refs = this.getDocumentsByTier(tiers[t]);
            for (let i = 0, len = refs.length; i < len; i++) {
                if (isString(refs[i]?.path)) {
                    paths.push(refs[i].path);
                }
            }
        }
        return paths;
    }

    /**
     * Get log document path
     * @returns {string | null}
     */
    getLogDocumentPath() {
        const l = this.data.documents?.log;
        if (isObject(l) && isString(l.path)) {
            return l.path;
        }
        // Legacy: plain string
        if (isString(l)) {
            return l;
        }
        return null;
    }

    /**
     * Get index document path
     * @returns {string | null}
     */
    getIndexDocumentPath() {
        const idx = this.data.documents?.index;
        if (isObject(idx) && isString(idx.path)) {
            return idx.path;
        }
        if (isString(idx)) {
            return idx;
        }
        return null;
    }

    /**
     * Get extensions info
     * @returns {ExtensionsInfo|undefined}
     */
    getExtensions() {
        return this.data.extensions;
    }

    /**
     * Get rendering info
     * @returns {Metadata|undefined}
     */
    getRenderingInfo() {
        return this.data.extensions?.rendering;
    }

    /**
     * Get render family
     * @returns {string|undefined}
     */
    getRenderFamily() {
        return this.data.extensions?.rendering?.family;
    }

    /**
     * Get explicit render pack IDs
     * @returns {string[]}
     */
    getRenderPackIds() {
        const rendering = this.data.extensions?.rendering;
        /** @type {string[]} */
        const out = [];
        if (isString(rendering?.pack_id)) {
            out.push(rendering.pack_id);
        }
        const pack_ids = arrayOr(rendering?.pack_ids);
        for (let i = 0, len = pack_ids.length; i < len; i++) {
            if (isString(pack_ids[i])) {
                out.push(pack_ids[i]);
            }
        }
        return out;
    }

    /**
     * Get explicit render pack paths
     * @returns {string[]}
     */
    getRenderPackPaths() {
        const rendering = this.data.extensions?.rendering;
        /** @type {string[]} */
        const out = [];
        if (isString(rendering?.pack_path)) {
            out.push(rendering.pack_path);
        }
        const pack_paths = arrayOr(rendering?.pack_paths);
        for (let i = 0, len = pack_paths.length; i < len; i++) {
            if (isString(pack_paths[i])) {
                out.push(pack_paths[i]);
            }
        }
        return out;
    }

    /**
     * Get default render profile
     * @returns {string|undefined}
     */
    getDefaultRenderProfile() {
        return this.data.extensions?.rendering?.default_profile;
    }

    /**
     * Get formatting profile
     * @returns {string|undefined}
     */
    getFormattingProfile() {
        return this.data.extensions?.formatting?.profile;
    }

    // =========================================================================
    // Schema Validation
    // =========================================================================

    /**
     * Validate against schema
     * @param {Schema} schema
     * @returns {import("./Schema.mjs").SchemaError[]}
     */
    validateSchema(schema) {
        return schema.validate(this.data);
    }

    /**
     * Check if valid against schema
     * @param {Schema} schema
     * @returns {boolean}
     */
    isValidSchema(schema) {
        return this.validateSchema(schema).length === 0;
    }

    // =========================================================================
    // Semantic Validation
    // =========================================================================

    /**
     * Validate metafile semantics
     * @param {string} record_id - Expected record ID
     * @param {string} record_dir_name - Directory name for error reporting
     * @param {BucketConstraints | null} constraints
     * @param {Registry | null} registry
     * @returns {ValidationIssue[]}
     */
    validate(record_id, record_dir_name, constraints, registry) {
        /** @type {ValidationIssue[]} */
        const issues = [];

        if (!isObject(this.data)) {
            issues.push({
                severity: "error",
                code: "meta.invalid",
                message: "META is not an object.",
                file: record_dir_name
            });
            return issues;
        }

        // ID mismatch
        const id = this.data.id;
        if (isString(id) && id !== record_id) {
            issues.push({
                severity: "error",
                code: "meta.id.mismatch",
                message: `META.id (${id}) != record_id (${record_id})`,
                file: record_dir_name
            });
        }

        // Series code mismatch
        const code = this.data.series_code;
        if (isString(code) && !record_id.startsWith(code + "-")) {
            issues.push({
                severity: "error",
                code: "meta.series_code.mismatch",
                message: `META.series_code (${code}) does not match directory (${record_dir_name})`,
                file: record_dir_name
            });
        }

        // Series number mismatch
        const num = this.data.series;
        if (isString(num)) {
            const expected = record_id.split("-")[1];
            if (num !== expected) {
                issues.push({
                    severity: "error",
                    code: "meta.series.mismatch",
                    message: `META.series (${num}) != (${expected})`,
                    file: record_dir_name
                });
            }
        }

        // Registry validation
        if (registry && isString(code) && code.length > 0) {
            if (!registry.hasSeries(code)) {
                issues.push({
                    severity: "warn",
                    code: "registry.unknown.series",
                    message: `Unknown series_code: ${code}`,
                    file: record_dir_name
                });
            }
        }

        // Constraint validation
        if (isObject(constraints)) {
            this._validateConstraints(constraints, record_dir_name, issues);
        }

        return issues;
    }

    /**
     * Validate against bucket constraints
     * @param {BucketConstraints} constraints
     * @param {string} record_dir_name
     * @param {ValidationIssue[]} issues
     * @private
     */
    _validateConstraints(constraints, record_dir_name, issues) {
        const status = this.data.status;

        // Status phase constraint
        if (
            isArray(constraints.status_phase_allow) &&
            status &&
            isString(status.phase)
        ) {
            let ok = false;
            for (
                let i = 0, len = constraints.status_phase_allow.length;
                i < len;
                i++
            ) {
                if (constraints.status_phase_allow[i] === status.phase) {
                    ok = true;
                    break;
                }
            }
            if (!ok) {
                issues.push({
                    severity: "error",
                    code: "status.phase.disallowed",
                    message: `Status.phase not allowed in bucket: ${status.phase}`,
                    file: record_dir_name
                });
            }
        }

        // Status confidentiality constraint
        if (
            isArray(constraints.status_confidentiality_allow) &&
            status &&
            isString(status.confidentiality)
        ) {
            let ok = false;
            for (
                let i = 0,
                    len = constraints.status_confidentiality_allow.length;
                i < len;
                i++
            ) {
                if (
                    constraints.status_confidentiality_allow[i] ===
                    status.confidentiality
                ) {
                    ok = true;
                    break;
                }
            }
            if (!ok) {
                issues.push({
                    severity: "error",
                    code: "status.confidentiality.disallowed",
                    message: `Status.confidentiality not allowed in bucket: ${status.confidentiality}`,
                    file: record_dir_name
                });
            }
        }

        // Commitments constraints
        this._validateCommitmentConstraints(
            constraints,
            record_dir_name,
            issues
        );

        // Document reference constraints.
        //
        // Declaring a document and shipping it are different claims. A META can
        // list documents.primary entries that are not on disk, and until this
        // also resolved them, a record whose primary document had been deleted
        // validated clean - the inventory said it was there and nothing looked.
        const record_dir = this.source_path ? dirname(this.source_path) : null;

        if (constraints.require_documents_primary_ref === true) {
            const paths = this.getPrimaryDocumentPaths();
            if (paths.length === 0) {
                issues.push({
                    severity: "error",
                    code: "documents.primary.required",
                    message:
                        "Bucket requires documents.primary but none defined.",
                    file: record_dir_name
                });
            }
            if (record_dir) {
                for (let i = 0, len = paths.length; i < len; i++) {
                    if (existsSync(resolve(record_dir, paths[i]))) {
                        continue;
                    }
                    issues.push({
                        severity: "error",
                        code: "documents.primary.dangling",
                        message: `documents.primary lists '${paths[i]}', which is not on disk.`,
                        file: record_dir_name
                    });
                }
            }
        }

        // require_primary_document asks a weaker but different question: not
        // whether every declared path resolves, but whether the record ships any
        // primary document at all.
        if (constraints.require_primary_document === true && record_dir) {
            if (!this.primaryDocumentExists(record_dir)) {
                issues.push({
                    severity: "error",
                    code: "documents.primary.missing",
                    message:
                        "Bucket requires a primary document but none is present on disk.",
                    file: record_dir_name
                });
            }
        }

        if (constraints.require_documents_log_ref === true) {
            const log_path = this.getLogDocumentPath();
            if (!log_path) {
                issues.push({
                    severity: "error",
                    code: "documents.log.required",
                    message: "Bucket requires documents.log but none defined.",
                    file: record_dir_name
                });
            } else if (record_dir && !this.logDocumentExists(record_dir)) {
                issues.push({
                    severity: "error",
                    code: "documents.log.dangling",
                    message: `documents.log points at '${log_path}', which is not on disk.`,
                    file: record_dir_name
                });
            }
        }

        if (constraints.require_formatting_profile === true) {
            const profile = this.getFormattingProfile();
            if (!profile) {
                issues.push({
                    severity: "warn",
                    code: "extensions.formatting.profile.missing",
                    message:
                        "Bucket recommends extensions.formatting.profile but none defined.",
                    file: record_dir_name
                });
            }
        }
    }

    /**
     * Validate commitment constraints
     * @param {BucketConstraints} constraints
     * @param {string} record_dir_name
     * @param {ValidationIssue[]} issues
     * @private
     */
    _validateCommitmentConstraints(constraints, record_dir_name, issues) {
        const commitments = this.data.commitments;

        if (constraints.require_commitments === true) {
            const arr = arrayOr(commitments);
            if (arr.length === 0) {
                issues.push({
                    severity: "error",
                    code: "commitments.required",
                    message:
                        "Bucket requires commitments but META.commitments is empty.",
                    file: record_dir_name
                });
            }
        }

        if (!isArray(commitments)) {
            return;
        }

        // Commitment kind validation
        if (isArray(constraints.require_commitment_kind_allow)) {
            for (let i = 0, len = commitments.length; i < len; i++) {
                const c = commitments[i];
                if (!isObject(c)) {
                    continue;
                }
                const kind = c.kind;
                if (!isString(kind)) {
                    continue;
                }
                let ok = false;
                for (
                    let j = 0,
                        j_len =
                            constraints.require_commitment_kind_allow.length;
                    j < j_len;
                    j++
                ) {
                    if (constraints.require_commitment_kind_allow[j] === kind) {
                        ok = true;
                        break;
                    }
                }
                if (!ok) {
                    issues.push({
                        severity: "error",
                        code: "commitment.kind.disallowed",
                        message: `Commitment kind not allowed: ${kind}`,
                        file: record_dir_name
                    });
                }
            }
        }

        // Hash or content_id requirement
        if (constraints.require_commitment_hash_or_content_id === true) {
            for (let i = 0, len = commitments.length; i < len; i++) {
                const c = commitments[i];
                if (!isObject(c)) {
                    continue;
                }
                const has_hash =
                    isString(c.hash_sha256_hex) ||
                    isString(c.hash_sha256_base58);
                const has_content = isString(c.content_id);
                if (!has_hash && !has_content) {
                    issues.push({
                        severity: "error",
                        code: "commitment.missing.anchor",
                        message: `Commitment missing hash or content_id (index ${i}).`,
                        file: record_dir_name
                    });
                }
            }
        }
    }

    // =========================================================================
    // Document Reference Validation
    // =========================================================================

    /**
     * Check if at least one primary document exists on disk
     * @param {string} record_dir
     * @returns {boolean}
     */
    primaryDocumentExists(record_dir) {
        const paths = this.getPrimaryDocumentPaths();
        for (let i = 0, len = paths.length; i < len; i++) {
            if (existsSync(resolve(record_dir, paths[i]))) {
                return true;
            }
        }
        return false;
    }

    /**
     * Check if log document exists
     * @param {string} record_dir
     * @returns {boolean}
     */
    logDocumentExists(record_dir) {
        const path = this.getLogDocumentPath();
        if (!path) {
            return false;
        }
        return existsSync(resolve(record_dir, path));
    }

    // =========================================================================
    // Write Operations
    // =========================================================================

    /**
     * Update packet information in assembly.packet
     * @param {string} relative_path
     * @param {string} hash - SHA-256 Hex
     */
    updatePacketInfo(relative_path, hash) {
        if (!this.data.assembly) {
            this.data.assembly = {};
        }

        const existingPacket = isObject(this.data.assembly.packet)
            ? /** @type {Record<string, unknown>} */ (this.data.assembly.packet)
            : {};

        const nextPath = relative_path;
        const nextHash = hash;
        const prevPath = isString(existingPacket.path)
            ? existingPacket.path
            : null;
        const prevHash = isString(existingPacket.hash_sha256_hex)
            ? existingPacket.hash_sha256_hex
            : null;

        if (prevPath === nextPath && prevHash === nextHash) {
            return;
        }

        this.data.assembly.packet = {
            ...existingPacket,
            path: nextPath,
            hash_sha256_hex: nextHash,
            generated_at: new Date().toISOString()
        };
    }

    /**
     * Get assembly pack entries
     * @returns {AssemblyPackEntry[]}
     */
    getAssemblyPack() {
        return arrayOr(this.data.assembly?.pack);
    }

    /**
     * Get assembly packet ref
     * @returns {DocumentRef|undefined}
     */
    getAssemblyPacket() {
        return this.data.assembly?.packet;
    }

    /**
     * Write changes back to disk
     */
    save() {
        if (!this.source_path) {
            throw new Error(
                "Cannot save: No source path defined for Metafile."
            );
        }

        writeYaml(this.source_path, this.data);
    }
}
