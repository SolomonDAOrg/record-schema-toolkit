// =============================================================================
// Constants
// =============================================================================

export const NODE_CATEGORIES = /** @type {const} */ ({
    BASE: "base",
    PROSE: "prose",
    TABULAR: "tabular",
    LEGAL: "legal",
    COMPOSITE: "composite"
});

export const BASE_NODE_TYPES = /** @type {const} */ ({
    TEXT: "text",
    CONTAINER: "container",
    BREAK: "break"
});

export const PROSE_NODE_TYPES = /** @type {const} */ ({
    HEADING: "heading",
    PARAGRAPH: "paragraph",
    LIST: "list",
    LIST_ITEM: "list-item",
    BLOCKQUOTE: "blockquote",
    CODE_BLOCK: "code-block",
    HORIZONTAL_RULE: "horizontal-rule",
    IMAGE: "image",
    LINK: "link",
    INLINE_FORMAT: "inline-format",
    NOTICE: "notice"
});

export const TABULAR_NODE_TYPES = /** @type {const} */ ({
    TABLE: "table",
    ROW: "row",
    CELL: "cell",
    HEADER_ROW: "header-row",
    HEADER_CELL: "header-cell"
});

export const LEGAL_NODE_TYPES = /** @type {const} */ ({
    ARTICLE: "article",
    SECTION: "section",
    CLAUSE: "clause",
    DEFINITION: "definition",
    RECITAL: "recital",
    SIGNATURE_BLOCK: "signature-block",
    SIGNATORY: "signatory",
    NOTICE: "notice",
    SCHEDULE: "schedule",
    EXHIBIT: "exhibit"
});

export const COMPOSITE_NODE_TYPES = /** @type {const} */ ({
    COVER_PAGE: "cover-page",
    TOC: "toc",
    TOC_ENTRY: "toc-entry",
    DOCUMENT_GROUP: "document-group",
    SECTION_BREAK: "section-break"
});

/** @type {Record<import("../types/core.mjs").PageSize, import("../types/core.mjs").PageDimensions>} */
export const PAGE_SIZES = /** @type {const} */ ({
    letter: { width: 612, height: 792 },
    legal: { width: 612, height: 1008 },
    a4: { width: 595, height: 842 },
    a3: { width: 842, height: 1191 },
    tabloid: { width: 792, height: 1224 }
});

// =============================================================================
// Default Spacing Constants (in em units unless specified)
// =============================================================================

/**
 * Default vertical spacing before elements (in em)
 * These are baseline values that can be overridden by spacingPolicy
 */
export const DEFAULT_SPACING_BEFORE = /** @type {const} */ ({
    // Headings need more space when following content
    heading_after_content: 2.5,
    heading_after_heading: 0.75,
    heading_default: 2.0,

    // Paragraphs
    paragraph_after_heading: 0.5,
    paragraph_default: 0.5,

    // Lists
    list_default: 0.75,

    // Tables
    table_default: 1.25,
    table_after: 1.0,

    // Block elements
    blockquote_default: 1.0,
    code_block_default: 1.0,
    horizontal_rule_default: 1.0,

    // Legal/notice elements
    notice_default: 1.5,
    signature_block_default: 2.0,
    article_default: 1.5,
    section_default: 1.5
});

/**
 * Default spacing after elements (in em)
 */
export const DEFAULT_SPACING_AFTER = /** @type {const} */ ({
    heading: 0.25,
    table: 1.0,
    code_block: 0.5
});

/**
 * Typography replacements i.e. em/en dash and nicer arrows
 */
export const TYPOGRAPHY_SUBSTITUTIONS =
    /** @type {ReadonlyArray<readonly [RegExp, string]>} */ ([
        [/---/g, "\u2014"],
        [/--/g, "\u2014"],
        [/->/g, "\u00bb"]
    ]);
