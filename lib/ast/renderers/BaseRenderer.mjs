/**
 * BaseRenderer - Abstract renderer interface
 * @module format-ast/renderers/BaseRenderer
 */

/**
 * @typedef {import("../types/core.mjs").RenderCapabilities} RenderCapabilities
 * @typedef {import("../types/core.mjs").RenderContext} RenderContext
 * @typedef {import("../types/core.mjs").NodeType} NodeType
 * @typedef {import("../documents/BaseDocument.mjs").BaseDocument} BaseDocument
 * @typedef {import("../nodes/BaseNode.mjs").BaseNode} BaseNode
 */

/**
 * @typedef {Object} RenderResult
 * @property {boolean} success
 * @property {Uint8Array | string | null} output - Binary or string output
 * @property {string} [mimeType]
 * @property {string} [filename]
 * @property {string[]} [warnings]
 * @property {string[]} [errors]
 */

/**
 * @typedef {Object} RenderOptions
 * @property {string} [filename]
 * @property {Record<string, unknown>} [rendererOptions] - Renderer-specific options
 */

/**
 * Abstract base renderer class
 * @abstract
 */
export class BaseRenderer {
    constructor() {
        if (new.target === BaseRenderer) {
            throw new Error("BaseRenderer is abstract");
        }

        /** @type {string[]} */
        this._warnings = [];

        /** @type {string[]} */
        this._errors = [];
    }

    // =========================================================================
    // Abstract Methods - Must Override
    // =========================================================================

    /**
     * Get renderer name
     * @abstract
     * @returns {string}
     */
    getName() {
        throw new Error("getName() must be implemented");
    }

    /**
     * Get supported output MIME type
     * @abstract
     * @returns {string}
     */
    getMimeType() {
        throw new Error("getMimeType() must be implemented");
    }

    /**
     * Get default file extension
     * @abstract
     * @returns {string}
     */
    getExtension() {
        throw new Error("getExtension() must be implemented");
    }

    /**
     * Get renderer capabilities
     * @abstract
     * @returns {RenderCapabilities}
     */
    getCapabilities() {
        throw new Error("getCapabilities() must be implemented");
    }

    /**
     * Render document to output
     * @abstract
     * @param {BaseDocument} document
     * @param {RenderOptions} [options]
     * @returns {RenderResult}
     */
    render(document, options) {
        throw new Error("render() must be implemented");
    }

    // =========================================================================
    // Capability Checks
    // =========================================================================

    /**
     * Check if renderer supports a node type
     * @param {NodeType} type
     * @returns {boolean}
     */
    supportsNodeType(type) {
        const caps = this.getCapabilities();
        if (!caps.supportedNodeTypes) {
            return true; // No restriction = supports all
        }
        return caps.supportedNodeTypes.includes(type);
    }

    /**
     * Check if renderer supports inline formatting
     * @returns {boolean}
     */
    supportsInlineFormatting() {
        return this.getCapabilities().supportsInlineFormatting !== false;
    }

    /**
     * Check if renderer supports tables
     * @returns {boolean}
     */
    supportsTables() {
        return this.getCapabilities().supportsTables !== false;
    }

    /**
     * Check if renderer supports images
     * @returns {boolean}
     */
    supportsImages() {
        return this.getCapabilities().supportsImages !== false;
    }

    /**
     * Check if renderer supports headers/footers
     * @returns {boolean}
     */
    supportsHeadersFooters() {
        return this.getCapabilities().supportsHeadersFooters !== false;
    }

    /**
     * Check if renderer supports page breaks
     * @returns {boolean}
     */
    supportsPageBreaks() {
        return this.getCapabilities().supportsPageBreaks !== false;
    }

    /**
     * Check if renderer supports formulas
     * @returns {boolean}
     */
    supportsFormulas() {
        return this.getCapabilities().supportsFormulas === true;
    }

    /**
     * Check if renderer supports multiple sheets
     * @returns {boolean}
     */
    supportsMultipleSheets() {
        return this.getCapabilities().supportsMultipleSheets === true;
    }

    // =========================================================================
    // Warning/Error Management
    // =========================================================================

    /**
     * Add warning
     * @protected
     * @param {string} message
     */
    addWarning(message) {
        this._warnings.push(message);
    }

    /**
     * Add error
     * @protected
     * @param {string} message
     */
    addError(message) {
        this._errors.push(message);
    }

    /**
     * Clear warnings and errors
     * @protected
     */
    clearMessages() {
        this._warnings = [];
        this._errors = [];
    }

    /**
     * Get collected warnings
     * @returns {string[]}
     */
    getWarnings() {
        return [...this._warnings];
    }

    /**
     * Get collected errors
     * @returns {string[]}
     */
    getErrors() {
        return [...this._errors];
    }

    // =========================================================================
    // Helper Methods
    // =========================================================================

    /**
     * Create successful result
     * @protected
     * @param {Uint8Array | string} output
     * @param {string} [filename]
     * @returns {RenderResult}
     */
    successResult(output, filename) {
        return {
            success: true,
            output,
            mimeType: this.getMimeType(),
            filename: filename || `document.${this.getExtension()}`,
            warnings: this.getWarnings(),
            errors: []
        };
    }

    /**
     * Create failure result
     * @protected
     * @param {string} error
     * @returns {RenderResult}
     */
    failureResult(error) {
        return {
            success: false,
            output: null,
            mimeType: this.getMimeType(),
            warnings: this.getWarnings(),
            errors: [error, ...this.getErrors()]
        };
    }

    /**
     * Build render context
     * @protected
     * @param {BaseDocument} document
     * @returns {RenderContext}
     */
    buildContext(document) {
        return {
            pageNumber: 1,
            totalPages: 1,
            variables: { ...document.variables },
            nodePageMap: new Map(),
            capabilities: this.getCapabilities(),
            sectionPageNumber: 0,
            sectionTotalPages: 0,
            sectionId: "",
            isSecondPass: false
        };
    }
}

// =============================================================================
// Node Handler Registry
// =============================================================================

/**
 * @typedef {(node: BaseNode, context: RenderContext, renderer: BaseRenderer) => unknown} NodeHandler
 */

/**
 * Registry for node handlers
 */
export class NodeHandlerRegistry {
    constructor() {
        /** @type {Map<NodeType, NodeHandler>} */
        this._handlers = new Map();

        /** @type {NodeHandler | null} */
        this._fallback = null;
    }

    /**
     * Register handler for node type
     * @param {NodeType} type
     * @param {NodeHandler} handler
     * @returns {this}
     */
    register(type, handler) {
        this._handlers.set(type, handler);
        return this;
    }

    /**
     * Register multiple handlers
     * @param {Record<NodeType, NodeHandler>} handlers
     * @returns {this}
     */
    registerAll(handlers) {
        for (const type of Object.keys(handlers)) {
            this._handlers.set(
                /** @type {NodeType} */ (type),
                handlers[/** @type {NodeType} */ (type)]
            );
        }
        return this;
    }

    /**
     * Set fallback handler
     * @param {NodeHandler} handler
     * @returns {this}
     */
    setFallback(handler) {
        this._fallback = handler;
        return this;
    }

    /**
     * Get handler for node type
     * @param {NodeType} type
     * @returns {NodeHandler | null}
     */
    getHandler(type) {
        return this._handlers.get(type) || this._fallback;
    }

    /**
     * Check if handler exists
     * @param {NodeType} type
     * @returns {boolean}
     */
    hasHandler(type) {
        return this._handlers.has(type);
    }

    /**
     * Handle node
     * @param {BaseNode} node
     * @param {RenderContext} context
     * @param {BaseRenderer} renderer
     * @returns {unknown}
     */
    handle(node, context, renderer) {
        const handler = this.getHandler(node.type);
        if (handler) {
            return handler(node, context, renderer);
        }
        return null;
    }
}
