/**
 * Filing Packet Generator
 * Thin orchestrator — wires resolved config into the AST pipeline+renderer.
 *
 * Pack entry resolution, entity extraction, document kind resolution,
 * and document name derivation live in RenderPack (which owns the config).
 * Cover/signing config merging lives in RenderPack.
 * Cover page element building lives in CoverPageGenerator.
 * Signing party normalization lives in SigningPageGenerator.
 *
 * This class ONLY: sets up the pipeline, loads sources, configures the
 * renderer, and writes the output.
 *
 * @module generators/FilingPacketGenerator
 */

import { join, dirname, basename, extname } from "node:path";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
    createArticlePageBreakRule,
    createDocumentPipeline,
    createLegalKeepTogetherRule,
    createPartOnlyPartPageBreakRule
} from "../../ast/pipelines/DocumentPipeline.mjs";
import { createTwoPassPdfRenderer } from "../../ast/renderers/TwoPassPdfRenderer.mjs";
import { processDustCover } from "../../ast/renderers/DustCoverRenderer.mjs";
import { isString, isArray, stringOr, enumOr } from "../../util/general.mjs";
import { Document } from "../Document.mjs";
import { CoverPageGenerator } from "./CoverPageGenerator.mjs";
import { SigningPageGenerator } from "./SigningPageGenerator.mjs";
import {
    deepSnakeToCamel,
    hasNonNullishProperty,
    isObject,
    resolveObject
} from "../../util/objects.mjs";

// =========================================================================
// Type Imports
// =========================================================================

/** @typedef {import("../types/general.mjs").Metadata} Metadata */
/** @typedef {import("../types/general.mjs").PackEntry} PackEntry */
/** @typedef {import("../Repository.mjs").Repository} Repository */
/** @typedef {import("../Repository.mjs").RecordInfo} RecordInfo */
/** @typedef {import("../../ast/types/core.mjs").FormattingRule} FormattingRule */
/** @typedef {import("../IndManager.mjs").IndManager} IndManager */
/** @typedef {import("../RenderPack.mjs").RenderPack} RenderPack */
/** @typedef {import("../RenderPack.mjs").ResolvedPacketConfig} ResolvedPacketConfig */
/** @typedef {import("../../ast/types/core.mjs").VariableRef} VariableRef */
/** @typedef {import("../../ast/types/core.mjs").ResolvedRenderConfig} ResolvedRenderConfig */
/** @typedef {import("../types/general.mjs").CoverPageConfig} CoverPageConfig */
/** @typedef {import("../types/general.mjs").CoverPageOptions} CoverPageOptions */
/** @typedef {import("../../ast/types/core.mjs").CoverPageOptions} ResolvedCoverPageOptions */
/** @typedef {import("../../ast/types/core.mjs").TocLevelStyle} TocLevelStyle */
/** @typedef {import("../types/general.mjs").ResolvedSigningConfig} ResolvedSigningConfig */
export class FilingPacketGenerator {
    /**
     * @param {Repository} repo
     * @param {IndManager} ind_manager
     * @param {RenderPack} render_pack
     * @param {boolean} [verbose]
     * @param {boolean} [provided_render_pack_is_authoritative]
     */
    constructor(repo, ind_manager, render_pack, verbose, provided_render_pack_is_authoritative) {
        /** @type {Repository} */
        this._repo = repo;

        /** @type {IndManager} */
        this._ind_manager = ind_manager;

        /** @type {RenderPack} */
        this._render_pack = render_pack;

        /** @type {boolean} */
        this._verbose = verbose || false;

        /** @type {boolean} */
        this._provided_render_pack_is_authoritative = provided_render_pack_is_authoritative === true;

        const trace_opts = {
            verbose: this._verbose,
            trace: (/** @type {string} */ msg) => this._trace(msg)
        };

        /** @type {CoverPageGenerator} */
        this._cover_page_generator = new CoverPageGenerator(trace_opts);

        /** @type {SigningPageGenerator} */
        this._signing_page_generator = new SigningPageGenerator(trace_opts);
    }

    /**
     * @param {string} msg
     * @private
     */
    _trace(msg) {
        if (this._verbose) {
            console.log(`[VERBOSE] ${msg}`);
        }
    }

    /**
     * Resolve the most specific active render pack for a record.
     * Falls back to explicitly selected loaded packs when repository-level
     * resolution incorrectly drops back to the default pack.
     *
     * @param {RecordInfo} record
     * @param {Metadata} meta
     * @returns {RenderPack | null}
     * @private
     */
    _resolveActiveRenderPack(record, meta) {
        if (this._provided_render_pack_is_authoritative) {
            return this._render_pack;
        }

        const target_meta = record.metafile || meta;
        const resolved_pack = this._repo.getResolvedRenderPack(target_meta);
        const selection = this._extractRenderSelection(target_meta);

        if (!this._hasExplicitRenderSelection(selection)) {
            return resolved_pack;
        }

        if (this._renderPackLooksResolved(resolved_pack, record, meta)) {
            return resolved_pack;
        }

        const loaded_packs = this._repo.getLoadedRenderPacks();
        if (!Array.isArray(loaded_packs) || loaded_packs.length === 0) {
            return resolved_pack;
        }

        const rescued_pack = this._mergeLoadedRenderPacksForSelection(
            loaded_packs,
            selection
        );
        if (this._renderPackLooksResolved(rescued_pack, record, meta)) {
            this._trace(
                `render pack rescue: using loaded-pack selection (${rescued_pack.getId()})`
            );
            return rescued_pack;
        }

        return resolved_pack;
    }

    /**
     * @param {unknown} metafile_or_data
     * @returns {{ pack_ids: string[], pack_paths: string[], family: string | null, default_profile: string | null }}
     * @private
     */
    _extractRenderSelection(metafile_or_data) {
        const repo_ctor = this._repo?.constructor;
        if (
            repo_ctor &&
            typeof repo_ctor.extractRenderSelection === "function"
        ) {
            return repo_ctor.extractRenderSelection(metafile_or_data);
        }
        return {
            pack_ids: [],
            pack_paths: [],
            family: null,
            default_profile: null
        };
    }

    /**
     * @param {{ pack_ids: string[], pack_paths: string[], family: string | null, default_profile: string | null } | null | undefined} selection
     * @returns {boolean}
     * @private
     */
    _hasExplicitRenderSelection(selection) {
        return !!(
            selection &&
            ((Array.isArray(selection.pack_ids) && selection.pack_ids.length > 0) ||
                (Array.isArray(selection.pack_paths) && selection.pack_paths.length > 0) ||
                (typeof selection.family === "string" && selection.family.trim().length > 0))
        );
    }

    /**
     * @param {RenderPack | null | undefined} render_pack
     * @param {RecordInfo} record
     * @param {Metadata} meta
     * @returns {boolean}
     * @private
     */
    _renderPackLooksResolved(render_pack, record, meta) {
        if (!render_pack) {
            return false;
        }

        const pack_id = stringOr(render_pack.getId()) || "";
        const base_config = render_pack.resolveForFile({
            rel_path: record.rel_path,
            doc_type: "PACKET",
            ext: "pdf"
        });
        const cover_config = render_pack.resolveCoverConfig(
            meta,
            base_config?.cover_config ?? null
        );
        const packet_config = render_pack.getResolvedPacketConfig();
        const cover_layout = isObject(cover_config?.cover_layout)
            ? cover_config.cover_layout
            : null;
        const has_cover_layout = !!(
            cover_layout && Object.keys(cover_layout).length > 0
        );
        const has_packet_identity = !!(
            stringOr(packet_config?.header_text) ||
            stringOr(packet_config?.default_document_title)
        );

        return (
            pack_id !== "default" ||
            has_cover_layout ||
            has_packet_identity
        );
    }

    /**
     * @param {string} value
     * @returns {string}
     * @private
     */
    _normalizeRenderPackKey(value) {
        return value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
    }

    /**
     * @param {RenderPack[]} packs
     * @param {{ pack_ids: string[], pack_paths: string[], family: string | null, default_profile: string | null }} selection
     * @returns {RenderPack | null}
     * @private
     */
    _mergeLoadedRenderPacksForSelection(packs, selection) {
        if (!Array.isArray(packs) || packs.length === 0) {
            return null;
        }

        const normalize_key = (value) => this._normalizeRenderPackKey(value);

        /**
         * @param {RenderPack[]} all_packs
         * @param {string[]} pack_ids
         * @returns {RenderPack[]}
         */
        const select_by_ids = (all_packs, pack_ids) => {
            const wanted = new Set();
            for (let i = 0, len = pack_ids.length; i < len; i++) {
                const normalized = normalize_key(pack_ids[i]);
                if (normalized.length > 0) {
                    wanted.add(normalized);
                }
            }
            if (wanted.size === 0) {
                return [];
            }

            /** @type {Set<string>} */
            const include_ids = new Set();
            /** @type {Set<string>} */
            const include_sources = new Set();
            /** @type {Map<string, RenderPack>} */
            const by_source = new Map();

            for (let i = 0, len = all_packs.length; i < len; i++) {
                const source_path = all_packs[i].source_path;
                if (typeof source_path === "string" && source_path.length > 0) {
                    by_source.set(source_path, all_packs[i]);
                }
            }

            /**
             * @param {RenderPack} pack
             */
            const include_pack = (pack) => {
                const normalized_id = normalize_key(pack.getId());
                if (normalized_id.length > 0) {
                    include_ids.add(normalized_id);
                }

                const source_path = pack.source_path;
                if (typeof source_path === "string" && source_path.length > 0) {
                    if (include_sources.has(source_path)) {
                        return;
                    }
                    include_sources.add(source_path);

                    const source_dir = dirname(source_path);
                    const imports = pack.getImports();
                    for (let i = 0, len = imports.length; i < len; i++) {
                        const imported_pack = by_source.get(join(source_dir, imports[i]));
                        if (imported_pack) {
                            include_pack(imported_pack);
                        }
                    }
                }
            };

            /**
             * @param {RenderPack} pack
             * @returns {boolean}
             */
            const matches = (pack) => {
                const normalized_id = normalize_key(pack.getId());
                if (wanted.has(normalized_id)) {
                    return true;
                }

                const source_path = typeof pack.source_path === "string" ? pack.source_path : "";
                if (source_path.length === 0) {
                    return false;
                }

                const file_name = basename(source_path);
                const stem = file_name.replace(extname(file_name), "");
                const stem_normalized = normalize_key(stem);
                if (wanted.has(stem_normalized)) {
                    return true;
                }

                const without_version = stem_normalized.replace(/-v\d+(?:-\d+)*$/, "");
                if (without_version.length > 0 && wanted.has(without_version)) {
                    return true;
                }

                for (const next_wanted of wanted) {
                    if (
                        next_wanted === stem_normalized ||
                        next_wanted === without_version ||
                        (without_version.length > 0 && next_wanted.startsWith(without_version)) ||
                        (next_wanted.length > 0 && without_version.startsWith(next_wanted))
                    ) {
                        return true;
                    }
                }

                return false;
            };

            for (let i = 0, len = all_packs.length; i < len; i++) {
                if (matches(all_packs[i])) {
                    include_pack(all_packs[i]);
                }
            }

            return all_packs.filter((pack) => {
                const source_path = typeof pack.source_path === "string" ? pack.source_path : "";
                if (source_path.length > 0) {
                    return include_sources.has(source_path);
                }
                return include_ids.has(normalize_key(pack.getId()));
            });
        };

        /**
         * @param {RenderPack[]} all_packs
         * @param {string} family
         * @returns {RenderPack[]}
         */
        const select_by_family = (all_packs, family) => {
            const tokens = normalize_key(family)
                .split("-")
                .filter((token) => token.length > 0);
            if (tokens.length === 0) {
                return [];
            }

            let best_score = 0;
            /** @type {string[]} */
            const matched_ids = [];

            for (let i = 0, len = all_packs.length; i < len; i++) {
                const pack = all_packs[i];
                const label = `${pack.getId()} ${basename(pack.source_path || "")} ${pack.getDescription() || ""}`
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, " ");
                let score = 0;
                for (let t = 0, tLen = tokens.length; t < tLen; t++) {
                    if (label.includes(tokens[t])) {
                        score += 1;
                    }
                }
                if (score === 0) {
                    continue;
                }
                if (score > best_score) {
                    best_score = score;
                    matched_ids.length = 0;
                    matched_ids.push(pack.getId());
                } else if (score === best_score) {
                    matched_ids.push(pack.getId());
                }
            }

            return matched_ids.length > 0 ? select_by_ids(all_packs, matched_ids) : [];
        };

        /**
         * @param {RenderPack[]} all_packs
         * @param {RenderPack[]} selected_packs
         * @returns {RenderPack[]}
         */
        const with_support_packs = (all_packs, selected_packs) => {
            if (!Array.isArray(selected_packs) || selected_packs.length === 0) {
                return all_packs;
            }

            /** @type {Set<string>} */
            const selected_ids = new Set();
            /** @type {Set<string>} */
            const selected_sources = new Set();

            for (let i = 0, len = selected_packs.length; i < len; i++) {
                selected_ids.add(normalize_key(selected_packs[i].getId()));
                if (
                    typeof selected_packs[i].source_path === "string" &&
                    selected_packs[i].source_path.length > 0
                ) {
                    selected_sources.add(selected_packs[i].source_path);
                }
            }

            const merged_packs = all_packs.filter((pack) => {
                const normalized_id = normalize_key(pack.getId());
                const descriptor = `${normalized_id} ${basename(pack.source_path || "")} ${pack.getDescription() || ""}`.toLowerCase();
                const is_support_pack =
                    descriptor.includes("base") ||
                    descriptor.includes("common") ||
                    descriptor.includes("shared");
                return (
                    selected_ids.has(normalized_id) ||
                    (typeof pack.source_path === "string" && selected_sources.has(pack.source_path)) ||
                    is_support_pack
                );
            });

            return merged_packs.length > 0 ? merged_packs : selected_packs;
        };

        /** @type {RenderPack[]} */
        let selected_packs = [];
        if (Array.isArray(selection.pack_ids) && selection.pack_ids.length > 0) {
            selected_packs = select_by_ids(packs, selection.pack_ids);
        }
        if (
            selected_packs.length === 0 &&
            typeof selection.family === "string" &&
            selection.family.trim().length > 0
        ) {
            selected_packs = select_by_family(packs, selection.family);
        }
        if (selected_packs.length === 0) {
            selected_packs = packs.slice();
        } else {
            selected_packs = with_support_packs(packs, selected_packs);
        }

        const render_pack_ctor = packs[0]?.constructor;
        if (!render_pack_ctor || typeof render_pack_ctor.mergePacks !== "function") {
            return selected_packs[0] || null;
        }

        const merged_result = render_pack_ctor.mergePacks(selected_packs);
        return merged_result?.pack || null;
    }

    // =========================================================================
    // Generate
    // =========================================================================

    /**
     * Generate a filing packet for a record.
     *
     * @param {RecordInfo} record
     * @param {Object} options
     * @param {boolean} [options.exclude_ind]
     * @param {boolean} [options.ind_in_footer]
     * @param {boolean} [options.ind_in_header]
     * @param {boolean} [options.overwrite]
     * @param {string} [options.packet_name]
     * @param {string} [options.author]
     * @param {string} [options.packet_variant]
     * @param {Object} [options.cover_overrides]
     * @param {boolean} [options.signing_page]
     * @param {Object} [options.signing_page_config]
     * @param {boolean} [options.disable_page_break_rules]
     * @param {boolean} [options.disable_soft_wrap]
     * @returns {Object} result
     */
    generate(record, options) {
        const meta = record.metafile ? record.metafile.data : {};
        const active_render_pack =
            this._resolveActiveRenderPack(record, meta) || this._render_pack;
        const pkt_cfg = active_render_pack.getResolvedPacketConfig();

        this._traceGenerateHeader(record, meta, pkt_cfg);
        this._trace(`activeRenderPack: ${active_render_pack.getId()}`);

        // 1. Pack entries (RenderPack owns resolution)
        const pack_entries = active_render_pack.resolvePackEntries(meta, {
            exclude_ind: options.exclude_ind
        });
        if (!Array.isArray(pack_entries)) {
            return pack_entries;
        }

        // 2. Entity name & document kind (RenderPack owns extraction)
        const entity_name =
            stringOr(options.cover_overrides?.entity_name) ??
            active_render_pack.extractEntityName(meta, pack_entries) ??
            pkt_cfg.default_entity_name;

        const document_kind =
            stringOr(options.cover_overrides?.document_kind) ||
            active_render_pack.resolveDocumentKind(meta, pack_entries);

        const packet_variant_id = this._resolvePacketVariantId(
            meta,
            options,
            document_kind
        );
        const packet_variant_cfg = this._resolvePacketVariantConfig(
            pkt_cfg,
            packet_variant_id,
            document_kind
        );

        this._trace(`--- Packet Variant ---`);
        this._trace(`  id: "${packet_variant_id}"`);
        this._trace(`  cfg: ${packet_variant_cfg ? "present" : "(none)"}`);

        this._tracePackEntries(pack_entries);
        this._trace(`--- Entity & Kind Resolution ---`);
        this._trace(
            `entityName: "${entity_name}" default=${pkt_cfg.default_entity_name}`
        );
        this._trace(
            `documentKind: "${document_kind}" (override=${!!options
                .cover_overrides?.document_kind})`
        );

        // 3. Pipeline
        const disable_page_breaks =
            options.disable_page_break_rules ??
            (packet_variant_cfg
                ? packet_variant_cfg.disable_page_break_rules
                : false) ??
            false;

        this._trace(`  disablePageBreakRules: ${disable_page_breaks}`);

        /** @type {FormattingRule[]} */
        const formatting_rules = [createLegalKeepTogetherRule()];
        if (!disable_page_breaks) {
            formatting_rules.push(
                createArticlePageBreakRule(),
                createPartOnlyPartPageBreakRule()
            );
        }

        const pipeline =
            createDocumentPipeline().addFormattingRules(formatting_rules);

        // 4. Base styling from adapter — raw snake_case RulesetRender.
        //    Converted to camelCase once at the renderer boundary below.
        const base_config = active_render_pack.resolveForFile({
            rel_path: record.rel_path,
            doc_type: "PACKET",
            ext: "pdf"
        });

        this._traceBaseConfig(base_config);

        // 5. Cover config — RenderPack merges, adapter converts
        const include_cover = this._resolveIncludeCover(packet_variant_cfg);
        const cover_resolved = include_cover
            ? active_render_pack.resolveCoverConfig(
                  meta,
                  base_config?.cover_config ?? null
              )
            : null;
        const cover_render_config = include_cover ? cover_resolved : null;

        this._traceCoverRenderConfig(cover_render_config);

        // 6. Load sources
        const sources = this._loadSources(
            record,
            pack_entries,
            pkt_cfg,
            entity_name,
            base_config,
            options.disable_soft_wrap === true,
            active_render_pack
        );
        if (sources.length === 0) {
            return {
                success: false,
                error: "No valid documents found for packet"
            };
        }

        // 7. Header text — packet title from assembly.packet.label (the
        //    overall filing title), NOT determineDocumentTitle which resolves
        //    individual-document titles from meta.title / document.title.
        const section_documents = sources
            .filter((src) => src.exlude_from_toc !== true)
            .map((src) => ({
                sectionId: src.id,
                name: src.name
            }));

        const document_title =
            stringOr(meta?.assembly?.packet?.label) ||
            record.metafile.determineDocumentTitle(pkt_cfg) ||
            pkt_cfg.default_document_title ||
            "FILING PACKET";

        const packet_title_for_header = String(
            document_title ?? pkt_cfg.default_document_title
        ).toUpperCase();
        const left_header_text = this._buildLeftHeaderText(
            entity_name,
            pkt_cfg
        );

        // 8. Cover overrides: meta.assembly.packet.cover + CLI (CLI wins)
        const merged_cover_overrides = this._mergeCoverOverrides(
            meta,
            options,
            packet_variant_cfg
        );

        this._trace(`--- Cover Overrides ---`);
        this._trace(
            `  merged: ${
                merged_cover_overrides
                    ? JSON.stringify(merged_cover_overrides)
                    : "(null)"
            }`
        );

        // 9. Composition config
        const normalized_cover_overrides =
            this._cover_page_generator.normalizeCoverOverrides(
                merged_cover_overrides ?? null
            );

        const include_toc = this._resolveIncludeToc(
            packet_variant_cfg,
            sources,
            document_kind,
            document_title,
            meta
        );

        const cover_page = include_cover
            ? this._cover_page_generator.buildCoverPage(
                  record,
                  meta,
                  pkt_cfg,
                  entity_name,
                  pack_entries,
                  document_kind,
                  cover_render_config,
                  normalized_cover_overrides,
                  document_title
              )
            : null;

        const base_toc_config = /** @type {any} */ (base_config?.toc ?? null);
        const toc_heading_levels = Array.isArray(base_toc_config?.levels)
            ? base_toc_config.levels
            : [1, 2, 3, 4];

        const toc_config = include_toc
            ? {
                  title: "TABLE OF CONTENTS",
                  levels: toc_heading_levels,
                  sectionDocuments: section_documents
              }
            : null;

        // 9b. Optional dust cover (rendered before cover, excluded from pagination).
        const dust_cover_page =
            /** @type {import("../../ast/renderers/DustCoverRenderer.mjs").DustCoverPage | null} */ (
                (
                    this._resolveDustCoverPage(
                        record,
                        meta,
                        pkt_cfg,
                        packet_variant_cfg,
                        options
                    )
                )
            );

        const leading_section_config =
            deepSnakeToCamel(
                /** @type {any} */ (base_config)?.leading_section ?? null
            ) ?? undefined;

        this._trace(`--- Dust Cover ---`);
        this._trace(`  enabled: ${dust_cover_page ? "true" : "false"}`);

        const packet_page_config = {
            ...(typeof base_config?.page_size === "string"
                ? { size: base_config.page_size.toLowerCase() }
                : {}),
            ...(typeof base_config?.orientation === "string"
                ? { orientation: base_config.orientation.toLowerCase() }
                : {}),
            ...(base_config?.margins ? { margins: base_config.margins } : {})
        };

        const composition_config = {
            sections: sources.map((src, idx) => ({
                id: src.id,
                name: src.name,
                startsNewPage:
                    (disable_page_breaks && idx === 0) ||
                    (!disable_page_breaks &&
                        (pkt_cfg.section_page_break === "always" ||
                            (pkt_cfg.section_page_break === "first-only" &&
                                idx === 0))),
                breakMode: /** @type {"always" | "part-only"} */ (
                    src.break_mode ?? "always"
                ),
                horizontalRuleBehavior:
                    (disable_page_breaks
                        ? "rule"
                        : src.horizontal_rule_behavior) ?? undefined,
                leadingSection: leading_section_config
                    ? deepSnakeToCamel(leading_section_config)
                    : undefined,
                headers: src.is_image_page
                    ? []
                    : [
                          {
                              pages: /** @type {"section-not-first"} */ (
                                  "section-not-first"
                              ),
                              columns: {
                                  left: {
                                      content: left_header_text,
                                      style: { fontSize: 9, bold: true }
                                  },
                                  right: {
                                      content: src.header_name
                                          ? src.header_name
                                          : `${packet_title_for_header} - ${this._buildHeaderDocName(
                                                src.name,
                                                entity_name,
                                                pkt_cfg
                                            ).toUpperCase()}`,
                                      style: { fontSize: 9, bold: false }
                                  }
                              },
                              border: { width: 0.5 },
                              location: /** @type {"header" | "footer"} */ (
                                  "header"
                              )
                          }
                      ],
                footers: src.is_image_page ? [] : undefined
            })),
            defaultPageConfig: packet_page_config
        };

        const normalized_cover_page = cover_page
            ? deepSnakeToCamel(cover_page)
            : null;

        if (normalized_cover_page) {
            composition_config.coverPage = normalized_cover_page;
        }

        if (toc_config) {
            composition_config.toc = deepSnakeToCamel(toc_config);
        }

        pipeline.setCompositionConfig(composition_config);

        // 10. Signing page — RenderPack resolves, SPG normalizes, adapter converts
        //     Priority: CLI > meta.assembly.packet.signing_page > packet variant.
        //     Meta signing_page replaces (not merges) the pack config so that
        //     intentionally blank signatory values survive.
        const meta_signing_page = isObject(meta?.assembly?.packet?.signing_page)
            ? meta.assembly.packet.signing_page
            : undefined;

        const signing_resolved = active_render_pack.resolveSigningConfig({
            signing_page:
                options.signing_page ??
                (meta_signing_page !== undefined
                    ? meta_signing_page.enabled !== false
                    : undefined) ??
                (packet_variant_cfg
                    ? packet_variant_cfg.signing_page
                    : undefined),
            signing_page_config:
                options.signing_page_config ??
                meta_signing_page ??
                (packet_variant_cfg
                    ? packet_variant_cfg.signing_page_config
                    : undefined)
        });

        this._traceSigningResolved(signing_resolved);

        const signing_page_config = signing_resolved
            ? this._signing_page_generator.normalizeParties(signing_resolved)
            : null;

        const resolved_signing_page_config = signing_page_config
            ? /** @type {import("../../ast/renderers/TwoPassPdfRenderer.mjs").SigningPageConfig | null} */ (
                  deepSnakeToCamel(signing_page_config)
              )
            : null;

        this._traceSigningPageConfig(signing_page_config);

        // 11. Renderer
        /** @type {VariableRef} */
        const page_var = { type: "variable", name: "page" };

        /** @type {VariableRef} */
        const total_var = { type: "variable", name: "totalPages" };

        const cover_status = isString(merged_cover_overrides?.status)
            ? merged_cover_overrides.status.trim().toLowerCase()
            : "";
        const meta_status_phase = isString(meta?.status?.phase)
            ? meta.status.phase.trim().toLowerCase()
            : "";

        const effective_status_phase = meta_status_phase !== ""
            ? meta_status_phase
            : cover_status;

        const has_draft_status =
            effective_status_phase === "draft" ||
            effective_status_phase === "review";

        const has_cover_render_watermark =
            isObject(cover_render_config?.watermark) &&
            typeof cover_render_config.watermark.enabled === "boolean";

        const watermark_enabled = has_cover_render_watermark
            ? cover_render_config.watermark.enabled === true
            : normalized_cover_page != null &&
                hasNonNullishProperty(normalized_cover_page, "options") &&
                isObject(normalized_cover_page.options?.watermark) &&
                normalized_cover_page.options.watermark.enabled === true;

        const draft_watermark_text = has_draft_status
            ? stringOr(cover_render_config?.watermark?.text) ||
              (normalized_cover_page != null &&
              hasNonNullishProperty(normalized_cover_page, "options") &&
              isObject(normalized_cover_page.options?.watermark)
                  ? stringOr(normalized_cover_page.options.watermark.text)
                  : "") ||
              "DRAFT"
            : null;

        const show_draft_marking = has_draft_status && watermark_enabled;

        const has_margins = base_config && base_config.margins !== undefined;
        const base_font_size = base_config?.base_font_size ?? 10;

        this._trace(`--- Renderer Config ---`);
        this._trace(`  hasMargins: ${has_margins}`);
        this._trace(`  baseFontSize: ${base_font_size}`);
        this._trace(`  lineHeight: ${base_config?.line_spacing ?? 1.5}`);
        this._trace(
            `  horizontalRule.behavior: ${
                base_config?.horizontal_rule?.behavior ?? "rule (default)"
            }`
        );
        this._trace(`  section_page_break: ${pkt_cfg.section_page_break}`);
        this._trace(
            `  draftState: coverStatus=${cover_status || "(unset)"} metaStatus=${meta_status_phase || "(unset)"} hasDraftStatus=${has_draft_status} watermarkEnabled=${watermark_enabled} showDraftMarking=${show_draft_marking}`
        );

        // Single conversion point: snake_case RulesetRender → camelCase ResolvedRenderConfig.
        // Nothing above this line uses renderer types.
        const renderer_cfg = /** @type {ResolvedRenderConfig} */ (
            deepSnakeToCamel(base_config)
        );

        this._trace(
            `renderer_cfg embeddedFonts.roles=${JSON.stringify(
                renderer_cfg.embeddedFonts?.roles ?? {}
            )}`
        );

        /** @type {Record<string | number, TocLevelStyle>} */
        let levelStyles;

        if (renderer_cfg.toc?.levelStyles) {
            if (isArray(renderer_cfg.toc.levelStyles)) {
                levelStyles = {};
                for (
                    let i = 0, len = renderer_cfg.toc.levelStyles.length;
                    i < len;
                    i++
                ) {
                    const style = renderer_cfg.toc.levelStyles[i];

                    levelStyles[i + 1] = style;
                }
            } else {
                levelStyles =
                    /** @type { Record<string | number, TocLevelStyle>} */ (
                        /** @type {unknown} */ (renderer_cfg.toc.levelStyles)
                    );
            }
        } else {
            levelStyles = {
                1: {
                    fontSizeScale: 1.1,
                    bold: true,
                    indent: 0,
                    spacingAfter: 1.15,
                    spacingBefore: 1.2
                },
                2: {
                    fontSizeScale: 0.92,
                    bold: true,
                    indent: 24,
                    spacingAfter: 1.2
                },
                3: {
                    fontSizeScale: 0.85,
                    bold: false,
                    indent: 48,
                    spacingAfter: 1.1
                },
                4: {
                    fontSizeScale: 0.8,
                    bold: false,
                    indent: 72,
                    spacingAfter: 1.0
                }
            };
        }

        const renderer = createTwoPassPdfRenderer({
            pageConfig: {
                ...(typeof renderer_cfg.pageSize === "string"
                    ? { size: renderer_cfg.pageSize.toLowerCase() }
                    : {}),
                ...(typeof renderer_cfg.orientation === "string"
                    ? { orientation: renderer_cfg.orientation.toLowerCase() }
                    : {}),
                ...(has_margins ? { margins: renderer_cfg.margins } : {})
            },
            fonts: renderer_cfg.fonts,
            embeddedFonts: renderer_cfg.embeddedFonts,
            fontRoleDefaults: renderer_cfg.fontRoleDefaults,
            baseFontSize: renderer_cfg.baseFontSize ?? 10,
            lineHeight: renderer_cfg.lineSpacing ?? 1.5,
            headingScales: renderer_cfg.headingScales,
            verbose: this._verbose,
            variables: {
                recordId: record.record_id,
                showIndInFooter: options.ind_in_footer ? "true" : "false",
                showIndInHeader: options.ind_in_header ? "true" : "false",
                entityName: entity_name
            },
            dustCoverPage: dust_cover_page ?? undefined,
            coverConfig: cover_render_config
                ? deepSnakeToCamel(cover_render_config)
                : undefined,
            signingPage: resolved_signing_page_config ?? undefined,
            defaultFooters: [
                {
                    pages: "all",
                    columns: {
                        ...(show_draft_marking
                            ? {
                                  left: {
                                      content: [
                                          (() => {
                                              const label = draft_watermark_text
                                                  .trim()
                                                  .toUpperCase()
                                                  .startsWith("DRAFT")
                                                  ? draft_watermark_text
                                                  : `DRAFT — ${draft_watermark_text}`;
                                              return `${label} — REVIEW ONLY. NOT FINAL. NO RELIANCE. NO AUTHORITY.`;
                                          })()
                                      ],
                                      style: {
                                          fontSize: 8,
                                          bold: true,
                                          color: "#cc0000"
                                      }
                                  }
                              }
                            : {}),
                        right: {
                            content: ["Page ", page_var, " of ", total_var],
                            style: { fontSize: 9, bold: false }
                        }
                    },
                    location: "footer"
                }
            ],
            horizontalRule: {
                behavior: renderer_cfg.horizontalRule?.behavior ?? "rule"
            },
            table: renderer_cfg.table ?? renderer_cfg.tableStyle,
            tocConfig: {
                levelStyles
            },
            leadingSection: leading_section_config,
            spacingPolicy:
                renderer_cfg.spacingPolicy ??
                deepSnakeToCamel(
                    active_render_pack.getDocumentPolicies()?.spacing_policy
                ),
            metadata: {
                title:
                    entity_name !== pkt_cfg.default_entity_name
                        ? `${packet_title_for_header} - ${entity_name}`
                        : packet_title_for_header,
                author: options.author || entity_name || "",
                subject: packet_title_for_header,
                creator: "Solomon DAO Record Schema",
                producer: "Solomon DAO Record Render"
            }
        });
        pipeline.setRenderer(renderer);

        // 12. Render
        const result = pipeline.process(sources);

        if (result.success && result.renderResult?.output) {
            const explicit_packet_name =
                stringOr(options.packet_name) ||
                stringOr(meta?.assembly?.packet?.path);
            const default_packet_name = show_draft_marking
                ? `${record.record_id}_DRAFT-filing.pdf`
                : `${record.record_id}_filing.pdf`;
            const packet_name = explicit_packet_name || default_packet_name;

            this._trace(`--- Packet Output ---`);
            this._trace(
                `  options.packet_name: ${options.packet_name ?? "(unset)"}`
            );
            this._trace(
                `  meta.assembly.packet.path: ${
                    meta?.assembly?.packet?.path ?? "(unset)"
                }`
            );
            this._trace(`  → packetName: "${packet_name}"`);

            const out_path = join(record.abs_path, packet_name);

            if (!options.overwrite && existsSync(out_path)) {
                return { success: false, error: "Packet already exists" };
            }

            mkdirSync(dirname(out_path), { recursive: true });
            writeFileSync(out_path, result.renderResult.output);

            const hash = createHash("sha256")
                .update(result.renderResult.output)
                .digest("hex");

            return {
                success: true,
                outputPath: out_path,
                rel_path: packet_name,
                hash: hash
            };
        } else {
            return {
                success: false,
                error: "Rendering failed",
                details: result.errors
            };
        }
    }

    // =========================================================================
    // Source loading
    // =========================================================================

    /**
     * @param {RecordInfo} record
     * @param {PackEntry[]} pack_entries
     * @param {ResolvedPacketConfig} pkt_cfg
     * @param {string} entity_name
     * @param {import("../types/general.mjs").RulesetRender | null} base_config
     * @param {boolean} disable_soft_wrap
     * @param {RenderPack} render_pack
     * @returns {Array<{ id: string, name: string, root: any, metadata: Metadata, headerTitle: string, header_name: string | null, variables: Metadata, break_mode: string | null, horizontal_rule_behavior: string | null; exlude_from_toc?: boolean; is_image_page?: boolean; }>}
     * @private
     */
    _loadSources(
        record,
        pack_entries,
        pkt_cfg,
        entity_name,
        base_config,
        disable_soft_wrap,
        render_pack
    ) {
        const sources = [];

        for (let i = 0, len = pack_entries.length; i < len; i++) {
            const entry = pack_entries[i];
            const full_path = join(record.abs_path, entry.path);
            const extension = extname(entry.path).toLowerCase();

            if (this._isImagePackEntry(entry, extension)) {
                const src = this._createImageRenderSource(entry, full_path, i);
                const header_title = this._buildHeaderTitle(
                    src.name,
                    entity_name,
                    pkt_cfg
                );

                sources.push({
                    ...src,
                    headerTitle: header_title,
                    break_mode: "always",
                    horizontal_rule_behavior: null
                });

                this._trace(
                    `  loaded image source: "${entry.path}" → display="${src.name}"`
                );
                continue;
            }

            const doc = Document.loadIfExists(full_path);
            if (!doc) {
                continue;
            }

            const src = doc.toRenderSource(
                render_pack,
                entry,
                record.rel_path,
                { disable_soft_wrap }
            );

            // Fall back to base_config (PACKET-level) for break_mode / hr if the
            // per-document doc_config produced nothing.
            const break_mode =
                src.break_mode ||
                enumOr(base_config?.break_mode, ["always", "part-only"], "") ||
                null;

            const horizontal_rule_behavior =
                src.horizontal_rule_behavior ??
                stringOr(base_config?.horizontal_rule?.behavior) ??
                null;

            const header_title = this._buildHeaderTitle(
                src.name,
                entity_name,
                pkt_cfg
            );

            sources.push({
                ...src,
                headerTitle: header_title,
                break_mode,
                horizontal_rule_behavior
            });

            this._trace(
                `  loaded source: "${entry.path}" → display="${src.name}" headerTitle="${header_title}"`
            );
        }

        return sources;
    }

    /**
     * @param {PackEntry} entry
     * @param {string} extension
     * @returns {boolean}
     * @private
     */
    _isImagePackEntry(entry, extension) {
        if (entry.doc_type === "IMG") {
            return true;
        }

        return (
            extension === ".png" ||
            extension === ".jpg" ||
            extension === ".jpeg"
        );
    }

    /**
     * @param {PackEntry} entry
     * @param {string} full_path
     * @param {number} index
     * @returns {{ id: string, name: string, root: any, metadata: Metadata, header_name: string | null, variables: Metadata, excludeFromToc: boolean, isImagePage: boolean }}
     * @private
     */
    _createImageRenderSource(entry, full_path, index) {
        const image_name =
            stringOr(entry.label) ||
            stringOr(entry.short_label) ||
            basename(entry.path, extname(entry.path));

        const source_id = `image-${index + 1}-${basename(
            entry.path,
            extname(entry.path)
        )}`
            .replace(/[^A-Za-z0-9_-]+/g, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "")
            .toLowerCase();

        return {
            id: source_id,
            name: image_name,
            root: {
                type: "container",
                id: `${source_id}-root`,
                attrs: {},
                children: [
                    {
                        type: "image",
                        id: `${source_id}-image`,
                        attrs: {
                            src: full_path,
                            alt: "",
                            fullPage: true,
                            width: 468,
                            height: 648
                        },
                        children: []
                    }
                ]
            },
            metadata: {},
            header_name: null,
            variables: {},
            excludeFromToc: true,
            isImagePage: true
        };
    }
    // =========================================================================
    // Cover override merging
    // =========================================================================

    /**
     * @param {any} meta
     * @param {any} options
     * @param {string} document_kind
     * @returns {string}
     * @private
     */
    _resolvePacketVariantId(meta, options, document_kind) {
        const from_cli = stringOr(options?.packet_variant);
        if (from_cli) {
            return from_cli;
        }

        const from_meta =
            stringOr(meta?.assembly?.packet?.variant) ||
            stringOr(meta?.extensions?.formatting?.packet_variant);
        if (from_meta) {
            return from_meta;
        }

        return stringOr(document_kind) || "default";
    }

    /**
     * @param {any} pkt_cfg
     * @param {string} packet_variant_id
     * @param {string} document_kind
     * @returns {any | null}
     * @private
     */
    _resolvePacketVariantConfig(pkt_cfg, packet_variant_id, document_kind) {
        const variants = pkt_cfg?.packet_variants;
        if (!isObject(variants)) {
            return null;
        }

        const direct = variants[packet_variant_id];
        if (isObject(direct)) {
            return direct;
        }

        const kind = variants[document_kind];
        if (isObject(kind)) {
            return kind;
        }

        const def = variants.default;
        if (isObject(def)) {
            return def;
        }

        return null;
    }

    /**
     * @param {any | null} packet_variant_cfg
     * @returns {boolean}
     * @private
     */
    _resolveIncludeCover(packet_variant_cfg) {
        if (isObject(packet_variant_cfg)) {
            if (packet_variant_cfg.include_cover === false) {
                return false;
            }
            if (packet_variant_cfg.cover === false) {
                return false;
            }
        }
        return true;
    }

    /**
     * @param {any | null} packet_variant_cfg
     * @param {Array<any>} sources
     * @returns {boolean}
     * @private
     */
    _resolveIncludeToc(
        packet_variant_cfg,
        sources,
        document_kind,
        document_title,
        meta
    ) {
        if (isObject(packet_variant_cfg)) {
            if (packet_variant_cfg.include_toc === false) {
                return false;
            }
            if (packet_variant_cfg.toc === false) {
                return false;
            }
            if (packet_variant_cfg.include_toc === true) {
                return true;
            }
        }

        if (
            this._looksLikeShortFormDocument(
                document_kind,
                document_title,
                meta
            )
        ) {
            return false;
        }

        if (isArray(sources) && sources.length <= 1) {
            return false;
        }

        return true;
    }

    /**
     * Heuristic: short-form docs (e.g. NDA / notices) should not get a TOC.
     *
     * @param {string} document_kind
     * @param {string} document_title
     * @param {Object} meta
     * @returns {boolean}
     * @private
     */
    _looksLikeShortFormDocument(document_kind, document_title, meta) {
        const kind_u = (stringOr(document_kind) || "").toUpperCase();
        const title_u = (stringOr(document_title) || "").toUpperCase();

        if (kind_u.includes("NDA") || kind_u.includes("NONDISCLOSURE")) {
            return true;
        }
        if (
            kind_u.includes("NON-DISCLOSURE") ||
            kind_u.includes("CONFIDENTIALITY")
        ) {
            return true;
        }

        if (title_u.includes(" NDA") || title_u.includes("NDA ")) {
            return true;
        }
        if (title_u.includes("NONDISCLOSURE")) {
            return true;
        }
        if (
            title_u.includes("NON-DISCLOSURE") ||
            title_u.includes("NON DISCLOSURE")
        ) {
            return true;
        }
        if (title_u.includes("CONFIDENTIALITY AGREEMENT")) {
            return true;
        }

        // meta-driven override: meta.assembly.packet.cover.cover_variant: "short"
        const meta_cover =
            this._cover_page_generator.extractMetaCoverOverrides(meta);
        const cover_variant_u = (
            stringOr(meta_cover?.cover_variant) || ""
        ).toUpperCase();
        if (cover_variant_u === "SHORT" || cover_variant_u === "NDA") {
            return true;
        }

        const fmt_variant_u = (
            stringOr(meta?.extensions?.formatting?.cover?.cover_variant) ||
            stringOr(meta?.extensions?.formatting?.cover?.variant) ||
            ""
        ).toUpperCase();
        if (fmt_variant_u === "SHORT" || fmt_variant_u === "NDA") {
            return true;
        }

        return false;
    }

    /**
     * Merge cover overrides from meta.assembly.packet.cover + CLI options.
     * CLI values win. Only non-empty values applied.
     *
     * @param {Object} meta
     * @param {Object} options
     * @returns {Metadata | undefined}
     * @private
     */
    _mergeCoverOverrides(meta, options, packet_variant_cfg) {
        const meta_cover =
            this._cover_page_generator.extractMetaCoverOverrides(meta);
        const variant = packet_variant_cfg?.cover_overrides;
        const cli = options?.cover_overrides;

        if (!meta_cover && !variant && !cli) {
            return undefined;
        }

        /** @type {Metadata} */
        const merged = { ...(isObject(meta_cover) ? meta_cover : {}) };

        if (isObject(variant)) {
            for (const key of Object.keys(variant)) {
                const v = variant[key];
                if (v === undefined || v === null) {
                    continue;
                }
                if (isString(v) && v.length === 0) {
                    continue;
                }
                merged[key] = v;
            }
        }

        if (isObject(cli)) {
            for (const key of Object.keys(cli)) {
                const v = cli[key];
                if (v === undefined || v === null) {
                    continue;
                }
                if (isString(v) && v.length === 0) {
                    continue;
                }
                merged[key] = v;
            }
        }

        return Object.keys(merged).length > 0 ? merged : undefined;
    }

    // =========================================================================
    // Dust cover resolution
    // =========================================================================

    /**
     * Resolve + preprocess an optional dust cover SVG.
     * The dust cover renders BEFORE the cover and is excluded from pagination.
     *
     * Supported sources (highest priority first):
     *   - CLI: options.dust_cover (boolean) / options.dust_cover_config
     *   - Meta: meta.assembly.packet.dust_cover OR meta.extensions.formatting.dust_cover
     *   - Packet variant: packet_variant_cfg.dust_cover (boolean) / .dust_cover_config
     *   - Pack defaults: pkt_cfg.dust_cover_config
     *   - Template: pkt_cfg.dust_cover_templates[template]
     *
     * Config fields:
     *   enabled, template, path, svg, cache_dir, allowed_font_hosts, verbose
     *
     * @param {RecordInfo} record
     * @param {any} meta
     * @param {any} pkt_cfg
     * @param {any | null} packet_variant_cfg
     * @param {any} options
     * @returns {any | null}
     * @private
     */
    _resolveDustCoverPage(record, meta, pkt_cfg, packet_variant_cfg, options) {
        const base = isObject(pkt_cfg?.dust_cover_config)
            ? pkt_cfg.dust_cover_config
            : {};

        const templates = isObject(pkt_cfg?.dust_cover_templates)
            ? pkt_cfg.dust_cover_templates
            : {};

        const variant_cfg = isObject(packet_variant_cfg)
            ? resolveObject(
                  packet_variant_cfg.dust_cover_config,
                  packet_variant_cfg.dust_cover
              )
            : null;

        const meta_raw =
            meta?.assembly?.packet?.dust_cover ??
            meta?.assembly?.packet?.dustCover ??
            meta?.extensions?.formatting?.dust_cover ??
            meta?.extensions?.formatting?.dustCover;

        const meta_cfg = isObject(meta_raw)
            ? meta_raw
            : isString(meta_raw)
            ? { path: meta_raw }
            : null;

        const cli_cfg = isObject(options?.dust_cover_config)
            ? options.dust_cover_config
            : null;

        const explicit_enabled =
            typeof options?.dust_cover === "boolean"
                ? options.dust_cover
                : isObject(meta_cfg) && typeof meta_cfg.enabled === "boolean"
                ? meta_cfg.enabled
                : isObject(packet_variant_cfg) &&
                  typeof packet_variant_cfg.dust_cover === "boolean"
                ? packet_variant_cfg.dust_cover
                : isObject(variant_cfg) &&
                  typeof variant_cfg.enabled === "boolean"
                ? variant_cfg.enabled
                : undefined;

        const template_id =
            stringOr(cli_cfg?.template) ||
            stringOr(meta_cfg?.template) ||
            stringOr(variant_cfg?.template) ||
            stringOr(base?.template) ||
            null;

        const template_cfg =
            template_id && isObject(templates[template_id])
                ? templates[template_id]
                : null;

        /** @type {Record<string, unknown>} */
        const merged = {};

        /**
         * @param {unknown} layer
         */
        const applyLayer = (layer) => {
            if (!isObject(layer)) {
                return;
            }
            for (const key of Object.keys(layer)) {
                const v = layer[key];
                if (v === undefined || v === null) {
                    continue;
                }
                if (isString(v) && v.length === 0) {
                    continue;
                }
                merged[key] = v;
            }
        };

        applyLayer(base);
        applyLayer(template_cfg);
        applyLayer(variant_cfg);
        applyLayer(meta_cfg);
        applyLayer(cli_cfg);

        const has_source =
            (isString(merged.svg) && merged.svg.trim().length > 0) ||
            (isString(merged.path) && merged.path.trim().length > 0);

        const enabled =
            explicit_enabled !== undefined
                ? explicit_enabled
                : has_source
                ? true
                : false;

        if (!enabled) {
            return null;
        }

        // Resolve SVG content.
        let svg_content =
            isString(merged.svg) && merged.svg.trim().length > 0
                ? merged.svg
                : null;

        const raw_path =
            svg_content === null && isString(merged.path) ? merged.path : null;

        if (svg_content === null && raw_path) {
            const trimmed = raw_path.trim();
            if (trimmed.startsWith("<svg") || trimmed.startsWith("<?xml")) {
                svg_content = trimmed;
            } else {
                const abs =
                    trimmed.startsWith("/") || /^[A-Za-z]:\\/.test(trimmed)
                        ? trimmed
                        : join(record.abs_path, trimmed);

                if (!existsSync(abs)) {
                    this._trace(
                        `  dust cover: missing SVG at "${trimmed}" (resolved "${abs}")`
                    );
                    return null;
                }

                svg_content = readFileSync(abs, "utf8");
            }
        }

        if (!svg_content || svg_content.trim().length === 0) {
            this._trace(`  dust cover: enabled but no SVG content`);
            return null;
        }

        const cache_dir =
            merged.cache_dir === null
                ? null
                : isString(merged.cache_dir)
                ? merged.cache_dir
                : ".solomon-font-cache";

        const allowed_hosts = Array.isArray(merged.allowed_font_hosts)
            ? /** @type {string[]} */ (merged.allowed_font_hosts)
            : ["fonts.googleapis.com", "fonts.gstatic.com"];

        const verbose =
            typeof merged.verbose === "boolean" ? merged.verbose : false;

        try {
            return processDustCover(svg_content, {
                cacheDir: cache_dir,
                verbose: verbose || this._verbose,
                allowedFontHosts: allowed_hosts
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this._trace(`  dust cover: failed: ${message}`);
            return null;
        }
    }

    // =========================================================================
    // Header building (presentation-layer, specific to filing packets)
    // =========================================================================

    /**
     * @param {string} doc_name
     * @param {string} entity_name
     * @param {ResolvedPacketConfig} pkt_cfg
     * @returns {string}
     * @private
     */
    _buildHeaderTitle(doc_name, entity_name, pkt_cfg) {
        const prefix_regex = new RegExp(pkt_cfg.series_prefix);
        const clean_name = doc_name
            .replace(prefix_regex, "")
            .replace(/\.md$/i, "")
            .replace(/_/g, " ");

        if (pkt_cfg.header_title_format === "plain") {
            return clean_name;
        }

        if (clean_name.toLowerCase().includes(entity_name.toLowerCase())) {
            return clean_name;
        }

        return `${clean_name} of ${entity_name}`;
    }

    /**
     * @param {string} doc_name
     * @param {string} entity_name
     * @param {ResolvedPacketConfig} pkt_cfg
     * @returns {string}
     * @private
     */
    _buildHeaderDocName(doc_name, entity_name, pkt_cfg) {
        const prefix_regex = new RegExp(pkt_cfg.series_prefix);
        let clean_name = String(doc_name ?? "")
            .replace(prefix_regex, "")
            .replace(/\.md$/i, "")
            .replace(/_/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        if (!clean_name) {
            return "";
        }

        const escape_re = (/** @type {string} */ s) =>
            String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const ent = String(entity_name ?? "").trim();

        if (ent) {
            const of_re = new RegExp(`\\s+of\\s+${escape_re(ent)}\\s*$`, "i");
            clean_name = clean_name.replace(of_re, "").trim();

            const dash_ent_re = new RegExp(
                `\\s*[-–—]\\s*${escape_re(ent)}\\s*$`,
                "i"
            );
            clean_name = clean_name.replace(dash_ent_re, "").trim();
        }

        return clean_name;
    }

    /**
     * @param {string} entity_name
     * @param {ResolvedPacketConfig} pkt_cfg
     * @returns {string}
     * @private
     */
    _buildLeftHeaderText(entity_name, pkt_cfg) {
        const ent = String(entity_name ?? "").trim();
        const raw = stringOr(pkt_cfg.header_text, "").trim();

        if (!raw) {
            return ent;
        }
        if (ent && raw.toLowerCase().includes(ent.toLowerCase())) {
            return raw;
        }
        if (/[-–—]\s*$/.test(raw)) {
            return `${raw} ${ent}`.trim();
        }
        return ent ? `${raw} - ${ent}` : raw;
    }

    // =========================================================================
    // Trace helpers
    // =========================================================================

    /**
     * @param {RecordInfo} record
     * @param {Object} meta
     * @param {ResolvedPacketConfig} pkt_cfg
     * @private
     */
    _traceGenerateHeader(record, meta, pkt_cfg) {
        this._trace(`=== FilingPacketGenerator.generate() ===`);
        this._trace(`record: ${record.record_id} (${record.rel_path})`);
        this._trace(`meta.title: ${meta.title ?? "(unset)"}`);
        this._trace(`meta.status.phase: ${meta.status?.phase ?? "(unset)"}`);
        this._trace(
            `meta has assembly.pack: ${Array.isArray(meta.assembly?.pack)} (${
                meta.assembly?.pack?.length ?? 0
            } entries)`
        );
        this._trace(
            `pktCfg resolved: default_entity_name=${pkt_cfg.default_entity_name} header_text=${pkt_cfg.header_text} section_page_break=${pkt_cfg.section_page_break}`
        );
        this._trace(
            `pktCfg cover_templates keys: ${
                Object.keys(pkt_cfg.cover_templates).join(", ") || "(empty)"
            }`
        );
        this._trace(
            `pktCfg cover_config: suppress_header=${pkt_cfg.cover_config.suppress_header} suppress_footer=${pkt_cfg.cover_config.suppress_footer} watermark.enabled=${pkt_cfg.cover_config.draft_watermark.enabled} watermark.text=${pkt_cfg.cover_config.draft_watermark.text}`
        );
    }

    /**
     * @param {PackEntry[]} pack_entries
     * @private
     */
    _tracePackEntries(pack_entries) {
        this._trace(`--- Pack Entries (${pack_entries.length}) ---`);
        for (let pi = 0, plen = pack_entries.length; pi < plen; pi++) {
            const pe = pack_entries[pi];
            this._trace(
                `  [${pi}] precedence=${pe.precedence} doc_type=${pe.doc_type} path=${pe.path}`
            );
        }
    }

    /**
     * @param {import("../types/general.mjs").RulesetRender | null} base_config
     * @private
     */
    _traceBaseConfig(base_config) {
        this._trace(`--- Adapter resolveForFile (PACKET/pdf) ---`);
        if (base_config) {
            this._trace(
                `  base_font_size: ${base_config.base_font_size ?? "(unset)"}`
            );
            this._trace(
                `  line_spacing: ${base_config.line_spacing ?? "(unset)"}`
            );
            this._trace(
                `  margins: ${
                    base_config.margins
                        ? JSON.stringify(base_config.margins)
                        : "(unset)"
                }`
            );
            this._trace(
                `  horizontal_rule: ${
                    base_config.horizontal_rule
                        ? JSON.stringify(base_config.horizontal_rule)
                        : "(unset)"
                }`
            );
            this._trace(
                `  toc: ${
                    base_config.toc
                        ? JSON.stringify(base_config.toc)
                        : "(unset)"
                }`
            );
            this._trace(
                `  spacing_policy: ${
                    base_config.spacing_policy ? "present" : "(unset)"
                }`
            );
            this._trace(
                `  cover_config: ${
                    base_config.cover_config
                        ? JSON.stringify(base_config.cover_config)
                        : "(unset)"
                }`
            );
        } else {
            this._trace(`  (null — no matching ruleset)`);
        }
    }

    /**
     * @param {CoverPageOptions} cover_render_config
     * @private
     */
    _traceCoverRenderConfig(cover_render_config) {
        this._trace(`--- Cover Render Config ---`);

        if (!cover_render_config) {
            this._trace(`  (cover disabled)`);
            return;
        }
        this._trace(
            `  suppress_header: ${cover_render_config.suppress_header}`
        );
        this._trace(
            `  suppress_footer: ${cover_render_config.suppress_footer}`
        );
        this._trace(
            `  suppress_page_numbering: ${cover_render_config.suppress_page_numbering}`
        );
        this._trace(
            `  reserve_header_footer_space: ${cover_render_config.reserve_header_footer_space}`
        );
        this._trace(
            `  watermark: ${JSON.stringify(cover_render_config.watermark)}`
        );
    }

    /**
     * @param {ResolvedSigningConfig | null} signing_resolved
     * @private
     */
    _traceSigningResolved(signing_resolved) {
        this._trace(`--- Signing Resolved ---`);

        if (!signing_resolved) {
            this._trace(`  (signing disabled)`);
            return;
        }
        this._trace(`  parties: ${signing_resolved.parties.length}`);
        for (
            let spi = 0, splen = signing_resolved.parties.length;
            spi < splen;
            spi++
        ) {
            const sp = signing_resolved.parties[spi];
            this._trace(
                `  party[${spi}] label="${sp.label}" signatories=${sp.signatories.length}`
            );
        }
    }

    /**
     * @param {{ parties: Array<{ label: string, signatories: unknown[] }> } | null} signing_page_config
     * @private
     */
    _traceSigningPageConfig(signing_page_config) {
        this._trace(`--- Signing Page Config ---`);

        if (!signing_page_config) {
            this._trace(`  (signing disabled)`);
            return;
        }

        this._trace(`  parties: ${signing_page_config.parties.length}`);
        for (
            let spi = 0, splen = signing_page_config.parties.length;
            spi < splen;
            spi++
        ) {
            const sp = signing_page_config.parties[spi];
            this._trace(
                `  party[${spi}] label="${sp.label}" signatories=${sp.signatories.length}`
            );
        }
    }
}
