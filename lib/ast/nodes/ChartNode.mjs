/**
 * Chart AST Nodes
 * Node classes for diagram/chart representation in the AST
 * @module format-ast/nodes/ChartNode
 */

import {
    DIAGRAM_CATEGORY,
    CHART_NODE_TYPES,
    NODE_SHAPES,
    ARROW_TYPES,
    LINE_STYLES,
    MESSAGE_TYPES,
    KEY_TYPES
} from "../constants/chart.mjs";

// =============================================================================
// Type Imports (for JSDoc)
// =============================================================================

/**
 * @typedef {import("../types/chart.mjs").ChartType} ChartType
 * @typedef {import("../types/chart.mjs").ChartDirection} ChartDirection
 * @typedef {import("../types/chart.mjs").NodeShape} NodeShape
 * @typedef {import("../types/chart.mjs").ArrowType} ArrowType
 * @typedef {import("../types/chart.mjs").LineStyle} LineStyle
 * @typedef {import("../types/chart.mjs").MessageType} MessageType
 * @typedef {import("../types/chart.mjs").Cardinality} Cardinality
 * @typedef {import("../types/chart.mjs").ChartNodeStyle} ChartNodeStyle
 * @typedef {import("../types/chart.mjs").KeyType} KeyType
 */

// =============================================================================
// Base Node ID Generator
// =============================================================================

let _chartNodeIdCounter = 0;

/**
 * Generate unique chart node ID
 * @returns {string}
 */
function generateChartNodeId() {
    return `chart_node_${++_chartNodeIdCounter}`;
}

/**
 * Reset chart node ID counter (for testing)
 */
export function resetChartNodeIdCounter() {
    _chartNodeIdCounter = 0;
}

// =============================================================================
// Base Chart AST Node
// =============================================================================

/**
 * @typedef {Object} BaseChartNodeData
 * @property {string} [id]
 * @property {Record<string, unknown>} [attrs]
 * @property {string} [styleClass] - Reference to render pack class
 * @property {ChartNodeStyle} [style] - Inline style overrides
 */

/**
 * Base class for chart AST nodes
 */
export class BaseChartNode {
    /**
     * @param {string} type
     * @param {BaseChartNodeData} [data]
     */
    constructor(type, data = {}) {
        /** @type {string} */
        this.type = type;

        /** @type {string} */
        this.category = DIAGRAM_CATEGORY;

        /** @type {string} */
        this.id = data.id || generateChartNodeId();

        /** @type {Record<string, unknown>} */
        this.attrs = data.attrs || {};

        /** @type {string | undefined} */
        this.styleClass = data.styleClass;

        /** @type {ChartNodeStyle | undefined} */
        this.style = data.style;

        /** @type {BaseChartNode[]} */
        this.children = [];
    }

    // =========================================================================
    // Children Management
    // =========================================================================

    /**
     * Add child node
     * @param {BaseChartNode} child
     * @returns {this}
     */
    appendChild(child) {
        this.children.push(child);
        return this;
    }

    /**
     * Add multiple children
     * @param {BaseChartNode[]} children
     * @returns {this}
     */
    appendChildren(children) {
        for (let i = 0, len = children.length; i < len; i++) {
            this.children.push(children[i]);
        }
        return this;
    }

    /**
     * Check if has children
     * @returns {boolean}
     */
    hasChildren() {
        return this.children.length > 0;
    }

    /**
     * Get child count
     * @returns {number}
     */
    childCount() {
        return this.children.length;
    }

    // =========================================================================
    // Attributes
    // =========================================================================

    /**
     * Set attribute
     * @param {string} key
     * @param {unknown} value
     * @returns {this}
     */
    setAttr(key, value) {
        this.attrs[key] = value;
        return this;
    }

    /**
     * Get attribute
     * @template T
     * @param {string} key
     * @param {T} [defaultValue]
     * @returns {T | unknown}
     */
    getAttr(key, defaultValue) {
        if (Object.prototype.hasOwnProperty.call(this.attrs, key)) {
            return this.attrs[key];
        }
        return defaultValue;
    }

    // =========================================================================
    // Style
    // =========================================================================

    /**
     * Set style class reference
     * @param {string} className
     * @returns {this}
     */
    setStyleClass(className) {
        this.styleClass = className;
        return this;
    }

    /**
     * Set inline style
     * @param {ChartNodeStyle} style
     * @returns {this}
     */
    setStyle(style) {
        this.style = { ...this.style, ...style };
        return this;
    }

    // =========================================================================
    // Traversal
    // =========================================================================

    /**
     * Walk tree depth-first
     * @param {(node: BaseChartNode, depth: number) => boolean | void} visitor
     * @param {number} [depth]
     * @returns {boolean}
     */
    walk(visitor, depth = 0) {
        const result = visitor(this, depth);
        if (result === false) {
            return false;
        }
        for (let i = 0, len = this.children.length; i < len; i++) {
            if (this.children[i].walk(visitor, depth + 1) === false) {
                return false;
            }
        }
        return true;
    }

    /**
     * Find all nodes matching predicate
     * @param {(node: BaseChartNode) => boolean} predicate
     * @returns {BaseChartNode[]}
     */
    findAll(predicate) {
        /** @type {BaseChartNode[]} */
        const results = [];
        this.walk((node) => {
            if (predicate(node)) {
                results.push(node);
            }
        });
        return results;
    }

    // =========================================================================
    // Serialization
    // =========================================================================

    /**
     * Convert to plain object
     * @returns {Record<string, unknown>}
     */
    toJSON() {
        /** @type {Record<string, unknown>} */
        const obj = {
            type: this.type,
            category: this.category,
            id: this.id
        };

        if (Object.keys(this.attrs).length > 0) {
            obj.attrs = this.attrs;
        }

        if (this.styleClass) {
            obj.styleClass = this.styleClass;
        }

        if (this.style) {
            obj.style = this.style;
        }

        if (this.children.length > 0) {
            obj.children = this.children.map((c) => c.toJSON());
        }

        return obj;
    }
}

// =============================================================================
// Chart Container Node
// =============================================================================

/**
 * @typedef {Object} ChartContainerData
 * @property {ChartType} chartType
 * @property {ChartDirection} [direction]
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [recordId]
 * @property {string} [theme] - Theme reference from render pack
 */

/**
 * Root container for a chart
 */
export class ChartContainerNode extends BaseChartNode {
    /**
     * @param {BaseChartNodeData & ChartContainerData} data
     */
    constructor(data) {
        super(CHART_NODE_TYPES.CHART, data);

        /** @type {ChartType} */
        this.chartType = data.chartType;

        /** @type {ChartDirection} */
        this.direction = data.direction || "TD";

        /** @type {string | undefined} */
        this.title = data.title;

        /** @type {string | undefined} */
        this.description = data.description;

        /** @type {string | undefined} */
        this.recordId = data.recordId;

        /** @type {string | undefined} */
        this.theme = data.theme;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.chartType = this.chartType;
        obj.direction = this.direction;
        if (this.title) {
            obj.title = this.title;
        }
        if (this.description) {
            obj.description = this.description;
        }
        if (this.recordId) {
            obj.recordId = this.recordId;
        }
        if (this.theme) {
            obj.theme = this.theme;
        }
        return obj;
    }
}

// =============================================================================
// Flowchart Nodes
// =============================================================================

/**
 * @typedef {Object} ChartNodeItemData
 * @property {string} nodeId - Original ID from chart source
 * @property {string} label
 * @property {NodeShape} [shape]
 * @property {string} [url]
 * @property {string} [tooltip]
 */

/**
 * Flowchart node element
 */
export class ChartNodeItem extends BaseChartNode {
    /**
     * @param {BaseChartNodeData & ChartNodeItemData} data
     */
    constructor(data) {
        super(CHART_NODE_TYPES.CHART_NODE, data);

        /** @type {string} */
        this.nodeId = data.nodeId;

        /** @type {string} */
        this.label = data.label;

        /** @type {NodeShape} */
        this.shape = data.shape || NODE_SHAPES.RECT;

        /** @type {string | undefined} */
        this.url = data.url;

        /** @type {string | undefined} */
        this.tooltip = data.tooltip;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.nodeId = this.nodeId;
        obj.label = this.label;
        obj.shape = this.shape;
        if (this.url) {
            obj.url = this.url;
        }
        if (this.tooltip) {
            obj.tooltip = this.tooltip;
        }
        return obj;
    }
}

/**
 * @typedef {Object} ChartEdgeItemData
 * @property {string} from - Source node ID
 * @property {string} to - Target node ID
 * @property {string} [label]
 * @property {ArrowType} [arrow]
 * @property {LineStyle} [lineStyle]
 * @property {boolean} [bidirectional]
 */

/**
 * Flowchart edge element
 */
export class ChartEdgeItem extends BaseChartNode {
    /**
     * @param {BaseChartNodeData & ChartEdgeItemData} data
     */
    constructor(data) {
        super(CHART_NODE_TYPES.CHART_EDGE, data);

        /** @type {string} */
        this.from = data.from;

        /** @type {string} */
        this.to = data.to;

        /** @type {string | undefined} */
        this.label = data.label;

        /** @type {ArrowType} */
        this.arrow = data.arrow || ARROW_TYPES.NORMAL;

        /** @type {LineStyle} */
        this.lineStyle = data.lineStyle || LINE_STYLES.SOLID;

        /** @type {boolean} */
        this.bidirectional = data.bidirectional || false;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.from = this.from;
        obj.to = this.to;
        if (this.label) {
            obj.label = this.label;
        }
        obj.arrow = this.arrow;
        obj.lineStyle = this.lineStyle;
        if (this.bidirectional) {
            obj.bidirectional = true;
        }
        return obj;
    }
}

/**
 * @typedef {Object} ChartSubgraphData
 * @property {string} subgraphId
 * @property {string} [label]
 * @property {string[]} [nodeIds] - IDs of nodes in this subgraph
 */

/**
 * Subgraph/cluster container
 */
export class ChartSubgraphNode extends BaseChartNode {
    /**
     * @param {BaseChartNodeData & ChartSubgraphData} data
     */
    constructor(data) {
        super(CHART_NODE_TYPES.CHART_SUBGRAPH, data);

        /** @type {string} */
        this.subgraphId = data.subgraphId;

        /** @type {string | undefined} */
        this.label = data.label;

        /** @type {string[]} */
        this.nodeIds = data.nodeIds || [];
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.subgraphId = this.subgraphId;
        if (this.label) {
            obj.label = this.label;
        }
        if (this.nodeIds.length > 0) {
            obj.nodeIds = this.nodeIds;
        }
        return obj;
    }
}

// =============================================================================
// Sequence Diagram Nodes
// =============================================================================

/**
 * @typedef {Object} ChartParticipantData
 * @property {string} participantId
 * @property {string} label
 */

/**
 * Sequence diagram participant
 */
export class ChartParticipantNode extends BaseChartNode {
    /**
     * @param {BaseChartNodeData & ChartParticipantData} data
     */
    constructor(data) {
        super(CHART_NODE_TYPES.CHART_PARTICIPANT, data);

        /** @type {string} */
        this.participantId = data.participantId;

        /** @type {string} */
        this.label = data.label;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.participantId = this.participantId;
        obj.label = this.label;
        return obj;
    }
}

/**
 * @typedef {Object} ChartMessageData
 * @property {string} from
 * @property {string} to
 * @property {string} [label]
 * @property {MessageType} [messageType]
 * @property {number} [sequenceIndex] - Order in sequence
 */

/**
 * Sequence diagram message
 */
export class ChartMessageNode extends BaseChartNode {
    /**
     * @param {BaseChartNodeData & ChartMessageData} data
     */
    constructor(data) {
        super(CHART_NODE_TYPES.CHART_MESSAGE, data);

        /** @type {string} */
        this.from = data.from;

        /** @type {string} */
        this.to = data.to;

        /** @type {string | undefined} */
        this.label = data.label;

        /** @type {MessageType} */
        this.messageType = data.messageType || MESSAGE_TYPES.SYNC;

        /** @type {number | undefined} */
        this.sequenceIndex = data.sequenceIndex;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.from = this.from;
        obj.to = this.to;
        if (this.label) {
            obj.label = this.label;
        }
        obj.messageType = this.messageType;
        if (this.sequenceIndex !== undefined) {
            obj.sequenceIndex = this.sequenceIndex;
        }
        return obj;
    }
}

/**
 * @typedef {Object} ChartNoteData
 * @property {string} label
 * @property {string[]} [over] - Participant IDs this note spans
 * @property {"left" | "right" | "over"} [position]
 */

/**
 * Sequence diagram note
 */
export class ChartNoteNode extends BaseChartNode {
    /**
     * @param {BaseChartNodeData & ChartNoteData} data
     */
    constructor(data) {
        super(CHART_NODE_TYPES.CHART_NOTE, data);

        /** @type {string} */
        this.label = data.label;

        /** @type {string[]} */
        this.over = data.over || [];

        /** @type {"left" | "right" | "over"} */
        this.position = data.position || "over";
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.label = this.label;
        if (this.over.length > 0) {
            obj.over = this.over;
        }
        obj.position = this.position;
        return obj;
    }
}

/**
 * @typedef {Object} ChartLoopData
 * @property {string} label
 * @property {number[]} [messageIndices] - Indices of messages in this loop
 */

/**
 * Sequence diagram loop/fragment
 */
export class ChartLoopNode extends BaseChartNode {
    /**
     * @param {BaseChartNodeData & ChartLoopData} data
     */
    constructor(data) {
        super(CHART_NODE_TYPES.CHART_LOOP, data);

        /** @type {string} */
        this.label = data.label;

        /** @type {number[]} */
        this.messageIndices = data.messageIndices || [];
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.label = this.label;
        if (this.messageIndices.length > 0) {
            obj.messageIndices = this.messageIndices;
        }
        return obj;
    }
}

// =============================================================================
// State Diagram Nodes
// =============================================================================

/**
 * @typedef {Object} ChartStateData
 * @property {string} stateId
 * @property {string} label
 * @property {boolean} [initial]
 * @property {boolean} [final]
 * @property {string} [entryAction]
 * @property {string} [exitAction]
 */

/**
 * State diagram state node
 */
export class ChartStateNode extends BaseChartNode {
    /**
     * @param {BaseChartNodeData & ChartStateData} data
     */
    constructor(data) {
        super(CHART_NODE_TYPES.CHART_STATE, data);

        /** @type {string} */
        this.stateId = data.stateId;

        /** @type {string} */
        this.label = data.label;

        /** @type {boolean} */
        this.initial = data.initial || false;

        /** @type {boolean} */
        this.final = data.final || false;

        /** @type {string | undefined} */
        this.entryAction = data.entryAction;

        /** @type {string | undefined} */
        this.exitAction = data.exitAction;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.stateId = this.stateId;
        obj.label = this.label;
        if (this.initial) {
            obj.initial = true;
        }
        if (this.final) {
            obj.final = true;
        }
        if (this.entryAction) {
            obj.entryAction = this.entryAction;
        }
        if (this.exitAction) {
            obj.exitAction = this.exitAction;
        }
        return obj;
    }
}

/**
 * @typedef {Object} ChartTransitionData
 * @property {string} from
 * @property {string} to
 * @property {string} [trigger]
 * @property {string} [guard]
 * @property {string} [action]
 */

/**
 * State diagram transition
 */
export class ChartTransitionNode extends BaseChartNode {
    /**
     * @param {BaseChartNodeData & ChartTransitionData} data
     */
    constructor(data) {
        super(CHART_NODE_TYPES.CHART_TRANSITION, data);

        /** @type {string} */
        this.from = data.from;

        /** @type {string} */
        this.to = data.to;

        /** @type {string | undefined} */
        this.trigger = data.trigger;

        /** @type {string | undefined} */
        this.guard = data.guard;

        /** @type {string | undefined} */
        this.action = data.action;
    }

    /**
     * Build transition label
     * @returns {string}
     */
    buildLabel() {
        let label = this.trigger || "";
        if (this.guard) {
            label += ` [${this.guard}]`;
        }
        if (this.action) {
            label += ` / ${this.action}`;
        }
        return label.trim();
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.from = this.from;
        obj.to = this.to;
        if (this.trigger) {
            obj.trigger = this.trigger;
        }
        if (this.guard) {
            obj.guard = this.guard;
        }
        if (this.action) {
            obj.action = this.action;
        }
        return obj;
    }
}

// =============================================================================
// Entity-Relationship Diagram Nodes
// =============================================================================

/**
 * @typedef {Object} ChartAttributeData
 * @property {string} name
 * @property {string} [dataType]
 * @property {KeyType} [keyType]
 * @property {boolean} [nullable]
 * @property {string | number | boolean | null} [defaultValue]
 */

/**
 * Entity attribute
 */
export class ChartAttributeNode extends BaseChartNode {
    /**
     * @param {BaseChartNodeData & ChartAttributeData} data
     */
    constructor(data) {
        super(CHART_NODE_TYPES.CHART_ATTRIBUTE, data);

        /** @type {string} */
        this.name = data.name;

        /** @type {string | undefined} */
        this.dataType = data.dataType;

        /** @type {KeyType} */
        this.keyType = data.keyType || KEY_TYPES.NONE;

        /** @type {boolean} */
        this.nullable = data.nullable ?? true;

        /** @type {string | number | boolean | null | undefined} */
        this.defaultValue = data.defaultValue;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.name = this.name;
        if (this.dataType) {
            obj.dataType = this.dataType;
        }
        if (this.keyType !== KEY_TYPES.NONE) {
            obj.keyType = this.keyType;
        }
        if (!this.nullable) {
            obj.nullable = false;
        }
        if (this.defaultValue !== undefined) {
            obj.defaultValue = this.defaultValue;
        }
        return obj;
    }
}

/**
 * @typedef {Object} ChartEntityData
 * @property {string} entityId
 * @property {string} label
 */

/**
 * ER diagram entity
 */
export class ChartEntityNode extends BaseChartNode {
    /**
     * @param {BaseChartNodeData & ChartEntityData} data
     */
    constructor(data) {
        super(CHART_NODE_TYPES.CHART_ENTITY, data);

        /** @type {string} */
        this.entityId = data.entityId;

        /** @type {string} */
        this.label = data.label;
    }

    /**
     * Add attribute
     * @param {ChartAttributeData} attrData
     * @returns {ChartAttributeNode}
     */
    addAttribute(attrData) {
        const attr = new ChartAttributeNode(attrData);
        this.appendChild(attr);
        return attr;
    }

    /**
     * Get attributes
     * @returns {ChartAttributeNode[]}
     */
    getAttributes() {
        return /** @type {ChartAttributeNode[]} */ (
            this.children.filter(
                (c) => c.type === CHART_NODE_TYPES.CHART_ATTRIBUTE
            )
        );
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.entityId = this.entityId;
        obj.label = this.label;
        return obj;
    }
}

/**
 * @typedef {Object} ChartRelationshipData
 * @property {string} from
 * @property {string} to
 * @property {Cardinality} cardinality
 * @property {string} [label]
 * @property {boolean} [identifying]
 */

/**
 * ER diagram relationship
 */
export class ChartRelationshipNode extends BaseChartNode {
    /**
     * @param {BaseChartNodeData & ChartRelationshipData} data
     */
    constructor(data) {
        super(CHART_NODE_TYPES.CHART_RELATIONSHIP, data);

        /** @type {string} */
        this.from = data.from;

        /** @type {string} */
        this.to = data.to;

        /** @type {Cardinality} */
        this.cardinality = data.cardinality;

        /** @type {string | undefined} */
        this.label = data.label;

        /** @type {boolean} */
        this.identifying = data.identifying || false;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.from = this.from;
        obj.to = this.to;
        obj.cardinality = this.cardinality;
        if (this.label) {
            obj.label = this.label;
        }
        if (this.identifying) {
            obj.identifying = true;
        }
        return obj;
    }
}

// =============================================================================
// Tree Diagram Nodes
// =============================================================================

/**
 * @typedef {Object} ChartTreeNodeData
 * @property {string} treeNodeId
 * @property {string} label
 * @property {boolean} [collapsed]
 * @property {number} [depth]
 */

/**
 * Tree diagram node
 */
export class ChartTreeNode extends BaseChartNode {
    /**
     * @param {BaseChartNodeData & ChartTreeNodeData} data
     */
    constructor(data) {
        super(CHART_NODE_TYPES.CHART_TREE_NODE, data);

        /** @type {string} */
        this.treeNodeId = data.treeNodeId;

        /** @type {string} */
        this.label = data.label;

        /** @type {boolean} */
        this.collapsed = data.collapsed || false;

        /** @type {number} */
        this.depth = data.depth ?? 0;
    }

    /**
     * Add child tree node
     * @param {ChartTreeNodeData} childData
     * @returns {ChartTreeNode}
     */
    addChild(childData) {
        const child = new ChartTreeNode({
            ...childData,
            depth: this.depth + 1
        });
        this.appendChild(child);
        return child;
    }

    /**
     * Get child tree nodes
     * @returns {ChartTreeNode[]}
     */
    getChildren() {
        return /** @type {ChartTreeNode[]} */ (
            this.children.filter(
                (c) => c.type === CHART_NODE_TYPES.CHART_TREE_NODE
            )
        );
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.treeNodeId = this.treeNodeId;
        obj.label = this.label;
        if (this.collapsed) {
            obj.collapsed = true;
        }
        obj.depth = this.depth;
        return obj;
    }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create chart container
 * @param {ChartContainerData} data
 * @returns {ChartContainerNode}
 */
export function createChartContainer(data) {
    return new ChartContainerNode(data);
}

/**
 * Create flowchart node
 * @param {ChartNodeItemData} data
 * @returns {ChartNodeItem}
 */
export function createChartNode(data) {
    return new ChartNodeItem(data);
}

/**
 * Create flowchart edge
 * @param {ChartEdgeItemData} data
 * @returns {ChartEdgeItem}
 */
export function createChartEdge(data) {
    return new ChartEdgeItem(data);
}

/**
 * Create subgraph
 * @param {ChartSubgraphData} data
 * @returns {ChartSubgraphNode}
 */
export function createChartSubgraph(data) {
    return new ChartSubgraphNode(data);
}

/**
 * Create sequence participant
 * @param {ChartParticipantData} data
 * @returns {ChartParticipantNode}
 */
export function createChartParticipant(data) {
    return new ChartParticipantNode(data);
}

/**
 * Create sequence message
 * @param {ChartMessageData} data
 * @returns {ChartMessageNode}
 */
export function createChartMessage(data) {
    return new ChartMessageNode(data);
}

/**
 * Create sequence note
 * @param {ChartNoteData} data
 * @returns {ChartNoteNode}
 */
export function createChartNote(data) {
    return new ChartNoteNode(data);
}

/**
 * Create sequence loop
 * @param {ChartLoopData} data
 * @returns {ChartLoopNode}
 */
export function createChartLoop(data) {
    return new ChartLoopNode(data);
}

/**
 * Create state node
 * @param {ChartStateData} data
 * @returns {ChartStateNode}
 */
export function createChartState(data) {
    return new ChartStateNode(data);
}

/**
 * Create state transition
 * @param {ChartTransitionData} data
 * @returns {ChartTransitionNode}
 */
export function createChartTransition(data) {
    return new ChartTransitionNode(data);
}

/**
 * Create ER entity
 * @param {ChartEntityData} data
 * @returns {ChartEntityNode}
 */
export function createChartEntity(data) {
    return new ChartEntityNode(data);
}

/**
 * Create ER attribute
 * @param {ChartAttributeData} data
 * @returns {ChartAttributeNode}
 */
export function createChartAttribute(data) {
    return new ChartAttributeNode(data);
}

/**
 * Create ER relationship
 * @param {ChartRelationshipData} data
 * @returns {ChartRelationshipNode}
 */
export function createChartRelationship(data) {
    return new ChartRelationshipNode(data);
}

/**
 * Create tree node
 * @param {ChartTreeNodeData} data
 * @returns {ChartTreeNode}
 */
export function createChartTreeNode(data) {
    return new ChartTreeNode(data);
}
