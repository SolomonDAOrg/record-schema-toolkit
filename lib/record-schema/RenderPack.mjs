/**
 * Pack class for render packs (render.pack.schema.json)
 * @module classes/RenderPack
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, basename, extname } from "node:path";
import {
    getEntryPath,
    getEntryPrecedence,
    rulesetMatchesFile,
    shouldIncludeEntry
} from "./PackUtils.mjs";
import {
    isObject,
    hasPropertyOfType,
    mergeObjects,
    deepMerge,
    resolveObject,
    layeredValue
} from "../util/objects.mjs";
import {
    DOC_TYPE_PATTERN,
    PACK_ID_PATTERN,
    RENDER_PACK_SCHEMA_NAME,
    RENDER_PACK_SCHEMA_VERSION
} from "./constants/constants.mjs";
import {
    arrayOr,
    boolOr,
    enumOr,
    numberOr,
    stringOr
} from "../util/general.mjs";
import { readJson } from "../util/files.mjs";

/** @typedef {import("../types/general.mjs").Metadata} Metadata */
/** @typedef {import("../util/objects.mjs").MergeFieldStrategy} MergeFieldStrategy */
/** @typedef {import("./types/general.mjs").PackEntry} PackEntry */
/** @typedef {import("./types/general.mjs").RawPackEntry} RawPackEntry */
/** @typedef {import("./types/general.mjs").RenderDefaults} RenderDefaults */
/** @typedef {import("./types/general.mjs").RenderTarget} RenderTarget */
/** @typedef {import("./types/general.mjs").RenderProfile} RenderProfile */
/** @typedef {import("./types/general.mjs").RulesetSelectors} RulesetSelectors */
/** @typedef {import("./types/general.mjs").RulesetRender} RulesetRender */
/** @typedef {import("./types/general.mjs").RenderRuleset} RenderRuleset */
/** @typedef {import("./types/general.mjs").RenderDocumentPolicy} RenderDocumentPolicy */
/** @typedef {import("./types/general.mjs").PageConfig} PageConfig */
/** @typedef {import("./types/general.mjs").DraftWatermarkConfig} DraftWatermarkConfig */
/** @typedef {import("./types/general.mjs").CoverRenderConfig} CoverRenderConfig */
/** @typedef {import("./types/general.mjs").CoverPageOptions} CoverPageOptions */
/** @typedef {import("./types/general.mjs").PacketEntityExtraction} PacketEntityExtraction */
/** @typedef {import("./types/general.mjs").SigningPageParty} SigningPageParty */
/** @typedef {import("./types/general.mjs").SigningPageConfig} SigningPageConfig */
/** @typedef {import("./types/general.mjs").PacketConfig} PacketConfig */
/** @typedef {import("./types/general.mjs").ResolvedPacketConfig} ResolvedPacketConfig */
/** @typedef {import("./types/general.mjs").ResolvedCoverConfig} ResolvedCoverConfig */
/** @typedef {import("./types/general.mjs").ResolvedWatermarkConfig} ResolvedWatermarkConfig */
/** @typedef {import("./types/general.mjs").ResolvedSigningConfig} ResolvedSigningConfig */
/** @typedef {import("./types/general.mjs").RenderPackData} RenderPackData */
/** @typedef {import("./types/general.mjs").ValidationError} ValidationError */
/** @typedef {import("./types/general.mjs").ValidationResult} ValidationResult */
/** @typedef {import("./types/general.mjs").FileDescriptor} FileDescriptor */
/** @typedef {import("./types/general.mjs").ChartTheme} ChartTheme */
/** @typedef {import("./types/general.mjs").ChartClass} ChartClass */
/** @typedef {import("./types/general.mjs").ChartEdgeClass} ChartEdgeClass */
/** @typedef {import("./types/general.mjs").ChartTarget} ChartTarget */

/** @type {MergeFieldStrategy} */
const POLICY_MERGE_STRATEGY = {
    arrayConcat: ["rulesets"],
    shallowMerge: [
        "targets",
        "render_profiles",
        "chart_themes",
        "chart_classes",
        "chart_edge_classes",
        "chart_targets",
        "defaults"
    ]
};

/** @type {MergeFieldStrategy} */
const RENDER_MERGE_STRATEGY = {
    shallowMerge: ["options"]
};

// =============================================================================
// RenderPack Class
// =============================================================================

/**
 * Render pack representing output transformation rules and rendering profiles
 */
export class RenderPack {
    /**
     * @param {RenderPackData} data
     * @param {string | null} [source_path]
     */
    constructor(data, source_path = null) {
        /** @type {RenderPackData} */
        this.data = data;

        /** @type {string | null} */
        this.source_path = source_path;
    }

    // =========================================================================
    // Static Factory Methods
    // =========================================================================

    /**
     * Load pack from JSON file
     * @param {string} abs_path
     * @returns {RenderPack}
     */
    static load(abs_path) {
        return new RenderPack(readJson(abs_path), abs_path);
    }

    /**
     * Load pack from JSON file if it exists
     * @param {string} abs_path
     * @returns {RenderPack|null}
     */
    static loadIfExists(abs_path) {
        if (!existsSync(abs_path)) {
            return null;
        }
        return RenderPack.load(abs_path);
    }

    /**
     * Load multiple packs with import resolution
     * @param {string} root_dir
     * @param {string[]} pack_paths
     * @returns {{ packs: RenderPack[], policy: RenderDocumentPolicy, packet_config: PacketConfig|undefined }}
     */
    static loadMerged(root_dir, pack_paths) {
        /** @type {Set<string>} */
        const seen = new Set();
        /** @type {string[]} */
        const ordered = [];

        /**
         * @param {string} rel_or_abs
         */
        function visit(rel_or_abs) {
            const abs = resolve(root_dir, rel_or_abs);
            if (seen.has(abs)) {
                return;
            }
            seen.add(abs);
            const pack = RenderPack.load(abs);
            const imps = pack.getImports();
            for (let i = 0, len = imps.length; i < len; i++) {
                visit(imps[i]);
            }
            ordered.push(abs);
        }

        for (let i = 0, len = pack_paths.length; i < len; i++) {
            visit(pack_paths[i]);
        }

        /** @type {RenderPack[]} */
        const packs = [];
        /** @type {RenderDocumentPolicy} */
        let merged = {};
        /** @type {PacketConfig|undefined} */
        let packet_config;

        for (let i = 0, len = ordered.length; i < len; i++) {
            const pack = RenderPack.load(ordered[i]);
            packs.push(pack);
            merged = RenderPack._mergePolicy(
                merged,
                pack.getDocumentPolicies()
            );
            const pc = pack.getPacketConfig();
            if (pc) {
                packet_config = deepMerge(packet_config, pc);
            }
        }

        return { packs, policy: merged, packet_config };
    }

    /**
     * Create empty pack
     * @param {string} pack_id
     * @returns {RenderPack}
     */
    static empty(pack_id) {
        return new RenderPack(
            {
                schema: RENDER_PACK_SCHEMA_NAME,
                schema_version: RENDER_PACK_SCHEMA_VERSION,
                pack_id,
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
     * @returns {string|undefined}
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

    /**
     * Get raw packet config (unresolved).
     * @returns {PacketConfig|null}
     */
    getPacketConfig() {
        const pc = this.data.packet_config;
        if (isObject(pc)) {
            return pc;
        }
        return null;
    }

    /**
     * Get fully-resolved packet config with defaults applied.
     * This is the canonical location for merging raw packet_config
     * with built-in defaults — no consumer should duplicate this.
     * @returns {ResolvedPacketConfig}
     */
    getResolvedPacketConfig() {
        const raw = this.getPacketConfig();

        /** @type {ResolvedPacketConfig} */
        const defaults = {
            default_entity_name: "DRAFT",
            default_document_title: "FILING PACKET",
            header_text: "",
            series_prefix: "^[A-Z]{2,5}-\\d+_",
            header_title_format: "plain",
            section_page_break: "always",
            path_to_title: {},
            name_patterns: [],
            entity_extraction: {
                fields: ["entity_name", "entity.name", "title"]
            },
            document_kind_default: "generic",
            document_kind_map: {},
            cover_templates: {},
            cover_config: RenderPack._defaultCoverConfig(),
            signing_page: null
        };

        if (!raw) {
            return defaults;
        }

        const cover_raw = resolveObject(raw.cover_config, raw.cover);

        const ee_raw = resolveObject(raw.entity_extraction);

        return {
            default_entity_name: stringOr(
                raw.default_entity_name,
                defaults.default_entity_name
            ),
            default_document_title: stringOr(
                raw.default_document_title,
                defaults.default_document_title
            ),
            header_text: stringOr(raw.header_text, defaults.header_text),
            series_prefix: stringOr(raw.series_prefix, defaults.series_prefix),
            header_title_format: /** @type {"plain" | "entity-suffix"} */ (
                enumOr(
                    raw.header_title_format,
                    ["plain", "entity-suffix"],
                    defaults.header_title_format
                )
            ),
            section_page_break:
                /** @type {"always" | "never" | "first-only"} */ (
                    enumOr(
                        raw.section_page_break,
                        ["always", "never", "first-only"],
                        defaults.section_page_break
                    )
                ),
            path_to_title:
                /** @type {Record<string, string>} */ (
                    resolveObject(raw.path_to_title)
                ) ?? defaults.path_to_title,
            name_patterns: Array.isArray(raw.name_patterns)
                ? raw.name_patterns
                : defaults.name_patterns,
            entity_extraction: ee_raw
                ? {
                      fields: Array.isArray(ee_raw.fields)
                          ? ee_raw.fields
                          : defaults.entity_extraction.fields,
                      title_pattern: stringOr(ee_raw.title_pattern, undefined)
                  }
                : defaults.entity_extraction,
            document_kind_default: stringOr(
                raw.document_kind_default,
                defaults.document_kind_default
            ),
            document_kind_map:
                /** @type {Record<string, string>} */ (
                    resolveObject(raw.document_kind_map)
                ) ?? defaults.document_kind_map,
            cover_templates:
                resolveObject(raw.cover_templates) ?? defaults.cover_templates,
            cover_config: RenderPack._resolveCoverConfigLayer(
                cover_raw,
                defaults.cover_config
            ),
            signing_page:
                /** @type {SigningPageConfig|null} */ (
                    resolveObject(raw.signing_page)
                ) ?? null
        };
    }

    /**
     * Resolve cover rendering config by merging layers (last wins per-field).
     *
     * Layer order (first = lowest priority):
     *   1. packet_config.cover_config (global defaults from pack)
     *   2. resolved render profile cover_config (per-document-type)
     *   3. meta.extensions.formatting.cover (per-record override — extracted here)
     *
     * @param {unknown} meta - Raw metafile data
     * @param {CoverRenderConfig|null|undefined} profile_cover - From adapter.resolveForFile().cover_config
     * @returns {ResolvedCoverConfig}
     */
    resolveCoverConfig(meta, profile_cover) {
        const pkt = this.getResolvedPacketConfig();
        const base = pkt.cover_config;
        const meta_cover = RenderPack._extractMetaCoverLayer(meta);

        /** @type {Array<CoverRenderConfig|null|undefined>} */
        const layers = [base, profile_cover, meta_cover];

        const suppress_header = layeredValue(
            layers,
            "suppress_header",
            "boolean",
            base.suppress_header
        );
        const suppress_footer = layeredValue(
            layers,
            "suppress_footer",
            "boolean",
            base.suppress_footer
        );
        const suppress_page_numbering = layeredValue(
            layers,
            "suppress_page_numbering",
            "boolean",
            base.suppress_page_numbering
        );
        const reserve_header_footer_space = layeredValue(
            layers,
            "reserve_header_footer_space",
            "boolean",
            base.reserve_header_footer_space
        );

        const cover_layout =
            layeredValue(layers, "cover_layout", "object") ??
            layeredValue(layers, "layout", "object") ??
            undefined;

        // Watermark: deep merge across layers
        const base_wm = base.draft_watermark || {};
        const profile_wm = resolveObject(profile_cover?.draft_watermark);
        const meta_wm =
            resolveObject(meta_cover?.watermark) ??
            resolveObject(meta_cover?.draft_watermark);

        /** @type {Array<Record<string, unknown>|null|undefined>} */
        const wm_layers = [base_wm, profile_wm, meta_wm];

        /** @type {ResolvedWatermarkConfig} */
        const watermark = {
            enabled: layeredValue(wm_layers, "enabled", "boolean", false),
            text: layeredValue(wm_layers, "text", "string", "DRAFT"),
            gray: layeredValue(wm_layers, "gray", "number", undefined),
            angle_deg: layeredValue(
                wm_layers,
                "angle_deg",
                "number",
                undefined
            ),
            font_size: layeredValue(wm_layers, "font_size", "number", undefined)
        };

        return {
            suppress_header,
            suppress_footer,
            suppress_page_numbering,
            reserve_header_footer_space,
            watermark,
            cover_layout
        };
    }

    /**
     * Resolve signing page config from pack + CLI overrides.
     * Enabled when CLI flag is set OR pack signing_page.enabled is true.
     *
     * @param {{ signing_page?: boolean, signing_page_config?: Metadata }} options
     * @returns {ResolvedSigningConfig|null}
     */
    resolveSigningConfig(options) {
        const pkt = this.getResolvedPacketConfig();
        const raw = pkt.signing_page;

        const has_pack =
            isObject(raw) &&
            Array.isArray(raw.parties) &&
            raw.parties.length > 0;

        const enabled_by_cli = options.signing_page === true;
        const enabled_by_pack = has_pack && raw.enabled !== false;

        if (options.signing_page === false) {
            return null;
        }
        if (!enabled_by_cli && !enabled_by_pack) {
            return null;
        }

        const overrides = resolveObject(options.signing_page_config);

        const raw_parties =
            overrides &&
            Array.isArray(overrides.parties) &&
            overrides.parties.length > 0
                ? overrides.parties
                : has_pack
                ? raw.parties
                : null;

        if (!raw_parties || raw_parties.length === 0) {
            return null;
        }

        return {
            enabled: true,
            witness_clause:
                stringOr(overrides?.witness_clause, undefined) ??
                (has_pack
                    ? stringOr(raw.witness_clause, undefined)
                    : undefined),
            execution_note:
                stringOr(overrides?.execution_note, undefined) ??
                (has_pack
                    ? stringOr(raw.execution_note, undefined)
                    : undefined),
            acknowledgment_title:
                stringOr(overrides?.acknowledgment_title, undefined) ??
                (has_pack
                    ? stringOr(raw.acknowledgment_title, undefined)
                    : undefined),
            acknowledgment_text:
                stringOr(overrides?.acknowledgment_text, undefined) ??
                (has_pack
                    ? stringOr(raw.acknowledgment_text, undefined)
                    : undefined),
            layout:
                /** @type {Record<string, number>|undefined} */ (
                    resolveObject(overrides?.layout)
                ) ??
                /** @type {Record<string, number>|undefined} */ (
                    has_pack ? resolveObject(raw.layout) : undefined
                ) ??
                undefined,
            parties: raw_parties
        };
    }

    // =========================================================================
    // Pack Entry Resolution
    // =========================================================================

    /**
     * Resolve and sort pack entries from metafile data.
     *
     * @param {Object} meta - Raw metafile data
     * @param {{ exclude_ind?: boolean }} [options]
     * @returns {PackEntry[] | { success: false, error: string }}
     */
    resolvePackEntries(meta, options) {
        const opts = options || {};

        if (meta.assembly?.pack && Array.isArray(meta.assembly.pack)) {
            return RenderPack._normalizePackArray(meta.assembly.pack, opts);
        }

        if (
            meta.documents &&
            "pack" in meta.documents &&
            meta.documents.pack &&
            Array.isArray(meta.documents.pack)
        ) {
            return RenderPack._normalizePackArray(meta.documents.pack, opts);
        }

        if (meta.documents?.primary) {
            return RenderPack._normalizePrimaryArray(meta.documents.primary);
        }

        return {
            success: false,
            error: "No documents defined in META (need assembly.pack or documents.primary)"
        };
    }

    /**
     * @param {unknown[]} raw_pack
     * @param {{ exclude_ind?: boolean }} options
     * @returns {PackEntry[]}
     * @private
     */
    static _normalizePackArray(raw_pack, options) {
        /** @type {PackEntry[]} */
        const entries = [];

        for (let i = 0, len = raw_pack.length; i < len; i++) {
            const raw = raw_pack[i];

            if (typeof raw === "string") {
                entries.push({
                    path: raw,
                    precedence: i * 10,
                    doc_type: null,
                    label: null
                });
                continue;
            }

            if (!isObject(raw)) {
                continue;
            }

            /** @type {RawPackEntry} */
            const entry = /** @type {RawPackEntry} */ (raw);

            if (entry.include === false) {
                continue;
            }
            if (options.exclude_ind && entry.doc_type === "IND") {
                continue;
            }

            const path = entry.path;
            if (typeof path !== "string" || path.length === 0) {
                continue;
            }

            entries.push({
                path,
                precedence: hasPropertyOfType(entry, "precedence", "number")
                    ? entry.precedence
                    : i * 10,
                doc_type: entry.doc_type ?? null,
                label: entry.label ?? null
            });
        }

        entries.sort((a, b) => a.precedence - b.precedence);
        return entries;
    }

    /**
     * @param {unknown} primary_raw
     * @returns {PackEntry[] | { success: false, error: string }}
     * @private
     */
    static _normalizePrimaryArray(primary_raw) {
        const primary_arr = Array.isArray(primary_raw)
            ? primary_raw
            : [primary_raw];

        /** @type {PackEntry[]} */
        const entries = [];
        for (let i = 0, len = primary_arr.length; i < len; i++) {
            const ref = primary_arr[i];
            const path = typeof ref === "string" ? ref : ref?.path;
            if (typeof path === "string" && path.length > 0) {
                entries.push({
                    path,
                    precedence: i * 10,
                    doc_type: null,
                    label: isObject(ref) ? ref.label ?? null : null
                });
            }
        }

        if (entries.length === 0) {
            return {
                success: false,
                error: `Primary documents have no resolvable paths: ${JSON.stringify(
                    primary_raw
                )}`
            };
        }

        return entries;
    }

    // =========================================================================
    // Entity & Document Kind Resolution
    // =========================================================================

    /**
     * Extract entity name from metafile using packet_config.entity_extraction.
     *
     * @param {Object} meta - Raw metafile data
     * @param {PackEntry[]} pack_entries - Resolved pack entries (fallback: derive from filenames)
     * @returns {string | null}
     */
    extractEntityName(meta, pack_entries) {
        const pkt = this.getResolvedPacketConfig();
        const ext = pkt.entity_extraction;

        // title_pattern first (regex capture group 1 on meta.title)
        if (ext.title_pattern && meta?.title) {
            try {
                const re = new RegExp(ext.title_pattern, "i");
                const match = meta.title.match(re);
                if (match) {
                    const named = match.groups?.entity;
                    if (typeof named === "string" && named.trim().length > 0) {
                        return named.trim();
                    }
                    for (let i = 1; i < match.length; i++) {
                        const v = match[i];
                        if (typeof v === "string" && v.trim().length > 0) {
                            return v.trim();
                        }
                    }
                }
            } catch {
                // invalid regex — skip
            }
        }

        // Walk declared fields
        for (let i = 0, len = ext.fields.length; i < len; i++) {
            const field = ext.fields[i];
            const parts = field.split(".");
            let cur = meta;
            for (let j = 0, j_len = parts.length; j < j_len; j++) {
                if (
                    cur === null ||
                    cur === undefined ||
                    typeof cur !== "object"
                ) {
                    cur = undefined;
                    break;
                }
                cur = cur[parts[j]];
            }
            if (typeof cur === "string" && cur.length > 0) {
                return cur;
            }
        }

        return this._deriveEntityNameFromPack(pack_entries);
    }

    /**
     * @param {PackEntry[]} pack_entries
     * @returns {string|null}
     * @private
     */
    _deriveEntityNameFromPack(pack_entries) {
        if (!Array.isArray(pack_entries) || pack_entries.length === 0) {
            return null;
        }

        const pkt = this.getResolvedPacketConfig();
        const series_re = new RegExp(pkt.series_prefix);
        const patterns = pkt.name_patterns
            .slice()
            .sort((a, b) => String(b).length - String(a).length);

        for (let i = 0, len = pack_entries.length; i < len; i++) {
            const p = pack_entries[i]?.path;
            if (typeof p !== "string") {
                continue;
            }

            const ext_raw = extname(p);
            const base = basename(p, ext_raw);
            let stem = base.replace(series_re, "");
            stem = stem.replace(/^[A-Z]{2,6}-/, "");

            for (let j = 0, j_len = patterns.length; j < j_len; j++) {
                const pat = String(patterns[j]);
                const tokens = pat
                    .split(/[_ .-]+/g)
                    .filter((t) => t.length > 0)
                    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
                if (tokens.length === 0) {
                    continue;
                }

                const pat_re = new RegExp(
                    `^(.+?)[_\\-.\\s]+${tokens.join(
                        "[_\\-.\\s]+"
                    )}(?:$|[_\\-.\\s])`,
                    "i"
                );
                const m = stem.match(pat_re);
                if (!m || !m[1]) {
                    continue;
                }

                const raw = m[1]
                    .replace(/[_\\-\\.]+/g, " ")
                    .replace(/\\s+/g, " ")
                    .trim();

                if (raw.length > 0) {
                    return raw;
                }
            }
        }

        return null;
    }

    /**
     * Resolve document kind from metafile + pack entries.
     * Uses extensions.formatting.document_kind, then document_kind_map, then heuristics.
     *
     * @param {Object} meta - Raw metafile data
     * @param {PackEntry[]} pack_entries - Resolved pack entries
     * @returns {string}
     */
    resolveDocumentKind(meta, pack_entries) {
        const pkt = this.getResolvedPacketConfig();

        // Direct from meta
        const direct = meta?.extensions?.formatting?.document_kind ?? null;
        if (direct) {
            return direct;
        }

        // Map from pack doc_type
        for (let i = 0, len = pack_entries.length; i < len; i++) {
            const dt = pack_entries[i]?.doc_type;
            if (dt) {
                const mapped = pkt.document_kind_map[dt];
                if (mapped) {
                    return mapped;
                }
            }
        }

        // Heuristics on title and primary path
        const title = (meta?.title ?? "").toLowerCase();
        const primary_path = RenderPack._extractPrimaryPath(meta);
        const path_lower = primary_path.toLowerCase();

        /** @type {Array<[string, (t: string, p: string) => boolean]>} */
        const heuristics = [
            [
                "master_agreement",
                (t, p) =>
                    t.includes("master agreement") ||
                    p.includes("master") ||
                    p.includes("mma")
            ],
            [
                "company_agreement",
                (t, p) =>
                    t.includes("company agreement") ||
                    t.includes("operating agreement") ||
                    p.includes("operating")
            ],
            [
                "license",
                (t, p) => t.includes("license") || p.includes("license")
            ],
            [
                "terms",
                (t, p) =>
                    t.includes("terms of use") ||
                    t.includes("terms of service") ||
                    p.includes("terms")
            ],
            [
                "privacy_policy",
                (t, p) => t.includes("privacy") || p.includes("privacy")
            ]
        ];

        for (let i = 0, len = heuristics.length; i < len; i++) {
            const [kind, test] = heuristics[i];
            if (test(title, path_lower)) {
                return kind;
            }
        }

        return pkt.document_kind_default;
    }

    /**
     * Extract the first primary document path from metafile data.
     * @param {Object} meta
     * @returns {string}
     * @private
     */
    static _extractPrimaryPath(meta) {
        const primary_arr = meta?.documents?.primary;
        if (Array.isArray(primary_arr) && primary_arr.length > 0) {
            const first = primary_arr[0];
            return typeof first === "string" ? first : first?.path ?? "";
        }
        if (primary_arr && !Array.isArray(primary_arr)) {
            return typeof primary_arr === "string"
                ? primary_arr
                : primary_arr?.path ?? "";
        }
        return "";
    }

    /**
     * Derive a display name from a document path using packet_config.name_patterns.
     *
     * @param {string} path
     * @returns {string | null}
     */
    deriveDocumentName(path) {
        const pkt = this.getResolvedPacketConfig();
        const filename = basename(path, ".md");

        for (let i = 0, len = pkt.name_patterns.length; i < len; i++) {
            const pat = pkt.name_patterns[i];
            try {
                const re = new RegExp(pat, "i");
                if (re.test(filename)) {
                    const match = filename.match(re);
                    if (match) {
                        return match[0].replace(/_/g, " ").replace(/\./g, " ");
                    }
                }
            } catch {
                // invalid pattern — skip
            }
        }

        return null;
    }

    // =========================================================================
    // Resolution Helpers (static, private)
    // =========================================================================

    /**
     * Extract meta.extensions.formatting.cover as a cover config layer.
     * @param {unknown} meta
     * @returns {Record<string, unknown>|null}
     * @private
     */
    static _extractMetaCoverLayer(meta) {
        if (!isObject(meta)) {
            return null;
        }
        const ext = /** @type {Record<string, unknown>} */ (meta).extensions;
        if (!isObject(ext)) {
            return null;
        }
        const fmt = /** @type {Record<string, unknown>} */ (ext).formatting;
        if (!isObject(fmt)) {
            return null;
        }
        const cover = /** @type {Record<string, unknown>} */ (fmt).cover;
        if (!isObject(cover)) {
            return null;
        }
        return /** @type {Record<string, unknown>} */ (cover);
    }

    /** @returns {CoverRenderConfig} */
    static _defaultCoverConfig() {
        return {
            suppress_header: true,
            suppress_footer: true,
            suppress_page_numbering: true,
            reserve_header_footer_space: false,
            draft_watermark: {
                enabled: false,
                text: "DRAFT DOCUMENT",
                gray: 0.9,
                angle_deg: 35,
                font_size: 84
            }
        };
    }

    /**
     * @param {unknown} raw
     * @param {CoverRenderConfig} defaults
     * @returns {CoverRenderConfig}
     */
    static _resolveCoverConfigLayer(raw, defaults) {
        if (!isObject(raw)) {
            return defaults;
        }
        const r = /** @type {Record<string, unknown>} */ (raw);
        const dw = defaults.draft_watermark || {};
        const rw = resolveObject(r.draft_watermark);
        return {
            suppress_header: boolOr(
                r.suppress_header,
                defaults.suppress_header
            ),
            suppress_footer: boolOr(
                r.suppress_footer,
                defaults.suppress_footer
            ),
            suppress_page_numbering: boolOr(
                r.suppress_page_numbering,
                defaults.suppress_page_numbering
            ),
            reserve_header_footer_space: boolOr(
                r.reserve_header_footer_space,
                defaults.reserve_header_footer_space
            ),
            draft_watermark: {
                enabled: boolOr(rw?.enabled, dw.enabled),
                text: stringOr(rw?.text, dw.text),
                gray: numberOr(rw?.gray, dw.gray),
                angle_deg: numberOr(rw?.angle_deg, dw.angle_deg),
                font_size: numberOr(rw?.font_size, dw.font_size)
            },
            cover_layout:
                resolveObject(r.cover_layout) ??
                resolveObject(r.layout) ??
                defaults.cover_layout
        };
    }

    // =========================================================================
    // Document Policies
    // =========================================================================

    /**
     * Get document policies
     * @returns {RenderDocumentPolicy}
     */
    getDocumentPolicies() {
        return this.data.document_policies || {};
    }

    /**
     * Get defaults from document policies
     * @returns {RenderDefaults}
     */
    getDefaults() {
        return this.getDocumentPolicies().defaults || {};
    }

    /**
     * Get precedence notes
     * @returns {string|undefined}
     */
    getPrecedenceNotes() {
        return this.getDocumentPolicies().precedence_notes;
    }

    // =========================================================================
    // Rulesets
    // =========================================================================

    /**
     * Get rulesets from document policies
     * @returns {RenderRuleset[]}
     */
    getRulesets() {
        return this.getDocumentPolicies().rulesets || [];
    }

    /**
     * Get a specific ruleset by ID
     * @param {string} ruleset_id
     * @returns {RenderRuleset|undefined}
     */
    getRuleset(ruleset_id) {
        const rulesets = this.getRulesets();
        for (let i = 0, len = rulesets.length; i < len; i++) {
            if (rulesets[i].id === ruleset_id) {
                return rulesets[i];
            }
        }
        return undefined;
    }

    // =========================================================================
    // Targets
    // =========================================================================

    /**
     * Get targets from document policies
     * @returns {Record<string, RenderTarget>}
     */
    getTargets() {
        return this.getDocumentPolicies().targets || {};
    }

    /**
     * Get a specific target by ID
     * @param {string} target_id
     * @returns {RenderTarget|undefined}
     */
    getTarget(target_id) {
        return this.getTargets()[target_id];
    }

    // =========================================================================
    // Render Profiles
    // =========================================================================

    /**
     * Get render profiles from document policies
     * @returns {Record<string, RenderProfile>}
     */
    getRenderProfiles() {
        return this.getDocumentPolicies().render_profiles || {};
    }

    /**
     * Get a specific render profile by ID
     * @param {string} profile_id
     * @returns {RenderProfile|undefined}
     */
    getRenderProfile(profile_id) {
        return this.getRenderProfiles()[profile_id];
    }

    /**
     * Resolve a render profile with inheritance
     * @param {string} profile_id
     * @returns {RenderProfile|null}
     */
    resolveRenderProfile(profile_id) {
        const profile = this.getRenderProfile(profile_id);
        if (!profile) {
            return null;
        }

        // If no extends, return as-is
        if (!profile.extends) {
            return profile;
        }

        // Resolve parent profile
        const parent_profile = this.resolveRenderProfile(profile.extends);
        if (!parent_profile) {
            return profile;
        }

        // Merge parent with current profile
        /** @type {RenderProfile} */
        const merged = { ...parent_profile };
        for (const key of Object.keys(profile)) {
            if (key === "extends") {
                continue;
            }
            if (key === "overrides" && merged.overrides && profile.overrides) {
                merged.overrides = {
                    ...merged.overrides,
                    ...profile.overrides
                };
            } else {
                // @ts-ignore
                merged[key] = profile[key];
            }
        }
        return merged;
    }

    /**
     * Get effective target configuration for a profile
     * @param {string} profile_id
     * @returns {{ target: RenderTarget, profile: RenderProfile }|null}
     */
    getEffectiveTargetConfig(profile_id) {
        const profile = this.resolveRenderProfile(profile_id);
        if (!profile || !profile.target) {
            return null;
        }

        const base_target = this.getTarget(profile.target);
        if (!base_target) {
            return null;
        }

        // Apply profile overrides to target
        /** @type {RenderTarget} */
        const effective_target = { ...base_target };
        if (profile.overrides) {
            for (const key of Object.keys(profile.overrides)) {
                const base_val =
                    effective_target[/** @type {keyof RenderTarget} */ (key)];
                const override_val = profile.overrides[key];
                if (isObject(base_val) && isObject(override_val)) {
                    // @ts-ignore
                    effective_target[key] = { ...base_val, ...override_val };
                } else {
                    // @ts-ignore
                    effective_target[key] = override_val;
                }
            }
        }

        return { target: effective_target, profile };
    }

    // =========================================================================
    // Pack Entry Helpers (for document list handling)
    // =========================================================================

    /**
     * Get path from pack entry
     * @param {unknown} entry
     * @returns {string|null}
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
     * Resolve effective render settings for a file
     * @param {RenderDocumentPolicy} policy
     * @param {FileDescriptor} file
     * @returns {{ effective: RulesetRender, applied: { id: string, severity: string }[] }}
     */
    static resolveFilePolicy(policy, file) {
        const defaults = policy?.defaults ? policy.defaults : {};
        /** @type {RulesetRender} */
        let effective = { ...defaults };
        /** @type {{ id: string, severity: string }[]} */
        const applied = [];

        const rulesets =
            policy && Array.isArray(policy.rulesets) ? policy.rulesets : [];
        for (let i = 0, len = rulesets.length; i < len; i++) {
            const r = rulesets[i];
            if (!isObject(r)) {
                continue;
            }
            if (!RenderPack._rulesetMatches(r, file)) {
                continue;
            }
            const render = r.render || {};
            effective = RenderPack._mergeRender(effective, render);
            applied.push({
                id: hasPropertyOfType(r, "id", "string")
                    ? r.id
                    : `ruleset#${i}`,
                severity: hasPropertyOfType(r, "severity", "string")
                    ? r.severity
                    : "error"
            });
        }

        // Normalize legacy "profile" field to "render_profile_id" so callers can
        // treat render_profile_id as canonical.
        if (
            typeof (/** @type {any} */ (effective).profile) === "string" &&
            (typeof (/** @type {any} */ (effective).render_profile_id) !==
                "string" ||
                /** @type {any} */ (effective).render_profile_id.length === 0)
        ) {
            // @ts-ignore
            effective.render_profile_id = /** @type {any} */ (
                effective
            ).profile;
        }

        return { effective, applied };
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

        // Required fields
        if (this.data.schema !== RENDER_PACK_SCHEMA_NAME) {
            errors.push({
                path: "schema",
                message: `Expected "${RENDER_PACK_SCHEMA_NAME}", got "${this.data.schema}"`
            });
        }

        if (
            !hasPropertyOfType(this.data, "schema_version", "number") ||
            this.data.schema_version < 1
        ) {
            errors.push({
                path: "schema_version",
                message: "Must be a positive integer"
            });
        }

        if (
            !hasPropertyOfType(this.data, "pack_id", "string") ||
            !PACK_ID_PATTERN.test(this.data.pack_id)
        ) {
            errors.push({
                path: "pack_id",
                message: "Must match pattern ^[a-z][a-z0-9-]{2,}$"
            });
        }

        // Imports validation
        if (this.data.imports !== undefined) {
            if (!Array.isArray(this.data.imports)) {
                errors.push({
                    path: "imports",
                    message: "Must be an array"
                });
            } else {
                for (let i = 0, len = this.data.imports.length; i < len; i++) {
                    if (
                        typeof this.data.imports[i] !== "string" ||
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
                this._validateTargets(policies.targets, errors);
                this._validateRenderProfiles(policies.render_profiles, errors);
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Validate rulesets
     * @param {RenderRuleset[]|undefined} rulesets
     * @param {ValidationError[]} errors
     * @private
     */
    _validateRulesets(rulesets, errors) {
        if (rulesets === undefined) {
            return;
        }
        if (!Array.isArray(rulesets)) {
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
            if (!hasPropertyOfType(r, "id", "string") || r.id.length === 0) {
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
                if (
                    sel.doc_types !== undefined &&
                    Array.isArray(sel.doc_types)
                ) {
                    for (
                        let j = 0, j_len = sel.doc_types.length;
                        j < j_len;
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
            if (!isObject(r.render)) {
                errors.push({
                    path: `${path}.render`,
                    message: "Must be an object"
                });
            }
        }
    }

    /**
     * Validate targets
     * @param {Record<string, RenderTarget>|undefined} targets
     * @param {ValidationError[]} errors
     * @private
     */
    _validateTargets(targets, errors) {
        if (targets === undefined) {
            return;
        }
        if (!isObject(targets)) {
            errors.push({
                path: "document_policies.targets",
                message: "Must be an object"
            });
            return;
        }
        for (const key of Object.keys(targets)) {
            const target = targets[key];
            const path = `document_policies.targets.${key}`;
            if (!isObject(target)) {
                errors.push({ path, message: "Must be an object" });
            }
        }
    }

    /**
     * Validate render profiles
     * @param {Record<string, RenderProfile>|undefined} profiles
     * @param {ValidationError[]} errors
     * @private
     */
    _validateRenderProfiles(profiles, errors) {
        if (profiles === undefined) {
            return;
        }
        if (!isObject(profiles)) {
            errors.push({
                path: "document_policies.render_profiles",
                message: "Must be an object"
            });
            return;
        }
        for (const key of Object.keys(profiles)) {
            const profile = profiles[key];
            const path = `document_policies.render_profiles.${key}`;
            if (!isObject(profile)) {
                errors.push({ path, message: "Must be an object" });
            }
        }
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    /**
     * Merge two policy objects
     * @param {RenderDocumentPolicy} a
     * @param {RenderDocumentPolicy} b
     * @returns {RenderDocumentPolicy}
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
     * Merge render object into base
     * @param {RulesetRender} base
     * @param {RulesetRender} render
     * @returns {RulesetRender}
     * @private
     */
    static _mergeRender(base, render) {
        if (!isObject(base)) {
            base = {};
        }
        if (!isObject(render)) {
            return base;
        }

        return mergeObjects(base, render, RENDER_MERGE_STRATEGY);
    }

    /**
     * Check if a ruleset matches a file
     * @param {RenderRuleset} ruleset
     * @param {FileDescriptor} file
     * @returns {boolean}
     * @private
     */
    static _rulesetMatches(ruleset, file) {
        return rulesetMatchesFile(ruleset, {
            rel_path: file.rel_path,
            doc_type: file.doc_type,
            ext: file.ext ?? "",
            is_root_file: file.is_root_file
        });
    }
}
