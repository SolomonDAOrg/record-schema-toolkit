/**
 * Chart Renderers - Render chart AST to various output formats
 * @module format-ast/chart/renderers
 */

// =============================================================================
// Type Imports
// =============================================================================

/**
 * @typedef {import("../../documents/ChartDocument.mjs").ChartDocument} ChartDocument
 * @typedef {import("../../nodes/ChartNode.mjs").BaseChartNode} BaseChartNode
 * @typedef {import("../../nodes/ChartNode.mjs").ChartContainerNode} ChartContainerNode
 * @typedef {import("../../nodes/ChartNode.mjs").ChartNodeItem} ChartNodeItem
 * @typedef {import("../../nodes/ChartNode.mjs").ChartEdgeItem} ChartEdgeItem
 * @typedef {import("../../nodes/ChartNode.mjs").ChartSubgraphNode} ChartSubgraphNode
 * @typedef {import("../../nodes/ChartNode.mjs").ChartParticipantNode} ChartParticipantNode
 * @typedef {import("../../nodes/ChartNode.mjs").ChartMessageNode} ChartMessageNode
 * @typedef {import("../../nodes/ChartNode.mjs").ChartStateNode} ChartStateNode
 * @typedef {import("../../nodes/ChartNode.mjs").ChartTransitionNode} ChartTransitionNode
 * @typedef {import("../../nodes/ChartNode.mjs").ChartEntityNode} ChartEntityNode
 * @typedef {import("../../nodes/ChartNode.mjs").ChartRelationshipNode} ChartRelationshipNode
 * @typedef {import("../../nodes/ChartNode.mjs").ChartTreeNode} ChartTreeNode
 * @typedef {import("../../adapters/ChartRenderPackAdapter.mjs").ChartRenderPackAdapter} ChartRenderPackAdapter
 * @typedef {import("../../types/chart.mjs").ResolvedChartConfig} ResolvedChartConfig
 * @typedef {import("../../types/chart.mjs").ResolvedChartStyle} ResolvedChartStyle
 * @typedef {import("../../types/chart.mjs").ResolvedEdgeStyle} ResolvedEdgeStyle
 * @typedef {import("../../types/chart.mjs").ChartRenderOptions} ChartRenderOptions
 * @typedef {import("../../types/chart.mjs").ChartRenderResult} ChartRenderResult
 */

// =============================================================================
// Base Chart Renderer
// =============================================================================

/**
 * Abstract base chart renderer
 * @abstract
 */
export class BaseChartRenderer {
    /**
     * @param {ChartRenderPackAdapter} [adapter]
     */
    constructor(adapter) {
        /** @type {ChartRenderPackAdapter | undefined} */
        this.adapter = adapter;

        /** @type {string[]} */
        this._warnings = [];

        /** @type {string[]} */
        this._errors = [];
    }

    // =========================================================================
    // Abstract Methods
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
     * Get MIME type
     * @abstract
     * @returns {string}
     */
    getMimeType() {
        throw new Error("getMimeType() must be implemented");
    }

    /**
     * Get file extension
     * @abstract
     * @returns {string}
     */
    getExtension() {
        throw new Error("getExtension() must be implemented");
    }

    /**
     * Render document
     * @abstract
     * @param {ChartDocument} document
     * @param {ChartRenderOptions} [options]
     * @returns {ChartRenderResult}
     */
    render(document, options) {
        throw new Error("render() must be implemented");
    }

    // =========================================================================
    // Helpers
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
     * Clear messages
     * @protected
     */
    clearMessages() {
        this._warnings = [];
        this._errors = [];
    }

    /**
     * Create success result
     * @protected
     * @param {string | Uint8Array} output
     * @param {string} [filename]
     * @returns {ChartRenderResult}
     */
    successResult(output, filename) {
        return {
            success: true,
            output,
            mimeType: this.getMimeType(),
            filename: filename || `chart.${this.getExtension()}`,
            warnings: [...this._warnings],
            errors: []
        };
    }

    /**
     * Create failure result
     * @protected
     * @param {Error|string} error
     * @returns {ChartRenderResult}
     */
    failureResult(error) {
        return {
            success: false,
            output: null,
            mimeType: this.getMimeType(),
            warnings: [...this._warnings],
            errors: [String(error), ...this._errors],
            stack: typeof error === "string" ? undefined : error.stack
        };
    }

    /**
     * Get style for node
     * @protected
     * @param {BaseChartNode} node
     * @param {string} theme
     * @returns {ResolvedChartStyle}
     */

    getNodeStyle(node, theme) {
        if (!this.adapter) {
            // Built-in baseline defaults (so charts render sanely even without a render pack)
            return {
                fill: "#ffffff",
                stroke: "#333333",
                strokeWidth: 1,
                textColor: "#1a1a1a",
                fontFamily: "Georgia, serif",
                fontSize: 12
            };
        }
        return this.adapter.getNodeStyle(theme, node.styleClass);
    }

    /**
     * Get style for edge
     * @protected
     * @param {BaseChartNode} node
     * @param {string} theme
     * @returns {ResolvedEdgeStyle}
     */

    getEdgeStyle(node, theme) {
        if (!this.adapter) {
            return {
                stroke: "#666666",
                strokeWidth: 1.6,
                textColor: "#666666",
                fontFamily: "Georgia, serif",
                fontSize: 10
            };
        }
        return this.adapter.getEdgeStyle(theme, node.styleClass);
    }

    /**
     * Get style for subgraph
     * @protected
     * @param {ChartSubgraphNode} node
     * @param {string} theme
     * @returns {ResolvedChartStyle}
     */

    getSubgraphStyle(node, theme) {
        if (!this.adapter) {
            return { fill: "#f8f9fa", stroke: "#dee2e6", strokeWidth: 1 };
        }
        return this.adapter.getSubgraphStyle(theme, node.styleClass);
    }
}
