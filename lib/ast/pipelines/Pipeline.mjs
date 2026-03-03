/**
 * Pipeline - Orchestrates the document transformation pipeline
 * @module format-ast/Pipeline
 */

import { BaseNode } from "../nodes/BaseNode.mjs";
import { BaseDocument, ProseDocument } from "../documents/BaseDocument.mjs";
import { BaseRenderer } from "../renderers/BaseRenderer.mjs";
import { FormattingPackAdapter } from "../adapters/FormattingPackAdapter.mjs";
import { RenderPackAdapter } from "../adapters/RenderPackAdapter.mjs";

/**
 * @typedef {import("../types/core.mjs").NodeType} NodeType
 * @typedef {import("../types/core.mjs").RenderCapabilities} RenderCapabilities
 * @typedef {import("../renderers/BaseRenderer.mjs").RenderResult} RenderResult
 * @typedef {import("../renderers/BaseRenderer.mjs").RenderOptions} RenderOptions
 * @typedef {import("../adapters/RenderPackAdapter.mjs").ResolvedRenderConfig} ResolvedRenderConfig
 */

// =============================================================================
// Transform Rule Types
// =============================================================================

/**
 * @typedef {Object} TransformRule
 * @property {string} id
 * @property {string} [description]
 * @property {(node: BaseNode) => boolean} match - Predicate to match nodes
 * @property {(node: BaseNode, context: TransformContext) => BaseNode | BaseNode[] | null} transform
 */

/**
 * @typedef {Object} TransformContext
 * @property {BaseDocument} document
 * @property {FormattingPackAdapter | null} formattingAdapter
 * @property {RenderPackAdapter | null} renderAdapter
 * @property {Record<string, unknown>} variables
 */

/**
 * @typedef {Object} ValidationIssue
 * @property {"error" | "warning" | "info"} severity
 * @property {string} message
 * @property {string} [nodeId]
 * @property {string} [path]
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {ValidationIssue[]} issues
 */

/**
 * @typedef {Object} PipelineResult
 * @property {boolean} success
 * @property {BaseDocument | null} document
 * @property {RenderResult | null} renderResult
 * @property {ValidationIssue[]} validationIssues
 * @property {string[]} warnings
 * @property {string[]} errors
 */

// =============================================================================
// Pipeline Stage Classes
// =============================================================================

/**
 * Validation stage - runs validation rules on document
 */
export class ValidationStage {
    constructor() {
        /** @type {Array<(doc: BaseDocument) => ValidationIssue[]>} */
        this._validators = [];
    }

    /**
     * Add validator function
     * @param {(doc: BaseDocument) => ValidationIssue[]} validator
     * @returns {this}
     */
    addValidator(validator) {
        this._validators.push(validator);
        return this;
    }

    /**
     * Run all validators
     * @param {BaseDocument} document
     * @returns {ValidationResult}
     */
    validate(document) {
        /** @type {ValidationIssue[]} */
        const issues = [];

        for (let i = 0, len = this._validators.length; i < len; i++) {
            const validatorIssues = this._validators[i](document);
            for (let j = 0, jlen = validatorIssues.length; j < jlen; j++) {
                issues.push(validatorIssues[j]);
            }
        }

        const hasErrors = issues.some((issue) => issue.severity === "error");

        return {
            valid: !hasErrors,
            issues
        };
    }
}

/**
 * Transform stage - applies transformation rules to document
 */
export class TransformStage {
    constructor() {
        /** @type {TransformRule[]} */
        this._rules = [];
    }

    /**
     * Add transformation rule
     * @param {TransformRule} rule
     * @returns {this}
     */
    addRule(rule) {
        this._rules.push(rule);
        return this;
    }

    /**
     * Add multiple rules
     * @param {TransformRule[]} rules
     * @returns {this}
     */
    addRules(rules) {
        for (let i = 0, len = rules.length; i < len; i++) {
            this._rules.push(rules[i]);
        }
        return this;
    }

    /**
     * Apply all transforms to document
     * @param {BaseDocument} document
     * @param {TransformContext} context
     * @returns {BaseDocument}
     */
    transform(document, context) {
        // Clone to avoid mutation
        const doc = document.clone();

        for (let i = 0, len = this._rules.length; i < len; i++) {
            const rule = this._rules[i];
            doc.transform((node) => {
                if (rule.match(node)) {
                    return rule.transform(node, context);
                }
                return node;
            });
        }

        return doc;
    }
}

/**
 * Render stage - handles renderer selection and execution
 */
export class RenderStage {
    /**
     * @param {BaseRenderer} renderer
     */
    constructor(renderer) {
        /** @type {BaseRenderer} */
        this._renderer = renderer;
    }

    /**
     * Get renderer capabilities
     * @returns {RenderCapabilities}
     */
    getCapabilities() {
        return this._renderer.getCapabilities();
    }

    /**
     * Check if renderer supports node type
     * @param {NodeType} type
     * @returns {boolean}
     */
    supportsNodeType(type) {
        return this._renderer.supportsNodeType(type);
    }

    /**
     * Render document
     * @param {BaseDocument} document
     * @param {RenderOptions} [options]
     * @returns {RenderResult}
     */
    render(document, options) {
        return this._renderer.render(document, options);
    }
}

// =============================================================================
// Pipeline Class
// =============================================================================

/**
 * Main pipeline class - orchestrates load → validate → transform → render
 */
export class Pipeline {
    /**
     * @param {Object} [options]
     * @param {FormattingPackAdapter | null} [options.formattingAdapter]
     * @param {RenderPackAdapter | null} [options.renderAdapter]
     */
    constructor(options = {}) {
        /** @type {FormattingPackAdapter | null} */
        this._formattingAdapter = options.formattingAdapter || null;

        /** @type {RenderPackAdapter | null} */
        this._renderAdapter = options.renderAdapter || null;

        /** @type {ValidationStage} */
        this._validationStage = new ValidationStage();

        /** @type {TransformStage} */
        this._transformStage = new TransformStage();

        /** @type {RenderStage | null} */
        this._renderStage = null;

        /** @type {string[]} */
        this._warnings = [];

        /** @type {string[]} */
        this._errors = [];
    }

    // =========================================================================
    // Configuration
    // =========================================================================

    /**
     * Set formatting pack adapter (source validation/normalization)
     * @param {FormattingPackAdapter} adapter
     * @returns {this}
     */
    setFormattingAdapter(adapter) {
        this._formattingAdapter = adapter;
        return this;
    }

    /**
     * Set render pack adapter (output styling)
     * @param {RenderPackAdapter} adapter
     * @returns {this}
     */
    setRenderAdapter(adapter) {
        this._renderAdapter = adapter;
        return this;
    }

    /**
     * Set renderer
     * @param {BaseRenderer} renderer
     * @returns {this}
     */
    setRenderer(renderer) {
        this._renderStage = new RenderStage(renderer);
        return this;
    }

    /**
     * Add validation rule
     * @param {(doc: BaseDocument) => ValidationIssue[]} validator
     * @returns {this}
     */
    addValidator(validator) {
        this._validationStage.addValidator(validator);
        return this;
    }

    /**
     * Add transform rule
     * @param {TransformRule} rule
     * @returns {this}
     */
    addTransformRule(rule) {
        this._transformStage.addRule(rule);
        return this;
    }

    /**
     * Add multiple transform rules
     * @param {TransformRule[]} rules
     * @returns {this}
     */
    addTransformRules(rules) {
        this._transformStage.addRules(rules);
        return this;
    }

    // =========================================================================
    // Execution
    // =========================================================================

    /**
     * Validate document
     * @param {BaseDocument} document
     * @returns {ValidationResult}
     */
    validate(document) {
        return this._validationStage.validate(document);
    }

    /**
     * Transform document
     * @param {BaseDocument} document
     * @returns {BaseDocument}
     */
    transform(document) {
        const context = this._buildTransformContext(document);
        return this._transformStage.transform(document, context);
    }

    /**
     * Render document
     * @param {BaseDocument} document
     * @param {RenderOptions} [options]
     * @returns {RenderResult}
     */
    render(document, options) {
        if (!this._renderStage) {
            return {
                success: false,
                output: null,
                errors: ["No renderer configured"],
                warnings: []
            };
        }
        return this._renderStage.render(document, options);
    }

    /**
     * Run full pipeline: validate → transform → render
     * @param {BaseDocument} document
     * @param {Object} [options]
     * @param {boolean} [options.skipValidation]
     * @param {boolean} [options.skipTransform]
     * @param {RenderOptions} [options.renderOptions]
     * @returns {PipelineResult}
     */
    execute(document, options = {}) {
        this._warnings = [];
        this._errors = [];

        /** @type {ValidationIssue[]} */
        let validationIssues = [];

        // 1. Validation
        if (!options.skipValidation) {
            const validationResult = this._validationStage.validate(document);
            validationIssues = validationResult.issues;

            if (!validationResult.valid) {
                return {
                    success: false,
                    document: null,
                    renderResult: null,
                    validationIssues,
                    warnings: this._warnings,
                    errors: ["Validation failed"]
                };
            }
        }

        // 2. Transform
        let transformedDoc = document;
        if (!options.skipTransform) {
            try {
                transformedDoc = this.transform(document);
            } catch (err) {
                const message =
                    err instanceof Error ? err.message : String(err);
                this._errors.push(`Transform failed: ${message}`);
                return {
                    success: false,
                    document: null,
                    renderResult: null,
                    validationIssues,
                    warnings: this._warnings,
                    errors: this._errors
                };
            }
        }

        // 3. Render
        if (!this._renderStage) {
            // No renderer - just return transformed document
            return {
                success: true,
                document: transformedDoc,
                renderResult: null,
                validationIssues,
                warnings: this._warnings,
                errors: this._errors
            };
        }

        const renderResult = this._renderStage.render(
            transformedDoc,
            options.renderOptions
        );

        if (renderResult.warnings) {
            for (let i = 0, len = renderResult.warnings.length; i < len; i++) {
                this._warnings.push(renderResult.warnings[i]);
            }
        }

        if (!renderResult.success && renderResult.errors) {
            for (let i = 0, len = renderResult.errors.length; i < len; i++) {
                this._errors.push(renderResult.errors[i]);
            }
        }

        return {
            success: renderResult.success,
            document: transformedDoc,
            renderResult,
            validationIssues,
            warnings: this._warnings,
            errors: this._errors
        };
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /**
     * Build transform context
     * @param {BaseDocument} document
     * @returns {TransformContext}
     */
    _buildTransformContext(document) {
        return {
            document,
            formattingAdapter: this._formattingAdapter,
            renderAdapter: this._renderAdapter,
            variables: { ...document.variables }
        };
    }

    /**
     * Get renderer capabilities (if renderer set)
     * @returns {RenderCapabilities | null}
     */
    getRendererCapabilities() {
        return this._renderStage?.getCapabilities() || null;
    }
}

// =============================================================================
// Render Transform Rules (use RenderPackAdapter + ResolvedRenderConfig)
// =============================================================================

/**
 * Create transform rule that applies text style from resolved render config
 * @param {RenderPackAdapter} adapter
 * @param {ResolvedRenderConfig} config - Pre-resolved render config
 * @returns {TransformRule}
 */
export function createTextStyleRule(adapter, config) {
    return {
        id: "apply-text-style",
        description: "Apply base text style from render pack",
        match: (node) => node.isType("paragraph") || node.isType("text"),
        transform: (node, _context) => {
            const style = adapter.getBaseTextStyle(config);
            if (Object.keys(style).length > 0) {
                node.setTextStyle(style);
            }
            return node;
        }
    };
}

/**
 * Create transform rule that applies heading styles from resolved render config
 * @param {RenderPackAdapter} adapter
 * @param {ResolvedRenderConfig} config - Pre-resolved render config
 * @returns {TransformRule}
 */
export function createHeadingStyleRule(adapter, config) {
    return {
        id: "apply-heading-style",
        description: "Apply heading styles from render pack",
        match: (node) => node.isType("heading"),
        transform: (node, _context) => {
            // @ts-ignore
            const level = node.level || 1;
            const style = adapter.getHeadingStyle(config, level);
            if (Object.keys(style).length > 0) {
                node.setTextStyle(style);
            }
            return node;
        }
    };
}

/**
 * Create transform rule that applies code block styles from resolved render config
 * @param {RenderPackAdapter} adapter
 * @param {ResolvedRenderConfig} config - Pre-resolved render config
 * @returns {TransformRule}
 */
export function createCodeStyleRule(adapter, config) {
    return {
        id: "apply-code-style",
        description: "Apply code block styles from render pack",
        match: (node) => node.isType("code-block"),
        transform: (node, _context) => {
            const style = adapter.getCodeStyle(config);
            if (Object.keys(style).length > 0) {
                node.setTextStyle(style);
            }
            return node;
        }
    };
}

// =============================================================================
// Built-in Validators
// =============================================================================

/**
 * Create validator that checks for empty document
 * @returns {(doc: BaseDocument) => ValidationIssue[]}
 */
export function createEmptyDocumentValidator() {
    return (doc) => {
        /** @type {ValidationIssue[]} */
        const issues = [];
        if (!doc.hasContent()) {
            issues.push({
                severity: "warning",
                message: "Document has no content"
            });
        }
        return issues;
    };
}

/**
 * Create validator that checks node types against renderer capabilities
 * @param {RenderCapabilities} capabilities
 * @returns {(doc: BaseDocument) => ValidationIssue[]}
 */
export function createCapabilityValidator(capabilities) {
    return (doc) => {
        /** @type {ValidationIssue[]} */
        const issues = [];

        if (!capabilities.supportedNodeTypes) {
            return issues;
        }

        const supported = new Set(capabilities.supportedNodeTypes);

        doc.walk((node) => {
            if (!supported.has(node.type)) {
                issues.push({
                    severity: "warning",
                    message: `Node type "${node.type}" not supported by renderer`,
                    nodeId: node.id
                });
            }
        });

        return issues;
    };
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create pipeline with both formatting and render adapters
 * @param {Object} options
 * @param {FormattingPackAdapter} [options.formattingAdapter]
 * @param {RenderPackAdapter} [options.renderAdapter]
 * @param {ResolvedRenderConfig} [options.renderConfig] - Pre-resolved render config
 * @returns {Pipeline}
 */
export function createPipeline(options = {}) {
    const pipeline = new Pipeline({
        formattingAdapter: options.formattingAdapter || null,
        renderAdapter: options.renderAdapter || null
    });

    // Add render style rules if render adapter AND config provided
    if (options.renderAdapter && options.renderConfig) {
        pipeline.addTransformRules([
            createTextStyleRule(options.renderAdapter, options.renderConfig),
            createHeadingStyleRule(options.renderAdapter, options.renderConfig),
            createCodeStyleRule(options.renderAdapter, options.renderConfig)
        ]);
    }

    // Add standard validators
    pipeline.addValidator(createEmptyDocumentValidator());

    return pipeline;
}

/**
 * Create pipeline for specific file (auto-resolves render config)
 * @param {Object} options
 * @param {FormattingPackAdapter} [options.formattingAdapter]
 * @param {RenderPackAdapter} [options.renderAdapter]
 * @param {{ relPath: string, docType: string | null, ext: string | null }} options.file
 * @returns {Pipeline}
 */
export function createPipelineForFile(options) {
    let renderConfig = null;

    if (options.renderAdapter && options.file) {
        renderConfig = options.renderAdapter.resolveForFile(options.file);
    }

    return createPipeline({
        formattingAdapter: options.formattingAdapter,
        renderAdapter: options.renderAdapter,
        renderConfig: renderConfig || undefined
    });
}

/**
 * Create empty pipeline
 * @returns {Pipeline}
 */
export function createEmptyPipeline() {
    return new Pipeline();
}
