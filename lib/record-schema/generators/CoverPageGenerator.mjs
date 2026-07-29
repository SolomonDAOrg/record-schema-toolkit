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
import {
    formatDateLong,
    formatStatusLabel,
    normalizeToDateString
} from "../util/formatting.mjs";

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

/** @typedef {import("../types/general.mjs").ResolvedCoverConfig} RendererCoverConfig */

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
     * @param {RendererCoverConfig} cover_render_config - Pre-resolved snake_case from RenderPack.resolveCoverConfig()
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

        const page_background =
            stringOr(
                cover_render_config?.cover_layout?.page_background?.color
            ) ??
            stringOr(
                cover_render_config?.cover_layout?.page_background?.fill_color
            ) ??
            stringOr(
                cover_render_config?.cover_layout?.page_background?.fill_color
            ) ??
            undefined;

        const page_frame = isObject(
            cover_render_config?.cover_layout?.page_frame
        )
            ? cover_render_config.cover_layout.page_frame
            : null;

        /** @type {CoverPageOptions} */
        const cover_options = {
            watermark: wm_config,
            suppress_header: cover_render_config?.suppress_header,
            suppress_footer: cover_render_config?.suppress_footer,
            suppress_page_numbering:
                cover_render_config?.suppress_page_numbering,
            reserve_header_footer_space:
                cover_render_config?.reserve_header_footer_space,
            background_color: page_background,
            page_frame: page_frame ?? undefined,
            font_roles: isObject(cover_render_config?.font_roles)
                ? cover_render_config.font_roles
                : undefined
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
                    effective_date: effective_date,
                    version,
                    status,
                    document_id: document_id
                },
                cover_render_config?.cover_layout
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
            stringOr(meta?.entity?.short_name) ??
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

        if (cover_variant === "foundation_constitution") {
            this._trace(
                `  → using foundation constitution cover template builder`
            );
            return {
                elements: this.buildFoundationConstitutionCoverElements(
                    {
                        title,
                        entity_name: effective_entity_name,
                        defined_term: this._resolveFoundationDefinedTerm(
                            short_name,
                            effective_entity_name
                        ),
                        descriptor:
                            subtitle && subtitle.length > 0
                                ? subtitle
                                : "A foundation company limited by shares",
                        effective_date: effective_date,
                        version,
                        status,
                        document_id: document_id
                    },
                    cover_render_config?.cover_layout
                ),
                options: cover_options
            };
        }

        if (cover_variant === "agreement") {
            this._trace(`  → using agreement cover template builder`);
            return {
                elements: this.buildMaCoverElements({
                    title,
                    subtitle,
                    short_name: short_name,
                    party_1:
                        party_1 ||
                        '[LEGAL NAME OF PARTY 1], a [jurisdiction/entity type] ("Party 1")',
                    party_2:
                        party_2 ||
                        '[LEGAL NAME OF PARTY 2], a [jurisdiction/entity type] ("Party 2")',
                    effective_date: effective_date,
                    version,
                    document_date: document_date,
                    document_id: document_id,
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
                        party_1: party_1,
                        party_2: party_2,
                        effective_date: effective_date,
                        version,
                        status,
                        document_date: document_date,
                        document_id: document_id,
                        confidentiality
                    },
                    cover_render_config?.cover_layout
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
                    cover_render_config?.cover_layout
                ),
                options: cover_options
            };
        }

        this._trace(`  → using generic cover template builder`);

        return {
            elements: this.buildGenericCoverElements(
                {
                    title,
                    subtitle,
                    entity_name: effective_entity_name,
                    effective_date: effective_date,
                    version,
                    status,
                    document_id: document_id
                },
                cover_render_config?.cover_layout
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
     * @returns {"agreement" | "company_agreement" | "short" | "generic" | "foundation_constitution"}
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

        if (this._looksLikeFoundationConstitution(kind_u, title_u)) {
            return "foundation_constitution";
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
     * @returns {"agreement" | "company_agreement" | "foundation_constitution" | "short" | "generic" | null}
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
        if (
            v === "foundation_constitution" ||
            v === "foundation-constitution" ||
            v === "foundation_company_constitution" ||
            v === "foundation-company-constitution" ||
            v === "cayman_foundation_constitution" ||
            v === "cayman-foundation-constitution"
        ) {
            return "foundation_constitution";
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
    _looksLikeFoundationConstitution(kind_u, title_u) {
        if (kind_u.includes("FOUNDATION") && kind_u.includes("CONSTITUTION")) {
            return true;
        }
        if (
            kind_u.includes("FOUNDATION COMPANY") &&
            kind_u.includes("MEMORANDUM") &&
            kind_u.includes("ARTICLES")
        ) {
            return true;
        }
        if (
            title_u.includes("FOUNDATION CONSTITUTION") ||
            title_u.includes("CONSTITUTION OF")
        ) {
            return true;
        }
        return false;
    }

    /**
     * @param {string} raw_title
     * @returns {string}
     * @private
     */
    _normalizeFoundationConstitutionTitle(raw_title) {
        const title_u = (stringOr(raw_title) || "").trim().toUpperCase();
        if (title_u.includes("FOUNDATION CONSTITUTION")) {
            return "FOUNDATION CONSTITUTION";
        }
        if (title_u === "CONSTITUTION") {
            return "FOUNDATION CONSTITUTION";
        }
        if (title_u.includes("CONSTITUTION OF")) {
            return "FOUNDATION CONSTITUTION";
        }
        return raw_title;
    }

    /**
     * @param {string} short_name
     * @param {string} entity_name
     * @returns {string}
     * @private
     */
    _resolveFoundationDefinedTerm(short_name, entity_name) {
        const short_trimmed = (stringOr(short_name) || "").trim();
        if (short_trimmed.length > 0) {
            const short_u = short_trimmed.toUpperCase();
            if (short_u === "FOUNDATION" || short_u.endsWith(" FOUNDATION")) {
                return "Foundation";
            }
            return short_trimmed;
        }

        const entity_u = (stringOr(entity_name) || "").trim().toUpperCase();
        if (entity_u.includes("FOUNDATION")) {
            return "Foundation";
        }

        return "Company";
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
     *  short_name: string,
     *  party_1: string,
     *  party_2: string,
     *  effective_date: string,
     *  version: string,
     *  document_date: string,
     *  document_id: string,
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

        if (d.short_name && d.short_name.length > 0) {
            elements.push({ type: "spacer", height: 6 });
            elements.push({
                type: "text",
                content: d.short_name,
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
            content: d.party_1,
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
            content: d.party_2,
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
                { label: "Effective Date", value: d.effective_date },
                { label: "Version", value: d.version },
                { label: "Document Date", value: d.document_date },
                { label: "Document ID", value: d.document_id }
            ],
            separator: ": ",
            column_gap: 12,
            label_align: "left",
            line_spacer: 10,
            style: { font_size: 10, align: "left", bold: false }
        });
        if (d.confidentiality && d.confidentiality.length > 0) {
            elements.push({ type: "spacer", height: 36 });
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
     *  party_1: string,
     *  party_2: string,
     *  effective_date: string,
     *  version: string,
     *  status: string,
     *  document_date: string,
     *  document_id: string,
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

        if (d.party_1 && d.party_1.length > 0) {
            rows.push({ label: "Party 1", value: d.party_1 });
        }
        if (d.party_2 && d.party_2.length > 0) {
            rows.push({ label: "Party 2", value: d.party_2 });
        }

        if (d.effective_date && d.effective_date.length > 0) {
            rows.push({ label: "Effective Date", value: d.effective_date });
        }
        if (d.document_date && d.document_date.length > 0) {
            rows.push({ label: "Document Date", value: d.document_date });
        }
        if (d.document_id && d.document_id.length > 0) {
            rows.push({ label: "Document ID", value: d.document_id });
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
     * @param {{ title: string, entity_name: string, defined_term: string, descriptor: string, effective_date: string, version: string, status: string, document_id: string }} d
     * @param {any} [cover_layout]
     * @returns {CoverPageElement[]}
     */
    buildFoundationConstitutionCoverElements(d, cover_layout) {
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

        const title_align =
            stringOr(title_block?.align) ??
            stringOr(title_block?.title_align) ??
            "center";
        const top_spacer =
            numberOr(title_block?.top_spacer) ??
            numberOr(title_block?.topSpacer) ??
            120;
        const title_font_size =
            numberOr(title_block?.title_font_size) ??
            numberOr(title_block?.titleFontSize) ??
            24;
        const conjunction_font_size =
            numberOr(title_block?.conjunction_font_size) ??
            numberOr(title_block?.conjunctionFontSize) ??
            numberOr(title_block?.subtitle_font_size) ??
            numberOr(title_block?.subtitleFontSize) ??
            11.5;
        const entity_font_size =
            numberOr(title_block?.entity_font_size) ??
            numberOr(title_block?.entityFontSize) ??
            21.5;
        const defined_term_font_size =
            numberOr(title_block?.defined_term_font_size) ??
            numberOr(title_block?.definedTermFontSize) ??
            numberOr(title_block?.parenthetical_font_size) ??
            numberOr(title_block?.parentheticalFontSize) ??
            12;
        const descriptor_font_size =
            numberOr(title_block?.descriptor_font_size) ??
            numberOr(title_block?.descriptorFontSize) ??
            conjunction_font_size;
        const after_title_block =
            numberOr(title_block?.after_spacer) ??
            numberOr(title_block?.afterSpacer) ??
            32;
        const title_color = stringOr(title_block?.title_color) ?? undefined;
        const conjunction_color =
            stringOr(title_block?.conjunction_color) ?? title_color;
        const entity_color = stringOr(title_block?.entity_color) ?? title_color;
        const defined_term_color =
            stringOr(title_block?.defined_term_color) ??
            stringOr(title_block?.definedTermColor) ??
            title_color;
        const descriptor_color =
            stringOr(title_block?.descriptor_color) ??
            stringOr(title_block?.descriptorColor) ??
            title_color;

        const clean_title = this._normalizeFoundationConstitutionTitle(d.title);
        const entity_name = (stringOr(d.entity_name) || "")
            .trim()
            .toUpperCase();
        const defined_term = (stringOr(d.defined_term) || "Foundation").trim();
        const descriptor = (stringOr(d.descriptor) || "").trim();

        elements.push({ type: "spacer", height: top_spacer });
        elements.push({
            type: "text",
            content: clean_title,
            style: {
                font_size: title_font_size,
                align: title_align,
                bold: true,
                color: title_color
            }
        });
        elements.push({ type: "spacer", height: 1 });
        elements.push({
            type: "text",
            content: "OF",
            style: {
                font_size: conjunction_font_size,
                align: title_align,
                bold: true,
                color: conjunction_color
            }
        });
        elements.push({ type: "spacer", height: 18 });
        elements.push({
            type: "text",
            content: entity_name,
            style: {
                font_size: entity_font_size,
                align: title_align,
                bold: true,
                color: entity_color
            }
        });
        elements.push({ type: "spacer", height: 8 });
        elements.push({
            type: "text",
            content: `(the "${defined_term}")`,
            style: {
                font_size: defined_term_font_size,
                align: title_align,
                bold: false,
                color: defined_term_color
            }
        });

        if (descriptor.length > 0) {
            elements.push({ type: "spacer", height: 9 });
            elements.push({
                type: "text",
                content: descriptor,
                style: {
                    font_size: descriptor_font_size,
                    align: title_align,
                    bold: false,
                    color: descriptor_color
                }
            });
        }

        elements.push({ type: "spacer", height: after_title_block });

        const rule_enabled =
            rule_cfg == null
                ? true
                : isBoolean(rule_cfg.enabled)
                ? rule_cfg.enabled
                : true;
        const rule_start_frac = numberOr(rule_cfg?.start_frac, 0.19);
        const rule_end_frac = numberOr(rule_cfg?.end_frac, 0.81);

        const meta_start_frac = numberOr(metadata?.start_frac, rule_start_frac);
        const meta_end_frac = numberOr(metadata?.end_frac, rule_end_frac);

        if (rule_enabled) {
            elements.push({
                type: "rule",
                start_frac: rule_start_frac,
                end_frac: rule_end_frac,
                line_width: numberOr(rule_cfg?.line_width) ?? 0.5,
                color: stringOr(rule_cfg?.color) ?? undefined,
                gray: numberOr(rule_cfg?.gray) ?? 0.5,
                height: 1
            });
            elements.push({
                type: "spacer",
                height: numberOr(rule_cfg?.after_spacer) ?? 24
            });
        } else {
            elements.push({ type: "spacer", height: 24 });
        }

        const meta_align =
            stringOr(metadata?.align) ??
            stringOr(metadata?.metadata_align) ??
            "left";
        const meta_font_size = numberOr(metadata?.font_size) ?? 10;
        const meta_spacer =
            numberOr(metadata?.line_spacer) ??
            numberOr(metadata?.lineSpacer) ??
            6;
        const sep =
            stringOr(metadata?.separator) ??
            stringOr(metadata?.label_value_separator) ??
            ": ";
        const label_color = stringOr(metadata?.label_color);
        const value_color = stringOr(metadata?.value_color);

        /** @type {ReadonlyArray<any>} */
        const fields_raw = isArray(metadata?.fields)
            ? metadata.fields
            : ["document_id", "version", "status", "effective_date"];

        const columns_enabled =
            metadata != null &&
            (metadata.layout === "columns" ||
                metadata.format === "columns" ||
                metadata.columns === true ||
                metadata.column_layout === true);

        const column_gap = numberOr(metadata?.column_gap) ?? 12;
        const label_align = stringOr(metadata?.label_align) ?? "left";

        /** @type {{ label: string, value: string, labelColor?: string, valueColor?: string }[]} */
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
                    : true;
            if (omit_if_empty && (!value || value.length === 0)) {
                continue;
            }

            const row_label_color =
                (isObject(f) &&
                    (stringOr(f.label_color) ?? stringOr(f.labelColor))) ||
                label_color ||
                undefined;
            const row_value_color =
                (isObject(f) &&
                    (stringOr(f.value_color) ?? stringOr(f.valueColor))) ||
                value_color ||
                undefined;

            if (columns_enabled) {
                rows.push({
                    label,
                    value,
                    labelColor: row_label_color,
                    valueColor: row_value_color
                });
                continue;
            }

            elements.push({
                type: "text",
                content: `${label}${sep}${value}`,
                style: {
                    font_size: meta_font_size,
                    align: meta_align,
                    bold: false,
                    color: row_value_color ?? row_label_color
                }
            });
            elements.push({ type: "spacer", height: meta_spacer });
        }

        if (columns_enabled && rows.length > 0) {
            elements.push({
                type: "kv-block",
                start_frac: meta_start_frac,
                end_frac: meta_end_frac,
                rows,
                separator: sep,
                column_gap,
                label_align,
                line_spacer: meta_spacer,
                style: {
                    font_size: meta_font_size,
                    align: meta_align,
                    bold: false,
                    color: value_color ?? label_color
                }
            });
        }

        if (
            elements.length > 0 &&
            elements[elements.length - 1].type === "spacer"
        ) {
            elements.pop();
        }

        if (this._verbose) {
            const types = elements.map((e) => e.type);
            this._trace(
                `  buildFoundationConstitutionCoverElements → ${
                    elements.length
                } elements: [${types.join(", ")}]`
            );
            this._trace(
                `  cleanTitle="${clean_title}" entity="${entity_name}" definedTerm="${defined_term}"`
            );
        }

        return elements;
    }

    /**
     * @param {{ effective_date: string, version: string, status: string, document_id: string, document_date?: string, confidentiality?: string, party_1?: string, party_2?: string }} d
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

        const rule_start_frac = rule.start_frac ?? 0.1;
        const rule_end_frac = rule.end_frac ?? 0.9;

        const metadata_start_frac =
            numberOr(metadata?.start_frac) ??
            numberOr(layout?.metadata_start_frac) ??
            rule_start_frac;

        const metadata_end_frac =
            numberOr(metadata?.start_frac) ??
            numberOr(layout?.metadata_start_frac) ??
            rule_end_frac;

        const metadata_column_gap =
            numberOr(metadata?.column_gap) ??
            numberOr(layout?.metadata_column_gap) ??
            12;

        const metadata_line_spacer =
            numberOr(metadata?.line_spacer) ??
            numberOr(layout?.metadata_line_spacer) ??
            10;

        const metadata_separator =
            stringOr(metadata?.separator) ??
            stringOr(layout?.metadata_separator) ??
            ": ";

        const metadata_fields = isArray(layout?.metadata_fields)
            ? layout.metadata_fields
            : ["document_id", "version", "status", "effective_date"];

        /** @type {CoverPageElement[]} */
        const out = [];

        if (rule && rule.include_before === true) {
            out.push({
                type: "rule",
                start_frac: rule_start_frac,
                end_frac: rule_end_frac
            });

            if (rule.after_spacer) {
                out.push({ type: "spacer", height: rule.after_spacer });
            }
        }

        /** @type {Array<{ label: string, value: string }>} */
        const rows = [];
        for (let i = 0, len = metadata_fields.length; i < len; i++) {
            const key = metadata_fields[i];
            if (key === "document_id")
                rows.push({ label: "Document ID", value: d.document_id });
            else if (key === "version")
                rows.push({ label: "Version", value: d.version });
            else if (key === "status")
                rows.push({ label: "Status", value: d.status });
            else if (key === "effective_date")
                rows.push({ label: "Effective Date", value: d.effective_date });
            else if (key === "document_date")
                rows.push({
                    label: "Document Date",
                    value: d.document_date || ""
                });
            else if (key === "confidentiality")
                rows.push({
                    label: "Confidentiality",
                    value: d.confidentiality || ""
                });
            else if (key === "party_1")
                rows.push({ label: "Party 1", value: d.party_1 || "" });
            else if (key === "party_2")
                rows.push({ label: "Party 2", value: d.party_2 || "" });
        }

        const filtered_rows = rows.filter((r) => r.value && r.value.length > 0);

        if (filtered_rows.length > 0) {
            out.push({
                type: "kv-block",
                start_frac: metadata_start_frac,
                end_frac: metadata_end_frac,
                rows: filtered_rows,
                separator: metadata_separator,
                column_gap: metadata_column_gap,
                label_align: "left",
                line_spacer: metadata_line_spacer,
                style: {
                    font_size: metadata_font_size,
                    align: metadata_align,
                    bold: false
                }
            });
        }

        if (rule && rule.include_after === true) {
            out.push({ type: "spacer", height: rule.after_spacer ?? 18 });
            out.push({
                type: "rule",
                start_frac: rule_start_frac,
                end_frac: rule_end_frac ?? 0.9
            });

            if (rule.after_spacer) {
                out.push({ type: "spacer", height: rule.after_spacer });
            }
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
        const rule_start_frac = numberOr(rule_cfg?.start_frac) ?? 0.2;
        const rule_end_frac = numberOr(rule_cfg?.end_frac) ?? 0.8;

        const meta_start_frac = numberOr(metadata?.start_frac, rule_start_frac);

        const meta_end_frac = numberOr(metadata?.end_frac, rule_end_frac);

        if (rule_enabled) {
            elements.push({
                type: "rule",
                start_frac: rule_start_frac,
                end_frac: rule_end_frac,
                line_width: numberOr(rule_cfg?.line_width) ?? 0.5,
                gray: numberOr(rule_cfg?.gray) ?? 0.5,
                height: 1
            });
            elements.push({
                type: "spacer",
                height: numberOr(rule_cfg?.after_spacer) ?? 25
            });
        } else {
            elements.push({ type: "spacer", height: 25 });
        }

        // Metadata
        const meta_align =
            stringOr(metadata?.align) ??
            stringOr(metadata?.metadata_align) ??
            "left";
        const meta_font_size = numberOr(metadata?.font_size) ?? 10;
        const meta_spacer = numberOr(metadata?.line_spacer) ?? 6;
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
                metadata.column_layout === true);

        const column_gap = numberOr(metadata?.column_gap) ?? 12;
        const label_align = stringOr(metadata?.label_align) ?? "left";

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
                start_frac: meta_start_frac,
                end_frac: meta_end_frac,
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
     * @param {{ title: string, subtitle?: string | null, entity_name: string, effective_date: string, version: string, status: string, document_id: string }} d
     * @param {any} [cover_layout]
     * @returns {CoverPageElement[]}
     */
    buildGenericCoverElements(d, cover_layout) {
        /** @type {CoverPageElement[]} */
        const elements = [];

        const layout = isObject(cover_layout) ? cover_layout : null;
        const page_panel =
            layout && isObject(layout.page_panel) ? layout.page_panel : null;
        const eyebrow =
            layout && isObject(layout.eyebrow) ? layout.eyebrow : null;
        const title_block =
            layout && isObject(layout.title_block) ? layout.title_block : null;
        const rule_cfg = layout && isObject(layout.rule) ? layout.rule : null;
        const metadata =
            layout && isObject(layout.metadata_block)
                ? layout.metadata_block
                : null;
        const footer_note =
            layout && isObject(layout.footer_note) ? layout.footer_note : null;

        const panel_enabled = isBoolean(page_panel?.enabled)
            ? page_panel.enabled
            : false;

        const top_spacer =
            numberOr(page_panel?.top_spacer) ??
            numberOr(title_block?.top_spacer) ??
            120;

        if (panel_enabled) {
            const panel_height = numberOr(page_panel?.height) ?? 620;
            const panel_start_frac = numberOr(page_panel?.start_frac) ?? 0.02;
            const panel_end_frac = numberOr(page_panel?.end_frac) ?? 0.98;
            const panel_fill =
                stringOr(page_panel?.fill_color) ??
                stringOr(page_panel?.background_color) ??
                undefined;
            const panel_border =
                stringOr(page_panel?.border_color) ?? undefined;
            const panel_line_width = numberOr(page_panel?.line_width) ?? 1;
            const panel_content_top_inset =
                numberOr(page_panel?.content_top_inset) ?? 42;
            const panel_after_spacer =
                numberOr(page_panel?.after_spacer) ??
                -(panel_height - panel_content_top_inset);

            elements.push({ type: "spacer", height: top_spacer });
            elements.push({
                type: "box",
                start_frac: panel_start_frac,
                end_frac: panel_end_frac,
                height: panel_height,
                line_width: panel_line_width,
                style: {
                    background_color: panel_fill,
                    border_color: panel_border
                }
            });

            if (panel_after_spacer !== 0) {
                elements.push({ type: "spacer", height: panel_after_spacer });
            }
        } else {
            elements.push({ type: "spacer", height: top_spacer });
        }

        const title_align =
            stringOr(title_block?.align) ??
            stringOr(title_block?.title_align) ??
            "center";
        const title_font_size = numberOr(title_block?.title_font_size) ?? 24;
        const subtitle_font_size =
            numberOr(title_block?.subtitle_font_size) ?? 12;
        const conjunction_font_size =
            numberOr(title_block?.conjunction_font_size) ?? 14;
        const entity_font_size = numberOr(title_block?.entity_font_size) ?? 20;
        const title_color = stringOr(title_block?.title_color) ?? undefined;
        const subtitle_color =
            stringOr(title_block?.subtitle_color) ?? undefined;
        const entity_color = stringOr(title_block?.entity_color) ?? title_color;
        const conjunction_color =
            stringOr(title_block?.conjunction_color) ?? title_color;
        const after_title_spacer =
            numberOr(title_block?.after_title_spacer) ?? 8;
        const after_subtitle_spacer =
            numberOr(title_block?.after_subtitle_spacer) ?? 12;
        const after_entity_spacer =
            numberOr(title_block?.after_entity_spacer) ??
            numberOr(title_block?.after_spacer) ??
            40;

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

        const subtitle = stringOr(d.subtitle) ?? "";

        const eyebrow_enabled = isBoolean(eyebrow?.enabled)
            ? eyebrow.enabled
            : false;
        const eyebrow_text = stringOr(eyebrow?.text) ?? "";
        if (eyebrow_enabled && eyebrow_text.length > 0) {
            elements.push({
                type: "text",
                content: eyebrow_text,
                style: {
                    font_size: numberOr(eyebrow?.font_size) ?? 10,
                    align: stringOr(eyebrow?.align) ?? title_align,
                    bold: true,
                    color: stringOr(eyebrow?.color) ?? title_color
                }
            });
            elements.push({
                type: "spacer",
                height: numberOr(eyebrow?.after_spacer) ?? 14
            });
        }

        if (include_conjunction_line) {
            elements.push({
                type: "title-block",
                title: d.title,
                conjunction: conjunction_text ?? undefined,
                entity_name: d.entity_name,
                style: {
                    font_size: title_font_size,
                    align: title_align,
                    bold: true,
                    color: title_color
                },
                subtitle_font_size: conjunction_font_size,
                entity_font_size: entity_font_size,
                conjunction_color: conjunction_color,
                entity_color: entity_color
            });
            elements.push({ type: "spacer", height: after_entity_spacer });
        } else {
            elements.push({
                type: "text",
                content: d.title,
                style: {
                    font_size: title_font_size,
                    align: title_align,
                    bold: true,
                    color: title_color
                }
            });
            elements.push({ type: "spacer", height: after_title_spacer });

            if (subtitle.length > 0) {
                elements.push({
                    type: "text",
                    content: subtitle,
                    style: {
                        font_size: subtitle_font_size,
                        align: title_align,
                        bold: false,
                        color: subtitle_color
                    }
                });
                elements.push({
                    type: "spacer",
                    height: after_subtitle_spacer
                });
            }

            if (isString(d.entity_name) && d.entity_name.trim().length > 0) {
                elements.push({
                    type: "text",
                    content: d.entity_name,
                    style: {
                        font_size: entity_font_size,
                        align: title_align,
                        bold: true,
                        color: entity_color
                    }
                });
                elements.push({
                    type: "spacer",
                    height: after_entity_spacer
                });
            }
        }

        const rule_enabled =
            rule_cfg == null
                ? true
                : isBoolean(rule_cfg.enabled)
                ? rule_cfg.enabled
                : true;

        const rule_start_frac = numberOr(rule_cfg?.start_frac, 0.25);
        const rule_end_frac = numberOr(rule_cfg?.end_frac, 0.75);

        const meta_start_frac = numberOr(metadata?.start_frac, rule_start_frac);

        const meta_end_frac = numberOr(metadata?.end_frac, rule_end_frac);

        if (rule_enabled) {
            /** @type {CoverPageElement} */
            const rule_el = {
                type: "rule",
                start_frac: rule_start_frac,
                end_frac: rule_end_frac,
                line_width: numberOr(rule_cfg?.line_width) ?? 0.5,
                color: stringOr(rule_cfg?.color) ?? undefined,
                gray: numberOr(rule_cfg?.gray) ?? 0.5,
                height: 1
            };
            elements.push(rule_el);
            elements.push({
                type: "spacer",
                height: numberOr(rule_cfg?.after_spacer) ?? 30
            });
        } else {
            elements.push({ type: "spacer", height: 30 });
        }

        const meta_align =
            stringOr(metadata?.align) ??
            stringOr(metadata?.metadata_align) ??
            "left";
        const meta_font_size = numberOr(metadata?.font_size) ?? 11;
        const meta_spacer =
            numberOr(metadata?.line_spacer) ??
            numberOr(metadata?.lineSpacer) ??
            10;
        const sep =
            stringOr(metadata?.separator) ??
            stringOr(metadata?.label_value_separator) ??
            ": ";
        const label_color = stringOr(metadata?.label_color);
        const value_color = stringOr(metadata?.value_color);

        /** @type {ReadonlyArray<any>} */
        const fields_raw = isArray(metadata?.fields)
            ? metadata.fields
            : ["document_id", "version", "status", "effective_date"];

        const columns_enabled =
            metadata != null &&
            (metadata.layout === "columns" ||
                metadata.format === "columns" ||
                metadata.columns === true ||
                metadata.column_layout === true);

        const column_gap = numberOr(metadata?.column_gap) ?? 12;
        const label_align = stringOr(metadata?.label_align) ?? "right";

        /** @type {{ label: string, value: string, labelColor?: string, valueColor?: string }[]} */
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
                    : true;
            if (omit_if_empty && (!value || value.length === 0)) {
                continue;
            }

            const row_label_color =
                (isObject(f) &&
                    (stringOr(f.label_color) ?? stringOr(f.labelColor))) ||
                label_color ||
                undefined;
            const row_value_color =
                (isObject(f) &&
                    (stringOr(f.value_color) ?? stringOr(f.valueColor))) ||
                value_color ||
                undefined;

            if (columns_enabled) {
                rows.push({
                    label,
                    value,
                    labelColor: row_label_color,
                    valueColor: row_value_color
                });
                continue;
            }

            elements.push({
                type: "text",
                content: `${label}${sep}${value}`,
                style: {
                    font_size: meta_font_size,
                    align: meta_align,
                    bold: false,
                    color: row_value_color ?? row_label_color
                }
            });
            elements.push({ type: "spacer", height: meta_spacer });
        }

        if (columns_enabled && rows.length > 0) {
            elements.push({
                type: "kv-block",
                start_frac: meta_start_frac,
                end_frac: meta_end_frac,
                rows,
                separator: sep,
                column_gap,
                label_align,
                line_spacer: meta_spacer,
                style: {
                    font_size: meta_font_size,
                    align: meta_align,
                    bold: false,
                    color: value_color ?? label_color
                }
            });
        }

        const footer_enabled = isBoolean(footer_note?.enabled)
            ? footer_note.enabled
            : false;
        const footer_text = stringOr(footer_note?.text) ?? "";
        if (footer_enabled && footer_text.length > 0) {
            elements.push({
                type: "spacer",
                height: numberOr(footer_note?.top_spacer) ?? 24
            });
            elements.push({
                type: "text",
                content: footer_text,
                style: {
                    font_size: numberOr(footer_note?.font_size) ?? 9,
                    align: stringOr(footer_note?.align) ?? meta_align,
                    bold: false,
                    color: stringOr(footer_note?.color) ?? value_color
                }
            });
        }

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
                } metadata=${metadata != null} panel=${panel_enabled}`
            );
        }

        return elements;
    }
}
