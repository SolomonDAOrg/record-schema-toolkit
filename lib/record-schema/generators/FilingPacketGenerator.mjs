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

import { join, basename, extname } from "node:path";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import {
    createArticlePageBreakRule,
    createDocumentPipeline,
    createLegalKeepTogetherRule,
    createPartOnlyPartPageBreakRule
} from "../../ast/pipelines/DocumentPipeline.mjs";
import { createTwoPassPdfRenderer } from "../../ast/renderers/TwoPassPdfRenderer.mjs";
import { parseMarkdownDoc } from "../../parsing/markdown.mjs";
import { convertMarkdownToDocument } from "../../ast/converters/MarkdownToAstConverter.mjs";
import { Document } from "../Document.mjs";
import { CoverPageGenerator } from "./CoverPageGenerator.mjs";
import { SigningPageGenerator } from "./SigningPageGenerator.mjs";
import { isString, isArray, stringOr, enumOr } from "../../util/general.mjs";
import { hasNonNullishProperty, isObject } from "../../util/objects.mjs";

// =========================================================================
// Type Imports
// =========================================================================

/** @typedef {import("../types/general.mjs").Metadata} Metadata */
/** @typedef {import("../types/general.mjs").PackEntry} PackEntry */
/** @typedef {import("../Repository.mjs").Repository} Repository */
/** @typedef {import("../Repository.mjs").RecordInfo} RecordInfo */
/** @typedef {import("../../ast/adapters/RenderPackAdapter.mjs").RenderPackAdapter} RenderPackAdapter */
/** @typedef {import("../../ast/types/core.mjs").FormattingRule} FormattingRule */
/** @typedef {import("../IndManager.mjs").IndManager} IndManager */
/** @typedef {import("../RenderPack.mjs").RenderPack} RenderPack */
/** @typedef {import("../RenderPack.mjs").ResolvedPacketConfig} ResolvedPacketConfig */
/** @typedef {import("../../ast/types/core.mjs").VariableRef} VariableRef */
/** @typedef {import("../../ast/types/core.mjs").ResolvedRenderConfig} ResolvedRenderConfig */
/** @typedef {import("../../ast/types/core.mjs").CoverPageConfig} CoverPageConfig */
/** @typedef {import("../../ast/types/core.mjs").CoverPageOptions} CoverPageOptions */

export class FilingPacketGenerator {
    /**
     * @param {Repository} repo
     * @param {RenderPackAdapter} adapter
     * @param {IndManager} ind_manager
     * @param {RenderPack} render_pack
     * @param {boolean} [verbose]
     */
    constructor(repo, adapter, ind_manager, render_pack, verbose) {
        /** @type {Repository} */

        this._repo = repo;
        /** @type {RenderPackAdapter} */

        this._adapter = adapter;
        /** @type {IndManager} */
        this._ind_manager = ind_manager;

        /** @type {RenderPack} */
        this._render_pack = render_pack;

        /** @type {boolean} */
        this._verbose = verbose || false;

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
        const pkt_cfg = this._render_pack.getResolvedPacketConfig();

        this._traceGenerateHeader(record, meta, pkt_cfg);

        // 1. Pack entries (RenderPack owns resolution)
        const pack_entries = this._render_pack.resolvePackEntries(meta, {
            exclude_ind: options.exclude_ind
        });
        if (!Array.isArray(pack_entries)) {
            return pack_entries;
        }

        // 2. Entity name & document kind (RenderPack owns extraction)
        const entity_name =
            stringOr(options.cover_overrides?.entity_name) ??
            this._render_pack.extractEntityName(meta, pack_entries) ??
            pkt_cfg.default_entity_name;

        const document_kind =
            stringOr(options.cover_overrides?.document_kind) ||
            this._render_pack.resolveDocumentKind(meta, pack_entries);

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

        // 4. Base styling from adapter
        const base_config = this._adapter.resolveForFile({
            rel_path: record.rel_path,
            doc_type: "PACKET",
            ext: "pdf"
        });

        this._traceBaseConfig(base_config);

        // 5. Cover config — RenderPack merges, adapter converts
        const include_cover = this._resolveIncludeCover(packet_variant_cfg);
        const cover_resolved = include_cover
            ? this._render_pack.resolveCoverConfig(
                  meta,
                  base_config?.cover_config ?? null
              )
            : null;
        const cover_render_config = include_cover
            ? this._adapter.coverConfigForRenderer(cover_resolved)
            : null;

        this._traceCoverRenderConfig(cover_render_config);

        // 6. Load sources
        const sources = this._loadSources(
            record,
            pack_entries,
            pkt_cfg,
            entity_name,
            base_config,
            options.disable_soft_wrap
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
        const section_documents = sources.map((src) => ({
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
            ? this._adapter.coverPageForRenderer(
                  this._cover_page_generator.buildCoverPage(
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
              )
            : null;

        const toc_config = include_toc
            ? {
                  title: "TABLE OF CONTENTS",
                  levels: [1, 2, 3, 4],
                  sectionDocuments: section_documents
              }
            : null;

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
                headers: [
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
                        location: /** @type {"header" | "footer"} */ ("header")
                    }
                ],
                footers: undefined
            })),
            defaultPageConfig:
                base_config && base_config.margins
                    ? { margins: base_config.margins }
                    : {}
        };

        if (cover_page) {
            composition_config.coverPage = cover_page;
        }
        if (toc_config) {
            composition_config.toc = toc_config;
        }

        pipeline.setCompositionConfig(composition_config);

        // 10. Signing page — RenderPack resolves, SPG normalizes, adapter converts
        //     Priority: CLI > meta.assembly.packet.signing_page > packet variant.
        //     Meta signing_page replaces (not merges) the pack config so that
        //     intentionally blank signatory values survive.
        const meta_signing_page = isObject(meta?.assembly?.packet?.signing_page)
            ? meta.assembly.packet.signing_page
            : undefined;

        const signing_resolved = this._render_pack.resolveSigningConfig({
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

        /** @type {import("../../ast/renderers/TwoPassPdfRenderer.mjs").SigningPageConfig | null} */
        const signing_page_config = signing_resolved
            ? this._adapter.signingConfigForRenderer(
                  this._signing_page_generator.normalizeParties(
                      signing_resolved
                  )
              )
            : null;

        this._traceSigningPageConfig(signing_page_config);

        // 11. Renderer
        /** @type {VariableRef} */
        const page_var = { type: "variable", name: "page" };

        /** @type {VariableRef} */
        const total_var = { type: "variable", name: "totalPages" };

        const is_draft =
            cover_page != null &&
            hasNonNullishProperty(cover_page, "options") &&
            cover_page.options.watermark.enabled === true;
        const draft_watermark_text = is_draft
            ? cover_page.options.watermark.text ?? "DRAFT"
            : null;

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

        const renderer = createTwoPassPdfRenderer({
            pageConfig: has_margins ? { margins: base_config.margins } : {},
            baseFontSize: base_font_size || 10,
            lineHeight: base_config?.line_spacing ?? 1.5,
            verbose: this._verbose,
            variables: {
                recordId: record.record_id,
                showIndInFooter: options.ind_in_footer ? "true" : "false",
                showIndInHeader: options.ind_in_header ? "true" : "false",
                entityName: entity_name
            },
            coverConfig: cover_render_config,
            signingPage: signing_page_config ?? undefined,
            defaultFooters: [
                {
                    pages: "all",
                    columns: {
                        ...(is_draft
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
                behavior: base_config?.horizontal_rule?.behavior ?? "rule"
            },
            table:
                base_config?.table ??
                base_config?.table_style ??
                base_config?.tableStyle,
            tocConfig: {
                levelStyles: this._adapter.normalizeTocLevelStyles(
                    base_config?.toc?.level_styles
                ) ?? {
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
                }
            },
            spacingPolicy:
                base_config?.spacing_policy ??
                this._render_pack.getDocumentPolicies()?.spacing_policy,
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
            const packet_name =
                stringOr(options.packet_name) ||
                stringOr(meta?.assembly?.packet?.path) ||
                `${record.record_id}_DRAFT-filing.pdf`;

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
     * @param {ResolvedRenderConfig | null} base_config
     * @param {boolean} disable_soft_wrap
     * @returns {Array<{ id: string, name: string, root: any, metadata: Metadata, headerTitle: string, header_name: string; variables: Metadata, break_mode: string|null, horizontal_rule_behavior: string|null }>}
     * @private
     */
    _loadSources(
        record,
        pack_entries,
        pkt_cfg,
        entity_name,
        base_config,
        disable_soft_wrap
    ) {
        const sources = [];

        for (let i = 0, len = pack_entries.length; i < len; i++) {
            const entry = pack_entries[i];
            const full_path = join(record.abs_path, entry.path);

            if (!existsSync(full_path)) {
                continue;
            }

            const content = readFileSync(full_path, "utf8");
            const ast = convertMarkdownToDocument(
                parseMarkdownDoc(
                    content,
                    disable_soft_wrap === true ? undefined : { softWrap: true }
                )
            );

            const doc = new Document(content, full_path);
            const metadata = doc.getMetadata()?.data || {};

            const raw_title = metadata.Title;
            const meta_title = isString(raw_title)
                ? raw_title
                : isArray(raw_title) && raw_title.length > 0
                ? raw_title[0]
                : null;
            const doc_display_name =
                entry.label ||
                meta_title ||
                this._render_pack.deriveDocumentName(entry.path) ||
                basename(entry.path, ".md");
            const header_display_name =
                entry.short_label != null ? entry.short_label : null;

            // console.log(entry);

            const rel_source_path = record.rel_path.endsWith("/")
                ? `${record.rel_path}${entry.path}`
                : `${record.rel_path}/${entry.path}`;
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
                    ? this._adapter.resolveForFile({
                          rel_path: rel_source_path,
                          doc_type: resolved_doc_type,
                          ext: src_ext || "md"
                      })
                    : null;

            const resolved_break_mode =
                enumOr(doc_config?.break_mode, ["always", "part-only"], "") ||
                enumOr(base_config?.break_mode, ["always", "part-only"], "") ||
                null;

            const resolved_hr_behavior =
                stringOr(doc_config?.horizontal_rule?.behavior) ??
                stringOr(base_config?.horizontal_rule?.behavior) ??
                null;

            this._trace(
                `  break_mode: doc_type=${
                    resolved_doc_type ?? "(unset)"
                } path=${entry.path} → ${resolved_break_mode ?? "always"}`
            );

            const header_title = this._buildHeaderTitle(
                doc_display_name,
                entity_name,
                pkt_cfg
            );

            sources.push({
                id: entry.path,
                name: doc_display_name,
                root: ast.root,
                metadata: metadata,
                headerTitle: header_title,
                header_name: header_display_name,
                variables: { break_mode: resolved_break_mode ?? "always" },
                break_mode: resolved_break_mode,
                horizontal_rule_behavior: resolved_hr_behavior
            });

            this._trace(
                `  loaded source: "${entry.path}" → display="${doc_display_name}" headerTitle="${header_title}"`
            );
        }

        return sources;
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
     * @param {ResolvedRenderConfig | null} base_config
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
        this._trace(`  suppressHeader: ${cover_render_config.suppressHeader}`);
        this._trace(`  suppressFooter: ${cover_render_config.suppressFooter}`);
        this._trace(
            `  suppressPageNumbering: ${cover_render_config.suppressPageNumbering}`
        );
        this._trace(
            `  reserveHeaderFooterSpace: ${cover_render_config.reserveHeaderFooterSpace}`
        );
        this._trace(
            `  watermark: ${JSON.stringify(cover_render_config.watermark)}`
        );
    }

    /**
     * @param {{ parties: Array<{ label: string, signatories: unknown[] }> } | null} signing_page_config
     * @private
     */
    _traceSigningPageConfig(signing_page_config) {
        if (!signing_page_config) {
            return;
        }
        this._trace(`--- Signing Page Config ---`);
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
