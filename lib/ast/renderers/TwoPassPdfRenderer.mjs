/**
 * TwoPassPdfRenderer - PDF renderer with two-pass architecture
 * Pass 1: Layout calculation (page breaks, keep-together, node→page map)
 * Pass 2: Actual rendering with resolved page numbers
 *
 * With:
 * - Table rendering with borders, headers, column widths
 * - Internal links (TOC, cross-references)
 * - External hyperlinks
 * - Inline formatting (bold, italic, underline within text)
 * - Image rendering
 *
 * @module format-ast/renderers/TwoPassPdfRenderer
 */

import {
    findMatchingHeaderFooter,
    resolveHeaderFooterContent
} from "../composers/DocumentComposer.mjs";
import { LayoutEngine } from "../layout/LayoutEngine.mjs";
import { existsSync, readFileSync } from "node:fs";
import {
    basename,
    extname,
    isAbsolute,
    resolve as resolvePath
} from "node:path";
import { PdfDocumentBuilder, measureTextWidth } from "../../pdf/document.mjs";
import { PdfContentStreamBuilder } from "../../pdf/content-stream.mjs";
import { layoutPlainText } from "../../pdf/text-layout.mjs";
import { PAGE_SIZES, DEFAULT_SPACING_BEFORE } from "../constants/core.mjs";
import { createPageBreak } from "../nodes/BaseNode.mjs";
import { isNumber, isString, numberOr, stringOr } from "../../util/general.mjs";
import {
    hasProperty,
    hasPropertyOfType,
    isObject
} from "../../util/objects.mjs";
import { applyTypographySubstitutions } from "../util/text.mjs";

import { renderSvgToPdf } from "./DustCoverRenderer.mjs";
import {
    GoogleFontFetcher,
    normaliseFontFamily,
    parseFontStyle,
    parseFontWeight
} from "../../util/GoogleFontFetcher.mjs";

/**
 * @typedef {import("../types/core.mjs").NodeType} NodeType
 * @typedef {import("../types/core.mjs").PageConfig} PageConfig
 * @typedef {import("../types/core.mjs").SectionConfig} SectionConfig
 * @typedef {import("../types/core.mjs").HeaderFooterColumnConfig} HeaderFooterColumnConfig
 * @typedef {import("../types/core.mjs").HeaderFooterConfig} HeaderFooterConfig
 * @typedef {import("../types/core.mjs").HeaderFooterElement} HeaderFooterElement
 * @typedef {import("../types/core.mjs").RenderCapabilities} RenderCapabilities
 * @typedef {import("../types/core.mjs").LayoutBlock} LayoutBlock
 * @typedef {import("../types/core.mjs").HorizontalAlign} HorizontalAlign
 * @typedef {import("../types/core.mjs").KeepRules} KeepRules
 * @typedef {import("../types/core.mjs").LayoutResult} LayoutResult
 * @typedef {import("../types/core.mjs").Padding} Padding
 * @typedef {import("../types/core.mjs").BoxPadding} BoxPadding
 * @typedef {import("../types/core.mjs").Margins} Margins
 * @typedef {import("../types/core.mjs").TextStyle} TextStyle
 * @typedef {import("../types/core.mjs").BoxStyle} BoxStyle
 * @typedef {import("../types/core.mjs").PageSelector} PageSelector
 * @typedef {import("../types/core.mjs").PageSelectorPredicate} PageSelectorPredicate
 * @typedef {import("../types/core.mjs").FontsConfig} FontsConfig
 * @typedef {import("../types/core.mjs").ColumnDef} ColumnDef
 * @typedef {import("../types/core.mjs").LinkAnnotation} LinkAnnotation
 * @typedef {import("../types/core.mjs").ComposedSection} ComposedSection
 * @typedef {import("../types/core.mjs").CoverPageNode} CoverPageNode
 * @typedef {import("./DustCoverRenderer.mjs").DustCoverPage} DustCoverPage
 * @typedef {import("../types/core.mjs").CoverPageOptions} CoverPageOptions
 * @typedef {import("../types/core.mjs").CoverRenderConfig} CoverRenderConfig
 * @typedef {import("../types/core.mjs").RenderResult} RenderResult
 * @typedef {import("../types/core.mjs").TocNode} TocNode
 * @typedef {import("../types/core.mjs").VariableRef} VariableRef
 * @typedef {import("../types/core.mjs").SpacingPolicy} SpacingPolicy
 * @typedef {import("../types/core.mjs").TocLevelStyle} TocLevelStyle
 * @typedef {import("../types/core.mjs").HorizontalRuleBehavior} HorizontalRuleBehavior
 * @typedef {import("../types/core.mjs").BreakMode} BreakMode
 * @typedef {import("../types/core.mjs").TableRenderConfig} TableRenderConfig
 * @typedef {import("../nodes/BaseNode.mjs").BaseNode} BaseNode
 * @typedef {import("../nodes/LegalNode.mjs").DefinitionNode} DefinitionNode
 * @typedef {import("../nodes/TabularNode.mjs").TableNode} TableNode
 * @typedef {import("../nodes/TabularNode.mjs").RowNode} RowNode
 * @typedef {import("../nodes/TabularNode.mjs").CellNode} CellNode
 * @typedef {import("../types/core.mjs").TocLayoutEntry} TocLayoutEntry
 */

/**
 * @typedef {Object} SigningPartySignatory
 * @property {string=} name - Signatory name (rendered below the signature line)
 * @property {string} [title] - Signatory title/role
 * @property {string} [signature] - Optional prefilled signature text (rare; usually left blank)
 * @property {string} [date] - Optional prefilled date text
 * @property {Record<string, string>} [values] - Arbitrary row values keyed by field label (e.g. {"Name":"..."})
 */

/**
 * @typedef {Object} SigningParty
 * @property {string} label - Party label (e.g. "COMPANY:", "MEMBER:")
 * @property {string[]} [fields] - Ordered row labels for each signatory block (default: Signature, Name, Title, Date)
 * @property {SigningPartySignatory[]} signatories - One or more signatories for this party
 */

/**
 * @typedef {Object} SigningPageConfig
 * @property {boolean} [enabled] - Whether to render the signing page (default: false)
 * @property {string} [witnessClause] - Override the witness clause text
 * @property {string} [executionNote] - Optional execution/capacity note rendered below witness clause
 * @property {string} [acknowledgmentTitle] - Optional bold acknowledgment heading rendered above acknowledgment text
 * @property {string} [acknowledgmentText] - Optional acknowledgment/affirmation body text rendered before signature rows
 * @property {Record<string, unknown>} [layout] - Optional spacing/layout overrides for signature rows and text blocks
 * @property {SigningParty[]} parties - Parties with their signatories
 * @property {string} [effectiveDate] - Effective date text (rendered if provided)
 */

/**
 * @typedef {Object} PdfRendererConfig
 * @property {PageConfig} pageConfig
 * @property {ReadonlyArray<HeaderFooterConfig>} [defaultHeaders]
 * @property {ReadonlyArray<HeaderFooterConfig>} [defaultFooters]
 * @property {{ regular?: string; bold?: string; italic?: string; boldItalic?: string; monospace?: string }} [fonts]
 * @property {Record<string, unknown>} [embeddedFonts]
 * @property {Record<string, string>} [fontRoleDefaults]
 * @property {number} [baseFontSize]
 * @property {number} [lineHeight]
 * @property {Record<string, number>} [headingScales]
 * @property {SpacingPolicy} [spacingPolicy] - Context-aware spacing rules (pair rules, defaults)
 * @property {Readonly<Record<string, string | number>>} [variables]
 * @property {CoverRenderConfig} [coverConfig] - Cover-page specific rendering overrides
 * @property {{ behavior?: HorizontalRuleBehavior }} [horizontalRule]
 * @property {TableRenderConfig} [table] - Table styling overrides
 * @property {Record<string, TextStyle>} [headingStyles]
 * @property {BoxStyle} [noticeStyle]
 * @property {BoxStyle} [signatureBlockStyle]
 * @property {Record<string, BoxStyle & { headerBackgroundColor?: string | number; titleColor?: string; titleBackgroundColor?: string | number; fieldLabelWidth?: number; signatureRowHeight?: number; rowHeight?: number; rowGap?: number; bodyGap?: number; headerGap?: number; postGap?: number; titleFontScale?: number }>} [directiveStyles]
 * @property {{ levelStyles?: Record<string | number, TocLevelStyle> }} [tocConfig]
 * @property {{
 *  title?: string;
 *  author?: string;
 *  subject?: string;
 *  creator?: string;
 *  producer?: string;
 *  includeDates?: boolean;
 * }} [metadata] - Global PDF metadata (Author, Title, etc.)
 * @property {boolean} [verbose] - Enable verbose trace logging for layout, bleed, wrapping
 * @property {SigningPageConfig} [signingPage] - Final signing/execution page (excluded from pagination)
 * @property {DustCoverPage} [dustCoverPage] - Optional outer dust cover
 * @property {{ mode?: "off" | "centered-title-block"; maxNodes?: number; stopAtMetadata?: boolean; stopAtHorizontalRule?: boolean }} [leadingSection] - Optional leading-section title-block alignment controls
 */

// =============================================================================
// PDF Building Types
// =============================================================================

/**
 * @typedef {Object} PdfPage
 * @property {number} pageNumber
 * @property {string} sectionId
 * @property {number} sectionPageNumber
 * @property {number} sectionTotalPages
 * @property {PdfContentStreamBuilder} contentBuilder
 * @property {PdfContentStreamBuilder} headerFooterBuilder
 * @property {Array<LinkAnnotation | { type: "form"; fieldType: "text" | "signature"; name: string; tooltip?: string; x: number; y: number; width: number; height: number; value?: string; readOnly?: boolean; required?: boolean; fontSize?: number; maxLength?: number }>} linkAnnotations
 */

/**
 * @typedef {Object} PdfBuildState
 * @property {PdfPage[]} pages
 * @property {PdfPage | null} currentPage
 * @property {number} currentY
 * @property {PdfDocumentBuilder} doc
 * @property {number} pageWidth
 * @property {number} pageHeight
 * @property {{ top: number; bottom: number; left: number; right: number }} margins
 * @property {{ top: number; bottom: number; left: number; right: number }} baseMargins
 * @property {number} contentWidth
 * @property {number} contentHeight
 * @property {FontsConfig} fonts
 * @property {Record<string, string>} fontRoles
 * @property {Map<string, { page: number; y: number }>} linkDestinations
 * @property {NodeType | null} lastNodeType
 * @property {Map<string, { headers?: ReadonlyArray<HeaderFooterConfig>; footers?: ReadonlyArray<HeaderFooterConfig>; breakMode?: BreakMode | null; horizontalRuleBehavior?: HorizontalRuleBehavior }>} sectionConfigs
 * @property {ReadonlyArray<HeaderFooterConfig>} canonicalHeaders
 * @property {ReadonlyArray<HeaderFooterConfig>} canonicalFooters
 * @property {number | null} lastInkBottomY
 * @property {number | null} lastInkPageIndex
 * @property {Map<number, number>} inkBottomYByPageIndex
 * @property {boolean} insidePart
 * @property {boolean} seenPart
 * @property {number} formFieldCounter
 */

// =============================================================================
// TwoPassPdfRenderer
// =============================================================================

export class TwoPassPdfRenderer {
    /**
     * @param {PdfRendererConfig} config
     */
    constructor(config) {
        const spacingPolicy = config.spacingPolicy ?? undefined;

        /** @type {PdfRendererConfig} */
        this.config = spacingPolicy ? { ...config, spacingPolicy } : config;

        /** @type {LayoutEngine} */

        this.layoutEngine = new LayoutEngine();

        /** @type {string[]} */
        this.warnings = [];

        /** @type {string[]} */
        this.errors = [];

        /** @type {number} */
        this._frontMatterExcludedOffset = 0;

        /** @type {FontsConfig} */
        this.fontConfig = {
            regular: config.fonts?.regular ?? "Helvetica",
            bold: config.fonts?.bold ?? "Helvetica-Bold",
            italic: config.fonts?.italic ?? "Helvetica-Oblique",
            boldItalic: config.fonts?.boldItalic ?? "Helvetica-BoldOblique",
            monospace: config.fonts?.monospace ?? "Courier"
        };

        /** @type {Record<string, unknown>} */
        this.embeddedFontsConfig = config.embeddedFonts ?? {};

        /** @type {Record<string, string>} */
        this.fontRoleDefaults = config.fontRoleDefaults ?? {};

        /** @type {{ behavior?: "rule" | "page-break" }} */
        this.horizontalRuleConfig = config.horizontalRule ?? {
            behavior: "rule"
        };

        /** @type {Record<number, TocLevelStyle>} */
        this.tocLevelStyles = config.tocConfig?.levelStyles ?? {};

        /** @type {boolean} */
        this._verbose = config.verbose || false;

        /** @type {Map<string, Uint8Array>} */
        this._embeddedFontBytesCache = new Map();

        /** @type {Map<string, { rawBytes: Uint8Array, sourceLabel: string }>} */
        this._googleFontBytesCache = new Map();

        /** @type {Map<string, boolean>} */
        this._embeddedFontAliasResolutionCache = new Map();
    }

    /**
     * Log a verbose trace message
     * @param {string} msg
     * @private
     */
    _trace(msg) {
        if (this._verbose) {
            console.log(`[VERBOSE:Renderer] ${msg}`);
        }
    }

    // =========================================================================
    // DocumentRenderer Interface
    // =========================================================================

    /**
     * Returns 1 if the cover page exists and its numbering is suppressed, 0 otherwise.
     * Used to offset pageIndex-based page numbers so content starts at page 1.
     * @returns {number}
     * @private
     */
    _getCoverPageOffset() {
        // Backwards-compatible name: returns the total excluded front-matter page count
        // (dust-cover + cover when numbering is suppressed).
        if (isNumber(this._frontMatterExcludedOffset)) {
            return this._frontMatterExcludedOffset;
        }

        const cfg = this.config.coverConfig;
        if (
            cfg &&
            (cfg.suppressPageNumbering === true || cfg.suppressFooter === true)
        ) {
            return 1;
        }
        return 0;
    }

    /**
     * Compute excluded-page offset used for displayed page numbers (TOC, headers/footers).
     * Dust covers are always excluded. Covers are excluded when coverConfig suppresses numbering.
     * @param {boolean} hasCover
     * @param {boolean} hasDustCover
     * @returns {number}
     */
    _computeFrontMatterExcludedOffset(hasCover, hasDustCover) {
        let offset = 0;
        if (hasDustCover) {
            offset += 1;
        }
        const cfg = this.config.coverConfig;
        if (
            hasCover &&
            cfg &&
            (cfg.suppressPageNumbering === true || cfg.suppressFooter === true)
        ) {
            offset += 1;
        }
        return offset;
    }

    /**
     * Get renderer name
     * @returns {string}
     */
    getName() {
        return "TwoPassPdfRenderer";
    }

    /**
     * Get output MIME type
     * @returns {string}
     */
    getMimeType() {
        return "application/pdf";
    }

    /**
     * Get file extension
     * @returns {string}
     */
    getExtension() {
        return "pdf";
    }

    /**
     * Get renderer capabilities
     * @returns {RenderCapabilities}
     */
    getCapabilities() {
        return {
            supportsInlineFormatting: true,
            supportsTables: true,
            supportsImages: true,
            supportsHeadersFooters: true,
            supportsPageBreaks: true,
            supportsColors: true,
            supportsBorders: true,
            supportsTwoPass: true,
            supportsHyperlinks: true,
            supportedNodeTypes: [
                "text",
                "container",
                "break",
                "heading",
                "paragraph",
                "list",
                "list-item",
                "blockquote",
                "code-block",
                "horizontal-rule",
                "image",
                "link",
                "form-field",
                "inline-format",
                "table",
                "row",
                "cell",
                "header-row",
                "header-cell",
                "article",
                "section",
                "clause",
                "definition",
                "notice",
                "signature-block",
                "cover-page",
                "toc"
            ]
        };
    }

    /**
     * Render composed document to PDF
     * @param {ReadonlyArray<ComposedSection>} sections
     * @param {CoverPageNode | null} [coverPage]
     * @param {TocNode | null} [toc]
     * @param {DustCoverPage | null} [dustCoverPage]
     * @returns {RenderResult}
     */
    render(sections, coverPage, toc, dustCoverPage) {
        this.warnings = [];
        this.errors = [];

        /** @type {DustCoverPage | null} */
        const resolvedDustCoverPage =
            dustCoverPage ?? this.config.dustCoverPage ?? null;

        this._frontMatterExcludedOffset =
            this._computeFrontMatterExcludedOffset(
                !!coverPage,
                !!resolvedDustCoverPage
            );

        try {
            this._trace(`=== render() called ===`);
            this._trace(`  sections: ${sections.length}`);
            this._trace(`  coverPage: ${!!coverPage}`);
            this._trace(
                `  toc: ${!!toc}${
                    toc ? ` (${toc.entries?.length ?? 0} entries)` : ""
                }`
            );
            this._trace(`  baseFontSize: ${this.config.baseFontSize ?? 10}`);
            this._trace(`  lineHeight: ${this.config.lineHeight ?? 1.5}`);
            this._trace(
                `  horizontalRule.behavior: ${
                    this.config.horizontalRule?.behavior ?? "rule"
                }`
            );
            if (this.config.coverConfig) {
                this._trace(
                    `  coverConfig: suppressHeader=${this.config.coverConfig.suppressHeader} suppressFooter=${this.config.coverConfig.suppressFooter} suppressPageNumbering=${this.config.coverConfig.suppressPageNumbering}`
                );
            }
            // =================================================================
            // Extract canonical headers/footers for layout calculations
            // Same logic as addHeadersFooters - check renderer config then sections
            // =================================================================
            /** @type {ReadonlyArray<HeaderFooterConfig>} */
            let canonicalHeaders = this.config.defaultHeaders ?? [];

            /** @type {ReadonlyArray<HeaderFooterConfig>} */
            let canonicalFooters = this.config.defaultFooters ?? [];

            if (
                canonicalHeaders.length === 0 ||
                canonicalFooters.length === 0
            ) {
                for (let s = 0, slen = sections.length; s < slen; s++) {
                    const sec = sections[s];
                    if (
                        canonicalHeaders.length === 0 &&
                        sec.config.headers?.length
                    ) {
                        canonicalHeaders = sec.config.headers;
                    }
                    if (
                        canonicalFooters.length === 0 &&
                        sec.config.footers?.length
                    ) {
                        canonicalFooters = sec.config.footers;
                    }
                    if (
                        canonicalHeaders.length > 0 &&
                        canonicalFooters.length > 0
                    ) {
                        break;
                    }
                }
            }

            // =================================================================
            // PASS 1: Layout calculation (NO TOC)
            // =================================================================
            const normalizedSections = this.normalizeSections(sections);

            this._trace(`=== PASS 1: Layout ===`);
            for (
                let si = 0, slen = normalizedSections.length;
                si < slen;
                si++
            ) {
                const ns = normalizedSections[si];
                this._trace(
                    `  section[${si}] id=${ns.id} name="${
                        ns.config?.name ?? "(unset)"
                    }" startsNewPage=${
                        ns.config?.startsNewPage ?? false
                    } content=${ns.content.length} nodes breakMode=${
                        /** @type {any} */ (ns.config).breakMode ?? "(unset)"
                    } hrBehavior=${
                        /** @type {any} */ (ns.config).horizontalRuleBehavior ??
                        "(unset)"
                    }`
                );
            }

            const layoutInput = normalizedSections.map((s) => ({
                config: s.config,
                content: s.content
            }));

            const layoutResult = this.layoutEngine.layout(
                layoutInput,
                this.config.pageConfig,
                coverPage || resolvedDustCoverPage
                    ? this.getPageHeight()
                    : undefined,
                undefined,
                canonicalHeaders,
                canonicalFooters
            );

            this._trace(
                `  layout result: ${
                    layoutResult.tocEntries.length
                } TOC entries, ${layoutResult.totalPages} pages, ${
                    layoutResult.linkDestinations?.length ?? 0
                } link destinations, ${layoutResult.sections.length} sections`
            );

            // =================================================================
            // PASS 2: Render body, record real destinations, then render TOC LAST
            // =================================================================
            this._trace(`=== PASS 2: Render ===`);
            const state = this.initializeState();
            this._trace(
                `  page: ${state.pageWidth}×${state.pageHeight} margins: T=${state.margins.top} B=${state.margins.bottom} L=${state.margins.left} R=${state.margins.right}`
            );
            this._trace(
                `  contentWidth: ${state.contentWidth} contentHeight: ${state.contentHeight}`
            );

            // Store canonical headers/footers on state so newPage can access them
            state.canonicalHeaders = canonicalHeaders;
            state.canonicalFooters = canonicalFooters;

            // Record real (render-derived) destinations for TOC + internal anchors
            /** @type {any} */ (state)._rawLinkDestinations = new Map();
            /** @type {any} */ (state)._tocCandidates = [];
            /** @type {any} */ (state)._tocTitleByNodeId = new Map();
            /** @type {any} */ (state)._recordDestinations = true;

            let tocPageCount = 0;

            // Render dust cover page (outer) FIRST
            if (resolvedDustCoverPage) {
                this.renderDustCoverPage(resolvedDustCoverPage, state);
                state.lastNodeType = null;
                this._trace(
                    `  dust cover rendered → ${
                        state.pages.length
                    } pages, currentY=${state.currentY.toFixed(1)}`
                );
            }

            // Render cover page
            if (coverPage) {
                this.renderCoverPage(coverPage, state);
                state.lastNodeType = null;
                this._trace(
                    `  cover page rendered → ${
                        state.pages.length
                    } pages, currentY=${state.currentY.toFixed(1)}`
                );
            }

            // Render each section (body)
            for (let i = 0, len = sections.length; i < len; i++) {
                const prePages = state.pages.length;
                this.renderSection(normalizedSections[i], state, layoutResult);
                this._trace(
                    `  section[${i}] "${normalizedSections[i].id}" rendered → ${
                        state.pages.length - prePages
                    } new pages (total ${
                        state.pages.length
                    }), currentY=${state.currentY.toFixed(1)}`
                );
            }

            // Render signing/execution page (excluded from pagination)
            if (
                this.config.signingPage &&
                this.config.signingPage.enabled !== false &&
                Array.isArray(this.config.signingPage.parties) &&
                this.config.signingPage.parties.length > 0
            ) {
                /** @type {any} */ (state)._recordDestinations = false;
                this.renderSigningPage(this.config.signingPage, state);
                /** @type {any} */ (state)._recordDestinations = true;
                this._trace(
                    `  signing page rendered → total ${state.pages.length} pages`
                );
            }

            // Hydrate TOC entry pages/titles from the REAL render pass (no layout estimates)
            if (toc) {
                this.updateTocPagesFromRenderedDestinations(
                    toc,
                    state,
                    normalizedSections
                );

                // Compute exact TOC page count via fixed-point render (page numbers affect wrapping)
                tocPageCount = this.computeTocPageCount(
                    toc,
                    layoutResult,
                    canonicalHeaders,
                    canonicalFooters
                );
                this._trace(
                    `  TOC: ${toc.entries.length} entries, ${tocPageCount} pages`
                );
            }

            // Render TOC LAST (with final page numbers), then insert after cover
            if (toc) {
                const tocStartIndex = state.pages.length;
                const tocForRender = this.cloneTocWithPageDelta(
                    toc,
                    tocPageCount
                );

                /** @type {any} */ (state)._recordDestinations = false;
                this.renderToc(tocForRender, state, layoutResult);

                // Move rendered TOC pages to the correct position (after cover)
                const tocPages = state.pages.splice(tocStartIndex);
                const insertAt =
                    (resolvedDustCoverPage ? 1 : 0) + (coverPage ? 1 : 0);
                state.pages.splice(insertAt, 0, ...tocPages);
            }

            // Renumber pages and recompute per-section numbering after TOC insertion
            this.renumberPages(state);

            // Build internal anchor destinations from the REAL rendered pages (after TOC insertion)
            this.rebuildLinkDestinationsFromRaw(
                state,
                (resolvedDustCoverPage ? 1 : 0) + (coverPage ? 1 : 0),
                tocPageCount
            );

            // Add headers and footers (now that we know total pages)
            this.addHeadersFooters(state, normalizedSections, layoutResult);

            // Resolve internal link targets LAST (anchors + page numbers)
            this.finalizeInternalLinks(state);

            // Build document outline (bookmarks) from TOC candidates
            this.buildDocumentOutline(state);

            // Build final PDF with link annotations
            const output = this.buildPdf(state);

            this._trace(`=== render() complete ===`);
            this._trace(`  total pages: ${state.pages.length}`);
            this._trace(`  output size: ${output.length} bytes`);
            this._trace(`  warnings: ${this.warnings.length}`);

            return {
                success: true,
                output,
                mimeType: "application/pdf",
                warnings: this.warnings,
                errors: [],
                pageCount: state.pages.length
            };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.errors.push(message);

            return {
                success: false,
                output: null,
                mimeType: "application/pdf",
                warnings: this.warnings,
                errors: this.errors,
                pageCount: 0
            };
        }
    }

    // =========================================================================
    // State Initialization
    // =========================================================================

    /**
     * Initialize PDF build state
     * @returns {PdfBuildState}
     */
    initializeState() {
        const pageConfig = this.config.pageConfig;
        const size = PAGE_SIZES[pageConfig.size ?? "letter"];

        const landscape = pageConfig.orientation === "landscape";
        const pageWidth = pageConfig.width ?? (landscape ? size.height : size.width);
        const pageHeight = pageConfig.height ?? (landscape ? size.width : size.height);

        const margins = {
            top: pageConfig.margins?.top ?? 72,
            bottom: pageConfig.margins?.bottom ?? 72,
            left: pageConfig.margins?.left ?? 72,
            right: pageConfig.margins?.right ?? 72
        };

        // Base margins are the original margins before header/footer adjustments
        const baseMargins = { ...margins };

        // Create document builder with page dimensions and pass metadata
        const doc = new PdfDocumentBuilder({
            width: pageWidth,
            height: pageHeight,
            ...(this.config.metadata || {})
        });

        // Register fonts
        this.registerFonts(doc);

        return {
            pages: [],
            currentPage: null,
            currentY: pageHeight - margins.top,
            doc,
            pageWidth,
            pageHeight,
            margins,
            baseMargins,
            contentWidth: pageWidth - margins.left - margins.right,
            contentHeight: pageHeight - margins.top - margins.bottom,
            fonts: this.fontConfig,
            fontRoles: isObject(this.embeddedFontsConfig?.roles)
                ? this.embeddedFontsConfig.roles
                : {},
            linkDestinations: new Map(),
            formFieldCounter: 0,
            lastNodeType: null,
            lastInkBottomY: null,
            lastInkPageIndex: null,
            inkBottomYByPageIndex: new Map(),
            sectionConfigs: new Map(),
            canonicalHeaders: [],
            canonicalFooters: [],
            insidePart: false,
            seenPart: false
        };
    }

    /**
     * @param {unknown} value
     * @param {HorizontalAlign} fallback
     * @returns {HorizontalAlign}
     */
    resolveHorizontalAlign(value, fallback = "left") {
        return value === "left" || value === "center" || value === "right"
            ? value
            : fallback;
    }

    /**
     * @param {BaseNode} node
     * @param {HorizontalAlign} fallback
     * @returns {HorizontalAlign}
     */
    resolveNodeHorizontalAlign(node, fallback = "left") {
        const directAlign = /** @type {any} */ (node).align;
        if (
            directAlign === "left" ||
            directAlign === "center" ||
            directAlign === "right"
        ) {
            return directAlign;
        }

        return this.resolveHorizontalAlign(
            node.attrs?.align ??
                node.attrs?.textAlign ??
                node.attrs?.text_align ??
                node.attrs?.horizontalAlign ??
                node.attrs?.horizontal_align,
            fallback
        );
    }

    /**
     * @returns {{ mode: "off" | "centered-title-block"; maxNodes: number; stopAtMetadata: boolean; stopAtHorizontalRule: boolean }}
     */
    getLeadingSectionConfig() {
        const raw = isObject(this.config.leadingSection)
            ? this.config.leadingSection
            : null;

        if (!raw) {
            return {
                mode: "off",
                maxNodes: 8,
                stopAtMetadata: true,
                stopAtHorizontalRule: true
            };
        }

        const mode =
            raw.mode === "centered-title-block"
                ? "centered-title-block"
                : "off";

        return {
            mode,
            maxNodes: Math.max(1, numberOr(raw.maxNodes, 8) ?? 8),
            stopAtMetadata: raw.stopAtMetadata !== false,
            stopAtHorizontalRule: raw.stopAtHorizontalRule !== false
        };
    }

    /**
     * @param {BaseNode} node
     * @returns {boolean}
     */
    isLeadingCenterEligibleNode(node) {
        return node.type === "heading" || node.type === "paragraph";
    }

    /**
     * @param {BaseNode} node
     * @returns {boolean}
     */
    isMetadataLikeParagraph(node) {
        if (node.type !== "paragraph") {
            return false;
        }

        const plain = this.extractPlainText(node).replace(/\s+/g, " ").trim();
        if (!plain || plain.length > 120) {
            return false;
        }

        const colonIndex = plain.indexOf(":");
        if (colonIndex <= 0 || colonIndex > 40) {
            return false;
        }

        const runs = this.buildInlineRuns(node);
        let firstNonSpaceRun = null;
        for (let i = 0, len = runs.length; i < len; i++) {
            const run = runs[i];
            if (run.text.replace(/\s+/g, "").length > 0) {
                firstNonSpaceRun = run;
                break;
            }
        }

        if (
            firstNonSpaceRun &&
            firstNonSpaceRun.bold &&
            /^[A-Za-z][A-Za-z0-9/&()' .-]{0,40}:$/.test(
                firstNonSpaceRun.text.trim()
            )
        ) {
            return true;
        }

        return /^[A-Z][A-Za-z0-9/&()' .-]{0,40}:\s+\S+/.test(plain);
    }

    /**
     * @param {BaseNode} node
     * @returns {boolean}
     */
    isCenterableLeadingParagraph(node) {
        if (node.type !== "paragraph") {
            return false;
        }

        const plain = this.extractPlainText(node).replace(/\s+/g, " ").trim();
        if (!plain || plain.length > 90) {
            return false;
        }

        return !/[.!?](?:\s|$)/.test(plain);
    }

    /**
     * @param {BaseNode} node
     * @param {HorizontalAlign} align
     * @returns {void}
     */
    applyNodeHorizontalAlign(node, align) {
        if (!isObject(node.attrs)) {
            node.attrs = {};
        }

        if (
            node.attrs.align !== "left" &&
            node.attrs.align !== "center" &&
            node.attrs.align !== "right"
        ) {
            node.attrs.align = align;
        }

        if (node.type === "paragraph") {
            const paragraphNode = /** @type {any} */ (node);
            if (
                paragraphNode.align !== "left" &&
                paragraphNode.align !== "center" &&
                paragraphNode.align !== "right"
            ) {
                paragraphNode.align = align;
            }
        }
    }

    /**
     * @param {ComposedSection} section
     * @returns {void}
     */
    applyLeadingSectionAlignment(section) {
        const cfg = this.getLeadingSectionConfig();
        if (cfg.mode !== "centered-title-block") {
            return;
        }

        if (!Array.isArray(section.content) || section.content.length === 0) {
            return;
        }

        const firstNode = section.content[0];
        if (!firstNode || firstNode.type !== "heading") {
            return;
        }

        let applied = 0;
        const limit = Math.min(section.content.length, cfg.maxNodes);
        /** @type {BaseNode[]} */
        const appliedNodes = [];

        for (let i = 0; i < limit; i++) {
            const node = section.content[i];
            if (!node) {
                break;
            }

            if (cfg.stopAtHorizontalRule && node.type === "horizontal-rule") {
                break;
            }

            if (!this.isLeadingCenterEligibleNode(node)) {
                break;
            }

            if (node.type === "paragraph") {
                if (cfg.stopAtMetadata && this.isMetadataLikeParagraph(node)) {
                    break;
                }
                if (!this.isCenterableLeadingParagraph(node)) {
                    break;
                }
            }

            this.applyNodeHorizontalAlign(node, "center");

            if (node.type === "heading" && node.level !== 1) {
                /** @type {any} */ (node).includeInToc = false;
            }

            appliedNodes.push(node);
            applied++;
        }

        if (appliedNodes.length > 1) {
            const baseFontSize = this.config.baseFontSize ?? 10;
            const compactHeadingSpacingBeforePt = Math.max(
                1.5,
                baseFontSize * 0.2
            );
            const compactHeadingSpacingAfterPt = Math.max(
                1.25,
                baseFontSize * 0.15
            );

            for (let i = 1, len = appliedNodes.length; i < len; i++) {
                const previousNode = appliedNodes[i - 1];
                const node = appliedNodes[i];
                if (
                    previousNode.type === "heading" &&
                    node.type === "heading"
                ) {
                    if (!isObject(previousNode.attrs)) {
                        previousNode.attrs = {};
                    }
                    if (!isObject(node.attrs)) {
                        node.attrs = {};
                    }

                    previousNode.attrs.spacingAfterPt =
                        compactHeadingSpacingAfterPt;
                    node.attrs.spacingBeforePt = compactHeadingSpacingBeforePt;
                }
            }
        }

        if (this._verbose && applied > 0) {
            this._trace(
                `  leadingSectionAlignment: centered first ${applied} node(s) for section ${section.id}`
            );
        }
    }

    /**
     * Build link destinations from layout result
     * @param {PdfBuildState} state
     * @param {LayoutResult} layoutResult
     * @returns {void}
     */
    buildLinkDestinations(state, layoutResult, tocPageOffset = 0) {
        const destinations =
            layoutResult.linkDestinations ??
            this.layoutEngine.getLinkDestinations();

        for (let i = 0, len = destinations.length; i < len; i++) {
            const dest = destinations[i];
            state.linkDestinations.set(dest.nodeId, {
                page: dest.page + tocPageOffset,
                y: dest.y
            });
        }
    }

    /**
     * Record a link destination based on real rendering (not layout).
     * @param {PdfBuildState} state
     * @param {string} nodeId
     * @param {number} y
     * @returns {void}
     */
    recordRenderedDestination(state, nodeId, y) {
        if (!nodeId) {
            return;
        }
        if (!(/** @type {any} */ (state)._recordDestinations)) {
            return;
        }
        const pageIndex = state.pages.length - 1;
        if (pageIndex < 0) {
            return;
        }
        const raw =
            /** @type {Map<string, { pageIndex: number; y: number }>} */ (
                /** @type {any} */ (state)._rawLinkDestinations
            );
        if (!raw) {
            return;
        }
        if (!raw.has(nodeId)) {
            raw.set(nodeId, { pageIndex, y });
        }
    }

    /**
     * Record a TOC candidate in document order.
     * @param {PdfBuildState} state
     * @param {string} sectionId
     * @param {string} nodeId
     * @param {number} level
     * @param {string} title
     * @returns {void}
     */
    recordTocCandidate(state, sectionId, nodeId, level, title) {
        if (!nodeId) {
            return;
        }
        if (!(/** @type {any} */ (state)._recordDestinations)) {
            return;
        }
        const pageIndex = state.pages.length - 1;
        if (pageIndex < 0) {
            return;
        }
        const titleText = String(title ?? "").trim();

        const titleMap = /** @type {Map<string, string> | undefined} */ (
            /** @type {any} */ (state)._tocTitleByNodeId
        );
        if (titleMap && titleText && !titleMap.has(nodeId)) {
            titleMap.set(nodeId, titleText);
        }

        const candidates = /** @type {Array<any> | undefined} */ (
            /** @type {any} */ (state)._tocCandidates
        );
        if (candidates) {
            candidates.push({
                nodeId,
                sectionId,
                level,
                title: titleText,
                pageIndex
            });
        }
    }

    /**
     * Populate / rebuild TOC entry pages (and titles) from render-derived destinations.
     * This avoids layout-pass estimates entirely.
     * @param {TocNode} toc
     * @param {PdfBuildState} state
     * @param {ReadonlyArray<ComposedSection>} sections
     * @returns {void}
     */
    updateTocPagesFromRenderedDestinations(toc, state, sections) {
        const raw =
            /** @type {Map<string, { pageIndex: number; y: number }> | undefined} */ (
                /** @type {any} */ (state)._rawLinkDestinations
            );
        if (!raw) {
            return;
        }

        const titleMap = /** @type {Map<string, string> | undefined} */ (
            /** @type {any} */ (state)._tocTitleByNodeId
        );

        // When cover page numbering is suppressed, subtract 1 so content starts at page 1
        const coverOffset = this._getCoverPageOffset();

        // If entries already exist, just hydrate their page numbers from raw destinations.
        if (toc.entries.length > 0) {
            for (let i = 0, len = toc.entries.length; i < len; i++) {
                const entry = toc.entries[i];
                const nodeId = entry.nodeId;
                if (!nodeId) {
                    continue;
                }
                const dest = raw.get(nodeId);
                if (dest) {
                    entry.page = dest.pageIndex + 1 - coverOffset;
                }
                const fallbackTitle = titleMap?.get(nodeId);
                if (
                    (!entry.title || !String(entry.title).trim()) &&
                    fallbackTitle
                ) {
                    entry.title = fallbackTitle;
                }
            }
            return;
        }

        const rawConfiguredLevels = Array.isArray(toc.config?.levels)
            ? toc.config.levels
            : null;
        const configuredLevels = new Set(rawConfiguredLevels ?? []);
        const filterByLevel = rawConfiguredLevels !== null;

        const candidates = /** @type {Array<any>} */ (
            /** @type {any} */ (state)._tocCandidates ?? []
        );

        // First page index for each sectionId (cover/body only at this point)
        /** @type {Map<string, number>} */
        const firstPageIndexBySection = new Map();
        for (let i = 0, len = state.pages.length; i < len; i++) {
            const sid = state.pages[i].sectionId;
            if (!firstPageIndexBySection.has(sid)) {
                firstPageIndexBySection.set(sid, i);
            }
        }

        // Optional document-level entries (one per section)
        const sectionDocuments = /** @type {any} */ (toc.config)
            ?.sectionDocuments;
        const hasDocEntries =
            Array.isArray(sectionDocuments) && sectionDocuments.length > 0;
        const levelOffset = hasDocEntries ? 1 : 0;

        /** @type {Map<string, Array<any>>} */
        const candidatesBySection = new Map();
        for (let i = 0, len = candidates.length; i < len; i++) {
            const c = candidates[i];
            const sid = c.sectionId;
            if (!sid) {
                continue;
            }
            let arr = candidatesBySection.get(sid);
            if (!arr) {
                arr = [];
                candidatesBySection.set(sid, arr);
            }
            arr.push(c);
        }

        // Rebuild entries
        toc.entries = [];

        for (let sIdx = 0, slen = sections.length; sIdx < slen; sIdx++) {
            const sec = sections[sIdx];
            const startIndex = firstPageIndexBySection.get(sec.id);
            if (!isNumber(startIndex)) {
                continue;
            }

            if (hasDocEntries) {
                const docCfg = sectionDocuments[sIdx] ?? {};
                const title = String(
                    docCfg.title ?? docCfg.name ?? sec.config?.name ?? sec.id
                ).trim();

                toc.entries.push({
                    nodeId: undefined,
                    level: 1,
                    title,
                    page: startIndex + 1 - coverOffset,
                    style: toc.config?.entryStyles?.find((s) => s.level === 1),
                    isDocumentEntry: true
                });
            }

            const list = candidatesBySection.get(sec.id) ?? [];
            for (let i = 0, len = list.length; i < len; i++) {
                const c = list[i];
                const originalLevel = Number(c.level) || 1;
                if (filterByLevel && !configuredLevels.has(originalLevel)) {
                    continue;
                }

                const effectiveLevel = originalLevel + levelOffset;
                const title = String(c.title ?? "").trim();
                if (!title) {
                    continue;
                }

                toc.entries.push({
                    nodeId: c.nodeId,
                    level: effectiveLevel,
                    title,
                    page: Number(c.pageIndex) + 1 - coverOffset,
                    style: toc.config?.entryStyles?.find(
                        (s) => s.level === effectiveLevel
                    )
                });
            }
        }
    }

    /**
     * Rebuild state.linkDestinations after TOC insertion using raw render destinations.
     * @param {PdfBuildState} state
     * @param {number} insertAt
     * @param {number} tocPageCount
     * @returns {void}
     */
    rebuildLinkDestinationsFromRaw(state, insertAt, tocPageCount) {
        const raw =
            /** @type {Map<string, { pageIndex: number; y: number }> | undefined} */ (
                /** @type {any} */ (state)._rawLinkDestinations
            );
        if (!raw) {
            return;
        }

        // Cover page is still "on" page 1 its just not counted
        //const coverOffset = this._getCoverPageOffset();

        state.linkDestinations = new Map();
        for (const [nodeId, dest] of raw.entries()) {
            const shift = dest.pageIndex >= insertAt ? tocPageCount : 0;
            state.linkDestinations.set(nodeId, {
                page: dest.pageIndex + shift + 1,
                y: dest.y + state.margins.top
            });
        }
    }

    /**
     * Clone a TOC node, applying a delta to all entry page numbers.
     * @param {TocNode} toc
     * @param {number} pageDelta
     * @returns {TocNode}
     */
    cloneTocWithPageDelta(toc, pageDelta) {
        /** @type {import("../types/core.mjs").TocEntry[]} */
        const entries = [];
        for (let i = 0, len = toc.entries.length; i < len; i++) {
            const entry = toc.entries[i];
            entries.push({
                ...entry,
                page: isNumber(entry.page) ? entry.page + pageDelta : entry.page
            });
        }
        return {
            ...toc,
            entries
        };
    }

    /**
     * Determine TOC page count using a fixed-point iteration:
     * TOC pages affect the displayed page numbers, which affects wrapping.
     * @param {TocNode} toc
     * @param {LayoutResult} layoutResult
     * @param {ReadonlyArray<HeaderFooterConfig>} canonicalHeaders
     * @param {ReadonlyArray<HeaderFooterConfig>} canonicalFooters
     * @returns {number}
     */
    computeTocPageCount(toc, layoutResult, canonicalHeaders, canonicalFooters) {
        if (!toc.entries.length) {
            return 0;
        }

        let guess = 1;
        for (let iter = 0; iter < 6; iter++) {
            const tempState = this.initializeState();
            tempState.canonicalHeaders = canonicalHeaders;
            tempState.canonicalFooters = canonicalFooters;

            const tocForRender = this.cloneTocWithPageDelta(toc, guess);
            this.renderToc(tocForRender, tempState, layoutResult);

            const pages = tempState.pages.length;
            if (pages === guess) {
                return pages;
            }
            guess = pages;
        }
        return guess;
    }

    /**
     * Renumber pages after TOC insertion so headers/footers and internal links resolve consistently.
     * @param {PdfBuildState} state
     * @returns {void}
     */
    renumberPages(state) {
        /** @type {Map<string, number>} */
        const sectionTotals = new Map();
        const coverCfg = this.config.coverConfig;

        // Determine if cover page should be excluded from page numbering
        let coverPageExcluded = false;
        for (let i = 0, len = state.pages.length; i < len; i++) {
            const page = state.pages[i];
            const sectionId = page.sectionId;

            // Signing pages are always excluded from pagination
            if (sectionId === "signing") {
                continue;
            }

            // Dust cover pages are always excluded from pagination
            if (sectionId === "dust-cover") {
                continue;
            }

            const isCover = sectionId === "cover" && coverCfg;
            if (
                isCover &&
                (coverCfg.suppressPageNumbering === true ||
                    coverCfg.suppressFooter === true)
            ) {
                coverPageExcluded = true;
                continue;
            }
            sectionTotals.set(
                sectionId,
                (sectionTotals.get(sectionId) ?? 0) + 1
            );
        }

        /** @type {Map<string, number>} */
        const sectionCounters = new Map();
        let numberedPageIndex = 0;
        for (let i = 0, len = state.pages.length; i < len; i++) {
            const page = state.pages[i];

            // Dust cover pages are excluded from pagination (like cover/signing)
            if (page.sectionId === "dust-cover") {
                page.pageNumber = 0;
                page.sectionPageNumber = 0;
                page.sectionTotalPages = 0;
                continue;
            }

            const isCover = page.sectionId === "cover" && coverCfg;
            const isCoverExcluded =
                isCover &&
                (coverCfg.suppressPageNumbering === true ||
                    coverCfg.suppressFooter === true);

            if (isCoverExcluded) {
                // Cover page gets page number 0 — it won't be displayed
                page.pageNumber = 0;
                page.sectionPageNumber = 0;
                page.sectionTotalPages = 0;
                continue;
            }

            // Signing pages are excluded from pagination (like cover)
            if (page.sectionId === "signing") {
                page.pageNumber = 0;
                page.sectionPageNumber = 0;
                page.sectionTotalPages = 0;
                continue;
            }

            numberedPageIndex++;
            const nextSectionPageNumber =
                (sectionCounters.get(page.sectionId) ?? 0) + 1;

            page.pageNumber = numberedPageIndex;
            page.sectionPageNumber = nextSectionPageNumber;
            page.sectionTotalPages =
                sectionTotals.get(page.sectionId) ?? nextSectionPageNumber;

            sectionCounters.set(page.sectionId, nextSectionPageNumber);
        }
    }

    /**
     * Resolve internal links to concrete page+Y destinations after final pagination.
     * @param {PdfBuildState} state
     * @returns {void}
     */
    finalizeInternalLinks(state) {
        for (let p = 0, plen = state.pages.length; p < plen; p++) {
            const page = state.pages[p];
            for (let a = 0, alen = page.linkAnnotations.length; a < alen; a++) {
                const ann = page.linkAnnotations[a];
                if (ann.type !== "internal") {
                    continue;
                }
                const targetNodeId = ann.targetNodeId;
                if (!targetNodeId) {
                    continue;
                }
                const dest = state.linkDestinations.get(targetNodeId);
                if (!dest) {
                    continue;
                }
                ann.targetPage = dest.page;
                ann.targetY = dest.y;
            }
        }
    }

    /**
     * Build document outline (bookmarks panel) from TOC candidates.
     * Uses the same resolved link destinations as the TOC entries.
     * @param {PdfBuildState} state
     * @returns {void}
     */
    buildDocumentOutline(state) {
        const candidates = /** @type {Array<any> | undefined} */ (
            /** @type {any} */ (state)._tocCandidates
        );
        if (!candidates || candidates.length === 0) {
            return;
        }

        /** @type {import("../../pdf/document.mjs").OutlineItem[]} */
        const items = [];

        for (let i = 0, len = candidates.length; i < len; i++) {
            const c = candidates[i];
            const nodeId = c.nodeId;

            const title = String(c.title ?? "")
                .trim()
                .replace(/—/g, "-")
                .replace(/—/g, "-");
            if (!title || !nodeId) {
                continue;
            }

            const dest = state.linkDestinations.get(nodeId);
            if (!dest) {
                continue;
            }

            items.push({
                title,
                level: Number(c.level) || 1,
                targetPage: dest.page,
                targetY: dest.y
            });
        }

        if (items.length > 0) {
            state.doc.setOutlineItems(items);
            this._trace(`  outline: ${items.length} bookmark items`);
        }
    }

    /**
     * @returns {number}
     */
    getPageHeight() {
        const pageConfig = this.config.pageConfig;
        const size = PAGE_SIZES[pageConfig.size ?? "letter"];

        const landscape = pageConfig.orientation === "landscape";
        return pageConfig.height ?? (landscape ? size.width : size.height);
    }

    /**
     * @param {TocNode} toc
     * @returns {number}
     */
    estimateTocHeight(toc) {
        const fontSize = this.config.baseFontSize ?? 10;
        const lineHeight = this.config.lineHeight ?? 1.5;
        const titleHeight = fontSize * 2 * lineHeight;
        const entriesHeight = toc.entries.length * fontSize * lineHeight * 1.2;

        return titleHeight + entriesHeight;
    }

    // =========================================================================
    // Preface Grouping + Horizontal Rule Normalization
    // =========================================================================

    /**
     * Normalize sections so layout + render agree on page breaks, while keeping
     * front matter + statutory notices grouped at the top.
     *
     * Rules:
     * - Preface = from section start until first major body heading/article.
     * - In preface: suppress notice pageBreakBefore; force horizontal rules to render as rules.
     * - Outside preface: if horizontalRule.behavior === "page-break", convert horizontal rules into explicit page breaks.
     *
     * @param {ReadonlyArray<ComposedSection>} sections
     * @returns {ComposedSection[]}
     */
    normalizeSections(sections) {
        const globalHrBehavior = this.config.horizontalRule?.behavior ?? "rule";

        this._trace(`=== normalizeSections ===`);
        this._trace(`  globalHrBehavior: ${globalHrBehavior}`);

        /** @type {ComposedSection[]} */
        const out = [];
        for (let i = 0, len = sections.length; i < len; i++) {
            const s = sections[i];

            const secCfg = /** @type {any} */ (s.config);
            const sectionHrBehavior =
                (isString(secCfg?.horizontalRuleBehavior) &&
                secCfg.horizontalRuleBehavior.length > 0
                    ? secCfg.horizontalRuleBehavior
                    : null) ?? globalHrBehavior;

            this._trace(
                `  section[${i}] "${s.id}" hrBehavior=${sectionHrBehavior} nodes=${s.content.length}`
            );

            const sectionBreakMode =
                /** @type {any} */ (secCfg)?.breakMode ?? "always";

            const normalizedSection = {
                ...s,
                content: this.normalizeSectionContentForPreface(
                    s.content,
                    sectionHrBehavior,
                    sectionBreakMode
                )
            };

            this.applyLeadingSectionAlignment(normalizedSection);
            out.push(normalizedSection);
        }
        return out;
    }

    /**
     * @param {ReadonlyArray<BaseNode>} nodes
     * @param {"rule"|"page-break"|string} hrBehavior
     * @param {"always"|"part-only"} breakMode
     * @returns {BaseNode[]}
     */
    normalizeSectionContentForPreface(nodes, hrBehavior, breakMode = "always") {
        const prefaceEnd = this.findPrefaceEndIndex(nodes);
        const hrIsPageBreak = hrBehavior === "page-break";
        const isPartOnly = breakMode === "part-only";

        this._trace(
            `    preface boundary: index ${prefaceEnd}/${nodes.length} (hrIsPageBreak=${hrIsPageBreak} breakMode=${breakMode} isPartOnly=${isPartOnly})`
        );
        if (prefaceEnd > 0 && prefaceEnd < nodes.length) {
            const boundaryNode = nodes[prefaceEnd];
            this._trace(
                `    first body node: ${
                    boundaryNode.type
                } "${this.extractPlainText(boundaryNode).slice(0, 50)}"`
            );
        }

        // Find the last HR in the preface — it serves as the transition
        // boundary between front-matter and body, so it should follow the
        // global HR behavior (e.g. become a page break) instead of being
        // suppressed like the interior preface HRs.
        let lastPrefaceHrIndex = -1;
        if (hrIsPageBreak) {
            for (let i = prefaceEnd - 1; i >= 0; i--) {
                if (nodes[i].type === "horizontal-rule") {
                    lastPrefaceHrIndex = i;
                    break;
                }
            }
        }

        /** @type {BaseNode[]} */
        const out = [];
        for (let i = 0, len = nodes.length; i < len; i++) {
            const node = nodes[i];
            const inPreface = i < prefaceEnd;

            if (inPreface) {
                // The last preface HR transitions into the body — let it
                // become a page break so the first body heading starts on
                // a fresh page.
                if (i === lastPrefaceHrIndex) {
                    this._trace(
                        `    converting last preface HR[${i}] → page-break`
                    );
                    out.push(this.convertHorizontalRuleToPageBreak(node));
                    continue;
                }
                out.push(this.normalizePrefaceNode(node, hrBehavior));
                continue;
            }

            if (hrIsPageBreak && node.type === "horizontal-rule") {
                // In "part-only" mode, only convert this HR to a page break
                // if the region before or after it contains a Part heading or
                // a table.  A "region" is the span of nodes between two HRs
                // (or section boundary).  This works with flat node lists
                // where headings, tables, and paragraphs are siblings rather
                // than nested inside article/section wrappers.
                if (isPartOnly) {
                    const prevRegionQualifies = this.regionContainsPartOrTable(
                        nodes,
                        i,
                        -1
                    );
                    const nextRegionQualifies = this.regionContainsPartOrTable(
                        nodes,
                        i,
                        1
                    );
                    if (prevRegionQualifies || nextRegionQualifies) {
                        this._trace(
                            `    converting body HR[${i}] → page-break (part-only: prev=${prevRegionQualifies} next=${nextRegionQualifies})`
                        );
                        out.push(this.convertHorizontalRuleToPageBreak(node));
                    } else {
                        this._trace(
                            `    dropping body HR[${i}] (part-only: neither region qualifies)`
                        );
                    }
                    continue;
                }

                this._trace(`    converting body HR[${i}] → page-break`);
                out.push(this.convertHorizontalRuleToPageBreak(node));
                continue;
            }

            out.push(node);
        }
        return out;
    }

    /**
     * Identify the boundary between preface (front matter + notices) and body.
     * @param {ReadonlyArray<BaseNode>} nodes
     * @returns {number}
     */
    findPrefaceEndIndex(nodes) {
        for (let i = 0, len = nodes.length; i < len; i++) {
            const node = nodes[i];

            if (i === 0) {
                continue;
            }

            if (node.type === "article" || node.type === "section") {
                return i;
            }

            if (node.type === "heading") {
                const level =
                    /** @type {any} */ (node).level ?? node.attrs?.level ?? 1;
                if (level <= 2) {
                    const text = this.extractPlainText(node).trim();
                    if (text.length === 0) continue;
                    // Keep statutory notice headings and firewall in preface
                    if (/\bNOTICE|Firewall/i.test(text)) continue;
                    return i;
                }
            }
        }

        return nodes.length;
    }

    /**
     * @param {BaseNode} node
     * @returns {BaseNode}
     */

    normalizePrefaceNode(node, hrBehavior) {
        // Mutate in place to preserve BaseNode instance (and stable ids)
        if (node.type === "notice" && node.keepRules?.pageBreakBefore) {
            node.keepRules = {
                ...(node.keepRules ?? {}),
                pageBreakBefore: false
            };
        }

        if (node.type === "horizontal-rule") {
            // Never allow preface HRs to force a page break.
            const override =
                hrBehavior === "page-break"
                    ? "rule"
                    : hrBehavior === "ignore"
                    ? "ignore"
                    : "rule";

            node.attrs = {
                ...(node.attrs ?? {}),
                hrBehaviorOverride: override
            };
        }

        // Preface rendering rules must apply even when the markdown converter nests
        // notices/HRs under wrappers (e.g. initial heading/article containers).
        if (Array.isArray(node.children) && node.children.length > 0) {
            for (let i = 0, len = node.children.length; i < len; i++) {
                this.normalizePrefaceNode(node.children[i], hrBehavior);
            }
        }

        return node;
    }

    /**
     * @param {BaseNode} hr
     * @returns {BaseNode}
     */
    convertHorizontalRuleToPageBreak(hr) {
        // Replace the HR node with an explicit page-break node so layout + render agree.
        // Preserve the original id for stability.
        return createPageBreak({
            id: hr.id,
            attrs: {
                ...(hr.attrs ?? {}),
                breakType: "page"
            }
        });
    }

    // =========================================================================
    // Section Break Mode
    // =========================================================================

    /**
     * Get the break mode for a section.
     *
     * Break modes:
     * - "always" (default): honor all pageBreakBefore rules
     * - "part-only": only honor pageBreakBefore on top-level "Part" headings
     *
     * The mode is stored on the section config by the filing generator.
     *
     * @param {PdfBuildState} state
     * @param {string} sectionId
     * @returns {"always" | "part-only"}
     */
    getSectionBreakMode(state, sectionId) {
        const sectionConfig = state.sectionConfigs.get(sectionId);
        const mode = /** @type {any} */ (sectionConfig)?.breakMode;
        if (mode === "part-only") {
            return "part-only";
        }
        return "always";
    }

    /**
     * Check if a node is a top-level "Part" heading that should still get a
     * page break in "part-only" mode.
     *
     * Matches patterns like: "Part I", "Part II", "Part 1", "PART III",
     * or section/article nodes whose title starts with "Part".
     *
     * @param {BaseNode} node
     * @returns {boolean}
     */
    isPartLevelNode(node) {
        if (
            node.type !== "article" &&
            node.type !== "section" &&
            node.type !== "heading"
        ) {
            return false;
        }

        const number = /** @type {any} */ (node).number ?? node.attrs?.number;
        const title = /** @type {any} */ (node).title ?? node.attrs?.title;

        // Check if the number or title contains a "Part" pattern
        const numberStr = number != null ? String(number).trim() : "";
        const titleStr = title != null ? String(title).trim() : "";

        // Match "Part I", "Part 1", etc in number field
        if (/^Part\s/i.test(numberStr)) {
            return true;
        }

        // Match title starting with "Part"
        if (/^Part\s/i.test(titleStr)) {
            return true;
        }

        // Check the full heading text that would be rendered
        const headingText = this.extractPlainText(node).trim();
        if (/^Part\s/i.test(headingText)) {
            return true;
        }

        return false;
    }

    /**
     * Check whether a node (or any descendant) contains a table.
     * Used by "part-only" break mode to distinguish sections that need
     * page-break treatment from those that should free-flow.
     *
     * @param {BaseNode} node
     * @returns {boolean}
     */
    containsTable(node) {
        if (node.type === "table") {
            return true;
        }

        for (let i = 0, len = node.children.length; i < len; i++) {
            if (this.containsTable(node.children[i])) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if a node should receive page-break treatment in "part-only" mode.
     * True for:
     * - Part-level nodes ("Part I", "Part II", etc.)
     * - section/article nodes that contain a table
     * Everything else free-flows.
     *
     * @param {BaseNode} node
     * @returns {boolean}
     */
    shouldBreakInPartOnlyMode(node) {
        if (this.isPartLevelNode(node)) {
            return true;
        }

        if (
            (node.type === "article" || node.type === "section") &&
            this.containsTable(node)
        ) {
            return true;
        }

        return false;
    }

    /**
     * Scan a region of nodes adjacent to an HR and check whether it contains
     * a Part-level heading or a table.  The region extends from the HR
     * (exclusive) until the next HR or list boundary in the given direction.
     *
     * Works with flat node lists where headings, tables, and paragraphs are
     * siblings rather than nested inside article/section wrappers.
     *
     * @param {ReadonlyArray<BaseNode>} nodes
     * @param {number} hrIndex  Index of the horizontal-rule node.
     * @param {1 | -1} direction  1 = scan forward, -1 = scan backward.
     * @returns {boolean}
     */
    regionContainsPartOrTable(nodes, hrIndex, direction) {
        const start = hrIndex + direction;
        const len = nodes.length;
        for (
            let i = start;
            direction === 1 ? i < len : i >= 0;
            i += direction
        ) {
            const node = nodes[i];
            // Stop at next HR — that's the boundary of this region
            if (node.type === "horizontal-rule") {
                return false;
            }
            if (node.type === "table") {
                return true;
            }
            if (this.isPartLevelNode(node)) {
                return true;
            }
            // Also check structured wrappers in case some docs use them
            if (
                (node.type === "article" || node.type === "section") &&
                this.containsTable(node)
            ) {
                return true;
            }
        }
        return false;
    }

    /**
     * @param {BaseNode} node
     * @returns {string}
     */
    extractPlainText(node) {
        if (typeof (/** @type {any} */ (node).getTextContent) === "function") {
            return node.getTextContent() ?? "";
        }

        if (hasPropertyOfType(node.attrs, "text", "string")) {
            return node.attrs.text;
        }

        if (isString(node.attrs?.code)) {
            return node.attrs.code;
        }

        let out = "";
        for (let i = 0, len = node.children.length; i < len; i++) {
            out += this.extractPlainText(node.children[i]);
        }
        return out;
    }

    // =========================================================================
    // Spacing Logic
    // =========================================================================
    /**
     * Get vertical spacing before a node based on context.
     *
     * Resolution order:
     * 1) spacingPolicy pair rules (e.g. "paragraph after heading")
     * 2) spacingPolicy per-type defaults
     * 3) legacy hardcoded defaults (back-compat)
     *
     * @param {BaseNode} node
     * @param {NodeType | null} previousNodeType
     * @returns {number} Spacing in points
     */
    getVerticalSpacing(node, previousNodeType) {
        const fontSize = this.config.baseFontSize ?? 10;
        const em = fontSize;

        // Explicit per-node spacingBefore overrides policy/defaults (interpreted as em unless *Pt field used)
        const nodeStyle =
            /** @type {any} */ (node).textStyle ??
            node.attrs?.textStyle ??
            node.attrs?.style;
        const spacingBeforePt =
            nodeStyle?.spacingBeforePt ??
            nodeStyle?.beforeSpacingPt ??
            node.attrs?.spacingBeforePt ??
            node.attrs?.beforeSpacingPt ??
            null;

        if (isNumber(spacingBeforePt)) {
            return spacingBeforePt;
        }

        const spacingBeforeEm =
            nodeStyle?.spacingBefore ??
            nodeStyle?.beforeSpacing ??
            node.attrs?.spacingBefore ??
            node.attrs?.beforeSpacing ??
            null;

        if (isNumber(spacingBeforeEm)) {
            return spacingBeforeEm * em;
        }

        if (isString(spacingBeforeEm) && spacingBeforeEm.trim().length > 0) {
            const v = Number(spacingBeforeEm);
            if (Number.isFinite(v)) {
                return v * em;
            }
        }

        const policy = this.config.spacingPolicy;

        if (policy) {
            const resolved = this.resolveBeforeSpacing(
                policy,
                previousNodeType,
                node.type,
                em
            );

            if (resolved !== null) {
                return resolved;
            }
        }

        // Legacy defaults using constants (only used when spacingPolicy is not provided)
        if (!previousNodeType) {
            // First element on page - no extra spacing needed
            // newPage already accounts for header offset
            return 0;
        }

        switch (node.type) {
            case "heading":
                // Headings need significantly more space if following content
                if (
                    previousNodeType === "paragraph" ||
                    previousNodeType === "list" ||
                    previousNodeType === "code-block" ||
                    previousNodeType === "table" ||
                    previousNodeType === "blockquote" ||
                    previousNodeType === "notice"
                ) {
                    return DEFAULT_SPACING_BEFORE.heading_after_content * em;
                }
                // Heading after heading (subtitle) needs less
                if (previousNodeType === "heading") {
                    return DEFAULT_SPACING_BEFORE.heading_after_heading * em;
                }
                // Heading after HR — mirror the HR's own before-spacing so
                // the gap above and below the rule line are identical.
                if (previousNodeType === "horizontal-rule") {
                    return DEFAULT_SPACING_BEFORE.horizontal_rule_default * em;
                }
                // Default spacing for headings
                return DEFAULT_SPACING_BEFORE.heading_default * em;

            case "paragraph":
                if (previousNodeType === "heading") {
                    return DEFAULT_SPACING_BEFORE.paragraph_after_heading * em;
                }
                return DEFAULT_SPACING_BEFORE.paragraph_default * em;

            case "list":
                return DEFAULT_SPACING_BEFORE.list_default * em;

            case "table":
                return DEFAULT_SPACING_BEFORE.table_default * em;

            case "blockquote":
                return DEFAULT_SPACING_BEFORE.blockquote_default * em;

            case "code-block":
                return DEFAULT_SPACING_BEFORE.code_block_default * em;

            case "horizontal-rule":
                return DEFAULT_SPACING_BEFORE.horizontal_rule_default * em;

            case "notice":
                // Notices have internal padding, so less external spacing needed
                if (previousNodeType === "heading") {
                    return 0.3 * em;
                }
                return 0.75 * em;

            case "signature-block":
                return DEFAULT_SPACING_BEFORE.signature_block_default * em;

            case "article":
            case "section":
                return DEFAULT_SPACING_BEFORE.article_default * em;

            default:
                return 0;
        }
    }

    /**
     * Resolve before-spacing from a spacing policy.
     *
     * Pair-rule shape (recommended):
     * { prev: "heading", next: "paragraph", em: 0.5, priority?: 10 }
     *
     * Supported aliases:
     * - prev: previous | from | after
     * - next: current | to | before
     * - pt: points | spacingPt
     * - em: spacingEm | spacing
     *
     * @param {SpacingPolicy} policy
     * @param {NodeType | null} prevType
     * @param {NodeType} nextType
     * @param {number} em
     * @returns {number | null}
     */
    resolveBeforeSpacing(policy, prevType, nextType, em) {
        /** @type {ReadonlyArray<any>} */
        const rules = policy.beforeRules ?? [];

        /** @type {Readonly<Record<string, number>> | undefined} */
        const perTypeDefaults = policy.defaultBeforeEmByType;

        let bestPriority = -Infinity;
        /** @type {any | null} */
        let bestRule = null;

        for (let i = 0, len = rules.length; i < len; i++) {
            const rule = rules[i];

            const rulePrev =
                rule.prev ?? rule.previous ?? rule.from ?? rule.after;
            const ruleNext =
                rule.next ?? rule.current ?? rule.to ?? rule.before;

            if (
                !this.matchesSpacingSelector(rulePrev, prevType) ||
                !this.matchesSpacingSelector(ruleNext, nextType)
            ) {
                continue;
            }

            const priority = isNumber(rule.priority) ? rule.priority : 0;
            if (priority > bestPriority) {
                bestPriority = priority;
                bestRule = rule;
            }
        }

        if (bestRule) {
            const pt =
                bestRule.pt ??
                bestRule.points ??
                bestRule.spacingPt ??
                bestRule.spacing_pt ??
                null;

            if (isNumber(pt)) {
                this._trace(
                    `    spacingPolicy: matched pair rule prev=${prevType} next=${nextType} → ${pt}pt (priority=${bestPriority})`
                );
                return pt;
            }

            const emVal =
                bestRule.em ??
                bestRule.spacingEm ??
                bestRule.spacing_em ??
                bestRule.spacing ??
                bestRule.beforeEm ??
                bestRule.before_em ??
                null;

            if (isNumber(emVal)) {
                this._trace(
                    `    spacingPolicy: matched pair rule prev=${prevType} next=${nextType} → ${emVal}em = ${(
                        emVal * em
                    ).toFixed(1)}pt (priority=${bestPriority})`
                );
                return emVal * em;
            }

            // Matched rule explicitly provides no spacing -> 0
            this._trace(
                `    spacingPolicy: matched pair rule prev=${prevType} next=${nextType} → 0pt (no value, priority=${bestPriority})`
            );
            return 0;
        }

        if (perTypeDefaults) {
            const v = perTypeDefaults[nextType];
            if (isNumber(v)) {
                return v * em;
            }
        }

        return null;
    }

    /**
     * @param {any} selector
     * @param {NodeType | null} actual
     * @returns {boolean}
     */
    matchesSpacingSelector(selector, actual) {
        if (selector === undefined || selector === "*" || selector === "any") {
            return true;
        }
        if (selector === null) {
            return actual === null;
        }
        if (Array.isArray(selector)) {
            for (let i = 0, len = selector.length; i < len; i++) {
                if (selector[i] === actual) {
                    return true;
                }
            }
            return false;
        }
        return selector === actual;
    }

    /**
     * Check if a page selector matches the current page
     * @param {PageSelector | undefined} selector
     * @param {number} pageNumber
     * @param {number} totalPages
     * @param {number} sectionPageNumber
     * @param {number} sectionTotalPages
     * @returns {boolean}
     */
    matchesPageSelector(
        selector,
        pageNumber,
        totalPages,
        sectionPageNumber,
        sectionTotalPages
    ) {
        // No selector or "all" matches everything
        if (!selector || selector === "all") {
            return true;
        }

        // String selectors
        if (isString(selector)) {
            switch (selector) {
                case "first":
                    // First page of document
                    return pageNumber === 1;
                case "not-first":
                    // All pages except first page of document
                    return pageNumber !== 1;
                case "last":
                    // Last page of document
                    return pageNumber === totalPages;
                case "not-last":
                    // All pages except last page of document
                    return pageNumber !== totalPages;
                case "odd":
                    return pageNumber % 2 === 1;
                case "even":
                    return pageNumber % 2 === 0;
                case "section-first":
                    // First page of current section
                    return sectionPageNumber === 1;
                case "section-not-first":
                    // Not first page of current section
                    return sectionPageNumber !== 1;
                default:
                    return true;
            }
        }

        // Array of page numbers
        if (Array.isArray(selector)) {
            return selector.includes(pageNumber);
        }

        // Function selector
        if (typeof selector === "function") {
            return selector(
                pageNumber,
                totalPages,
                sectionPageNumber,
                sectionTotalPages
            );
        }

        return true;
    }

    /**
     * Calculate header/footer offset matching LayoutEngine (reserve space above/below content).
     * @param {HeaderFooterConfig} config
     * @returns {number}
     */
    calculateHeaderFooterOffset(config) {
        const leftFontSize = config.columns.left?.style?.fontSize ?? 0;
        const centerFontSize = config.columns.center?.style?.fontSize ?? 0;
        const rightFontSize = config.columns.right?.style?.fontSize ?? 0;
        const maxFontSize =
            Math.max(leftFontSize, centerFontSize, rightFontSize) || 10;
        // Keep in sync with LayoutEngine.mjs
        return maxFontSize + (config.border ? 18 : 12);
    }

    /**
     * Calculate MAX offset across a set of header/footer configs.
     * @param {ReadonlyArray<HeaderFooterConfig>} configs
     * @returns {number}
     */
    calculateMaxHeaderFooterOffset(configs) {
        let maxOffset = 0;
        for (let i = 0, len = configs.length; i < len; i++) {
            const offset = this.calculateHeaderFooterOffset(configs[i]);
            if (offset > maxOffset) {
                maxOffset = offset;
            }
        }
        return maxOffset;
    }

    // =========================================================================
    // Page Management
    // =========================================================================

    /**
     * Start a new page
     * @param {PdfBuildState} state
     * @param {string} sectionId
     * @returns {PdfPage}
     */
    newPage(state, sectionId) {
        const pageNumber = state.pages.length + 1;

        // Calculate section page number
        let sectionPageNumber = 1;
        for (let i = state.pages.length - 1; i >= 0; i--) {
            if (state.pages[i].sectionId === sectionId) {
                sectionPageNumber = state.pages[i].sectionPageNumber + 1;
                break;
            }
        }

        // Get section config for header/footer info
        const sectionConfig = state.sectionConfigs.get(sectionId);

        // Determine headers/footers for this page
        // Use section-specific if available, otherwise fall back to canonical (from sections/renderer)
        const headers = sectionConfig?.headers?.length
            ? sectionConfig.headers
            : state.canonicalHeaders;
        const footers = sectionConfig?.footers?.length
            ? sectionConfig.footers
            : state.canonicalFooters;

        // Cover-page overrides (suppress header/footer + optional space reservation)
        const coverCfg = this.config.coverConfig;
        const isCover = sectionId === "cover" && !!coverCfg;
        const isToc = sectionId === "toc";
        const isSigning = sectionId === "signing";
        const isDustCover = sectionId === "dust-cover";

        const coverSuppressHeader = isCover && coverCfg.suppressHeader === true;
        const coverSuppressFooter =
            isCover &&
            (coverCfg.suppressFooter === true ||
                coverCfg.suppressPageNumbering === true);

        const reserveCoverSpace = isCover
            ? coverCfg.reserveHeaderFooterSpace === true
            : true;

        const headerMaxOffset = this.calculateMaxHeaderFooterOffset(headers);
        const footerMaxOffset = this.calculateMaxHeaderFooterOffset(footers);

        // If headers are suppressed (cover/TOC/signing), don't shift the content down.
        const headerOffset =
            isToc || isSigning || isDustCover || coverSuppressHeader
                ? 0
                : headerMaxOffset;

        // Signing pages never reserve footer space.
        // For cover pages, only reserve footer space if it's actually rendered,
        // unless reserveHeaderFooterSpace is explicitly enabled.
        const footerOffset = isSigning
            ? 0
            : isDustCover
            ? 0
            : isCover
            ? coverSuppressFooter
                ? reserveCoverSpace
                    ? footerMaxOffset
                    : 0
                : footerMaxOffset
            : footerMaxOffset;

        // Resolve page base margins.
        // For cover pages, coverConfig.contentMargins / coverConfig.coverLayout.contentMargins
        // override the default page margins at page-creation time.
        const coverMarginOverrides = isCover
            ? isObject(coverCfg?.contentMargins)
                ? coverCfg.contentMargins
                : isObject(coverCfg?.coverLayout?.contentMargins)
                ? coverCfg.coverLayout.contentMargins
                : null
            : null;

        const resolvedBaseMargins = {
            top: numberOr(coverMarginOverrides?.top) ?? state.baseMargins.top,
            bottom:
                numberOr(coverMarginOverrides?.bottom) ??
                state.baseMargins.bottom,
            left:
                numberOr(coverMarginOverrides?.left) ?? state.baseMargins.left,
            right:
                numberOr(coverMarginOverrides?.right) ?? state.baseMargins.right
        };

        // Adjust effective margins
        state.margins.left = resolvedBaseMargins.left;
        state.margins.right = resolvedBaseMargins.right;
        state.margins.top = resolvedBaseMargins.top + headerOffset;
        state.margins.bottom = resolvedBaseMargins.bottom + footerOffset;
        state.contentWidth =
            state.pageWidth - state.margins.left - state.margins.right;
        state.contentHeight =
            state.pageHeight - state.margins.top - state.margins.bottom;

        this._trace(
            `  newPage(${sectionId}) → page #${pageNumber} sectionPage=${sectionPageNumber} ` +
                `margins: L=${state.margins.left.toFixed(
                    1
                )} R=${state.margins.right.toFixed(1)} ` +
                `T=${state.margins.top.toFixed(
                    1
                )} B=${state.margins.bottom.toFixed(1)} ` +
                `headerOffset=${headerOffset.toFixed(
                    1
                )} footerOffset=${footerOffset.toFixed(1)} ` +
                `contentWidth=${state.contentWidth.toFixed(
                    1
                )} contentHeight=${state.contentHeight.toFixed(1)}`
        );

        /** @type {PdfPage} */
        const page = {
            pageNumber,
            sectionId,
            sectionPageNumber,
            contentBuilder: new PdfContentStreamBuilder(),
            headerFooterBuilder: new PdfContentStreamBuilder(),
            linkAnnotations: [],
            sectionTotalPages: 0
        };

        state.pages.push(page);
        state.currentPage = page;
        state.currentY = state.pageHeight - state.margins.top;

        // Reset lastNodeType on new page to avoid top spacing
        state.lastNodeType = null;

        // Reset ink tracking (content edge) for this new page
        state.lastInkBottomY = null;
        state.lastInkPageIndex = state.pages.length - 1;

        this._trace(
            `  newPage(${sectionId}) → page #${pageNumber} sectionPage=${sectionPageNumber} margins: T=${state.margins.top.toFixed(
                1
            )} B=${state.margins.bottom.toFixed(
                1
            )} headerOffset=${headerOffset.toFixed(
                1
            )} footerOffset=${footerOffset.toFixed(
                1
            )} contentHeight=${state.contentHeight.toFixed(
                1
            )} startY=${state.currentY.toFixed(1)}`
        );

        return page;
    }

    /**
     * Add page annotation to current page
     * @param {PdfBuildState} state
     * @param {LinkAnnotation | { type: "form"; fieldType: "text" | "signature"; name: string; tooltip?: string; x: number; y: number; width: number; height: number; value?: string; readOnly?: boolean; required?: boolean; fontSize?: number; maxLength?: number }} annotation
     * @returns {void}
     */
    addPageAnnotation(state, annotation) {
        const page = /** @type {PdfPage} */ (state.currentPage);
        page.linkAnnotations.push(annotation);
    }

    /**
     * Add link annotation to current page
     * @param {PdfBuildState} state
     * @param {LinkAnnotation} annotation
     * @returns {void}
     */
    addLinkAnnotation(state, annotation) {
        this.addPageAnnotation(state, annotation);
    }

    /**
     * Add form-field annotation to current page
     * @param {PdfBuildState} state
     * @param {{ type: "form"; fieldType: "text" | "signature"; name: string; tooltip?: string; x: number; y: number; width: number; height: number; value?: string; readOnly?: boolean; required?: boolean; fontSize?: number; maxLength?: number }} annotation
     * @returns {void}
     */
    addFormFieldAnnotation(state, annotation) {
        this.addPageAnnotation(state, annotation);
    }

    // =========================================================================
    // Font Helpers
    // =========================================================================

    /**
     * Get PDF font name for style
     * @param {PdfBuildState} state
     * @param {boolean} bold
     * @param {boolean} [italic]
     * @param {boolean} [monospace]
     * @param {string} [semanticName]
     * @returns {string}
     */
    getFont(
        state,
        bold,
        italic = false,
        monospace = false,
        semanticName = "body"
    ) {
        if (monospace) {
            return this.getSemanticStyledFont(
                state,
                "code",
                state.fonts.monospace,
                { monospace: true }
            );
        }

        let fallbackFont = state.fonts.regular;

        if (bold && italic) {
            fallbackFont =
                state.fonts.boldItalic ||
                state.fonts.bold ||
                state.fonts.italic ||
                state.fonts.regular;
        } else if (bold) {
            fallbackFont = state.fonts.bold;
        } else if (italic) {
            fallbackFont = state.fonts.italic;
        }

        return this.getSemanticStyledFont(state, semanticName, fallbackFont, {
            bold,
            italic
        });
    }

    /**
     * @param {PdfBuildState} state
     * @param {string} roleName
     * @param {string} fallbackFont
     * @returns {string}
     */
    getFontByRole(state, roleName, fallbackFont) {
        const value = this.lookupFontRole(state, roleName);
        return value ?? fallbackFont;
    }

    /**
     * @param {PdfBuildState} state
     * @param {string} roleName
     * @returns {string | undefined}
     */
    lookupFontRole(state, roleName) {
        if (!state.fontRoles || !isString(roleName) || roleName.length === 0) {
            return undefined;
        }

        const normalizedRoleName =
            roleName in state.fontRoles
                ? roleName
                : roleName.replace(/[_-]+([a-zA-Z0-9])/g, (_, chr) =>
                      chr.toUpperCase()
                  );

        const value = state.fontRoles[normalizedRoleName];

        /*this._trace(
            `lookupFontRole role=${normalizedRoleName} value=${JSON.stringify(
                value
            )}`
        );*/

        return isString(value) && value.length > 0 ? value : undefined;
    }

    /**
     * @param {unknown} rawLevel
     * @returns {number | undefined}
     */
    parseHeadingLevelAlias(rawLevel) {
        if (typeof rawLevel === "number" && Number.isFinite(rawLevel)) {
            return rawLevel >= 1 ? Math.floor(rawLevel) : undefined;
        }

        if (typeof rawLevel !== "string") {
            return undefined;
        }

        const value = rawLevel.trim();
        if (value.length === 0) {
            return undefined;
        }

        const match = /^(?:h|heading[_-]?)(\d+)$|^(\d+)$/.exec(value);
        if (!match) {
            return undefined;
        }

        const rawNumber = match[1] ?? match[2];
        const parsed = Number.parseInt(rawNumber, 10);
        return Number.isFinite(parsed) && parsed >= 1 ? parsed : undefined;
    }

    /**
     * @param {number | string} level
     * @returns {Array<string | number>}
     */
    getHeadingLevelAliases(level) {
        /** @type {number} */
        let normalizedLevel = 1;

        if (isNumber(level) && level >= 1) {
            normalizedLevel = Math.floor(level);
        } else if (isString(level)) {
            try {
                normalizedLevel = parseInt(level.replace(/[^0-9]+/g, ""));
            } catch (_err) {
                // noop
            }
        }

        return [
            `heading_${normalizedLevel}`,
            `heading-${normalizedLevel}`,
            `heading${normalizedLevel}`,
            `h${normalizedLevel}`,
            String(normalizedLevel),
            normalizedLevel
        ];
    }

    /**
     * @template T
     * @param {Record<string, T> | null | undefined} source
     * @param {number | string} level
     * @returns {T | undefined}
     */
    getHeadingLevelAliasedValue(source, level) {
        if (!source) {
            return undefined;
        }

        const aliases = this.getHeadingLevelAliases(level);
        for (let i = 0, len = aliases.length; i < len; i++) {
            const alias = aliases[i];
            if (hasProperty(source, String(alias))) {
                return source[alias];
            }
        }

        return undefined;
    }

    /**
     * @param {unknown} rawLevel
     * @returns {number | undefined}
     */
    parseLevelAlias(rawLevel) {
        if (typeof rawLevel === "number" && Number.isFinite(rawLevel)) {
            return rawLevel >= 1 ? Math.floor(rawLevel) : undefined;
        }

        if (typeof rawLevel !== "string") {
            return undefined;
        }

        const value = rawLevel.trim();
        if (value.length === 0) {
            return undefined;
        }

        const match = /^(?:h|heading[_-]?)(\d+)$|^(\d+)$/.exec(value);
        if (!match) {
            return undefined;
        }

        const rawNumber = match[1] ?? match[2];
        const parsed = Number.parseInt(rawNumber, 10);
        return Number.isFinite(parsed) && parsed >= 1 ? parsed : undefined;
    }

    /**
     * @param {string} semanticName
     * @returns {string}
     */
    resolveSemanticFontRoleName(semanticName) {
        const exactMapped = this.fontRoleDefaults?.[semanticName];
        if (typeof exactMapped === "string" && exactMapped.length > 0) {
            return exactMapped;
        }

        const aliasedLevel = this.parseLevelAlias(semanticName);
        if (typeof aliasedLevel === "number") {
            const aliasedMapped = this.getHeadingLevelAliasedValue(
                this.fontRoleDefaults,
                aliasedLevel
            );

            return typeof aliasedMapped === "string" && aliasedMapped.length > 0
                ? aliasedMapped
                : semanticName;
        }

        return semanticName;
    }

    /**
     * @param {string} roleName
     * @param {{ bold?: boolean, italic?: boolean, monospace?: boolean }} [options]
     * @returns {string[]}
     */
    buildFontRoleCandidates(roleName, options = {}) {
        const bold = options.bold === true;
        const italic = options.italic === true;
        const monospace = options.monospace === true;

        /** @type {string[]} */
        const candidates = [];

        if (monospace) {
            candidates.push(
                `${roleName}_monospace`,
                `${roleName}_mono`,
                roleName
            );
            return candidates;
        }

        if (bold && italic) {
            candidates.push(
                `${roleName}_bold_italic`,
                `${roleName}_boldItalic`,
                `${roleName}_bolditalic`,
                `${roleName}_bold-italic`,
                `${roleName}_italic_bold`,
                roleName
            );
            return candidates;
        }

        if (bold) {
            candidates.push(`${roleName}_bold`, roleName);
            return candidates;
        }

        if (italic) {
            candidates.push(`${roleName}_italic`, roleName);
            return candidates;
        }

        candidates.push(`${roleName}_regular`, roleName);
        return candidates;
    }

    /**
     * @param {PdfBuildState} state
     * @param {string} semanticName
     * @param {string} fallbackFont
     * @returns {string}
     */
    getSemanticFont(state, semanticName, fallbackFont) {
        const mapped = this.resolveSemanticFontRoleName(semanticName);
        return this.getFontByRole(state, mapped, fallbackFont);
    }

    /**
     * @param {PdfBuildState} state
     * @param {string} semanticName
     * @param {string} fallbackFont
     * @param {{ bold?: boolean, italic?: boolean, monospace?: boolean }} [options]
     * @returns {string}
     */
    getSemanticStyledFont(state, semanticName, fallbackFont, options = {}) {
        const mapped = this.resolveSemanticFontRoleName(semanticName);
        const candidates = this.buildFontRoleCandidates(mapped, options);

        /*this._trace(
            `getSemanticStyledFont semantic=${semanticName} mapped=${mapped} candidates=${JSON.stringify(
                candidates
            )}`
        );*/

        for (let i = 0, len = candidates.length; i < len; i++) {
            const value = this.lookupFontRole(state, candidates[i]);

            /*this._trace(
                `getSemanticStyledFont candidate=${
                    candidates[i]
                } resolved=${JSON.stringify(value)}`
            );*/

            if (value) {
                return value;
            }
        }

        if (fallbackFont) {
            return fallbackFont;
        }

        return this.lookupFontRole(state, mapped) ?? this.fontConfig.regular;
    }

    /**
     * @param {number} level
     * @returns {string}
     */
    getHeadingSemanticRole(level) {
        const normalizedLevel =
            Number.isFinite(level) && level >= 1 ? Math.floor(level) : 1;
        return `heading_${normalizedLevel}`;
    }

    /**
     * @param {number} level
     * @returns {number}
     */
    getHeadingScale(level) {
        const normalizedLevel =
            Number.isFinite(level) && level >= 1 ? Math.floor(level) : 1;

        const configuredScales = isObject(this.config.headingScales)
            ? this.config.headingScales
            : null;

        /** @type {Record<number, number>} */
        const defaultScales = {
            1: 2.0,
            2: 1.5,
            3: 1.25,
            4: 1.1,
            5: 1.0,
            6: 0.9
        };

        if (!configuredScales) {
            return defaultScales[normalizedLevel] ?? 1;
        }

        const candidates = this.getHeadingLevelAliases(normalizedLevel);

        for (let i = 0, len = candidates.length; i < len; i++) {
            const candidate = candidates[i];
            const value = numberOr(configuredScales[candidate], undefined);
            if (
                typeof value === "number" &&
                Number.isFinite(value) &&
                value > 0
            ) {
                return value;
            }
        }

        return defaultScales[normalizedLevel] ?? 1;
    }

    /**
     * @param {PdfBuildState} state
     * @param {string} coverRoleName
     * @param {string} fallbackFont
     * @returns {string}
     */
    getCoverFont(state, coverRoleName, fallbackFont) {
        const coverConfig = this.config.coverConfig ?? {};
        const coverRoles = coverConfig.fontRoles ?? {};
        const mapped =
            typeof coverRoles[coverRoleName] === "string"
                ? coverRoles[coverRoleName]
                : coverRoleName;
        return this.getFontByRole(state, mapped, fallbackFont);
    }

    /**
     * @param {PdfDocumentBuilder} doc
     * @returns {void}
     */
    registerFonts(doc) {
        const namedFontKeys =
            doc.namedFonts instanceof Map ? [...doc.namedFonts.keys()] : [];
        this._trace(
            `registerFonts namedFonts=${JSON.stringify(namedFontKeys)}`
        );

        this.registerEmbeddedFonts(doc);

        const fontNames = [
            this.fontConfig.regular,
            this.fontConfig.bold,
            this.fontConfig.italic,
            this.fontConfig.boldItalic,
            this.fontConfig.monospace
        ];

        const seen = new Set();
        for (let i = 0, len = fontNames.length; i < len; i++) {
            const fontName = fontNames[i];
            if (
                typeof fontName === "string" &&
                fontName.length > 0 &&
                !seen.has(fontName) &&
                !(doc.namedFonts instanceof Map && doc.namedFonts.has(fontName))
            ) {
                seen.add(fontName);
                doc.registerFont(fontName);
            }
        }
    }

    /**
     * @param {PdfDocumentBuilder} doc
     * @returns {void}
     */
    registerEmbeddedFonts(doc) {
        const cfg = this.embeddedFontsConfig;
        if (!isObject(cfg) || cfg.enabled === false) {
            return;
        }

        const families = isObject(cfg.families) ? cfg.families : {};
        for (const familyKey of Object.keys(families)) {
            const family = families[familyKey];
            if (!isObject(family)) {
                continue;
            }
            const faces = isObject(family.faces) ? family.faces : {};
            const faceKeys = [
                "regular",
                "bold",
                "italic",
                "boldItalic",
                "bold_italic"
            ];
            for (let i = 0, len = faceKeys.length; i < len; i++) {
                const faceKey = faceKeys[i];
                this.registerEmbeddedFontFace(
                    doc,
                    cfg,
                    faces[faceKey],
                    faceKey
                );
            }
        }
    }

    /**
     * @param {PdfDocumentBuilder} doc
     * @param {Record<string, unknown>} embeddedFontsConfig
     * @param {unknown} face
     * @param {string} [faceKey] - role name ("regular", "bold", etc.) for fallback resolution
     * @param {Set<string>} [fallbackSeenAliases]
     * @returns {void}
     */
    registerEmbeddedFontFace(
        doc,
        embeddedFontsConfig,
        face,
        faceKey,
        fallbackSeenAliases = new Set()
    ) {
        if (!isObject(face) || face.embed === false) {
            return;
        }

        const relativePath = stringOr(
            face.path,
            stringOr(face.file, undefined)
        );

        const googleFont = isObject(face.googleFont)
            ? face.googleFont
            : isObject(face.google_font)
            ? face.google_font
            : null;

        const postScriptName = stringOr(
            face.postscriptName,
            stringOr(
                face.postscript_name,
                this.defaultEmbeddedFontAlias(relativePath, googleFont, faceKey)
            )
        );

        if (
            doc.namedFonts instanceof Map &&
            doc.namedFonts.has(postScriptName)
        ) {
            return;
        }

        try {
            const loaded = this._loadEmbeddedFontBytes(
                embeddedFontsConfig,
                face,
                faceKey
            );
            if (!loaded) {
                return;
            }
            doc.registerFont(postScriptName, loaded.rawBytes);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const sourceLabel = this._describeEmbeddedFontSource(face, faceKey);
            this.warnings.push(
                `Embedded font failed: ${sourceLabel} (${message})`
            );
            this._registerEmbeddedFontFallbackAlias(
                doc,
                embeddedFontsConfig,
                postScriptName,
                face,
                faceKey,
                fallbackSeenAliases
            );
        }
    }

    /**
     * @param {string | undefined} filePath
     * @param {Record<string, unknown> | null} googleFont
     * @param {string | undefined} faceKey
     * @returns {string}
     */
    defaultEmbeddedFontAlias(filePath, googleFont, faceKey) {
        if (typeof filePath === "string" && filePath.length > 0) {
            const normalized = filePath.replace(/\\/g, "/");
            const fileName = normalized.split("/").pop() ?? "EmbeddedFont";
            return fileName.replace(/\.[^.]+$/, "");
        }

        if (isObject(googleFont)) {
            const familyName = normaliseFontFamily(
                stringOr(googleFont.family, undefined)
            );
            if (familyName.length > 0) {
                const compactFamily = familyName.replace(/[^A-Za-z0-9]+/g, "");
                const suffix =
                    faceKey === "bold_italic" || faceKey === "boldItalic"
                        ? "BoldItalic"
                        : faceKey === "bold"
                        ? "Bold"
                        : faceKey === "italic"
                        ? "Italic"
                        : "Regular";
                return `${compactFamily}-${suffix}`;
            }
        }

        return "EmbeddedFont";
    }

    /**
     * @param {Record<string, unknown>} embeddedFontsConfig
     * @param {unknown} face
     * @param {string|undefined} faceKey
     * @returns {{ rawBytes: Uint8Array, sourceLabel: string } | null}
     * @private
     */
    _loadEmbeddedFontBytes(embeddedFontsConfig, face, faceKey) {
        if (!isObject(face)) {
            return null;
        }

        const relativePath = stringOr(
            face.path,
            stringOr(face.file, undefined)
        );
        if (relativePath) {
            const resolvedPath = this.resolveEmbeddedFontPath(
                embeddedFontsConfig,
                relativePath
            );
            const cacheKey = `file:${resolvedPath}`;
            const cachedBytes = this._embeddedFontBytesCache.get(cacheKey);
            if (cachedBytes) {
                return {
                    rawBytes: cachedBytes,
                    sourceLabel: resolvedPath
                };
            }
            if (!existsSync(resolvedPath)) {
                throw new Error(`missing font file: ${resolvedPath}`);
            }
            const rawBytes = new Uint8Array(readFileSync(resolvedPath));
            this._embeddedFontBytesCache.set(cacheKey, rawBytes);
            return {
                rawBytes,
                sourceLabel: resolvedPath
            };
        }

        const googleFont = isObject(face.googleFont)
            ? face.googleFont
            : isObject(face.google_font)
            ? face.google_font
            : null;
        if (googleFont) {
            return this._loadGoogleFontBytes(
                embeddedFontsConfig,
                googleFont,
                faceKey
            );
        }

        return null;
    }

    /**
     * @param {Record<string, unknown>} googleFont
     * @returns {number}
     */
    _readGoogleFontWeight(googleFont) {
        const rawWeight = googleFont.weight;
        if (typeof rawWeight === "number" && Number.isFinite(rawWeight)) {
            return parseFontWeight(String(rawWeight));
        }
        return parseFontWeight(stringOr(rawWeight, "400"));
    }

    /**
     * @param {Record<string, unknown>} embeddedFontsConfig
     * @param {Record<string, unknown>} googleFont
     * @param {string|undefined} faceKey
     * @returns {{ rawBytes: Uint8Array, sourceLabel: string }}
     * @private
     */
    _loadGoogleFontBytes(embeddedFontsConfig, googleFont, faceKey) {
        const family = normaliseFontFamily(
            stringOr(googleFont.family, undefined)
        );
        if (family.length === 0) {
            throw new Error("google_font.family is required");
        }

        const weight = this._readGoogleFontWeight(googleFont);
        const style = parseFontStyle(stringOr(googleFont.style, "normal"));
        const cssUrl = this._buildGoogleFontCssUrl(family, weight, style);
        const cacheKey = `${family}|${weight}|${style}|${cssUrl}`;
        const cached = this._googleFontBytesCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const cacheDir =
            embeddedFontsConfig.cacheDir === null ||
            embeddedFontsConfig.cache_dir === null
                ? null
                : stringOr(
                      embeddedFontsConfig.cacheDir,
                      stringOr(
                          embeddedFontsConfig.cache_dir,
                          ".solomon-font-cache"
                      )
                  );

        const allowedHosts = Array.isArray(embeddedFontsConfig.allowedFontHosts)
            ? /** @type {string[]} */ (embeddedFontsConfig.allowedFontHosts)
            : Array.isArray(embeddedFontsConfig.allowed_font_hosts)
            ? /** @type {string[]} */ (embeddedFontsConfig.allowed_font_hosts)
            : ["fonts.googleapis.com", "fonts.gstatic.com"];

        const fetcher = new GoogleFontFetcher({
            cacheDir,
            verbose: this._verbose,
            allowedHosts
        });
        const requestedFaces = new Map();
        requestedFaces.set(family, { weight, style });
        const fetched = fetcher.fetch([cssUrl], requestedFaces);
        const font = fetched.get(family);
        if (!font) {
            throw new Error(
                `google font fetch produced no embeddable font for ${family}`
            );
        }

        const result = {
            rawBytes: font.bytes,
            sourceLabel: cssUrl
        };
        this._googleFontBytesCache.set(cacheKey, result);
        return result;
    }

    /**
     * @param {string} family
     * @param {number} weight
     * @param {"normal"|"italic"} style
     * @returns {string}
     * @private
     */
    _buildGoogleFontCssUrl(family, weight, style) {
        const encodedFamily = family.trim().replace(/\s+/g, "+");
        if (style === "italic") {
            return `https://fonts.googleapis.com/css2?family=${encodedFamily}:ital,wght@1,${weight}&display=swap`;
        }
        return `https://fonts.googleapis.com/css2?family=${encodedFamily}:wght@${weight}&display=swap`;
    }

    /**
     * @param {unknown} face
     * @param {string|undefined} faceKey
     * @returns {string}
     * @private
     */
    _describeEmbeddedFontSource(face, faceKey) {
        if (!isObject(face)) {
            return faceKey ?? "embedded-font";
        }

        const relativePath = stringOr(
            face.path,
            stringOr(face.file, undefined)
        );
        if (relativePath) {
            return relativePath;
        }

        const googleFont = isObject(face.googleFont)
            ? face.googleFont
            : isObject(face.google_font)
            ? face.google_font
            : null;
        if (googleFont) {
            const family = normaliseFontFamily(
                stringOr(googleFont.family, undefined)
            );
            const weight = this._readGoogleFontWeight(googleFont);
            const style = parseFontStyle(stringOr(googleFont.style, "normal"));
            return `${family || "google-font"} (${style}, ${weight})`;
        }

        return faceKey ?? "embedded-font";
    }

    /**
     * Resolve the built-in PDF fallback font for a failed embedded face.
     * Resolution order:
     *   1. face.fallback  (per-face override in the pack config)
     *   2. embeddedFontsConfig.fallbacks[role]  (global by role, from FontFetcher)
     *   3. Hard-coded Times defaults by role heuristic
     * @param {Record<string, unknown>} embeddedFontsConfig
     * @param {unknown} face
     * @param {string|undefined} faceKey
     * @returns {string}
     * @private
     */
    _resolveFontFallback(embeddedFontsConfig, face, faceKey) {
        // 1. Per-face override
        if (isObject(face)) {
            const perFace = stringOr(face.fallback, undefined);
            if (perFace) {
                return perFace;
            }
        }

        // Normalise bold_italic → boldItalic for map lookups
        const canonKey =
            faceKey === "bold_italic" ? "boldItalic" : faceKey ?? "";

        // 2. Role-level from embedded_fonts.fallbacks
        if (canonKey) {
            const fallbacks = isObject(embeddedFontsConfig.fallbacks)
                ? embeddedFontsConfig.fallbacks
                : null;
            if (fallbacks) {
                const v = stringOr(fallbacks[canonKey], undefined);
                if (v) {
                    return v;
                }
            }
        }

        // 3. Hard-coded defaults
        const DEFAULTS = /** @type {Record<string, string>} */ ({
            regular: "Times-Roman",
            bold: "Times-Bold",
            italic: "Times-Italic",
            boldItalic: "Times-BoldItalic",
            monospace: "Courier"
        });
        return DEFAULTS[canonKey] ?? "Times-Roman";
    }

    /**
     * @param {PdfDocumentBuilder} doc
     * @param {Record<string, unknown>} embeddedFontsConfig
     * @param {string} alias
     * @param {unknown} face
     * @param {string|undefined} faceKey
     * @param {Set<string>} fallbackSeenAliases
     * @returns {void}
     * @private
     */
    _registerEmbeddedFontFallbackAlias(
        doc,
        embeddedFontsConfig,
        alias,
        face,
        faceKey,
        fallbackSeenAliases
    ) {
        const fallbackTarget = this._resolveFontFallback(
            embeddedFontsConfig,
            face,
            faceKey
        );

        if (
            typeof fallbackTarget === "string" &&
            fallbackTarget.length > 0 &&
            this._ensureEmbeddedFontAliasRegistered(
                doc,
                embeddedFontsConfig,
                fallbackTarget,
                fallbackSeenAliases
            )
        ) {
            doc.registerBuiltinAlias(alias, fallbackTarget);
            return;
        }

        doc.registerBuiltinAlias(alias, fallbackTarget);
    }

    /**
     * @param {PdfDocumentBuilder} doc
     * @param {Record<string, unknown>} embeddedFontsConfig
     * @param {string} alias
     * @param {Set<string>} fallbackSeenAliases
     * @returns {boolean}
     * @private
     */
    _ensureEmbeddedFontAliasRegistered(
        doc,
        embeddedFontsConfig,
        alias,
        fallbackSeenAliases
    ) {
        if (typeof alias !== "string" || alias.length === 0) {
            return false;
        }

        if (doc.namedFonts instanceof Map && doc.namedFonts.has(alias)) {
            return true;
        }

        const prior = this._embeddedFontAliasResolutionCache.get(alias);
        if (prior === true) {
            return true;
        }
        if (prior === false || fallbackSeenAliases.has(alias)) {
            return false;
        }

        const match = this._findEmbeddedFontFaceByAlias(
            embeddedFontsConfig,
            alias
        );
        if (!match) {
            this._embeddedFontAliasResolutionCache.set(alias, false);
            return false;
        }

        const nextSeenAliases = new Set(fallbackSeenAliases);
        nextSeenAliases.add(alias);

        this.registerEmbeddedFontFace(
            doc,
            embeddedFontsConfig,
            match.face,
            match.faceKey,
            nextSeenAliases
        );

        const ok = doc.namedFonts instanceof Map && doc.namedFonts.has(alias);
        this._embeddedFontAliasResolutionCache.set(alias, ok);
        return ok;
    }

    /**
     * @param {Record<string, unknown>} embeddedFontsConfig
     * @param {string} alias
     * @returns {{ face: Record<string, unknown>, faceKey: string } | null}
     * @private
     */
    _findEmbeddedFontFaceByAlias(embeddedFontsConfig, alias) {
        const families = isObject(embeddedFontsConfig.families)
            ? embeddedFontsConfig.families
            : {};

        for (const familyKey of Object.keys(families)) {
            const family = families[familyKey];
            if (!isObject(family)) {
                continue;
            }

            const faces = isObject(family.faces) ? family.faces : {};
            for (const faceKey of Object.keys(faces)) {
                const face = faces[faceKey];
                if (!isObject(face)) {
                    continue;
                }

                const relativePath = stringOr(
                    face.path,
                    stringOr(face.file, undefined)
                );
                const googleFont = isObject(face.googleFont)
                    ? face.googleFont
                    : isObject(face.google_font)
                    ? face.google_font
                    : null;
                const faceAlias = stringOr(
                    face.postscriptName,
                    stringOr(
                        face.postscript_name,
                        this.defaultEmbeddedFontAlias(
                            relativePath,
                            googleFont,
                            faceKey
                        )
                    )
                );

                if (faceAlias === alias) {
                    return {
                        face,
                        faceKey
                    };
                }
            }
        }

        return null;
    }

    /**
     * @param {Record<string, unknown>} embeddedFontsConfig
     * @param {string} relativeOrAbsolutePath
     * @returns {string}
     */
    resolveEmbeddedFontPath(embeddedFontsConfig, relativeOrAbsolutePath) {
        if (
            isAbsolute(relativeOrAbsolutePath) ||
            /^[A-Za-z]:\\/.test(relativeOrAbsolutePath)
        ) {
            return relativeOrAbsolutePath;
        }

        const baseDir = stringOr(
            embeddedFontsConfig.baseDir,
            stringOr(embeddedFontsConfig.base_dir, undefined)
        );

        return baseDir
            ? resolvePath(baseDir, relativeOrAbsolutePath)
            : resolvePath(relativeOrAbsolutePath);
    }

    /**
     * Default link color used when rendering link runs/nodes.
     * Allows packs to override via config.linkColor or config.link_color.
     *
     * @returns {string}
     */
    getLinkColorDefault() {
        const cfg = /** @type {any} */ (this.config);
        return stringOr(cfg.linkColor, cfg.link_color) ?? "#0B3D91";
    }

    /**
     * Optional override used when a link is rendered in bold text.
     * Override via config.linkColorBold or config.link_color_bold.
     *
     * @returns {string | undefined}
     */
    getLinkColorBold() {
        const cfg = /** @type {any} */ (this.config);
        return stringOr(cfg.linkColorBold, cfg.link_color_bold) ?? undefined;
    }

    /**
     * Whether links should be underlined.
     * Override via config.linkUnderline or config.link_underline.
     *
     * @returns {boolean}
     */
    getLinkUnderline() {
        const cfg = /** @type {any} */ (this.config);
        const v = cfg.linkUnderline ?? cfg.link_underline;
        return typeof v === "boolean" ? v : false;
    }

    /**
     * Resolve link color for a run/node, with optional bold override.
     *
     * @param {{ bold?: boolean } | undefined} run
     * @returns {string}
     */
    resolveLinkColor(run) {
        const boldColor = this.getLinkColorBold();
        if (run?.bold && boldColor) return boldColor;
        return this.getLinkColorDefault();
    }

    /**
     * Get font resource name from document builder
     * @param {PdfBuildState} state
     * @param {string} baseFont
     * @returns {string}
     */
    getFontResourceName(state, baseFont) {
        return state.doc.getFontName(baseFont);
    }

    // =========================================================================
    // Content edge tracking (ink)
    // =========================================================================

    /**
     * @param {PdfBuildState} state
     * @returns {number}
     */
    _getCurrentPageIndex(state) {
        return state.pages.length - 1;
    }

    /**
     * @param {PdfBuildState} state
     * @param {PdfContentStreamBuilder} builder
     * @returns {boolean}
     */
    _isContentBuilder(state, builder) {
        const page = state.currentPage;
        return page != null && builder === page.contentBuilder;
    }

    /**
     * Record the bottom edge of rendered "ink" (text/boxes/table borders) on the current page.
     * This intentionally ignores trailing spacing adjustments that move currentY without drawing.
     * @param {PdfBuildState} state
     * @param {number} bottomY
     * @returns {void}
     */
    _recordInkBottomY(state, bottomY) {
        const pageIndex = this._getCurrentPageIndex(state);
        if (pageIndex < 0) return;

        if (state.lastInkPageIndex !== pageIndex) {
            state.lastInkPageIndex = pageIndex;
            state.lastInkBottomY = bottomY;
            state.inkBottomYByPageIndex.set(pageIndex, bottomY);
            return;
        }

        if (state.lastInkBottomY == null) {
            state.lastInkBottomY = bottomY;
            state.inkBottomYByPageIndex.set(pageIndex, bottomY);
            return;
        }

        // Y decreases as we flow down the page: keep the lowest (smallest) Y we have seen.
        const next = Math.min(state.lastInkBottomY, bottomY);
        state.lastInkBottomY = next;
        state.inkBottomYByPageIndex.set(pageIndex, next);
    }

    /**
     * @param {PdfBuildState} state
     * @returns {number | null}
     */
    _getLastInkBottomY(state) {
        const pageIndex = this._getCurrentPageIndex(state);
        if (pageIndex < 0) return null;
        if (state.lastInkPageIndex !== pageIndex) return null;
        return state.lastInkBottomY ?? null;
    }

    /**
     * @param {string} text
     * @returns {boolean}
     */
    _textHasDeepDescenders(text) {
        // g j p q y and some fonts' Q tail.
        return /[gjpqyQ]/.test(text);
    }

    /**
     * @param {string} text
     * @returns {boolean}
     */
    _textHasShallowDescenders(text) {
        // Punctuation that typically dips slightly below the baseline.
        return /[,_;:\.]/.test(text);
    }

    /**
     * Estimate baseline→ink-bottom descent in points, biased by content.
     *
     * @param {string} text
     * @param {number} fontSize
     * @returns {number}
     */
    _estimateTextDescentPt(text, fontSize) {
        const t = isString(text) ? text : String(text ?? "");
        const hasDeep = this._textHasDeepDescenders(t);
        const hasShallow = !hasDeep && this._textHasShallowDescenders(t);

        // Conservative defaults; tuned for visual balance in mixed content.
        let factor = 0.18;
        if (hasDeep) {
            factor = 0.3;
        } else if (hasShallow) {
            factor = 0.24;
        }

        // Clamp to sane bounds.
        const min = 0.14;
        const max = 0.34;
        const clamped = Math.min(max, Math.max(min, factor));

        return fontSize * clamped;
    }

    /**
     * Heading ascenders can exceed cap-height in many fonts (lowercase b/d/f/h/k/l/t).
     * When a heading follows a horizontal rule, add a small extra before-spacing so
     * the rule-to-title gap looks consistent.
     *
     * @param {string} text
     * @param {number} headingFontSize
     * @returns {number}
     */
    _estimateHeadingAscenderBoostPt(text, headingFontSize) {
        const t = isString(text) ? text : String(text ?? "");
        // Consider only ASCII alpha for the "all caps" heuristic.
        const letters = t.replace(/[^A-Za-z]/g, "");
        const isAllCaps =
            letters.length > 0 && letters === letters.toUpperCase();

        if (isAllCaps) {
            return 0;
        }

        const hasLowerTall =
            /[bdfhklt]/.test(t) || (/[BDFHKLT]/.test(t) && /[a-z]/.test(t));

        if (!hasLowerTall) {
            return 0;
        }

        // Small, but visible. Keep a minimum so it still matters at small sizes.
        return Math.max(1.25, headingFontSize * 0.07);
    }

    /**
     * @param {PdfBuildState} state
     * @param {number} baselineY
     * @param {number} fontSize
     * @param {string} text
     * @returns {void}
     */
    _recordInkFromTextBaseline(state, baselineY, fontSize, text) {
        // Approximate font descent (baseline → bottom of glyphs).
        // Descenders (g/j/p/q/y/Q) and some punctuation dip below the baseline and
        // can make spacing around rules look "tight" even when the baseline math
        // says it's symmetric. We bias the recorded ink-bottom downward when
        // the rendered line likely contains descenders.
        const descent = this._estimateTextDescentPt(text, fontSize);
        this._recordInkBottomY(state, baselineY - descent);
    }

    // =========================================================================
    // Text Rendering Primitives
    // =========================================================================

    /**
     * Render text at position
     * @param {PdfContentStreamBuilder} builder
     * @param {PdfBuildState} state
     * @param {string | VariableRef} text
     * @param {number} x
     * @param {number} y
     * @param {number} fontSize
     * @param {string} baseFont
     * @param {HorizontalAlign} [align]
     * @param {string} [color] - Hex color
     * @returns {void}
     */
    renderTextAt(
        builder,
        state,
        text,
        x,
        y,
        fontSize,
        baseFont,
        align = "left",
        color
    ) {
        let textToUse;

        if (isString(text)) {
            textToUse = text;
        } else if (
            this.config.variables &&
            text.name in this.config.variables
        ) {
            textToUse = String(this.config.variables[text.name]);
        } else {
            return;
        }

        if (textToUse.length === 0) {
            return;
        }

        const fontName = this.getFontResourceName(state, baseFont);
        let renderX = x;

        if (align === "center" || align === "right") {
            const textWidth = measureTextWidth(textToUse, baseFont, fontSize);

            if (align === "center") {
                renderX = x - textWidth / 2;
            } else {
                renderX = x - textWidth;
            }
        }

        builder.saveState();

        // Set color if provided
        if (color) {
            const rgb = this.hexToRgb(color);
            builder.setFillColor(rgb.r, rgb.g, rgb.b);
        }

        builder
            .beginText()
            .setFont(fontName, fontSize)
            .setTextMatrix(1, 0, 0, 1, renderX, y)
            .showText(textToUse)
            .endText()
            .restoreState();

        if (this._isContentBuilder(state, builder)) {
            this._recordInkFromTextBaseline(state, y, fontSize, textToUse);
        }
    }

    /**
     * Convert hex color to RGB (0-1 range)
     * @param {string} hex
     * @returns {{ r: number; g: number; b: number }}
     */
    hexToRgb(hex) {
        const cleaned = hex.replace("#", "");
        const r = parseInt(cleaned.substring(0, 2), 16) / 255;
        const g = parseInt(cleaned.substring(2, 4), 16) / 255;
        const b = parseInt(cleaned.substring(4, 6), 16) / 255;
        return { r, g, b };
    }

    /**
     * @private
     * @param {number} value
     * @returns {number}
     */
    _clamp01(value) {
        return Math.min(1, Math.max(0, value));
    }

    /**
     * @private
     * @param {{ r: number; g: number; b: number }} rgb
     * @returns {number}
     */
    _rgbLuminance(rgb) {
        return rgb.r * 0.2126 + rgb.g * 0.7152 + rgb.b * 0.0722;
    }

    /**
     * @private
     * @param {{ r: number; g: number; b: number }} rgb
     * @param {{ r: number; g: number; b: number }} target
     * @param {number} weight
     * @returns {{ r: number; g: number; b: number }}
     */
    _mixRgb(rgb, target, weight) {
        const clampedWeight = this._clamp01(weight);
        const keep = 1 - clampedWeight;
        return {
            r: rgb.r * keep + target.r * clampedWeight,
            g: rgb.g * keep + target.g * clampedWeight,
            b: rgb.b * keep + target.b * clampedWeight
        };
    }

    /**
     * @private
     * @param {{ r: number; g: number; b: number }} rgb
     * @param {number} amount
     * @returns {{ r: number; g: number; b: number }}
     */
    _desaturateRgb(rgb, amount) {
        const clampedAmount = this._clamp01(amount);
        const gray = (rgb.r + rgb.g + rgb.b) / 3;
        const keep = 1 - clampedAmount;
        return {
            r: rgb.r * keep + gray * clampedAmount,
            g: rgb.g * keep + gray * clampedAmount,
            b: rgb.b * keep + gray * clampedAmount
        };
    }

    /**
     * @private
     * @param {{ r: number; g: number; b: number }} rgb
     * @returns {string}
     */
    _rgbToHex(rgb) {
        const toHex = (value) =>
            Math.round(this._clamp01(value) * 255)
                .toString(16)
                .padStart(2, "0");
        return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
    }

    /**
     * @private
     * @param {string|number|undefined} backgroundColor
     * @returns {string|number}
     */
    _resolveDefaultWatermarkColor(backgroundColor) {
        if (isNumber(backgroundColor) && Number.isFinite(backgroundColor)) {
            return backgroundColor <= 0.55 ? 0.76 : 0.28;
        }

        if (backgroundColor === undefined || backgroundColor === null) {
            return 0.78;
        }

        const raw = String(backgroundColor).trim();
        if (!raw || raw === "none") {
            return 0.78;
        }

        const asNumber = Number.parseFloat(raw);
        if (Number.isFinite(asNumber) && /^\d+(?:\.\d+)?$/.test(raw)) {
            return asNumber <= 0.55 ? 0.76 : 0.28;
        }

        const hex = raw.startsWith("#") ? raw : `#${raw}`;
        const rgb = this.hexToRgb(hex);
        const luminance = this._rgbLuminance(rgb);
        const mixed =
            luminance < 0.45
                ? this._mixRgb(rgb, { r: 1, g: 1, b: 1 }, 0.42)
                : this._mixRgb(rgb, { r: 0, g: 0, b: 0 }, 0.35);
        const toned = this._desaturateRgb(mixed, 0.35);
        return this._rgbToHex(toned);
    }

    /**
     * Simple text wrapper for plain text content
     * @param {string} text
     * @param {number} maxWidth
     * @param {string} font
     * @param {number} fontSize
     * @returns {string[]}
     */
    wrapText(text, maxWidth, font, fontSize) {
        if (!text) {
            return [];
        }

        const safeMaxWidth = Math.max(1, maxWidth);

        /** @type {string[]} */
        const lines = [];
        const paragraphs = String(text).split("\n");

        for (let p = 0, plen = paragraphs.length; p < plen; p++) {
            const paragraph = paragraphs[p] ?? "";
            const words = paragraph.split(/\s+/g);
            let currentLine = "";

            for (let w = 0, wlen = words.length; w < wlen; w++) {
                const word = words[w] ?? "";

                if (!word) {
                    continue;
                }

                // If a single token is wider than the available width, force-break it.
                const wordWidth = measureTextWidth(word, font, fontSize);

                if (wordWidth > safeMaxWidth) {
                    if (currentLine) {
                        lines.push(currentLine);
                        currentLine = "";
                    }

                    const broken = this.breakLongToken(
                        word,
                        safeMaxWidth,
                        font,
                        fontSize
                    );
                    if (this._verbose) {
                        this._trace(
                            `    wrapText: force-break token "${word.slice(
                                0,
                                30
                            )}${
                                word.length > 30 ? "…" : ""
                            }" (${wordWidth.toFixed(
                                1
                            )}pt > ${safeMaxWidth.toFixed(1)}pt) → ${
                                broken.length
                            } fragments`
                        );
                    }
                    for (let i = 0, ilen = broken.length; i < ilen; i++) {
                        lines.push(broken[i]);
                    }
                    continue;
                }

                const testLine = currentLine ? currentLine + " " + word : word;
                const width = measureTextWidth(testLine, font, fontSize);

                if (width <= safeMaxWidth) {
                    currentLine = testLine;
                    continue;
                }

                if (currentLine) {
                    lines.push(currentLine);
                }
                currentLine = word;
            }

            if (currentLine) {
                lines.push(currentLine);
            }
        }

        return lines;
    }

    /**
     * Force-break an unbreakable token so it cannot overflow table cells / margins.
     *
     * NOTE: Do NOT insert hyphens; contract text such as hashes/addresses must remain exact.
     *
     * @param {string} token
     * @param {number} maxWidth
     * @param {string} font
     * @param {number} fontSize
     * @returns {string[]}
     */
    breakLongToken(token, maxWidth, font, fontSize) {
        /** @type {string[]} */
        const out = [];

        let i = 0;
        const len = token.length;
        const safeMaxWidth = Math.max(1, maxWidth);

        while (i < len) {
            // Binary search the longest slice that fits.
            let lo = i + 1;
            let hi = len;
            let best = lo;

            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                const slice = token.slice(i, mid);
                const w = measureTextWidth(slice, font, fontSize);

                if (w <= safeMaxWidth) {
                    best = mid;
                    lo = mid + 1;
                } else {
                    hi = mid - 1;
                }
            }

            // Safety: ensure progress even if a single glyph overflows.
            if (best <= i) {
                best = i + 1;
            }

            out.push(token.slice(i, best));
            i = best;
        }

        return out;
    }

    /**
     * Apply a forced line break for long centered headings that would otherwise
     * fit on one line but look visually cramped.
     *
     * @param {string} text
     * @param {number} maxWidth
     * @param {string} font
     * @param {number} fontSize
     * @param {number} level
     * @param {HorizontalAlign} align
     * @returns {string}
     */
    applySmartTitleWrap(text, maxWidth, font, fontSize, level, align) {
        if (!text) return text;
        if (align !== "center" || level !== 1) {
            if (this._verbose) {
                this._trace(
                    `skipping smart title wrap due to level=${level}, text=${text}`
                );
            }

            return text;
        }

        if (text.indexOf("\n") !== -1) {
            return text;
        }

        const fullWidth = measureTextWidth(text, font, fontSize);

        // If it already fits on one line and is short, no wrapping needed.
        if (fullWidth <= maxWidth && text.length < 32) return text;

        // Prefer splitting before common prepositions for aesthetic line breaks.
        /** @type {string[]} */
        const separators = [" of ", " for ", " to ", " in ", " at ", " from "];

        const lower = text.toLowerCase();

        let bestSplit = null;
        let bestBalance = Infinity;

        for (let s = 0, slen = separators.length; s < slen; s++) {
            const sep = separators[s];
            const idx = lower.lastIndexOf(sep);

            if (idx <= 0) {
                continue;
            }

            const left = text.slice(0, idx).trimEnd();
            const right = text.slice(idx + 1).trimStart();

            if (!left || !right) {
                continue;
            }

            const leftW = measureTextWidth(left, font, fontSize);
            const rightW = measureTextWidth(right, font, fontSize);

            if (leftW > maxWidth || rightW > maxWidth) {
                continue;
            }

            const balance = Math.abs(leftW - rightW);

            if (balance < bestBalance) {
                bestBalance = balance;
                bestSplit = `${left}\n${right}`;
            }
        }
        if (bestSplit) {
            return bestSplit;
        }

        // Already fits on one line - no splitting needed.
        if (fullWidth <= maxWidth) {
            return text;
        }

        return text;
    }

    /**
     * Render wrapped paragraph text
     * @param {PdfContentStreamBuilder} builder
     * @param {PdfBuildState} state
     * @param {string} text
     * @param {number} x
     * @param {number} startY
     * @param {number} fontSize
     * @param {string} baseFont
     * @param {number} lineHeight
     * @param {number} maxWidth
     * @returns {number} Final Y position after rendering
     */
    renderWrappedText(
        builder,
        state,
        text,
        x,
        startY,
        fontSize,
        baseFont,
        lineHeight,
        maxWidth
    ) {
        const lines = this.wrapText(text, maxWidth, baseFont, fontSize);
        const fontName = this.getFontResourceName(state, baseFont);

        let y = startY;
        for (let i = 0, len = lines.length; i < len; i++) {
            builder
                .beginText()
                .setFont(fontName, fontSize)
                .setTextMatrix(1, 0, 0, 1, x, y)
                .showText(lines[i])
                .endText();

            y -= fontSize * lineHeight;
        }

        return y;
    }

    /**
     * Render text with underline
     * @param {PdfContentStreamBuilder} builder
     * @param {PdfBuildState} state
     * @param {string} text
     * @param {number} x
     * @param {number} y
     * @param {number} fontSize
     * @param {string} baseFont
     * @returns {void}
     */
    renderUnderlinedText(builder, state, text, x, y, fontSize, baseFont) {
        this.renderTextAt(
            builder,
            state,
            text,
            x,
            y,
            fontSize,
            baseFont,
            "left"
        );

        // Draw underline
        const textWidth = measureTextWidth(text, baseFont, fontSize);
        const underlineY = y - fontSize * 0.15;
        const thickness = Math.max(0.5, fontSize * 0.05);

        builder
            .saveState()
            .setLineWidth(thickness)
            .moveTo(x, underlineY)
            .lineTo(x + textWidth, underlineY)
            .stroke()
            .restoreState();
    }

    // =========================================================================
    // Drawing Primitives
    // =========================================================================

    /**
     * Draw line
     * @param {PdfContentStreamBuilder} builder
     * @param {number} x1
     * @param {number} y
     * @param {number} x2
     * @param {number} lineWidth
     * @param {string | number} [color]
     * @returns {void}
     */
    drawLine(builder, x1, y, x2, lineWidth, color = 0) {
        if (this._isColorNone(color)) {
            return;
        }
        builder.saveState().setLineWidth(lineWidth);
        this._applyStrokeColor(builder, color);
        builder.moveTo(x1, y).lineTo(x2, y).stroke().restoreState();
    }

    /**
     * Draw filled rectangle
     * @param {PdfContentStreamBuilder} builder
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @param {number} height
     * @param {string | number} color
     * @returns {void}
     */
    drawFilledRect(builder, x, y, width, height, color) {
        if (this._isColorNone(color)) {
            return;
        }

        this._drawFilledRectColor(builder, x, y, width, height, color);
    }

    /**
     * Draw stroked rectangle
     * @param {PdfContentStreamBuilder} builder
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @param {number} height
     * @param {number} [lineWidth]
     * @param {string | number} [color]
     * @returns {void}
     */
    drawStrokedRect(builder, x, y, width, height, lineWidth = 0.5, color = 0) {
        if (this._isColorNone(color)) {
            return;
        }

        this._drawStrokedRectColor(
            builder,
            x,
            y,
            width,
            height,
            lineWidth,
            color
        );
    }

    /**
     * Draw dot leaders between two x positions
     * @param {PdfContentStreamBuilder} builder
     * @param {PdfBuildState} state
     * @param {number} x1
     * @param {number} y
     * @param {number} x2
     * @param {number} fontSize
     * @returns {void}
     */
    drawDotLeaders(builder, state, x1, y, x2, fontSize) {
        const dotWidth = measureTextWidth(
            ".",
            this.fontConfig.regular,
            fontSize
        );
        const spacing = dotWidth * 2;
        const fontName = this.getFontResourceName(
            state,
            this.fontConfig.regular
        );

        let x = x1;
        builder.beginText().setFont(fontName, fontSize);

        while (x < x2 - dotWidth) {
            builder.setTextMatrix(1, 0, 0, 1, x, y).showText(".");
            x += spacing;
        }

        builder.endText();
    }

    // =========================================================================
    // Cover Page Rendering
    // =========================================================================

    /**
     * Render a diagonal watermark on the current page (typically cover only).
     * @param {PdfContentStreamBuilder} builder
     * @param {PdfBuildState} state
     * @param {{ enabled?: boolean; text?: string; gray?: number; color?: string|number; angleDeg?: number; fontSize?: number }} watermark
     * @param {string|number|undefined} [backgroundColor]
     * @returns {void}
     */
    renderDiagonalWatermark(builder, state, watermark, backgroundColor) {
        if (!watermark || watermark.enabled === false) {
            return;
        }

        const text = watermark.text ?? "DRAFT DOCUMENT";
        const explicitGray = isNumber(watermark.gray)
            ? watermark.gray
            : undefined;
        const explicitColor =
            watermark.color !== undefined && watermark.color !== null
                ? watermark.color
                : undefined;
        const resolvedColor =
            explicitColor ??
            explicitGray ??
            this._resolveDefaultWatermarkColor(backgroundColor);
        const angleDeg = isNumber(watermark.angleDeg) ? watermark.angleDeg : 35;
        const fontSize = isNumber(watermark.fontSize) ? watermark.fontSize : 84;

        const angle = (angleDeg * Math.PI) / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const centerX = state.pageWidth / 2;
        const centerY = state.pageHeight / 2;

        const w = measureTextWidth(text, this.fontConfig.bold, fontSize);
        const startX = centerX - (w / 2) * cos;
        const startY = centerY - (w / 2) * sin;

        const fontName = this.getFontResourceName(state, this.fontConfig.bold);

        builder.saveState();
        this._applyFillColor(builder, resolvedColor);
        builder
            .beginText()
            .setFont(fontName, fontSize)
            .setTextMatrix(cos, sin, -sin, cos, startX, startY)
            .showText(text)
            .endText()
            .restoreState();
    }
    // =========================================================================

    /**
     * Render dust cover page (SVG) as the OUTER cover.
     * This page is always excluded from displayed page numbering and never gets headers/footers.
     *
     * @param {DustCoverPage} dustCoverPage
     * @param {PdfBuildState} state
     * @returns {void}
     */
    renderDustCoverPage(dustCoverPage, state) {
        const page = this.newPage(state, "dust-cover");
        const builder = page.contentBuilder;

        try {
            renderSvgToPdf(dustCoverPage, builder, state);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.warnings.push(`Dust cover render warning: ${msg}`);
        }
    }

    /**
     * Render cover page
     * @param {CoverPageNode} coverPage
     * @param {PdfBuildState} state
     * @returns {void}
     */
    renderCoverPage(coverPage, state) {
        const page = this.newPage(state, "cover");
        const builder = page.contentBuilder;

        const elements =
            coverPage.elements && coverPage.elements.length > 0
                ? coverPage.elements
                : coverPage.config.elements;

        if (this.config.verbose) {
            const srcLabel =
                coverPage.elements && coverPage.elements.length > 0
                    ? "coverPage.elements"
                    : "coverPage.config.elements";
            const types = Array.isArray(elements)
                ? elements.map((e) => e?.type ?? "?")
                : [];
            this._trace(
                `  renderCoverPage source=${srcLabel} count=${
                    elements?.length ?? 0
                } types=[${types.join(", ")}]`
            );
            const configTypes = Array.isArray(coverPage.config?.elements)
                ? coverPage.config.elements.map((e) => e?.type ?? "?")
                : [];
            this._trace(
                `  renderCoverPage config.elements count=${
                    coverPage.config?.elements?.length ?? 0
                } types=[${configTypes.join(", ")}]`
            );
        }

        const coverCfg = coverPage.config;

        const coverBackground =
            coverCfg?.options?.backgroundColor ??
            this.config.coverConfig?.backgroundColor;

        if (coverBackground && !this._isColorNone(coverBackground)) {
            this._drawFilledRectColor(
                builder,
                0,
                0,
                state.pageWidth,
                state.pageHeight,
                coverBackground
            );
        }

        const coverPageFrame =
            coverCfg?.options?.pageFrame ?? this.config.coverConfig?.pageFrame;

        if (
            coverPageFrame &&
            coverPageFrame.enabled !== false &&
            !this._isColorNone(coverPageFrame.color)
        ) {
            const insetX =
                numberOr(coverPageFrame.insetX) ??
                numberOr(coverPageFrame.inset) ??
                20;
            const insetY =
                numberOr(coverPageFrame.insetY) ??
                numberOr(coverPageFrame.inset) ??
                20;
            const lineWidth = numberOr(coverPageFrame.lineWidth) ?? 1.25;

            this._drawStrokedRectColor(
                builder,
                insetX,
                insetY,
                Math.max(0, state.pageWidth - insetX * 2),
                Math.max(0, state.pageHeight - insetY * 2),
                lineWidth,
                coverPageFrame.color
            );
        }

        const watermark =
            coverCfg?.options?.watermark ?? this.config.coverConfig?.watermark;

        if (watermark && watermark.enabled !== false) {
            this.renderDiagonalWatermark(
                builder,
                state,
                watermark,
                coverBackground
            );
        } else {
            this._trace(
                `  skipping watermark (${
                    !watermark ? "disabled" : JSON.stringify(watermark)
                })`
            );
        }

        const legacyPadBase = numberOr(
            coverCfg?.options?.contentPadding,
            numberOr(this.config.coverConfig?.contentPadding, undefined)
        );

        const legacyPadX =
            numberOr(coverCfg?.options?.contentPaddingX) ??
            numberOr(this.config.coverConfig?.contentPaddingX) ??
            legacyPadBase ??
            0;

        const legacyPadY =
            numberOr(coverCfg?.options?.contentPaddingY) ??
            numberOr(this.config.coverConfig?.contentPaddingY) ??
            legacyPadBase ??
            0;

        // Base content box now comes from newPage() effective margins.
        const baseLeft = state.margins.left;
        const baseRight = state.pageWidth - state.margins.right;
        const baseTop = state.pageHeight - state.margins.top;
        const baseBottom = state.margins.bottom;

        const cvLeftX = baseLeft + legacyPadX;
        const cvRightX = Math.max(cvLeftX, baseRight - legacyPadX);
        const cvTopY = baseTop - legacyPadY;
        const cvBottomY = baseBottom + legacyPadY;
        const cvW = Math.max(0, cvRightX - cvLeftX);

        let y = cvTopY;
        const centerX = cvLeftX + cvW / 2;

        if (this.config.verbose) {
            this._trace(
                `  cover content box: base(L=${baseLeft},R=${state.margins.right},T=${state.margins.top},B=${state.margins.bottom}) ` +
                    `=> x=[${cvLeftX},${cvRightX}] y=[${cvBottomY},${cvTopY}]`
            );
        }

        for (let i = 0, len = elements.length; i < len; i++) {
            const element = elements[i];

            switch (element.type) {
                case "spacer":
                    y -= element.height ?? 20;
                    break;

                case "text": {
                    const fontSize = element.style?.fontSize ?? 12;
                    const align = element.style?.align ?? "center";
                    const bold = element.style?.bold ?? false;
                    const italic = element.style?.italic ?? false;
                    const monospace = element.style?.monospace ?? false;
                    const baseFont = this.getFont(
                        state,
                        bold,
                        italic,
                        monospace
                    );

                    const textStartFrac = numberOr(element.startFrac, 0);

                    const textEndFrac = numberOr(element.endFrac, 1);

                    const textLeftX = cvLeftX + cvW * textStartFrac;
                    const textRightX = cvLeftX + cvW * textEndFrac;

                    let x = textLeftX;
                    if (align === "center") {
                        x = textLeftX + (textRightX - textLeftX) / 2;
                    } else if (align === "right") {
                        x = textRightX;
                    }

                    const text = this.wrapText(
                        isString(element.content)
                            ? applyTypographySubstitutions(element.content)
                            : "",
                        cvW,
                        baseFont,
                        fontSize
                    );

                    const lines = [];

                    for (let j = 0, jlen = text.length; j < jlen; j++) {
                        const line = text[j];

                        // Handle multi-line content (split by \n or <br>)
                        const textLines = line.split(/\n|<br\s*\/?>/gi);

                        if (textLines.length > 1) {
                            lines.push(...textLines);
                        } else {
                            lines.push(line);
                        }
                    }

                    for (let j = 0, jlen = lines.length; j < jlen; j++) {
                        const line = lines[j].trim();
                        if (line.length > 0) {
                            this.renderTextAt(
                                builder,
                                state,
                                line,
                                x,
                                y,
                                fontSize,
                                baseFont,
                                align,
                                element.style?.color
                            );
                        }
                        y -= fontSize * 1.5;
                    }
                    break;
                }

                case "title-block": {
                    const titleText = applyTypographySubstitutions(
                        element.title || ""
                    );
                    const ofText = element.conjunction || "";
                    const entityText = element.entityName || "";
                    const titleFontSize = element.style?.fontSize || 24;
                    const subtitleFontSize = element.subtitleFontSize || 14;
                    const entityFontSize = element.entityFontSize || 20;
                    const align = element.style?.align || "center";

                    const centerX = cvLeftX + cvW / 2;
                    const rightX = cvRightX;

                    const titleX =
                        align === "center"
                            ? centerX
                            : align === "right"
                            ? rightX
                            : cvLeftX;

                    const wrappedTitleText = this.wrapText(
                        titleText,
                        cvW,
                        this.getCoverFont(
                            state,
                            "title",
                            state.fonts.bold || state.fonts.regular
                        ),
                        titleFontSize
                    );

                    // Title
                    for (
                        let j = 0, jlen = wrappedTitleText.length;
                        j < jlen;
                        j++
                    ) {
                        const line = wrappedTitleText[j].trim();
                        if (line.length > 0) {
                            this.renderTextAt(
                                builder,
                                state,
                                line,
                                titleX,
                                y,
                                titleFontSize,
                                this.getCoverFont(
                                    state,
                                    "title",
                                    state.fonts.bold || state.fonts.regular
                                ),
                                align,
                                element.style?.color
                            );
                        }
                        y -= titleFontSize * 1.5;
                    }

                    y -= titleFontSize * 0.5;

                    // Conjunction ("OF") is optional
                    if (ofText.trim().length > 0) {
                        this.renderTextAt(
                            builder,
                            state,
                            ofText,
                            titleX,
                            y,
                            subtitleFontSize,
                            this.getCoverFont(
                                state,
                                "subtitle",
                                state.fonts.regular
                            ),
                            align,
                            element.style?.color
                        );
                        y -= subtitleFontSize * 2;
                    }

                    // Entity Name
                    this.renderTextAt(
                        builder,
                        state,
                        entityText,
                        titleX,
                        y,
                        entityFontSize,
                        this.getCoverFont(
                            state,
                            "entity",
                            state.fonts.bold || state.fonts.regular
                        ),
                        align,
                        element.style?.color
                    );
                    y -= entityFontSize * 2;
                    break;
                }

                case "kv-block": {
                    const fontSize = element.style?.fontSize ?? 11;
                    const align = element.style?.align ?? "left";
                    const bold = element.style?.bold ?? false;
                    const italic = element.style?.italic ?? false;
                    const monospace = element.style?.monospace ?? false;

                    const baseFont = this.getFont(
                        state,
                        bold,
                        italic,
                        monospace
                    );

                    const labelAlign =
                        element.labelAlign === "left" ||
                        element.labelAlign === "center" ||
                        element.labelAlign === "right"
                            ? element.labelAlign
                            : "right";

                    const columnGap = numberOr(element.columnGap, 12);

                    const lineSpacer = numberOr(element.lineSpacer, 10);

                    const labelColorDefault = stringOr(
                        element.style?.color,
                        undefined
                    );

                    const valueColorDefault = stringOr(
                        element.style?.color,
                        undefined
                    );

                    const labelBold = element.style?.bold ?? bold;

                    const valueBold = element.style?.bold ?? bold;

                    const labelFont = this.getCoverFont(
                        state,
                        "metadata_label",
                        this.getFont(state, !!labelBold, italic, monospace)
                    );

                    const valueFont = this.getCoverFont(
                        state,
                        "metadata_value",
                        this.getFont(state, !!valueBold, italic, monospace)
                    );

                    const rows = Array.isArray(element.rows)
                        ? element.rows
                        : [];

                    const sepRaw = stringOr(element.separator, ": ");
                    const sepTrim = sepRaw.trimEnd();

                    let maxLabelWidth = 0;
                    let maxValueWidth = 0;

                    for (let r = 0, rlen = rows.length; r < rlen; r++) {
                        const row = rows[r] ?? {};
                        const label = applyTypographySubstitutions(
                            stringOr(row.label, "")
                        );
                        const value = applyTypographySubstitutions(
                            stringOr(row.value, "")
                        );

                        const labelText = `${label}${sepTrim}`;
                        const lw = measureTextWidth(
                            labelText,
                            baseFont,
                            fontSize
                        );
                        if (lw > maxLabelWidth) maxLabelWidth = lw;

                        const vw = measureTextWidth(value, baseFont, fontSize);
                        if (vw > maxValueWidth) maxValueWidth = vw;
                    }

                    const startFracRaw = numberOr(element.startFrac, 0);

                    const endFracRaw = numberOr(element.endFrac, 1);

                    const startFrac =
                        startFracRaw >= 0 && startFracRaw <= 1
                            ? startFracRaw
                            : 0;
                    const endFrac =
                        endFracRaw >= 0 && endFracRaw <= 1 ? endFracRaw : 1;

                    const safeStartFrac = startFrac < endFrac ? startFrac : 0;
                    const safeEndFrac = startFrac < endFrac ? endFrac : 1;

                    const availableWidth = cvW * (safeEndFrac - safeStartFrac);

                    const blockLeftX = cvLeftX + cvW * safeStartFrac;

                    // Prevent labels from consuming the entire line.
                    const labelColWidth = Math.max(
                        1,
                        Math.min(maxLabelWidth, availableWidth * 0.55)
                    );

                    const maxValueAvailable = Math.max(
                        1,
                        availableWidth - labelColWidth - columnGap
                    );

                    const desiredValueWidth =
                        maxValueWidth > 0
                            ? Math.min(maxValueWidth, maxValueAvailable)
                            : maxValueAvailable;

                    const totalWidth =
                        labelColWidth + columnGap + desiredValueWidth;

                    let startX = blockLeftX;
                    if (align === "center") {
                        startX = blockLeftX + (availableWidth - totalWidth) / 2;
                    } else if (align === "right") {
                        startX = blockLeftX + (availableWidth - totalWidth);
                    }

                    const labelRightX = startX + labelColWidth;
                    const valueLeftX = labelRightX + columnGap;

                    const labelX =
                        labelAlign === "left"
                            ? startX
                            : labelAlign === "center"
                            ? startX + labelColWidth / 2
                            : labelRightX;

                    const lineStep = fontSize * 1.5;

                    for (let r = 0, rlen = rows.length; r < rlen; r++) {
                        const row = rows[r] ?? {};
                        const label = applyTypographySubstitutions(
                            stringOr(row.label, "")
                        );
                        const value = applyTypographySubstitutions(
                            stringOr(row.value, "")
                        );

                        const rowLabelColor = stringOr(
                            row.labelColor,
                            labelColorDefault
                        );

                        const rowValueColor = stringOr(
                            row.valueColor,
                            valueColorDefault
                        );

                        const labelText = `${label}${sepTrim}`;
                        this.renderTextAt(
                            builder,
                            state,
                            labelText,
                            labelX,
                            y,
                            fontSize,
                            labelFont,
                            labelAlign,
                            rowLabelColor
                        );

                        const valueLines =
                            value && value.length > 0
                                ? this.wrapText(
                                      value,
                                      desiredValueWidth,
                                      valueFont,
                                      fontSize
                                  )
                                : [""];

                        for (
                            let j = 0, jlen = valueLines.length;
                            j < jlen;
                            j++
                        ) {
                            const line = valueLines[j] ?? "";
                            if (line.length === 0 && jlen > 1) continue;
                            this.renderTextAt(
                                builder,
                                state,
                                line,
                                valueLeftX,
                                y - lineStep * j,
                                fontSize,
                                valueFont,
                                "left",
                                rowValueColor
                            );
                        }

                        y -= lineStep * Math.max(1, valueLines.length);
                        y -= lineSpacer;
                    }

                    if (rows.length > 0) {
                        y += lineSpacer;
                    }
                    break;
                }
                case "rule": {
                    const startFrac = numberOr(element.startFrac, 0.25);
                    const endFrac = numberOr(element.endFrac, 0.75);
                    const lineWidth = numberOr(element.lineWidth, 0.5);

                    const color =
                        stringOr(element.color, element.style?.color) ??
                        numberOr(element.gray, 0.5);

                    this.drawLine(
                        builder,
                        cvLeftX + cvW * startFrac,
                        y,
                        cvLeftX + cvW * endFrac,
                        lineWidth,
                        color
                    );
                    y -= 10;
                    break;
                }

                case "box": {
                    const startFrac = numberOr(element.startFrac, 0.25);
                    const endFrac = numberOr(element.endFrac, 0.75);
                    const lineWidth = numberOr(element.lineWidth, 0.5);

                    const height = numberOr(element.height, 24);

                    const fill = element.style?.backgroundColor;

                    const stroke =
                        element.stroke ??
                        element.borderColor ??
                        element.style?.borderColor;

                    const leftX = cvLeftX + cvW * startFrac;
                    const rightX = cvLeftX + cvW * endFrac;
                    const w = Math.max(0, rightX - leftX);
                    const bottomY = y - height;

                    if (fill && !this._isColorNone(fill)) {
                        this._drawFilledRectColor(
                            builder,
                            leftX,
                            bottomY,
                            w,
                            height,
                            fill
                        );
                    }
                    if (stroke && !this._isColorNone(stroke)) {
                        this._drawStrokedRectColor(
                            builder,
                            leftX,
                            bottomY,
                            w,
                            height,
                            lineWidth,
                            stroke
                        );
                    }

                    y -= height;
                    y -= numberOr(element.afterSpacer, 10);

                    break;
                }
            }
        }
    }

    // =========================================================================
    // TOC Rendering with Links
    // =========================================================================

    /**
     * Render table of contents with clickable links
     * @param {TocNode} toc
     * @param {PdfBuildState} state
     * @param {LayoutResult} layout
     * @returns {void}
     */
    renderToc(toc, state, layout) {
        let page = this.newPage(state, "toc");
        let builder = page.contentBuilder;

        const baseFontSize = this.config.baseFontSize ?? 10;
        const lineHeight = this.config.lineHeight ?? 1.5;
        let y = state.currentY;

        // Get TOC level styles from config or use defaults
        const levelStyles = this.tocLevelStyles ?? {
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

        // Title
        if (toc.config.title) {
            const titleSize =
                toc.config.titleStyle?.fontSize ?? baseFontSize * 1.5;
            const centerX = state.margins.left + state.contentWidth / 2;
            const titleFont = this.getSemanticStyledFont(
                state,
                "toc_title",
                this.getFont(state, true),
                { bold: true }
            );

            this.renderTextAt(
                builder,
                state,
                toc.config.title,
                centerX,
                y,
                titleSize,
                titleFont,
                "center"
            );
            y -= titleSize * 2.5;
        }

        let previousLevel = 0;

        // Entries with hierarchical styling
        for (let i = 0, len = toc.entries.length; i < len; i++) {
            const entry = toc.entries[i];

            // Typography: convert double-dash sequences to em dash
            const entryTitle = applyTypographySubstitutions(entry.title);

            // Check if this is a document-level entry
            const isDocumentEntry =
                /** @type {any} */ (entry).isDocumentEntry === true;
            const effectiveLevel = entry.level; // Level already set correctly in updateTocPages

            // Get level-specific styling
            const levelStyle = this.getHeadingLevelAliasedValue(
                levelStyles,
                effectiveLevel
            ) ??
                this.getHeadingLevelAliasedValue(levelStyles, 1) ?? {
                    fontSizeScale: 1.0,
                    bold: false,
                    indent: (effectiveLevel - 1) * 24,
                    spacingAfter: 1.2
                };

            const indent =
                entry.style?.indent ??
                levelStyle.indent ??
                (entry.level - 1) * 20;
            const fontSizeScale = levelStyle.fontSizeScale ?? 1.0;
            const entryFontSize =
                (entry.style?.textStyle?.fontSize ?? baseFontSize) *
                fontSizeScale;
            const entryBold = levelStyle.bold ?? entry.level === 1;
            const entryFont = this.getSemanticStyledFont(
                state,
                `toc_level_${effectiveLevel}`,
                this.getSemanticStyledFont(
                    state,
                    "toc_entry",
                    this.getFont(state, entryBold),
                    { bold: entryBold }
                ),
                { bold: entryBold }
            );

            const pageNumText = String(entry.page);
            const pageNumFont = this.getSemanticStyledFont(
                state,
                "toc_page_number",
                this.getSemanticStyledFont(
                    state,
                    "toc_entry",
                    this.getFont(state, false),
                    { bold: false }
                ),
                { bold: false }
            );
            const pageNumWidth = measureTextWidth(
                pageNumText,
                pageNumFont,
                entryFontSize
            );

            const titleX = state.margins.left + indent;
            const pageNumX = state.margins.left + state.contentWidth;

            // Reserve space for page number and dot leaders
            const dotLeaderSpace = 30;
            const maxTitleWidth = Math.max(
                40,
                state.contentWidth - indent - pageNumWidth - dotLeaderSpace
            );
            const titleLines = this.wrapText(
                entryTitle,
                maxTitleWidth,
                entryFont,
                entryFontSize
            );
            const titleLineCount = Math.max(1, titleLines.length);

            // Ensure room for at least one line
            if (y < state.margins.bottom + entryFontSize * lineHeight * 2) {
                page = this.newPage(state, "toc");
                builder = page.contentBuilder;
                y = state.currentY;
            }

            // Optional spacing before entry (in "lines", similar to spacingAfter)
            let entrySpacingBefore = levelStyle.spacingBefore ?? 0;

            // For separating out articles slightly
            let subheadingSpacer = 0;

            if (
                previousLevel &&
                previousLevel > effectiveLevel &&
                effectiveLevel > 1
            ) {
                subheadingSpacer = 8;
            }

            previousLevel = effectiveLevel;

            if (
                isNumber(entrySpacingBefore) &&
                entrySpacingBefore > 0 &&
                y < state.pageHeight - state.margins.top - 10
            ) {
                y -=
                    entryFontSize * lineHeight * entrySpacingBefore +
                    subheadingSpacer;

                // Re-check page fit after applying spacingBefore
                if (y < state.margins.bottom + entryFontSize * lineHeight * 2) {
                    page = this.newPage(state, "toc");
                    builder = page.contentBuilder;
                    y = state.currentY;
                }
            } else if (subheadingSpacer) {
                y -= subheadingSpacer;

                // Re-check page fit after applying spacingBefore
                if (y < state.margins.bottom + entryFontSize * lineHeight * 2) {
                    page = this.newPage(state, "toc");
                    builder = page.contentBuilder;
                    y = state.currentY;
                }
            }

            const entryTopY = y;

            // Render first title line
            const firstLine = titleLines[0] ?? "";
            this.renderTextAt(
                builder,
                state,
                firstLine,
                titleX,
                y,
                entryFontSize,
                entryFont,
                "left"
            );

            // Dot leaders only for the first line
            const titleWidth = measureTextWidth(
                firstLine,
                entryFont,
                entryFontSize
            );
            const leaderStart = titleX + titleWidth + 8;
            const leaderEnd = pageNumX - pageNumWidth - 8;

            if (leaderEnd > leaderStart + 15) {
                this.drawDotLeaders(
                    builder,
                    state,
                    leaderStart,
                    y,
                    leaderEnd,
                    entryFontSize
                );
            }

            // Page number (right-aligned)
            this.renderTextAt(
                builder,
                state,
                pageNumText,
                pageNumX,
                y,
                entryFontSize,
                pageNumFont,
                "right"
            );

            // Remaining wrapped title lines
            for (let l = 1; l < titleLineCount; l++) {
                y -= entryFontSize * lineHeight;

                if (y < state.margins.bottom + entryFontSize * lineHeight * 2) {
                    page = this.newPage(state, "toc");
                    builder = page.contentBuilder;
                    y = state.currentY;
                }

                const line = titleLines[l] ?? "";
                this.renderTextAt(
                    builder,
                    state,
                    line,
                    titleX,
                    y,
                    entryFontSize,
                    entryFont,
                    "left"
                );
            }

            // Add link annotation
            if (entry.nodeId && !isDocumentEntry) {
                const linkHeight = titleLineCount * entryFontSize * lineHeight;
                this.addLinkAnnotation(state, {
                    type: "internal",
                    x: titleX,
                    y: entryTopY - entryFontSize * 0.2,
                    width: state.contentWidth - indent,
                    height: linkHeight,
                    targetNodeId: entry.nodeId
                });
            }

            // Entry spacing using level-specific spacing
            const entrySpacing =
                levelStyle.spacingAfter ?? (entry.level === 1 ? 1.4 : 1.2);
            y -= entryFontSize * lineHeight * entrySpacing;
        }

        state.currentY = y;
    }

    /**
     * Estimate rendered heading height (including post-heading breathing room).
     * Uses the same wrapping logic as renderHeading so preflight pagination matches
     * the actual rendered footprint closely.
     *
     * @private
     * @param {BaseNode} node
     * @param {PdfBuildState} state
     * @returns {number}
     */
    _estimateRenderedHeadingHeight(node, state) {
        const level = /** @type {any} */ (node).level ?? node.attrs?.level ?? 1;
        const baseFontSize = this.config.baseFontSize ?? 10;
        const fontSize = baseFontSize * this.getHeadingScale(level);
        const lineHeight = this.config.lineHeight ?? 1.5;

        let text = this.extractText(node);
        text = applyTypographySubstitutions(text);

        const align = this.resolveNodeHorizontalAlign(
            node,
            level === 1 ? "center" : "left"
        );
        const headingSemanticRole = this.getHeadingSemanticRole(level);
        const baseFont = this.getSemanticStyledFont(
            state,
            headingSemanticRole,
            this.getFont(state, true),
            { bold: true }
        );
        const maxWidth = state.contentWidth;

        text = this.applySmartTitleWrap(
            text,
            maxWidth,
            baseFont,
            fontSize,
            level,
            align
        );

        const lines = this.wrapText(text, maxWidth, baseFont, fontSize);
        const lineCount = Math.max(1, lines.length);

        return lineCount * (fontSize * lineHeight) + fontSize * 0.25;
    }

    /**
     * Preflight page-break for heading + follower to prevent orphan headings when
     * the following block would be pushed wholesale to the next page by keep rules
     * or widow/orphan protection.
     *
     * @private
     * @param {BaseNode | null | undefined} headingNode
     * @param {BaseNode | null | undefined} nextNode
     * @param {PdfBuildState} state
     * @param {string} sectionId
     * @param {number} depth
     * @returns {void}
     */
    preflightHeadingFollowerBreak(
        headingNode,
        nextNode,
        state,
        sectionId,
        depth
    ) {
        if (!headingNode || headingNode.type !== "heading" || !nextNode) {
            return;
        }

        const atTopOfPage =
            state.currentY >= state.pageHeight - state.margins.top - 0.001;
        if (atTopOfPage) {
            return;
        }

        const nextBreakType =
            /** @type {any} */ (nextNode).breakType ??
            nextNode.attrs?.breakType;
        if (nextNode.type === "break" && nextBreakType === "page") {
            return;
        }

        const baseFontSize = this.config.baseFontSize ?? 10;
        const lineHeight = this.config.lineHeight ?? 1.5;
        const singleLineHeight = baseFontSize * lineHeight;

        const headingSpacingBefore = this.getVerticalSpacing(
            headingNode,
            state.lastNodeType
        );
        const headingHeight = this._estimateRenderedHeadingHeight(
            headingNode,
            state
        );
        const nextSpacing = this.getVerticalSpacing(nextNode, "heading");

        const remainingBefore = state.currentY - state.margins.bottom;
        const remainingAfterHeading =
            remainingBefore -
            headingSpacingBefore -
            headingHeight -
            nextSpacing;

        if (remainingAfterHeading <= 0) {
            this.newPage(state, sectionId);
            return;
        }

        const nextHeight = this.estimateNodeHeight(nextNode, state, depth);

        if (nextHeight <= remainingAfterHeading) {
            return;
        }

        if (nextHeight > state.contentHeight) {
            return;
        }

        let shouldMoveHeading = false;

        if (nextNode.keepRules?.keepTogether) {
            shouldMoveHeading = true;
        } else if (
            nextNode.type === "paragraph" ||
            nextNode.type === "list-item" ||
            nextNode.type === "definition" ||
            nextNode.type === "clause"
        ) {
            const overflowPt = nextHeight - remainingAfterHeading;
            const overflowLines = Math.ceil(overflowPt / singleLineHeight);
            const overflowRatio = nextHeight > 0 ? overflowPt / nextHeight : 0;

            const WIDOW_LINE_THRESHOLD = 2;
            const WIDOW_RATIO_THRESHOLD = 0.2;

            if (
                overflowLines <= WIDOW_LINE_THRESHOLD ||
                overflowRatio <= WIDOW_RATIO_THRESHOLD
            ) {
                shouldMoveHeading = true;
            }
        }

        if (shouldMoveHeading) {
            this.newPage(state, sectionId);
        }
    }

    // =========================================================================
    // Section Rendering
    // =========================================================================

    /**
     * Render a section
     * @param {ComposedSection} section
     * @param {PdfBuildState} state
     * @param {LayoutResult} layout
     * @returns {void}
     */
    renderSection(section, state, layout) {
        // Reset
        state.insidePart = false;
        state.seenPart = false;

        // Register section config for header/footer margin calculations
        state.sectionConfigs.set(section.id, {
            headers: section.config.headers,
            footers: section.config.footers,
            breakMode: /** @type {any} */ (section.config).breakMode,
            horizontalRuleBehavior: /** @type {any} */ (section.config)
                .horizontalRuleBehavior
        });

        this._trace(
            `--- renderSection: "${section.id}" (${
                section.content.length
            } nodes, startsNewPage=${
                section.config.startsNewPage ?? false
            }, breakMode=${
                /** @type {any} */ (section.config).breakMode ?? "always"
            }) ---`
        );

        // Check if section starts on new page
        if (section.config.startsNewPage || state.currentPage === null) {
            this.newPage(state, section.id);
        }

        // Render section content
        for (let i = 0, len = section.content.length; i < len; i++) {
            const currentNode = section.content[i];
            const nextNode = i + 1 < len ? section.content[i + 1] : null;
            this.preflightHeadingFollowerBreak(
                currentNode,
                nextNode,
                state,
                section.id,
                0
            );
            this.renderNode(currentNode, state, section.id, layout, 0);
        }
    }

    // =========================================================================
    // Node Rendering
    // =========================================================================

    /**
     * Render a node
     * @param {BaseNode} node
     * @param {PdfBuildState} state
     * @param {string} sectionId
     * @param {LayoutResult} layout
     * @param {number} depth
     * @returns {void}
     */
    renderNode(node, state, sectionId, layout, depth) {
        const page = /** @type {PdfPage} */ (state.currentPage);
        const builder = page.contentBuilder;
        const fontSize = this.config.baseFontSize ?? 10;
        const lineHeight = this.config.lineHeight ?? 1.5;

        // Handle page breaks
        const breakType =
            /** @type {any} */ (node).breakType ?? node.attrs?.breakType;
        if (node.type === "break" && breakType === "page") {
            // If we're already at the top of a fresh page (e.g. an automatic
            // overflow/keepTogether/widow break just fired), suppress the
            // explicit break so we don't produce a blank page.
            const atTopOfPage =
                state.currentY === state.pageHeight - state.margins.top;
            if (atTopOfPage) {
                this._trace(
                    `  renderNode: SUPPRESSED EXPLICIT PAGE BREAK at top of page (id=${node.id})`
                );
                return;
            }

            const breakMode = this.getSectionBreakMode(state, sectionId);
            if (breakMode === "part-only") {
                // Allow explicit page breaks:
                // - Before any Part has been seen (preface→body transition)
                // - Inside a Part section
                // Suppress after Parts end (trailing prose sections)
                if (state.insidePart || !state.seenPart) {
                    this._trace(
                        `  renderNode: EXPLICIT PAGE BREAK (id=${node.id}, insidePart=${state.insidePart}, seenPart=${state.seenPart})`
                    );
                    this.newPage(state, sectionId);
                } else {
                    this._trace(
                        `  renderNode: SUPPRESSED EXPLICIT PAGE BREAK in part-only (id=${node.id})`
                    );
                }
                return;
            }
            this._trace(`  renderNode: EXPLICIT PAGE BREAK (id=${node.id})`);
            this.newPage(state, sectionId);
            return;
        }

        // Check keep rules and page fit
        const nodeHeight = this.estimateNodeHeight(node, state, depth);
        const remainingHeight = state.currentY - state.margins.bottom;

        // Determine if pageBreakBefore should be honored based on sectionBreakMode
        let honorPageBreakBefore = !!node.keepRules?.pageBreakBefore;
        if (honorPageBreakBefore) {
            const breakMode = this.getSectionBreakMode(state, sectionId);
            if (breakMode === "part-only") {
                if (this.shouldBreakInPartOnlyMode(node)) {
                    // Part heading or section with table — always break
                    honorPageBreakBefore = true;
                } else if (state.insidePart) {
                    // A same-level (h2) non-Part heading exits the Part.
                    // Deeper headings (h3, h4, …) are content within the
                    // Part and should NOT trigger a break.
                    const level =
                        /** @type {any} */ (node).level ??
                        node.attrs?.level ??
                        99;
                    if (node.type === "heading" && level <= 2) {
                        honorPageBreakBefore = true;
                        state.insidePart = false;
                    } else {
                        honorPageBreakBefore = false;
                    }
                } else {
                    // Before any Part or after Parts ended — suppress.
                    // Preface→body transitions come from explicit break
                    // nodes (last preface HR), not from pageBreakBefore.
                    honorPageBreakBefore = false;
                }
            }
        }

        // Track when we enter a Part section
        if (this.isPartLevelNode(node)) {
            state.insidePart = true;
            state.seenPart = true;
        }

        const isTopOfPage =
            state.currentY === state.pageHeight - state.margins.top;

        if (
            this._verbose &&
            (node.type === "heading" ||
                node.type === "article" ||
                node.type === "section" ||
                node.type === "table" ||
                node.type === "notice" ||
                node.type === "signature-block" ||
                node.type === "break" ||
                node.keepRules?.pageBreakBefore ||
                node.keepRules?.keepTogether)
        ) {
            const nodeLabel =
                node.type === "heading"
                    ? `heading(L${
                          /** @type {any} */ (node).level ??
                          node.attrs?.level ??
                          "?"
                      })`
                    : node.type;
            const textSnippet = this.extractPlainText(node)
                .slice(0, 60)
                .replace(/\n/g, "↵");
            this._trace(
                `  renderNode: ${nodeLabel} id=${
                    node.id ?? "(none)"
                } depth=${depth} "${textSnippet}"`
            );
            this._trace(
                `    estimatedHeight=${nodeHeight.toFixed(
                    1
                )} remainingHeight=${remainingHeight.toFixed(
                    1
                )} currentY=${state.currentY.toFixed(
                    1
                )} bottomMargin=${state.margins.bottom.toFixed(
                    1
                )} contentHeight=${state.contentHeight.toFixed(1)}`
            );
            this._trace(
                `    keepRules: breakBefore=${!!node.keepRules
                    ?.pageBreakBefore} keepTogether=${!!node.keepRules
                    ?.keepTogether} breakAfter=${!!node.keepRules
                    ?.pageBreakAfter} → honorBreakBefore=${honorPageBreakBefore} isTopOfPage=${isTopOfPage}`
            );
            if (nodeHeight > remainingHeight) {
                this._trace(
                    `    BLEED DETECTED: node (${nodeHeight.toFixed(
                        1
                    )}pt) > remaining (${remainingHeight.toFixed(
                        1
                    )}pt) → overflow by ${(
                        nodeHeight - remainingHeight
                    ).toFixed(1)}pt`
                );
                if (
                    node.keepRules?.keepTogether &&
                    nodeHeight <= state.contentHeight
                ) {
                    this._trace(
                        `    → keepTogether: moving to NEW PAGE (fits on fresh page: ${nodeHeight.toFixed(
                            1
                        )} ≤ ${state.contentHeight.toFixed(1)})`
                    );
                } else if (node.keepRules?.keepTogether) {
                    this._trace(
                        `    → keepTogether: CANNOT FIT on single page (${nodeHeight.toFixed(
                            1
                        )} > ${state.contentHeight.toFixed(1)}), will split`
                    );
                }
            }
        }

        if (honorPageBreakBefore && !isTopOfPage) {
            this._trace(
                `    → PAGE BREAK BEFORE (honorPageBreakBefore=true, not top of page)`
            );
            this.newPage(state, sectionId);
        }

        if (
            node.keepRules?.keepTogether &&
            nodeHeight > remainingHeight &&
            nodeHeight <= state.contentHeight
        ) {
            this._trace(
                `    → KEEP-TOGETHER PAGE BREAK (${nodeHeight.toFixed(
                    1
                )} > ${remainingHeight.toFixed(
                    1
                )} remaining, fits in ${state.contentHeight.toFixed(1)})`
            );
            this.newPage(state, sectionId);
        }

        // =====================================================================
        // Automatic widow/orphan protection for paragraphs (and similar blocks)
        // If a block overflows by only a small fraction (≤ WIDOW_LINE_THRESHOLD
        // lines), and the entire block fits on a fresh page, move it across
        // rather than splitting a sentence or leaving a few orphan words.
        // =====================================================================
        if (
            !node.keepRules?.keepTogether &&
            !honorPageBreakBefore &&
            !isTopOfPage &&
            nodeHeight > remainingHeight &&
            nodeHeight <= state.contentHeight &&
            (node.type === "paragraph" ||
                node.type === "list-item" ||
                node.type === "definition" ||
                node.type === "clause")
        ) {
            const baseFontSizeWO = this.config.baseFontSize ?? 10;
            const lineHeightWO = this.config.lineHeight ?? 1.5;
            const singleLineH = baseFontSizeWO * lineHeightWO;

            // How many lines overflow onto the next page?
            const overflowPt = nodeHeight - remainingHeight;
            const overflowLines = Math.ceil(overflowPt / singleLineH);

            // How many total lines does the block occupy?
            const totalLines = Math.max(
                1,
                Math.round(nodeHeight / singleLineH)
            );

            // Threshold: move the block if ≤ 2 lines overflow, OR if the
            // overflow is less than 20% of the block (catches short paragraphs
            // where even 1 line is a large fraction).
            const WIDOW_LINE_THRESHOLD = 2;
            const WIDOW_RATIO_THRESHOLD = 0.2;

            if (
                overflowLines <= WIDOW_LINE_THRESHOLD ||
                overflowPt / nodeHeight <= WIDOW_RATIO_THRESHOLD
            ) {
                this._trace(
                    `    → WIDOW/ORPHAN PROTECTION: ${overflowLines} line(s) overflow (${overflowPt.toFixed(
                        1
                    )}pt of ${nodeHeight.toFixed(
                        1
                    )}pt, ${totalLines} total lines) → moving block to NEW PAGE`
                );
                this.newPage(state, sectionId);
            }
        }

        // Apply context-aware spacing
        let spacing = this.getVerticalSpacing(node, state.lastNodeType);
        // Horizontal-rule visual tuning: add a small boost before/after rules so
        // the line doesn't look cramped against descenders/ascenders.
        const hrCfg = /** @type {any} */ (
            this.config.horizontalRule ??
                ("horizontal_rule" in this.config
                    ? this.config.horizontal_rule
                    : null) ??
                null
        );

        const hrGapBoostPt = isNumber(hrCfg?.gapBoostPt)
            ? hrCfg.gapBoostPt
            : isNumber(hrCfg?.gap_boost_pt)
            ? hrCfg.gap_boost_pt
            : 3;

        const hrGapBoostAfterPt = isNumber(hrCfg?.gapBoostAfterPt)
            ? hrCfg.gapBoostAfterPt
            : isNumber(hrCfg?.gap_boost_after_pt)
            ? hrCfg.gap_boost_after_pt
            : hrGapBoostPt;

        if (node.type === "horizontal-rule") {
            spacing += hrGapBoostPt;
        } else if (
            node.type === "heading" &&
            state.lastNodeType === "horizontal-rule"
        ) {
            const level =
                /** @type {any} */ (node).level ?? node.attrs?.level ?? 1;
            const base = this.config.baseFontSize ?? 10;
            const headingFontSize = base * this.getHeadingScale(level);

            const headingText = this.extractPlainText(node);
            const ascBoost = this._estimateHeadingAscenderBoostPt(
                headingText,
                headingFontSize
            );

            spacing += hrGapBoostAfterPt + ascBoost;
        }

        // Only apply spacing if we aren't at the very top of a page
        if (
            spacing > 0 &&
            state.currentY < state.pageHeight - state.margins.top - 10
        ) {
            // Collapse heading→table spacing: take the larger of the existing
            // ink gap (from heading) or the table's requested spacing, not both.
            if (state.lastNodeType === "heading" && node.type === "table") {
                const inkY = this._getLastInkBottomY(state);
                if (inkY != null && inkY > state.currentY) {
                    const gapNow = inkY - state.currentY;
                    const desiredGap = gapNow + spacing;
                    const delta = (desiredGap - gapNow) * 0.5;
                    // delta>0 moves down; delta<0 stays put (gap already sufficient).
                    state.currentY -= delta;
                    spacing = 0;
                }
            }

            if (this._verbose && spacing > fontSize) {
                this._trace(
                    `    spacing: ${spacing.toFixed(1)}pt before ${
                        node.type
                    } (prev=${state.lastNodeType ?? "null"})`
                );
            }

            if (spacing > 0) {
                state.currentY -= spacing;
            }
        }

        // Render based on node type
        switch (node.type) {
            case "text":
                this.renderTextNode(node, state);
                break;

            case "paragraph":
                this.renderParagraph(node, state, sectionId, layout);
                break;

            case "heading":
                this.renderHeading(node, state, sectionId);
                break;

            case "list":
                this.renderList(node, state, sectionId, layout, depth);
                break;

            case "list-item":
                this.renderListItem(node, state, sectionId, layout, depth);
                break;

            case "blockquote":
                this.renderBlockquote(node, state, sectionId, layout);
                break;

            case "code-block":
                this.renderCodeBlock(node, state, sectionId);
                break;

            case "horizontal-rule":
                this.renderHorizontalRule(node, state, sectionId);
                break;

            case "table":
                this.renderTable(
                    /** @type {TableNode} */ (node),
                    state,
                    sectionId,
                    layout
                );
                break;

            case "image":
                this.renderImage(node, state);
                break;

            case "link":
                this.renderLink(node, state, sectionId, layout);
                break;

            case "inline-format":
                this.renderInlineFormat(node, state, sectionId, layout);
                break;

            case "article":
            case "section":
            case "clause":
                this.renderLegalNode(node, state, sectionId, layout, depth);
                break;

            case "definition":
                this.renderDefinition(
                    /** @type {DefinitionNode} **/ (node),
                    state,
                    sectionId,
                    layout
                );
                break;

            case "notice":
                this.renderNotice(node, state, sectionId, layout);
                break;

            case "signature-block":
                this.renderSignatureBlock(node, state);
                break;

            default:
                // Render children for container types
                for (let i = 0, len = node.children.length; i < len; i++) {
                    const currentChild = node.children[i];
                    const nextChild = i + 1 < len ? node.children[i + 1] : null;
                    this.preflightHeadingFollowerBreak(
                        currentChild,
                        nextChild,
                        state,
                        sectionId,
                        depth
                    );
                    this.renderNode(
                        currentChild,
                        state,
                        sectionId,
                        layout,
                        depth
                    );
                }
        }

        if (node.keepRules?.pageBreakAfter) {
            let honorPageBreakAfter = true;
            const breakModeAfter = this.getSectionBreakMode(state, sectionId);
            if (breakModeAfter === "part-only") {
                honorPageBreakAfter = this.shouldBreakInPartOnlyMode(node);
            }
            if (honorPageBreakAfter) {
                this.newPage(state, sectionId);
            }
        }

        // Track last rendered block type
        if (
            node.type !== "text" &&
            node.type !== "inline-format" &&
            node.type !== "link"
        ) {
            state.lastNodeType = node.type;
        }
    }

    /**
     * @param {BaseNode} node
     * @param {PdfBuildState} state
     * @returns {void}
     */
    renderTextNode(node, state) {
        let text = node.getTextContent() ?? "";

        if (text.length === 0) {
            return;
        }

        // Typography: convert double-dash sequences to em dash
        // And -> to arrows
        text = applyTypographySubstitutions(text);

        const page = /** @type {PdfPage} */ (state.currentPage);
        const builder = page.contentBuilder;
        const fontSize =
            node.textStyle?.fontSize ?? this.config.baseFontSize ?? 10;
        const bold = node.textStyle?.bold ?? false;
        const italic = node.textStyle?.italic ?? false;
        const underline = node.textStyle?.underline === true;
        const baseFont = this.getFont(state, bold, italic);
        const lineHeight = this.config.lineHeight ?? 1.5;

        if (underline) {
            this.renderUnderlinedText(
                builder,
                state,
                text,
                state.margins.left,
                state.currentY,
                fontSize,
                baseFont
            );
        } else {
            this.renderTextAt(
                builder,
                state,
                text,
                state.margins.left,
                state.currentY,
                fontSize,
                baseFont,
                "left",
                node.textStyle?.color
            );
        }
        state.currentY -= fontSize * lineHeight;
    }

    /**
     * @param {BaseNode} node
     * @returns {{ label: string; sep: string; suppressLabel?: boolean } | null}
     */
    getRunInLabelInfo(node) {
        if (!node || !node.attrs) return null;

        const label = isString(node.attrs.runInLabel)
            ? node.attrs.runInLabel
            : isString(node.attrs.run_in_label)
            ? node.attrs.run_in_label
            : isString(node.attrs.runInLabelText)
            ? node.attrs.runInLabelText
            : null;

        if (label) {
            const trimmed = label.trim();
            if (trimmed.length === 0) return null;

            const sep = isString(node.attrs.runInLabelSeparator)
                ? node.attrs.runInLabelSeparator
                : isString(node.attrs.run_in_label_separator)
                ? node.attrs.run_in_label_separator
                : isString(node.attrs.runInLabelSep)
                ? node.attrs.runInLabelSep
                : " ";

            return { label: trimmed, sep: sep.length > 0 ? sep : " " };
        }

        // Continuation: indent content under a prior run-in label without reprinting the label.
        const continuationLabel = isString(
            node.attrs.runInLabelContinuationLabel
        )
            ? node.attrs.runInLabelContinuationLabel
            : isString(node.attrs.run_in_label_continuation_label)
            ? node.attrs.run_in_label_continuation_label
            : isString(node.attrs.runInLabelContinuationText)
            ? node.attrs.runInLabelContinuationText
            : null;

        if (!continuationLabel) return null;

        const trimmed = continuationLabel.trim();
        if (trimmed.length === 0) return null;

        const sep = isString(node.attrs.runInLabelContinuationSep)
            ? node.attrs.runInLabelContinuationSep
            : isString(node.attrs.run_in_label_continuation_sep)
            ? node.attrs.run_in_label_continuation_sep
            : isString(node.attrs.runInLabelContinuationSeparator)
            ? node.attrs.runInLabelContinuationSeparator
            : " ";

        return {
            label: trimmed,
            sep: sep.length > 0 ? sep : " ",
            suppressLabel: true
        };
    }

    /**
     * Render paragraph with a run-in label in the gutter and an indented content block.
     * Wrapped lines start directly under the content (not under the label).
     *
     * @param {BaseNode} node
     * @param {PdfBuildState} state
     * @param {string} sectionId
     * @param {{ label: string; sep: string; suppressLabel?: boolean }} labelInfo
     * @returns {void}
     */
    renderRunInLabelParagraph(node, state, sectionId, labelInfo) {
        const fontSize = this.config.baseFontSize ?? 10;
        const lineHeight = this.config.lineHeight ?? 1.5;

        const baseFont = this.getFont(state, false);
        const labelText = `${labelInfo.label}${labelInfo.sep}`;
        const labelWidth = measureTextWidth(labelText, baseFont, fontSize);

        // Nested run-in: if this paragraph carries a parent label
        // (e.g. "(a)" nested under "2."), shift the base X by the parent
        // label width so the sub-item renders indented beneath the parent.
        let parentIndent = 0;
        if (node && node.attrs) {
            const parentLabel = isString(node.attrs.runInParentLabel)
                ? node.attrs.runInParentLabel
                : isString(node.attrs.run_in_parent_label)
                ? node.attrs.run_in_parent_label
                : null;
            if (parentLabel) {
                const parentSep = isString(node.attrs.runInParentLabelSep)
                    ? node.attrs.runInParentLabelSep
                    : isString(node.attrs.run_in_parent_label_sep)
                    ? node.attrs.run_in_parent_label_sep
                    : " ";
                const parentLabelText = `${parentLabel}${parentSep}`;
                parentIndent = measureTextWidth(
                    parentLabelText,
                    baseFont,
                    fontSize
                );
                // Small additional indent so nested sub-items are visually
                // distinct from the parent's content start position.
                parentIndent += 10;
            }
        }

        const xLabel = state.margins.left + parentIndent;
        const y = state.currentY;

        const page = /** @type {PdfPage} */ (state.currentPage);
        const builder = page.contentBuilder;

        const suppressLabel = labelInfo && labelInfo.suppressLabel === true;

        if (!suppressLabel) {
            this.renderTextAt(
                builder,
                state,
                labelText,
                xLabel,
                y,
                fontSize,
                baseFont,
                "left"
            );
        }

        const availableWidth = state.contentWidth - labelWidth - parentIndent;

        // If label is too wide, fall back to label-only line then content on next line.
        if (availableWidth < fontSize * 2) {
            const runs = this.buildInlineRuns(node);

            // Normal: label takes the line, content drops to next line.
            // Continuation: no label is printed, so just render at normal paragraph position.
            const startY = suppressLabel
                ? y
                : state.currentY - fontSize * lineHeight;
            if (!suppressLabel) {
                state.currentY = startY;
            }

            state.currentY = this.renderInlineRunsWrapped(
                runs,
                state,
                sectionId,
                state.margins.left + parentIndent,
                startY,
                state.contentWidth - parentIndent,
                fontSize,
                lineHeight
            );
            return;
        }

        const runs = this.buildInlineRuns(node);
        state.currentY = this.renderInlineRunsWrapped(
            runs,
            state,
            sectionId,
            xLabel + labelWidth,
            y,
            availableWidth,
            fontSize,
            lineHeight
        );
    }

    renderParagraph(node, state, sectionId, layout) {
        const labelInfo = this.getRunInLabelInfo(node);
        if (labelInfo) {
            this.renderRunInLabelParagraph(node, state, sectionId, labelInfo);
            return;
        }

        const fontSize = this.config.baseFontSize ?? 10;
        const lineHeight = this.config.lineHeight ?? 1.5;
        const align = this.resolveNodeHorizontalAlign(node, "left");

        if (align !== "left") {
            const baseFont = this.getSemanticStyledFont(
                state,
                "body",
                this.getFont(state, false)
            );
            const text = applyTypographySubstitutions(this.extractText(node));
            this.renderPlainWrappedTextBlock(
                state,
                sectionId,
                text,
                fontSize,
                lineHeight,
                baseFont,
                align,
                node.textStyle?.color ?? undefined
            );
            return;
        }

        const runs = this.buildInlineRuns(node);
        state.currentY = this.renderInlineRunsWrapped(
            runs,
            state,
            sectionId,
            state.margins.left,
            state.currentY,
            state.contentWidth,
            fontSize,
            lineHeight
        );
    }

    /**
     * Build inline runs from a node subtree (paragraph/link/inline-format/text).
     * @param {BaseNode} root
     * @returns {ReadonlyArray<{text: string; bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string; formField?: boolean; formFieldType?: "text" | "signature"; formFieldText?: string; formFieldRawText?: string; formFieldName?: string; formFieldNameKey?: string; formFieldTooltip?: string; formFieldValue?: string; formFieldReadOnly?: boolean; formFieldRequired?: boolean; formFieldMaxLength?: number}>}
     */
    buildInlineRuns(root) {
        /** @type {Array<{text: string; bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string; formField?: boolean; formFieldType?: "text" | "signature"; formFieldText?: string; formFieldRawText?: string; formFieldName?: string; formFieldNameKey?: string; formFieldTooltip?: string; formFieldValue?: string; formFieldReadOnly?: boolean; formFieldRequired?: boolean; formFieldMaxLength?: number}>} */
        const runs = [];

        /** @type {{ bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string }} */
        const baseStyle = {
            bold: false,
            italic: false,
            underline: false,
            monospace: false
        };

        this.collectInlineRunsInto(runs, root, baseStyle);
        return runs;
    }

    /**
     * @param {Array<{text: string; bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string; formField?: boolean; formFieldType?: "text" | "signature"; formFieldText?: string; formFieldRawText?: string; formFieldName?: string; formFieldNameKey?: string; formFieldTooltip?: string; formFieldValue?: string; formFieldReadOnly?: boolean; formFieldRequired?: boolean; formFieldMaxLength?: number}>} out
     * @param {BaseNode} node
     * @param {{ bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string }} inherited
     * @returns {void}
     */
    collectInlineRunsInto(out, node, inherited) {
        if (node.type === "text") {
            let text = node.getTextContent() ?? "";
            if (text.length > 0) {
                const merged = this.mergeTextStyle(inherited, node.textStyle);
                if (!merged.monospace) {
                    text = applyTypographySubstitutions(text);
                }
                out.push({
                    text,
                    bold: merged.bold,
                    italic: merged.italic,
                    underline: merged.underline,
                    monospace: merged.monospace,
                    color: merged.color,
                    linkHref: merged.linkHref
                });
            }
            return;
        }

        if (
            node.type === "form-field" ||
            node.type === /** @type {NodeType} */ ("form_field") ||
            node.type === /** @type {NodeType} */ ("formField")
        ) {
            const merged = this.mergeTextStyle(inherited, node.textStyle);
            const placeholderText =
                /** @type {string | undefined} */ (
                    node.attrs?.placeholderText ??
                        node.attrs?.label ??
                        /** @type {any} */ (node).placeholderText
                ) ?? "";
            const rawText =
                /** @type {string | undefined} */ (
                    node.attrs?.rawText ?? /** @type {any} */ (node).rawText
                ) ?? `[${placeholderText}]`;
            const fieldType =
                /** @type {"text" | "signature" | undefined} */ (
                    node.attrs?.fieldType ?? /** @type {any} */ (node).fieldType
                ) === "signature"
                    ? "signature"
                    : "text";
            const fieldName =
                /** @type {string | undefined} */ (
                    node.attrs?.name ?? /** @type {any} */ (node).name
                );
            const fieldNameKey =
                /** @type {string | undefined} */ (
                    node.attrs?.fieldNameKey ??
                        node.attrs?.field_name_key ??
                        /** @type {any} */ (node).fieldNameKey ??
                        /** @type {any} */ (node).field_name_key
                );
            const tooltip =
                /** @type {string | undefined} */ (
                    node.attrs?.tooltip ?? /** @type {any} */ (node).tooltip
                );
            const value =
                /** @type {string | undefined} */ (
                    node.attrs?.value ?? /** @type {any} */ (node).value
                );
            const readOnly =
                typeof (node.attrs?.readOnly ?? /** @type {any} */ (node).readOnly) === "boolean"
                    ? /** @type {boolean} */ (node.attrs?.readOnly ?? /** @type {any} */ (node).readOnly)
                    : undefined;
            const required =
                typeof (node.attrs?.required ?? /** @type {any} */ (node).required) === "boolean"
                    ? /** @type {boolean} */ (node.attrs?.required ?? /** @type {any} */ (node).required)
                    : undefined;
            const maxLengthRaw =
                node.attrs?.maxLength ?? node.attrs?.max_length ?? /** @type {any} */ (node).maxLength;
            const maxLength =
                typeof maxLengthRaw === "number" && Number.isFinite(maxLengthRaw)
                    ? maxLengthRaw
                    : undefined;

            out.push({
                text: rawText,
                bold: merged.bold,
                italic: merged.italic,
                underline: merged.underline,
                monospace: false,
                color: merged.color,
                linkHref: merged.linkHref,
                formField: true,
                formFieldType: fieldType,
                formFieldText: placeholderText,
                formFieldRawText: rawText,
                formFieldName: fieldName,
                formFieldNameKey: fieldNameKey,
                formFieldTooltip: tooltip,
                formFieldValue: value,
                formFieldReadOnly: readOnly,
                formFieldRequired: required,
                formFieldMaxLength: maxLength
            });
            return;
        }

        if (node.type === "break") {
            out.push({
                text: "\n",
                bold: inherited.bold,
                italic: inherited.italic,
                underline: inherited.underline,
                monospace: inherited.monospace,
                color: inherited.color,
                linkHref: inherited.linkHref
            });
            return;
        }

        if (
            node.type === /** @type {NodeType} */ ("strong") ||
            node.type === /** @type {NodeType} */ ("bold") ||
            node.type === /** @type {NodeType} */ ("em") ||
            node.type === /** @type {NodeType} */ ("italic") ||
            node.type === /** @type {NodeType} */ ("emphasis") ||
            node.type === /** @type {NodeType} */ ("underline")
        ) {
            const formatType = /** @type {string} */ (
                node.attrs?.formatType ??
                    node.attrs?.format_type ??
                    /** @type {any} */ (node).formatType ??
                    /** @type {any} */ (node).format_type ??
                    node.type
            );
            /** @type {{ bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string }} */
            const next = {
                bold: inherited.bold,
                italic: inherited.italic,
                underline: inherited.underline,
                monospace: inherited.monospace,
                color: inherited.color,
                linkHref: inherited.linkHref
            };

            if (formatType === "bold" || formatType === "strong")
                next.bold = true;
            if (
                formatType === "italic" ||
                formatType === "em" ||
                formatType === "emphasis"
            )
                next.italic = true;
            if (formatType === "underline") next.underline = true;

            for (let i = 0, len = node.children.length; i < len; i++) {
                this.collectInlineRunsInto(out, node.children[i], next);
            }
            return;
        }

        if (
            node.type === "inline-format" ||
            node.type === /** @type {NodeType} */ ("inline_format") ||
            node.type === /** @type {NodeType} */ ("inlineFormat")
        ) {
            const formatType = /** @type {string} */ (
                node.attrs?.formatType ??
                    node.attrs?.format_type ??
                    /** @type {any} */ (node).formatType ??
                    /** @type {any} */ (node).format_type
            );
            /** @type {{ bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string }} */
            const next = {
                bold: inherited.bold,
                italic: inherited.italic,
                underline: inherited.underline,
                monospace: inherited.monospace,
                color: inherited.color,
                linkHref: inherited.linkHref
            };

            if (formatType === "bold" || formatType === "strong")
                next.bold = true;
            if (
                formatType === "italic" ||
                formatType === "em" ||
                formatType === "emphasis"
            )
                next.italic = true;
            if (formatType === "underline") next.underline = true;
            if (formatType === "code") next.monospace = true;

            for (let i = 0, len = node.children.length; i < len; i++) {
                this.collectInlineRunsInto(out, node.children[i], next);
            }
            return;
        }

        if (node.type === "definition") {
            const term =
                /** @type {any} */ (node).term ?? node.attrs?.term ?? "";
            const termText = term ? `"${String(term)}"` : "";

            let definitionBodyText = "";
            const definitionChildren = Array.isArray(node.children)
                ? node.children
                : [];
            for (let i = 0, len = definitionChildren.length; i < len; i++) {
                const child = definitionChildren[i];
                const childText = this.extractPlainText(child).trim();
                if (childText.length > 0) {
                    definitionBodyText = childText;
                    break;
                }
            }

            if (!inherited.monospace && definitionBodyText.length > 0) {
                definitionBodyText =
                    applyTypographySubstitutions(definitionBodyText);
            }

            const prefix =
                termText &&
                definitionBodyText.length > 0 &&
                !definitionBodyText.toLowerCase().startsWith("means")
                    ? " means "
                    : termText && definitionBodyText.length > 0
                    ? " "
                    : "";

            if (termText.length > 0) {
                out.push({
                    text: termText,
                    bold: true,
                    italic: inherited.italic,
                    underline: inherited.underline,
                    monospace: inherited.monospace,
                    color: inherited.color,
                    linkHref: inherited.linkHref
                });
            }

            if (prefix.length > 0) {
                out.push({
                    text: prefix,
                    bold: false,
                    italic: inherited.italic,
                    underline: inherited.underline,
                    monospace: inherited.monospace,
                    color: inherited.color,
                    linkHref: inherited.linkHref
                });
            }

            for (let i = 0, len = definitionChildren.length; i < len; i++) {
                this.collectInlineRunsInto(
                    out,
                    definitionChildren[i],
                    inherited
                );
            }
            return;
        }

        if (node.type === "link") {
            const href =
                /** @type {string} */ (
                    node.attrs?.href ??
                        node.attrs?.url ??
                        /** @type {any} */ (node).href ??
                        /** @type {any} */ (node).url
                ) ?? "";
            /** @type {{ bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string }} */
            const next = {
                bold: inherited.bold,
                italic: inherited.italic,
                underline: this.getLinkUnderline(),
                monospace: inherited.monospace,
                color: inherited.color,
                linkHref: href
            };

            for (let i = 0, len = node.children.length; i < len; i++) {
                this.collectInlineRunsInto(out, node.children[i], next);
            }
            return;
        }

        if (node.type === /** @type {NodeType} */ ("definition")) {
            const term = /** @type {any} */ (node).term;
            const hasTerm = term !== undefined && term !== null && term !== "";

            if (hasTerm) {
                let termText = String(term);
                if (!termText.startsWith('"') && !termText.startsWith("“")) {
                    termText = `"${termText}"`;
                }
                out.push({
                    text: termText,
                    bold: true,
                    italic: inherited.italic,
                    underline: inherited.underline,
                    monospace: inherited.monospace,
                    color: inherited.color,
                    linkHref: inherited.linkHref
                });

                const defTrim = this.extractText(node).trim();
                const prefix = defTrim.toLowerCase().startsWith("means")
                    ? " "
                    : " means ";
                out.push({
                    text: prefix,
                    bold: false,
                    italic: inherited.italic,
                    underline: inherited.underline,
                    monospace: inherited.monospace,
                    color: inherited.color,
                    linkHref: inherited.linkHref
                });
            }

            for (let i = 0, len = node.children.length; i < len; i++) {
                this.collectInlineRunsInto(out, node.children[i], inherited);
            }
            return;
        }

        // Default: descend
        for (let i = 0, len = node.children.length; i < len; i++) {
            this.collectInlineRunsInto(out, node.children[i], inherited);
        }
    }

    /**
     * @param {{ bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string }} inherited
     * @param {TextStyle | undefined} style
     * @returns {{ bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string }}
     */
    mergeTextStyle(inherited, style) {
        if (!style) return inherited;

        /** @type {{ bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string }} */
        const merged = {
            bold: inherited.bold || !!style.bold,
            italic: inherited.italic || !!style.italic,
            underline: inherited.underline || !!style.underline,
            monospace: inherited.monospace,
            color: inherited.color,
            linkHref: inherited.linkHref
        };

        if (isString(style.color) && style.color.length > 0) {
            merged.color = style.color;
        }

        return merged;
    }

    /**
     * @param {string} value
     * @returns {boolean}
     */
    isLikelyBracketPlaceholder(value) {
        const trimmed = value.trim();
        if (trimmed.length < 2 || trimmed.length > 120) return false;
        if (!/[A-Za-z]/.test(trimmed)) return false;
        if (/^[0-9\s,.;:()_-]+$/.test(trimmed)) return false;
        if (/^(?:https?:\/\/|www\.)/i.test(trimmed)) return false;
        if (/^[A-Za-z]:\\/.test(trimmed)) return false;
        return !/[{}<>]/.test(trimmed);
    }

    /**
     * @param {string} value
     * @returns {string}
     */
    canonicalInlineFieldKey(value) {
        return (
            value
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "_")
                .replace(/^_+|_+$/g, "") || "field"
        );
    }

    /**
     * @param {string} value
     * @returns {number | undefined}
     */
    inferInlinePlaceholderMaxLength(value) {
        const canonical = this.canonicalInlineFieldKey(value);
        if (canonical === "date" || canonical === "execution_date") {
            return 10;
        }
        if (canonical.includes("email")) {
            return 254;
        }
        if (
            canonical.includes("wallet") ||
            canonical.includes("public_key") ||
            canonical.includes("identifier") ||
            canonical.includes("resolution")
        ) {
            return 128;
        }
        if (canonical.includes("name") || canonical.includes("title")) {
            return 160;
        }
        return undefined;
    }

    /**
     * @param {{text: string; bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string; formField?: boolean; formFieldType?: "text" | "signature"; formFieldText?: string; formFieldRawText?: string; formFieldName?: string; formFieldNameKey?: string; formFieldTooltip?: string; formFieldValue?: string; formFieldReadOnly?: boolean; formFieldRequired?: boolean; formFieldMaxLength?: number}} run
     * @returns {ReadonlyArray<
     *   | { kind: "text"; text: string; bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string }
     *   | { kind: "placeholder"; rawText: string; placeholderText: string; bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string; fieldType?: "text" | "signature"; fieldName?: string; fieldNameKey?: string; tooltip?: string; value?: string; readOnly?: boolean; required?: boolean; maxLength?: number }
     * >}
     */
    splitInlineRunForPlaceholders(run) {
        if (run.formField) {
            return [{
                kind: "placeholder",
                rawText: run.formFieldRawText ?? run.text,
                placeholderText: run.formFieldText ?? "",
                bold: run.bold,
                italic: run.italic,
                underline: run.underline,
                monospace: false,
                color: run.color,
                linkHref: run.linkHref,
                fieldType: run.formFieldType,
                fieldName: run.formFieldName,
                fieldNameKey: run.formFieldNameKey,
                tooltip: run.formFieldTooltip,
                value: run.formFieldValue,
                readOnly: run.formFieldReadOnly,
                required: run.formFieldRequired,
                maxLength: run.formFieldMaxLength
            }];
        }

        if (!run.text || run.linkHref || run.monospace) {
            return [{ kind: "text", ...run }];
        }

        /** @type {Array<
         *   | { kind: "text"; text: string; bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string }
         *   | { kind: "placeholder"; rawText: string; placeholderText: string; bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string; fieldType?: "text" | "signature"; fieldName?: string; fieldNameKey?: string; tooltip?: string; value?: string; readOnly?: boolean; required?: boolean; maxLength?: number }
         * >} */
        const parts = [];

        const pattern = /\[([^\[\]\n]{1,120})\]/g;
        let lastIndex = 0;
        let found = false;
        let match = null;

        while ((match = pattern.exec(run.text)) !== null) {
            const inner = (match[1] ?? "").trim();
            if (!this.isLikelyBracketPlaceholder(inner)) {
                continue;
            }

            found = true;
            if (match.index > lastIndex) {
                parts.push({
                    kind: "text",
                    text: run.text.slice(lastIndex, match.index),
                    bold: run.bold,
                    italic: run.italic,
                    underline: run.underline,
                    monospace: run.monospace,
                    color: run.color,
                    linkHref: run.linkHref
                });
            }

            parts.push({
                kind: "placeholder",
                rawText: match[0],
                placeholderText: inner,
                bold: run.bold,
                italic: run.italic,
                underline: run.underline,
                monospace: run.monospace,
                color: run.color,
                linkHref: run.linkHref
            });
            lastIndex = match.index + match[0].length;
        }

        if (!found) {
            return [{ kind: "text", ...run }];
        }

        if (lastIndex < run.text.length) {
            parts.push({
                kind: "text",
                text: run.text.slice(lastIndex),
                bold: run.bold,
                italic: run.italic,
                underline: run.underline,
                monospace: run.monospace,
                color: run.color,
                linkHref: run.linkHref
            });
        }

        return parts;
    }

    /**
     * @param {ReadonlyArray<{text: string; bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string; formField?: boolean; formFieldType?: "text" | "signature"; formFieldText?: string; formFieldRawText?: string; formFieldName?: string; formFieldNameKey?: string; formFieldTooltip?: string; formFieldValue?: string; formFieldReadOnly?: boolean; formFieldRequired?: boolean; formFieldMaxLength?: number}>} runs
     * @returns {ReadonlyArray<
     *   | { kind: "text"; text: string; bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string }
     *   | { kind: "placeholder"; rawText: string; placeholderText: string; bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string; fieldType?: "text" | "signature"; fieldName?: string; fieldNameKey?: string; tooltip?: string; value?: string; readOnly?: boolean; required?: boolean; maxLength?: number }
     * >}
     */
    buildInlineSegments(runs) {
        /** @type {Array<
         *   | { kind: "text"; text: string; bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string }
         *   | { kind: "placeholder"; rawText: string; placeholderText: string; bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string; fieldType?: "text" | "signature"; fieldName?: string; fieldNameKey?: string; tooltip?: string; value?: string; readOnly?: boolean; required?: boolean; maxLength?: number }
         * >} */
        const segments = [];

        for (let i = 0, len = runs.length; i < len; i++) {
            const split = this.splitInlineRunForPlaceholders(runs[i]);
            for (let j = 0, jLen = split.length; j < jLen; j++) {
                segments.push(split[j]);
            }
        }

        return segments;
    }

    /**
     * @param {ReadonlyArray<
     *   | { kind: "text"; text: string; bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string }
     *   | { kind: "placeholder"; rawText: string; placeholderText: string; bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string; fieldType?: "text" | "signature"; fieldName?: string; fieldNameKey?: string; tooltip?: string; value?: string; readOnly?: boolean; required?: boolean; maxLength?: number }
     * >} segments
     * @param {number} startIndex
     * @returns {boolean}
     */
    hasVisibleInlineContentBeforeNextLine(segments, startIndex) {
        for (let i = startIndex, len = segments.length; i < len; i++) {
            const segment = segments[i];
            if (segment.kind === "placeholder") {
                return true;
            }
            const tokens = this.tokenizeInlineText(segment.text);
            for (let t = 0, tLen = tokens.length; t < tLen; t++) {
                const token = tokens[t];
                if (token.kind === "newline") {
                    return false;
                }
                if (token.kind === "text") {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * @param {string} placeholderText
     * @param {string} font
     * @param {number} fontSize
     * @param {number} availableWidth
     * @param {boolean} isTrailingOnLine
     * @returns {number}
     */
    resolveInlinePlaceholderWidth(
        placeholderText,
        font,
        fontSize,
        availableWidth,
        isTrailingOnLine
    ) {
        const measured = measureTextWidth(placeholderText, font, fontSize);
        const minWidth = Math.max(fontSize * 8, measured + fontSize * 1.6);
        if (availableWidth <= 0) return minWidth;
        if (isTrailingOnLine) {
            return Math.max(minWidth, availableWidth);
        }
        return Math.min(Math.max(minWidth, fontSize * 10), availableWidth);
    }

    /**
     * Render inline runs with word-wrapping.
     * Returns final Y position (already advanced to the next line after the last rendered line).
     *
     * @param {ReadonlyArray<{text: string; bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string; formField?: boolean; formFieldType?: "text" | "signature"; formFieldText?: string; formFieldRawText?: string; formFieldName?: string; formFieldNameKey?: string; formFieldTooltip?: string; formFieldValue?: string; formFieldReadOnly?: boolean; formFieldRequired?: boolean; formFieldMaxLength?: number}>} runs
     * @param {PdfBuildState} state
     * @param {string} sectionId
     * @param {number} x
     * @param {number} startY
     * @param {number} maxWidth
     * @param {number} fontSize
     * @param {number} lineHeight
     * @param {string} [semanticName]
     * @returns {number}
     */
    renderInlineRunsWrapped(
        runs,
        state,
        sectionId,
        x,
        startY,
        maxWidth,
        fontSize,
        lineHeight,
        semanticName = "body"
    ) {
        const segments = this.buildInlineSegments(runs);
        let y = startY;
        let cursorX = x;

        /** @type {{ href: string; x: number; y: number; width: number } | null} */
        let pendingLink = null;

        const flushPendingLink = () => {
            if (!pendingLink || pendingLink.width <= 0) return;

            const href = pendingLink.href;
            const isExternal =
                href.startsWith("http://") || href.startsWith("https://");

            this.addLinkAnnotation(state, {
                type: isExternal ? "external" : "internal",
                x: pendingLink.x,
                y: pendingLink.y - fontSize * 0.2,
                width: pendingLink.width,
                height: fontSize * lineHeight,
                url: isExternal ? href : undefined,
                targetNodeId: isExternal ? undefined : href.replace("#", "")
            });

            pendingLink = null;
        };

        const advanceLine = () => {
            flushPendingLink();

            const nextY = y - fontSize * lineHeight;
            if (nextY < state.margins.bottom + fontSize * lineHeight) {
                this._trace(
                    `    wrapOverflow: line at y=${y.toFixed(
                        1
                    )} → nextY=${nextY.toFixed(1)} < bottom(${(
                        state.margins.bottom +
                        fontSize * lineHeight
                    ).toFixed(1)}), NEW PAGE`
                );
                this.newPage(state, sectionId);
                y = state.currentY;
                cursorX = x;
                return;
            }

            y = nextY;
            cursorX = x;
        };

        let sawAnyContent = false;

        for (let s = 0, sLen = segments.length; s < sLen; s++) {
            const segment = segments[s];
            const font = this.getFont(
                state,
                segment.bold,
                segment.italic,
                segment.monospace,
                semanticName
            );

            if (segment.kind === "placeholder") {
                flushPendingLink();

                const isTrailingOnLine = !this.hasVisibleInlineContentBeforeNextLine(
                    segments,
                    s + 1
                );

                let availableWidth = x + maxWidth - cursorX;
                let fieldWidth = this.resolveInlinePlaceholderWidth(
                    segment.placeholderText,
                    font,
                    fontSize,
                    availableWidth,
                    isTrailingOnLine
                );

                if (cursorX !== x && cursorX + fieldWidth > x + maxWidth) {
                    advanceLine();
                    availableWidth = x + maxWidth - cursorX;
                    fieldWidth = this.resolveInlinePlaceholderWidth(
                        segment.placeholderText,
                        font,
                        fontSize,
                        availableWidth,
                        isTrailingOnLine
                    );
                }

                fieldWidth = Math.min(fieldWidth, Math.max(fontSize * 6, maxWidth));

                const page = /** @type {PdfPage} */ (state.currentPage);
                const builder = page.contentBuilder;
                const lineY = y - fontSize * 0.15;
                const thickness = Math.max(0.5, fontSize * 0.05);
                const fieldHeight = Math.max(fontSize * 1.4, fontSize * lineHeight * 0.9);
                const fieldY = y - fontSize * 0.42;
                const fieldNameKey =
                    segment.fieldNameKey && segment.fieldNameKey.length > 0
                        ? segment.fieldNameKey
                        : this.canonicalInlineFieldKey(segment.placeholderText);
                const fieldName =
                    segment.fieldName && segment.fieldName.length > 0
                        ? segment.fieldName
                        : `inline_field.${state.formFieldCounter + 1}.${fieldNameKey}`;

                builder
                    .saveState()
                    .setLineWidth(thickness)
                    .moveTo(cursorX, lineY)
                    .lineTo(cursorX + fieldWidth, lineY)
                    .stroke()
                    .restoreState();

                this.addFormFieldAnnotation(state, {
                    type: "form",
                    fieldType: segment.fieldType === "signature" ? "signature" : "text",
                    name: fieldName,
                    tooltip: segment.tooltip ?? segment.placeholderText,
                    x: cursorX,
                    y: fieldY,
                    width: fieldWidth,
                    height: fieldHeight,
                    fontSize,
                    value: segment.value,
                    readOnly: segment.readOnly,
                    required: segment.required,
                    maxLength:
                        typeof segment.maxLength === "number" &&
                        Number.isFinite(segment.maxLength)
                            ? segment.maxLength
                            : this.inferInlinePlaceholderMaxLength(
                                  segment.placeholderText
                              )
                });
                state.formFieldCounter = state.formFieldCounter + 1;
                cursorX += fieldWidth;
                sawAnyContent = true;
                continue;
            }

            const tokens = this.tokenizeInlineText(segment.text);

            for (let t = 0, tLen = tokens.length; t < tLen; t++) {
                const token = tokens[t];

                if (token.kind === "newline") {
                    advanceLine();
                    continue;
                }

                const tokenText = token.kind === "space" ? " " : token.text;
                const tokenWidth = measureTextWidth(tokenText, font, fontSize);

                if (token.kind === "space") {
                    if (cursorX === x) {
                        continue;
                    }
                    if (cursorX + tokenWidth > x + maxWidth) {
                        advanceLine();
                        continue;
                    }

                    cursorX += tokenWidth;
                    sawAnyContent = true;

                    if (pendingLink) {
                        pendingLink.width = cursorX - pendingLink.x;
                    }

                    continue;
                }

                if (tokenWidth > maxWidth) {
                    const parts = this.splitLongToken(
                        token.text,
                        font,
                        fontSize,
                        maxWidth
                    );

                    for (let p = 0, pLen = parts.length; p < pLen; p++) {
                        const part = parts[p];
                        const partWidth = measureTextWidth(
                            part,
                            font,
                            fontSize
                        );

                        if (
                            cursorX !== x &&
                            cursorX + partWidth > x + maxWidth
                        ) {
                            advanceLine();
                        }

                        this.renderInlineToken(
                            state,
                            part,
                            cursorX,
                            y,
                            fontSize,
                            font,
                            segment
                        );

                        if (segment.linkHref) {
                            if (
                                !pendingLink ||
                                pendingLink.href !== segment.linkHref ||
                                pendingLink.y !== y
                            ) {
                                flushPendingLink();
                                pendingLink = {
                                    href: segment.linkHref,
                                    x: cursorX,
                                    y,
                                    width: partWidth
                                };
                            } else {
                                pendingLink.width =
                                    cursorX + partWidth - pendingLink.x;
                            }
                        } else {
                            flushPendingLink();
                        }

                        cursorX += partWidth;
                        sawAnyContent = true;

                        if (p !== pLen - 1) {
                            advanceLine();
                        }
                    }

                    continue;
                }

                if (cursorX !== x && cursorX + tokenWidth > x + maxWidth) {
                    advanceLine();
                }

                this.renderInlineToken(
                    state,
                    token.text,
                    cursorX,
                    y,
                    fontSize,
                    font,
                    segment
                );

                if (segment.linkHref) {
                    if (
                        !pendingLink ||
                        pendingLink.href !== segment.linkHref ||
                        pendingLink.y !== y
                    ) {
                        flushPendingLink();
                        pendingLink = {
                            href: segment.linkHref,
                            x: cursorX,
                            y,
                            width: tokenWidth
                        };
                    } else {
                        pendingLink.width =
                            cursorX + tokenWidth - pendingLink.x;
                    }
                } else {
                    flushPendingLink();
                }

                cursorX += tokenWidth;
                sawAnyContent = true;
            }
        }

        flushPendingLink();

        if (!sawAnyContent) {
            advanceLine();
            return y;
        }

        advanceLine();
        return y;
    }

    /**
     * Render plain wrapped text with explicit block alignment.
     * Used for centered or right-aligned leading title-block paragraphs.
     *
     * @param {PdfBuildState} state
     * @param {string} sectionId
     * @param {string} text
     * @param {number} fontSize
     * @param {number} lineHeight
     * @param {string} font
     * @param {HorizontalAlign} align
     * @param {string | undefined} color
     * @returns {void}
     */
    renderPlainWrappedTextBlock(
        state,
        sectionId,
        text,
        fontSize,
        lineHeight,
        font,
        align,
        color
    ) {
        let page = /** @type {PdfPage} */ (state.currentPage);
        if (!page) {
            page = this.newPage(state, sectionId);
        }

        let builder = page.contentBuilder;
        const lines = this.wrapText(text, state.contentWidth, font, fontSize);
        const lineCount = Math.max(1, lines.length);

        for (let i = 0; i < lineCount; i++) {
            if (state.currentY < state.margins.bottom + fontSize * 2) {
                page = this.newPage(state, sectionId);
                builder = page.contentBuilder;
            }

            const line = lines[i] ?? "";
            const anchorX =
                align === "center"
                    ? state.margins.left + state.contentWidth / 2
                    : align === "right"
                    ? state.margins.left + state.contentWidth
                    : state.margins.left;

            this.renderTextAt(
                builder,
                state,
                line,
                anchorX,
                state.currentY,
                fontSize,
                font,
                align,
                color
            );

            state.currentY -= fontSize * lineHeight;
        }
    }

    /**
     * @param {string} text
     * @returns {ReadonlyArray<{kind: "text" | "space" | "newline"; text: string}>}
     */
    tokenizeInlineText(text) {
        /** @type {Array<{kind: "text" | "space" | "newline"; text: string}>} */
        const tokens = [];

        if (!text) return tokens;

        let i = 0;
        while (i < text.length) {
            const ch = text[i];

            if (ch === "\r") {
                i++;
                continue;
            }

            if (ch === "\n") {
                tokens.push({ kind: "newline", text: "" });
                i++;
                continue;
            }

            if (ch === " " || ch === "\t") {
                while (
                    i < text.length &&
                    (text[i] === " " || text[i] === "\t")
                ) {
                    i++;
                }
                tokens.push({ kind: "space", text: " " });
                continue;
            }

            const start = i;
            while (
                i < text.length &&
                text[i] !== "\n" &&
                text[i] !== "\r" &&
                text[i] !== " " &&
                text[i] !== "\t"
            ) {
                i++;
            }

            tokens.push({ kind: "text", text: text.slice(start, i) });
        }

        return tokens;
    }

    /**
     * Split a single long token into parts that fit maxWidth.
     * @param {string} text
     * @param {string} font
     * @param {number} fontSize
     * @param {number} maxWidth
     * @returns {ReadonlyArray<string>}
     */
    splitLongToken(text, font, fontSize, maxWidth) {
        /** @type {string[]} */
        const parts = [];

        let start = 0;
        while (start < text.length) {
            let end = start + 1;

            while (end <= text.length) {
                const slice = text.slice(start, end);
                const w = measureTextWidth(slice, font, fontSize);
                if (w > maxWidth) {
                    break;
                }
                end++;
            }

            // If even a single char doesn't fit, force progress
            if (end === start + 1) {
                parts.push(text.slice(start, end));
                start = end;
                continue;
            }

            // Step back one char (last fit)
            const fitEnd = end - 1;
            parts.push(text.slice(start, fitEnd));
            start = fitEnd;
        }

        return parts;
    }

    /**
     * Estimate how many lines a set of inline runs will take when wrapped.
     * @param {ReadonlyArray<{text: string; bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string}>} runs
     * @param {PdfBuildState} state
     * @param {number} maxWidth
     * @param {number} fontSize
     * @param {string} [semanticName]
     * @returns {number}
     */
    estimateInlineRunsLineCount(
        runs,
        state,
        maxWidth,
        fontSize,
        semanticName = "body"
    ) {
        const segments = this.buildInlineSegments(runs);
        let lines = 1;
        let cursorX = 0;

        for (let s = 0, sLen = segments.length; s < sLen; s++) {
            const segment = segments[s];

            const font = this.getFont(
                state,
                segment.bold,
                segment.italic,
                segment.monospace,
                semanticName
            );

            if (segment.kind === "placeholder") {
                const isTrailingOnLine = !this.hasVisibleInlineContentBeforeNextLine(
                    segments,
                    s + 1
                );
                let availableWidth = maxWidth - cursorX;
                let fieldWidth = this.resolveInlinePlaceholderWidth(
                    segment.placeholderText,
                    font,
                    fontSize,
                    availableWidth,
                    isTrailingOnLine
                );

                if (cursorX !== 0 && cursorX + fieldWidth > maxWidth) {
                    lines++;
                    cursorX = 0;
                    availableWidth = maxWidth;
                    fieldWidth = this.resolveInlinePlaceholderWidth(
                        segment.placeholderText,
                        font,
                        fontSize,
                        availableWidth,
                        isTrailingOnLine
                    );
                }

                cursorX += Math.min(
                    fieldWidth,
                    Math.max(fontSize * 6, maxWidth)
                );
                continue;
            }

            const tokens = this.tokenizeInlineText(segment.text);

            for (let t = 0, tLen = tokens.length; t < tLen; t++) {
                const token = tokens[t];

                if (token.kind === "newline") {
                    lines++;
                    cursorX = 0;
                    continue;
                }

                const tokenText = token.kind === "space" ? " " : token.text;
                const tokenWidth = measureTextWidth(tokenText, font, fontSize);

                if (token.kind === "space") {
                    if (cursorX === 0) {
                        continue;
                    }
                    if (cursorX + tokenWidth > maxWidth) {
                        lines++;
                        cursorX = 0;
                        continue;
                    }
                    cursorX += tokenWidth;
                    continue;
                }

                if (tokenWidth > maxWidth) {
                    const parts = this.splitLongToken(
                        token.text,
                        font,
                        fontSize,
                        maxWidth
                    );

                    for (let p = 0, pLen = parts.length; p < pLen; p++) {
                        const part = parts[p];
                        const partWidth = measureTextWidth(
                            part,
                            font,
                            fontSize
                        );

                        if (cursorX !== 0 && cursorX + partWidth > maxWidth) {
                            lines++;
                            cursorX = 0;
                        }

                        cursorX += partWidth;

                        if (p !== pLen - 1) {
                            lines++;
                            cursorX = 0;
                        }
                    }

                    continue;
                }

                if (cursorX !== 0 && cursorX + tokenWidth > maxWidth) {
                    lines++;
                    cursorX = 0;
                }

                cursorX += tokenWidth;
            }
        }

        return lines;
    }

    /**
     * Render a single inline token at position.
     * @param {PdfBuildState} state
     * @param {string} text
     * @param {number} x
     * @param {number} y
     * @param {number} fontSize
     * @param {string} font
     * @param {{ underline: boolean; color?: string; linkHref?: string; bold?: boolean }} run
     * @returns {void}
     */
    renderInlineToken(state, text, x, y, fontSize, font, run) {
        const page = /** @type {PdfPage} */ (state.currentPage);
        const builder = page.contentBuilder;

        const color = run.linkHref ? this.resolveLinkColor(run) : run.color;

        this.renderTextAt(
            builder,
            state,
            text,
            x,
            y,
            fontSize,
            font,
            "left",
            color
        );

        if (run.underline || (run.linkHref && this.getLinkUnderline())) {
            const width = measureTextWidth(text, font, fontSize);
            const underlineY = y - fontSize * 0.15;
            const thickness = Math.max(0.5, fontSize * 0.05);

            if (color) {
                const rgb = this.hexToRgb(color);
                builder
                    .saveState()
                    .setLineWidth(thickness)
                    .setStrokeColor(rgb.r, rgb.g, rgb.b)
                    .moveTo(x, underlineY)
                    .lineTo(x + width, underlineY)
                    .stroke()
                    .restoreState();
            } else {
                builder
                    .saveState()
                    .setLineWidth(thickness)
                    .moveTo(x, underlineY)
                    .lineTo(x + width, underlineY)
                    .stroke()
                    .restoreState();
            }
        }
    }

    /**
     * Render inline child (text, link, inline-format)
     * @param {BaseNode} child
     * @param {PdfBuildState} state
     * @param {number} x
     * @param {PdfContentStreamBuilder} builder
     * @param {number} fontSize
     * @param {string} [semanticName]
     * @returns {number} New x position
     */
    renderInlineChild(child, state, x, builder, fontSize, semanticName) {
        const lineHeight = this.config.lineHeight ?? 1.5;

        if (child.type === "text") {
            const text = child.getTextContent() ?? "";

            const bold = child.textStyle?.bold ?? false;
            const italic = child.textStyle?.italic ?? false;
            const baseFont = this.getFont(
                state,
                bold,
                italic,
                false,
                semanticName
            );

            this.renderTextAt(
                builder,
                state,
                text,
                x,
                state.currentY,
                fontSize,
                baseFont,
                "left",
                child.textStyle?.color
            );

            return x + measureTextWidth(text, baseFont, fontSize);
        }

        if (
            child.type === /** @type {NodeType} */ ("strong") ||
            child.type === /** @type {NodeType} */ ("bold") ||
            child.type === /** @type {NodeType} */ ("em") ||
            child.type === /** @type {NodeType} */ ("italic") ||
            child.type === /** @type {NodeType} */ ("emphasis") ||
            child.type === /** @type {NodeType} */ ("underline")
        ) {
            const formatType = /** @type {string} */ (
                child.attrs?.formatType ??
                    child.attrs?.format_type ??
                    /** @type {any} */ (child).formatType ??
                    /** @type {any} */ (child).format_type ??
                    child.type
            );
            const bold = formatType === "bold" || formatType === "strong";
            const italic =
                formatType === "italic" ||
                formatType === "em" ||
                formatType === "emphasis";
            const underline = formatType === "underline";

            for (let i = 0, len = child.children.length; i < len; i++) {
                const grandchild = child.children[i];
                if (grandchild.type === "text") {
                    const text = grandchild.getTextContent() ?? "";

                    const baseFont = this.getFont(
                        state,
                        bold,
                        italic,
                        false,
                        semanticName
                    );

                    if (underline) {
                        this.renderUnderlinedText(
                            builder,
                            state,
                            text,
                            x,
                            state.currentY,
                            fontSize,
                            baseFont
                        );
                    } else {
                        this.renderTextAt(
                            builder,
                            state,
                            text,
                            x,
                            state.currentY,
                            fontSize,
                            baseFont,
                            "left"
                        );
                    }

                    x += measureTextWidth(text, baseFont, fontSize);
                }
            }
        }

        if (child.type === "inline-format") {
            const formatType = /** @type {string} */ (child.attrs?.formatType);
            const bold = formatType === "bold";
            const italic = formatType === "italic";
            const underline = formatType === "underline";

            for (let i = 0, len = child.children.length; i < len; i++) {
                const grandchild = child.children[i];
                if (grandchild.type === "text") {
                    const text = grandchild.getTextContent() ?? "";

                    const baseFont = this.getFont(
                        state,
                        bold,
                        italic,
                        false,
                        semanticName
                    );

                    if (underline) {
                        this.renderUnderlinedText(
                            builder,
                            state,
                            text,
                            x,
                            state.currentY,
                            fontSize,
                            baseFont
                        );
                    } else {
                        this.renderTextAt(
                            builder,
                            state,
                            text,
                            x,
                            state.currentY,
                            fontSize,
                            baseFont,
                            "left"
                        );
                    }

                    x += measureTextWidth(text, baseFont, fontSize);
                }
            }
        }

        if (child.type === "link") {
            const href = /** @type {string} */ (child.attrs?.href) ?? "";
            const text = this.extractText(child);

            const bold = child.textStyle?.bold ?? false;
            const italic = child.textStyle?.italic ?? false;
            const baseFont = this.getFont(
                state,
                bold,
                italic,
                false,
                semanticName
            );

            const linkColor = this.resolveLinkColor({ bold });

            this.renderTextAt(
                builder,
                state,
                text,
                x,
                state.currentY,
                fontSize,
                baseFont,
                "left",
                linkColor
            );

            const textWidth = measureTextWidth(text, baseFont, fontSize);

            if (this.getLinkUnderline()) {
                // Add underline
                const underlineY = state.currentY - fontSize * 0.15;
                builder.saveState().setLineWidth(0.5);

                const rgb = this.hexToRgb(linkColor);
                builder.setStrokeColor(rgb.r, rgb.g, rgb.b);
                builder
                    .moveTo(x, underlineY)
                    .lineTo(x + textWidth, underlineY)
                    .stroke()
                    .restoreState();
            }

            // Add link annotation
            const isExternal =
                href.startsWith("http://") || href.startsWith("https://");
            this.addLinkAnnotation(state, {
                type: isExternal ? "external" : "internal",
                x,
                y: state.currentY - fontSize * 0.2,
                width: textWidth,
                height: fontSize * lineHeight,
                url: isExternal ? href : undefined,
                targetNodeId: isExternal ? undefined : href.replace("#", "")
            });

            return x + textWidth;
        }

        return x;
    }

    // =========================================================================
    // Table Rendering
    // =========================================================================

    /**
     * Render a table
     * @param {TableNode} node
     * @param {PdfBuildState} state
     * @param {string} sectionId
     * @param {LayoutResult} layout
     * @returns {void}
     */
    renderTable(node, state, sectionId, layout) {
        const page = /** @type {PdfPage} */ (state.currentPage);
        const builder = page.contentBuilder;
        const baseFontSize = this.config.baseFontSize ?? 10;
        const baseLineHeight = this.config.lineHeight ?? 1.5;

        /** @type {TableRenderConfig} */
        const tableCfg = this.resolveTableRenderConfig(node);
        const tableLineHeight = this._getTableLineHeight(
            tableCfg,
            baseLineHeight
        );

        const defaultCellVAlign =
            this._normalizeTableVAlign(tableCfg.cellVAlign) ?? "top";

        // Get column definitions or calculate equal widths
        const columnCount = this.getTableColumnCount(node);

        const tableBox = this._resolveTableBox(state, tableCfg, columnCount);
        const tableX = tableBox.x;
        const tableWidth = tableBox.width;
        let tableY = state.currentY;

        const columnWidths = this.calculateColumnWidths(
            node,
            tableWidth,
            columnCount
        );

        // Tables with many columns need smaller type/padding to stay readable
        // without overflowing the page.
        const avgColWidth = tableWidth / Math.max(1, columnWidths.length);
        const tableFontSize = this._getTableFontSize(
            tableCfg,
            baseFontSize,
            avgColWidth
        );

        const defaultPad = Math.max(2, 4 * (tableFontSize / baseFontSize));
        const bodyPadding = this._normalizeBoxPadding(
            tableCfg.cellPadding,
            defaultPad
        );
        const headerPadding = hasProperty(tableCfg.header, "cellPadding")
            ? this._normalizeBoxPadding(tableCfg.header.cellPadding, defaultPad)
            : bodyPadding;

        const borderWidth = numberOr(tableCfg.borderWidth, 0.5) || 0.5;
        const borderColor = tableCfg.borderColor ?? 0;

        const headerBackground = tableCfg.header?.backgroundColor ?? 0.9;
        const headerTextColor = tableCfg.header?.textColor;

        const zebraEnabled = this._isZebraEnabled(tableCfg, node);
        const zebraOdd = tableCfg.zebra?.oddBackground ?? 1;
        const zebraEven = tableCfg.zebra?.evenBackground ?? 0.97;

        // Render caption if present
        if (node.attrs?.caption) {
            const caption = /** @type {string} */ (node.attrs.caption);
            const captionFont = this.getFont(
                state,
                true,
                false,
                false,
                "table_caption"
            );
            this.renderTextAt(
                builder,
                state,
                caption,
                tableX + tableWidth / 2,
                tableY,
                baseFontSize * 0.9,
                captionFont,
                "center"
            );
            tableY -= baseFontSize * baseLineHeight;
        }

        // Render rows
        let bodyRowIndex = 0;
        for (
            let rowIdx = 0, len = node.children.length;
            rowIdx < len;
            rowIdx++
        ) {
            const row = node.children[rowIdx];
            const isHeader =
                row.type === "header-row" ||
                (rowIdx === 0 && node.attrs?.headerRow !== false);

            const padding = isHeader ? headerPadding : bodyPadding;
            const rowBg = this._resolveTableRowBackground(
                row,
                isHeader,
                zebraEnabled,
                bodyRowIndex,
                headerBackground,
                zebraOdd,
                zebraEven
            );

            const rowTextColor = isHeader ? headerTextColor : undefined;

            const rowHeight = this.calculateRowHeight(
                row,
                state,
                columnWidths,
                tableFontSize,
                padding,
                isHeader,
                tableLineHeight,
                borderWidth
            );

            // Check if row fits on page
            if (tableY - rowHeight < state.margins.bottom) {
                // Need new page
                this.newPage(state, sectionId);
                tableY = state.currentY;

                // Re-render header row if we split the table
                if (rowIdx > 0 && node.attrs?.headerRow !== false) {
                    const headerRow = node.children[0];
                    const headerHeight = this.calculateRowHeight(
                        headerRow,
                        state,
                        columnWidths,
                        tableFontSize,
                        headerPadding,
                        true,
                        tableLineHeight,
                        borderWidth
                    );
                    this.renderTableRow(
                        headerRow,
                        state,
                        tableX,
                        tableY,
                        columnWidths,
                        headerHeight,
                        borderWidth,
                        borderColor,
                        true,
                        tableFontSize,
                        tableLineHeight,
                        this._isColorNone(headerBackground)
                            ? undefined
                            : headerBackground,
                        headerTextColor,
                        headerPadding,
                        defaultCellVAlign
                    );
                    tableY -= headerHeight;
                }
            }

            // Render row
            this.renderTableRow(
                row,
                state,
                tableX,
                tableY,
                columnWidths,
                rowHeight,
                borderWidth,
                borderColor,
                isHeader,
                tableFontSize,
                tableLineHeight,
                rowBg,
                rowTextColor,
                padding,
                defaultCellVAlign
            );

            tableY -= rowHeight;

            if (!isHeader) {
                bodyRowIndex++;
            }
        }

        // Add spacing after table for following content
        const postTableSpacing = baseFontSize * baseLineHeight;
        this._recordInkBottomY(state, tableY);
        state.currentY = tableY - postTableSpacing;
    }

    /**
     * Get column count from table
     * @param {TableNode} table
     * @returns {number}
     */
    getTableColumnCount(table) {
        const columns = table.columns ?? table.attrs?.columns;
        if (columns && columns.length > 0) {
            return columns.length;
        }

        let maxCols = 1;
        for (let i = 0, len = table.children.length; i < len; i++) {
            const row = table.children[i];
            if (
                row &&
                Array.isArray(row.children) &&
                row.children.length > maxCols
            ) {
                maxCols = row.children.length;
            }
        }
        return maxCols;
    }

    /**
     * Calculate column widths
     * @param {TableNode} table
     * @param {number} tableWidth
     * @param {number} columnCount
     * @returns {number[]}
     */
    calculateColumnWidths(table, tableWidth, columnCount) {
        const columns = table.columns ?? table.attrs?.columns;

        if (columns && columns.length > 0) {
            /** @type {number[]} */
            const widths = [];
            let totalFixed = 0;
            let autoCount = 0;

            const effectiveCount = Math.max(columnCount, columns.length);
            const minAutoWidth = 20;

            for (let i = 0; i < effectiveCount; i++) {
                const col = columns[i];
                if (!col) {
                    widths.push(0);
                    autoCount++;
                    continue;
                }

                if (col.widthType === "fixed" && col.width) {
                    if (isString(col.width)) {
                        const width = parseInt(col.width);
                        const w = Number.isFinite(width) ? width : 0;
                        widths.push(w);
                        totalFixed += w;
                    } else {
                        widths.push(col.width);
                        totalFixed += col.width;
                    }
                } else if (col.widthType === "percent" && col.width) {
                    if (isString(col.width)) {
                        let width;

                        if (col.width.indexOf("%") !== -1) {
                            width = parseFloat(col.width.replace("%", ""));
                        } else {
                            width = parseFloat(col.width);
                        }

                        const w = tableWidth * (width / 100);
                        widths.push(w);
                        totalFixed += w;
                    } else {
                        const w = tableWidth * (col.width / 100);
                        widths.push(w);
                        totalFixed += w;
                    }
                } else {
                    widths.push(0);
                    autoCount++;
                }
            }

            // Distribute remaining width to auto columns
            if (autoCount > 0) {
                const remaining = tableWidth - totalFixed;
                const autoWidth = Math.max(minAutoWidth, remaining / autoCount);
                for (let i = 0, len = widths.length; i < len; i++) {
                    if (widths[i] === 0) {
                        widths[i] = autoWidth;
                    }
                }
            }

            // Normalize widths to fit the available table width.
            let total = 0;
            for (let i = 0, len = widths.length; i < len; i++) {
                total += widths[i];
            }

            if (total > 0 && Math.abs(total - tableWidth) > 0.5) {
                const factor = tableWidth / total;
                for (let i = 0, len = widths.length; i < len; i++) {
                    widths[i] *= factor;
                }
            }

            return widths;
        }

        // Equal width columns
        const width = tableWidth / columnCount;
        return Array.from({ length: columnCount }, () => width);
    }

    /**
     * Calculate row height
     * @param {RowNode} row
     * @param {PdfBuildState} state
     * @param {number[]} columnWidths
     * @param {number} fontSizeOverride
     * @param {Padding} paddingOverride
     * @param {boolean} isHeader
     * @param {number} lineHeightOverride
     * @param {number} borderWidth
     * @returns {number}
     */
    calculateRowHeight(
        row,
        state,
        columnWidths,
        fontSizeOverride,
        paddingOverride,
        isHeader,
        lineHeightOverride,
        borderWidth
    ) {
        const fontSize = fontSizeOverride ?? this.config.baseFontSize ?? 10;
        const lineHeight = lineHeightOverride ?? this.config.lineHeight ?? 1.5;

        const padding = this._normalizeBoxPadding(paddingOverride, 4);

        // Match renderTableRow: border inset eats into available cell width
        const borderInset = Math.max(0, (borderWidth ?? 0.5) / 2);

        // Ensure at least one line height.
        let maxHeight = fontSize * lineHeight + padding.top + padding.bottom;

        const baseFont = this.getSemanticStyledFont(
            state,
            isHeader ? "table_header" : "table_body",
            this.getFont(state, !!isHeader),
            { bold: !!isHeader }
        );
        const cellCount = Math.max(1, columnWidths.length);

        for (let i = 0; i < cellCount; i++) {
            const cell = row.children[i];
            const cellWidth =
                columnWidths[i] ??
                columnWidths[columnWidths.length - 1] ??
                columnWidths[0] ??
                0;
            const text = cell ? this.extractText(cell) : "";

            const lines = this.wrapText(
                text,
                Math.max(
                    1,
                    cellWidth - borderInset * 2 - padding.left - padding.right
                ),
                baseFont,
                fontSize
            );

            const cellHeight =
                lines.length * fontSize * lineHeight +
                padding.top +
                padding.bottom;
            if (cellHeight > maxHeight) {
                maxHeight = cellHeight;
            }
        }

        return maxHeight;
    }

    /**
     * Render a table row
     * @param {RowNode} row
     * @param {PdfBuildState} state
     * @param {number} x
     * @param {number} y
     * @param {number[]} columnWidths
     * @param {number} rowHeight
     * @param {number} borderWidth
     * @param {string | number} borderColor
     * @param {boolean} isHeader
     * @param {number} fontSizeOverride
     * @param {number} lineHeightOverride
     * @param {string | number | undefined} rowBackground
     * @param {string | number | undefined} rowTextColor
     * @param {Padding} paddingOverride
     * @param {"top"|"middle"|"bottom"} defaultCellVAlign
     * @returns {void}
     */
    renderTableRow(
        row,
        state,
        x,
        y,
        columnWidths,
        rowHeight,
        borderWidth,
        borderColor,
        isHeader,
        fontSizeOverride,
        lineHeightOverride,
        rowBackground,
        rowTextColor,
        paddingOverride,
        defaultCellVAlign
    ) {
        const page = /** @type {PdfPage} */ (state.currentPage);
        const builder = page.contentBuilder;
        const fontSize = fontSizeOverride ?? this.config.baseFontSize ?? 10;
        const lineHeight = lineHeightOverride ?? this.config.lineHeight ?? 1.5;

        const padding = this._normalizeBoxPadding(paddingOverride, 4);

        let cellX = x;

        // Draw background for header / zebra / explicit row background
        if (!this._isColorNone(rowBackground)) {
            const totalWidth = columnWidths.reduce((a, b) => a + b, 0);
            this._drawFilledRectColor(
                builder,
                x,
                y - rowHeight,
                totalWidth,
                rowHeight,
                rowBackground
            );
        }

        // Render cells (use full column count to keep grid consistent)
        const cellCount = Math.max(1, columnWidths.length);
        for (let i = 0; i < cellCount; i++) {
            const cell = row.children[i];
            const cellWidth =
                columnWidths[i] ??
                columnWidths[columnWidths.length - 1] ??
                columnWidths[0];

            const cellStyleBackgroundColor =
                cell?.attrs?.style?.backgroundColor ?? undefined;

            if (!this._isColorNone(cellStyleBackgroundColor)) {
                this._drawFilledRectColor(
                    builder,
                    cellX,
                    y - rowHeight,
                    cellWidth,
                    rowHeight,
                    cellStyleBackgroundColor
                );
            }

            // Draw cell border
            this._drawStrokedRectColor(
                builder,
                cellX,
                y - rowHeight,
                cellWidth,
                rowHeight,
                borderWidth,
                borderColor
            );

            // Render cell content
            const text = cell ? this.extractText(cell) : "";
            const baseFont = this.getSemanticStyledFont(
                state,
                isHeader ? "table_header" : "table_body",
                this.getFont(state, isHeader),
                { bold: isHeader }
            );
            const fontName = this.getFontResourceName(state, baseFont);

            const align =
                /** @type {HorizontalAlign | undefined} */ (
                    cell?.attrs?.align
                ) ?? "left";

            const cellStyleTextColor =
                cell?.attrs?.style?.textColor ?? undefined;

            const borderInset = Math.max(0, borderWidth / 2);

            const innerLeftX = cellX + borderInset + padding.left;
            const innerRightX = cellX + cellWidth - borderInset - padding.right;
            const innerWidth = Math.max(1, innerRightX - innerLeftX);

            // Layout text again to get lines within the inner content box
            const lines = this.wrapText(text, innerWidth, baseFont, fontSize);

            const cellVAlign =
                this._normalizeTableVAlign(
                    cell && cell.attrs
                        ? ("valign" in cell.attrs
                              ? cell.attrs.valign
                              : undefined) ??
                              cell.attrs.verticalAlign ??
                              ("vertical_align" in cell.attrs
                                  ? cell.attrs.vertical_align
                                  : undefined)
                        : undefined
                ) ??
                defaultCellVAlign ??
                "top";

            // Text layout within the inner content box (border + padding aware)
            const totalTextHeight = lines.length * fontSize * lineHeight;

            const innerTopY = y - borderInset - padding.top;
            const innerBottomY = y - rowHeight + borderInset + padding.bottom;
            const innerHeight = innerTopY - innerBottomY;

            let textBlockTopY;
            if (innerHeight <= 0 || totalTextHeight >= innerHeight) {
                textBlockTopY = innerTopY;
            } else if (cellVAlign === "bottom") {
                textBlockTopY = innerBottomY + totalTextHeight;
            } else if (cellVAlign === "middle") {
                textBlockTopY = innerTopY - (innerHeight - totalTextHeight) / 2;
            } else {
                // top
                textBlockTopY = innerTopY;
            }

            // Render lines - baseline offset accounts for font ascender.
            let textY = textBlockTopY - fontSize * 0.8;

            for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
                const line = lines[lineIdx];
                let textX = innerLeftX;

                if (align === "center" || align === "right") {
                    const lineWidth = measureTextWidth(
                        line,
                        baseFont,
                        fontSize
                    );
                    if (align === "center") {
                        textX = innerLeftX + (innerWidth - lineWidth) / 2;
                    } else {
                        textX = innerRightX - lineWidth;
                    }
                }

                const effectiveTextColor = cellStyleTextColor ?? rowTextColor;

                builder.saveState();
                if (!this._isColorNone(effectiveTextColor)) {
                    this._applyFillColor(builder, effectiveTextColor);
                } else {
                    builder.setFillGray(0);
                }

                builder
                    .beginText()
                    .setFont(fontName, fontSize)
                    .setTextMatrix(1, 0, 0, 1, textX, textY)
                    .showText(line)
                    .endText()
                    .restoreState();

                this._recordInkFromTextBaseline(state, textY, fontSize, line);

                textY -= fontSize * lineHeight;
            }

            cellX += cellWidth;
        }
    }

    // =========================================================================
    // Table Style Helpers
    // =========================================================================

    /**
     * Resolve table config for a specific node.
     * Global config comes from renderer config `table`.
     * Per-table overrides can be supplied on the node via
     * `attrs.table` / `attrs.table_style`.
     *
     * @param {TableNode} node
     * @returns {TableRenderConfig}
     */
    resolveTableRenderConfig(node) {
        const base = this.config.table;
        const nodeCfg =
            node.attrs?.table ??
            node.attrs?.table_style ??
            node.attrs?.tableStyle;

        if (!base && !nodeCfg) {
            return /** @type {TableRenderConfig} */ ({});
        }

        if (base && !nodeCfg) {
            return /** @type {TableRenderConfig} */ ({ ...base });
        }

        if (!base && nodeCfg) {
            return /** @type {TableRenderConfig} */ ({ ...nodeCfg });
        }

        return this._mergeTableConfig(base, nodeCfg);
    }

    /**
     * @private
     * @param {TableRenderConfig} base
     * @param {TableRenderConfig} overlay
     * @returns {TableRenderConfig}
     */
    _mergeTableConfig(base, overlay) {
        return {
            ...base,
            ...overlay,
            header: {
                ...(base.header ?? {}),
                ...(overlay.header ?? {})
            },
            zebra: {
                ...(base.zebra ?? {}),
                ...(overlay.zebra ?? {})
            }
        };
    }

    /**
     * @private
     * @param {unknown} value
     * @returns {number | null}
     */
    _coerceFiniteNumber(value) {
        if (isNumber(value)) {
            return Number.isFinite(value) ? value : null;
        }
        if (isString(value)) {
            const trimmed = value.trim();
            if (trimmed.length === 0) {
                return null;
            }
            const n = Number(trimmed);
            return Number.isFinite(n) ? n : null;
        }
        return null;
    }

    /**
     * Resolve the table box. Allows tables to bleed into margins by a controlled
     * amount (useful for wide tables in filings) while keeping a hard safety inset
     * from the physical page edge.
     *
     * Supported keys on table config (global `config.table` or per-table attrs):
     * - bleed_in / bleedIn: number of inches to bleed on both sides
     * - bleed_left_in / bleedLeftIn: inches to bleed on left
     * - bleed_right_in / bleedRightIn: inches to bleed on right
     * - bleed_pt / bleedPt: points to bleed on both sides
     * - bleed_left_pt / bleedLeftPt: points to bleed on left
     * - bleed_right_pt / bleedRightPt: points to bleed on right
     * - min_page_edge_inset_in / minPageEdgeInsetIn: inches to keep from page edge (default 0.25in)
     * - min_page_edge_inset_pt / minPageEdgeInsetPt: points to keep from page edge
     * - bleed_if_columns_gt / bleedIfColumnsGt: apply bleed only if columnCount > N
     * - bleed_if_columns_gte / bleedIfColumnsGte: apply bleed only if columnCount >= N
     * - bleed_min_columns / bleedMinColumns: alias for bleed_if_columns_gte
     *
     * @private
     * @param {PdfBuildState} state
     * @param {TableRenderConfig} tableCfg
     * @param {number} columnCount
     * @returns {{ x: number; width: number }}
     */
    _resolveTableBox(state, tableCfg, columnCount) {
        const cfg = /** @type {Record<string, unknown>} */ (tableCfg);
        const ptPerIn = 72;

        const bleedIfColumnsGt = this._coerceFiniteNumber(
            cfg.bleed_if_columns_gt ??
                cfg.bleedIfColumnsGt ??
                cfg.bleed_columns_gt ??
                cfg.bleedColumnsGt
        );
        const bleedIfColumnsGte = this._coerceFiniteNumber(
            cfg.bleed_if_columns_gte ??
                cfg.bleedIfColumnsGte ??
                cfg.bleed_min_columns ??
                cfg.bleedMinColumns ??
                cfg.bleed_columns_gte ??
                cfg.bleedColumnsGte
        );

        const colCount =
            isNumber(columnCount) && Number.isFinite(columnCount)
                ? columnCount
                : null;

        let allowBleed = true;
        if (colCount !== null) {
            if (bleedIfColumnsGt !== null) {
                allowBleed = colCount > bleedIfColumnsGt;
            } else if (bleedIfColumnsGte !== null) {
                allowBleed = colCount >= bleedIfColumnsGte;
            }
        }

        const bleedIn = this._coerceFiniteNumber(cfg.bleed_in ?? cfg.bleedIn);
        const bleedLeftIn = this._coerceFiniteNumber(
            cfg.bleed_left_in ?? cfg.bleedLeftIn
        );
        const bleedRightIn = this._coerceFiniteNumber(
            cfg.bleed_right_in ?? cfg.bleedRightIn
        );

        const bleedPt = this._coerceFiniteNumber(cfg.bleed_pt ?? cfg.bleedPt);
        const bleedLeftPtExplicit = this._coerceFiniteNumber(
            cfg.bleed_left_pt ?? cfg.bleedLeftPt
        );
        const bleedRightPtExplicit = this._coerceFiniteNumber(
            cfg.bleed_right_pt ?? cfg.bleedRightPt
        );

        /** @type {number} */
        let bleedLeftPt =
            bleedLeftPtExplicit ??
            bleedPt ??
            (bleedLeftIn ?? bleedIn ?? 0) * ptPerIn;

        /** @type {number} */
        let bleedRightPt =
            bleedRightPtExplicit ??
            bleedPt ??
            (bleedRightIn ?? bleedIn ?? 0) * ptPerIn;

        if (!allowBleed) {
            bleedLeftPt = 0;
            bleedRightPt = 0;
        }

        const minInsetIn = this._coerceFiniteNumber(
            cfg.min_page_edge_inset_in ?? cfg.minPageEdgeInsetIn
        );
        const minInsetPtExplicit = this._coerceFiniteNumber(
            cfg.min_page_edge_inset_pt ?? cfg.minPageEdgeInsetPt
        );

        const minInsetPt = minInsetPtExplicit ?? (minInsetIn ?? 0.25) * ptPerIn;

        const desiredX0 = state.margins.left - bleedLeftPt;
        const desiredX1 =
            state.margins.left + state.contentWidth + bleedRightPt;

        const minX0 = Math.max(0, minInsetPt);
        const maxX1 = Math.max(minX0, state.pageWidth - minX0);

        let x0 = desiredX0;
        let x1 = desiredX1;

        if (x0 < minX0) {
            x0 = minX0;
        }
        if (x1 > maxX1) {
            x1 = maxX1;
        }
        if (x1 < x0) {
            x1 = x0;
        }

        return { x: x0, width: x1 - x0 };
    }

    /**
     * @private
     * @param {TableRenderConfig} tableCfg
     * @param {number} baseLineHeight
     * @returns {number}
     */
    _getTableLineHeight(tableCfg, baseLineHeight) {
        const explicit = tableCfg.lineHeight;
        if (isNumber(explicit) && Number.isFinite(explicit) && explicit > 0) {
            return explicit;
        }

        const scale = tableCfg.lineHeightScale ?? tableCfg.lineSpacingScale;

        if (isNumber(scale) && Number.isFinite(scale) && scale > 0) {
            return baseLineHeight * scale;
        }

        return baseLineHeight;
    }

    /**
     * @private
     * @param {unknown} value
     * @returns {"top"|"middle"|"bottom"|undefined}
     */
    _normalizeTableVAlign(value) {
        if (value === undefined || value === null) {
            return undefined;
        }

        const v = String(value).trim().toLowerCase();
        if (v === "top") return "top";
        if (v === "bottom") return "bottom";
        if (v === "middle" || v === "center") return "middle";
        return undefined;
    }

    /**
     * @private
     * @param {TableRenderConfig} tableCfg
     * @param {number} baseFontSize
     * @param {number} avgColWidth
     * @returns {number}
     */
    _getTableFontSize(tableCfg, baseFontSize, avgColWidth) {
        const explicit = tableCfg.fontSize;
        if (isNumber(explicit) && Number.isFinite(explicit)) {
            return explicit;
        }

        const scale = tableCfg.fontSizeScale ?? 1;
        let fs =
            isNumber(scale) && Number.isFinite(scale)
                ? baseFontSize * scale
                : baseFontSize;

        const autoShrink = (tableCfg.autoShrink ?? true) !== false;

        if (autoShrink) {
            if (avgColWidth < 80) fs *= 0.9;
            if (avgColWidth < 60) fs *= 0.85;
            if (avgColWidth < 45) fs *= 0.8;
        }

        const minFs = tableCfg.minFontSize ?? 7.5;
        const maxFs = tableCfg.maxFontSize ?? baseFontSize;

        if (isNumber(minFs) && Number.isFinite(minFs)) {
            fs = Math.max(minFs, fs);
        }
        if (isNumber(maxFs) && Number.isFinite(maxFs)) {
            fs = Math.min(maxFs, fs);
        }

        return fs;
    }

    /**
     * Normalize padding input into a box model.
     * @private
     * @param {number | BoxPadding | undefined} value
     * @param {number} fallback
     * @returns {Padding}
     */
    _normalizeBoxPadding(value, fallback) {
        if (!isNumber(fallback) || !Number.isFinite(fallback)) {
            fallback = 0;
        }

        if (isNumber(value) && Number.isFinite(value)) {
            return { top: value, right: value, bottom: value, left: value };
        }

        if (isObject(value)) {
            const v =
                /** @type {{x?:unknown,y?:unknown,top?:unknown,right?:unknown,bottom?:unknown,left?:unknown}} */ (
                    value
                );
            const x = isNumber(v.x) && Number.isFinite(v.x) ? v.x : undefined;
            const y = isNumber(v.y) && Number.isFinite(v.y) ? v.y : undefined;

            const top =
                isNumber(v.top) && Number.isFinite(v.top)
                    ? v.top
                    : y ?? fallback;
            const bottom =
                isNumber(v.bottom) && Number.isFinite(v.bottom)
                    ? v.bottom
                    : y ?? fallback;
            const left =
                isNumber(v.left) && Number.isFinite(v.left)
                    ? v.left
                    : x ?? fallback;
            const right =
                isNumber(v.right) && Number.isFinite(v.right)
                    ? v.right
                    : x ?? fallback;

            return { top, right, bottom, left };
        }

        return {
            top: fallback,
            right: fallback,
            bottom: fallback,
            left: fallback
        };
    }

    /**
     * @private
     * @param {TableRenderConfig} tableCfg
     * @param {TableNode} tableNode
     * @returns {boolean}
     */
    _isZebraEnabled(tableCfg, tableNode) {
        const explicit = tableCfg.zebra?.enabled;
        if (typeof explicit === "boolean") {
            return explicit;
        }

        return (
            (tableNode.stripedRows ??
                tableNode.attrs?.stripedRows ??
                tableNode.attrs?.striped_rows ??
                false) === true
        );
    }

    /**
     * @private
     * @param {RowNode} row
     * @param {boolean} isHeader
     * @param {boolean} zebraEnabled
     * @param {number} bodyRowIndex
     * @param {string|number|undefined} headerBackground
     * @param {string|number|undefined} zebraOdd
     * @param {string|number|undefined} zebraEven
     * @returns {string|number|undefined}
     */
    _resolveTableRowBackground(
        row,
        isHeader,
        zebraEnabled,
        bodyRowIndex,
        headerBackground,
        zebraOdd,
        zebraEven
    ) {
        const rowBg = row.attrs?.backgroundColor;
        if (!this._isColorNone(rowBg)) {
            return rowBg;
        }

        if (isHeader) {
            return this._isColorNone(headerBackground)
                ? undefined
                : headerBackground;
        }

        if (!zebraEnabled) {
            return undefined;
        }

        const isOdd = bodyRowIndex % 2 === 0;
        const chosen = isOdd ? zebraOdd : zebraEven;
        return this._isColorNone(chosen) ? undefined : chosen;
    }

    /**
     * @private
     * @param {unknown} value
     * @returns {boolean}
     */
    _isColorNone(value) {
        if (value === undefined || value === null) {
            return true;
        }
        const s = String(value).trim().toLowerCase();
        return s === "" || s === "none";
    }

    /**
     * @private
     * @param {PdfContentStreamBuilder} builder
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @param {number} height
     * @param {string|number} color
     */
    _drawFilledRectColor(builder, x, y, width, height, color) {
        builder.saveState();
        this._applyFillColor(builder, color);
        builder.rectangle(x, y, width, height).fill().restoreState();
    }

    /**
     * @private
     * @param {PdfContentStreamBuilder} builder
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @param {number} height
     * @param {number} lineWidth
     * @param {string|number} color
     */
    _drawStrokedRectColor(builder, x, y, width, height, lineWidth, color) {
        builder.saveState();
        builder.setLineWidth(lineWidth);
        this._applyStrokeColor(builder, color);
        builder.rectangle(x, y, width, height).stroke().restoreState();
    }

    /**
     * @private
     * @param {PdfContentStreamBuilder} builder
     * @param {string|number} color
     */
    _applyFillColor(builder, color) {
        if (isNumber(color) && Number.isFinite(color)) {
            builder.setFillGray(color);
            return;
        }

        const s = String(color).trim();
        const asNumber = Number.parseFloat(s);
        if (Number.isFinite(asNumber) && /^\d+(?:\.\d+)?$/.test(s)) {
            builder.setFillGray(asNumber);
            return;
        }

        const hex = s.startsWith("#") ? s : `#${s}`;
        const rgb = this.hexToRgb(hex);
        builder.setFillColor(rgb.r, rgb.g, rgb.b);
    }

    /**
     * @private
     * @param {PdfContentStreamBuilder} builder
     * @param {string|number} color
     */
    _applyStrokeColor(builder, color) {
        if (isNumber(color) && Number.isFinite(color)) {
            builder.setStrokeGray(color);
            return;
        }

        const s = String(color).trim();
        const asNumber = Number.parseFloat(s);
        if (Number.isFinite(asNumber) && /^\d+(?:\.\d+)?$/.test(s)) {
            builder.setStrokeGray(asNumber);
            return;
        }

        const hex = s.startsWith("#") ? s : `#${s}`;
        const rgb = this.hexToRgb(hex);
        builder.setStrokeColor(rgb.r, rgb.g, rgb.b);
    }

    // =========================================================================
    // Image Rendering
    // =========================================================================

    /**
     * Render an image (placeholder for now)
     * @param {BaseNode} node
     * @param {PdfBuildState} state
     * @returns {void}
     */
    renderImage(node, state) {
        const page = /** @type {PdfPage} */ (state.currentPage);
        const builder = page.contentBuilder;
        const fontSize = this.config.baseFontSize ?? 10;
        const alt = /** @type {string} */ (node.attrs?.alt) ?? "";
        const requestedWidth = numberOr(node.attrs?.width, 200);
        const requestedHeight = numberOr(node.attrs?.height, 150);
        const imagePath =
            stringOr(node.attrs?.src) ??
            stringOr(node.attrs?.path) ??
            stringOr(node.attrs?.imagePath) ??
            null;
        const fullPage =
            node.attrs?.fullPage === true ||
            node.attrs?.pageMode === "full-page";

        if (!imagePath || !existsSync(imagePath)) {
            const x =
                state.margins.left + (state.contentWidth - requestedWidth) / 2;
            const y = state.currentY - requestedHeight;

            this.drawStrokedRect(
                builder,
                x,
                y,
                requestedWidth,
                requestedHeight,
                1,
                0.5
            );
            this._recordInkBottomY(state, y);

            builder
                .saveState()
                .setLineWidth(0.5)
                .setStrokeGray(0.7)
                .moveTo(x, state.currentY)
                .lineTo(x + requestedWidth, y)
                .moveTo(x + requestedWidth, state.currentY)
                .lineTo(x, y)
                .stroke()
                .restoreState();

            if (alt) {
                const altFont = this.getFont(state, false, true);
                this.renderTextAt(
                    builder,
                    state,
                    `[Image: ${alt}]`,
                    state.margins.left + state.contentWidth / 2,
                    y - fontSize,
                    fontSize * 0.9,
                    altFont,
                    "center"
                );
            }

            state.currentY = y - (alt ? fontSize * 2 : fontSize);
            return;
        }

        const imageBytes = readFileSync(imagePath);
        const imageName = `IMG_${String(
            node.id ?? basename(imagePath, extname(imagePath))
        )}`
            .replace(/[^A-Za-z0-9_]+/g, "_")
            .replace(/_+/g, "_")
            .replace(/^_+|_+$/g, "");
        const xObjectName = state.doc.embedImageXObject(imageName, imageBytes);
        const embeddedImageInfo = state.doc.images.get(xObjectName);
        const intrinsicWidth =
            embeddedImageInfo?.parsed?.width ?? requestedWidth;
        const intrinsicHeight =
            embeddedImageInfo?.parsed?.height ?? requestedHeight;
        const intrinsicRatio =
            intrinsicWidth > 0 && intrinsicHeight > 0
                ? intrinsicWidth / intrinsicHeight
                : requestedWidth / requestedHeight;

        let boxX = state.margins.left;
        let boxY = state.currentY - requestedHeight;
        let boxWidth = requestedWidth;
        let boxHeight = requestedHeight;

        if (fullPage) {
            boxX = 0;
            boxY = 0;
            boxWidth = state.pageWidth;
            boxHeight = state.pageHeight;
        }

        let drawWidth = boxWidth;
        let drawHeight = drawWidth / intrinsicRatio;

        if (drawHeight > boxHeight) {
            drawHeight = boxHeight;
            drawWidth = drawHeight * intrinsicRatio;
        }

        const drawX = boxX + (boxWidth - drawWidth) / 2;
        const drawY = boxY + (boxHeight - drawHeight) / 2;

        builder.drawImage(xObjectName, drawX, drawY, drawWidth, drawHeight);
        this._recordInkBottomY(state, drawY);

        if (fullPage) {
            state.currentY = state.margins.bottom;
            return;
        }

        state.currentY = drawY - fontSize;
    }
    /**
     * Render a link node
     * @param {BaseNode} node
     * @param {PdfBuildState} state
     * @param {string} sectionId
     * @param {LayoutResult} layout
     * @returns {void}
     */
    renderLink(node, state, sectionId, layout) {
        const page = /** @type {PdfPage} */ (state.currentPage);
        const builder = page.contentBuilder;
        const fontSize = this.config.baseFontSize ?? 10;
        const lineHeight = this.config.lineHeight ?? 1.5;

        const href =
            /** @type {string} */ (
                node.attrs?.href ??
                    node.attrs?.url ??
                    /** @type {any} */ (node).href ??
                    /** @type {any} */ (node).url
            ) ?? "";
        let text = this.extractText(node);

        text = applyTypographySubstitutions(text);

        const bold = node.textStyle?.bold ?? false;
        const italic = node.textStyle?.italic ?? false;
        const baseFont = this.getFont(state, bold, italic);

        const linkColor = this.resolveLinkColor({ bold });

        this.renderTextAt(
            builder,
            state,
            text,
            state.margins.left,
            state.currentY,
            fontSize,
            baseFont,
            "left",
            linkColor
        );

        const textWidth = measureTextWidth(text, baseFont, fontSize);

        if (this.getLinkUnderline()) {
            // Underline
            const underlineY = state.currentY - fontSize * 0.15;
            const rgb = this.hexToRgb(linkColor);
            builder
                .saveState()
                .setLineWidth(0.5)
                .setStrokeColor(rgb.r, rgb.g, rgb.b)
                .moveTo(state.margins.left, underlineY)
                .lineTo(state.margins.left + textWidth, underlineY)
                .stroke()
                .restoreState();
        }

        // Add annotation
        const isExternal =
            href.startsWith("http://") || href.startsWith("https://");
        this.addLinkAnnotation(state, {
            type: isExternal ? "external" : "internal",
            x: state.margins.left,
            y: state.currentY - fontSize * 0.2,
            width: textWidth,
            height: fontSize * lineHeight,
            url: isExternal ? href : undefined,
            targetNodeId: isExternal ? undefined : href.replace("#", "")
        });

        state.currentY -= fontSize * lineHeight;
    }

    /**
     * Render inline format node
     * @param {BaseNode} node
     * @param {PdfBuildState} state
     * @param {string} sectionId
     * @param {LayoutResult} layout
     * @returns {void}
     */
    renderInlineFormat(node, state, sectionId, layout) {
        const page = /** @type {PdfPage} */ (state.currentPage);
        const builder = page.contentBuilder;
        const fontSize = this.config.baseFontSize ?? 10;
        const lineHeight = this.config.lineHeight ?? 1.5;

        const formatType = /** @type {string} */ (
            node.attrs?.formatType ??
                node.attrs?.format_type ??
                /** @type {any} */ (node).formatType ??
                /** @type {any} */ (node).format_type
        );
        const bold = formatType === "bold" || formatType === "strong";
        const italic =
            formatType === "italic" ||
            formatType === "em" ||
            formatType === "emphasis";
        const underline = formatType === "underline";
        const monospace = formatType === "code";

        let text = this.extractText(node);
        if (!monospace) {
            text = applyTypographySubstitutions(text);
        }
        const baseFont = this.getFont(state, bold, italic, monospace);

        if (underline) {
            this.renderUnderlinedText(
                builder,
                state,
                text,
                state.margins.left,
                state.currentY,
                fontSize,
                baseFont
            );
        } else {
            this.renderTextAt(
                builder,
                state,
                text,
                state.margins.left,
                state.currentY,
                fontSize,
                baseFont,
                "left"
            );
        }

        state.currentY -= fontSize * lineHeight;
    }

    /**
     * @param {BaseNode} node
     * @param {PdfBuildState} state
     * @param {string} sectionId
     * @returns {void}
     */
    renderHeading(node, state, sectionId) {
        let page = /** @type {PdfPage} */ (state.currentPage);
        if (!page) {
            page = this.newPage(state, sectionId);
        }
        let builder = page.contentBuilder;
        // HeadingNode stores level as direct property
        const level = /** @type {any} */ (node).level ?? node.attrs?.level ?? 1;

        const baseFontSize = this.config.baseFontSize ?? 10;
        const fontSize = baseFontSize * this.getHeadingScale(level);
        const lineHeight = this.config.lineHeight ?? 1.5;

        // Ensure enough space for headings (at least ~2 lines worth).
        // This prevents orphaned headings sitting alone at the bottom of a
        // page with no following content.  The same threshold applies in all
        // break modes — "part-only" only suppresses explicit pageBreakBefore
        // on non-Part headings; it does NOT relax the orphan guard.
        const headingOrphanThreshold = state.margins.bottom + fontSize * 3;

        if (state.currentY < headingOrphanThreshold) {
            page = this.newPage(state, sectionId);
            builder = page.contentBuilder;
        }

        // Extract text from heading
        let text = this.extractText(node);

        text = applyTypographySubstitutions(text);

        const headingSemanticRole = this.getHeadingSemanticRole(level);
        const baseFont = this.getSemanticStyledFont(
            state,
            headingSemanticRole,
            this.getFont(state, true),
            { bold: true }
        );
        const align = this.resolveNodeHorizontalAlign(
            node,
            level === 1 ? "center" : "left"
        );
        const maxWidth = state.contentWidth;

        // Optional aesthetic break for very long centered titles.
        text = this.applySmartTitleWrap(
            text,
            maxWidth,
            baseFont,
            fontSize,
            level,
            align
        );

        const lines = this.wrapText(text, maxWidth, baseFont, fontSize);
        const lineCount = Math.max(1, lines.length);

        const nodeId = node.id;
        const includeInToc = /** @type {any} */ (node).includeInToc !== false;

        if (nodeId && includeInToc) {
            this.recordRenderedDestination(state, nodeId, state.currentY);
            this.recordTocCandidate(state, sectionId, nodeId, level, text);
        }

        /** @type {Record<string, TextStyle> | null} */
        const headingStyles = /** @type {Record<string, TextStyle> | null} */ (
            this.config.headingStyles ?? null
        );

        /** @type {TextStyle | undefined} */
        const configuredHeadingStyle = this.getHeadingLevelAliasedValue(
            headingStyles,
            level
        );
        const configuredHeadingColor = isObject(configuredHeadingStyle)
            ? stringOr(configuredHeadingStyle.color, undefined)
            : undefined;

        const nodeHeadingColor = node.textStyle?.color ?? undefined;

        const headingColor = nodeHeadingColor ?? configuredHeadingColor;

        const nodeStyle =
            /** @type {any} */ (node).textStyle ??
            node.attrs?.textStyle ??
            node.attrs?.style;
        const spacingAfterPt =
            nodeStyle?.spacingAfterPt ??
            nodeStyle?.afterSpacingPt ??
            node.attrs?.spacingAfterPt ??
            node.attrs?.afterSpacingPt ??
            null;
        const spacingAfterEm =
            nodeStyle?.spacingAfter ??
            nodeStyle?.afterSpacing ??
            node.attrs?.spacingAfter ??
            node.attrs?.afterSpacing ??
            null;

        for (let i = 0; i < lineCount; i++) {
            // Page-break mid-heading if needed
            if (state.currentY < state.margins.bottom + fontSize * 2) {
                page = this.newPage(state, sectionId);
                builder = page.contentBuilder;
            }

            const line = lines[i] ?? "";
            const anchorX =
                align === "center"
                    ? state.margins.left + state.contentWidth / 2
                    : state.margins.left;

            this.renderTextAt(
                builder,
                state,
                line,
                anchorX,
                state.currentY,
                fontSize,
                baseFont,
                align,
                headingColor
            );

            state.currentY -= fontSize * lineHeight;
        }

        // Breathing room after headings
        if (isNumber(spacingAfterPt)) {
            state.currentY -= spacingAfterPt;
        } else if (isNumber(spacingAfterEm)) {
            state.currentY -= spacingAfterEm * baseFontSize;
        } else if (
            isString(spacingAfterEm) &&
            spacingAfterEm.trim().length > 0 &&
            Number.isFinite(Number(spacingAfterEm))
        ) {
            state.currentY -= Number(spacingAfterEm) * baseFontSize;
        } else {
            state.currentY -= fontSize * 0.25;
        }
    }

    /**
     * @param {BaseNode} node
     * @param {PdfBuildState} state
     * @param {string} sectionId
     * @param {LayoutResult} layout
     * @param {number} depth
     * @returns {void}
     */
    renderList(node, state, sectionId, layout, depth) {
        const labelInfo = this.getRunInLabelInfo(node);
        const shouldIndentForRunIn =
            !!labelInfo && labelInfo.suppressLabel === true;

        if (shouldIndentForRunIn) {
            const originalLeft = state.margins.left;
            const originalWidth = state.contentWidth;

            const fontSize = this.config.baseFontSize ?? 10;
            const baseFont = this.getFont(state, false);
            const labelText = `${labelInfo.label}${labelInfo.sep}`;
            const labelWidth = measureTextWidth(labelText, baseFont, fontSize);

            state.margins.left = originalLeft + labelWidth;
            state.contentWidth =
                state.pageWidth - state.margins.left - state.margins.right;

            for (let i = 0, len = node.children.length; i < len; i++) {
                this.renderNode(
                    node.children[i],
                    state,
                    sectionId,
                    layout,
                    depth + 1
                );
            }

            state.margins.left = originalLeft;
            state.contentWidth = originalWidth;
            return;
        }

        for (let i = 0, len = node.children.length; i < len; i++) {
            this.renderNode(
                node.children[i],
                state,
                sectionId,
                layout,
                depth + 1
            );
        }
    }

    /**
     * @param {BaseNode} node
     * @param {PdfBuildState} state
     * @param {string} sectionId
     * @param {LayoutResult} layout
     * @param {number} depth
     * @returns {void}
     */

    renderListItem(node, state, sectionId, layout, depth) {
        const page = /** @type {PdfPage} */ (state.currentPage);
        const builder = page.contentBuilder;
        const fontSize = this.config.baseFontSize ?? 10;
        const lineHeight = this.config.lineHeight ?? 1.5;

        const indent = depth * 20;
        const markerX = state.margins.left + indent;

        const baseFont = this.getFont(state, false);
        const labelInfo = this.getRunInLabelInfo(node);

        let textX = markerX + 15;
        let availableWidth = state.contentWidth - indent - 15;

        if (labelInfo) {
            const labelText = `${labelInfo.label}${labelInfo.sep}`;
            const labelWidth = measureTextWidth(labelText, baseFont, fontSize);

            // Marker label (first line only)
            this.renderTextAt(
                builder,
                state,
                labelText,
                markerX,
                state.currentY,
                fontSize,
                baseFont,
                "left"
            );

            textX = markerX + labelWidth;
            availableWidth = state.contentWidth - indent - labelWidth;
        } else {
            // Bullet (first line only)
            this.renderTextAt(
                builder,
                state,
                "•",
                markerX,
                state.currentY,
                fontSize,
                baseFont,
                "left"
            );
        }

        // Prefer first paragraph/definition child when present
        let inlineRoot = node;
        let inlineIndex = -1;
        for (let i = 0, len = node.children.length; i < len; i++) {
            if (
                node.children[i].type === "paragraph" ||
                node.children[i].type === "definition"
            ) {
                inlineRoot = node.children[i];
                inlineIndex = i;
                break;
            }
        }

        const runs = this.buildInlineRuns(inlineRoot);
        state.currentY = this.renderInlineRunsWrapped(
            runs,
            state,
            sectionId,
            textX,
            state.currentY,
            Math.max(1, availableWidth),
            fontSize,
            lineHeight
        );

        // Preserve spacing behavior for any remaining block children
        state.lastNodeType =
            inlineRoot === node ? "list-item" : inlineRoot.type;

        // Render any remaining children (nested lists, extra paragraphs, etc.)
        // under the bullet's text indent, not under the marker.
        if (inlineIndex >= 0 && inlineIndex < node.children.length - 1) {
            const originalLeft = state.margins.left;
            const originalWidth = state.contentWidth;

            state.margins.left = textX;
            state.contentWidth =
                state.pageWidth - state.margins.left - state.margins.right;

            for (
                let i = inlineIndex + 1, len = node.children.length;
                i < len;
                i++
            ) {
                this.renderNode(
                    node.children[i],
                    state,
                    sectionId,
                    layout,
                    depth + 1
                );
            }

            state.margins.left = originalLeft;
            state.contentWidth = originalWidth;
        }
    }

    /**
     * @param {BaseNode} node
     * @param {PdfBuildState} state
     * @param {string} sectionId
     * @param {LayoutResult} layout
     * @returns {void}
     */
    renderBlockquote(node, state, sectionId, layout) {
        const page = /** @type {PdfPage} */ (state.currentPage);
        const builder = page.contentBuilder;
        const fontSize = this.config.baseFontSize ?? 10;

        // Save original margins to temporarily indent content
        const originalLeftMargin = state.margins.left;
        const originalWidth = state.contentWidth;
        const indent = 20;
        const padding = 10;

        // Calculate expected height for the vertical bar
        let height = 0;
        // Temporarily adjust width to get accurate height estimates
        state.contentWidth -= indent + padding;
        for (let i = 0, len = node.children.length; i < len; i++) {
            height += this.estimateNodeHeight(node.children[i], state);
        }
        state.contentWidth += indent + padding;

        // Draw vertical bar on the left
        const barX = originalLeftMargin + 5;
        const topY = state.currentY;
        const bottomY = topY - height;

        builder
            .saveState()
            .setLineWidth(2)
            .setStrokeGray(0.7) // Light gray bar
            .moveTo(barX, topY)
            .lineTo(barX, bottomY)
            .stroke()
            .restoreState();

        // Adjust state for children rendering
        state.margins.left += indent + padding;
        state.contentWidth -= indent + padding;

        // Render children
        for (let i = 0, len = node.children.length; i < len; i++) {
            this.renderNode(node.children[i], state, sectionId, layout, 0);
        }

        // Restore state
        state.margins.left = originalLeftMargin;
        state.contentWidth = originalWidth;
    }

    /**
     * @param {BaseNode} node
     * @param {PdfBuildState} state
     * @param {string} sectionId
     * @returns {void}
     */
    renderCodeBlock(node, state, sectionId) {
        // CodeBlockNode stores code as direct property
        const code = /** @type {any} */ (node).code ?? node.attrs?.code ?? "";
        const baseFontSize = this.config.baseFontSize ?? 10;
        const fontSize = baseFontSize * 0.9;
        const codeLineHeight = 1.2;
        const padding = 8;

        const lines = code.split("\n");
        const lineHeightPx = fontSize * codeLineHeight;
        const totalBlockHeight = lines.length * lineHeightPx + padding * 2;

        // Available space on current page
        const availableHeight = state.currentY - state.margins.bottom;

        // If entire block fits, render it all at once
        if (totalBlockHeight <= availableHeight) {
            let page = /** @type {PdfPage} */ (state.currentPage);
            let builder = page.contentBuilder;

            // Draw background
            this.drawFilledRect(
                builder,
                state.margins.left,
                state.currentY - totalBlockHeight + padding,
                state.contentWidth,
                totalBlockHeight,
                0.95
            );

            // Render lines
            let y = state.currentY - padding;
            for (let i = 0, len = lines.length; i < len; i++) {
                this.renderTextAt(
                    builder,
                    state,
                    lines[i],
                    state.margins.left + padding,
                    y,
                    fontSize,
                    state.fonts.monospace,
                    "left"
                );
                y -= lineHeightPx;
            }

            state.currentY -= totalBlockHeight + 10;
            this._recordInkBottomY(state, state.currentY + 10);
            return;
        }

        // Block doesn't fit - render line by line with page breaks
        let lineIndex = 0;
        while (lineIndex < lines.length) {
            let page = /** @type {PdfPage} */ (state.currentPage);
            let builder = page.contentBuilder;

            // Calculate how many lines fit on current page
            const availSpace =
                state.currentY - state.margins.bottom - padding * 2;
            const linesPerPage = Math.max(
                1,
                Math.floor(availSpace / lineHeightPx)
            );
            const linesToRender = Math.min(
                linesPerPage,
                lines.length - lineIndex
            );

            // If we can't fit even one line, start new page
            if (availSpace < lineHeightPx) {
                page = this.newPage(state, sectionId);
                builder = page.contentBuilder;
                continue;
            }

            const chunkHeight = linesToRender * lineHeightPx + padding * 2;

            // Draw background for this chunk
            this.drawFilledRect(
                builder,
                state.margins.left,
                state.currentY - chunkHeight,
                state.contentWidth,
                chunkHeight,
                0.95
            );

            // Render lines for this chunk
            let y = state.currentY - padding;
            for (let i = 0; i < linesToRender; i++) {
                this.renderTextAt(
                    builder,
                    state,
                    lines[lineIndex + i],
                    state.margins.left + padding,
                    y,
                    fontSize,
                    state.fonts.monospace,
                    "left"
                );
                y -= lineHeightPx;
            }

            state.currentY -= chunkHeight;
            lineIndex += linesToRender;

            // If more lines remain, start new page
            if (lineIndex < lines.length) {
                page = this.newPage(state, sectionId);
                builder = page.contentBuilder;
            }
        }

        this._recordInkBottomY(state, state.currentY);
        state.currentY -= 10; // Gap after code block
    }

    /**
     * @param {PdfBuildState} state
     * @returns {void}
     */
    renderHorizontalRule(node, state, sectionId) {
        // Check if horizontal rules should be page breaks
        const override =
            node.attrs?.hrBehaviorOverride ?? node.attrs?.hr_behavior_override;

        const sectionCfg = state.sectionConfigs.get(sectionId);
        const sectionHrBehavior = stringOr(
            sectionCfg?.horizontalRuleBehavior,
            null
        );

        const hrBehavior =
            (isString(override) && override.length > 0 ? override : null) ??
            (isString(sectionHrBehavior) && sectionHrBehavior.length > 0
                ? sectionHrBehavior
                : null) ??
            this.config.horizontalRule?.behavior ??
            "rule";

        if (hrBehavior === "page-break") {
            // Treat --- as page break
            this.newPage(state, sectionId);
            return;
        }

        if (hrBehavior === "ignore") {
            return;
        }

        // Default: render as horizontal line
        const page = /** @type {PdfPage} */ (state.currentPage);
        const builder = page.contentBuilder;

        // Compact vertical extent — the rule is visually centered inside this
        // block so the gap above and below the ink line is identical.
        const hrCfg = /** @type {any} */ (
            this.config.horizontalRule ??
                ("horizontal_rule" in this.config
                    ? this.config.horizontal_rule
                    : null) ??
                null
        );
        const hrHeight = isNumber(hrCfg?.blockHeightPt)
            ? hrCfg.blockHeightPt
            : isNumber(hrCfg?.block_height_pt)
            ? hrCfg.block_height_pt
            : 14;

        const inkY = this._getLastInkBottomY(state);
        const endY = state.currentY - hrHeight;

        // Center the rule visually inside the HR block.
        const lineY =
            inkY != null && inkY > endY
                ? (inkY + endY) / 2
                : state.currentY - hrHeight / 2;

        const lineWidth = state.contentWidth * 0.5;
        const startX =
            state.margins.left + (state.contentWidth - lineWidth) / 2;

        this.drawLine(builder, startX, lineY, startX + lineWidth, 0.4, 0.85);

        state.currentY = endY;
        // Record the block edge (not the ink line) so the spacing system
        // treats the full HR block as consumed — keeps above/below symmetric.
        this._recordInkBottomY(state, endY);
    }

    /**
     * @param {BaseNode} node
     * @param {PdfBuildState} state
     * @param {string} sectionId
     * @param {LayoutResult} layout
     * @param {number} depth
     * @returns {void}
     */
    renderLegalNode(node, state, sectionId, layout, depth) {
        const page = /** @type {PdfPage} */ (state.currentPage);
        const builder = page.contentBuilder;
        const baseFontSize = this.config.baseFontSize ?? 10;
        const lineHeight = this.config.lineHeight ?? 1.5;
        const type = node.type;

        // Render heading for article/section
        if (type === "article" || type === "section") {
            // ArticleNode and SectionNode store number/title as direct properties
            const number =
                /** @type {any} */ (node).number ?? node.attrs?.number;
            const title = /** @type {any} */ (node).title ?? node.attrs?.title;
            const headingLevel = type === "article" ? 1 : 2;
            const headingSize =
                baseFontSize * this.getHeadingScale(headingLevel);
            const headingFont = this.getSemanticStyledFont(
                state,
                type === "article" ? "heading_1" : "heading_2",
                this.getFont(state, true),
                { bold: true }
            );

            let headingText = "";
            if (type === "article" && number) {
                headingText = `ARTICLE ${number}`;
                if (title) {
                    headingText += `: ${title}`;
                }
            } else if (type === "section" && number) {
                headingText = `Section ${number}`;
                if (title) {
                    headingText += `. ${title}`;
                }
            }

            if (headingText) {
                state.currentY -= headingSize * 0.5;

                const nodeId = node.id;
                if (nodeId) {
                    const tocLevel = type === "article" ? 1 : 2;
                    this.recordRenderedDestination(
                        state,
                        nodeId,
                        state.currentY
                    );
                    this.recordTocCandidate(
                        state,
                        sectionId,
                        nodeId,
                        tocLevel,
                        headingText
                    );
                }

                const align = type === "article" ? "center" : "left";
                const x =
                    type === "article"
                        ? state.margins.left + state.contentWidth / 2
                        : state.margins.left;

                this.renderTextAt(
                    builder,
                    state,
                    headingText,
                    x,
                    state.currentY,
                    headingSize,
                    headingFont,
                    align
                );
                state.currentY -= headingSize * 1.5;
            }
        }

        // Render children
        for (let i = 0, len = node.children.length; i < len; i++) {
            const currentChild = node.children[i];
            const nextChild = i + 1 < len ? node.children[i + 1] : null;
            this.preflightHeadingFollowerBreak(
                currentChild,
                nextChild,
                state,
                sectionId,
                depth + 1
            );
            this.renderNode(currentChild, state, sectionId, layout, depth + 1);
        }
    }

    /**
     * @param {BaseNode} node
     * @param {PdfBuildState} state
     * @returns {void}
     */

    /**
     * Render a definition block with a hanging/continuation indent.
     * This keeps any content following nested lists within the definition
     * aligned with the definition body (not the left page margin).
     *
     * @param {DefinitionNode} node
     * @param {PdfBuildState} state
     * @param {string} sectionId
     * @param {LayoutResult} layout
     * @returns {void}
     */
    renderDefinition(node, state, sectionId, layout) {
        const page = state.currentPage;
        const builder = page.contentBuilder;

        const fontSize = this.config.baseFontSize ?? 10;
        const lineHeight = this.config.lineHeight ?? 1.25;

        const baseLeft = state.margins.left;
        const baseWidth = state.contentWidth;

        const regularFont = this.getSemanticStyledFont(
            state,
            "body",
            this.getFont(state, false)
        );
        const boldFont = this.getSemanticStyledFont(
            state,
            "definition_term",
            this.getFont(state, true),
            { bold: true }
        );

        const rawTerm = (node.term ?? "").trim();
        const termText = rawTerm ? `"${rawTerm}"` : "";
        const hasTerm = termText.length > 0;

        const defText = this.extractText(node).trim();
        const defStartsWithMeans = defText.toLowerCase().startsWith("means");

        // If the body already begins with "means", we only need a space.
        const prefixText =
            hasTerm && defText.length > 0
                ? defStartsWithMeans
                    ? " "
                    : " means "
                : "";

        const termWidth = hasTerm
            ? measureTextWidth(termText, boldFont, fontSize)
            : 0;
        const prefixWidth = hasTerm
            ? measureTextWidth(prefixText, regularFont, fontSize)
            : 0;

        const labelWidth = termWidth + prefixWidth;
        const maxLabelDelta = Math.min(baseWidth * 0.45, 220);
        const labelTooWide = hasTerm && labelWidth > maxLabelDelta;

        // Render the term (and optionally the prefix) on the current line.
        if (hasTerm) {
            this.renderTextAt(
                builder,
                state,
                termText,
                baseLeft,
                state.currentY,
                fontSize,
                boldFont,
                "left"
            );

            if (!labelTooWide && prefixText) {
                this.renderTextAt(
                    builder,
                    state,
                    prefixText,
                    baseLeft + termWidth,
                    state.currentY,
                    fontSize,
                    regularFont,
                    "left"
                );
            }
        }

        // Decide where the body starts.
        let bodyIndentDelta = 0;
        if (hasTerm) {
            bodyIndentDelta = labelTooWide ? 20 : labelWidth;
        }

        // Identify the first meaningful child to decide if we should drop to a new line.
        let firstChild = null;
        const children = Array.isArray(node.children) ? node.children : [];
        for (let i = 0, len = children.length; i < len; i++) {
            const child = children[i];
            if (!child) {
                continue;
            }
            const txt = this.extractPlainText(child).trim();
            if (txt.length === 0 && child.type === "paragraph") {
                continue;
            }
            firstChild = child;
            break;
        }

        const forceNewLineTypes = new Set([
            "list",
            "table",
            "notice",
            "blockquote",
            "code-block",
            "horizontal-rule",
            "heading"
        ]);

        const forceNewLine =
            labelTooWide ||
            (firstChild != null && forceNewLineTypes.has(firstChild.type));

        const originalLeft = state.margins.left;
        const originalWidth = state.contentWidth;

        // Ensure nested content uses spacing relative to "definition" rather than the previous outer block.
        const priorLastNodeType = state.lastNodeType;
        state.lastNodeType = "definition";

        // If the label is too wide or the body begins with a block (e.g., list), move to next line.
        if (forceNewLine && hasTerm) {
            state.currentY -= fontSize * lineHeight;
        }

        // Apply the definition body indentation.
        state.margins.left = baseLeft + bodyIndentDelta;
        state.contentWidth = Math.max(1, baseWidth - bodyIndentDelta);

        // For very wide labels, optionally inject "means" on the new line when missing.
        if (
            labelTooWide &&
            hasTerm &&
            defText.length > 0 &&
            !defStartsWithMeans
        ) {
            const meansText = "means ";
            this.renderTextAt(
                builder,
                state,
                meansText,
                state.margins.left,
                state.currentY,
                fontSize,
                regularFont,
                "left"
            );

            const meansWidth = measureTextWidth(
                meansText,
                regularFont,
                fontSize
            );

            // If the body starts with a block (e.g., list), keep the block aligned at the base indent.
            if (firstChild != null && forceNewLineTypes.has(firstChild.type)) {
                state.currentY -= fontSize * lineHeight;
            } else {
                state.margins.left += meansWidth;
                state.contentWidth = Math.max(
                    1,
                    state.contentWidth - meansWidth
                );
            }
        }

        // Inline-only bodies can be rendered as wrapped runs (keeps wrapping correct).
        let inlineOnly = true;
        for (let i = 0, len = children.length; i < len; i++) {
            const child = children[i];
            if (!child) {
                continue;
            }
            if (
                child.type !== "text" &&
                child.type !== "inline-format" &&
                child.type !== "link" &&
                child.type !== "break"
            ) {
                inlineOnly = false;
                break;
            }
        }

        if (inlineOnly) {
            const syntheticParagraph = {
                type: "paragraph",
                attrs: {},
                children
            };

            const runs = this.buildInlineRuns(
                /** @type {BaseNode} */ (syntheticParagraph)
            );

            state.currentY = this.renderInlineRunsWrapped(
                runs,
                state,
                sectionId,
                state.margins.left,
                state.currentY,
                state.contentWidth,
                fontSize,
                lineHeight
            );
        } else {
            for (let i = 0, len = children.length; i < len; i++) {
                const child = children[i];
                if (!child) {
                    continue;
                }
                this.renderNode(child, state, sectionId, layout, 0);
            }
        }

        // Restore state
        state.margins.left = originalLeft;
        state.contentWidth = originalWidth;
        state.lastNodeType = priorLastNodeType;

        // Add a small gap after the definition block.
        state.currentY -= fontSize * 0.5;
    }

    /**
     * @param {BaseNode} node
     * @param {PdfBuildState} state
     * @param {string} sectionId
     * @param {LayoutResult} layout
     * @returns {void}
     */
    renderNotice(node, state, sectionId, layout) {
        const directiveName =
            isObject(node.attrs) && isString(node.attrs.directive)
                ? node.attrs.directive.trim().toLowerCase()
                : "notice";
        const variant =
            isObject(node.attrs) && isString(node.attrs.variant)
                ? node.attrs.variant.trim().toLowerCase()
                : directiveName;
        const noticeStyle = this._resolveDirectiveStyle(
            directiveName,
            variant,
            this.config.noticeStyle ?? null
        );

        const nodeBoxStyle = node.boxStyle ?? null;

        const paddingSpec =
            nodeBoxStyle?.padding ??
            (isObject(noticeStyle) ? noticeStyle.padding ?? 10 : 10);
        const pad = this._normalizeBoxPadding(paddingSpec, 10);

        const borderSpec =
            nodeBoxStyle?.borderTop ??
            nodeBoxStyle?.borderRight ??
            nodeBoxStyle?.borderBottom ??
            nodeBoxStyle?.borderLeft ??
            null;

        const borderWidth =
            (borderSpec?.width ??
                (isObject(noticeStyle)
                    ? numberOr(noticeStyle.borderWidth, 1)
                    : 1)) ||
            1;

        const borderColor =
            borderSpec?.color ??
            (isObject(noticeStyle) ? noticeStyle.borderColor ?? 0 : 0);

        const backgroundColor =
            nodeBoxStyle?.backgroundColor ??
            (isObject(noticeStyle)
                ? stringOr(noticeStyle.backgroundColor, undefined)
                : undefined);

        const titleColor = isObject(noticeStyle)
            ? stringOr(noticeStyle.titleColor, undefined)
            : undefined;

        const fontSize = this.config.baseFontSize ?? 10;
        const lineHeight = this.config.lineHeight ?? 1.5;

        const title = /** @type {any} */ (node).title ?? node.attrs?.title;

        // Avoid surprising page breaks: prefer the regular keepTogether logic.
        // If the notice doesn't fit as a whole, start it on a new page based on its *actual* estimated height.
        // Skip when already at the top of a page — renderNode's keepTogether may have
        // already broken here; re-breaking would produce a blank page.
        const atTopOfPage =
            state.currentY >= state.pageHeight - state.margins.top - 10;
        const contentHeight =
            state.pageHeight - state.margins.top - state.margins.bottom;
        const remaining = state.currentY - state.margins.bottom;
        const estimated = this.estimateNodeHeight(node, state, 0);
        if (
            !atTopOfPage &&
            estimated <= contentHeight &&
            remaining < estimated
        ) {
            this.newPage(state, sectionId);
        }

        const startPage = /** @type {PdfPage} */ (state.currentPage);
        const builder = startPage.contentBuilder;

        // Save starting Y position (top of box will be here)
        const boxTopY = state.currentY;
        const predictedBoxHeight = Math.max(0, estimated - fontSize * 0.5);
        const predictedBoxBottomY = Math.max(
            boxTopY - predictedBoxHeight,
            state.margins.bottom + 2
        );
        const savedLeft = state.margins.left;
        const savedWidth = state.contentWidth;

        if (backgroundColor !== undefined && backgroundColor !== "none") {
            this.drawFilledRect(
                builder,
                savedLeft,
                predictedBoxBottomY,
                savedWidth,
                predictedBoxHeight,
                backgroundColor
            );
        }

        // Move down for top padding PLUS text height (baseline offset)
        // Text renders from baseline upward, so we need extra space
        state.currentY -= pad.top + fontSize * 0.8;

        // Render title if present
        if (title) {
            const titleFont = this.getSemanticStyledFont(
                state,
                "notice_title",
                this.getFont(state, true),
                { bold: true }
            );
            this.renderTextAt(
                builder,
                state,
                String(title).toUpperCase(),
                state.margins.left + pad.left,
                state.currentY,
                fontSize,
                titleFont,
                "left",
                titleColor
            );
            state.currentY -= fontSize * lineHeight;
        }

        // Render children with padding

        state.margins.left += pad.left;
        state.contentWidth -= pad.left + pad.right;

        // Clear lastNodeType so children don't add extra top spacing
        const savedLastNodeType = state.lastNodeType;
        state.lastNodeType = "notice"; // Treat as if following notice header

        for (let i = 0, len = node.children.length; i < len; i++) {
            this.renderNode(node.children[i], state, sectionId, layout, 0);
        }

        // Restore margins
        state.margins.left = savedLeft;
        state.contentWidth = savedWidth;
        state.lastNodeType = savedLastNodeType;

        // Add bottom padding
        state.currentY -= pad.bottom;

        // If the notice split across pages, don't attempt to draw a single box.
        const endPage = /** @type {PdfPage} */ (state.currentPage);
        if (endPage !== startPage) {
            state.currentY -= fontSize * 0.5;
            return;
        }

        // Ensure box bottom doesn't extend into margin
        const boxBottomY = Math.max(
            state.currentY + pad.bottom,
            state.margins.bottom + pad.bottom
        );
        const actualBoxHeight = boxTopY - boxBottomY;

        // Only draw box if it has positive height AND we didn't cross into a new page.
        // If the notice content triggered a page break, the box rect would be wrong.
        if (actualBoxHeight > 0 && state.currentPage === startPage) {
            this.drawStrokedRect(
                builder,
                savedLeft,
                boxBottomY,
                savedWidth,
                actualBoxHeight,
                borderWidth,
                borderColor
            );
        }

        // Add gap after box
        this._recordInkBottomY(state, boxBottomY);
        state.currentY -= fontSize * 0.5;
    }

    /**
     * @param {BaseNode} node
     * @param {PdfBuildState} state
     * @returns {void}
     */
    renderSignatureBlock(node, state) {
        const spec = this._getSignatureBlockSpec(node);
        const style = this._resolveDirectiveStyle(
            spec.directiveName,
            spec.variant,
            this.config.signatureBlockStyle ?? null
        );
        const page = /** @type {PdfPage} */ (state.currentPage);
        const builder = page.contentBuilder;
        const fontSize = this.config.baseFontSize ?? 10;
        const lineHeight = this.config.lineHeight ?? 1.5;
        const regularFont = this.getSemanticStyledFont(
            state,
            "signature_value",
            this.getFont(state, false)
        );
        const boldFont = this.getSemanticStyledFont(
            state,
            "signature_title",
            this.getFont(state, true),
            { bold: true }
        );
        const paddingSpec = style.padding ?? 12;
        const pad = this._normalizeBoxPadding(paddingSpec, 12);
        const borderWidth = numberOr(style.borderWidth, 1) || 1;
        const borderColor = style.borderColor ?? 0;
        const backgroundColor = style.backgroundColor;
        const headerBackgroundColor =
            style.headerBackgroundColor ?? style.titleBackgroundColor;
        const titleColor = style.titleColor;
        const titleFontSize =
            fontSize * (numberOr(style.titleFontScale, 1.02) || 1.02);
        const rowHeight = numberOr(
            style.rowHeight,
            fontSize * lineHeight * 0.95
        );
        const signatureRowHeight = numberOr(
            style.signatureRowHeight,
            fontSize * lineHeight * 1.5
        );
        const rowGap = numberOr(style.rowGap, fontSize * 0.4);
        const bodyGap = numberOr(style.bodyGap, fontSize * 0.45);
        const headerGap = numberOr(style.headerGap, fontSize * 0.5);
        const postGap = numberOr(style.postGap, fontSize * 0.6);
        const labelWidth = numberOr(style.fieldLabelWidth, 78);
        const innerWidth = Math.max(
            120,
            state.contentWidth - pad.left - pad.right
        );
        const contentLeft = state.margins.left + pad.left;
        const valueLeft = contentLeft + labelWidth;
        const lineInsetLeft = 4;
        const lineInsetRight = 6;
        const requiredHeight = this._estimateSignatureBlockHeight(node, state);
        const remaining = state.currentY - state.margins.bottom;
        const pageContentHeight =
            state.pageHeight - state.margins.top - state.margins.bottom;
        const atTopOfPage =
            state.currentY >= state.pageHeight - state.margins.top - 10;

        if (
            !atTopOfPage &&
            requiredHeight <= pageContentHeight &&
            remaining < requiredHeight
        ) {
            this.newPage(state, page.sectionId);
        }

        const startPage = /** @type {PdfPage} */ (state.currentPage);
        const startBuilder = startPage.contentBuilder;
        const boxTopY = state.currentY;
        const predictedBoxHeight = Math.max(0, requiredHeight - postGap);
        const predictedBoxBottomY = Math.max(
            boxTopY - predictedBoxHeight,
            state.margins.bottom + 2
        );

        if (backgroundColor !== undefined && backgroundColor !== "none") {
            this.drawFilledRect(
                startBuilder,
                state.margins.left,
                predictedBoxBottomY,
                state.contentWidth,
                predictedBoxHeight,
                backgroundColor
            );
        }

        state.currentY -= pad.top + fontSize * 0.2;

        if (spec.partyLabel) {
            const bandTopY = state.currentY + titleFontSize * 0.35;
            const bandHeight = titleFontSize + fontSize * 0.65;
            const bandBottomY = bandTopY - bandHeight;
            if (
                headerBackgroundColor !== undefined &&
                headerBackgroundColor !== "none"
            ) {
                this.drawFilledRect(
                    startBuilder,
                    state.margins.left,
                    bandBottomY,
                    state.contentWidth,
                    bandHeight,
                    headerBackgroundColor
                );
            }
            this.renderTextAt(
                startBuilder,
                state,
                spec.partyLabel,
                contentLeft,
                state.currentY,
                titleFontSize,
                boldFont,
                "left",
                titleColor
            );
            state.currentY -= titleFontSize + headerGap;
        }

        if (spec.bodyText) {
            const wrappedBody = layoutPlainText(
                spec.bodyText,
                innerWidth,
                regularFont,
                fontSize,
                fontSize * lineHeight
            );
            for (let i = 0, len = wrappedBody.lines.length; i < len; i++) {
                this.renderTextAt(
                    startBuilder,
                    state,
                    wrappedBody.lines[i],
                    contentLeft,
                    state.currentY,
                    fontSize,
                    regularFont,
                    "left"
                );
                state.currentY -= fontSize * lineHeight;
            }
            state.currentY -= bodyGap;
        }

        for (let i = 0, len = spec.fields.length; i < len; i++) {
            const fieldLabel = spec.fields[i];
            const isSignatureLine = this._isSignatureLineField(fieldLabel);
            const thisRowHeight = isSignatureLine
                ? signatureRowHeight
                : rowHeight;
            const rowTopY = state.currentY;
            const rowBottomY = rowTopY - thisRowHeight;
            const lineY = rowBottomY + fontSize * 0.28;
            const printedValue = spec.values[fieldLabel];
            const printedText =
                isString(printedValue) && printedValue.trim().length > 0
                    ? printedValue.trim()
                    : null;
            const labelBaselineY = rowBottomY + fontSize * 0.2;
            const fieldRectX = valueLeft + lineInsetLeft;
            const fieldRectWidth = Math.max(
                48,
                state.margins.left +
                    state.contentWidth -
                    pad.right -
                    lineInsetRight -
                    fieldRectX
            );
            const canonicalFieldName =
                this._canonicalSignatureFieldKey(fieldLabel);
            const isDateTextField =
                !isSignatureLine &&
                (canonicalFieldName === "date" ||
                    canonicalFieldName === "executiondate");
            const fieldRectHeight = isSignatureLine
                ? Math.max(thisRowHeight - fontSize * 0.35, fontSize * 1.2)
                : Math.max(
                      fontSize * 1.35,
                      Math.min(thisRowHeight * 0.78, fontSize * 1.8)
                  );
            const fieldRectY = isSignatureLine
                ? Math.max(
                      rowBottomY + Math.max(0, fontSize * 0.05),
                      rowTopY - fieldRectHeight
                  )
                : Math.max(
                      rowBottomY + Math.max(0, fontSize * 0.02),
                      labelBaselineY - fontSize * 0.35
                  );
            const fieldNameKey =
                fieldLabel
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "_")
                    .replace(/^_+|_+$/g, "") || `field_${i + 1}`;
            const formFieldName = `signature_block.${
                state.formFieldCounter + 1
            }.${fieldNameKey}`;

            this.renderTextAt(
                startBuilder,
                state,
                `${fieldLabel}:`,
                contentLeft,
                labelBaselineY,
                fontSize,
                this.getSemanticStyledFont(
                    state,
                    "signature_label",
                    regularFont
                ),
                "left"
            );

            if (!printedText) {
                this.drawLine(
                    startBuilder,
                    valueLeft + lineInsetLeft,
                    lineY,
                    state.margins.left +
                        state.contentWidth -
                        pad.right -
                        lineInsetRight,
                    0.5,
                    0
                );
            } else if (isSignatureLine) {
                this.renderTextAt(
                    startBuilder,
                    state,
                    printedText,
                    valueLeft + lineInsetLeft + 2,
                    labelBaselineY,
                    fontSize,
                    regularFont,
                    "left"
                );
            }

            state.formFieldCounter = state.formFieldCounter + 1;
            this.addFormFieldAnnotation(state, {
                type: "form",
                fieldType: isSignatureLine ? "signature" : "text",
                name: formFieldName,
                tooltip: spec.partyLabel
                    ? isDateTextField
                        ? `${spec.partyLabel} ${fieldLabel} (YYYY-MM-DD)`
                        : `${spec.partyLabel} ${fieldLabel}`
                    : isDateTextField
                    ? `${fieldLabel} (YYYY-MM-DD)`
                    : fieldLabel,
                x: fieldRectX,
                y: fieldRectY,
                width: fieldRectWidth,
                height: fieldRectHeight,
                value: isSignatureLine ? undefined : printedText ?? undefined,
                readOnly: printedText !== null,
                fontSize,
                maxLength: isDateTextField ? 10 : undefined
            });

            state.currentY = rowBottomY;
            if (i < len - 1) {
                state.currentY -= rowGap;
            }
        }

        state.currentY -= pad.bottom;

        const endPage = /** @type {PdfPage} */ (state.currentPage);
        if (endPage === startPage) {
            const boxBottomY = Math.max(
                state.currentY,
                state.margins.bottom + 2
            );
            const boxHeight = boxTopY - boxBottomY;
            if (boxHeight > 0) {
                this.drawStrokedRect(
                    startBuilder,
                    state.margins.left,
                    boxBottomY,
                    state.contentWidth,
                    boxHeight,
                    borderWidth,
                    borderColor
                );
                this._recordInkBottomY(state, boxBottomY);
            }
        }

        state.currentY -= postGap;
    }

    // =========================================================================
    // Signing / Execution Page (excluded from pagination)
    // =========================================================================

    /**
     * Render a final signing/execution page that is NOT counted in pagination
     * and does NOT receive headers or footers. Used for agreement execution blocks.
     *
     * @param {SigningPageConfig} signingConfig
     * @param {PdfBuildState} state
     * @returns {void}
     */
    renderSigningPage(signingConfig, state) {
        const page = this.newPage(state, "signing");
        const builder = page.contentBuilder;
        const fontSize = this.config.baseFontSize ?? 10;
        const lineHeight = this.config.lineHeight ?? 1.5;
        const boldFont = this.getFont(state, true);
        const regularFont = this.getFont(state, false);
        const italicFont = this.getFont(state, false, true);
        const lineStep = fontSize * lineHeight;

        const layoutOverrides = isObject(signingConfig.layout)
            ? signingConfig.layout
            : {};

        const labelColumnWidth = isNumber(layoutOverrides.labelColumnWidth)
            ? layoutOverrides.labelColumnWidth
            : 86;
        const valueX = state.margins.left + labelColumnWidth;
        const signatureLineWidth = Math.min(
            isNumber(layoutOverrides.signatureLineWidth)
                ? layoutOverrides.signatureLineWidth
                : 330,
            Math.max(140, state.contentWidth - labelColumnWidth - 4)
        );

        const signatureRowHeight = isNumber(layoutOverrides.signatureRowHeight)
            ? layoutOverrides.signatureRowHeight
            : lineStep * 1.85;
        const rowHeight = isNumber(layoutOverrides.rowHeight)
            ? layoutOverrides.rowHeight
            : lineStep * 1.15;
        const partyLabelGap = isNumber(layoutOverrides.partyLabelGap)
            ? layoutOverrides.partyLabelGap
            : lineStep * 2.35;
        const rowGap = isNumber(layoutOverrides.rowGap)
            ? layoutOverrides.rowGap
            : lineStep * 0.45;
        const blockGap = isNumber(layoutOverrides.blockGap)
            ? layoutOverrides.blockGap
            : lineStep * 1.15;
        const partyGap = isNumber(layoutOverrides.partyGap)
            ? layoutOverrides.partyGap
            : lineStep * 1.15;

        this._trace(`=== renderSigningPage ===`);
        this._trace(
            `  baseFontSize=${fontSize} lineHeight=${lineHeight} lineStep=${lineStep.toFixed(
                2
            )}`
        );
        this._trace(
            `  layout overrides present: ${
                Object.keys(layoutOverrides).length > 0
            }`
        );
        if (Object.keys(layoutOverrides).length > 0) {
            this._trace(
                `  layout keys: ${Object.keys(layoutOverrides).join(", ")}`
            );
        }
        this._trace(`  resolved labelColumnWidth=${labelColumnWidth}`);
        this._trace(`  resolved signatureLineWidth=${signatureLineWidth}`);
        this._trace(
            `  resolved signatureRowHeight=${signatureRowHeight.toFixed(2)}`
        );
        this._trace(
            `  resolved rowHeight=${
                isNumber(rowHeight) ? rowHeight.toFixed(2) : rowHeight
            }`
        );
        this._trace(`  resolved partyLabelGap=${partyLabelGap.toFixed(2)}`);
        this._trace(
            `  resolved rowGap=${rowGap.toFixed(2)} blockGap=${blockGap.toFixed(
                2
            )} partyGap=${partyGap.toFixed(2)}`
        );
        this._trace(
            `  witnessClause length=${
                (signingConfig.witnessClause ?? "(default)").length
            }`
        );
        this._trace(
            `  executionNote present=${
                isString(signingConfig.executionNote) ||
                ("execution_note" in signingConfig &&
                    isString(signingConfig.execution_note))
            }`
        );
        this._trace(
            `  acknowledgmentTitle present=${
                isString(signingConfig.acknowledgmentTitle) ||
                ("acknowledgment_title" in signingConfig &&
                    isString(signingConfig.acknowledgment_title))
            }`
        );
        this._trace(
            `  acknowledgmentText present=${
                isString(signingConfig.acknowledgmentText) ||
                ("acknowledgment_text" in signingConfig &&
                    isString(signingConfig.acknowledgment_text))
            }`
        );
        this._trace(
            `  parties count=${
                Array.isArray(signingConfig.parties)
                    ? signingConfig.parties.length
                    : 0
            }`
        );
        this._trace(
            `  startY=${state.currentY.toFixed(1)} margins.left=${
                state.margins.left
            } contentWidth=${state.contentWidth}`
        );

        const labelX = state.margins.left;
        const lineInsetLeft = 4;
        const lineInsetRight = 2;
        const lineClearance = Math.max(1.25, fontSize * 0.08);
        const lineThickness = 0.5;

        /**
         * @param {string} value
         * @returns {string}
         */
        const canonicalFieldKey = (value) =>
            value
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "");

        /**
         * @param {Record<string, string>} values
         * @param {string} fieldLabel
         * @returns {string | undefined}
         */
        const getFieldValue = (values, fieldLabel) => {
            if (values[fieldLabel] !== undefined) {
                return values[fieldLabel];
            }
            const target = canonicalFieldKey(fieldLabel);
            const entries = Object.entries(values);
            for (let i = 0, len = entries.length; i < len; i++) {
                const [k, v] = entries[i];
                if (canonicalFieldKey(k) === target) {
                    return v;
                }
            }
            return undefined;
        };

        /**
         * @param {any} signatory
         * @returns {Record<string, string>}
         */
        const normalizeSignatoryValues = (signatory) => {
            /** @type {Record<string, string>} */
            const out = {};
            if (isObject(signatory)) {
                if (isObject(signatory.values)) {
                    const entries = Object.entries(signatory.values);
                    for (let i = 0, len = entries.length; i < len; i++) {
                        const [k, v] = entries[i];
                        if (isString(k) && isString(v)) {
                            out[k] = v;
                        }
                    }
                }
                if (isString(signatory.name)) {
                    out.Name = out.Name ?? signatory.name;
                }
                if (isString(signatory.title)) {
                    out.Title = out.Title ?? signatory.title;
                }
                if (isString(signatory.date)) {
                    out.Date = out.Date ?? signatory.date;
                }
                if (isString(signatory.by)) {
                    out.By = out.By ?? signatory.by;
                }
                if (isString(signatory.signature)) {
                    out.Signature = out.Signature ?? signatory.signature;
                }
            }
            return out;
        };

        /**
         * @param {any} party
         * @param {Record<string, string>} values
         * @returns {string[]}
         */
        const resolveFieldOrder = (party, values) => {
            if (Array.isArray(party.fields) && party.fields.length > 0) {
                const out = [];
                for (let i = 0, len = party.fields.length; i < len; i++) {
                    const v = party.fields[i];
                    if (!isString(v)) {
                        continue;
                    }
                    const trimmed = v.trim();
                    if (trimmed.length === 0) {
                        continue;
                    }
                    out.push(trimmed);
                }
                if (out.length > 0) return out;
            }

            const defaults = ["Name", "Title", "Date", "Signature"];
            const out = [];
            const seen = new Set();
            for (let i = 0, len = defaults.length; i < len; i++) {
                const d = defaults[i];
                seen.add(canonicalFieldKey(d));
                out.push(d);
            }

            const keys = Object.keys(values);
            for (let i = 0, len = keys.length; i < len; i++) {
                const k = keys[i];
                const canon = canonicalFieldKey(k);
                if (!canon || seen.has(canon)) continue;
                seen.add(canon);
                out.push(k);
            }

            return out;
        };

        /**
         * @param {string} fieldLabel
         * @returns {boolean}
         */
        const isSignatureField = (fieldLabel) => {
            const canon = canonicalFieldKey(fieldLabel);
            return canon === "signature" || canon === "sign";
        };

        /**
         * @param {string} fieldLabel
         * @returns {boolean}
         */
        const isDateField = (fieldLabel) => {
            const canon = canonicalFieldKey(fieldLabel);
            return canon === "date" || canon === "executiondate";
        };

        /**
         * @param {number} neededHeight
         * @param {string | null} repeatedPartyLabel
         */
        const ensurePageSpace = (neededHeight, repeatedPartyLabel) => {
            if (state.currentY - state.margins.bottom >= neededHeight) {
                return;
            }
            this.newPage(state, "signing");
            if (repeatedPartyLabel) {
                this.renderTextAt(
                    /** @type {PdfPage} */ (state.currentPage).contentBuilder,
                    state,
                    repeatedPartyLabel,
                    state.margins.left,
                    state.currentY,
                    fontSize * 1.1,
                    boldFont,
                    "left"
                );
                state.currentY -= partyLabelGap;
            }
        };

        // --- Title ---
        const centerX = state.margins.left + state.contentWidth / 2;
        this.renderTextAt(
            builder,
            state,
            "SIGNATURE PAGE",
            centerX,
            state.currentY,
            fontSize * 1.45,
            boldFont,
            "center"
        );
        state.currentY -= lineStep * 1.15;
        const ruleWidth = Math.min(320, state.contentWidth * 0.6);
        this.drawLine(
            builder,
            centerX - ruleWidth / 2,
            state.currentY + lineStep * 0.25,
            centerX + ruleWidth / 2,
            0.6,
            0
        );
        state.currentY -= lineStep * 1.25;

        // --- Witness Clause ---
        const witnessClause =
            signingConfig.witnessClause ??
            "IN WITNESS WHEREOF, the parties hereto have executed this Agreement effective as of the Effective Date.";

        const witnessClauseTopGap = isNumber(
            layoutOverrides.witnessClauseTopGap
        )
            ? layoutOverrides.witnessClauseTopGap
            : 0;

        state.currentY -= witnessClauseTopGap;

        const wrappedClause = layoutPlainText(
            witnessClause,
            state.contentWidth,
            italicFont,
            fontSize,
            lineStep
        );
        const clauseLines = wrappedClause.lines;

        for (let cl = 0, clen = clauseLines.length; cl < clen; cl++) {
            this.renderTextAt(
                builder,
                state,
                clauseLines[cl],
                state.margins.left,
                state.currentY,
                fontSize,
                italicFont,
                "left"
            );
            state.currentY -= lineStep;
        }

        const executionNote = isString(signingConfig.executionNote)
            ? applyTypographySubstitutions(signingConfig.executionNote)
            : "execution_note" in signingConfig &&
              isString(signingConfig.execution_note)
            ? applyTypographySubstitutions(signingConfig.execution_note)
            : undefined;

        const witnessClauseBottomGap = isNumber(
            layoutOverrides.witnessClauseBottomGap
        )
            ? layoutOverrides.witnessClauseBottomGap
            : lineStep * (executionNote ? 0.7 : 1.5);
        this._trace(
            `  witnessClause rendered: ${
                clauseLines.length
            } lines, topGap=${witnessClauseTopGap.toFixed(
                2
            )} bottomGap=${witnessClauseBottomGap.toFixed(
                2
            )} (override=${isNumber(layoutOverrides.witnessClauseBottomGap)})`
        );
        state.currentY -= witnessClauseBottomGap;

        if (executionNote && executionNote.trim().length > 0) {
            const executionNoteTopGap = isNumber(
                layoutOverrides.executionNoteTopGap
            )
                ? layoutOverrides.executionNoteTopGap
                : 0;
            this._trace(
                `  executionNote: topGap=${executionNoteTopGap.toFixed(
                    2
                )} (override=${isNumber(layoutOverrides.executionNoteTopGap)})`
            );
            state.currentY -= executionNoteTopGap;

            const noteFontSize = Math.max(9, fontSize * 0.95);
            const noteStep = noteFontSize * lineHeight;
            const wrappedNote = layoutPlainText(
                executionNote,
                state.contentWidth,
                regularFont,
                noteFontSize,
                noteStep
            );
            for (let i = 0, len = wrappedNote.lines.length; i < len; i++) {
                this.renderTextAt(
                    builder,
                    state,
                    wrappedNote.lines[i],
                    state.margins.left,
                    state.currentY,
                    noteFontSize,
                    regularFont,
                    "left"
                );
                state.currentY -= noteStep;
            }

            const executionNoteBottomGap = isNumber(
                layoutOverrides.executionNoteBottomGap
            )
                ? layoutOverrides.executionNoteBottomGap
                : lineStep * 1.15;
            this._trace(
                `  executionNote: ${
                    wrappedNote.lines.length
                } lines, bottomGap=${executionNoteBottomGap.toFixed(
                    2
                )} (override=${isNumber(
                    layoutOverrides.executionNoteBottomGap
                )})`
            );
            state.currentY -= executionNoteBottomGap;
        }

        const acknowledgmentTitle = isString(signingConfig.acknowledgmentTitle)
            ? applyTypographySubstitutions(signingConfig.acknowledgmentTitle)
            : "acknowledgment_title" in signingConfig &&
              isString(signingConfig.acknowledgment_title)
            ? applyTypographySubstitutions(signingConfig.acknowledgment_title)
            : undefined;
        const acknowledgmentText = isString(signingConfig.acknowledgmentText)
            ? applyTypographySubstitutions(signingConfig.acknowledgmentText)
            : "acknowledgment_text" in signingConfig &&
              isString(signingConfig.acknowledgment_text)
            ? applyTypographySubstitutions(signingConfig.acknowledgment_text)
            : undefined;

        const hasAcknowledgmentTitle =
            isString(acknowledgmentTitle) &&
            acknowledgmentTitle.trim().length > 0;
        const hasAcknowledgmentText =
            isString(acknowledgmentText) &&
            acknowledgmentText.trim().length > 0;

        if (hasAcknowledgmentTitle || hasAcknowledgmentText) {
            const acknowledgmentTopGap = isNumber(
                layoutOverrides.acknowledgmentTopGap
            )
                ? layoutOverrides.acknowledgmentTopGap
                : 0;
            state.currentY -= acknowledgmentTopGap;

            const ackTitleFontSize = Math.max(9, fontSize * 0.98);
            const ackTitleGap = Math.max(2, ackTitleFontSize * 0.35);
            const ackTextFontSize = Math.max(9, fontSize * 0.95);
            const ackTextStep = ackTextFontSize * lineHeight;

            let estimatedAckHeight = 0;
            let wrappedAckText = null;
            if (hasAcknowledgmentTitle) {
                estimatedAckHeight += ackTitleFontSize;
                if (hasAcknowledgmentText) {
                    estimatedAckHeight += ackTitleGap;
                }
            }
            if (hasAcknowledgmentText) {
                wrappedAckText = layoutPlainText(
                    acknowledgmentText.trim(),
                    state.contentWidth,
                    regularFont,
                    ackTextFontSize,
                    ackTextStep
                );
                estimatedAckHeight += wrappedAckText.lines.length * ackTextStep;
            }
            const acknowledgmentBottomGap = isNumber(
                layoutOverrides.acknowledgmentBottomGap
            )
                ? layoutOverrides.acknowledgmentBottomGap
                : lineStep * 1.0;
            estimatedAckHeight += acknowledgmentBottomGap;

            ensurePageSpace(estimatedAckHeight + lineStep * 0.2, null);

            if (hasAcknowledgmentTitle) {
                this.renderTextAt(
                    builder,
                    state,
                    acknowledgmentTitle.trim(),
                    state.margins.left,
                    state.currentY,
                    ackTitleFontSize,
                    boldFont,
                    "left"
                );
                state.currentY -= ackTitleFontSize;
                if (hasAcknowledgmentText) {
                    state.currentY -= ackTitleGap;
                }
            }

            if (hasAcknowledgmentText && wrappedAckText) {
                for (
                    let i = 0, len = wrappedAckText.lines.length;
                    i < len;
                    i++
                ) {
                    this.renderTextAt(
                        builder,
                        state,
                        wrappedAckText.lines[i],
                        state.margins.left,
                        state.currentY,
                        ackTextFontSize,
                        regularFont,
                        "left"
                    );
                    state.currentY -= ackTextStep;
                }
            }

            this._trace(
                `  acknowledgment block: title=${hasAcknowledgmentTitle} text=${hasAcknowledgmentText} bottomGap=${acknowledgmentBottomGap.toFixed(
                    2
                )} (override=${isNumber(
                    layoutOverrides.acknowledgmentBottomGap
                )})`
            );
            state.currentY -= acknowledgmentBottomGap;
        }

        // --- Party Signing Blocks ---
        const parties = signingConfig.parties;

        /**
         * @param {any} party
         * @returns {number}
         */
        const estimatePartyHeight = (party) => {
            let h = partyLabelGap;
            const signatories = Array.isArray(party.signatories)
                ? party.signatories
                : [];
            for (let si = 0, slen = signatories.length; si < slen; si++) {
                const values = normalizeSignatoryValues(signatories[si]);
                const fields = resolveFieldOrder(party, values);
                for (let fi = 0, flen = fields.length; fi < flen; fi++) {
                    h += isSignatureField(fields[fi])
                        ? signatureRowHeight
                        : rowHeight;
                    if (fi < flen - 1) h += rowGap;
                }
                h += blockGap;
            }
            return h + lineStep * 0.5;
        };

        for (let pi = 0, plen = parties.length; pi < plen; pi++) {
            const party = parties[pi];
            const estimatedHeight = estimatePartyHeight(party);
            this._trace(
                `  party[${pi}] label="${
                    party.label
                }" estimatedHeight=${estimatedHeight.toFixed(1)} signatories=${
                    Array.isArray(party.signatories)
                        ? party.signatories.length
                        : 0
                } Y=${state.currentY.toFixed(1)}`
            );
            ensurePageSpace(estimatedHeight, null);

            this.renderTextAt(
                /** @type {PdfPage} */ (state.currentPage).contentBuilder,
                state,
                applyTypographySubstitutions(party.label),
                state.margins.left,
                state.currentY,
                fontSize * 1.1,
                boldFont,
                "left"
            );
            state.currentY -= partyLabelGap;

            for (let si = 0, slen = party.signatories.length; si < slen; si++) {
                const signatory = party.signatories[si];
                const signatoryValues = normalizeSignatoryValues(signatory);
                const fieldOrder = resolveFieldOrder(party, signatoryValues);
                this._trace(
                    `    signatory[${si}] fields=[${fieldOrder.join(
                        ", "
                    )}] values={${Object.entries(signatoryValues)
                        .map(([k, v]) => `${k}:"${v}"`)
                        .join(", ")}} Y=${state.currentY.toFixed(1)}`
                );

                for (let fi = 0, flen = fieldOrder.length; fi < flen; fi++) {
                    const rawField = fieldOrder[fi];
                    const fieldLabel = rawField.trim();
                    const signatureField = isSignatureField(fieldLabel);
                    const rowBoxHeight = signatureField
                        ? signatureRowHeight
                        : rowHeight;
                    const minNeeded =
                        rowBoxHeight + (fi < flen - 1 ? rowGap : 0);

                    this._trace(
                        `      field[${fi}] "${fieldLabel}" isSig=${signatureField} rowH=${
                            isNumber(rowBoxHeight)
                                ? rowBoxHeight.toFixed(2)
                                : rowBoxHeight
                        } Y=${state.currentY.toFixed(1)}`
                    );
                    ensurePageSpace(minNeeded + lineStep * 0.2, party.label);

                    const sigBuilder = /** @type {PdfPage} */ (
                        state.currentPage
                    ).contentBuilder;
                    const rowTopBaselineY = state.currentY;
                    const rowBottomY = rowTopBaselineY - rowBoxHeight;
                    const labelText = `${fieldLabel}:`;

                    // Signature row: extra top space, label+line near bottom.
                    // Other rows: label at top, line at baseline level.
                    const lineY =
                        (signatureField ? rowBottomY : rowTopBaselineY) -
                        lineThickness;
                    const labelBaselineY = signatureField
                        ? rowBottomY
                        : rowTopBaselineY;
                    const printed = getFieldValue(signatoryValues, fieldLabel);
                    const printedText =
                        isString(printed) && printed.trim().length > 0
                            ? printed.trim()
                            : null;
                    const fieldRectX = valueX + lineInsetLeft;
                    const fieldRectWidth = Math.max(
                        48,
                        signatureLineWidth - lineInsetLeft - lineInsetRight
                    );
                    const isDateTextField =
                        !signatureField && isDateField(fieldLabel);
                    const fieldRectHeight = signatureField
                        ? Math.max(
                              rowBoxHeight - fontSize * 0.35,
                              fontSize * 1.2
                          )
                        : Math.max(
                              fontSize * 1.35,
                              Math.min(rowBoxHeight * 0.78, fontSize * 1.8)
                          );
                    const fieldRectY = signatureField
                        ? Math.max(
                              rowBottomY + Math.max(0, fontSize * 0.05),
                              rowTopBaselineY - fieldRectHeight
                          )
                        : Math.max(
                              rowBottomY + Math.max(0, fontSize * 0.02),
                              labelBaselineY - fontSize * 0.35
                          );
                    const fieldKey =
                        canonicalFieldKey(fieldLabel) || `field${fi + 1}`;
                    const formFieldName = `signing_page.party${
                        pi + 1
                    }.signatory${si + 1}.${fieldKey}`;

                    this.renderTextAt(
                        sigBuilder,
                        state,
                        labelText,
                        labelX,
                        labelBaselineY,
                        fontSize,
                        regularFont,
                        "left"
                    );

                    if (!printedText) {
                        this.drawLine(
                            sigBuilder,
                            valueX + lineInsetLeft,
                            lineY,
                            valueX + signatureLineWidth - lineInsetRight,
                            lineThickness,
                            signatureField ? 0 : 0.5
                        );
                    } else if (signatureField) {
                        this.renderTextAt(
                            sigBuilder,
                            state,
                            printedText,
                            valueX + lineInsetLeft + 2,
                            labelBaselineY,
                            fontSize,
                            regularFont,
                            "left"
                        );
                    }

                    this.addFormFieldAnnotation(state, {
                        type: "form",
                        fieldType: signatureField ? "signature" : "text",
                        name: formFieldName,
                        tooltip: isDateTextField
                            ? `${party.label} ${fieldLabel} (YYYY-MM-DD)`
                            : `${party.label} ${fieldLabel}`,
                        x: fieldRectX,
                        y: fieldRectY,
                        width: fieldRectWidth,
                        height: fieldRectHeight,
                        value: signatureField
                            ? undefined
                            : printedText ?? undefined,
                        readOnly: printedText !== null,
                        fontSize,
                        maxLength: isDateTextField ? 10 : undefined
                    });

                    state.currentY = rowBottomY;
                    if (fi < flen - 1) {
                        state.currentY -= rowGap;
                    }
                }

                state.currentY -= blockGap;
            }

            if (pi < plen - 1) {
                state.currentY -= partyGap;
            }
        }

        this._trace(
            `  renderSigningPage complete → ${
                parties.length
            } parties, 1 page(s), ended at Y=${state.currentY.toFixed(1)}`
        );
    }

    /**
     * @param {string | undefined} directiveName
     * @param {string | undefined} variant
     * @param {any} legacyStyle
     * @returns {any}
     */
    _resolveDirectiveStyle(directiveName, variant, legacyStyle = null) {
        /** @type {any} */
        let resolved = isObject(legacyStyle) ? { ...legacyStyle } : {};
        const registry =
            (isObject(this.config.directiveStyles)
                ? this.config.directiveStyles
                : null) ?? null;

        if (registry) {
            const candidates = [];
            if (directiveName && directiveName.length > 0) {
                candidates.push(directiveName);
            }
            if (variant && variant.length > 0 && variant !== directiveName) {
                candidates.push(variant);
            }

            for (let i = 0, len = candidates.length; i < len; i++) {
                const candidate = candidates[i];
                if (isObject(registry[candidate])) {
                    resolved = { ...resolved, ...registry[candidate] };
                }
            }
        }

        return resolved;
    }

    /**
     * @param {BaseNode} node
     * @returns {{ directiveName: string; variant: string; partyLabel?: string; bodyText?: string; fields: string[]; values: Record<string, string> }}
     */
    _getSignatureBlockSpec(node) {
        const attrs = isObject(node.attrs) ? node.attrs : {};
        const directiveName = isString(attrs.directive)
            ? attrs.directive.trim().toLowerCase()
            : "signature-block";
        const variant =
            isString(attrs.variant) && attrs.variant.trim().length > 0
                ? attrs.variant.trim().toLowerCase()
                : "panel";
        const partyLabel =
            isString(attrs.partyLabel) && attrs.partyLabel.trim().length > 0
                ? applyTypographySubstitutions(attrs.partyLabel.trim())
                : isString(attrs.title) && attrs.title.trim().length > 0
                ? applyTypographySubstitutions(attrs.title.trim())
                : undefined;
        const bodyText =
            isString(attrs.bodyText) && attrs.bodyText.trim().length > 0
                ? applyTypographySubstitutions(attrs.bodyText.trim())
                : undefined;

        /** @type {Record<string, string>} */
        const values = {};
        if (isObject(attrs.values)) {
            const entries = Object.entries(attrs.values);
            for (let i = 0, len = entries.length; i < len; i++) {
                const [key, value] = entries[i];
                if (!isString(key) || !isString(value)) {
                    continue;
                }
                values[key] = applyTypographySubstitutions(value.trim());
            }
        }
        if (isString(attrs.name) && !("Name" in values)) {
            values.Name = applyTypographySubstitutions(attrs.name.trim());
        }
        if (isString(attrs.title) && !("Title" in values)) {
            values.Title = applyTypographySubstitutions(attrs.title.trim());
        }
        if (isString(attrs.date) && !("Date" in values)) {
            values.Date = applyTypographySubstitutions(attrs.date.trim());
        }
        if (isString(attrs.by) && !("By" in values)) {
            values.By = applyTypographySubstitutions(attrs.by.trim());
        }
        if (isString(attrs.signature) && !("Signature" in values)) {
            values.Signature = applyTypographySubstitutions(
                attrs.signature.trim()
            );
        }

        /** @type {string[]} */
        const fields = [];
        if (Array.isArray(attrs.fields)) {
            for (let i = 0, len = attrs.fields.length; i < len; i++) {
                const value = attrs.fields[i];
                if (!isString(value)) {
                    continue;
                }
                const trimmed = value.trim();
                if (trimmed.length === 0) {
                    continue;
                }
                fields.push(trimmed);
            }
        }
        if (fields.length === 0) {
            fields.push("By", "Name", "Title", "Date");
        }

        return {
            directiveName,
            variant,
            partyLabel,
            bodyText,
            fields,
            values
        };
    }

    /**
     * @param {string} fieldLabel
     * @returns {string}
     */
    _canonicalSignatureFieldKey(fieldLabel) {
        return fieldLabel.toLowerCase().replace(/[^a-z0-9]+/g, "");
    }

    /**
     * @param {string} fieldLabel
     * @returns {boolean}
     */
    _isSignatureLineField(fieldLabel) {
        const canonical = this._canonicalSignatureFieldKey(fieldLabel);
        return (
            canonical === "signature" ||
            canonical === "sign" ||
            canonical === "by"
        );
    }

    /**
     * @param {BaseNode} node
     * @param {PdfBuildState} state
     * @returns {number}
     */
    _estimateSignatureBlockHeight(node, state) {
        const spec = this._getSignatureBlockSpec(node);
        const fontSize = this.config.baseFontSize ?? 10;
        const lineHeight = this.config.lineHeight ?? 1.5;
        const style = this._resolveDirectiveStyle(
            spec.directiveName,
            spec.variant,
            this.config.signatureBlockStyle ?? null
        );
        const paddingSpec = style.padding ?? 12;
        const pad = this._normalizeBoxPadding(paddingSpec, 12);
        const titleFontSize =
            fontSize * (numberOr(style.titleFontScale, 1.02) || 1.02);
        const rowHeight = numberOr(
            style.rowHeight,
            fontSize * lineHeight * 0.95
        );
        const signatureRowHeight = numberOr(
            style.signatureRowHeight,
            fontSize * lineHeight * 1.5
        );
        const rowGap = numberOr(style.rowGap, fontSize * 0.4);
        const headerGap = numberOr(style.headerGap, fontSize * 0.5);
        const bodyGap = numberOr(style.bodyGap, fontSize * 0.45);
        const postGap = numberOr(style.postGap, fontSize * 0.6);

        let height = pad.top + pad.bottom;
        if (spec.partyLabel) {
            height += titleFontSize + headerGap;
        }
        if (spec.bodyText) {
            const wrappedBody = layoutPlainText(
                spec.bodyText,
                Math.max(120, state.contentWidth - pad.left - pad.right),
                this.getFont(state, false),
                fontSize,
                fontSize * lineHeight
            );
            height += wrappedBody.lines.length * fontSize * lineHeight;
            height += bodyGap;
        }

        for (let i = 0, len = spec.fields.length; i < len; i++) {
            const field = spec.fields[i];
            height += this._isSignatureLineField(field)
                ? signatureRowHeight
                : rowHeight;
            if (i < len - 1) {
                height += rowGap;
            }
        }

        height += postGap;
        return height;
    }

    // =========================================================================
    // Headers & Footers
    // =========================================================================

    /**
     * Add headers and footers to all pages
     * @param {PdfBuildState} state
     * @param {ReadonlyArray<ComposedSection>} sections
     * @param {LayoutResult} layout
     * @returns {void}
     */
    addHeadersFooters(state, sections, layout) {
        const coverCfg = this.config.coverConfig;

        // Compute totalPages excluding dust-cover, cover (if suppressed), and signing pages
        let coverExcluded = false;
        let signingPageCount = 0;
        let dustCoverCount = 0;
        for (let i = 0, len = state.pages.length; i < len; i++) {
            const page = state.pages[i];
            if (page.sectionId === "dust-cover") {
                dustCoverCount++;
                continue;
            }
            if (page.sectionId === "signing") {
                signingPageCount++;
                continue;
            }
            if (
                page.sectionId === "cover" &&
                coverCfg &&
                (coverCfg.suppressPageNumbering === true ||
                    coverCfg.suppressFooter === true)
            ) {
                coverExcluded = true;
            }
        }
        let totalPages = state.pages.length - signingPageCount;
        if (dustCoverCount > 0) {
            totalPages -= dustCoverCount;
        }
        if (coverExcluded) {
            totalPages -= 1;
        }

        // Build section page counts
        /** @type {Map<string, number>} */
        const sectionPageCounts = new Map();
        for (let i = 0, len = state.pages.length; i < len; i++) {
            const page = state.pages[i];
            const count = sectionPageCounts.get(page.sectionId) ?? 0;
            sectionPageCounts.set(page.sectionId, count + 1);
        }

        // Get the canonical headers/footers - these should apply to all pages
        // Look for them in order: renderer config, first section, any section with headers
        /** @type {ReadonlyArray<HeaderFooterConfig>} */
        let canonicalHeaders = this.config.defaultHeaders ?? [];
        /** @type {ReadonlyArray<HeaderFooterConfig>} */
        let canonicalFooters = this.config.defaultFooters ?? [];

        // If no renderer defaults, look through sections for headers/footers
        if (canonicalHeaders.length === 0 || canonicalFooters.length === 0) {
            for (let s = 0; s < sections.length; s++) {
                const sec = sections[s];
                if (
                    canonicalHeaders.length === 0 &&
                    sec.config.headers &&
                    sec.config.headers.length > 0
                ) {
                    canonicalHeaders = sec.config.headers;
                }
                if (
                    canonicalFooters.length === 0 &&
                    sec.config.footers &&
                    sec.config.footers.length > 0
                ) {
                    canonicalFooters = sec.config.footers;
                }
                if (
                    canonicalHeaders.length > 0 &&
                    canonicalFooters.length > 0
                ) {
                    break;
                }
            }
        }

        // Process each page
        for (let i = 0, len = state.pages.length; i < len; i++) {
            const page = state.pages[i];

            // Signing pages never get headers or footers
            if (page.sectionId === "signing") {
                continue;
            }

            // Dust cover pages never get headers or footers
            if (page.sectionId === "dust-cover") {
                continue;
            }

            const coverCfg = this.config.coverConfig;
            const isCover = page.sectionId === "cover" && coverCfg;
            const suppressCoverHeader =
                isCover && coverCfg.suppressHeader === true;
            const suppressCoverFooter =
                isCover &&
                (coverCfg.suppressFooter === true ||
                    coverCfg.suppressPageNumbering === true);
            const suppressTocHeader = page.sectionId === "toc";

            // Find section config - handle special section IDs
            const section = sections.find((s) => s.id === page.sectionId);
            const suppressFullPageImageHeaders =
                Array.isArray(section?.content) &&
                section.content.length === 1 &&
                section.content[0]?.type === "image" &&
                (section.content[0]?.attrs?.fullPage === true ||
                    section.content[0]?.attrs?.pageMode === "full-page");

            if (suppressFullPageImageHeaders) {
                continue;
            }

            // Get headers/footers: section-specific overrides canonical
            /** @type {ReadonlyArray<HeaderFooterConfig>} */
            const headers = section?.config.headers?.length
                ? section.config.headers
                : canonicalHeaders;
            /** @type {ReadonlyArray<HeaderFooterConfig>} */
            const footers = section?.config.footers?.length
                ? section.config.footers
                : canonicalFooters;
            const sectionTotalPages =
                sectionPageCounts.get(page.sectionId) ?? 1;

            // Context for variable resolution
            const context = {
                page: page.pageNumber,
                totalPages,
                sectionPage: page.sectionPageNumber,
                sectionTotal: sectionTotalPages,
                variables: this.config.variables ?? {}
            };

            // Find and render matching header
            let headerConfig = findMatchingHeaderFooter(
                headers,
                "header",
                page.pageNumber,
                totalPages,
                page.sectionPageNumber,
                sectionTotalPages
            );

            // Fallback: if no match found but we have headers, try to match manually
            if (!headerConfig && headers.length > 0) {
                for (let h = 0; h < headers.length; h++) {
                    const hdr = headers[h];
                    const selector = hdr.pages;

                    // Check if this header should apply to this page
                    const shouldApply = this.matchesPageSelector(
                        selector,
                        page.pageNumber,
                        totalPages,
                        page.sectionPageNumber,
                        sectionTotalPages
                    );

                    if (shouldApply) {
                        headerConfig = hdr;
                        break;
                    }
                }
            }

            if (headerConfig && !suppressCoverHeader && !suppressTocHeader) {
                this.renderHeaderFooter(
                    page,
                    headerConfig,
                    "header",
                    state,
                    context
                );
            }

            // Find and render matching footer
            let footerConfig = findMatchingHeaderFooter(
                footers,
                "footer",
                page.pageNumber,
                totalPages,
                page.sectionPageNumber,
                sectionTotalPages
            );

            // Fallback for footers too
            if (!footerConfig && footers.length > 0) {
                for (let f = 0; f < footers.length; f++) {
                    const ftr = footers[f];
                    const selector = ftr.pages;

                    const shouldApply = this.matchesPageSelector(
                        selector,
                        page.pageNumber,
                        totalPages,
                        page.sectionPageNumber,
                        sectionTotalPages
                    );

                    if (shouldApply) {
                        footerConfig = ftr;
                        break;
                    }
                }
            }

            if (footerConfig && !suppressCoverFooter) {
                this.renderHeaderFooter(
                    page,
                    footerConfig,
                    "footer",
                    state,
                    context
                );
            }
        }
    }

    /**
     * Render header or footer with tri-column support
     * @param {PdfPage} page
     * @param {HeaderFooterConfig} config
     * @param {"header" | "footer"} location
     * @param {PdfBuildState} state
     * @param {{ page: number; totalPages: number; sectionPage: number; sectionTotal: number; variables: Readonly<Record<string, string | number>> }} context
     * @returns {void}
     */
    renderHeaderFooter(page, config, location, state, context) {
        const builder = page.headerFooterBuilder;
        // Use MAX fontSize across columns for offset/positioning calculations
        const fontSize =
            Math.max(
                config.columns?.left?.style?.fontSize ?? 0,
                config.columns?.center?.style?.fontSize ?? 0,
                config.columns?.right?.style?.fontSize ?? 0
            ) || 10;

        // Calculate offset for this header/footer
        // Must match newPage() offset calculation
        const offset = fontSize + (config.border ? 12 : 8);

        // Header text renders in the ORIGINAL margin area (above content)
        // Footer text renders in the ORIGINAL margin area (below content)
        // The offset carves space from content, but header/footer render in the base margin
        const y =
            location === "header"
                ? state.pageHeight - state.baseMargins.top * 0.85 + fontSize + 8
                : state.baseMargins.bottom * 0.3 + (fontSize + 8);

        const columns = config.columns;

        // Use base margins for X positioning (header/footer span full content width)
        const baseContentWidth =
            state.pageWidth - state.baseMargins.left - state.baseMargins.right;

        function applyTextTransform(text, transform) {
            if (!text) {
                return text;
            }
            if (transform === "uppercase") {
                return text.toUpperCase();
            }
            if (transform === "lowercase") {
                return text.toLowerCase();
            }
            if (transform === "capitalize") {
                return text.replace(/([A-Za-z])/g, (m) => m.toUpperCase());
            }
            return text;
        }

        // ── Resolve text and fonts for each column up-front ──
        const columnGap = 12; // minimum gap between adjacent columns (pt)

        /**
         * @param {HeaderFooterElement | null | undefined} col
         * @returns {{ text: string; font: string; size: number; color: string | undefined; style: Record<string, any> } | null}
         */
        const resolveColumn = (col) => {
            if (!col) {
                return null;
            }
            const style = col.style ?? {};
            let text = resolveHeaderFooterContent(col.content, context);
            text = applyTextTransform(text, style.textTransform);
            if (!text) {
                return null;
            }
            const font = this.getFont(
                state,
                style.bold ?? false,
                style.italic ?? false,
                style.monospace ?? false
            );
            const size = style.fontSize ?? fontSize;
            const color =
                isString(style.color) && style.color.length > 0
                    ? style.color
                    : undefined;
            return { text, font, size, color, style };
        };

        const leftCol = resolveColumn(columns?.left);
        const centerCol = resolveColumn(columns?.center);
        const rightCol = resolveColumn(columns?.right);

        // ── Measure natural widths ──
        const leftWidth = leftCol
            ? measureTextWidth(leftCol.text, leftCol.font, leftCol.size)
            : 0;
        const centerWidth = centerCol
            ? measureTextWidth(centerCol.text, centerCol.font, centerCol.size)
            : 0;
        const rightWidth = rightCol
            ? measureTextWidth(rightCol.text, rightCol.font, rightCol.size)
            : 0;

        // ── Compute max allowed width per column ──
        let leftMax = baseContentWidth;
        let centerMax = baseContentWidth;
        let rightMax = baseContentWidth;

        if (centerCol) {
            // Three-column layout: center gets its natural width (clamped),
            // left and right split the remainder
            const centerAlloc = Math.min(centerWidth, baseContentWidth * 0.4);
            const sideSpace = (baseContentWidth - centerAlloc) / 2 - columnGap;
            leftMax = Math.max(sideSpace, 0);
            centerMax = centerAlloc;
            rightMax = Math.max(sideSpace, 0);
        } else if (leftCol && rightCol) {
            // Two-column layout: each side gets up to half minus gap
            const half = (baseContentWidth - columnGap) / 2;
            // If one side is short, give the surplus to the other
            if (leftWidth <= half && rightWidth <= half) {
                leftMax = half;
                rightMax = half;
            } else if (leftWidth <= half) {
                leftMax = leftWidth;
                rightMax = baseContentWidth - leftWidth - columnGap;
            } else if (rightWidth <= half) {
                rightMax = rightWidth;
                leftMax = baseContentWidth - rightWidth - columnGap;
            } else {
                leftMax = half;
                rightMax = half;
            }
        }
        // Single column: leftMax/rightMax stays at baseContentWidth (no truncation needed)

        /**
         * Truncate text with ellipsis to fit within maxWidth.
         * @param {string} text
         * @param {string} font
         * @param {number} size
         * @param {number} maxWidth
         * @returns {string}
         */
        const truncateToFit = (text, font, size, maxWidth) => {
            const width = measureTextWidth(text, font, size);
            if (width <= maxWidth) {
                return text;
            }
            const ellipsis = "\u2026";
            const ellipsisWidth = measureTextWidth(ellipsis, font, size);
            const targetWidth = maxWidth - ellipsisWidth;
            if (targetWidth <= 0) {
                return ellipsis;
            }
            // Binary search for the longest substring that fits
            let lo = 0;
            let hi = text.length;
            while (lo < hi) {
                const mid = (lo + hi + 1) >>> 1;
                if (
                    measureTextWidth(text.substring(0, mid), font, size) <=
                    targetWidth
                ) {
                    lo = mid;
                } else {
                    hi = mid - 1;
                }
            }
            return text.substring(0, lo).trimEnd() + ellipsis;
        };

        /**
         * @param {{ text: string; font: string; size: number; color: string | undefined } | null} col
         * @param {number} x
         * @param {"left" | "center" | "right"} align
         * @param {number} maxWidth
         */
        const renderColumn = (col, x, align, maxWidth) => {
            if (!col) {
                return;
            }
            const text = truncateToFit(col.text, col.font, col.size, maxWidth);
            this.renderTextAt(
                builder,
                state,
                text,
                x,
                y,
                col.size,
                col.font,
                align,
                col.color
            );
        };

        // Left column
        renderColumn(leftCol, state.baseMargins.left, "left", leftMax);

        // Center column
        renderColumn(
            centerCol,
            state.baseMargins.left + baseContentWidth / 2,
            "center",
            centerMax
        );

        // Right column
        renderColumn(
            rightCol,
            state.baseMargins.left + baseContentWidth,
            "right",
            rightMax
        );

        // Border line at content boundary (between header/footer text and content)
        if (config.border) {
            // Border sits between the text and the content area
            // Content starts at currentY which is baseline. Large headings (18pt) have
            // ascenders ~13pt above baseline. Border must be above that.
            const borderGap = 20;
            const lineY =
                location === "header"
                    ? state.pageHeight -
                      state.baseMargins.top * 0.85 -
                      offset +
                      borderGap
                    : state.baseMargins.bottom * 1.15 + offset - borderGap;

            this.drawLine(
                builder,
                state.baseMargins.left,
                lineY,
                state.pageWidth - state.baseMargins.right,
                config.border.width ?? 0.5,
                config.border.color ?? 0
            );
        }
    }

    // =========================================================================
    // TOC Page Update
    // =========================================================================

    /**
     * Update TOC entries with resolved page numbers
     * Injects document-level entries based on section configuration
     * @param {TocNode} toc
     * @param {LayoutResult} layout
     * @param {ComposedSection[] | ReadonlyArray<ComposedSection>} sections - Sections for document entry injection
     * @returns {void}
     */
    updateTocPages(toc, layout, sections) {
        // Update existing entries with page numbers from layout
        for (let i = 0, len = toc.entries.length; i < len; i++) {
            const entry = toc.entries[i];
            const layoutEntry = layout.tocEntries.find(
                (e) => e.nodeId === entry.nodeId
            );
            if (layoutEntry) {
                /** @type {{ page: number; title?: string }} */ (entry).page =
                    layoutEntry.page;
                if (!entry.title && layoutEntry.title) {
                    /** @type {{ title: string }} */ (entry).title =
                        layoutEntry.title;
                }
            }
        }

        // If toc.entries is empty but layout has tocEntries, rebuild with document entries
        if (toc.entries.length === 0 && layout.tocEntries.length > 0) {
            const sectionDocuments =
                /** @type {any} */ (toc.config)?.sectionDocuments ?? [];
            const hasDocEntries = sectionDocuments.length > 0;
            const rawConfiguredLevels = Array.isArray(toc.config?.levels)
                ? toc.config.levels
                : null;
            const configuredLevels = new Set(rawConfiguredLevels ?? []);
            const filterByLevel = rawConfiguredLevels !== null;

            // Track section boundaries by mapping section IDs to their index
            /** @type {Map<string, number>} */
            const sectionIdxMap = new Map();
            for (let i = 0, len = sections.length; i < len; i++) {
                sectionIdxMap.set(sections[i].id, i);
            }

            // Group layout entries by section and find section start pages
            /** @type {Map<number, { page: number; entries: TocLayoutEntry[] }>} */
            const sectionGroups = new Map();

            // Since entries are in document order, detect section changes by page gaps
            // (each section starts on a new page)
            let currentSectionIdx = 0;
            let prevPage = -1;

            for (let i = 0, len = layout.tocEntries.length; i < len; i++) {
                const le = layout.tocEntries[i];

                // Detect section boundary: significant page gap (new page)
                // This works because startsNewPage: true is set for each section
                if (
                    prevPage !== -1 &&
                    le.page > prevPage &&
                    currentSectionIdx < sections.length - 1
                ) {
                    // Check if next section would start here
                    // A page gap of 2+ usually indicates a new section due to startsNewPage
                    if (
                        le.page > prevPage + 1 ||
                        (le.level === 1 && le.page > prevPage)
                    ) {
                        currentSectionIdx++;
                    }
                }

                // Initialize group if needed
                if (!sectionGroups.has(currentSectionIdx)) {
                    sectionGroups.set(currentSectionIdx, {
                        page: le.page,
                        entries: []
                    });
                }
                sectionGroups.get(currentSectionIdx).entries.push(le);

                prevPage = le.page;
            }

            // Build final TOC entries with document headers
            for (let sIdx = 0; sIdx < sections.length; sIdx++) {
                const group = sectionGroups.get(sIdx);
                if (!group) continue;

                // Inject document entry if we have section documents
                if (hasDocEntries && sectionDocuments[sIdx]) {
                    /** @type {any} */ (toc.entries).push({
                        nodeId: `__doc_${sIdx}__`,
                        level: 1,
                        title: sectionDocuments[sIdx].name,
                        page: group.page,
                        isDocumentEntry: true
                    });
                }

                // Add heading entries (bump level by 1 if we have document entries)
                const levelOffset = hasDocEntries ? 1 : 0;
                for (let i = 0, len = group.entries.length; i < len; i++) {
                    const le = group.entries[i];
                    const originalLevel = Number(le.level) || 1;
                    if (filterByLevel && !configuredLevels.has(originalLevel)) {
                        continue;
                    }
                    /** @type {any} */ (toc.entries).push({
                        nodeId: le.nodeId,
                        level: originalLevel + levelOffset,
                        title: le.title,
                        page: le.page
                    });
                }
            }
        }
    }

    // =========================================================================
    // Helper Methods
    // =========================================================================

    /**
     * @param {BaseNode} node
     * @returns {string}
     */
    extractText(node) {
        if (node.type === "text") {
            return node.getTextContent() ?? "";
        }
        let text = "";
        for (let i = 0, len = node.children.length; i < len; i++) {
            text += this.extractText(node.children[i]);
        }
        return text;
    }

    /**
     * @param {BaseNode} node
     * @param {PdfBuildState} state
     * @returns {number}
     */

    estimateNodeHeight(node, state, depth = 0) {
        const baseFontSize = this.config.baseFontSize ?? 10;
        const lineHeight = this.config.lineHeight ?? 1.5;

        switch (node.type) {
            case "paragraph": {
                const labelInfo = this.getRunInLabelInfo(node);
                const runs = this.buildInlineRuns(node);

                let availableWidth = state.contentWidth;
                if (labelInfo) {
                    const baseFont = this.getFont(state, false);
                    const labelText = `${labelInfo.label}${labelInfo.sep}`;
                    const labelWidth = measureTextWidth(
                        labelText,
                        baseFont,
                        baseFontSize
                    );
                    availableWidth = Math.max(
                        1,
                        state.contentWidth - labelWidth
                    );
                }

                const lines = this.estimateInlineRunsLineCount(
                    runs,
                    state,
                    availableWidth,
                    baseFontSize
                );
                return lines * baseFontSize * lineHeight;
            }

            case "list-item": {
                const indent = depth * 20;

                const labelInfo = this.getRunInLabelInfo(node);

                let availableWidth = state.contentWidth - indent - 15;
                if (labelInfo) {
                    const baseFont = this.getFont(state, false);
                    const labelText = `${labelInfo.label}${labelInfo.sep}`;
                    const labelWidth = measureTextWidth(
                        labelText,
                        baseFont,
                        baseFontSize
                    );
                    availableWidth = state.contentWidth - indent - labelWidth;
                }

                let inlineRoot = node;
                for (let i = 0, len = node.children.length; i < len; i++) {
                    if (
                        node.children[i].type === "paragraph" ||
                        node.children[i].type === "definition"
                    ) {
                        inlineRoot = node.children[i];
                        break;
                    }
                }

                const runs = this.buildInlineRuns(inlineRoot);
                const lines = this.estimateInlineRunsLineCount(
                    runs,
                    state,
                    Math.max(1, availableWidth),
                    baseFontSize
                );
                return lines * baseFontSize * lineHeight;
            }

            case "heading": {
                return this._estimateRenderedHeadingHeight(node, state);
            }

            case "text": {
                const font = this.getFont(state, false);
                const text = node.getTextContent() ?? "";
                const lineWidth = measureTextWidth(text, font, baseFontSize);
                const lines = Math.ceil(lineWidth / state.contentWidth);
                return lines * baseFontSize * lineHeight;
            }

            case "list": {
                let height = 0;
                for (let i = 0, len = node.children.length; i < len; i++) {
                    height += this.estimateNodeHeight(
                        node.children[i],
                        state,
                        depth + 1
                    );
                }
                return height;
            }

            case "code-block": {
                const code = /** @type {string} */ (node.attrs?.code) || "";
                const lines = code.split("\n").length;
                return lines * baseFontSize * lineHeight;
            }

            case "table": {
                // Support either:
                //  - attrs.tableData (legacy)
                //  - row/cell child nodes (canonical)
                const tableData = /** @type {any} */ (node.attrs?.tableData);

                const rowHeight = baseFontSize * lineHeight;
                const captionHeight = node.attrs?.caption ? rowHeight : 0;

                if (tableData && Array.isArray(tableData.rows)) {
                    return (
                        captionHeight + (tableData.rows.length + 1) * rowHeight
                    );
                }

                if (
                    !Array.isArray(node.children) ||
                    node.children.length === 0
                ) {
                    return captionHeight + rowHeight; // minimal footprint
                }

                // Conservative: treat each row as one rowHeight. Text wrapping can exceed this, but
                // we prefer over-breaking (new page early) over splitting tables unexpectedly.
                return captionHeight + node.children.length * rowHeight;
            }

            case "horizontal-rule": {
                const hrCfg = /** @type {any} */ (
                    this.config.horizontalRule ??
                        ("horizontal_rule" in this.config
                            ? this.config.horizontal_rule
                            : null) ??
                        null
                );
                const hrHeight = isNumber(hrCfg?.blockHeightPt)
                    ? hrCfg.blockHeightPt
                    : isNumber(hrCfg?.block_height_pt)
                    ? hrCfg.block_height_pt
                    : 14;
                return Math.max(baseFontSize * lineHeight, hrHeight);
            }

            case "notice": {
                const boxPadding = 10;
                const title =
                    /** @type {any} */ (node).title ?? node.attrs?.title;

                // Simulate child rendering spacing inside notice:
                // - children render as if they follow a "notice" header (lastNodeType = "notice")
                let contentHeight = 0;
                let lastType = /** @type {NodeType} */ ("notice");

                for (let i = 0, len = node.children.length; i < len; i++) {
                    const child = node.children[i];
                    const spacing = this.getVerticalSpacing(child, lastType);
                    contentHeight += spacing;
                    contentHeight += this.estimateNodeHeight(
                        child,
                        state,
                        depth
                    );
                    lastType = child.type;
                }

                // Top padding + baseline offset (renderNotice subtracts boxPadding + fontSize*0.8)
                let height = boxPadding + baseFontSize * 0.8;

                // Title line + gap
                if (title) {
                    height += baseFontSize * lineHeight;
                }

                // Child block height
                height += contentHeight;

                // Bottom padding + post-box gap (renderNotice subtracts boxPadding + fontSize*0.5)
                height += boxPadding + baseFontSize * 0.5;

                return height;
            }

            case "signature-block": {
                return this._estimateSignatureBlockHeight(node, state);
            }

            case "article":
            case "section": {
                let contentHeight = 0;
                for (let i = 0, len = node.children.length; i < len; i++) {
                    contentHeight += this.estimateNodeHeight(
                        node.children[i],
                        state,
                        depth
                    );
                }
                return contentHeight;
            }

            default: {
                // Default: sum children
                let contentHeight = 0;
                for (let i = 0, len = node.children.length; i < len; i++) {
                    contentHeight += this.estimateNodeHeight(
                        node.children[i],
                        state,
                        depth
                    );
                }
                return contentHeight;
            }
        }
    }

    // =========================================================================
    // PDF Building
    // =========================================================================

    /**
     * Build final PDF from state
     * @param {PdfBuildState} state
     * @returns {Uint8Array}
     */
    buildPdf(state) {
        // Add each page to the document
        for (let i = 0, len = state.pages.length; i < len; i++) {
            const page = state.pages[i];

            // Combine content and header/footer streams
            const contentStream = page.contentBuilder.build();
            const headerFooterStream = page.headerFooterBuilder.build();

            // Combine streams (header/footer on top of content)
            let combinedStream = contentStream;
            if (headerFooterStream.length > 0) {
                combinedStream = contentStream + "\n" + headerFooterStream;
            }

            // Add page to document with link annotations
            state.doc.addPageFromString(combinedStream, page.linkAnnotations);
        }

        // Build and return final PDF bytes
        return state.doc.build();
    }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * @param {PdfRendererConfig} config
 * @returns {TwoPassPdfRenderer}
 */
export function createTwoPassPdfRenderer(config) {
    return new TwoPassPdfRenderer(config);
}
