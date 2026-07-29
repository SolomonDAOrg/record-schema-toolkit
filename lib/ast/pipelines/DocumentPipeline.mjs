/**
 * DocumentPipeline - Orchestrates document generation with separate phases
 * Phase 1: Formatting (apply FormattingPack rules, normalize AST)
 * Phase 2: Composition (merge documents, generate cover/TOC)
 * Phase 3: Rendering (layout + output generation)
 * @module format-ast/core/DocumentPipeline
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
 * @typedef {import("../types/core.mjs").RenderCapabilities} RenderCapabilities
 * @typedef {import("../types/core.mjs").RenderResult} RenderResult
 * @typedef {import("../types/core.mjs").FormattingRule} FormattingRule
 * @typedef {import("../types/core.mjs").FormattingContext} FormattingContext
 * @typedef {import("../types/core.mjs").FormattingResult} FormattingResult
 * @typedef {import("../types/core.mjs").CompositionResult} CompositionResult
 * @typedef {import("../types/core.mjs").PipelineResult} PipelineResult
 */

// =============================================================================
// Renderer Interface
// =============================================================================

/**
 * @typedef {Object} DocumentRenderer
 * @property {() => string} getName
 * @property {() => string} getMimeType
 * @property {() => string} getExtension
 * @property {() => RenderCapabilities} getCapabilities
 * @property {(sections: ReadonlyArray<ComposedSection>, coverPage?: CoverPageNode | null, toc?: TocNode | null) => RenderResult} render
 */

// =============================================================================
// FormattingPhase
// =============================================================================

export class FormattingPhase {
    constructor() {
        /** @type {FormattingRule[]} */
        this.rules = [];
    }

    /**
     * Add formatting rule
     * @param {FormattingRule} rule
     * @returns {this}
     */
    addRule(rule) {
        this.rules.push(rule);
        return this;
    }

    /**
     * Add multiple rules
     * @param {ReadonlyArray<FormattingRule>} rules
     * @returns {this}
     */
    addRules(rules) {
        for (let i = 0, len = rules.length; i < len; i++) {
            this.rules.push(rules[i]);
        }
        return this;
    }

    /**
     * Apply formatting rules to a document
     * @param {DocumentSource} source
     * @returns {FormattingResult}
     */
    format(source) {
        /** @type {string[]} */
        const warnings = [];

        // Normalize metadata to Record<string, string> to match FormattingContext type
        /** @type {Record<string, string>} */
        const normalizedMeta = {};
        if (source.metadata) {
            for (const [key, val] of Object.entries(source.metadata)) {
                normalizedMeta[key] = Array.isArray(val)
                    ? val.join(", ")
                    : String(val);
            }
        }

        /** @type {FormattingContext} */
        const context = {
            variables: source.variables ?? {},
            metadata: normalizedMeta
        };

        // Clone and transform the document tree
        const transformedRoot = this.transformNode(source.root, context);

        return {
            document: {
                ...source,
                root: transformedRoot
            },
            warnings
        };
    }

    /**
     * Transform a node and its children
     * @param {BaseNode} node
     * @param {FormattingContext} context
     * @returns {BaseNode}
     */
    transformNode(node, context) {
        let result = node;

        // Apply matching rules
        for (let i = 0, len = this.rules.length; i < len; i++) {
            const rule = this.rules[i];
            if (rule.match(result)) {
                result = rule.transform(result, context);
            }
        }

        // Transform children
        if (result.children.length > 0) {
            /** @type {BaseNode[]} */
            const newChildren = [];
            for (let i = 0, len = result.children.length; i < len; i++) {
                newChildren.push(
                    this.transformNode(result.children[i], context)
                );
            }
            result = { ...result, children: newChildren };
        }

        return result;
    }
}

// =============================================================================
// CompositionPhase
// =============================================================================

export class CompositionPhase {
    constructor() {
        /** @type {number} */
        this.nodeIdCounter = 0;
    }

    /**
     * @param {string} prefix
     * @returns {string}
     */
    generateId(prefix) {
        return `${prefix}_${++this.nodeIdCounter}`;
    }

    /**
     * Compose multiple documents into a single composite document
     * @param {ReadonlyArray<DocumentSource>} sources
     * @param {CompositeDocumentConfig} config
     * @returns {CompositionResult}
     */
    compose(sources, config) {
        // Merge variables from all sources
        /** @type {Record<string, string | number>} */
        const variables = {};
        for (let i = 0, len = sources.length; i < len; i++) {
            const src = sources[i];
            if (src.variables) {
                for (const key of Object.keys(src.variables)) {
                    variables[key] = src.variables[key];
                }
            }
        }

        // Build sections
        /** @type {ComposedSection[]} */
        const sections = [];
        for (let i = 0, len = sources.length; i < len; i++) {
            const source = sources[i];
            const sectionConfig = this.resolveSectionConfig(source, i, config);

            // Ensure name is a string, even if source name was array
            let sourceName = Array.isArray(source.name)
                ? source.name.join(" ")
                : source.name;

            if (!sourceName) {
                sourceName = Array.isArray(sectionConfig.name)
                    ? sectionConfig.name.join(" ")
                    : sectionConfig.name;
            }

            sections.push({
                id: sectionConfig.id,
                name: sourceName,
                config: sectionConfig,
                content: source.root.children
            });
        }

        this.applyLeadingSectionModes(sections);

        // Build cover page
        const coverPage = config.coverPage
            ? this.buildCoverPage(config.coverPage, variables)
            : null;

        // Build TOC structure
        const toc = config.toc ? this.buildToc(config.toc, sections) : null;

        return {
            coverPage,
            toc,
            sections,
            variables
        };
    }

    /**
     * @param {ComposedSection[]} sections
     * @returns {void}
     */
    applyLeadingSectionModes(sections) {
        for (let i = 0, len = sections.length; i < len; i++) {
            const section = sections[i];
            const leadingSection = section.config?.leadingSection;
            const mode = leadingSection?.mode;

            if (mode === "centered-title-block") {
                this.applyCenteredLeadingTitleBlock(section.content);
            }
        }
    }

    /**
     * @param {readonly BaseNode[] | BaseNode[]} nodes
     * @returns {void}
     */
    applyCenteredLeadingTitleBlock(nodes) {
        let sawEligible = false;

        for (let i = 0, len = nodes.length; i < len; i++) {
            const node = nodes[i];

            if (node.type === "horizontal-rule") {
                break;
            }

            if (this.isLeadingTitleBlockMetadataNode(node)) {
                break;
            }

            if (node.type !== "heading" && node.type !== "paragraph") {
                break;
            }

            sawEligible = true;

            node.attrs = {
                ...(node.attrs ?? {}),
                align: "center",
                textAlign: "center"
            };

            if (
                node.type === "heading" &&
                /** @type {any} */ (node).level !== 1
            ) {
                /** @type {any} */ (node).includeInToc = false;
                node.attrs = {
                    ...(node.attrs ?? {}),
                    includeInToc: false
                };
            }
        }

        if (!sawEligible) {
            return;
        }
    }

    /**
     * @param {BaseNode} node
     * @returns {boolean}
     */
    isLeadingTitleBlockMetadataNode(node) {
        if (node.type !== "paragraph") {
            return false;
        }

        const plainText = this.extractText(node).trim();
        if (plainText.length === 0) {
            return false;
        }

        const firstColon = plainText.indexOf(":");
        if (firstColon <= 0 || firstColon > 40) {
            return false;
        }

        const firstChild = node.children[0];
        if (!firstChild) {
            return false;
        }

        const formatType =
            /** @type {any} */ (firstChild).formatType ??
            /** @type {any} */ (firstChild).format_type ??
            firstChild.attrs?.formatType ??
            firstChild.attrs?.format_type;

        if (
            firstChild.type === "inline-format" &&
            (formatType === "bold" || formatType === "strong")
        ) {
            const labelText = this.extractText(firstChild).trim();
            return labelText.endsWith(":");
        }

        return false;
    }

    /**
     * @param {DocumentSource} source
     * @param {number} index
     * @param {CompositeDocumentConfig} config
     * @returns {SectionConfig}
     */
    resolveSectionConfig(source, index, config) {
        const sourceName = Array.isArray(source.name)
            ? source.name.join(" ")
            : source.name;

        /** @type {SectionConfig} */
        const baseConfig = config.sections[index] ?? {
            id: source.id,
            name: sourceName
        };

        return {
            ...baseConfig,
            id: baseConfig.id ?? source.id,
            pageConfig: {
                ...config.defaultPageConfig,
                ...baseConfig.pageConfig
            },
            headers: baseConfig.headers ?? config.defaultHeaders,
            footers: baseConfig.footers ?? config.defaultFooters
        };
    }

    /**
     * @param {CoverPageConfig} config
     * @param {Readonly<Record<string, string | number>>} variables
     * @returns {CoverPageNode}
     */
    buildCoverPage(config, variables) {
        const elements = config.elements.map((el) =>
            this.resolveCoverElement(el, variables)
        );

        return {
            type: "cover-page",
            id: this.generateId("cover"),
            config,
            elements
        };
    }

    /**
     * Resolve cover-page element fields, preserving non-content properties.
     * Supports VariableRef and mixed arrays for text fields.
     * @param {CoverPageElement} el
     * @param {Readonly<Record<string, string | number>>} variables
     * @returns {ResolvedCoverElement}
     */
    resolveCoverElement(el, variables) {
        /** @type {any} */
        const out = { ...el };

        /**
         * Deep-resolve VariableRef and mixed-text arrays, while preserving
         * structured arrays/objects (e.g. kv-block rows).
         *
         * @param {unknown} value
         * @returns {any}
         */
        const deepResolve = (value) => {
            if (value === null || value === undefined) {
                return value;
            }

            // VariableRef (object form)
            if (
                typeof value === "object" &&
                !Array.isArray(value) &&
                /** @type {any} */ (value).type === "variable"
            ) {
                return this.resolveCoverText(value, variables);
            }

            // Arrays: resolve mixed-text arrays to string; otherwise recurse
            if (Array.isArray(value)) {
                let isMixedText = true;
                for (let i = 0, len = value.length; i < len; i++) {
                    const item = value[i];
                    const isVar =
                        item &&
                        typeof item === "object" &&
                        !Array.isArray(item) &&
                        /** @type {any} */ (item).type === "variable";
                    const isPrim =
                        typeof item === "string" ||
                        typeof item === "number" ||
                        typeof item === "boolean";
                    if (!isVar && !isPrim) {
                        isMixedText = false;
                        break;
                    }
                }

                if (isMixedText) {
                    return this.resolveCoverText(value, variables);
                }

                /** @type {any[]} */
                const mapped = new Array(value.length);
                for (let i = 0, len = value.length; i < len; i++) {
                    mapped[i] = deepResolve(value[i]);
                }
                return mapped;
            }

            // Objects: recurse into properties (skip style)
            if (typeof value === "object") {
                /** @type {any} */
                const obj = { .../** @type {any} */ (value) };
                const keys = Object.keys(obj);
                for (let i = 0, len = keys.length; i < len; i++) {
                    const k = keys[i];
                    if (k === "style") {
                        continue;
                    }
                    obj[k] = deepResolve(obj[k]);
                }
                return obj;
            }

            // Primitives pass through
            return value;
        };

        // Deep-resolve element fields
        const keys = Object.keys(out);
        for (let i = 0, len = keys.length; i < len; i++) {
            const key = keys[i];
            if (key === "style") {
                continue;
            }
            out[key] = deepResolve(out[key]);
        }

        // Ensure canonical string fields are resolved
        if ("content" in out) {
            out.content = this.resolveCoverText(out.content, variables);
        }
        if ("title" in out) {
            out.title = this.resolveCoverText(out.title, variables);
        }
        if ("conjunction" in out) {
            out.conjunction = this.resolveCoverText(out.conjunction, variables);
        }
        if ("entityName" in out) {
            out.entityName = this.resolveCoverText(out.entityName, variables);
        }

        return /** @type {any} */ (out);
    }

    /**
     * Resolve a "mixed" text value: string | VariableRef | Array<(string|VariableRef|number)>
     * @param {unknown} value
     * @param {Readonly<Record<string, string | number>>} variables
     * @returns {string}
     */
    resolveCoverText(value, variables) {
        if (value === null || value === undefined) {
            return "";
        }
        if (typeof value === "string") {
            return value;
        }
        if (typeof value === "number" || typeof value === "boolean") {
            return String(value);
        }
        if (Array.isArray(value)) {
            let out = "";
            for (let i = 0, len = value.length; i < len; i++) {
                out += this.resolveCoverText(value[i], variables);
            }
            return out;
        }
        if (typeof value === "object") {
            const v = /** @type {{ type?: unknown; name?: unknown }} */ (value);
            if (v.type === "variable" && typeof v.name === "string") {
                return this.resolveVariable(/** @type {any} */ (v), variables);
            }
        }
        return "";
    }

    /**
     * @param {{ type: "variable"; name: string } | undefined} ref
     * @param {Readonly<Record<string, string | number>>} variables
     * @returns {string}
     */
    resolveVariable(ref, variables) {
        if (!ref) {
            return "";
        }
        const value = variables[ref.name];
        return value !== undefined ? String(value) : "";
    }

    /**
     * @param {TocConfig} config
     * @param {ReadonlyArray<ComposedSection>} sections
     * @returns {TocNode}
     */
    buildToc(config, sections) {
        /** @type {TocEntry[]} */
        const entries = [];
        const levels = new Set(config.levels ?? [1, 2, 3]);

        for (let i = 0, len = sections.length; i < len; i++) {
            this.collectTocEntries(sections[i].content, entries, levels);
        }

        return {
            type: "toc",
            id: this.generateId("toc"),
            config,
            entries
        };
    }

    /**
     * @param {ReadonlyArray<BaseNode>} nodes
     * @param {TocEntry[]} entries
     * @param {Set<number>} levels
     * @returns {void}
     */
    collectTocEntries(nodes, entries, levels) {
        for (let i = 0, len = nodes.length; i < len; i++) {
            const node = nodes[i];

            if (node.type === "heading") {
                const level =
                    /** @type {any} */ (node).level ??
                    /** @type {number} */ (node.attrs?.level) ??
                    1;

                const includeInToc =
                    /** @type {any} */ (node).includeInToc !== false &&
                    /** @type {any} */ (node.attrs?.includeInToc) !== false;

                if (includeInToc && levels.has(level)) {
                    entries.push({
                        nodeId: node.id,
                        level,
                        title: this.extractText(node),
                        page: 0
                    });
                }
            }

            if (node.type === "article") {
                if (levels.has(1)) {
                    const title =
                        typeof (/** @type {any} */ (node).getHeading) ===
                        "function"
                            ? /** @type {any} */ (node).getHeading()
                            : /** @type {any} */ (node).title ??
                              /** @type {string} */ (node.attrs?.title) ??
                              this.extractText(node);

                    entries.push({
                        nodeId: node.id,
                        level: 1,
                        title,
                        page: 0
                    });
                }
            }

            if (node.type === "section") {
                if (levels.has(2)) {
                    const title =
                        typeof (/** @type {any} */ (node).getHeading) ===
                        "function"
                            ? /** @type {any} */ (node).getHeading()
                            : /** @type {any} */ (node).title ??
                              /** @type {string} */ (node.attrs?.title) ??
                              this.extractText(node);

                    entries.push({
                        nodeId: node.id,
                        level: 2,
                        title,
                        page: 0
                    });
                }
            }

            if (node.children.length > 0) {
                this.collectTocEntries(node.children, entries, levels);
            }
        }
    }

    /**
     * @param {BaseNode} node
     * @returns {string}
     */
    extractText(node) {
        if (node.type === "text") {
            return typeof node.getTextContent === "function"
                ? node.getTextContent()
                : /** @type {string} */ (node.attrs?.text) ??
                      /** @type {any} */ (node).text ??
                      "";
        }
        let text = "";
        for (let i = 0, len = node.children.length; i < len; i++) {
            text += this.extractText(node.children[i]);
        }
        return text;
    }
}

// =============================================================================
// RenderingPhase
// =============================================================================

export class RenderingPhase {
    constructor() {
        /** @type {DocumentRenderer | null} */
        this.renderer = null;
    }

    /**
     * @param {DocumentRenderer} renderer
     * @returns {this}
     */
    setRenderer(renderer) {
        this.renderer = renderer;
        return this;
    }

    /**
     * @returns {DocumentRenderer | null}
     */
    getRenderer() {
        return this.renderer;
    }

    /**
     * @param {CompositionResult} composition
     * @returns {RenderResult}
     */
    render(composition) {
        if (!this.renderer) {
            return {
                success: false,
                output: null,
                mimeType: "",
                warnings: [],
                errors: ["No renderer configured"],
                pageCount: 0
            };
        }

        return this.renderer.render(
            composition.sections,
            composition.coverPage,
            composition.toc
        );
    }
}

// =============================================================================
// DocumentPipeline
// =============================================================================

/**
 * @typedef {Object} PipelineOptions
 * @property {boolean} [skipFormatting]
 * @property {boolean} [skipComposition]
 * @property {boolean} [skipRendering]
 */

export class DocumentPipeline {
    constructor() {
        /** @type {FormattingPhase} */
        this.formattingPhase = new FormattingPhase();
        /** @type {CompositionPhase} */
        this.compositionPhase = new CompositionPhase();
        /** @type {RenderingPhase} */
        this.renderingPhase = new RenderingPhase();
        /** @type {CompositeDocumentConfig | null} */
        this.compositionConfig = null;
    }

    // =========================================================================
    // Configuration
    // =========================================================================

    /**
     * Add formatting rule
     * @param {FormattingRule} rule
     * @returns {this}
     */
    addFormattingRule(rule) {
        this.formattingPhase.addRule(rule);
        return this;
    }

    /**
     * Add multiple formatting rules
     * @param {ReadonlyArray<FormattingRule>} rules
     * @returns {this}
     */
    addFormattingRules(rules) {
        this.formattingPhase.addRules(rules);
        return this;
    }

    /**
     * Set composition configuration
     * @param {CompositeDocumentConfig} config
     * @returns {this}
     */
    setCompositionConfig(config) {
        this.compositionConfig = config;
        return this;
    }

    /**
     * Set renderer
     * @param {DocumentRenderer} renderer
     * @returns {this}
     */
    setRenderer(renderer) {
        this.renderingPhase.setRenderer(renderer);
        return this;
    }

    // =========================================================================
    // Execution
    // =========================================================================

    /**
     * Run full pipeline on a single document
     * @param {DocumentSource} source
     * @param {PipelineOptions} [options]
     * @returns {PipelineResult}
     */
    processSingle(source, options = {}) {
        return this.process([source], options);
    }

    /**
     * Run full pipeline on multiple documents
     * @param {ReadonlyArray<DocumentSource>} sources
     * @param {PipelineOptions} [options]
     * @returns {PipelineResult}
     */
    process(sources, options = {}) {
        /** @type {string[]} */
        const warnings = [];
        /** @type {string[]} */
        const errors = [];

        // Phase 1: Formatting
        /** @type {DocumentSource[]} */
        let formattedSources = [];
        /** @type {FormattingResult | undefined} */
        let formattingResult;

        if (!options.skipFormatting) {
            for (let i = 0, len = sources.length; i < len; i++) {
                const result = this.formattingPhase.format(sources[i]);
                formattedSources.push(result.document);
                for (let j = 0, jlen = result.warnings.length; j < jlen; j++) {
                    warnings.push(result.warnings[j]);
                }
            }
            if (formattedSources.length === 1) {
                formattingResult = {
                    document: formattedSources[0],
                    warnings: []
                };
            }
        } else {
            formattedSources = sources.map((s) => s);
        }

        // Phase 2: Composition
        /** @type {CompositionResult | undefined} */
        let compositionResult;

        if (!options.skipComposition && this.compositionConfig) {
            compositionResult = this.compositionPhase.compose(
                formattedSources,
                this.compositionConfig
            );
        } else if (!options.skipComposition) {
            // Create simple composition without special features
            compositionResult = {
                coverPage: null,
                toc: null,
                sections: formattedSources.map((src, idx) => {
                    const srcName = Array.isArray(src.name)
                        ? src.name.join(" ")
                        : src.name;
                    return {
                        id: src.id,
                        name: srcName,
                        config: {
                            id: src.id,
                            name: srcName
                        },
                        content: src.root.children
                    };
                }),
                variables: formattedSources.reduce(
                    (acc, src) => ({
                        ...acc,
                        ...(src.variables ?? {})
                    }),
                    {}
                )
            };
        }

        // Phase 3: Rendering
        /** @type {RenderResult | undefined} */
        let renderResult;

        if (!options.skipRendering && compositionResult) {
            renderResult = this.renderingPhase.render(compositionResult);

            for (let i = 0, len = renderResult.warnings.length; i < len; i++) {
                warnings.push(renderResult.warnings[i]);
            }
            for (let i = 0, len = renderResult.errors.length; i < len; i++) {
                errors.push(renderResult.errors[i]);
            }
        }

        return {
            success: renderResult?.success ?? true,
            formattingResult,
            compositionResult,
            renderResult,
            warnings,
            errors
        };
    }

    // =========================================================================
    // Phase Access (for advanced usage)
    // =========================================================================

    /**
     * @returns {FormattingPhase}
     */
    getFormattingPhase() {
        return this.formattingPhase;
    }

    /**
     * @returns {CompositionPhase}
     */
    getCompositionPhase() {
        return this.compositionPhase;
    }

    /**
     * @returns {RenderingPhase}
     */
    getRenderingPhase() {
        return this.renderingPhase;
    }
}

// =============================================================================
// Built-in Formatting Rules
// =============================================================================

/**
 * Create rule that applies text styles to headings
 * @param {Record<number, TextStyle>} styles
 * @returns {FormattingRule}
 */
export function createHeadingStyleRule(styles) {
    return {
        id: "heading-styles",
        description: "Apply text styles to headings by level",
        match: (node) => node.type === "heading",
        transform: (node) => {
            const level = /** @type {number} */ (node.attrs?.level) ?? 1;
            const style = styles[level];
            if (style) {
                return {
                    ...node,
                    textStyle: { ...node.textStyle, ...style }
                };
            }
            return node;
        }
    };
}

/**
 * Create rule that applies keep-together to legal nodes
 * @returns {FormattingRule}
 */
export function createLegalKeepTogetherRule() {
    return {
        id: "legal-keep-together",
        description: "Apply keep-together rules to legal nodes",
        match: (node) => {
            const legalTypes = new Set([
                "definition",
                "signature-block",
                "notice"
            ]);
            return legalTypes.has(node.type);
        },
        transform: (node) => {
            return {
                ...node,
                keepRules: {
                    ...node.keepRules,
                    keepTogether: true
                }
            };
        }
    };
}

/**
 * Create rule that forces page break before articles
 * @returns {FormattingRule}
 */
export function createArticlePageBreakRule() {
    return {
        id: "article-page-break",
        description: "Force page break before articles",
        match: (node) => node.type === "article",
        transform: (node) => {
            return {
                ...node,
                keepRules: {
                    ...node.keepRules,
                    pageBreakBefore: true
                }
            };
        }
    };
}

export function createPartOnlyPartPageBreakRule() {
    return {
        id: "part-only-part-page-break",
        description:
            'In "part-only" break mode, allow page breaks before Part-level nodes (sections/headings).',
        match: (node) => node.type === "section" || node.type === "heading",
        transform: (node, context) => {
            const breakMode =
                context?.variables?.break_mode ??
                context?.variables?.breakMode ??
                null;
            if (breakMode !== "part-only") return node;
            return {
                ...node,
                keepRules: { ...(node.keepRules ?? {}), pageBreakBefore: true }
            };
        }
    };
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new document pipeline
 * @returns {DocumentPipeline}
 */
export function createDocumentPipeline() {
    return new DocumentPipeline();
}

/**
 * Create pipeline pre-configured for legal documents
 * @param {CompositeDocumentConfig} config
 * @returns {DocumentPipeline}
 */
export function createLegalDocumentPipeline(config) {
    return new DocumentPipeline()
        .addFormattingRules([
            createLegalKeepTogetherRule(),
            createArticlePageBreakRule(),
            createPartOnlyPartPageBreakRule()
        ])
        .setCompositionConfig(config);
}
