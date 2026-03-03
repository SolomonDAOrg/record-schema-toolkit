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
import { PdfDocumentBuilder, measureTextWidth } from "../../pdf/document.mjs";
import { PdfContentStreamBuilder } from "../../pdf/content-stream.mjs";
import { layoutPlainText } from "../../pdf/text-layout.mjs";
import { PAGE_SIZES, DEFAULT_SPACING_BEFORE } from "../constants/core.mjs";
import { createPageBreak } from "../nodes/BaseNode.mjs";

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
 * @typedef {import("../types/core.mjs").Margins} Margins
 * @typedef {import("../types/core.mjs").TextStyle} TextStyle
 * @typedef {import("../types/core.mjs").PageSelector} PageSelector
 * @typedef {import("../types/core.mjs").PageSelectorPredicate} PageSelectorPredicate
 * @typedef {import("../types/core.mjs").FontsConfig} FontsConfig
 * @typedef {import("../types/core.mjs").ColumnDef} ColumnDef
 * @typedef {import("../types/core.mjs").LinkAnnotation} LinkAnnotation
 * @typedef {import("../types/core.mjs").ComposedSection} ComposedSection
 * @typedef {import("../types/core.mjs").CoverPageNode} CoverPageNode
 * @typedef {import("../types/core.mjs").RenderResult} RenderResult
 * @typedef {import("../types/core.mjs").TocNode} TocNode
 * @typedef {import("../types/core.mjs").VariableRef} VariableRef
 * @typedef {import("../types/core.mjs").SpacingPolicy} SpacingPolicy
 * @typedef {import("../types/core.mjs").TocLevelStyle} TocLevelStyle
 * @typedef {import("../types/core.mjs").HorizontalRuleBehavior} HorizontalRuleBehavior
 * @typedef {import("../types/core.mjs").BreakMode} BreakMode
 * @typedef {import("../types/core.mjs").Padding} Padding
 * @typedef {import("../types/core.mjs").TableRenderConfig} TableRenderConfig
 * @typedef {import("../nodes/BaseNode.mjs").BaseNode} BaseNode
 * @typedef {import("../nodes/LegalNode.mjs").DefinitionNode} DefinitionNode
 * @typedef {import("../nodes/TabularNode.mjs").TableNode} TableNode
 * @typedef {import("../nodes/TabularNode.mjs").RowNode} RowNode
 * @typedef {import("../nodes/TabularNode.mjs").CellNode} CellNode
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
 * @property {{ regular?: string; bold?: string; italic?: string; monospace?: string }} [fonts]
 * @property {number} [baseFontSize]
 * @property {number} [lineHeight]
 * @property {SpacingPolicy} [spacingPolicy] - Context-aware spacing rules (pair rules, defaults)
 * @property {SpacingPolicy} [spacing_policy] - Snake_case alias (for packs)
 * @property {Readonly<Record<string, string | number>>} [variables]
 * @property {{
 *  suppressHeader?: boolean;
 *  suppressFooter?: boolean;
 *  suppressPageNumbering?: boolean;
 *  reserveHeaderFooterSpace?: boolean;
 *  watermark?: { enabled?: boolean; text?: string; gray?: number; angleDeg?: number; fontSize?: number };
 * }} [coverConfig] - Cover-page specific rendering overrides
 * @property {{ behavior?: HorizontalRuleBehavior }} [horizontalRule]
 * @property {TableRenderConfig} [table] - Table styling overrides
 * @property {{ levelStyles?: Record<number, TocLevelStyle> }} [tocConfig]
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
 * @property {LinkAnnotation[]} linkAnnotations
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
 */

// =============================================================================
// TwoPassPdfRenderer
// =============================================================================

export class TwoPassPdfRenderer {
    /**
     * @param {PdfRendererConfig} config
     */
    constructor(config) {
        /** @type {any} */
        const spacingPolicy =
            config.spacingPolicy ?? config.spacing_policy ?? undefined;

        /** @type {PdfRendererConfig} */
        this.config = spacingPolicy ? { ...config, spacingPolicy } : config;

        /** @type {LayoutEngine} */

        this.layoutEngine = new LayoutEngine();

        /** @type {string[]} */
        this.warnings = [];

        /** @type {string[]} */
        this.errors = [];

        /** @type {FontsConfig} */
        this.fontConfig = {
            regular: config.fonts?.regular ?? "Helvetica",
            bold: config.fonts?.bold ?? "Helvetica-Bold",
            italic: config.fonts?.italic ?? "Helvetica-Oblique",
            monospace: config.fonts?.monospace ?? "Courier"
        };

        /** @type {{ behavior?: "rule" | "page-break" }} */
        this.horizontalRuleConfig = config.horizontalRule ?? {
            behavior: "rule"
        };

        /** @type {Record<number, TocLevelStyle>} */
        this.tocLevelStyles = config.tocConfig?.levelStyles ?? {};

        /** @type {boolean} */
        this._verbose = config.verbose || false;
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
     * @returns {RenderResult}
     */
    render(sections, coverPage, toc) {
        this.warnings = [];
        this.errors = [];

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
                coverPage ? this.getPageHeight() : undefined,
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
                const insertAt = coverPage ? 1 : 0;
                state.pages.splice(insertAt, 0, ...tocPages);
            }

            // Renumber pages and recompute per-section numbering after TOC insertion
            this.renumberPages(state);

            // Build internal anchor destinations from the REAL rendered pages (after TOC insertion)
            this.rebuildLinkDestinationsFromRaw(
                state,
                coverPage ? 1 : 0,
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

        const pageWidth = pageConfig.width ?? size.width;
        const pageHeight = pageConfig.height ?? size.height;

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
        doc.registerFont(this.fontConfig.regular);
        doc.registerFont(this.fontConfig.bold);
        doc.registerFont(this.fontConfig.italic);
        doc.registerFont(this.fontConfig.monospace);

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
            linkDestinations: new Map(),
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

        const configuredLevels = new Set(toc.config?.levels ?? []);
        const filterByLevel = configuredLevels.size > 0;

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
            if (typeof startIndex !== "number") {
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
                page:
                    typeof entry.page === "number"
                        ? entry.page + pageDelta
                        : entry.page
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
        return pageConfig.height ?? size.height;
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
                (typeof secCfg?.horizontalRuleBehavior === "string" &&
                secCfg.horizontalRuleBehavior.length > 0
                    ? secCfg.horizontalRuleBehavior
                    : null) ?? globalHrBehavior;

            this._trace(
                `  section[${i}] "${s.id}" hrBehavior=${sectionHrBehavior} nodes=${s.content.length}`
            );

            const sectionBreakMode =
                /** @type {any} */ (secCfg)?.breakMode ?? "always";

            out.push({
                ...s,
                content: this.normalizeSectionContentForPreface(
                    s.content,
                    sectionHrBehavior,
                    sectionBreakMode
                )
            });
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
            if (i === 0) continue;

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
            const n = nodes[i];
            // Stop at next HR — that's the boundary of this region
            if (n.type === "horizontal-rule") {
                return false;
            }
            if (n.type === "table") {
                return true;
            }
            if (this.isPartLevelNode(n)) {
                return true;
            }
            // Also check structured wrappers in case some docs use them
            if (
                (n.type === "article" || n.type === "section") &&
                this.containsTable(n)
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
            return String(/** @type {any} */ (node).getTextContent());
        }

        if (typeof node.attrs?.text === "string") {
            return node.attrs.text;
        }

        if (typeof node.attrs?.code === "string") {
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
            nodeStyle?.spacing_before_pt ??
            nodeStyle?.beforeSpacingPt ??
            nodeStyle?.before_spacing_pt ??
            node.attrs?.spacingBeforePt ??
            node.attrs?.spacing_before_pt ??
            node.attrs?.beforeSpacingPt ??
            node.attrs?.before_spacing_pt ??
            null;

        if (typeof spacingBeforePt === "number") {
            return spacingBeforePt;
        }

        const spacingBeforeEm =
            nodeStyle?.spacingBefore ??
            nodeStyle?.spacing_before ??
            nodeStyle?.beforeSpacing ??
            nodeStyle?.before_spacing ??
            node.attrs?.spacingBefore ??
            node.attrs?.spacing_before ??
            node.attrs?.beforeSpacing ??
            node.attrs?.before_spacing ??
            null;

        if (typeof spacingBeforeEm === "number") {
            return spacingBeforeEm * em;
        }
        if (
            typeof spacingBeforeEm === "string" &&
            spacingBeforeEm.trim().length > 0
        ) {
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
        const rules =
            policy.beforeRules ??
            policy.before_rules ??
            policy.before ??
            policy.rules ??
            policy.verticalSpacingRules ??
            policy.vertical_spacing_rules ??
            [];

        /** @type {Readonly<Record<string, number>> | undefined} */
        const perTypeDefaults =
            policy.defaultBeforeEmByType ??
            policy.default_before_em_by_type ??
            policy.defaultBefore ??
            policy.default_before ??
            policy.defaultEmByType ??
            policy.default_em_by_type;

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

            const priority =
                typeof rule.priority === "number" ? rule.priority : 0;
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

            if (typeof pt === "number") {
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

            if (typeof emVal === "number") {
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
            if (typeof v === "number") {
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
        if (typeof selector === "string") {
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
            isToc || isSigning || coverSuppressHeader ? 0 : headerMaxOffset;

        // Signing pages never reserve footer space.
        // For cover pages, only reserve footer space if it's actually rendered,
        // unless reserveHeaderFooterSpace is explicitly enabled.
        const footerOffset = isSigning
            ? 0
            : isCover
            ? coverSuppressFooter
                ? reserveCoverSpace
                    ? footerMaxOffset
                    : 0
                : footerMaxOffset
            : footerMaxOffset;

        // Adjust effective margins
        state.margins.top = state.baseMargins.top + headerOffset;
        state.margins.bottom = state.baseMargins.bottom + footerOffset;
        state.contentHeight =
            state.pageHeight - state.margins.top - state.margins.bottom;

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
     * Add link annotation to current page
     * @param {PdfBuildState} state
     * @param {LinkAnnotation} annotation
     * @returns {void}
     */
    addLinkAnnotation(state, annotation) {
        const page = /** @type {PdfPage} */ (state.currentPage);
        page.linkAnnotations.push(annotation);
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
     * @returns {string}
     */
    getFont(state, bold, italic = false, monospace = false) {
        if (monospace) {
            return state.fonts.monospace;
        }
        if (bold && italic) {
            return "Helvetica-BoldOblique";
        }
        if (bold) {
            return state.fonts.bold;
        }
        if (italic) {
            return state.fonts.italic;
        }
        return state.fonts.regular;
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
        const t = typeof text === "string" ? text : String(text ?? "");
        const hasDeep = this._textHasDeepDescenders(t);
        const hasShallow = !hasDeep && this._textHasShallowDescenders(t);

        // Conservative defaults; tuned for visual balance in mixed content.
        let factor = 0.18;
        if (hasDeep) factor = 0.3;
        else if (hasShallow) factor = 0.24;

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
        const t = typeof text === "string" ? text : String(text ?? "");
        // Consider only ASCII alpha for the "all caps" heuristic.
        const letters = t.replace(/[^A-Za-z]/g, "");
        const isAllCaps =
            letters.length > 0 && letters === letters.toUpperCase();
        if (isAllCaps) return 0;

        const hasLowerTall =
            /[bdfhklt]/.test(t) || (/[BDFHKLT]/.test(t) && /[a-z]/.test(t));
        if (!hasLowerTall) return 0;

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

        if (typeof text === "string") {
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
     * Simple text wrapper for plain text content
     * @param {string} text
     * @param {number} maxWidth
     * @param {string} font
     * @param {number} fontSize
     * @returns {string[]}
     */
    wrapText(text, maxWidth, font, fontSize) {
        if (!text) return [];

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
                if (!word) continue;

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
     * @param {"left"|"center"|"right"} align
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
        if (text.indexOf("\n") !== -1) return text;

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

            if (idx <= 0) continue;

            const left = text.slice(0, idx).trimEnd();
            const right = text.slice(idx + 1).trimStart();

            if (!left || !right) continue;

            const leftW = measureTextWidth(left, font, fontSize);
            const rightW = measureTextWidth(right, font, fontSize);

            if (leftW > maxWidth || rightW > maxWidth) continue;

            const balance = Math.abs(leftW - rightW);

            if (balance < bestBalance) {
                bestBalance = balance;
                bestSplit = `${left}\n${right}`;
            }
        }
        if (bestSplit) return bestSplit;

        // Already fits on one line — no splitting needed.
        if (fullWidth <= maxWidth) return text;

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
     * Draw horizontal line
     * @param {PdfContentStreamBuilder} builder
     * @param {number} x1
     * @param {number} y
     * @param {number} x2
     * @param {number} lineWidth
     * @param {number} [gray]
     * @returns {void}
     */
    drawLine(builder, x1, y, x2, lineWidth, gray = 0) {
        builder
            .saveState()
            .setLineWidth(lineWidth)
            .setStrokeGray(gray)
            .moveTo(x1, y)
            .lineTo(x2, y)
            .stroke()
            .restoreState();
    }

    /**
     * Draw filled rectangle
     * @param {PdfContentStreamBuilder} builder
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @param {number} height
     * @param {number} gray
     * @returns {void}
     */
    drawFilledRect(builder, x, y, width, height, gray) {
        builder
            .saveState()
            .setFillGray(gray)
            .rectangle(x, y, width, height)
            .fill()
            .restoreState();
    }

    /**
     * Draw stroked rectangle
     * @param {PdfContentStreamBuilder} builder
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @param {number} height
     * @param {number} [lineWidth]
     * @param {number} [gray]
     * @returns {void}
     */
    drawStrokedRect(builder, x, y, width, height, lineWidth = 0.5, gray = 0) {
        builder
            .saveState()
            .setLineWidth(lineWidth)
            .setStrokeGray(gray)
            .rectangle(x, y, width, height)
            .stroke()
            .restoreState();
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
     * @param {{ enabled?: boolean; text?: string; gray?: number; angleDeg?: number; fontSize?: number }} watermark
     * @returns {void}
     */
    renderDiagonalWatermark(builder, state, watermark) {
        if (!watermark || watermark.enabled === false) {
            return;
        }

        const text = watermark.text ?? "DRAFT DOCUMENT";
        const gray = typeof watermark.gray === "number" ? watermark.gray : 0.9;
        const angleDeg =
            typeof watermark.angleDeg === "number" ? watermark.angleDeg : 35;
        const fontSize =
            typeof watermark.fontSize === "number" ? watermark.fontSize : 84;

        const angle = (angleDeg * Math.PI) / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        const centerX = state.pageWidth / 2;
        const centerY = state.pageHeight / 2;

        const w = measureTextWidth(text, this.fontConfig.bold, fontSize);
        const startX = centerX - (w / 2) * cos;
        const startY = centerY - (w / 2) * sin;

        const fontName = this.getFontResourceName(state, this.fontConfig.bold);

        builder
            .saveState()
            .setFillGray(gray)
            .beginText()
            .setFont(fontName, fontSize)
            .setTextMatrix(cos, sin, -sin, cos, startX, startY)
            .showText(text)
            .endText()
            .restoreState();
    }
    // =========================================================================

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

        const coverCfg = /** @type {any} */ (coverPage.config);
        const watermark =
            coverCfg?.options?.watermark ??
            coverCfg?.watermark ??
            this.config.coverConfig?.watermark;

        if (watermark && watermark.enabled !== false) {
            this.renderDiagonalWatermark(builder, state, watermark);
        }

        let y = state.currentY;
        const centerX = state.margins.left + state.contentWidth / 2;

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

                    const textStartFrac =
                        typeof element.startFrac === "number"
                            ? element.startFrac
                            : typeof element.start_frac === "number"
                            ? element.start_frac
                            : 0;

                    const textEndFrac =
                        typeof element.endFrac === "number"
                            ? element.endFrac
                            : typeof element.end_frac === "number"
                            ? element.end_frac
                            : 1;

                    const textLeftX =
                        state.margins.left + state.contentWidth * textStartFrac;
                    const textRightX =
                        state.margins.left + state.contentWidth * textEndFrac;

                    let x = textLeftX;
                    if (align === "center") {
                        x = textLeftX + (textRightX - textLeftX) / 2;
                    } else if (align === "right") {
                        x = textRightX;
                    }

                    const text = this.wrapText(
                        typeof element.content === "string"
                            ? element.content
                            : "",
                        state.contentWidth,
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
                                align
                            );
                        }
                        y -= fontSize * 1.5;
                    }
                    break;
                }

                case "title-block": {
                    const titleText = element.title || "";
                    const ofText = element.conjunction || "";
                    const entityText = element.entityName || "";
                    const titleFontSize = element.style?.fontSize || 24;
                    const subtitleFontSize = element.subtitleFontSize || 14;
                    const entityFontSize = element.entityFontSize || 20;
                    const align = element.style?.align || "center";

                    const centerX = state.margins.left + state.contentWidth / 2;
                    const rightX = state.margins.left + state.contentWidth;

                    const titleX =
                        align === "center"
                            ? centerX
                            : align === "right"
                            ? rightX
                            : state.margins.left;

                    const wrappedTitleText = this.wrapText(
                        titleText,
                        state.contentWidth,
                        state.fonts.bold || state.fonts.regular,
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
                                state.fonts.bold || state.fonts.regular,
                                align
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
                            state.fonts.regular,
                            align
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
                        state.fonts.bold || state.fonts.regular,
                        align
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

                    const columnGap =
                        typeof element.columnGap === "number"
                            ? element.columnGap
                            : 12;

                    const lineSpacer =
                        typeof element.lineSpacer === "number"
                            ? element.lineSpacer
                            : 10;

                    const rows = Array.isArray(element.rows)
                        ? element.rows
                        : [];

                    const sepRaw =
                        typeof element.separator === "string"
                            ? element.separator
                            : ": ";
                    const sepTrim = sepRaw.trimEnd();

                    let maxLabelWidth = 0;
                    let maxValueWidth = 0;

                    for (let r = 0, rlen = rows.length; r < rlen; r++) {
                        const row = rows[r] ?? {};
                        const label =
                            typeof row.label === "string" ? row.label : "";
                        const value =
                            typeof row.value === "string" ? row.value : "";

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

                    const startFracRaw =
                        typeof element.startFrac === "number"
                            ? element.startFrac
                            : typeof element.start_frac === "number"
                            ? element.start_frac
                            : 0;

                    const endFracRaw =
                        typeof element.endFrac === "number"
                            ? element.endFrac
                            : typeof element.end_frac === "number"
                            ? element.end_frac
                            : 1;

                    const startFrac =
                        startFracRaw >= 0 && startFracRaw <= 1
                            ? startFracRaw
                            : 0;
                    const endFrac =
                        endFracRaw >= 0 && endFracRaw <= 1 ? endFracRaw : 1;

                    const safeStartFrac = startFrac < endFrac ? startFrac : 0;
                    const safeEndFrac = startFrac < endFrac ? endFrac : 1;

                    const availableWidth =
                        state.contentWidth * (safeEndFrac - safeStartFrac);

                    const blockLeftX =
                        state.margins.left + state.contentWidth * safeStartFrac;

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
                        const label =
                            typeof row.label === "string" ? row.label : "";
                        const value =
                            typeof row.value === "string" ? row.value : "";

                        const labelText = `${label}${sepTrim}`;
                        this.renderTextAt(
                            builder,
                            state,
                            labelText,
                            labelX,
                            y,
                            fontSize,
                            baseFont,
                            labelAlign
                        );

                        const valueLines =
                            value && value.length > 0
                                ? this.wrapText(
                                      value,
                                      desiredValueWidth,
                                      baseFont,
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
                                baseFont,
                                "left"
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
                    const startFrac =
                        typeof element.startFrac === "number"
                            ? element.startFrac
                            : typeof element.start_frac === "number"
                            ? element.start_frac
                            : 0.25;

                    const endFrac =
                        typeof element.endFrac === "number"
                            ? element.endFrac
                            : typeof element.end_frac === "number"
                            ? element.end_frac
                            : 0.75;

                    const lineWidth =
                        typeof element.lineWidth === "number"
                            ? element.lineWidth
                            : typeof element.line_width === "number"
                            ? element.line_width
                            : 0.5;

                    const gray =
                        typeof element.gray === "number" ? element.gray : 0.5;

                    this.drawLine(
                        builder,
                        state.margins.left + state.contentWidth * startFrac,
                        y,
                        state.margins.left + state.contentWidth * endFrac,
                        lineWidth,
                        gray
                    );
                    y -= 10;
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
        const levelStyles = this.config.tocConfig?.levelStyles ?? {
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
            const titleFont = this.getFont(state, true);

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
            const entryTitle = entry.title
                .replace(/---/g, "—")
                .replace(/--/g, "—");

            // Check if this is a document-level entry
            const isDocumentEntry =
                /** @type {any} */ (entry).isDocumentEntry === true;
            const effectiveLevel = entry.level; // Level already set correctly in updateTocPages

            // Get level-specific styling
            const levelStyle = levelStyles[effectiveLevel] ??
                levelStyles[1] ?? {
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
            const entryFont = this.getFont(state, entryBold);

            const pageNumText = String(entry.page);
            const pageNumFont = this.getFont(state, false);
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
                typeof entrySpacingBefore === "number" &&
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
        /** @type {Record<number, number>} */
        const scales = { 1: 2.0, 2: 1.5, 3: 1.25, 4: 1.1, 5: 1.0, 6: 0.9 };

        const baseFontSize = this.config.baseFontSize ?? 10;
        const fontSize = baseFontSize * (scales[level] ?? 1);
        const lineHeight = this.config.lineHeight ?? 1.5;

        let text = this.extractText(node);
        text = text.replace(/---/g, "—").replace(/--/g, "—");

        const align = level === 1 ? "center" : "left";
        const baseFont = this.getFont(state, true);
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

        const hrGapBoostPt =
            typeof hrCfg?.gapBoostPt === "number"
                ? hrCfg.gapBoostPt
                : typeof hrCfg?.gap_boost_pt === "number"
                ? hrCfg.gap_boost_pt
                : 3;

        const hrGapBoostAfterPt =
            typeof hrCfg?.gapBoostAfterPt === "number"
                ? hrCfg.gapBoostAfterPt
                : typeof hrCfg?.gap_boost_after_pt === "number"
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
            /** @type {Record<number, number>} */
            const scales = {
                1: 2.0,
                2: 1.5,
                3: 1.25,
                4: 1.1,
                5: 1.0,
                6: 0.9
            };
            const base = this.config.baseFontSize ?? 10;
            const headingFontSize = base * (scales[level] ?? 1);

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
        // Use getTextContent() instead of accessing attrs.text
        let text =
            typeof node.getTextContent === "function"
                ? node.getTextContent()
                : /** @type {string} */ (node.attrs?.text) ?? "";

        if (text.length === 0) {
            return;
        }

        // Typography: convert double-dash sequences to em dash
        text = text.replace(/---/g, "—").replace(/--/g, "—");

        const page = /** @type {PdfPage} */ (state.currentPage);
        const builder = page.contentBuilder;
        const fontSize =
            node.textStyle?.fontSize ?? this.config.baseFontSize ?? 10;
        const bold = node.textStyle?.bold ?? false;
        const italic = node.textStyle?.italic ?? false;
        const underline = node.textStyle?.underline ?? false;
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

        const label =
            typeof node.attrs.runInLabel === "string"
                ? node.attrs.runInLabel
                : typeof node.attrs.run_in_label === "string"
                ? node.attrs.run_in_label
                : typeof node.attrs.runInLabelText === "string"
                ? node.attrs.runInLabelText
                : null;

        if (label) {
            const trimmed = label.trim();
            if (trimmed.length === 0) return null;

            const sep =
                typeof node.attrs.runInLabelSeparator === "string"
                    ? node.attrs.runInLabelSeparator
                    : typeof node.attrs.run_in_label_separator === "string"
                    ? node.attrs.run_in_label_separator
                    : typeof node.attrs.runInLabelSep === "string"
                    ? node.attrs.runInLabelSep
                    : " ";

            return { label: trimmed, sep: sep.length > 0 ? sep : " " };
        }

        // Continuation: indent content under a prior run-in label without reprinting the label.
        const continuationLabel =
            typeof node.attrs.runInLabelContinuationLabel === "string"
                ? node.attrs.runInLabelContinuationLabel
                : typeof node.attrs.run_in_label_continuation_label === "string"
                ? node.attrs.run_in_label_continuation_label
                : typeof node.attrs.runInLabelContinuationText === "string"
                ? node.attrs.runInLabelContinuationText
                : null;

        if (!continuationLabel) return null;

        const trimmed = continuationLabel.trim();
        if (trimmed.length === 0) return null;

        const sep =
            typeof node.attrs.runInLabelContinuationSep === "string"
                ? node.attrs.runInLabelContinuationSep
                : typeof node.attrs.run_in_label_continuation_sep === "string"
                ? node.attrs.run_in_label_continuation_sep
                : typeof node.attrs.runInLabelContinuationSeparator === "string"
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
            const parentLabel =
                typeof node.attrs.runInParentLabel === "string"
                    ? node.attrs.runInParentLabel
                    : typeof node.attrs.run_in_parent_label === "string"
                    ? node.attrs.run_in_parent_label
                    : null;
            if (parentLabel) {
                const parentSep =
                    typeof node.attrs.runInParentLabelSep === "string"
                        ? node.attrs.runInParentLabelSep
                        : typeof node.attrs.run_in_parent_label_sep === "string"
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
     * @returns {ReadonlyArray<{text: string; bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string}>}
     */
    buildInlineRuns(root) {
        /** @type {Array<{text: string; bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string}>} */
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
     * @param {Array<{text: string; bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string}>} out
     * @param {BaseNode} node
     * @param {{ bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string }} inherited
     * @returns {void}
     */
    collectInlineRunsInto(out, node, inherited) {
        if (node.type === "text") {
            let text =
                typeof node.getTextContent === "function"
                    ? node.getTextContent()
                    : /** @type {string} */ (node.attrs?.text) ?? "";
            if (text.length > 0) {
                const merged = this.mergeTextStyle(inherited, node.textStyle);
                if (!merged.monospace) {
                    text = text.replace(/---/g, "—").replace(/--/g, "—");
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

            let defText = this.extractText(node).trim();
            if (!inherited.monospace) {
                defText = defText.replace(/---/g, "—").replace(/--/g, "—");
            }

            const prefix =
                termText &&
                defText.length > 0 &&
                !defText.toLowerCase().startsWith("means")
                    ? " means "
                    : termText && defText.length > 0
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

            const bodyText = prefix + defText;
            if (bodyText.trim().length > 0) {
                out.push({
                    text: bodyText,
                    bold: false,
                    italic: inherited.italic,
                    underline: inherited.underline,
                    monospace: inherited.monospace,
                    color: inherited.color,
                    linkHref: inherited.linkHref
                });
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
                underline: true,
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

        if (typeof style.color === "string" && style.color.length > 0) {
            merged.color = style.color;
        }

        return merged;
    }

    /**
     * Render inline runs with word-wrapping.
     * Returns final Y position (already advanced to the next line after the last rendered line).
     *
     * @param {ReadonlyArray<{text: string; bold: boolean; italic: boolean; underline: boolean; monospace: boolean; color?: string; linkHref?: string}>} runs
     * @param {PdfBuildState} state
     * @param {string} sectionId
     * @param {number} x
     * @param {number} startY
     * @param {number} maxWidth
     * @param {number} fontSize
     * @param {number} lineHeight
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
        lineHeight
    ) {
        const linkColor = "#0000EE";

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

        for (let r = 0, rLen = runs.length; r < rLen; r++) {
            const run = runs[r];
            const tokens = this.tokenizeInlineText(run.text);

            const font = this.getFont(
                state,
                run.bold,
                run.italic,
                run.monospace
            );

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

                // Break long tokens if necessary
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
                            run,
                            linkColor
                        );

                        // Link annotation tracking
                        if (run.linkHref) {
                            if (
                                !pendingLink ||
                                pendingLink.href !== run.linkHref ||
                                pendingLink.y !== y
                            ) {
                                flushPendingLink();
                                pendingLink = {
                                    href: run.linkHref,
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
                    run,
                    linkColor
                );

                if (run.linkHref) {
                    if (
                        !pendingLink ||
                        pendingLink.href !== run.linkHref ||
                        pendingLink.y !== y
                    ) {
                        flushPendingLink();
                        pendingLink = {
                            href: run.linkHref,
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

        // Always advance at least one line for paragraphs (even if empty)
        if (!sawAnyContent) {
            advanceLine();
            return y;
        }

        // Move to the next line after the last rendered line
        advanceLine();
        return y;
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
     * @returns {number}
     */
    estimateInlineRunsLineCount(runs, state, maxWidth, fontSize) {
        let lines = 1;
        let cursorX = 0;

        for (let r = 0, rLen = runs.length; r < rLen; r++) {
            const run = runs[r];
            const font = this.getFont(
                state,
                run.bold,
                run.italic,
                run.monospace
            );
            const tokens = this.tokenizeInlineText(run.text);

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
     * @param {{ underline: boolean; color?: string; linkHref?: string }} run
     * @param {string} linkColor
     * @returns {void}
     */
    renderInlineToken(state, text, x, y, fontSize, font, run, linkColor) {
        const page = /** @type {PdfPage} */ (state.currentPage);
        const builder = page.contentBuilder;

        const color = run.linkHref ? linkColor : run.color;

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

        if (run.underline || run.linkHref) {
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
     * @returns {number} New x position
     */
    renderInlineChild(child, state, x, builder, fontSize) {
        const lineHeight = this.config.lineHeight ?? 1.5;

        if (child.type === "text") {
            const text =
                typeof child.getTextContent === "function"
                    ? child.getTextContent()
                    : /** @type {string} */ (child.attrs?.text) ?? "";

            const bold = child.textStyle?.bold ?? false;
            const italic = child.textStyle?.italic ?? false;
            const baseFont = this.getFont(state, bold, italic);

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

        if (child.type === "inline-format") {
            const formatType = /** @type {string} */ (child.attrs?.formatType);
            const bold = formatType === "bold";
            const italic = formatType === "italic";
            const underline = formatType === "underline";

            for (let i = 0, len = child.children.length; i < len; i++) {
                const grandchild = child.children[i];
                if (grandchild.type === "text") {
                    const text =
                        typeof grandchild.getTextContent === "function"
                            ? grandchild.getTextContent()
                            : /** @type {string} */ (grandchild.attrs?.text) ??
                              "";

                    const baseFont = this.getFont(state, bold, italic);

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
            const baseFont = this.getFont(state, false);

            // Render link text in blue with underline
            const linkColor = "#0000EE";
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
            this._normalizeTableVAlign(
                tableCfg.vertical_align ??
                    tableCfg.verticalAlign ??
                    tableCfg.cell_valign ??
                    tableCfg.cellVAlign
            ) ?? "top";

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
            tableCfg.cell_padding ?? tableCfg.cellPadding,
            defaultPad
        );
        const headerPadding =
            tableCfg.header &&
            (tableCfg.header.cell_padding !== undefined ||
                tableCfg.header.cellPadding !== undefined)
                ? this._normalizeBoxPadding(
                      tableCfg.header.cell_padding ??
                          tableCfg.header.cellPadding,
                      defaultPad
                  )
                : bodyPadding;

        const borderWidth =
            (tableCfg.border_width ?? tableCfg.borderWidth ?? 0.5) || 0.5;
        const borderColor = tableCfg.border_color ?? tableCfg.borderColor ?? 0;

        const headerBackground =
            tableCfg.header?.background_color ??
            tableCfg.header?.backgroundColor ??
            0.9;
        const headerTextColor =
            tableCfg.header?.text_color ?? tableCfg.header?.textColor;

        const zebraEnabled = this._isZebraEnabled(tableCfg, node);
        const zebraOdd =
            tableCfg.zebra?.odd_background ??
            tableCfg.zebra?.oddBackground ??
            1;
        const zebraEven =
            tableCfg.zebra?.even_background ??
            tableCfg.zebra?.evenBackground ??
            0.97;

        // Render caption if present
        if (node.attrs?.caption) {
            const caption = /** @type {string} */ (node.attrs.caption);
            const captionFont = this.getFont(state, true);
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
                    if (typeof col.width === "string") {
                        const width = parseInt(col.width);
                        const w = Number.isFinite(width) ? width : 0;
                        widths.push(w);
                        totalFixed += w;
                    } else {
                        widths.push(col.width);
                        totalFixed += col.width;
                    }
                } else if (col.widthType === "percent" && col.width) {
                    if (typeof col.width === "string") {
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

        const baseFont = this.getFont(state, !!isHeader);
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
                cell?.attrs?.style?.backgroundColor ??
                cell?.attrs?.style?.background_color ??
                undefined;

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
            const baseFont = this.getFont(state, isHeader);
            const fontName = this.getFontResourceName(state, baseFont);

            const align =
                /** @type {HorizontalAlign | undefined} */ (
                    cell?.attrs?.align
                ) ?? "left";

            const cellStyleTextColor =
                cell?.attrs?.style?.textColor ??
                cell?.attrs?.style?.text_color ??
                undefined;

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
        if (typeof value === "number") {
            return Number.isFinite(value) ? value : null;
        }
        if (typeof value === "string") {
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
            typeof columnCount === "number" && Number.isFinite(columnCount)
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
        const explicit = tableCfg.line_height ?? tableCfg.lineHeight;
        if (
            typeof explicit === "number" &&
            Number.isFinite(explicit) &&
            explicit > 0
        ) {
            return explicit;
        }

        const scale =
            tableCfg.line_height_scale ??
            tableCfg.lineHeightScale ??
            tableCfg.line_spacing_scale ??
            tableCfg.lineSpacingScale;

        if (typeof scale === "number" && Number.isFinite(scale) && scale > 0) {
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
        const explicit = tableCfg.font_size ?? tableCfg.fontSize;
        if (typeof explicit === "number" && Number.isFinite(explicit)) {
            return explicit;
        }

        const scale = tableCfg.font_size_scale ?? tableCfg.fontSizeScale ?? 1;
        let fs =
            typeof scale === "number" && Number.isFinite(scale)
                ? baseFontSize * scale
                : baseFontSize;

        const autoShrink =
            (tableCfg.auto_shrink ?? tableCfg.autoShrink ?? true) !== false;

        if (autoShrink) {
            if (avgColWidth < 80) fs *= 0.9;
            if (avgColWidth < 60) fs *= 0.85;
            if (avgColWidth < 45) fs *= 0.8;
        }

        const minFs = tableCfg.min_font_size ?? tableCfg.minFontSize ?? 7.5;
        const maxFs =
            tableCfg.max_font_size ?? tableCfg.maxFontSize ?? baseFontSize;

        if (typeof minFs === "number" && Number.isFinite(minFs)) {
            fs = Math.max(minFs, fs);
        }
        if (typeof maxFs === "number" && Number.isFinite(maxFs)) {
            fs = Math.min(maxFs, fs);
        }

        return fs;
    }

    /**
     * Normalize padding input into a box model.
     * @private
     * @param {number|{x?:number,y?:number,top?:number,right?:number,bottom?:number,left?:number}|undefined} value
     * @param {number} fallback
     * @returns {{top:number,right:number,bottom:number,left:number}}
     */
    _normalizeBoxPadding(value, fallback) {
        if (typeof fallback !== "number" || !Number.isFinite(fallback)) {
            fallback = 0;
        }

        if (typeof value === "number" && Number.isFinite(value)) {
            return { top: value, right: value, bottom: value, left: value };
        }

        if (value && typeof value === "object" && !Array.isArray(value)) {
            const v =
                /** @type {{x?:unknown,y?:unknown,top?:unknown,right?:unknown,bottom?:unknown,left?:unknown}} */ (
                    value
                );
            const x =
                typeof v.x === "number" && Number.isFinite(v.x)
                    ? v.x
                    : undefined;
            const y =
                typeof v.y === "number" && Number.isFinite(v.y)
                    ? v.y
                    : undefined;

            const top =
                typeof v.top === "number" && Number.isFinite(v.top)
                    ? v.top
                    : y ?? fallback;
            const bottom =
                typeof v.bottom === "number" && Number.isFinite(v.bottom)
                    ? v.bottom
                    : y ?? fallback;
            const left =
                typeof v.left === "number" && Number.isFinite(v.left)
                    ? v.left
                    : x ?? fallback;
            const right =
                typeof v.right === "number" && Number.isFinite(v.right)
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
        const rowBg = row.attrs?.backgroundColor ?? row.attrs?.background_color;
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
        if (typeof color === "number" && Number.isFinite(color)) {
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
        if (typeof color === "number" && Number.isFinite(color)) {
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
        const lineHeight = this.config.lineHeight ?? 1.5;

        const width = /** @type {number} */ (node.attrs?.width) ?? 200;
        const height = /** @type {number} */ (node.attrs?.height) ?? 150;
        const alt = /** @type {string} */ (node.attrs?.alt) ?? "";

        // Draw placeholder rectangle
        const x = state.margins.left + (state.contentWidth - width) / 2;
        const y = state.currentY - height;

        this.drawStrokedRect(builder, x, y, width, height, 1, 0.5);
        this._recordInkBottomY(state, y);

        // Draw X through placeholder
        builder
            .saveState()
            .setLineWidth(0.5)
            .setStrokeGray(0.7)
            .moveTo(x, state.currentY)
            .lineTo(x + width, y)
            .moveTo(x + width, state.currentY)
            .lineTo(x, y)
            .stroke()
            .restoreState();

        // Add alt text below
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

        text = text.replace(/---/g, "—").replace(/--/g, "—");

        const baseFont = this.getFont(state, false);

        // Render as blue underlined text
        const linkColor = "#0000EE";
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
            text = text.replace(/---/g, "—").replace(/--/g, "—");
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

        /** @type {Record<number, number>} */
        const scales = { 1: 2.0, 2: 1.5, 3: 1.25, 4: 1.1, 5: 1.0, 6: 0.9 };
        const baseFontSize = this.config.baseFontSize ?? 10;
        const fontSize = baseFontSize * (scales[level] ?? 1);
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

        text = text.replace(/---/g, "—").replace(/--/g, "—");

        const baseFont = this.getFont(state, true);
        const align = level === 1 ? "center" : "left";
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
        if (nodeId) {
            this.recordRenderedDestination(state, nodeId, state.currentY);
            this.recordTocCandidate(state, sectionId, nodeId, level, text);
        }

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
                align
            );

            state.currentY -= fontSize * lineHeight;
        }

        // Breathing room after headings
        state.currentY -= fontSize * 0.25;
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
        const sectionHrBehavior =
            typeof (/** @type {any} */ (sectionCfg)?.horizontalRuleBehavior) ===
            "string"
                ? /** @type {any} */ (sectionCfg)?.horizontalRuleBehavior
                : null;

        const hrBehavior =
            (typeof override === "string" && override.length > 0
                ? override
                : null) ??
            (typeof sectionHrBehavior === "string" &&
            sectionHrBehavior.length > 0
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
        const hrHeight =
            typeof hrCfg?.blockHeightPt === "number"
                ? hrCfg.blockHeightPt
                : typeof hrCfg?.block_height_pt === "number"
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
            const headingSize =
                type === "article" ? baseFontSize * 1.5 : baseFontSize * 1.25;
            const headingFont = this.getFont(state, true);

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

        const regularFont = this.getFont(state, false);
        const boldFont = this.getFont(state, true);

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
        const fontSize = this.config.baseFontSize ?? 10;
        const lineHeight = this.config.lineHeight ?? 1.5;
        const boxPadding = 10;

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

        // Move down for top padding PLUS text height (baseline offset)
        // Text renders from baseline upward, so we need extra space
        state.currentY -= boxPadding + fontSize * 0.8;

        // Render title if present
        if (title) {
            const titleFont = this.getFont(state, true);
            this.renderTextAt(
                builder,
                state,
                String(title).toUpperCase(),
                state.margins.left + boxPadding,
                state.currentY,
                fontSize,
                titleFont,
                "left"
            );
            state.currentY -= fontSize * lineHeight;
        }

        // Render children with padding
        const savedLeft = state.margins.left;
        const savedWidth = state.contentWidth;
        state.margins.left += boxPadding;
        state.contentWidth -= boxPadding * 2;

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
        state.currentY -= boxPadding;

        // If the notice split across pages, don't attempt to draw a single box.
        const endPage = /** @type {PdfPage} */ (state.currentPage);
        if (endPage !== startPage) {
            state.currentY -= fontSize * 0.5;
            return;
        }

        // Ensure box bottom doesn't extend into margin
        const boxBottomY = Math.max(
            state.currentY + boxPadding,
            state.margins.bottom + boxPadding
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
                1,
                0
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
        const page = /** @type {PdfPage} */ (state.currentPage);
        const builder = page.contentBuilder;
        const fontSize = this.config.baseFontSize ?? 10;
        const lineHeight = this.config.lineHeight ?? 1.5;

        state.currentY -= fontSize * 2;

        // Signature line
        const lineY = state.currentY;
        this.drawLine(
            builder,
            state.margins.left,
            lineY,
            state.margins.left + 200,
            0.5,
            0
        );

        state.currentY -= fontSize * lineHeight;

        // Name field
        const name = /** @type {string | undefined} */ (node.attrs?.name);
        if (name) {
            this.renderTextAt(
                builder,
                state,
                `Name: ${name}`,
                state.margins.left,
                state.currentY,
                fontSize,
                this.getFont(state, false),
                "left"
            );
            state.currentY -= fontSize * lineHeight;
        }

        // Title field
        const title = /** @type {string | undefined} */ (node.attrs?.title);
        if (title) {
            this.renderTextAt(
                builder,
                state,
                `Title: ${title}`,
                state.margins.left,
                state.currentY,
                fontSize,
                this.getFont(state, false),
                "left"
            );
            state.currentY -= fontSize * lineHeight;
        }

        // Date field
        this.renderTextAt(
            builder,
            state,
            "Date: _______________",
            state.margins.left,
            state.currentY,
            fontSize,
            this.getFont(state, false),
            "left"
        );
        state.currentY -= fontSize * lineHeight * 2;
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

        const layoutOverrides =
            signingConfig.layout &&
            typeof signingConfig.layout === "object" &&
            !Array.isArray(signingConfig.layout)
                ? signingConfig.layout
                : {};

        const labelColumnWidth =
            typeof layoutOverrides.labelColumnWidth === "number"
                ? layoutOverrides.labelColumnWidth
                : 86;
        const valueX = state.margins.left + labelColumnWidth;
        const signatureLineWidth = Math.min(
            typeof layoutOverrides.signatureLineWidth === "number"
                ? layoutOverrides.signatureLineWidth
                : 330,
            Math.max(140, state.contentWidth - labelColumnWidth - 4)
        );

        const signatureRowHeight =
            typeof layoutOverrides.signatureRowHeight === "number"
                ? layoutOverrides.signatureRowHeight
                : lineStep * 1.85;
        const rowHeight =
            typeof layoutOverrides.rowHeight === "number"
                ? layoutOverrides.rowHeight
                : lineStep * 1.15;
        const partyLabelGap =
            typeof layoutOverrides.partyLabelGap === "number"
                ? layoutOverrides.partyLabelGap
                : lineStep * 2.35;
        const rowGap =
            typeof layoutOverrides.rowGap === "number"
                ? layoutOverrides.rowGap
                : lineStep * 0.45;
        const blockGap =
            typeof layoutOverrides.blockGap === "number"
                ? layoutOverrides.blockGap
                : lineStep * 1.15;
        const partyGap =
            typeof layoutOverrides.partyGap === "number"
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
                typeof rowHeight === "number" ? rowHeight.toFixed(2) : rowHeight
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
                typeof signingConfig.executionNote === "string" ||
                ("execution_note" in signingConfig &&
                    typeof signingConfig.execution_note === "string")
            }`
        );
        this._trace(
            `  acknowledgmentTitle present=${
                typeof signingConfig.acknowledgmentTitle === "string" ||
                ("acknowledgment_title" in signingConfig &&
                    typeof signingConfig.acknowledgment_title === "string")
            }`
        );
        this._trace(
            `  acknowledgmentText present=${
                typeof signingConfig.acknowledgmentText === "string" ||
                ("acknowledgment_text" in signingConfig &&
                    typeof signingConfig.acknowledgment_text === "string")
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
            if (
                signatory &&
                typeof signatory === "object" &&
                signatory.values &&
                typeof signatory.values === "object" &&
                !Array.isArray(signatory.values)
            ) {
                const entries = Object.entries(signatory.values);
                for (let i = 0, len = entries.length; i < len; i++) {
                    const [k, v] = entries[i];
                    if (typeof k === "string" && typeof v === "string") {
                        out[k] = v;
                    }
                }
            }
            if (signatory && typeof signatory.name === "string") {
                out.Name = out.Name ?? signatory.name;
            }
            if (signatory && typeof signatory.title === "string") {
                out.Title = out.Title ?? signatory.title;
            }
            if (signatory && typeof signatory.date === "string") {
                out.Date = out.Date ?? signatory.date;
            }
            if (signatory && typeof signatory.by === "string") {
                out.By = out.By ?? signatory.by;
            }
            if (signatory && typeof signatory.signature === "string") {
                out.Signature = out.Signature ?? signatory.signature;
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
                    if (typeof v !== "string") continue;
                    const trimmed = v.trim();
                    if (trimmed.length === 0) continue;
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

        const witnessClauseTopGap =
            typeof layoutOverrides.witnessClauseTopGap === "number"
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

        const executionNote =
            typeof signingConfig.executionNote === "string"
                ? signingConfig.executionNote
                : "execution_note" in signingConfig &&
                  typeof signingConfig.execution_note === "string"
                ? signingConfig.execution_note
                : undefined;

        const witnessClauseBottomGap =
            typeof layoutOverrides.witnessClauseBottomGap === "number"
                ? layoutOverrides.witnessClauseBottomGap
                : lineStep * (executionNote ? 0.7 : 1.5);
        this._trace(
            `  witnessClause rendered: ${
                clauseLines.length
            } lines, topGap=${witnessClauseTopGap.toFixed(
                2
            )} bottomGap=${witnessClauseBottomGap.toFixed(2)} (override=${
                typeof layoutOverrides.witnessClauseBottomGap === "number"
            })`
        );
        state.currentY -= witnessClauseBottomGap;

        if (executionNote && executionNote.trim().length > 0) {
            const executionNoteTopGap =
                typeof layoutOverrides.executionNoteTopGap === "number"
                    ? layoutOverrides.executionNoteTopGap
                    : 0;
            this._trace(
                `  executionNote: topGap=${executionNoteTopGap.toFixed(
                    2
                )} (override=${
                    typeof layoutOverrides.executionNoteTopGap === "number"
                })`
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

            const executionNoteBottomGap =
                typeof layoutOverrides.executionNoteBottomGap === "number"
                    ? layoutOverrides.executionNoteBottomGap
                    : lineStep * 1.15;
            this._trace(
                `  executionNote: ${
                    wrappedNote.lines.length
                } lines, bottomGap=${executionNoteBottomGap.toFixed(
                    2
                )} (override=${
                    typeof layoutOverrides.executionNoteBottomGap === "number"
                })`
            );
            state.currentY -= executionNoteBottomGap;
        }

        const acknowledgmentTitle =
            typeof signingConfig.acknowledgmentTitle === "string"
                ? signingConfig.acknowledgmentTitle
                : "acknowledgment_title" in signingConfig &&
                  typeof signingConfig.acknowledgment_title === "string"
                ? signingConfig.acknowledgment_title
                : undefined;
        const acknowledgmentText =
            typeof signingConfig.acknowledgmentText === "string"
                ? signingConfig.acknowledgmentText
                : "acknowledgment_text" in signingConfig &&
                  typeof signingConfig.acknowledgment_text === "string"
                ? signingConfig.acknowledgment_text
                : undefined;

        const hasAcknowledgmentTitle =
            typeof acknowledgmentTitle === "string" &&
            acknowledgmentTitle.trim().length > 0;
        const hasAcknowledgmentText =
            typeof acknowledgmentText === "string" &&
            acknowledgmentText.trim().length > 0;

        if (hasAcknowledgmentTitle || hasAcknowledgmentText) {
            const acknowledgmentTopGap =
                typeof layoutOverrides.acknowledgmentTopGap === "number"
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
            const acknowledgmentBottomGap =
                typeof layoutOverrides.acknowledgmentBottomGap === "number"
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
                )} (override=${
                    typeof layoutOverrides.acknowledgmentBottomGap === "number"
                })`
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
                party.label,
                state.margins.left,
                state.currentY,
                fontSize * 1.1,
                boldFont,
                "left"
            );
            state.currentY -= partyLabelGap;

            for (let si = 0, slen = party.signatories.length; si < slen; si++) {
                const signatory = party.signatories[si];
                const sigBuilder = /** @type {PdfPage} */ (state.currentPage)
                    .contentBuilder;
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
                            typeof rowBoxHeight === "number"
                                ? rowBoxHeight.toFixed(2)
                                : rowBoxHeight
                        } Y=${state.currentY.toFixed(1)}`
                    );
                    ensurePageSpace(minNeeded + lineStep * 0.2, party.label);

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

                    this.drawLine(
                        sigBuilder,
                        valueX + lineInsetLeft,
                        lineY,
                        valueX + signatureLineWidth - lineInsetRight,
                        lineThickness,
                        signatureField ? 0 : 0.5
                    );

                    const printed = getFieldValue(signatoryValues, fieldLabel);
                    if (
                        typeof printed === "string" &&
                        printed.trim().length > 0
                    ) {
                        const printedText = printed.trim();
                        const printedDescent = this._estimateTextDescentPt(
                            printedText,
                            fontSize
                        );
                        const printedBaselineY =
                            lineY +
                            printedDescent +
                            Math.max(1.3, fontSize * 0.1);

                        this.renderTextAt(
                            sigBuilder,
                            state,
                            printedText,
                            valueX + lineInsetLeft + 2,
                            printedBaselineY,
                            fontSize,
                            regularFont,
                            "left"
                        );
                    }

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

        // Compute totalPages excluding cover (if suppressed) and signing pages
        let coverExcluded = false;
        let signingPageCount = 0;
        for (let i = 0, len = state.pages.length; i < len; i++) {
            const page = state.pages[i];
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

        /*
        console.log(`Header/Footer Location: ${location}`);
        console.log(`state.pageHeight: ${state.pageHeight}`);
        console.log(`state.baseMargins.top: ${state.baseMargins.top}`);
        console.log(`state.baseMargins.bottom: ${state.baseMargins.bottom}`);
        console.log(`offset: ${offset}`);
        console.log(`fontSize: ${fontSize}`);
        console.log(`y value: ${y}`);
        */

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
                typeof style.color === "string" && style.color.length > 0
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

            //console.log("Border lineY:", lineY);

            this.drawLine(
                builder,
                state.baseMargins.left,
                lineY,
                state.pageWidth - state.baseMargins.right,
                config.border.width ?? 0.5,
                0
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

            // Track section boundaries by mapping section IDs to their index
            /** @type {Map<string, number>} */
            const sectionIdxMap = new Map();
            for (let i = 0, len = sections.length; i < len; i++) {
                sectionIdxMap.set(sections[i].id, i);
            }

            // Group layout entries by section and find section start pages
            /** @type {Map<number, { page: number; entries: typeof layout.tocEntries }>} */
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
                    /** @type {any} */ (toc.entries).push({
                        nodeId: le.nodeId,
                        level: le.level + levelOffset,
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
            // Fallback to checking method existence for safety
            return typeof node.getTextContent === "function"
                ? node.getTextContent()
                : /** @type {string} */ (node.attrs?.text) ?? "";
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
                // HeadingNode stores level as direct property
                const level =
                    /** @type {any} */ (node).level ?? node.attrs?.level ?? 1;
                const sizeScale =
                    level === 1
                        ? 1.8
                        : level === 2
                        ? 1.5
                        : level === 3
                        ? 1.2
                        : 1.0;
                const fontSize = baseFontSize * sizeScale;
                return fontSize * lineHeight;
            }

            case "text": {
                const font = this.getFont(state, false);
                const text =
                    typeof node.getTextContent === "function"
                        ? node.getTextContent()
                        : "";
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
                const hrHeight =
                    typeof hrCfg?.blockHeightPt === "number"
                        ? hrCfg.blockHeightPt
                        : typeof hrCfg?.block_height_pt === "number"
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
                // Signatures have more vertical space
                return baseFontSize * 4;
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
