/**
 * Enhanced types for Format AST document system
 * Supports legal documents, multi-document composition, advanced headers/footers
 * Enhanced with link destinations for internal links
 * @module format-ast/core/types
 */

/** @typedef {import("../../types/general.mjs").Metadata} Metadata */

// =============================================================================
// Node Categories & Types
// =============================================================================

/** @typedef {"base" | "prose" | "tabular" | "legal" | "composite"} NodeCategory */

/**
 * Base node types - understood by all renderers
 * @typedef {"text" | "container" | "break"} BaseNodeType
 */

/**
 * Prose node types - document-oriented content
 * @typedef {"heading" | "paragraph" | "list" | "list-item" | "blockquote" | "code-block" | "horizontal-rule" | "image" | "link" | "inline-format" | "notice"} ProseNodeType
 */

/**
 * Tabular node types - data-oriented content
 * @typedef {"table" | "row" | "cell" | "header-row" | "header-cell"} TabularNodeType
 */

/**
 * Legal node types - legal document structures
 * @typedef {"article" | "section" | "clause" | "definition" | "recital" | "signature-block" | "signatory" | "notice" | "schedule" | "exhibit"} LegalNodeType
 */

/**
 * Composite node types - document composition structures
 * @typedef {"cover-page" | "toc" | "toc-entry" | "document-group" | "section-break" | "mixed-content"} CompositeNodeType
 */

/**
 * All node types
 * @typedef {BaseNodeType | ProseNodeType | TabularNodeType | LegalNodeType | CompositeNodeType} NodeType
 */

// =============================================================================
// Alignment & Layout
// =============================================================================

/**
 * @typedef {"left" | "center" | "right" | "justify"} HorizontalAlign
 */

/**
 * @typedef {"top" | "middle" | "bottom"} VerticalAlign
 */

/**
 * @typedef {Object} Padding
 * @property {number} [top]
 * @property {number} [right]
 * @property {number} [bottom]
 * @property {number} [left]
 */

/**
 * @typedef {Object} Margins
 * @property {number} [top]
 * @property {number} [right]
 * @property {number} [bottom]
 * @property {number} [left]
 */

// =============================================================================
// Keep/Break Rules
// =============================================================================

/**
 * @typedef {Object} KeepRules
 * @property {boolean} [keepTogether] - Keep this entire block on same page
 * @property {boolean} [keepWithNext] - Keep with the following sibling node
 * @property {boolean} [keepWithPrevious] - Keep with the preceding sibling node
 * @property {boolean} [pageBreakBefore] - Force page break before this node
 * @property {boolean} [pageBreakAfter] - Force page break after this node
 * @property {number} [minOrphanLines] - Minimum lines to keep at bottom of page (orphan control)
 * @property {number} [minWidowLines] - Minimum lines to keep at top of page (widow control)
 * @property {number} [maxKeepTogetherHeight] - If block exceeds this height (points), allow split
 */

// =============================================================================
// Spacing Policy (context-aware vertical rhythm)
// =============================================================================

/**
 * @typedef {Object} VerticalSpacingRule
 * @property {NodeType | ReadonlyArray<NodeType> | "*" | null} [prev] - Previous sibling type (null = start of container)
 * @property {NodeType | ReadonlyArray<NodeType> | "*" | null} [next] - Current node type
 * @property {number} [em] - Spacing in em (multiplied by base font size)
 * @property {number} [pt] - Spacing in points (overrides em)
 * @property {number} [priority] - Higher priority wins when multiple rules match
 */

/**
 * Vertical spacing policy applied during layout.
 *
 * The PDF renderer currently resolves **spacing before** a node (i.e. the gap inserted
 * between previous sibling and current node). The policy is intentionally flexible to
 * support multiple schema styles (camelCase/snake_case and legacy keys).
 *
 * @typedef {Object} SpacingPolicy
 *
 * // Pair rules (context-aware): "if X follows Y then spacing is ..."
 * @property {ReadonlyArray<VerticalSpacingRule>} [beforeRules] - Preferred field for pair rules.
 * @property {ReadonlyArray<VerticalSpacingRule>} [before_rules] - Snake_case alias for beforeRules.
 * @property {ReadonlyArray<VerticalSpacingRule>} [before] - Alias for beforeRules.
 * @property {ReadonlyArray<VerticalSpacingRule>} [rules] - Alias for beforeRules.
 * @property {ReadonlyArray<VerticalSpacingRule>} [verticalSpacingRules] - Alias for beforeRules.
 * @property {ReadonlyArray<VerticalSpacingRule>} [vertical_spacing_rules] - Snake_case alias for verticalSpacingRules.
 *
 * // Per-type defaults (context-free): applied when no pair rule matches.
 * @property {Readonly<Record<string, number>>} [defaultBeforeEmByType] - Preferred per-type defaults, value in em.
 * @property {Readonly<Record<string, number>>} [default_before_em_by_type] - Snake_case alias for defaultBeforeEmByType.
 * @property {Readonly<Record<string, number>>} [defaultBefore] - Alias for defaultBeforeEmByType (em).
 * @property {Readonly<Record<string, number>>} [default_before] - Snake_case alias for defaultBefore.
 * @property {Readonly<Record<string, number>>} [defaultEmByType] - Alias for defaultBeforeEmByType (em).
 * @property {Readonly<Record<string, number>>} [default_em_by_type] - Snake_case alias for defaultEmByType.
 */

// =============================================================================
// Text & Box Styles
// =============================================================================

/**
 * @typedef {Object} TextStyle
 * @property {string} [fontFamily]
 * @property {number} [fontSize] - In points
 * @property {boolean} [bold]
 * @property {boolean} [italic]
 * @property {boolean} [underline]
 * @property {boolean} [strikethrough]
 * @property {boolean} [monospace] - Use monospace font
 * @property {string} [color] - Hex color
 * @property {string} [backgroundColor]
 * @property {HorizontalAlign} [align]
 * @property {number} [lineHeight] - Multiplier
 * @property {number} [letterSpacing]
 * @property {"none" | "uppercase" | "lowercase" | "capitalize"} [textTransform]
 */

/**
 * @typedef {Object} BorderStyle
 * @property {number} [width]
 * @property {"solid" | "dashed" | "dotted" | "double"} [style]
 * @property {string} [color]
 */

/**
 * @typedef {Object} BoxStyle
 * @property {BorderStyle} [borderTop]
 * @property {BorderStyle} [borderRight]
 * @property {BorderStyle} [borderBottom]
 * @property {BorderStyle} [borderLeft]
 * @property {string} [titleColor]
 * @property {number} [borderWidth]
 * @property {string} [borderColor]
 * @property {string} [backgroundColor]
 * @property {Padding} [padding]
 * @property {Margins} [margin]
 */

// =============================================================================
// Cell & Table Specifics
// =============================================================================

/**
 * @typedef {Object} CellStyle
 * @property {TextStyle} [text]
 * @property {BoxStyle} [box]
 *
 * // Convenience aliases used by the PDF table renderer (and some packs)
 * @property {string | number} [backgroundColor]
 * @property {string | number} [background_color]
 * @property {string | number} [textColor]
 * @property {string | number} [text_color]
 * @property {HorizontalAlign} [align]
 * @property {VerticalAlign} [verticalAlign]
 * @property {number} [colspan]
 * @property {number} [rowspan]
 * @property {boolean} [wrap]
 * @property {string} [numberFormat] - For spreadsheet renderers
 */

/**
 * @typedef {Object} ColumnDef
 * @property {string} [id]
 * @property {string} [header]
 * @property {number|string} [width] - In points or percentage
 * @property {"fixed" | "auto" | "percent"} [widthType]
 * @property {HorizontalAlign} [align]
 * @property {string} [numberFormat]
 */

// =============================================================================
// PDF Table Rendering Configuration
// =============================================================================

/**
 * PDF table rendering config. All numeric sizes are in PDF points unless stated.
 *
 * Colors accept:
 * - grayscale number 0..1
 * - hex string "#RRGGBB" (or "RRGGBB")
 * - "none" to suppress a fill/stroke
 *
 * @typedef {Object} TableRenderConfig
 * @property {number} [font_size] - Explicit table font size
 * @property {number} [fontSize] - CamelCase alias
 * @property {number} [font_size_scale] - Multiplier applied to baseFontSize
 * @property {number} [fontSizeScale] - CamelCase alias
 * @property {number} [min_font_size] - Minimum table font size
 * @property {number} [minFontSize] - CamelCase alias
 * @property {number} [max_font_size] - Maximum table font size
 * @property {number} [maxFontSize] - CamelCase alias
 * @property {boolean} [auto_shrink] - Auto shrink font for narrow columns
 * @property {boolean} [autoShrink] - CamelCase alias
 * @property {number} [line_height] - Overrides renderer lineHeight for tables
 * @property {number} [lineHeight] - CamelCase alias
 * @property {number|{x?:number,y?:number,top?:number,right?:number,bottom?:number,left?:number}} [cell_padding]
 * @property {number|{x?:number,y?:number,top?:number,right?:number,bottom?:number,left?:number}} [cellPadding]
 * @property {number} [border_width]
 * @property {number} [borderWidth]
 * @property {string|number} [border_color]
 * @property {string|number} [borderColor]
 * @property {VerticalAlign} [vertical_align]
 * @property {VerticalAlign} [verticalAlign]
 * @property {VerticalAlign} [cell_valign]
 * @property {VerticalAlign} [cellVAlign]
 * @property {number} [line_height_scale]
 * @property {number} [lineHeightScale]
 * @property {number} [line_spacing_scale]
 * @property {number} [lineSpacingScale]
 * @property {{
 *  background_color?: string|number;
 *  backgroundColor?: string|number;
 *  text_color?: string|number;
 *  textColor?: string|number;
 *  cell_padding?: number|{x?:number,y?:number,top?:number,right?:number,bottom?:number,left?:number};
 *  cellPadding?: number|{x?:number,y?:number,top?:number,right?:number,bottom?:number,left?:number};
 * }} [header]
 * @property {{
 *  enabled?: boolean;
 *  odd_background?: string|number;
 *  oddBackground?: string|number;
 *  even_background?: string|number;
 *  evenBackground?: string|number;
 * }} [zebra]
 */

// =============================================================================
// Page Configuration
// =============================================================================

/**
 * @typedef {"letter" | "legal" | "a4" | "a3" | "tabloid"} PageSize
 */

/** @typedef {"portrait" | "landscape"} PageOrientation */

/**
 * @typedef {Object} PageDimensions
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} PageConfig
 * @property {PageSize} [size]
 * @property {PageOrientation} [orientation]
 * @property {Margins} [margins]
 * @property {number} [width] - Custom width in points (overrides size)
 * @property {number} [height] - Custom height in points (overrides size)
 */

// =============================================================================
// Enhanced Header/Footer System
// =============================================================================

/**
 * Page selector predicate function
 * @callback PageSelectorPredicate
 * @param {number} page - Current page number
 * @param {number} total - Total pages
 * @param {number} sectionPage - Current page within section
 * @param {number} sectionTotal - Total pages in section
 * @returns {boolean}
 */

/**
 * Page selector - determines which pages get a header/footer config
 * - "all": All pages
 * - "first": Only first page of section/document
 * - "not-first": All except first page
 * - "last": Only last page
 * - "not-last": All except last page
 * - "odd": Odd-numbered pages (1, 3, 5...)
 * - "even": Even-numbered pages (2, 4, 6...)
 * - "section-first": First section
 * - "section-not-first": Sections that are not first
 * - number[]: Specific page numbers
 * - Function: Custom predicate (page, total, sectionPage, sectionTotal) => boolean
 * @typedef {"all" | "first" | "not-first" | "last" | "not-last" | "odd" | "even" | "section-first" | "section-not-first" | ReadonlyArray<number> | PageSelectorPredicate} PageSelector
 */

/**
 * Content that can appear in a header/footer cell
 * @typedef {string | VariableRef | ReadonlyArray<string | VariableRef>} HeaderFooterContent
 */

/**
 * Single element in a header/footer (left, center, or right column)
 * @typedef {Object} HeaderFooterElement
 * @property {HeaderFooterContent} content
 * @property {TextStyle} [style]
 */

/**
 * Tri-column header/footer configuration
 * Supports left | center | right on same line
 * @typedef {Object} TriColumnHeaderFooter
 * @property {HeaderFooterElement} [left]
 * @property {HeaderFooterElement} [center]
 * @property {HeaderFooterElement} [right]
 */

/**
 * @typedef {"header" | "footer"} HeaderFooterLocation
 */

/**
 * Full header or footer configuration with page selector
 * @typedef {Object} HeaderFooterConfig
 * @property {HeaderFooterLocation} location
 * @property {PageSelector} pages - Which pages this config applies to
 * @property {TriColumnHeaderFooter} columns - Tri-column content
 * @property {number} [height] - Height in points (default: auto-calculated)
 * @property {BorderStyle} [border] - Border below header / above footer
 * @property {number} [spacing] - Extra spacing from content area
 * @property {number} [priority] - Priority when multiple configs match (higher wins)
 */

/**
 * @typedef {Object} HeaderFooterColumnConfig
 * @property {string | VariableRef | ReadonlyArray<string | VariableRef>} content
 * @property {{ fontSize?: number; bold?: boolean }} [style]
 */

/**
 * Shape of the class all Node AST types follow
 *
 * @typedef  {Object}  BaseNode
 * @property {NodeType} type
 * @property {string} id
 * @property {NodeCategory} category
 * @property {BaseNode[]} children
 * @property {Metadata} attrs
 * @property {KeepRules|undefined} keepRules
 * @property {TextStyle|undefined} textStyle
 * @property {BoxStyle|undefined} boxStyle
 *
 * @property {(type: NodeType) => boolean} isType
 * @property {(category: NodeCategory) => boolean} isCategory
 * @property {() => boolean} canHaveChildren
 * @property {() => boolean} isBlock
 * @property {() => boolean} isInline
 *
 * @property {(child: BaseNode) => BaseNode} appendChild
 * @property {(children: BaseNode[]) => BaseNode} appendChildren
 * @property {(index: number, child: BaseNode) => BaseNode} insertChild
 * @property {(index: number) => (BaseNode|undefined)} removeChildAt
 * @property {(child: BaseNode) => boolean} removeChild
 * @property {() => BaseNode} clearChildren
 * @property {() => boolean} hasChildren
 * @property {() => number} childCount
 * @property {() => (BaseNode|undefined)} firstChild
 * @property {() => (BaseNode|undefined)} lastChild
 *
 * @property {(key: string, value: unknown) => BaseNode} setAttr
 * @property {<T>(key: string, defaultValue?: T) => (T|unknown)} getAttr
 * @property {(key: string) => boolean} hasAttr
 * @property {(key: string) => BaseNode} removeAttr
 *
 * @property {(rules: KeepRules) => BaseNode} setKeepRules
 * @property {(style: TextStyle) => BaseNode} setTextStyle
 * @property {(style: BoxStyle) => BaseNode} setBoxStyle
 *
 * @property {(visitor: (node: BaseNode, depth: number, index: number) => (boolean|void), depth?: number, index?: number) => boolean} walk
 * @property {(predicate: (node: BaseNode) => boolean) => BaseNode[]} findAll
 * @property {(predicate: (node: BaseNode) => boolean) => (BaseNode|undefined)} findFirst
 * @property {(id: string) => (BaseNode|undefined)} findById
 * @property {(type: NodeType) => BaseNode[]} findByType
 * @property {(category: NodeCategory) => BaseNode[]} findByCategory
 *
 * @property {(visitor: (node: BaseNode) => (BaseNode|BaseNode[]|null)) => (BaseNode|null)} transform
 * @property {() => BaseNode} cloneShallow
 * @property {() => BaseNode} clone
 * @property {() => Metadata} toJSON
 * @property {() => string} getTextContent
 */

// =============================================================================
// Section Configuration (for multi-section documents)
// =============================================================================

/** @typedef {"arabic" | "roman" | "roman-upper" | "alpha" | "alpha-upper"} PageNumberStyle */

/** @typedef {"always" | "part-only"} BreakMode */

/**
 * @typedef {Object} SectionConfig
 * @property {string} id
 * @property {string | string[]} [name]
 * @property {PageConfig} [pageConfig] - Page configuration for this section
 * @property {ReadonlyArray<HeaderFooterConfig>} [headers] - Headers for this section
 * @property {ReadonlyArray<HeaderFooterConfig>} [footers] - Footers for this section
 * @property {PageNumberStyle} [pageNumberStyle] - Page numbering style
 * @property {boolean} [restartPageNumbers] - Restart page numbering at 1 for this section
 * @property {number} [startPageNumber] - Start page number (if restarting)
 * @property {boolean} [startsNewPage] - Whether this section starts on a new page
 * @property {boolean} [startsOddPage] - Whether this section starts on odd page (for book layouts)
 * @property {BreakMode | null} [breakMode] - Breakmode overrides for this section if present
 */

// =============================================================================
// Cover Page Configuration
// =============================================================================

// =============================================================================
// CoverPageElement Variants (discriminated on `type`)
// =============================================================================

/**
 * @typedef {Object} CoverPageTextElement
 * @property {"text"} type
 * @property {number} [startFrac]
 * @property {number} [endFrac]
 * @property {string | VariableRef} [content]
 * @property {TextStyle} [style]
 * @property {number} [height]
 * @property {VerticalAlign} [verticalAlign]
 */

/**
 * @typedef {Object} CoverPageTitleBlockElement
 * @property {"title-block"} type
 * @property {TextStyle} [style]
 * @property {number} [height]
 * @property {VerticalAlign} [verticalAlign]
 * @property {string} [title]
 * @property {string} [conjunction]
 * @property {string} [entityName]
 * @property {number} [subtitleFontSize]
 * @property {number} [entityFontSize]
 */

/**
 * @typedef {Object} CoverPageImageElement
 * @property {"image"} type
 * @property {string | VariableRef} [content]
 * @property {BoxStyle} [style]
 * @property {number} [height]
 * @property {VerticalAlign} [verticalAlign]
 */

/**
 * @typedef {Object} CoverPageSpacerElement
 * @property {"spacer"} type
 * @property {number} [height]
 */

/**
 * @typedef {Object} CoverPageRuleElement
 * @property {"rule"} type
 * @property {TextStyle} [style]
 * @property {string} [stroke]
 * @property {number} [startFrac]
 * @property {number} [endFrac]
 * @property {number} [lineWidth]
 * @property {number} [gray]
 * @property {string} [color]
 * @property {number} [afterSpacer]
 */

/**
 * @typedef {Object} CoverPageKvBlockElement
 * @property {"kv-block"} type
 * @property {TextStyle} [style]
 * @property {number} [height]
 * @property {number} [startFrac]
 * @property {number} [endFrac]
 * @property {VerticalAlign} [verticalAlign]
 * @property {ReadonlyArray<{ label: string, value: string | VariableRef }>} [rows]
 * @property {CoverBlockAlign} [labelAlign]
 * @property {number} [columnGap]
 * @property {number} [lineSpacer]
 * @property {string} [separator]
 */

/**
 * @typedef {Object} CoverPageBoxElement
 * @property {"box"} type
 * @property {number} [startFrac]
 * @property {number} [endFrac]
 * @property {number} [lineWidth]
 * @property {string} [stroke]
 * @property {string} [borderColor]
 * @property {string | VariableRef} [content]
 * @property {BoxStyle} [style]
 * @property {number} [height]
 * @property {VerticalAlign} [verticalAlign]
 * @property {number} [afterSpacer]
 */

/**
 * @typedef {CoverPageTextElement | CoverPageTitleBlockElement | CoverPageImageElement | CoverPageSpacerElement | CoverPageRuleElement | CoverPageKvBlockElement | CoverPageBoxElement} CoverPageElement
 */

/**
 * @typedef {Object} CoverPageOptions
 * @property {{ enabled?: boolean, text?: string, gray?: number, angleDeg?: number, fontSize?: number }} [watermark]
 * @property {boolean} [suppressHeader] - Suppress header on cover page
 * @property {boolean} [suppressFooter] - Suppress footer on cover page
 * @property {boolean} [suppressPageNumbering] - Suppress page numbering on cover page
 * @property {boolean} [reserveHeaderFooterSpace] - Reserve header/footer vertical space even when suppressed
 */

/**
 * @typedef {Object} CoverPageConfig
 * @property {ReadonlyArray<CoverPageElement>} elements - Elements to render on cover page (top to bottom)
 * @property {PageConfig} [pageConfig] - Page configuration for cover page
 * @property {boolean} [countsInPageNumbers] - Whether cover page counts in page numbering
 * @property {string} [backgroundColor] - Background color
 * @property {CoverPageOptions} [options] - Cover page rendering options (watermark, header/footer suppression)
 */

// =============================================================================
// Table of Contents Configuration
// =============================================================================

/**
 * @typedef {Object} TocEntryStyle
 * @property {number} level
 * @property {TextStyle} [textStyle]
 * @property {number} [indent]
 * @property {boolean} [showPageNumber]
 * @property {"dots" | "dashes" | "line" | "none"} [leaderStyle]
 */

/**
 * @typedef {Object} TocConfig
 * @property {string} [title]
 * @property {TextStyle} [titleStyle]
 * @property {ReadonlyArray<number>} [levels] - Which heading levels to include (default: [1, 2, 3])
 * @property {ReadonlyArray<TocEntryStyle>} [entryStyles] - Styles for each level
 * @property {SectionConfig} [sectionConfig] - Section config for TOC pages
 * @property {boolean} [showPageNumbers] - Include page numbers
 * @property {PageNumberStyle} [pageNumberStyle] - Page number format
 * @property {Object[]} [sectionDocuments]
 */

// =============================================================================
// Document Metadata
// =============================================================================

/**
 * @typedef {Object} DocumentMeta
 * @property {string} [title]
 * @property {string} [author]
 * @property {string} [subject]
 * @property {string} [creator]
 * @property {string} [createdAt]
 * @property {string} [modifiedAt]
 * @property {string} [language]
 * @property {Readonly<Record<string, string>>} [custom]
 */

/**
 * @typedef {Object} LegalDocumentMeta
 * @property {string} [jurisdiction]
 * @property {string} [governingLaw]
 * @property {string} [effectiveDate]
 * @property {string} [executionDate]
 * @property {string} [version]
 * @property {"draft" | "review" | "final" | "executed" | "amended"} [status]
 * @property {ReadonlyArray<string>} [parties]
 */

// =============================================================================
// Variables & References
// =============================================================================

/**
 * @typedef {Object} VariableRef
 * @property {"variable"} type
 * @property {string} name - Variable name (e.g., "page", "totalPages", "title")
 * @property {string} [format] - Optional format string
 */

/**
 * @typedef {Object} CrossRef
 * @property {"cross-ref"} type
 * @property {string} targetId - ID of target node
 * @property {"page" | "number" | "title" | "text"} [refType]
 */

// =============================================================================
// Link Types
// =============================================================================

/**
 * Link destination for internal navigation
 * @typedef {Object} LinkDestination
 * @property {string} nodeId - Target node ID
 * @property {number} page - Page number (1-indexed)
 * @property {number} y - Y position on page (from bottom, PDF coordinates)
 */

/**
 * Link annotation for PDF
 * @typedef {Object} LinkAnnotation
 * @property {"internal" | "external"} type
 * @property {number} x - Left edge of link rectangle
 * @property {number} y - Bottom edge of link rectangle
 * @property {number} width - Width of link rectangle
 * @property {number} height - Height of link rectangle
 * @property {string} [targetNodeId] - For internal links
 * @property {number} [targetPage] - For internal links (resolved page number)
 * @property {number} [targetY] - For internal links: destination Y coordinate (PDF coords from bottom; used with /XYZ)
 * @property {string} [url] - For external links
 */

// =============================================================================
// Render Capabilities
// =============================================================================

/**
 * Capabilities a renderer can declare
 * @typedef {Object} RenderCapabilities
 * @property {boolean} [supportsInlineFormatting]
 * @property {boolean} [supportsTables]
 * @property {boolean} [supportsImages]
 * @property {boolean} [supportsHeadersFooters]
 * @property {boolean} [supportsPageBreaks]
 * @property {boolean} [supportsFormulas]
 * @property {boolean} [supportsMultipleSheets]
 * @property {boolean} [supportsHyperlinks]
 * @property {boolean} [supportsColors]
 * @property {boolean} [supportsBorders]
 * @property {boolean} [supportsTwoPass]
 * @property {NodeType[]} [supportedNodeTypes]
 */

// =============================================================================
// Render Context
// =============================================================================

/**
 * @typedef {Object} RenderContext
 * @property {number} pageNumber - Current page number (global)
 * @property {number} totalPages - Total pages (global) - only available in second pass
 * @property {number} sectionPageNumber - Current section page number
 * @property {number} sectionTotalPages - Total pages in current section - only available in second pass
 * @property {string} sectionId - Current section ID
 * @property {Readonly<Record<string, string | number>>} variables - Document variables
 * @property {ReadonlyMap<string, number>} nodePageMap - Map of node ID to page number (built during first pass)
 * @property {RenderCapabilities} capabilities - Renderer capabilities
 * @property {boolean} isSecondPass - Whether this is the second pass (page numbers available)
 */

// =============================================================================
// Render Result
// =============================================================================

/**
 * @typedef {Object} RenderResult
 * @property {boolean} success
 * @property {Uint8Array | null} output
 * @property {string} mimeType
 * @property {ReadonlyArray<string>} warnings
 * @property {ReadonlyArray<string>} errors
 * @property {number} pageCount
 */

// =============================================================================
// Layout Result Types (from first pass)
// =============================================================================

/**
 * @typedef {Object} LayoutBlock
 * @property {string} nodeId
 * @property {NodeType} type
 * @property {number} height - Calculated height in points
 * @property {number} startPage - Page this block starts on
 * @property {number} endPage - Page this block ends on
 * @property {number} startY - Y position on start page
 * @property {KeepRules} [keepRules] - Keep rules that were applied
 * @property {boolean} [wasSplit] - Was this block split across pages?
 * @property {ReadonlyArray<LayoutBlock>} [children] - Child blocks (if container)
 */

/**
 * @typedef {Object} SectionLayoutInfo
 * @property {string} id
 * @property {number} startPage
 * @property {number} endPage
 * @property {number} pageCount
 */

/**
 * @typedef {Object} TocLayoutEntry
 * @property {string} nodeId
 * @property {number} level
 * @property {string} title
 * @property {number} page
 */

/**
 * @typedef {Object} LayoutResult
 * @property {number} totalPages
 * @property {ReadonlyArray<LayoutBlock>} blocks
 * @property {ReadonlyMap<string, number>} nodePageMap
 * @property {ReadonlyArray<SectionLayoutInfo>} sections - Section boundaries
 * @property {TocLayoutEntry[]} tocEntries - TOC entries discovered during layout
 * @property {ReadonlyArray<LinkDestination>} [linkDestinations] - All link destinations for internal linking
 */

/**
 * @typedef {Object} TocLevelStyle
 * @property {number} [fontSizeScale] - Scale relative to base font size (e.g., 1.0, 0.92, 0.85)
 * @property {boolean} [bold]
 * @property {number} [indent] - Indent in points
 * @property {number} [spacingBefore] - Line height multiplier for spacing before entry
 * @property {number} [spacingAfter] - Line height multiplier for spacing after entry
 */

// =============================================================================
// Document Composition Types
// =============================================================================

/**
 * @typedef {Object} CompositeDocumentConfig
 * @property {CoverPageConfig} [coverPage]
 * @property {TocConfig} [toc]
 * @property {ReadonlyArray<SectionConfig>} sections
 * @property {PageConfig} [defaultPageConfig] - Default page config for sections without one
 * @property {ReadonlyArray<HeaderFooterConfig>} [defaultHeaders] - Default headers for sections without them
 * @property {ReadonlyArray<HeaderFooterConfig>} [defaultFooters] - Default footers for sections without them
 */

// =============================================================================
// Special Nodes for Composed Documents
// =============================================================================
// =============================================================================
// ResolvedCoverPageElement Variants (discriminated on `type`)
// =============================================================================

/**
 * @typedef {Object} ResolvedCoverPageTextElement
 * @property {"text"} type
 * @property {number} [startFrac]
 * @property {number} [endFrac]
 * @property {string} [content]
 * @property {TextStyle} [style]
 * @property {number} [height]
 * @property {VerticalAlign} [verticalAlign]
 */

/**
 * @typedef {Object} ResolvedCoverPageTitleBlockElement
 * @property {"title-block"} type
 * @property {TextStyle} [style]
 * @property {number} [height]
 * @property {VerticalAlign} [verticalAlign]
 * @property {string} [title]
 * @property {string} [conjunction]
 * @property {string} [entityName]
 * @property {number} [subtitleFontSize]
 * @property {number} [entityFontSize]
 */

/**
 * @typedef {Object} ResolvedCoverPageImageElement
 * @property {"image"} type
 * @property {string | VariableRef} [content]
 * @property {BoxStyle} [style]
 * @property {number} [height]
 * @property {VerticalAlign} [verticalAlign]
 */

/**
 * @typedef {Object} ResolvedCoverPageSpacerElement
 * @property {"spacer"} type
 * @property {number} [height]
 */

/**
 * @typedef {Object} ResolvedCoverPageRuleElement
 * @property {"rule"} type
 * @property {TextStyle} [style]
 * @property {string} [stroke]
 * @property {number} [startFrac]
 * @property {number} [endFrac]
 * @property {number} [lineWidth]
 * @property {number} [gray]
 * @property {string} [color]
 * @property {number} [afterSpacer]
 */

/**
 * @typedef {Object} ResolvedCoverPageKvBlockElement
 * @property {"kv-block"} type
 * @property {TextStyle} [style]
 * @property {number} [startFrac]
 * @property {number} [endFrac]
 * @property {number} [height]
 * @property {VerticalAlign} [verticalAlign]
 * @property {ReadonlyArray<{ label: string, value: string | VariableRef }>} [rows]
 * @property {CoverBlockAlign} [labelAlign]
 * @property {number} [columnGap]
 * @property {number} [lineSpacer]
 * @property {string} [separator]
 */

/**
 * @typedef {Object} ResolvedCoverPageBoxElement
 * @property {"box"} type
 * @property {number} [startFrac]
 * @property {number} [endFrac]
 * @property {number} [lineWidth]
 * @property {string} [stroke]
 * @property {string} [borderColor]
 * @property {string | VariableRef} [content]
 * @property {BoxStyle} [style]
 * @property {number} [height]
 * @property {VerticalAlign} [verticalAlign]
 * @property {number} [afterSpacer]
 */

/**
 * @typedef {ResolvedCoverPageTextElement | ResolvedCoverPageTitleBlockElement | ResolvedCoverPageImageElement | ResolvedCoverPageSpacerElement | ResolvedCoverPageRuleElement | ResolvedCoverPageKvBlockElement | ResolvedCoverPageBoxElement} ResolvedCoverElement
 */

/**
 * @typedef {Object} CoverPageNode
 * @property {"cover-page"} type
 * @property {string} id
 * @property {CoverPageConfig} config
 * @property {ReadonlyArray<ResolvedCoverElement>} elements
 */

/**
 * @typedef {Object} TocNode
 * @property {"toc"} type
 * @property {string} id
 * @property {TocConfig} config
 * @property {TocEntry[]} entries
 */

/**
 * @typedef {Object} TocEntry
 * @property {string} nodeId
 * @property {number} level
 * @property {string} title
 * @property {number} page
 * @property {TocEntryStyle} [style]
 * @property {boolean} [isDocumentEntry]
 */

// =============================================================================
// Types
// =============================================================================

/**
 * @typedef {Object} DocumentSource
 * @property {string} id
 * @property {string | string[]} [name]
 * @property {BaseNode} root
 * @property {Partial<SectionConfig>} [sectionConfig]
 * @property {Readonly<Record<string, string | string[]>> | Record<string, string | string[]>} [metadata]
 * @property {Readonly<Record<string, string | number>>} [variables]
 */

/**
 * @typedef {Object} ComposedDocument
 * @property {CoverPageNode | null} coverPage
 * @property {TocNode | null} toc
 * @property {ReadonlyArray<ComposedSection>} sections
 * @property {CompositeDocumentConfig} config
 * @property {Readonly<Record<string, string | number>>} variables
 */

/**
 * @typedef {Object} ComposedSection
 * @property {string} id
 * @property {string} [name]
 * @property {SectionConfig} config
 * @property {ReadonlyArray<BaseNode>} content
 * @property {string} [sourceId]
 */

// =============================================================================
// Phase Types
// =============================================================================

/**
 * @typedef {Object} FormattingContext
 * @property {Readonly<Record<string, string | number>>} variables
 * @property {Readonly<Record<string, string>>} metadata
 */

/**
 * @typedef {Object} FormattingRule
 * @property {string} id
 * @property {string} [description]
 * @property {(node: BaseNode) => boolean} match
 * @property {(node: BaseNode, context: FormattingContext) => BaseNode} transform
 */

/**
 * @typedef {Object} FormattingResult
 * @property {DocumentSource} document
 * @property {ReadonlyArray<string>} warnings
 */

/**
 * @typedef {Object} CompositionResult
 * @property {CoverPageNode | null} coverPage
 * @property {TocNode | null} toc
 * @property {ReadonlyArray<ComposedSection>} sections
 * @property {Readonly<Record<string, string | number>>} variables
 */

// =============================================================================
// Inline Format Types
// =============================================================================

/**
 * @typedef {"bold" | "italic" | "underline" | "strikethrough" | "code" | "superscript" | "subscript"} InlineFormatType
 */

/**
 * @typedef {Object} InlineFormat
 * @property {InlineFormatType} type
 * @property {number} start
 * @property {number} end
 */

// =============================================================================
// Pipeline Result
// =============================================================================

/**
 * @typedef {Object} PipelineResult
 * @property {boolean} success
 * @property {FormattingResult} [formattingResult]
 * @property {CompositionResult} [compositionResult]
 * @property {RenderResult} [renderResult]
 * @property {ReadonlyArray<string>} warnings
 * @property {ReadonlyArray<string>} errors
 */

// =============================================================================
// Types
// =============================================================================
/**
 * @typedef {Object} MeasuredNode
 * @property {BaseNode} node
 * @property {number} height
 * @property {boolean} canSplit
 * @property {number} minHeight
 * @property {ReadonlyArray<MeasuredNode>} children
 */

/**
 * @typedef {Object} RequiredMargins
 * @property {number} top
 * @property {number} bottom
 * @property {number} left
 * @property {number} right
 */

/**
 * @typedef {Object} LayoutContext
 * @property {number} pageWidth
 * @property {number} pageHeight
 * @property {number} contentWidth
 * @property {number} contentHeight
 * @property {RequiredMargins} margins
 * @property {string} sectionId
 * @property {number} baseFontSize
 * @property {number} lineHeight
 */

/**
 * @typedef {Object} PageState
 * @property {number} pageNumber
 * @property {number} sectionPageNumber
 * @property {number} currentY
 * @property {number} remainingHeight
 */

/**
 * @typedef {Object} SectionLayoutResult
 * @property {string} sectionId
 * @property {number} startPage
 * @property {number} endPage
 * @property {ReadonlyArray<LayoutBlock>} blocks
 */

/**
 * @typedef {Object} HeightResult
 * @property {number} height
 * @property {boolean} canSplit
 * @property {number} minHeight
 */

/**
 * @typedef {Object} DraftWatermarkConfig
 * @property {boolean} [enabled]
 * @property {string} [text]
 * @property {number} [gray]
 * @property {number} [angle_deg]
 * @property {number} [font_size]
 */

/**
 * Cover layout config (render-pack-driven cover builder).
 *
 * This config is intended to live under packet_config.cover_config.cover_layout (snake_case)
 * or coverLayout (camelCase). It defines a structured, extensible cover page layout without
 * requiring explicit CoverPageElement templates.
 */

/** @typedef {"left" | "center" | "right"} CoverBlockAlign */

/**
 * @typedef {Object} CoverLayoutTitleBlock
 * @property {number} [top_spacer] - Top spacer height in points
 * @property {number} [topSpacer] - CamelCase alias
 * @property {CoverBlockAlign} [align] - Default: "center"
 * @property {number} [title_font_size] - Title font size in points
 * @property {number} [titleFontSize] - CamelCase alias
 * @property {boolean} [include_conjunction_line] - If false, omit the conjunction line (e.g. "OF")
 * @property {boolean} [includeConjunctionLine] - CamelCase alias
 * @property {string} [conjunction_text] - Default: "OF"
 * @property {string} [conjunctionText] - CamelCase alias
 * @property {number} [conjunction_font_size] - Conjunction font size in points
 * @property {number} [conjunctionFontSize] - CamelCase alias
 * @property {number} [entity_font_size] - Entity name font size in points
 * @property {number} [entityFontSize] - CamelCase alias
 * @property {number} [after_spacer] - Spacer after title block in points
 * @property {number} [afterSpacer] - CamelCase alias
 */

/**
 * @typedef {Object} CoverLayoutRule
 * @property {boolean} [enabled] - Default: true
 * @property {number} [start_frac] - Start X as fraction of available width (0..1)
 * @property {number} [startFrac] - CamelCase alias
 * @property {number} [end_frac] - End X as fraction of available width (0..1)
 * @property {number} [endFrac] - CamelCase alias
 * @property {number} [line_width] - Line width in points
 * @property {number} [lineWidth] - CamelCase alias
 * @property {number} [gray] - Gray value (0 black .. 1 white)
 * @property {number} [after_spacer] - Spacer after rule in points
 * @property {number} [afterSpacer] - CamelCase alias
 */

/** @typedef {"document_id" | "version" | "status" | "effective_date" | "document_date" | "execution_date" | "last_updated"} CoverMetadataFieldKey */

/**
 * @typedef {Object} CoverLayoutMetadataField
 * @property {CoverMetadataFieldKey | string} key
 * @property {string} label
 * @property {boolean} [enabled] - Default: true
 */

/**
 * @typedef {Object} CoverLayoutMetadataBlock
 * @property {CoverBlockAlign} [align] - Default: "left"
 * @property {number} [font_size] - Font size in points
 * @property {number} [fontSize] - CamelCase alias
 * @property {number} [line_spacer] - Spacer between lines in points
 * @property {number} [lineSpacer] - CamelCase alias
 * @property {string} [label_value_separator] - Default: ": "
 * @property {string} [labelValueSeparator] - CamelCase alias
 * @property {ReadonlyArray<CoverLayoutMetadataField>} [fields]
 */

/**
 * @typedef {Object} CoverLayoutConfig
 * @property {CoverLayoutTitleBlock} [title_block]
 * @property {CoverLayoutTitleBlock} [titleBlock] - CamelCase alias
 * @property {CoverLayoutRule} [rule]
 * @property {CoverLayoutMetadataBlock} [metadata_block]
 * @property {CoverLayoutMetadataBlock} [metadataBlock] - CamelCase alias
 */

/**
 * @typedef {Object} CoverRenderConfig
 * @property {boolean} [suppress_header]
 * @property {boolean} [suppress_footer]
 * @property {boolean} [suppress_page_numbering]
 * @property {boolean} [reserve_header_footer_space]
 * @property {DraftWatermarkConfig} [draft_watermark]
 * @property {CoverLayoutConfig} [cover_layout]
 * @property {CoverLayoutConfig} [coverLayout]
 */

/**
 * @typedef {Object} PacketEntityExtraction
 * @property {string[]} fields
 * @property {string} [title_pattern]
 */

/**
 * @typedef {Object} PacketConfig
 * @property {string} [default_entity_name]
 * @property {string} [default_document_title]
 * @property {string} [header_text]
 * @property {string} [series_prefix]
 * @property {"plain" | "entity-suffix"} [header_title_format]
 * @property {"always" | "never" | "first-only"} [section_page_break]
 * @property {Record<string, string>} [path_to_title]
 * @property {string[]} [name_patterns]
 * @property {PacketEntityExtraction} [entity_extraction]
 * @property {string} [document_kind_default]
 * @property {Record<string, string>} [document_kind_map]
 * @property {Metadata} [cover_templates]
 * @property {CoverRenderConfig} [cover_config]
 */

/**
 * @typedef {Object} RenderPackData
 * @property {string} schema
 * @property {number} schema_version
 * @property {string} pack_id
 * @property {string} [description]
 * @property {RenderDocumentPolicy} [document_policies]
 * @property {PacketConfig} [packet_config] - Packet generation config (header text, cover page, entity rules)
 */

/**
 * @typedef {Object} RenderDocumentPolicy
 * @property {RenderDefaults} [defaults]
 * @property {Record<string, RenderTarget>} [targets]
 * @property {Record<string, RenderProfile>} [render_profiles]
 * @property {RenderRuleset[]} [rulesets]
 */

/**
 * @typedef {Object} RenderDefaults
 * @property {string} [output_encoding]
 * @property {string} [output_newlines]
 */

/**
 * @typedef {Object} RenderTarget
 * @property {string} format
 * @property {string} [page_size]
 * @property {string} [orientation]
 * @property {MarginsConfig} [margins]
 * @property {FontsConfig} [fonts]
 * @property {number} [base_font_size]
 * @property {number} [title_font_size]
 * @property {Record<string, number>} [heading_scales]
 * @property {number} [line_spacing]
 * @property {number} [paragraph_spacing_factor]
 * @property {SpacingPolicy} [spacing_policy] - Vertical spacing rules (preferred snake_case)
 * @property {SpacingPolicy} [spacingPolicy] - Vertical spacing rules (camelCase alias)
 * @property {number} [list_indent_per_level]
 * @property {number} [code_block_indent]
 * @property {HorizontalRuleConfig} [horizontal_rule]
 * @property {InlineFormattingConfig} [inline_formatting]
 * @property {string} [delimiter]
 * @property {string} [quote_char]
 * @property {string} [line_terminator]
 * @property {boolean} [include_header]
 * @property {string} [null_value]
 * @property {string} [date_format]
 * @property {string} [doctype]
 * @property {boolean} [inline_styles]
 * @property {number} [indent]
 * @property {boolean} [sort_keys]
 * @property {number} [line_width]
 */

/**
 * @typedef {Object} MarginsConfig
 * @property {number} top
 * @property {number} bottom
 * @property {number} left
 * @property {number} right
 * @property {string} [unit]
 */

/**
 * @typedef {Object} FontsConfig
 * @property {string} [regular]
 * @property {string} [bold]
 * @property {string} [italic]
 * @property {string} [bold_italic]
 * @property {string} [monospace]
 */

/**
 * @typedef {"rule" | "page-break"} HorizontalRuleBehavior
 */

/**
 * @typedef {Object} HorizontalRuleConfig
 * @property {number} [width_factor]
 * @property {number} [thickness]
 * @property {number} [gray_value]
 * @property {number} [spacing_before]
 * @property {number} [spacing_after]
 * @property {HorizontalRuleBehavior} [behavior]
 */

/**
 * @typedef {Object} InlineFormattingConfig
 * @property {boolean} [enabled]
 * @property {number} [underline_offset_factor]
 * @property {number} [underline_thickness_small]
 * @property {number} [underline_thickness_large]
 * @property {number} [underline_size_threshold]
 */

/**
 * @typedef {Object} RenderProfile
 * @property {string} [description]
 * @property {string} target
 * @property {string} [extends]
 * @property {Metadata} [overrides]
 */

/**
 * @typedef {Object} RenderRuleset
 * @property {string} id
 * @property {RenderSelectors} selectors
 * @property {RenderRuleConfig} render
 */

/**
 * @typedef {Object} RenderSelectors
 * @property {string[]} [paths_glob]
 * @property {boolean} [is_root_file]
 * @property {string[]} [doc_types]
 * @property {string[]} [extensions]
 */

/**
 * @typedef {Object} RenderRuleConfig
 * @property {string} [target]
 * @property {string} [render_profile_id]
 */

/**
 * @typedef {Object} ResolvedRenderConfig
 * @property {string} format
 * @property {string} [page_size]
 * @property {string} [orientation]
 * @property {MarginsConfig} [margins]
 * @property {FontsConfig} [fonts]
 * @property {number} [base_font_size]
 * @property {number} [title_font_size]
 * @property {Record<string, number>} [heading_scales]
 * @property {number} [line_spacing]
 * @property {number} [paragraph_spacing_factor]
 * @property {SpacingPolicy} [spacing_policy] - Vertical spacing rules (preferred snake_case)
 * @property {SpacingPolicy} [spacingPolicy] - Vertical spacing rules (camelCase alias)
 * @property {number} [list_indent_per_level]
 * @property {number} [code_block_indent]
 * @property {HorizontalRuleConfig} [horizontal_rule]
 * @property {TableRenderConfig} [table] - Table styling overrides (preferred)
 * @property {TableRenderConfig} [table_style] - Snake_case alias used by some packs
 * @property {TableRenderConfig} [tableStyle] - CamelCase alias used by some packs
 * @property {InlineFormattingConfig} [inline_formatting]
 * @property {{ level_styles?: ReadonlyArray<TocEntryStyle> }} [toc] - Styles for each level
 * @property {CoverRenderConfig=} [cover_config]
 * @property {BreakMode | null=} [break_mode] - Section break behavior: "always" (default) breaks on every article/section, "part-only" only breaks on top-level Part headings
 */
