/**
 * CoverPageGenerator
 * Builds cover-page elements and extracts meta overrides.
 *
 * Cover config MERGING (packet_config.cover_config + profile + meta layers)
 * is handled by RenderPack.resolveCoverConfig(). This class only builds
 * elements and extracts field values from meta.
 *
 * @module generators/CoverPageGenerator
 */

import { text } from "node:stream/consumers";
import {
    isArray,
    isString,
    isBoolean,
    isDateTime,
    stringOr,
    boolOr,
    numberOr
} from "../../util/general.mjs";
import { isObject } from "../../util/objects.mjs";
import { formatDateLong, formatStatusLabel } from "../util/formatting.mjs";

/**
 * Strip the time portion from ISO datetime strings so formatDateLong
 * receives a plain YYYY-MM-DD value it can parse.
 * @param {string} raw
 * @returns {string}
 */
function normalizeToDateString(raw) {
    if (isDateTime(raw)) {
        return raw.slice(0, 10);
    }
    return raw;
}

/** @typedef {import("../types/general.mjs").Metadata} Metadata */
/** @typedef {import("../types/general.mjs").MetafileData} MetafileData */
/** @typedef {import("../types/general.mjs").MetaCoverFormat} MetaCoverFormat */
/** @typedef {import("../types/general.mjs").CoverTemplateEntry} CoverTemplateEntry */
/** @typedef {import("../Repository.mjs").RecordInfo} RecordInfo */
/** @typedef {import("../types/general.mjs").CoverPageConfig} CoverPageConfig */
/** @typedef {import("../types/general.mjs").CoverPageElement} CoverPageElement */
/** @typedef {import("../types/general.mjs").CoverPageOptions} CoverPageOptions */
/** @typedef {import("../types/general.mjs").HorizontalAlign} HorizontalAlign */

// =========================================================================
// Local Types
// =========================================================================

/**
 * Renderer-ready cover render config (camelCase, from adapter.coverConfigForRenderer()).
 * @typedef {Object} RendererCoverConfig
 * @property {boolean} [suppressHeader]
 * @property {boolean} [suppressFooter]
 * @property {boolean} [suppressPageNumbering]
 * @property {boolean} [reserveHeaderFooterSpace]
 * @property {Metadata} [watermark]
 * @property {Metadata} [coverLayout]
 */

export class CoverPageGenerator {
    /**
     * @param {{ trace?: (msg: string) => void, verbose?: boolean }} [opts]
     */
    constructor(opts) {
        /** @type {boolean} */
        this._verbose = opts?.verbose === true;
        /** @type {(msg: string) => void} */
        this._trace_fn =
            typeof opts?.trace === "function" ? opts.trace : () => {};
    }

    /**
     * @param {string} msg
     * @private
     */
    _trace(msg) {
        if (this._verbose) {
            this._trace_fn(msg);
        }
    }

    // =========================================================================
    // Overrides
    // =========================================================================

    /**
     * Normalize cover overrides to canonical snake_case keys.
     * Accepts legacy camelCase keys for backward compatibility.
     *
     * @param {unknown} value
     * @returns {Metadata | null}
     */
    normalizeCoverOverrides(value) {
        if (!isObject(value)) {
            return null;
        }

        /** @type {Metadata} */
        const out = {};

        const title = stringOr(value.title);
        if (title) {
            out.title = title;
        }

        const subtitle = stringOr(value.subtitle);
        if (subtitle) {
            out.subtitle = subtitle;
        }

        const entity_name =
            stringOr(value.entity_name) || stringOr(value.entityName);
        if (entity_name) {
            out.entity_name = entity_name;
        }

        const effective_date =
            stringOr(value.effective_date) || stringOr(value.effectiveDate);
        if (effective_date) {
            out.effective_date = effective_date;
        }

        const version = stringOr(value.version);
        if (version) {
            out.version = version;
        }

        const document_id =
            stringOr(value.document_id) || stringOr(value.documentId);
        if (document_id) {
            out.document_id = document_id;
        }

        const confidentiality = stringOr(value.confidentiality);
        if (confidentiality) {
            out.confidentiality = confidentiality;
        }

        const document_kind =
            stringOr(value.document_kind) || stringOr(value.documentKind);
        if (document_kind) {
            out.document_kind = document_kind;
        }

        const cover_variant =
            stringOr(value.cover_variant) ||
            stringOr(value.coverVariant) ||
            stringOr(value.cover_style) ||
            stringOr(value.coverStyle) ||
            stringOr(value.variant);
        if (cover_variant) {
            out.cover_variant = cover_variant;
        }

        const short_name =
            stringOr(value.short_name) || stringOr(value.shortName);
        if (short_name) {
            out.short_name = short_name;
        }

        const party_1 = stringOr(value.party_1) || stringOr(value.party1);
        if (party_1) {
            out.party_1 = party_1;
        }

        const party_2 = stringOr(value.party_2) || stringOr(value.party2);
        if (party_2) {
            out.party_2 = party_2;
        }

        const document_date =
            stringOr(value.document_date) || stringOr(value.documentDate);
        if (document_date) {
            out.document_date = document_date;
        }

        const notices = stringOr(value.notices);
        if (notices) {
            out.notices = notices;
        }

        const schedules = stringOr(value.schedules);
        if (schedules) {
            out.schedules = schedules;
        }

        const status = stringOr(value.status);
        if (status) {
            out.status = status;
        }

        const conjunction = stringOr(value.conjunction);
        if (conjunction) {
            out.conjunction = conjunction;
        }

        const include_of_line =
            boolOr(value.include_of_line) ?? boolOr(value.includeOfLine);
        if (include_of_line !== undefined) {
            out.include_of_line = include_of_line;
        }

        const no_watermark =
            boolOr(value.no_watermark) ?? boolOr(value.noWatermark);
        if (no_watermark === true) {
            out.no_watermark = no_watermark;
        } else {
            const watermark = boolOr(value.watermark);
            if (watermark === true) {
                out.watermark = watermark;
                const watermark_text =
                    stringOr(value.watermark_text) ??
                    stringOr(value.watermarkText);
                if (watermark_text) {
                    out.watermark_text = watermark_text;
                }
            }
        }

        const title_align =
            stringOr(value.title_align) || stringOr(value.titleAlign);
        if (title_align) {
            out.title_align = title_align;
        }

        const metadata_align =
            stringOr(value.metadata_align) || stringOr(value.metadataAlign);
        if (metadata_align) {
            out.metadata_align = metadata_align;
        }

        const metadata_font_size =
            numberOr(value.metadata_font_size) ??
            numberOr(value.metadataFontSize);
        if (metadata_font_size !== undefined) {
            out.metadata_font_size = metadata_font_size;
        }

        const metadata_fields = isArray(value.metadata_fields)
            ? value.metadata_fields
            : isArray(value.metadataFields)
            ? value.metadataFields
            : undefined;
        if (metadata_fields !== undefined) {
            out.metadata_fields = metadata_fields;
        }

        return Object.keys(out).length > 0 ? out : null;
    }

    /**
     * Extract cover page overrides from meta.assembly.packet.cover.
     *
     * @param {MetafileData} meta
     * @returns {Metadata | null}
     */
    extractMetaCoverOverrides(meta) {
        return this.normalizeCoverOverrides(
            meta?.assembly?.packet?.cover ?? null
        );
    }

    // =========================================================================
    // Cover Page Builder
    // =========================================================================

    /**
     * Build cover page configuration.
     *
     * @param {RecordInfo} record
     * @param {MetafileData} meta
     * @param {any} pkt_cfg - ResolvedPacketConfig from RenderPack
     * @param {string} entity_name
     * @param {Array<{ path: string, doc_type?: string | null }>} pack_entries
     * @param {string} document_kind
     * @param {RendererCoverConfig} cover_render_config - Pre-merged, camelCase from adapter
     * @param {Metadata | null} cover_overrides
     * @param {string} document_title - Pre-resolved via Metafile.determineDocumentTitle()
     * @returns {CoverPageConfig}
     */
    buildCoverPage(
        record,
        meta,
        pkt_cfg,
        entity_name,
        pack_entries,
        document_kind,
        cover_render_config,
        cover_overrides,
        document_title
    ) {
        /** @type {MetaCoverFormat | null} */
        const cover_fmt = isObject(meta?.extensions?.formatting?.cover)
            ? /** @type {MetaCoverFormat} */ (meta.extensions.formatting.cover)
            : null;

        const kind_template_raw = pkt_cfg.cover_templates?.[document_kind];
        /** @type {CoverTemplateEntry | null} */
        const kind_template = isObject(kind_template_raw)
            ? /** @type {CoverTemplateEntry} */ (kind_template_raw)
            : null;

        /** @type {CoverPageElement[]} */
        const template_elements = /** @type {CoverPageElement[]} */ (
            isArray(cover_fmt?.elements)
                ? cover_fmt.elements
                : isArray(kind_template?.elements)
                ? kind_template.elements
                : []
        );

        this._trace(`--- buildCoverPage ---`);
        this._trace(`  documentKind: "${document_kind}"`);
        this._trace(
            `  coverFmt from meta: ${cover_fmt ? "present" : "(null)"}`
        );
        this._trace(`  templateElements.length: ${template_elements.length}`);

        const wm_config = cover_overrides?.no_watermark
            ? { enabled: false }
            : cover_overrides?.watermark
            ? {
                  enabled: true,
                  text:
                      cover_overrides.watermark_text ??
                      cover_render_config?.watermark?.text ??
                      "DRAFT"
              }
            : cover_render_config?.watermark;

        this._trace(`  watermark: ${JSON.stringify(wm_config)}`);

        /** @type {CoverPageOptions} */
        const cover_options = {
            watermark: wm_config,
            suppress_header: cover_render_config?.suppressHeader,
            suppress_footer: cover_render_config?.suppressFooter,
            suppress_page_numbering: cover_render_config?.suppressPageNumbering,
            reserve_header_footer_space:
                cover_render_config?.reserveHeaderFooterSpace
        };

        // Extract field values from cover overrides → meta cover → meta fields → defaults
        const effective_date = this._resolveEffectiveDate(
            cover_overrides,
            cover_fmt,
            meta
        );
        const version = this._resolveVersion(cover_overrides, cover_fmt, meta);
        const document_id = this._resolveDocumentId(
            cover_overrides,
            cover_fmt,
            record
        );
        const status = this._resolveStatus(
            cover_overrides,
            cover_fmt,
            meta,
            wm_config
        );

        // Template path
        if (template_elements.length > 0) {
            const meta_elements = this.buildCoverMetadataElements(
                {
                    effectiveDate: effective_date,
                    version,
                    status,
                    documentId: document_id
                },
                cover_render_config?.coverLayout
            );

            let has_kv_block = false;
            for (let i = 0, len = template_elements.length; i < len; i++) {
                if (template_elements[i]?.type === "kv-block") {
                    has_kv_block = true;
                    break;
                }
            }

            /** @type {CoverPageElement[]} */
            const merged_elements = template_elements.slice();
            if (!has_kv_block && meta_elements.length > 0) {
                if (
                    merged_elements.length > 0 &&
                    merged_elements[merged_elements.length - 1].type !==
                        "spacer"
                ) {
                    merged_elements.push({ type: "spacer", height: 20 });
                }
                for (let i = 0, len = meta_elements.length; i < len; i++) {
                    merged_elements.push(meta_elements[i]);
                }
            }

            return { elements: merged_elements, options: cover_options };
        }

        // Dynamic cover path
        const title_raw =
            stringOr(cover_overrides?.title) ??
            stringOr(cover_fmt?.title) ??
            document_title;
        const title = title_raw.toUpperCase();

        const effective_entity_name =
            cover_overrides?.entity_name || entity_name;

        const subtitles_joined = isArray(cover_fmt?.subtitles)
            ? cover_fmt.subtitles.filter((s) => isString(s)).join(" / ")
            : undefined;
        const subtitle =
            stringOr(cover_overrides?.subtitle) ??
            stringOr(cover_fmt?.subtitle) ??
            subtitles_joined ??
            null;

        const short_name =
            stringOr(cover_overrides?.short_name) ??
            stringOr(cover_fmt?.short_name) ??
            "";
        const party_1 =
            stringOr(cover_overrides?.party_1) ??
            stringOr(cover_fmt?.party_1) ??
            "";
        const party_2 =
            stringOr(cover_overrides?.party_2) ??
            stringOr(cover_fmt?.party_2) ??
            "";

        const document_date_raw =
            stringOr(cover_overrides?.document_date) ??
            stringOr(cover_fmt?.document_date) ??
            stringOr(meta?.timeline?.drafted_at) ??
            null;
        const document_date = document_date_raw
            ? formatDateLong(normalizeToDateString(document_date_raw))
            : "[DD Month YYYY]";

        const confidentiality =
            stringOr(cover_overrides?.confidentiality) ??
            stringOr(cover_fmt?.confidentiality) ??
            "";

        const notices =
            stringOr(cover_overrides?.notices) ??
            stringOr(cover_fmt?.notices) ??
            "";
        const schedules =
            stringOr(cover_overrides?.schedules) ??
            stringOr(cover_fmt?.schedules) ??
            "";
        const cover_variant = this._resolveCoverVariant(
            cover_overrides,
            cover_fmt,
            document_kind,
            title_raw
        );

        if (cover_variant === "agreement") {
            this._trace(`  → using agreement cover template builder`);
            return {
                elements: this.buildMaCoverElements({
                    title,
                    subtitle,
                    shortName: short_name,
                    party1:
                        party_1 ||
                        '[LEGAL NAME OF PARTY 1], a [jurisdiction/entity type] ("Party 1")',
                    party2:
                        party_2 ||
                        '[LEGAL NAME OF PARTY 2], a [jurisdiction/entity type] ("Party 2")',
                    effectiveDate: effective_date,
                    version,
                    documentDate: document_date,
                    documentId: document_id,
                    confidentiality,
                    notices,
                    schedules
                }),
                options: cover_options
            };
        }

        if (cover_variant === "short") {
            this._trace(`  → using short cover template builder`);
            return {
                elements: this.buildShortCoverElements(
                    {
                        title,
                        subtitle,
                        party1: party_1,
                        party2: party_2,
                        effectiveDate: effective_date,
                        version,
                        status,
                        documentDate: document_date,
                        documentId: document_id,
                        confidentiality
                    },
                    cover_render_config?.coverLayout
                ),
                options: cover_options
            };
        }

        if (cover_variant === "company_agreement") {
            this._trace(`  → using company agreement cover template builder`);
            return {
                elements: this.buildCompanyAgreementCoverElements(
                    {
                        title,
                        entity_name: effective_entity_name,
                        effective_date: effective_date,
                        version,
                        status,
                        document_id: document_id
                    },
                    cover_render_config?.coverLayout
                ),
                options: cover_options
            };
        }

        this._trace(`  → using generic cover template builder`);

        return {
            elements: this.buildGenericCoverElements(
                {
                    title,
                    entity_name: effective_entity_name,
                    effective_date: effective_date,
                    version,
                    status,
                    document_id: document_id
                },
                cover_render_config?.coverLayout
            ),
            options: cover_options
        };
    }

    // =========================================================================
    // Cover variant inference
    // =========================================================================

    /**
     * Decide which dynamic cover builder to use.
     *
     * Only selects richer layouts when confidence is high.
     * Otherwise falls back to the generic cover.
     *
     * @param {Metadata | null} overrides
     * @param {MetaCoverFormat | null} cover_fmt
     * @param {string} document_kind
     * @param {string} title_raw
     * @returns {"agreement" | "company_agreement" | "short" | "generic"}
     * @private
     */
    _resolveCoverVariant(overrides, cover_fmt, document_kind, title_raw) {
        const explicit =
            stringOr(overrides?.cover_variant) ??
            stringOr(cover_fmt?.cover_variant);
        const explicit_norm = this._normalizeCoverVariant(explicit);
        if (explicit_norm) {
            return explicit_norm;
        }

        const kind_u = (stringOr(document_kind) || "").toUpperCase();
        const title_u = (stringOr(title_raw) || "").toUpperCase();

        if (this._looksLikeNda(kind_u, title_u)) {
            return "short";
        }

        if (this._looksLikeAgreement(kind_u, title_u)) {
            return "agreement";
        }

        if (this._looksLikeCompanyAgreement(kind_u, title_u)) {
            return "company_agreement";
        }

        return "generic";
    }

    /**
     * @param {string | null | undefined} raw
     * @returns {"agreement" | "company_agreement" | "short" | "generic" | null}
     * @private
     */
    _normalizeCoverVariant(raw) {
        const v = (stringOr(raw) || "").trim().toLowerCase();
        if (!v) {
            return null;
        }
        if (v === "short" || v === "short_form" || v === "short-form") {
            return "short";
        }
        if (v === "nda" || v === "nondisclosure" || v === "non-disclosure") {
            return "short";
        }
        if (v === "agreement" || v === "master" || v === "service") {
            return "agreement";
        }
        if (
            v === "company_agreement" ||
            v === "company-agreement" ||
            v === "operating_agreement" ||
            v === "operating-agreement" ||
            v === "company" ||
            v === "operating"
        ) {
            return "company_agreement";
        }
        if (v === "generic") {
            return "generic";
        }
        return null;
    }

    /**
     * @param {string} kind_u
     * @param {string} title_u
     * @returns {boolean}
     * @private
     */
    _looksLikeNda(kind_u, title_u) {
        if (kind_u.includes("NDA") || kind_u.includes("NONDISCLOSURE")) {
            return true;
        }
        if (
            kind_u.includes("NON-DISCLOSURE") ||
            kind_u.includes("DISCLOSURE")
        ) {
            // avoid accidental matches on "disclosure schedule" etc by requiring NDA-ish context
            if (kind_u.includes("NON") || kind_u.includes("NDA")) {
                return true;
            }
        }

        if (title_u === "NDA") {
            return true;
        }
        if (title_u.startsWith("NDA ")) {
            return true;
        }
        if (title_u.includes(" NDA")) {
            return true;
        }
        if (title_u.includes("NDA ")) {
            return true;
        }
        if (title_u.includes("NONDISCLOSURE")) {
            return true;
        }
        if (title_u.includes("NON-DISCLOSURE")) {
            return true;
        }
        if (title_u.includes("NON DISCLOSURE")) {
            return true;
        }
        if (title_u.includes("CONFIDENTIALITY AGREEMENT")) {
            return true;
        }

        return false;
    }

    /**
     * @param {string} kind_u
     * @param {string} title_u
     * @returns {boolean}
     * @private
     */
    _looksLikeAgreement(kind_u, title_u) {
        // Only opt into the richer agreement cover when we have strong signals.
        if (kind_u.includes("MASTER") && kind_u.includes("AGREEMENT")) {
            return true;
        }
        if (kind_u.includes("SERVICE") && kind_u.includes("AGREEMENT")) {
            return true;
        }
        if (kind_u.includes("SERVICES") && kind_u.includes("AGREEMENT")) {
            return true;
        }

        if (title_u.includes("MASTER") && title_u.includes("AGREEMENT")) {
            return true;
        }
        if (title_u.includes("SERVICE") && title_u.includes("AGREEMENT")) {
            return true;
        }
        if (title_u.includes("SERVICES") && title_u.includes("AGREEMENT")) {
            return true;
        }

        return false;
    }

    /**
     * @param {string} kind_u
     * @param {string} title_u
     * @returns {boolean}
     * @private
     */
    _looksLikeCompanyAgreement(kind_u, title_u) {
        if (kind_u.includes("COMPANY") && kind_u.includes("AGREEMENT")) {
            return true;
        }
        if (kind_u.includes("OPERATING") && kind_u.includes("AGREEMENT")) {
            return true;
        }
        if (
            kind_u === "COMPANY_AGREEMENT" ||
            kind_u === "OPERATING_AGREEMENT"
        ) {
            return true;
        }

        if (title_u.includes("COMPANY") && title_u.includes("AGREEMENT")) {
            return true;
        }
        if (title_u.includes("OPERATING") && title_u.includes("AGREEMENT")) {
            return true;
        }

        return false;
    }

    // =========================================================================
    // Field value resolution (cover overrides → meta cover → meta → default)
    // =========================================================================

    /**
     * @param {Metadata|null} overrides
     * @param {MetaCoverFormat|null} cover_fmt
     * @param {MetafileData} meta
     * @returns {string}
     * @private
     */
    _resolveEffectiveDate(overrides, cover_fmt, meta) {
        const raw =
            stringOr(overrides?.effective_date) ??
            stringOr(cover_fmt?.effective_date) ??
            stringOr(meta?.timeline?.drafted_at);
        return raw
            ? formatDateLong(normalizeToDateString(raw))
            : "[DD Month YYYY]";
    }

    /**
     * @param {Metadata|null} overrides
     * @param {MetaCoverFormat|null} cover_fmt
     * @param {MetafileData} meta
     * @returns {string}
     * @private
     */
    _resolveVersion(overrides, cover_fmt, meta) {
        return (
            stringOr(overrides?.version) ??
            stringOr(meta?.document?.version) ??
            stringOr(meta?.version) ??
            stringOr(cover_fmt?.version) ??
            ""
        );
    }

    /**
     * @param {Metadata|null} overrides
     * @param {MetaCoverFormat|null} cover_fmt
     * @param {RecordInfo} record
     * @returns {string}
     * @private
     */
    _resolveDocumentId(overrides, cover_fmt, record) {
        return (
            stringOr(overrides?.document_id) ??
            stringOr(cover_fmt?.document_id) ??
            (record.record_id || "DOC-[YYYY]-[###]")
        );
    }

    /**
     * @param {Metadata|null} overrides
     * @param {MetaCoverFormat|null} cover_fmt
     * @param {MetafileData} meta
     * @param {Metadata|undefined} wm_config
     * @returns {string}
     * @private
     */
    _resolveStatus(overrides, cover_fmt, meta, wm_config) {
        // meta.status is polymorphic: string | { phase: string }
        const meta_status = isString(meta?.status)
            ? meta.status
            : meta?.status?.phase;
        const raw =
            stringOr(overrides?.status) ??
            stringOr(cover_fmt?.status) ??
            stringOr(meta_status);
        if (raw) {
            return formatStatusLabel(raw);
        }
        return wm_config?.enabled
            ? formatStatusLabel(wm_config.text || "DRAFT")
            : "";
    }

    // =========================================================================
    // Element builders
    // =========================================================================

    /**
     * @param {{
     *  title: string,
     *  subtitle: string | null,
     *  shortName: string,
     *  party1: string,
     *  party2: string,
     *  effectiveDate: string,
     *  version: string,
     *  documentDate: string,
     *  documentId: string,
     *  confidentiality: string,
     *  notices: string,
     *  schedules: string
     * }} d
     * @returns {CoverPageElement[]}
     */
    buildMaCoverElements(d) {
        /** @type {CoverPageElement[]} */
        const elements = [];

        elements.push({ type: "spacer", height: 84 });
        elements.push({
            type: "text",
            content: d.title,
            style: { font_size: 28, align: "center", bold: true }
        });

        let has_subtitle = false;

        if (d.subtitle && d.subtitle.length > 0) {
            has_subtitle = true;
            elements.push({ type: "spacer", height: 10 });
            elements.push({
                type: "text",
                content: d.subtitle,
                style: {
                    font_size: 13,
                    align: "center",
                    italic: true,
                    bold: false
                }
            });
        }

        if (d.shortName && d.shortName.length > 0) {
            elements.push({ type: "spacer", height: 6 });
            elements.push({
                type: "text",
                content: d.shortName,
                style: {
                    font_size: has_subtitle ? 10 : 12,
                    align: "center",
                    bold: false
                }
            });
        }

        elements.push({ type: "spacer", height: 26 });
        elements.push({ type: "rule", start_frac: 0.1, end_frac: 0.9 });
        elements.push({ type: "spacer", height: 24 });

        elements.push({
            type: "text",
            start_frac: 0.1,
            end_frac: 0.9,
            content: "PARTIES",
            style: { font_size: 14, align: "left", bold: true }
        });
        elements.push({ type: "spacer", height: 8 });
        elements.push({
            type: "text",
            start_frac: 0.1,
            end_frac: 0.9,
            content: "Between",
            style: { font_size: 11, align: "left", bold: true }
        });
        elements.push({ type: "spacer", height: 4 });
        elements.push({
            type: "text",
            start_frac: 0.1,
            end_frac: 0.9,
            content: d.party1,
            style: { font_size: 11, align: "left", bold: false }
        });
        elements.push({ type: "spacer", height: 8 });
        elements.push({
            type: "text",
            start_frac: 0.1,
            end_frac: 0.9,
            content: "and",
            style: { font_size: 11, align: "left", bold: true }
        });
        elements.push({ type: "spacer", height: 4 });
        elements.push({
            type: "text",
            start_frac: 0.1,
            end_frac: 0.9,
            content: d.party2,
            style: { font_size: 11, align: "left", bold: false }
        });

        elements.push({ type: "spacer", height: 18 });
        elements.push({ type: "rule", start_frac: 0.1, end_frac: 0.9 });
        elements.push({ type: "spacer", height: 22 });

        elements.push({
            type: "kv-block",
            start_frac: 0.1,
            end_frac: 0.9,
            rows: [
                { label: "Effective Date", value: d.effectiveDate },
                { label: "Version", value: d.version },
                { label: "Document Date", value: d.documentDate },
                { label: "Document ID", value: d.documentId }
            ],
            separator: ": ",
            column_gap: 12,
            label_align: "left",
            line_spacer: 10,
            style: { font_size: 10, align: "left", bold: false }
        });
        if (d.confidentiality && d.confidentiality.length > 0) {
            elements.push({ type: "spacer", height: 26 });
            elements.push({
                type: "text",
                start_frac: 0.1,
                end_frac: 0.9,
                content: d.confidentiality,
                style: { font_size: 9, align: "left", bold: true }
            });
        }

        return elements;
    }

    /**
     * Short-form cover (e.g. NDA / short notices) — title + compact metadata.
     *
     * @param {{
     *  title: string,
     *  subtitle: string | null,
     *  party1: string,
     *  party2: string,
     *  effectiveDate: string,
     *  version: string,
     *  status: string,
     *  documentDate: string,
     *  documentId: string,
     *  confidentiality: string
     * }} d
     * @param {any} [cover_layout]
     * @returns {CoverPageElement[]}
     */
    buildShortCoverElements(d, cover_layout) {
        /** @type {CoverPageElement[]} */
        const elements = [];

        const layout = isObject(cover_layout) ? cover_layout : null;
        const title_align = stringOr(layout?.title_align, "center");

        elements.push({ type: "spacer", height: 84 });
        elements.push({
            type: "text",
            content: d.title,
            style: { font_size: 24, align: title_align, bold: true }
        });

        if (d.subtitle && d.subtitle.length > 0) {
            elements.push({ type: "spacer", height: 10 });
            elements.push({
                type: "text",
                content: d.subtitle,
                style: {
                    font_size: 12,
                    align: title_align,
                    italic: true,
                    bold: false
                }
            });
        }

        elements.push({ type: "spacer", height: 22 });

        /** @type {Array<{ label: string, value: string }>} */
        const rows = [];

        if (d.party1 && d.party1.length > 0) {
            rows.push({ label: "Party 1", value: d.party1 });
        }
        if (d.party2 && d.party2.length > 0) {
            rows.push({ label: "Party 2", value: d.party2 });
        }

        if (d.effectiveDate && d.effectiveDate.length > 0) {
            rows.push({ label: "Effective Date", value: d.effectiveDate });
        }
        if (d.documentDate && d.documentDate.length > 0) {
            rows.push({ label: "Document Date", value: d.documentDate });
        }
        if (d.documentId && d.documentId.length > 0) {
            rows.push({ label: "Document ID", value: d.documentId });
        }
        if (d.version && d.version.length > 0) {
            rows.push({ label: "Version", value: d.version });
        }
        if (d.status && d.status.length > 0) {
            rows.push({ label: "Status", value: d.status });
        }

        const filtered_rows = rows.filter((r) => r.value && r.value.length > 0);

        if (filtered_rows.length > 0) {
            elements.push({
                type: "kv-block",
                start_frac: 0.1,
                end_frac: 0.9,
                rows: filtered_rows,
                separator: ": ",
                column_gap: 12,
                label_align: "left",
                line_spacer: 10,
                style: { font_size: 10, align: "left", bold: false }
            });
        }

        if (d.confidentiality && d.confidentiality.length > 0) {
            elements.push({ type: "spacer", height: 26 });
            elements.push({
                type: "text",
                start_frac: 0.1,
                end_frac: 0.9,
                content: d.confidentiality,
                style: { font_size: 9, align: "left", bold: true }
            });
        }

        return elements;
    }

    /**
     * @param {{ effectiveDate: string, version: string, status: string, documentId: string, documentDate?: string, confidentiality?: string, party1?: string, party2?: string }} d
     * @param {any} [cover_layout]
     * @returns {CoverPageElement[]}
     */
    buildCoverMetadataElements(d, cover_layout) {
        const layout = isObject(cover_layout) ? cover_layout : null;
        const metadata =
            layout && isObject(layout.metadata_block)
                ? layout.metadata_block
                : null;
        const rule = layout && isObject(layout.rule) ? layout.rule : null;

        const metadata_align =
            stringOr(metadata?.align) ??
            stringOr(layout?.metadata_align) ??
            "center";

        const metadata_font_size =
            numberOr(metadata?.font_size) ??
            numberOr(layout?.metadata_font_size) ??
            10;

        const metadata_fields = isArray(layout?.metadata_fields)
            ? layout.metadata_fields
            : ["documentId", "version", "status", "effectiveDate"];

        /** @type {CoverPageElement[]} */
        const out = [];

        if (rule && rule.include_before === true) {
            out.push({ type: "rule", start_frac: 0.1, end_frac: 0.9 });
            out.push({ type: "spacer", height: 18 });
        }

        /** @type {Array<{ label: string, value: string }>} */
        const rows = [];
        for (let i = 0, len = metadata_fields.length; i < len; i++) {
            const key = metadata_fields[i];
            if (key === "documentId")
                rows.push({ label: "Document ID", value: d.documentId });
            else if (key === "version")
                rows.push({ label: "Version", value: d.version });
            else if (key === "status")
                rows.push({ label: "Status", value: d.status });
            else if (key === "effectiveDate")
                rows.push({ label: "Effective Date", value: d.effectiveDate });
            else if (key === "documentDate")
                rows.push({
                    label: "Document Date",
                    value: d.documentDate || ""
                });
            else if (key === "confidentiality")
                rows.push({
                    label: "Confidentiality",
                    value: d.confidentiality || ""
                });
            else if (key === "party1")
                rows.push({ label: "Party 1", value: d.party1 || "" });
            else if (key === "party2")
                rows.push({ label: "Party 2", value: d.party2 || "" });
        }

        const filtered_rows = rows.filter((r) => r.value && r.value.length > 0);

        if (filtered_rows.length > 0) {
            out.push({
                type: "kv-block",
                start_frac: 0.1,
                end_frac: 0.9,
                rows: filtered_rows,
                separator: ": ",
                column_gap: 12,
                label_align: "left",
                line_spacer: 10,
                style: {
                    font_size: metadata_font_size,
                    align: metadata_align,
                    bold: false
                }
            });
        }

        if (rule && rule.include_after === true) {
            out.push({ type: "spacer", height: 18 });
            out.push({ type: "rule", start_frac: 0.1, end_frac: 0.9 });
        }

        return out;
    }

    /**
     * Company / Operating Agreement cover.
     *
     * Strips the entity name suffix from the combined title when present
     * (e.g. "COMPANY AGREEMENT OF SOLOMON DAO LLC" → "COMPANY AGREEMENT")
     * and renders title + entity as separate blocks using cover_layout.
     *
     * @param {{ title: string, entity_name: string, effective_date: string, version: string, status: string, document_id: string }} d
     * @param {any} [cover_layout]
     * @returns {CoverPageElement[]}
     */
    buildCompanyAgreementCoverElements(d, cover_layout) {
        /** @type {CoverPageElement[]} */
        const elements = [];

        const layout = isObject(cover_layout) ? cover_layout : null;
        const title_block =
            layout && isObject(layout.title_block) ? layout.title_block : null;
        const rule_cfg = layout && isObject(layout.rule) ? layout.rule : null;
        const metadata =
            layout && isObject(layout.metadata_block)
                ? layout.metadata_block
                : null;

        const top_spacer =
            numberOr(title_block?.top_spacer) ??
            numberOr(title_block?.topSpacer) ??
            120;
        const title_align =
            stringOr(title_block?.align) ??
            stringOr(title_block?.title_align) ??
            "center";
        const title_font_size =
            numberOr(title_block?.title_font_size) ??
            numberOr(title_block?.titleFontSize) ??
            26;
        const entity_font_size =
            numberOr(title_block?.entity_font_size) ??
            numberOr(title_block?.entityFontSize) ??
            22;
        const after_title_spacer =
            numberOr(title_block?.after_spacer) ??
            numberOr(title_block?.afterSpacer) ??
            40;

        // Strip entity from combined title.
        // "COMPANY AGREEMENT OF SOLOMON DAO LLC" → "COMPANY AGREEMENT"
        let clean_title = d.title;
        if (isString(d.entity_name) && d.entity_name.trim().length > 0) {
            const entity_u = d.entity_name.trim().toUpperCase();
            const title_u = clean_title.toUpperCase();
            // Try " OF <entity>" first, then " – <entity>", " - <entity>",
            // bare " <entity>" suffix.
            const suffixes = [
                ` OF ${entity_u}`,
                ` – ${entity_u}`,
                ` - ${entity_u}`,
                ` ${entity_u}`
            ];
            for (let i = 0, len = suffixes.length; i < len; i++) {
                if (title_u.endsWith(suffixes[i])) {
                    clean_title = clean_title
                        .slice(0, clean_title.length - suffixes[i].length)
                        .trim();
                    break;
                }
            }
        }

        elements.push({ type: "spacer", height: top_spacer });

        // Title — always separate text element (no conjunction)
        elements.push({
            type: "text",
            content: clean_title,
            style: {
                font_size: title_font_size,
                align: title_align,
                bold: true
            }
        });

        // Entity name
        if (isString(d.entity_name) && d.entity_name.trim().length > 0) {
            elements.push({ type: "spacer", height: 12 });
            elements.push({
                type: "text",
                content: d.entity_name.toUpperCase(),
                style: {
                    font_size: entity_font_size,
                    align: title_align,
                    bold: true
                }
            });
        }

        elements.push({ type: "spacer", height: after_title_spacer });

        // Rule
        const rule_enabled =
            rule_cfg == null
                ? true
                : isBoolean(rule_cfg.enabled)
                ? rule_cfg.enabled
                : true;
        const rule_start_frac =
            numberOr(rule_cfg?.start_frac) ??
            numberOr(rule_cfg?.startFrac) ??
            0.2;
        const rule_end_frac =
            numberOr(rule_cfg?.end_frac) ?? numberOr(rule_cfg?.endFrac) ?? 0.8;

        if (rule_enabled) {
            elements.push({
                type: "rule",
                start_frac: rule_start_frac,
                end_frac: rule_end_frac,
                line_width:
                    numberOr(rule_cfg?.line_width) ??
                    numberOr(rule_cfg?.lineWidth) ??
                    0.5,
                gray: numberOr(rule_cfg?.gray) ?? 0.5,
                height: 1
            });
            elements.push({
                type: "spacer",
                height:
                    numberOr(rule_cfg?.after_spacer) ??
                    numberOr(rule_cfg?.afterSpacer) ??
                    25
            });
        } else {
            elements.push({ type: "spacer", height: 25 });
        }

        // Metadata
        const meta_align =
            stringOr(metadata?.align) ??
            stringOr(metadata?.metadata_align) ??
            "left";
        const meta_font_size =
            numberOr(metadata?.font_size) ?? numberOr(metadata?.fontSize) ?? 10;
        const meta_spacer =
            numberOr(metadata?.line_spacer) ??
            numberOr(metadata?.lineSpacer) ??
            6;
        const sep =
            stringOr(metadata?.separator) ??
            stringOr(metadata?.label_value_separator) ??
            ": ";

        /** @type {ReadonlyArray<any>} */
        const fields_raw = isArray(metadata?.fields)
            ? metadata.fields
            : ["document_id", "version", "status", "effective_date"];

        const columns_enabled =
            metadata != null &&
            (metadata.layout === "columns" ||
                metadata.format === "columns" ||
                metadata.columns === true ||
                metadata.column_layout === true ||
                metadata.columnLayout === true);

        const column_gap =
            numberOr(metadata?.column_gap) ??
            numberOr(metadata?.columnGap) ??
            12;
        const label_align =
            stringOr(metadata?.label_align) ??
            stringOr(metadata?.labelAlign) ??
            "left";

        /** @type {{ label: string, value: string }[]} */
        const rows = [];

        for (let i = 0, len = fields_raw.length; i < len; i++) {
            const f = fields_raw[i];
            const key = isString(f)
                ? f
                : isObject(f) && isString(f.key)
                ? f.key
                : null;
            if (!key) {
                continue;
            }

            const enabled =
                isObject(f) && isBoolean(f.enabled) ? f.enabled : true;
            if (!enabled) {
                continue;
            }

            const label =
                isObject(f) && isString(f.label)
                    ? f.label
                    : key === "document_id"
                    ? "Document ID"
                    : key === "effective_date"
                    ? "Effective Date"
                    : key === "document_date"
                    ? "Document Date"
                    : key === "version"
                    ? "Version"
                    : key === "status"
                    ? "Status"
                    : key;

            const value =
                key === "document_id"
                    ? d.document_id
                    : key === "effective_date"
                    ? d.effective_date
                    : key === "version"
                    ? d.version
                    : key === "status"
                    ? d.status
                    : "";

            const omit_if_empty =
                isObject(f) && isBoolean(f.omit_if_empty)
                    ? f.omit_if_empty
                    : isObject(f) && isBoolean(f.omitIfEmpty)
                    ? f.omitIfEmpty
                    : true;
            if (omit_if_empty && (!value || value.length === 0)) {
                continue;
            }

            if (columns_enabled) {
                rows.push({ label, value });
                continue;
            }

            elements.push({
                type: "text",
                content: `${label}${sep}${value}`,
                style: {
                    font_size: meta_font_size,
                    align: meta_align,
                    bold: false
                }
            });
            elements.push({ type: "spacer", height: meta_spacer });
        }

        if (columns_enabled && rows.length > 0) {
            elements.push({
                type: "kv-block",
                start_frac: rule_enabled ? rule_start_frac : 0,
                end_frac: rule_enabled ? rule_end_frac : 1,
                rows,
                separator: sep,
                column_gap,
                label_align,
                line_spacer: meta_spacer,
                style: {
                    font_size: meta_font_size,
                    align: meta_align,
                    bold: false
                }
            });
        }

        // Strip trailing spacer
        if (
            elements.length > 0 &&
            elements[elements.length - 1].type === "spacer"
        ) {
            elements.pop();
        }

        if (this._verbose) {
            const types = elements.map((e) => e.type);
            this._trace(
                `  buildCompanyAgreementCoverElements → ${
                    elements.length
                } elements: [${types.join(", ")}]`
            );
            this._trace(
                `  cleanTitle="${clean_title}" entity="${d.entity_name}"`
            );
        }

        return elements;
    }

    /**
     * @param {{ title: string, entity_name: string, effective_date: string, version: string, status: string, document_id: string }} d
     * @param {any} [cover_layout]
     * @returns {CoverPageElement[]}
     */
    buildGenericCoverElements(d, cover_layout) {
        /** @type {CoverPageElement[]} */
        const elements = [];

        const layout = isObject(cover_layout) ? cover_layout : null;
        const title_block =
            layout && isObject(layout.title_block) ? layout.title_block : null;
        const rule_cfg = layout && isObject(layout.rule) ? layout.rule : null;
        const metadata =
            layout && isObject(layout.metadata_block)
                ? layout.metadata_block
                : null;

        const top_spacer =
            numberOr(title_block?.top_spacer) ??
            numberOr(title_block?.topSpacer) ??
            120;
        const title_align =
            stringOr(title_block?.align) ??
            stringOr(title_block?.title_align) ??
            "center";
        const title_font_size =
            numberOr(title_block?.title_font_size) ??
            numberOr(title_block?.titleFontSize) ??
            24;
        const conjunction_font_size =
            numberOr(title_block?.conjunction_font_size) ??
            numberOr(title_block?.conjunctionFontSize) ??
            14;
        const entity_font_size =
            numberOr(title_block?.entity_font_size) ??
            numberOr(title_block?.entityFontSize) ??
            20;

        const include_conjunction_line = isBoolean(
            title_block?.include_conjunction_line
        )
            ? title_block.include_conjunction_line
            : isBoolean(title_block?.includeConjunctionLine)
            ? title_block.includeConjunctionLine
            : true;

        const conjunction_text = include_conjunction_line
            ? stringOr(title_block?.conjunction_text) ??
              stringOr(title_block?.conjunctionText) ??
              "OF"
            : null;

        const after_title_spacer =
            numberOr(title_block?.after_spacer) ??
            numberOr(title_block?.afterSpacer) ??
            40;

        elements.push({ type: "spacer", height: top_spacer });

        if (include_conjunction_line) {
            elements.push({
                type: "title-block",
                title: d.title,
                conjunction: conjunction_text ?? undefined,
                entity_name: d.entity_name,
                style: {
                    font_size: title_font_size,
                    align: title_align,
                    bold: true
                },
                subtitle_font_size: conjunction_font_size,
                entity_font_size: entity_font_size
            });
        } else {
            elements.push({
                type: "text",
                content: d.title,
                style: {
                    font_size: title_font_size,
                    align: title_align,
                    bold: true
                }
            });
            if (isString(d.entity_name) && d.entity_name.trim().length > 0) {
                elements.push({ type: "spacer", height: 12 });
                elements.push({
                    type: "text",
                    content: d.entity_name,
                    style: {
                        font_size: entity_font_size,
                        align: title_align,
                        bold: true
                    }
                });
            }
        }

        elements.push({ type: "spacer", height: after_title_spacer });

        // Rule
        const rule_enabled =
            rule_cfg == null
                ? true
                : isBoolean(rule_cfg.enabled)
                ? rule_cfg.enabled
                : true;

        const rule_start_frac =
            numberOr(rule_cfg?.start_frac) ??
            numberOr(rule_cfg?.startFrac) ??
            0.25;
        const rule_end_frac =
            numberOr(rule_cfg?.end_frac) ?? numberOr(rule_cfg?.endFrac) ?? 0.75;

        if (rule_enabled) {
            /** @type {CoverPageElement} */
            const rule_el = {
                type: "rule",
                start_frac: rule_start_frac,
                end_frac: rule_end_frac,
                line_width:
                    numberOr(rule_cfg?.line_width) ??
                    numberOr(rule_cfg?.lineWidth) ??
                    0.5,
                gray: numberOr(rule_cfg?.gray) ?? 0.5,
                height: 1
            };
            elements.push(rule_el);
            elements.push({
                type: "spacer",
                height:
                    numberOr(rule_cfg?.after_spacer) ??
                    numberOr(rule_cfg?.afterSpacer) ??
                    30
            });
        } else {
            elements.push({ type: "spacer", height: 30 });
        }

        // Metadata
        const meta_align =
            stringOr(metadata?.align) ??
            stringOr(metadata?.metadata_align) ??
            "left";
        const meta_font_size =
            numberOr(metadata?.font_size) ?? numberOr(metadata?.fontSize) ?? 11;
        const meta_spacer =
            numberOr(metadata?.line_spacer) ??
            numberOr(metadata?.lineSpacer) ??
            10;
        const sep =
            stringOr(metadata?.separator) ??
            stringOr(metadata?.label_value_separator) ??
            ": ";

        /** @type {ReadonlyArray<any>} */
        const fields_raw = isArray(metadata?.fields)
            ? metadata.fields
            : ["document_id", "version", "status", "effective_date"];

        const columns_enabled =
            metadata != null &&
            (metadata.layout === "columns" ||
                metadata.format === "columns" ||
                metadata.columns === true ||
                metadata.column_layout === true ||
                metadata.columnLayout === true);

        const column_gap =
            numberOr(metadata?.column_gap) ??
            numberOr(metadata?.columnGap) ??
            12;
        const label_align =
            stringOr(metadata?.label_align) ??
            stringOr(metadata?.labelAlign) ??
            "right";

        /** @type {{ label: string, value: string }[]} */
        const rows = [];

        for (let i = 0, len = fields_raw.length; i < len; i++) {
            const f = fields_raw[i];
            const key = isString(f)
                ? f
                : isObject(f) && isString(f.key)
                ? f.key
                : null;
            if (!key) {
                continue;
            }

            const enabled =
                isObject(f) && isBoolean(f.enabled) ? f.enabled : true;
            if (!enabled) {
                continue;
            }

            const label =
                isObject(f) && isString(f.label)
                    ? f.label
                    : key === "document_id"
                    ? "Document ID"
                    : key === "effective_date"
                    ? "Effective Date"
                    : key === "document_date"
                    ? "Document Date"
                    : key === "version"
                    ? "Version"
                    : key === "status"
                    ? "Status"
                    : key;

            const value =
                key === "document_id"
                    ? d.document_id
                    : key === "effective_date"
                    ? d.effective_date
                    : key === "version"
                    ? d.version
                    : key === "status"
                    ? d.status
                    : "";

            const omit_if_empty =
                isObject(f) && isBoolean(f.omit_if_empty)
                    ? f.omit_if_empty
                    : isObject(f) && isBoolean(f.omitIfEmpty)
                    ? f.omitIfEmpty
                    : true;
            if (omit_if_empty && (!value || value.length === 0)) {
                continue;
            }

            if (columns_enabled) {
                rows.push({ label, value });
                continue;
            }

            elements.push({
                type: "text",
                content: `${label}${sep}${value}`,
                style: {
                    font_size: meta_font_size,
                    align: meta_align,
                    bold: false
                }
            });
            elements.push({ type: "spacer", height: meta_spacer });
        }

        if (columns_enabled && rows.length > 0) {
            elements.push({
                type: "kv-block",
                start_frac: rule_enabled ? rule_start_frac : 0,
                end_frac: rule_enabled ? rule_end_frac : 1,
                rows,
                separator: sep,
                column_gap,
                label_align,
                line_spacer: meta_spacer,
                style: {
                    font_size: meta_font_size,
                    align: meta_align,
                    bold: false
                }
            });
        }

        // Strip trailing spacer
        if (
            elements.length > 0 &&
            elements[elements.length - 1].type === "spacer"
        ) {
            elements.pop();
        }

        if (this._verbose) {
            const types = elements.map((e) => e.type);
            this._trace(
                `  buildGenericCoverElements → ${
                    elements.length
                } elements: [${types.join(", ")}]`
            );
            this._trace(
                `  columnsEnabled=${columns_enabled} coverLayout=${
                    cover_layout != null
                } metadata=${metadata != null}`
            );
        }

        return elements;
    }
}
