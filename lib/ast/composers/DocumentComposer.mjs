/**
 * DocumentComposer - Combines multiple documents with cover pages, TOC, sections
 * @module format-ast/composers/DocumentComposer
 */

/**
 * @typedef {import("../types/core.mjs").CoverPageConfig} CoverPageConfig
 * @typedef {import("../types/core.mjs").CoverPageElement} CoverPageElement
 * @typedef {import("../types/core.mjs").TocConfig} TocConfig
 * @typedef {import("../types/core.mjs").TocEntryStyle} TocEntryStyle
 * @typedef {import("../types/core.mjs").SectionConfig} SectionConfig
 * @typedef {import("../types/core.mjs").CompositeDocumentConfig} CompositeDocumentConfig
 * @typedef {import("../types/core.mjs").HeaderFooterConfig} HeaderFooterConfig
 * @typedef {import("../types/core.mjs").PageConfig} PageConfig
 * @typedef {import("../types/core.mjs").TextStyle} TextStyle
 * @typedef {import("../types/core.mjs").VariableRef} VariableRef
 * @typedef {import("../types/core.mjs").PageSelector} PageSelector
 * @typedef {import("../types/core.mjs").PageSelectorPredicate} PageSelectorPredicate
 * @typedef {import("../types/core.mjs").LayoutResult} LayoutResult
 * @typedef {import("../types/core.mjs").LayoutBlock} LayoutBlock
 * @typedef {import("../types/core.mjs").NodeType} NodeType
 * @typedef {import("../types/core.mjs").BaseNode} BaseNode
 * @typedef {import("../types/core.mjs").DocumentSource} DocumentSource
 * @typedef {import("../types/core.mjs").ComposedSection} ComposedSection
 * @typedef {import("../types/core.mjs").ComposedDocument} ComposedDocument
 * @typedef {import("../types/core.mjs").CoverPageNode} CoverPageNode
 * @typedef {import("../types/core.mjs").ResolvedCoverElement} ResolvedCoverElement
 * @typedef {import("../types/core.mjs").TocNode} TocNode
 * @typedef {import("../types/core.mjs").TocEntry} TocEntry
 */

// =============================================================================
// Page Selector Utilities
// =============================================================================

/**
 * Convert PageSelector to predicate function
 * @param {PageSelector} selector
 * @returns {PageSelectorPredicate}
 */
export function createPageSelectorPredicate(selector) {
    if (typeof selector === "function") {
        return selector;
    }

    switch (selector) {
        case "all":
            return () => true;

        case "first":
            return (_page, _total, sectionPage) => sectionPage === 1;

        case "not-first":
            return (_page, _total, sectionPage) => sectionPage !== 1;

        case "last":
            return (_page, _total, sectionPage, sectionTotal) =>
                sectionPage === sectionTotal;

        case "not-last":
            return (_page, _total, sectionPage, sectionTotal) =>
                sectionPage !== sectionTotal;

        case "odd":
            return (page) => page % 2 === 1;

        case "even":
            return (page) => page % 2 === 0;

        default:
            // Array of specific page numbers
            if (Array.isArray(selector)) {
                const pageSet = new Set(selector);
                return (page) => pageSet.has(page);
            }
            return () => true;
    }
}

/**
 * Find matching header/footer config for a page
 * @param {ReadonlyArray<HeaderFooterConfig>} configs
 * @param {"header" | "footer"} location
 * @param {number} page
 * @param {number} totalPages
 * @param {number} sectionPage
 * @param {number} sectionTotalPages
 * @returns {HeaderFooterConfig | null}
 */
export function findMatchingHeaderFooter(
    configs,
    location,
    page,
    totalPages,
    sectionPage,
    sectionTotalPages
) {
    const matching = configs
        .filter((c) => c.location === location)
        .filter((c) => {
            const predicate = createPageSelectorPredicate(c.pages);
            return predicate(page, totalPages, sectionPage, sectionTotalPages);
        })
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    return matching[0] ?? null;
}

// =============================================================================
// Variable Resolution
// =============================================================================

/**
 * @typedef {Object} VariableContext
 * @property {number} page
 * @property {number} totalPages
 * @property {number} sectionPage
 * @property {number} sectionTotal
 * @property {Readonly<Record<string, string | number>>} variables
 */

/**
 * Resolve variable reference to string
 * @param {VariableRef} ref
 * @param {VariableContext} context
 * @returns {string}
 */
export function resolveVariable(ref, context) {
    switch (ref.name) {
        case "page":
            return String(context.page);
        case "totalPages":
            return String(context.totalPages);
        case "sectionPage":
            return String(context.sectionPage);
        case "sectionTotal":
            return String(context.sectionTotal);
        case "date":
            return formatDate(new Date(), ref.format);
        default:
            const value = context.variables[ref.name];
            return value !== undefined ? String(value) : "";
    }
}

/**
 * @param {Date} date
 * @param {string} [format]
 * @returns {string}
 */
function formatDate(date, format) {
    if (!format) {
        return date.toLocaleDateString();
    }
    // Simple format support
    return format
        .replace("YYYY", String(date.getFullYear()))
        .replace("MM", String(date.getMonth() + 1).padStart(2, "0"))
        .replace("DD", String(date.getDate()).padStart(2, "0"));
}

/**
 * Resolve header/footer content to string
 * @param {string | VariableRef | ReadonlyArray<string | VariableRef>} content
 * @param {VariableContext} context
 * @returns {string}
 */
export function resolveHeaderFooterContent(content, context) {
    if (typeof content === "string") {
        // Handle legacy {page} syntax
        return content
            .replace("{page}", String(context.page))
            .replace("{total}", String(context.totalPages))
            .replace("{sectionPage}", String(context.sectionPage))
            .replace("{sectionTotal}", String(context.sectionTotal));
    }

    if ("type" in content && content.type === "variable") {
        return resolveVariable(content, context);
    }

    // Array of mixed content
    return /** @type {ReadonlyArray<string | VariableRef>} */ (content)
        .map((item) => {
            if (typeof item === "string") {
                return item;
            }
            return resolveVariable(item, context);
        })
        .join("");
}

// =============================================================================
// DocumentComposer Class
// =============================================================================

export class DocumentComposer {
    /**
     * @param {CompositeDocumentConfig} config
     */
    constructor(config) {
        /** @type {CompositeDocumentConfig} */
        this.config = config;
        /** @type {number} */
        this.nodeIdCounter = 0;
    }

    /**
     * Generate unique node ID
     * @param {string} prefix
     * @returns {string}
     */
    generateId(prefix) {
        return `${prefix}_${++this.nodeIdCounter}`;
    }

    /**
     * Compose multiple documents into a single composed document
     * @param {ReadonlyArray<DocumentSource>} sources
     * @param {Readonly<Record<string, string | number>>} [variables]
     * @returns {ComposedDocument}
     */
    compose(sources, variables = {}) {
        /** @type {ComposedSection[]} */
        const sections = [];

        // Build sections from sources
        for (let i = 0, len = sources.length; i < len; i++) {
            const source = sources[i];
            const sectionConfig = this.resolveSectionConfig(source, i);

            sections.push({
                id: sectionConfig.id,
                name:
                    (Array.isArray(sectionConfig.name)
                        ? sectionConfig.name.join(" ")
                        : sectionConfig.name) ?? "",
                config: sectionConfig,
                content: source.root.children,
                sourceId: source.id
            });
        }

        // Build cover page if configured
        const coverPage = this.config.coverPage
            ? this.buildCoverPage(this.config.coverPage, variables)
            : null;

        // Build TOC structure (entries populated after layout)
        const toc = this.config.toc
            ? this.buildTocNode(this.config.toc, sections)
            : null;

        return {
            coverPage,
            toc,
            sections,
            config: this.config,
            variables
        };
    }

    /**
     * Resolve section config for a document source
     * @param {DocumentSource} source
     * @param {number} index
     * @returns {SectionConfig}
     */
    resolveSectionConfig(source, index) {
        const baseConfig = this.config.sections[index] ?? {
            id: source.id,
            name: source.name
        };

        // Merge source overrides
        /** @type {SectionConfig} */
        const merged = {
            ...baseConfig,
            ...source.sectionConfig,
            id: source.sectionConfig?.id ?? baseConfig.id ?? source.id,
            pageConfig: {
                ...this.config.defaultPageConfig,
                ...baseConfig.pageConfig,
                ...source.sectionConfig?.pageConfig
            },
            headers:
                source.sectionConfig?.headers ??
                baseConfig.headers ??
                this.config.defaultHeaders,
            footers:
                source.sectionConfig?.footers ??
                baseConfig.footers ??
                this.config.defaultFooters
        };

        return merged;
    }

    /**
     * Build cover page node
     * @param {CoverPageConfig} config
     * @param {Readonly<Record<string, string | number>>} variables
     * @returns {CoverPageNode}
     */
    buildCoverPage(config, variables) {
        /** @type {ResolvedCoverElement[]} */
        const resolvedElements = [];

        const context = {
            page: 1,
            totalPages: 0, // Not known yet
            sectionPage: 1,
            sectionTotal: 0,
            variables
        };

        /**
         * Deep-resolve VariableRef values inside arbitrary cover elements.
         * This preserves element-specific fields (e.g., title-block, kv-block rows/columns)
         * instead of whitelisting only {type, content, style, height}.
         *
         * @param {unknown} value
         * @returns {unknown}
         */
        function resolveValue(value) {
            if (value === null || value === undefined) {
                return value;
            }

            const t = typeof value;
            if (t === "string" || t === "number" || t === "boolean") {
                return value;
            }

            if (Array.isArray(value)) {
                /** @type {unknown[]} */
                const out = [];
                for (let i = 0, len = value.length; i < len; i++) {
                    out.push(resolveValue(value[i]));
                }
                return out;
            }

            if (t === "object") {
                const obj = /** @type {Record<string, unknown>} */ (value);

                // VariableRef
                if (obj.type === "variable" && typeof obj.name === "string") {
                    return resolveVariable(
                        /** @type {VariableRef} */ (obj),
                        context
                    );
                }

                /** @type {Record<string, unknown>} */
                const out = {};
                const keys = Object.keys(obj);
                for (let i = 0, len = keys.length; i < len; i++) {
                    const k = keys[i];
                    out[k] = resolveValue(obj[k]);
                }
                return out;
            }

            return value;
        }

        for (let i = 0, len = config.elements.length; i < len; i++) {
            const element = config.elements[i];
            const resolved = resolveValue(element);
            resolvedElements.push(
                /** @type {ResolvedCoverElement} */ (resolved)
            );
        }

        return {
            type: "cover-page",
            id: this.generateId("cover"),
            config,
            elements: resolvedElements
        };
    }

    /**
     * Build TOC node structure
     * @param {TocConfig} config
     * @param {ReadonlyArray<ComposedSection>} sections
     * @returns {TocNode}
     */
    buildTocNode(config, sections) {
        /** @type {TocEntry[]} */
        const entries = [];
        const levels = config.levels ?? [1, 2, 3];
        const levelSet = new Set(levels);

        // Collect headings from all sections
        for (let i = 0, len = sections.length; i < len; i++) {
            const section = sections[i];
            this.collectTocEntries(section.content, entries, levelSet, config);
        }

        return {
            type: "toc",
            id: this.generateId("toc"),
            config,
            entries
        };
    }

    /**
     * Recursively collect TOC entries from nodes
     * @param {ReadonlyArray<BaseNode>} nodes
     * @param {TocEntry[]} entries
     * @param {Set<number>} levels
     * @param {TocConfig} config
     * @returns {void}
     */
    collectTocEntries(nodes, entries, levels, config) {
        for (let i = 0, len = nodes.length; i < len; i++) {
            const node = nodes[i];

            if (node.type === "heading") {
                const level =
                    /** @type {any} */ (node).level ??
                    /** @type {number} */ (node.attrs?.level) ??
                    1;
                if (levels.has(level)) {
                    const title = this.extractTextContent(node);
                    const style = config.entryStyles?.find(
                        (s) => s.level === level
                    );

                    entries.push({
                        nodeId: node.id,
                        level,
                        title,
                        page: 0, // Populated after layout
                        style
                    });
                }
            }

            // Also handle legal article/section nodes
            if (node.type === "article" || node.type === "section") {
                const level = node.type === "article" ? 1 : 2;
                if (levels.has(level)) {
                    const title =
                        /** @type {any} */ (node).title ??
                        /** @type {string} */ (node.attrs?.title) ??
                        this.extractTextContent(node);

                    entries.push({
                        nodeId: node.id,
                        level,
                        title,
                        page: 0,
                        style: config.entryStyles?.find(
                            (s) => s.level === level
                        )
                    });
                }
            }

            // Recurse into children
            if (node.children.length > 0) {
                this.collectTocEntries(node.children, entries, levels, config);
            }
        }
    }

    /**
     * Extract text content from a node tree
     * @param {BaseNode} node
     * @returns {string}
     */
    extractTextContent(node) {
        if (node.type === "text") {
            return typeof node.getTextContent === "function"
                ? node.getTextContent()
                : /** @type {string} */ (node.attrs?.text) ?? "";
        }

        let text = "";
        for (let i = 0, len = node.children.length; i < len; i++) {
            text += this.extractTextContent(node.children[i]);
        }
        return text;
    }

    /**
     * Update TOC entries with page numbers after layout
     * @param {TocNode} toc
     * @param {LayoutResult} layoutResult
     * @returns {void}
     */
    updateTocPages(toc, layoutResult) {
        for (let i = 0, len = toc.entries.length; i < len; i++) {
            const entry = toc.entries[i];
            const page = layoutResult.nodePageMap.get(entry.nodeId);
            if (page !== undefined) {
                entry.page = page;
            }
        }
    }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a legal document composition config
 * @param {{ companyName: string | number; documentTitle: string | number; jurisdiction?: string | number; effectiveDate?: string | number }} options
 * @returns {CompositeDocumentConfig}
 */
export function createLegalDocumentConfig(options) {
    /** @type {VariableRef} */
    const pageVar = { type: "variable", name: "page" };
    /** @type {VariableRef} */
    const totalVar = { type: "variable", name: "totalPages" };

    return {
        coverPage: {
            elements: [
                { type: "spacer", height: 200 },
                {
                    type: "text",
                    content: String(options.documentTitle),
                    style: {
                        fontSize: 24,
                        bold: true,
                        align: "center",
                        textTransform: "uppercase"
                    }
                },
                { type: "spacer", height: 40 },
                {
                    type: "text",
                    content: "OF",
                    style: { fontSize: 14, align: "center" }
                },
                { type: "spacer", height: 40 },
                {
                    type: "text",
                    content: String(options.companyName),
                    style: {
                        fontSize: 20,
                        bold: true,
                        align: "center",
                        textTransform: "uppercase"
                    }
                },
                { type: "spacer", height: 40 },
                {
                    type: "text",
                    content: options.jurisdiction
                        ? `A ${options.jurisdiction} Company`
                        : "",
                    style: { fontSize: 12, align: "center" }
                },
                { type: "spacer", height: 100 },
                {
                    type: "text",
                    content: String(options.effectiveDate ?? ""),
                    style: { fontSize: 12, align: "center" }
                }
            ],
            countsInPageNumbers: false
        },
        toc: {
            title: "TABLE OF CONTENTS",
            titleStyle: { fontSize: 16, bold: true, align: "center" },
            levels: [1, 2],
            showPageNumbers: true,
            entryStyles: [
                {
                    level: 1,
                    textStyle: { bold: true },
                    indent: 0,
                    leaderStyle: "dots"
                },
                { level: 2, textStyle: {}, indent: 20, leaderStyle: "dots" }
            ]
        },
        sections: [],
        defaultHeaders: [
            {
                location: "header",
                pages: "not-first",
                columns: {
                    center: {
                        content: String(options.documentTitle),
                        style: { fontSize: 10 }
                    }
                },
                priority: 0
            }
        ],
        defaultFooters: [
            {
                location: "footer",
                pages: "not-first",
                columns: {
                    center: {
                        content: [pageVar, " of ", totalVar],
                        style: { fontSize: 10 }
                    }
                },
                priority: 0
            }
        ],
        defaultPageConfig: {
            size: "letter",
            margins: { top: 72, bottom: 72, left: 72, right: 72 }
        }
    };
}

/**
 * Create composer instance
 * @param {CompositeDocumentConfig} config
 * @returns {DocumentComposer}
 */
export function createDocumentComposer(config) {
    return new DocumentComposer(config);
}
