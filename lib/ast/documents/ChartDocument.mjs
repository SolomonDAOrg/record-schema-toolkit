/**
 * ChartDocument - Document container for chart AST
 * @module format-ast/chart/ChartDocument
 */

import { CHART_TYPES, CHART_DIRECTIONS } from "../constants/chart.mjs";

import { BaseChartNode, ChartContainerNode } from "../nodes/ChartNode.mjs";

// =============================================================================
// Type Imports
// =============================================================================

/**
 * @typedef {import("../types/chart.mjs").ChartType} ChartType
 * @typedef {import("../types/chart.mjs").ChartDirection} ChartDirection
 * @typedef {import("../types/chart.mjs").ChartRenderTarget} ChartRenderTarget
 * @typedef {import("../types/chart.mjs").ChartDocumentMeta} ChartDocumentMeta
 * @typedef {import("../types/chart.mjs").ChartRenderConfig} ChartRenderConfig
 * @typedef {import("../nodes/ChartNode.mjs").ChartNodeItem} ChartNodeItem
 * @typedef {import("../nodes/ChartNode.mjs").ChartEdgeItem} ChartEdgeItem
 * @typedef {import("../nodes/ChartNode.mjs").ChartSubgraphNode} ChartSubgraphNode
 * @typedef {import("../nodes/ChartNode.mjs").ChartParticipantNode} ChartParticipantNode
 * @typedef {import("../nodes/ChartNode.mjs").ChartMessageNode} ChartMessageNode
 * @typedef {import("../nodes/ChartNode.mjs").ChartStateNode} ChartStateNode
 * @typedef {import("../nodes/ChartNode.mjs").ChartTransitionNode} ChartTransitionNode
 * @typedef {import("../nodes/ChartNode.mjs").ChartEntityNode} ChartEntityNode
 * @typedef {import("../nodes/ChartNode.mjs").ChartTreeNode} ChartTreeNode
 * @typedef {import("../nodes/ChartNode.mjs").ChartRelationshipNode} ChartRelationshipNode
 */

// =============================================================================
// ChartDocument
// =============================================================================

/**
 * Document container for chart AST nodes
 */
export class ChartDocument {
    /**
     * @param {Object} [options]
     * @param {ChartDocumentMeta} [options.metadata]
     * @param {Record<string, string | number>} [options.variables]
     * @param {ChartRenderConfig} [options.renderConfig]
     */
    constructor(options = {}) {
        /** @type {ChartDocumentMeta} */
        this.metadata = options.metadata || {};

        /** @type {Record<string, string | number>} */
        this.variables = options.variables || {};

        /** @type {ChartRenderConfig} */
        this.renderConfig = options.renderConfig || {};

        /** @type {ChartType} */
        this._chartType = CHART_TYPES.FLOWCHART;

        /** @type {ChartDirection} */
        this._direction = CHART_DIRECTIONS.TOP_DOWN;

        /** @type {BaseChartNode | null} */
        this._root = null;

        /** @type {string | null} */
        this.sourcePath = null;
    }

    // =========================================================================
    // Chart Type and Direction
    // =========================================================================

    /**
     * Get chart type
     * @returns {ChartType}
     */
    getChartType() {
        return this._chartType;
    }

    /**
     * Set chart type
     * @param {ChartType} type
     * @returns {this}
     */
    setChartType(type) {
        this._chartType = type;
        return this;
    }

    /**
     * Get direction
     * @returns {ChartDirection}
     */
    getDirection() {
        return this._direction;
    }

    /**
     * Set direction
     * @param {ChartDirection} direction
     * @returns {this}
     */
    setDirection(direction) {
        this._direction = direction;
        return this;
    }

    // =========================================================================
    // Metadata
    // =========================================================================

    /**
     * Set document title
     * @param {string} title
     * @returns {this}
     */
    setTitle(title) {
        this.metadata.title = title;
        return this;
    }

    /**
     * Get document title
     * @returns {string | undefined}
     */
    getTitle() {
        return this.metadata.title;
    }

    /**
     * Set document description
     * @param {string} description
     * @returns {this}
     */
    setDescription(description) {
        this.metadata.description = description;
        return this;
    }

    /**
     * Set record ID
     * @param {string} recordId
     * @returns {this}
     */
    setRecordId(recordId) {
        this.metadata.recordId = recordId;
        return this;
    }

    // =========================================================================
    // Variables
    // =========================================================================

    /**
     * Set variable
     * @param {string} name
     * @param {string | number} value
     * @returns {this}
     */
    setVariable(name, value) {
        this.variables[name] = value;
        return this;
    }

    /**
     * Get variable
     * @param {string} name
     * @returns {string | number | undefined}
     */
    getVariable(name) {
        return this.variables[name];
    }

    // =========================================================================
    // Render Config
    // =========================================================================

    /**
     * Set render targets
     * @param {ChartRenderTarget[]} targets
     * @returns {this}
     */
    setRenderTargets(targets) {
        this.renderConfig.targets = targets;
        return this;
    }

    /**
     * Set theme
     * @param {string} theme
     * @returns {this}
     */
    setTheme(theme) {
        this.renderConfig.theme = theme;
        return this;
    }

    /**
     * Set padding
     * @param {number} padding
     * @returns {this}
     */
    setPadding(padding) {
        this.renderConfig.padding = padding;
        return this;
    }

    /**
     * Set background
     * @param {string} background
     * @returns {this}
     */
    setBackground(background) {
        this.renderConfig.background = background;
        return this;
    }

    /**
     * Set scale (for raster output)
     * @param {number} scale
     * @returns {this}
     */
    setScale(scale) {
        this.renderConfig.scale = scale;
        return this;
    }

    // =========================================================================
    // Content Management
    // =========================================================================

    /**
     * Set/append root node
     * @param {BaseChartNode} node
     * @returns {this}
     */
    append(node) {
        if (!this._root) {
            this._root = node;
        } else if (this._root instanceof ChartContainerNode) {
            this._root.appendChild(node);
        } else {
            // Wrap in container
            const container = new ChartContainerNode({
                chartType: this._chartType,
                direction: this._direction
            });
            container.appendChild(this._root);
            container.appendChild(node);
            this._root = container;
        }
        return this;
    }

    /**
     * Get root node
     * @returns {BaseChartNode | null}
     */
    getRoot() {
        return this._root;
    }

    /**
     * Get all children (if root is container)
     * @returns {BaseChartNode[]}
     */
    getChildren() {
        if (!this._root) {
            return [];
        }
        return this._root.children;
    }

    /**
     * Clear content
     * @returns {this}
     */
    clear() {
        this._root = null;
        return this;
    }

    /**
     * Check if has content
     * @returns {boolean}
     */
    hasContent() {
        return this._root !== null && this._root.hasChildren();
    }

    // =========================================================================
    // Traversal
    // =========================================================================

    /**
     * Walk all nodes
     * @param {(node: BaseChartNode, depth: number) => boolean | void} visitor
     * @returns {boolean}
     */
    walk(visitor) {
        if (!this._root) {
            return true;
        }
        return this._root.walk(visitor);
    }

    /**
     * Find all nodes matching predicate
     * @param {(node: BaseChartNode) => boolean} predicate
     * @returns {BaseChartNode[]}
     */
    findAll(predicate) {
        if (!this._root) {
            return [];
        }
        return this._root.findAll(predicate);
    }

    /**
     * Find nodes by type
     * @param {string} type
     * @returns {BaseChartNode[]}
     */
    findByType(type) {
        return this.findAll((node) => node.type === type);
    }

    /**
     * Find node by ID
     * @param {string} id
     * @returns {BaseChartNode | undefined}
     */
    findById(id) {
        /** @type {BaseChartNode | undefined} */
        let found;
        this.walk((node) => {
            if (node.id === id) {
                found = node;
                return false;
            }
        });
        return found;
    }

    // =========================================================================
    // Chart-Specific Accessors
    // =========================================================================

    /**
     * Get all chart nodes (flowchart type)
     * @returns {ChartNodeItem[]}
     */
    getChartNodes() {
        return /** @type {ChartNodeItem[]} */ (this.findByType("chart-node"));
    }

    /**
     * Get all chart edges (flowchart type)
     * @returns {ChartEdgeItem[]}
     */
    getChartEdges() {
        return /** @type {ChartEdgeItem[]} */ (this.findByType("chart-edge"));
    }

    /**
     * Get all subgraphs
     * @returns {ChartSubgraphNode[]}
     */
    getSubgraphs() {
        return /** @type {ChartSubgraphNode[]} */ (
            this.findByType("chart-subgraph")
        );
    }

    /**
     * Get all participants (sequence type)
     * @returns {ChartParticipantNode[]}
     */
    getParticipants() {
        return /** @type {ChartParticipantNode[]} */ (
            this.findByType("chart-participant")
        );
    }

    /**
     * Get all messages (sequence type)
     * @returns {ChartMessageNode[]}
     */
    getMessages() {
        return /** @type {ChartMessageNode[]} */ (
            this.findByType("chart-message")
        );
    }

    /**
     * Get all states (state type)
     * @returns {ChartStateNode[]}
     */
    getStates() {
        return /** @type {ChartStateNode[]} */ (this.findByType("chart-state"));
    }

    /**
     * Get all transitions (state type)
     * @returns {ChartTransitionNode[]}
     */
    getTransitions() {
        return /** @type {ChartTransitionNode[]} */ (
            this.findByType("chart-transition")
        );
    }

    /**
     * Get all entities (entity type)
     * @returns {ChartEntityNode[]}
     */
    getEntities() {
        return /** @type {ChartEntityNode[]} */ (
            this.findByType("chart-entity")
        );
    }

    /**
     * Get all relationships (entity type)
     * @returns {ChartRelationshipNode[]}
     */
    getRelationships() {
        return /** @type {ChartRelationshipNode[]} */ (
            this.findByType("chart-relationship")
        );
    }

    /**
     * Get root tree node (tree type)
     * @returns {ChartTreeNode | null}
     */
    getTreeRoot() {
        const treeNodes = this.findByType("chart-tree-node");
        // Return the one with depth 0
        for (let i = 0, len = treeNodes.length; i < len; i++) {
            if (/** @type {ChartTreeNode} */ (treeNodes[i]).depth === 0) {
                return /** @type {ChartTreeNode} */ (treeNodes[i]);
            }
        }
        return treeNodes.length > 0
            ? /** @type {ChartTreeNode} */ (treeNodes[0])
            : null;
    }

    // =========================================================================
    // Class References
    // =========================================================================

    /**
     * Get all style class references used
     * @returns {Set<string>}
     */
    getClassReferences() {
        /** @type {Set<string>} */
        const classes = new Set();
        this.walk((node) => {
            if (node.styleClass) {
                classes.add(node.styleClass);
            }
        });
        return classes;
    }

    // =========================================================================
    // Serialization
    // =========================================================================

    /**
     * Convert to plain object
     * @returns {Record<string, unknown>}
     */
    toJSON() {
        return {
            type: "chart-document",
            chartType: this._chartType,
            direction: this._direction,
            metadata: this.metadata,
            variables: this.variables,
            renderConfig: this.renderConfig,
            root: this._root?.toJSON() || null
        };
    }

    /**
     * Clone document
     * @returns {ChartDocument}
     */
    clone() {
        const doc = new ChartDocument({
            metadata: { ...this.metadata },
            variables: { ...this.variables },
            renderConfig: { ...this.renderConfig }
        });
        doc._chartType = this._chartType;
        doc._direction = this._direction;
        doc.sourcePath = this.sourcePath;
        // Note: Deep clone of root would require node cloning support
        doc._root = this._root;
        return doc;
    }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create chart document
 * @param {Object} [options]
 * @returns {ChartDocument}
 */
export function createChartDocument(options) {
    return new ChartDocument(options);
}

/**
 * Create flowchart document
 * @param {Object} [options]
 * @returns {ChartDocument}
 */
export function createFlowchartDocument(options) {
    const doc = new ChartDocument(options);
    doc.setChartType(CHART_TYPES.FLOWCHART);
    return doc;
}

/**
 * Create sequence diagram document
 * @param {Object} [options]
 * @returns {ChartDocument}
 */
export function createSequenceDocument(options) {
    const doc = new ChartDocument(options);
    doc.setChartType(CHART_TYPES.SEQUENCE);
    return doc;
}

/**
 * Create state diagram document
 * @param {Object} [options]
 * @returns {ChartDocument}
 */
export function createStateDocument(options) {
    const doc = new ChartDocument(options);
    doc.setChartType(CHART_TYPES.STATE);
    return doc;
}

/**
 * Create ER diagram document
 * @param {Object} [options]
 * @returns {ChartDocument}
 */
export function createEntityDocument(options) {
    const doc = new ChartDocument(options);
    doc.setChartType(CHART_TYPES.ENTITY);
    return doc;
}

/**
 * Create tree diagram document
 * @param {Object} [options]
 * @returns {ChartDocument}
 */
export function createTreeDocument(options) {
    const doc = new ChartDocument(options);
    doc.setChartType(CHART_TYPES.TREE);
    return doc;
}
