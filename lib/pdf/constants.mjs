/**
 * @typedef {import("../parsing/markdown.mjs").MarkdownNode} MarkdownNode
 */

/**
 * @typedef {import("./content-stream.mjs").PdfContentStreamBuilder} PdfContentStreamBuilder
 */

/**
 * @typedef {Object} RgbColor
 * @property {number} r - Red component 0-1
 * @property {number} g - Green component 0-1
 * @property {number} b - Blue component 0-1
 */

/**
 * @typedef {Object} PdfRenderingConfig
 * @property {number} base_font_size
 * @property {number} [title_font_size]
 * @property {{ h1: number; h2: number; h3: number; h4: number }} heading_scales
 * @property {{ top: number; bottom: number; left: number; right: number }} margins
 * @property {"single" | "1.5" | "double"} line_spacing
 * @property {number} paragraph_spacing_factor
 * @property {number} list_indent_per_level
 * @property {number} [code_block_indent]
 * @property {{
 *  width_factor: number;
 *  thickness: number;
 *  gray_value: number;
 *  spacing_before: number;
 *  spacing_after: number
 * }} [horizontal_rule]
 * @property {{
 *  enabled: boolean;
 *  underline_offset_factor: number;
 *  underline_thickness_small: number;
 *  underline_thickness_large: number;
 *  underline_size_threshold: number
 * }} [inline_formatting]
 * @property {{
 *  regular: string;
 *  bold: string;
 *  italic: string;
 *  bold_italic: string;
 *  monospace: string
 * }} fonts
 */

/**
 * @typedef {Object} PageConfig
 * @property {"a4" | "letter"} [size]
 * @property {number} [width]
 * @property {number} [height]
 */

/**
 * @typedef {Object} DocumentMetadata
 * @property {string} [title]
 * @property {string} [author]
 * @property {string} [subject]
 * @property {string} [creator]
 * @property {string | null} [producer]
 * @property {boolean} [includeDates]
 * @property {boolean} [omitInfo]
 */

/**
 * @typedef {Object} HeaderFooterConfig
 * @property {boolean} [showHeader]
 * @property {string} [headerText]
 * @property {number} [headerFontSize]
 * @property {number} [headerGray]
 * @property {boolean} [showFooter]
 * @property {string} [footerText]
 * @property {number} [footerFontSize]
 * @property {number} [footerGray]
 * @property {boolean} [decorateFirstPage]
 * @property {boolean} [showPageNumbers]
 * @property {"left" | "center" | "right"} [pageNumberAlignment]
 */

/**
 * @typedef {Object} TitleConfig
 * @property {boolean} [showTitle]
 * @property {boolean} [centerTitle]
 * @property {RgbColor} [titleColor]
 */

/**
 * @typedef {Object} RendererOptions
 * @property {PdfRenderingConfig} [rendering]
 * @property {PageConfig} [page]
 * @property {DocumentMetadata} [metadata]
 * @property {HeaderFooterConfig} [headerFooter]
 * @property {TitleConfig} [title]
 * @property {Record<string, NodeHandler>} [nodeHandlers]
 */

/**
 * @typedef {Object} RenderState
 * @property {number} y - Current Y position (from top)
 * @property {number} pageNum - Current page number
 * @property {PdfContentStreamBuilder} builder - Current content stream builder
 */

/**
 * Renders parsed Markdown AST to PDF format.
 *
 * Provides configurable page layout, typography, headers/footers, and extensible
 * node handling for converting Markdown documents into professionally formatted PDFs.
 *
 * @interface PdfRenderer
 * @property {PdfRenderingConfig} rendering - Typography and spacing configuration.
 * @property {number} pageWidth - Page width in points (1/72 inch).
 * @property {number} pageHeight - Page height in points.
 * @property {number} marginTop - Top margin in points.
 * @property {number} marginBottom - Bottom margin in points.
 * @property {number} marginLeft - Left margin in points.
 * @property {number} marginRight - Right margin in points.
 * @property {number} contentWidth - Available content width.
 * @property {number} lineSpacingFactor - Multiplier for line height calculation.
 * @property {string} documentTitle - Title for first page.
 * @property {boolean} showTitle - Whether to render document title.
 * @property {boolean} centerTitle - Whether to center the title.
 * @property {RgbColor} titleColor - RGB color for title text.
 * @property {boolean} showHeader - Whether to render page headers.
 * @property {string} headerText - Header text content.
 * @property {number} headerFontSize - Header font size in points.
 * @property {number} headerGray - Header grayscale (0-1).
 * @property {boolean} showFooter - Whether to render page footers.
 * @property {string} footerText - Footer text content.
 * @property {number} footerFontSize - Footer font size in points.
 * @property {number} footerGray - Footer grayscale (0-1).
 * @property {boolean} decorateFirstPage - Apply header/footer to first page.
 * @property {boolean} showPageNumbers - Display page numbers.
 * @property {"left"|"center"|"right"} pageNumberAlignment - Page number alignment.
 * @property {Record<string, NodeHandler>} nodeHandlers - Custom node handlers by type.
 * @property {PdfDocumentBuilder} doc - Underlying PDF builder.
 * @property {Uint8Array[]} pageContents - Content streams per page.
 * @property {PdfContentStreamBuilder} currentBuilder - Active content stream.
 * @property {number} currentY - Current Y position from top.
 * @property {number} pageNum - Current page number (1-indexed).
 * @property {number} baseFontSize - Base font size in points.
 * @property {number} fontSize - Current effective font size.
 * @property {number} lineHeight - Current line height.
 * @property {number} paragraphSpacing - Space between paragraphs.
 * @property {number} listIndent - Indent per list level.
 * @property {number} codeBlockPadding - Code block internal padding.
 * @method getBodyLineHeight - Returns body text line height.
 * @method getHeadingScale - Returns scale for heading level.
 * @method getFont - Returns PDF font name for style.
 * @method getPdfY - Converts Y to PDF coordinates.
 * @method needsNewPage - Checks if height fits on page.
 * @method pageBreak - Forces page break.
 * @method decoratePage - Adds header/footer to page.
 * @method newPage - Creates new page.
 * @method ensureSpace - Ensures space or breaks page.
 * @method moveDown - Advances Y position.
 * @method renderText - Renders single line of text.
 * @method renderParagraph - Renders wrapped paragraph.
 * @method renderDocumentTitle - Renders the document title.
 * @method extractText - Extracts text content from node.
 * @method registerNodeHandler - Registers custom node handler.
 * @method unregisterNodeHandler - Removes node handler.
 * @method beforeRenderNode - Hook before node rendering.
 * @method afterRenderNode - Hook after node rendering.
 * @method transformNode - Transforms node before rendering.
 * @method shouldRenderNode - Determines if node should render.
 * @method walkAst - Traverses AST with visitor.
 * @method collectNodesByType - Collects nodes of specific type.
 * @method renderInlineContent - Renders inline children.
 * @method drawUnderline - Draws underline at position.
 * @method renderHeading - Renders heading node.
 * @method renderParagraphNode - Renders paragraph node.
 * @method renderList - Renders list node.
 * @method renderListItem - Renders list item node.
 * @method renderCodeBlock - Renders fenced code block.
 * @method renderInlineCode - Renders inline code span.
 * @method renderHorizontalRule - Renders horizontal rule.
 * @method renderNode - Renders any node by type.
 * @method finalize - Finalizes and returns PDF bytes.
 * @method render - Renders ParsedMarkdownDoc to PDF.
 * @method renderNodes - Renders array of nodes to PDF.
 */

/**
 * Node handler function signature
 * @callback NodeHandler
 * @param {PdfRenderer} renderer
 * @param {MarkdownNode} node
 * @param {number} depth
 * @returns {boolean} - true if handled, false to fall through to default
 */

/**
 * AST visitor callback for traversal
 * @callback AstVisitor
 * @param {MarkdownNode} node
 * @param {number} depth
 * @param {MarkdownNode|null} parent
 * @returns {void}
 */

// ============================================================================
// Constants - Page Sizes
// ============================================================================

const PAGE_SIZES = {
    a4: { width: 595.276, height: 841.89 },
    letter: { width: 612, height: 792 }
};

const LINE_SPACING_FACTORS = {
    single: 1.2,
    1.5: 1.5,
    double: 2.0
};

/** @type {RgbColor} */
const BLACK = { r: 0, g: 0, b: 0 };

// ============================================================================
// Default Config
// ============================================================================

/** @type {PdfRenderingConfig} */
const DEFAULT_RENDERING_CONFIG = {
    base_font_size: 10,
    title_font_size: 16,
    heading_scales: { h1: 1.6, h2: 1.4, h3: 1.2, h4: 1.1 },
    margins: { top: 72, bottom: 72, left: 72, right: 72 },
    line_spacing: "1.5",
    paragraph_spacing_factor: 0.5,
    list_indent_per_level: 20,
    code_block_indent: 36,
    horizontal_rule: {
        width_factor: 0.5,
        thickness: 0.5,
        gray_value: 0.5,
        spacing_before: 10,
        spacing_after: 10
    },
    inline_formatting: {
        enabled: true,
        underline_offset_factor: 0.15,
        underline_thickness_small: 0.5,
        underline_thickness_large: 0.75,
        underline_size_threshold: 12
    },
    fonts: {
        regular: "Helvetica",
        bold: "Helvetica-Bold",
        italic: "Helvetica-Oblique",
        bold_italic: "Helvetica-BoldOblique",
        monospace: "Courier"
    }
};

export { PAGE_SIZES, DEFAULT_RENDERING_CONFIG, BLACK, LINE_SPACING_FACTORS };
