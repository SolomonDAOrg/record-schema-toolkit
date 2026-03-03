/**
 * ChartToAstConverter - Converts Chart objects to chart AST nodes
 * @module format-ast/chart/ChartToAstConverter
 */

import {
    CHART_TYPES,
    NODE_SHAPES,
    ARROW_TYPES,
    LINE_STYLES,
    MESSAGE_TYPES,
    KEY_TYPES
} from "../constants/chart.mjs";

import {
    ChartContainerNode,
    ChartNodeItem,
    ChartEdgeItem,
    ChartSubgraphNode,
    ChartParticipantNode,
    ChartMessageNode,
    ChartNoteNode,
    ChartLoopNode,
    ChartStateNode,
    ChartTransitionNode,
    ChartEntityNode,
    ChartAttributeNode,
    ChartRelationshipNode,
    ChartTreeNode
} from "../nodes/ChartNode.mjs";

import { ChartDocument } from "../documents/ChartDocument.mjs";

// =============================================================================
// Type Imports (for JSDoc)
// =============================================================================

/**
 * @typedef {import("../types/chart.mjs").ChartType} ChartType
 * @typedef {import("../types/chart.mjs").NodeShape} NodeShape
 * @typedef {import("../types/chart.mjs").ArrowType} ArrowType
 * @typedef {import("../types/chart.mjs").LineStyle} LineStyle
 * @typedef {import("../types/chart.mjs").MessageType} MessageType
 * @typedef {import("../types/chart.mjs").KeyType} KeyType
 * @typedef {import("../types/chart.mjs").Cardinality} Cardinality
 * @typedef {import("../types/chart.mjs").ChartDirection} ChartDirection
 */

// =============================================================================
// Type Imports (from Chart.mjs)
// =============================================================================
/**
 * @typedef {import("../../record-schema/Chart.mjs").ChartData} ChartData
 * @typedef {import("../../record-schema/Chart.mjs").ChartMetadata} ChartMetadata
 * @typedef {import("../../record-schema/Chart.mjs").ChartNode} ChartNode
 * @typedef {import("../../record-schema/Chart.mjs").ChartEdge} ChartEdge
 * @typedef {import("../../record-schema/Chart.mjs").ChartSubgraph} ChartSubgraph
 * @typedef {import("../../record-schema/Chart.mjs").SequenceMessage} SequenceMessage
 * @typedef {import("../../record-schema/Chart.mjs").SequenceParticipant} SequenceParticipant
 * @typedef {import("../../record-schema/Chart.mjs").SequenceNote} SequenceNote
 * @typedef {import("../../record-schema/Chart.mjs").SequenceLoop} SequenceLoop
 * @typedef {import("../../record-schema/Chart.mjs").StateNode} StateNode
 * @typedef {import("../../record-schema/Chart.mjs").StateTransition} StateTransition
 * @typedef {import("../../record-schema/Chart.mjs").EntityAttribute} EntityAttribute
 * @typedef {import("../../record-schema/Chart.mjs").Entity} Entity
 * @typedef {import("../../record-schema/Chart.mjs").EntityRelationship} EntityRelationship
 * @typedef {import("../../record-schema/Chart.mjs").TreeNode} TreeNode
 * @typedef {import("../../record-schema/Chart.mjs").Chart} Chart
 */

// =============================================================================
// Shape Normalization
// =============================================================================

/** @type {Record<string, NodeShape>} */
const SHAPE_NAME_MAP = {
    rect: NODE_SHAPES.RECT,
    "[ ]": NODE_SHAPES.RECT,
    round: NODE_SHAPES.ROUND,
    "( )": NODE_SHAPES.ROUND,
    stadium: NODE_SHAPES.STADIUM,
    "([ ])": NODE_SHAPES.STADIUM,
    diamond: NODE_SHAPES.DIAMOND,
    "{ }": NODE_SHAPES.DIAMOND,
    hexagon: NODE_SHAPES.HEXAGON,
    "{{ }}": NODE_SHAPES.HEXAGON,
    parallelogram: NODE_SHAPES.PARALLELOGRAM,
    "[/ /]": NODE_SHAPES.PARALLELOGRAM,
    trapezoid: NODE_SHAPES.TRAPEZOID,
    "[\\ /]": NODE_SHAPES.TRAPEZOID,
    circle: NODE_SHAPES.CIRCLE,
    "(( ))": NODE_SHAPES.CIRCLE,
    cylinder: NODE_SHAPES.CYLINDER,
    "[( )]": NODE_SHAPES.CYLINDER,
    subroutine: NODE_SHAPES.SUBROUTINE,
    "[[ ]]": NODE_SHAPES.SUBROUTINE,
    asymmetric: NODE_SHAPES.ASYMMETRIC,
    "> ]": NODE_SHAPES.ASYMMETRIC,
    note: NODE_SHAPES.NOTE,
    "[ . ]": NODE_SHAPES.NOTE
};

/**
 * Normalize shape name to enum value
 * @param {string | undefined} shape
 * @returns {NodeShape}
 */
function normalizeShape(shape) {
    if (!shape) {
        return NODE_SHAPES.RECT;
    }
    return SHAPE_NAME_MAP[shape] || NODE_SHAPES.RECT;
}

/**
 * Normalize line style
 * @param {string | undefined} style
 * @returns {LineStyle}
 */
function normalizeLineStyle(style) {
    if (!style) {
        return LINE_STYLES.SOLID;
    }
    const lower = style.toLowerCase();
    if (lower === "dashed") {
        return LINE_STYLES.DASHED;
    }
    if (lower === "dotted") {
        return LINE_STYLES.DOTTED;
    }
    if (lower === "thick") {
        return LINE_STYLES.THICK;
    }
    return LINE_STYLES.SOLID;
}

/**
 * Normalize arrow type
 * @param {string | undefined} arrow
 * @returns {ArrowType}
 */
function normalizeArrow(arrow) {
    if (!arrow) {
        return ARROW_TYPES.NORMAL;
    }
    const lower = arrow.toLowerCase();
    if (lower === "open") {
        return ARROW_TYPES.OPEN;
    }
    if (lower === "cross") {
        return ARROW_TYPES.CROSS;
    }
    if (lower === "none") {
        return ARROW_TYPES.NONE;
    }
    return ARROW_TYPES.NORMAL;
}

/**
 * Normalize message type
 * @param {string | undefined} type
 * @returns {MessageType}
 */
function normalizeMessageType(type) {
    if (!type) {
        return MESSAGE_TYPES.SYNC;
    }
    const lower = type.toLowerCase();
    if (lower === "async") {
        return MESSAGE_TYPES.ASYNC;
    }
    if (lower === "reply") {
        return MESSAGE_TYPES.REPLY;
    }
    return MESSAGE_TYPES.SYNC;
}

/**
 * Normalize key type
 * @param {string | undefined} key
 * @returns {KeyType}
 */
function normalizeKeyType(key) {
    if (!key) {
        return KEY_TYPES.NONE;
    }
    const lower = key.toLowerCase();
    if (lower === "primary") {
        return KEY_TYPES.PRIMARY;
    }
    if (lower === "foreign") {
        return KEY_TYPES.FOREIGN;
    }
    if (lower === "unique") {
        return KEY_TYPES.UNIQUE;
    }
    if (lower === "index") {
        return KEY_TYPES.INDEX;
    }
    return KEY_TYPES.NONE;
}

// =============================================================================
// ChartToAstConverter
// =============================================================================

/**
 * Converter from Chart objects to chart AST
 */
export class ChartToAstConverter {
    constructor() {
        /** @type {string[]} */
        this._warnings = [];
    }

    /**
     * Convert Chart to ChartDocument
     * @param {Chart} chart
     * @param {{ theme?: string }} [options]
     * @returns {ChartDocument}
     */
    convert(chart, options = {}) {
        this._warnings = [];

        const chartType = chart.getChartType();
        const direction = /** @type {ChartDirection} */ (chart.getDirection());

        // Create container node
        const container = new ChartContainerNode({
            chartType,
            direction,
            title: chart.getTitle() || undefined,
            description: chart.getDescription() || undefined,
            recordId: chart.getRecordId() || undefined,
            theme: options.theme
        });

        // Convert based on chart type
        switch (chartType) {
            case CHART_TYPES.FLOWCHART:
                this._convertFlowchart(chart, container);
                break;
            case CHART_TYPES.SEQUENCE:
                this._convertSequence(chart, container);
                break;
            case CHART_TYPES.STATE:
                this._convertState(chart, container);
                break;
            case CHART_TYPES.ENTITY:
                this._convertEntity(chart, container);
                break;
            case CHART_TYPES.TREE:
                this._convertTree(chart, container);
                break;
            default:
                this._warnings.push(
                    `Unknown chart type: ${chartType}, defaulting to flowchart`
                );
                this._convertFlowchart(chart, container);
        }

        // Create document
        const doc = new ChartDocument({
            metadata: {
                title: chart.getTitle() || undefined
            }
        });
        doc.setChartType(chartType);
        doc.setDirection(direction);
        doc.append(container);

        return doc;
    }

    // =========================================================================
    // Flowchart Conversion
    // =========================================================================

    /**
     * Convert flowchart elements
     * @param {Chart} chart
     * @param {ChartContainerNode} container
     */
    _convertFlowchart(chart, container) {
        // Convert nodes
        const nodes = chart.getNodes();
        for (let i = 0, len = nodes.length; i < len; i++) {
            const node = nodes[i];
            const astNode = new ChartNodeItem({
                nodeId: node.id,
                label: node.label || node.id,
                shape: normalizeShape(node.shape),
                url: node.url,
                tooltip: node.tooltip,
                styleClass: node.class
            });
            container.appendChild(astNode);
        }

        // Convert edges
        const edges = chart.getEdges();
        for (let i = 0, len = edges.length; i < len; i++) {
            const edge = edges[i];
            const astEdge = new ChartEdgeItem({
                from: edge.from,
                to: edge.to,
                label: edge.label,
                arrow: normalizeArrow(edge.arrow),
                lineStyle: normalizeLineStyle(edge.line_style),
                bidirectional: edge.bidirectional,
                styleClass: edge.class
            });
            container.appendChild(astEdge);
        }

        // Convert subgraphs
        const subgraphs = chart.getSubgraphs();
        for (let i = 0, len = subgraphs.length; i < len; i++) {
            this._convertSubgraph(subgraphs[i], container);
        }
    }

    /**
     * Convert subgraph (recursive for nested)
     * @param {ChartSubgraph} subgraph
     * @param {ChartContainerNode | ChartSubgraphNode} parent
     */
    _convertSubgraph(subgraph, parent) {
        const astSubgraph = new ChartSubgraphNode({
            subgraphId: subgraph.id,
            label: subgraph.label,
            nodeIds: subgraph.nodes || [],
            styleClass: subgraph.class
        });

        // Nested subgraphs
        if (subgraph.contains) {
            for (let i = 0, len = subgraph.contains.length; i < len; i++) {
                this._convertSubgraph(subgraph.contains[i], astSubgraph);
            }
        }

        parent.appendChild(astSubgraph);
    }

    // =========================================================================
    // Sequence Diagram Conversion
    // =========================================================================

    /**
     * Convert sequence diagram elements
     * @param {Chart} chart
     * @param {ChartContainerNode} container
     */
    _convertSequence(chart, container) {
        // Convert participants
        const participants = chart.getParticipants();
        for (let i = 0, len = participants.length; i < len; i++) {
            const p = participants[i];
            const astParticipant = new ChartParticipantNode({
                participantId: p.id,
                label: p.label || p.id,
                styleClass: p.class
            });
            container.appendChild(astParticipant);
        }

        // Convert messages
        const messages = chart.getMessages();
        for (let i = 0, len = messages.length; i < len; i++) {
            const msg = messages[i];
            const astMessage = new ChartMessageNode({
                from: msg.from,
                to: msg.to,
                label: msg.label,
                messageType: normalizeMessageType(msg.type),
                sequenceIndex: i,
                styleClass: msg.class
            });
            container.appendChild(astMessage);
        }

        // Convert notes
        const notes = chart.getNotes();
        for (let i = 0, len = notes.length; i < len; i++) {
            const note = notes[i];
            const astNote = new ChartNoteNode({
                label: note.label,
                over: note.over,
                position: note.position,
                styleClass: note.class
            });
            container.appendChild(astNote);
        }

        // Convert loops
        const loops = chart.getLoops();
        for (let i = 0, len = loops.length; i < len; i++) {
            const loop = loops[i];
            const astLoop = new ChartLoopNode({
                label: loop.label,
                messageIndices: loop.messages,
                styleClass: loop.class
            });
            container.appendChild(astLoop);
        }
    }

    // =========================================================================
    // State Diagram Conversion
    // =========================================================================

    /**
     * Convert state diagram elements
     * @param {Chart} chart
     * @param {ChartContainerNode} container
     */
    _convertState(chart, container) {
        // Convert states
        const states = chart.getStates();
        for (let i = 0, len = states.length; i < len; i++) {
            this._convertStateNode(states[i], container);
        }

        // Convert transitions
        const transitions = chart.getTransitions();
        for (let i = 0, len = transitions.length; i < len; i++) {
            const trans = transitions[i];
            const astTransition = new ChartTransitionNode({
                from: trans.from,
                to: trans.to,
                trigger: trans.trigger,
                guard: trans.guard,
                action: trans.action,
                styleClass: trans.class
            });
            container.appendChild(astTransition);
        }
    }

    /**
     * Convert state node (recursive for substates)
     * @param {StateNode} state
     * @param {ChartContainerNode | ChartStateNode} parent
     */
    _convertStateNode(state, parent) {
        const astState = new ChartStateNode({
            stateId: state.id,
            label: state.label || state.id,
            initial: state.initial,
            final: state.final,
            entryAction: state.entry_action,
            exitAction: state.exit_action,
            styleClass: state.class
        });

        // Substates
        if (state.substates) {
            for (let i = 0, len = state.substates.length; i < len; i++) {
                this._convertStateNode(state.substates[i], astState);
            }
        }

        parent.appendChild(astState);
    }

    // =========================================================================
    // Entity-Relationship Conversion
    // =========================================================================

    /**
     * Convert ER diagram elements
     * @param {Chart} chart
     * @param {ChartContainerNode} container
     */
    _convertEntity(chart, container) {
        // Convert entities
        const entities = chart.getEntities();
        for (let i = 0, len = entities.length; i < len; i++) {
            const entity = entities[i];
            const astEntity = new ChartEntityNode({
                entityId: entity.id,
                label: entity.label || entity.id,
                styleClass: entity.class
            });

            // Add attributes
            if (entity.attributes) {
                for (
                    let j = 0, jlen = entity.attributes.length;
                    j < jlen;
                    j++
                ) {
                    const attr = entity.attributes[j];
                    const astAttr = new ChartAttributeNode({
                        name: attr.name,
                        dataType: attr.type,
                        keyType: normalizeKeyType(attr.key),
                        nullable: attr.nullable ?? true,
                        defaultValue: attr.default
                    });
                    astEntity.appendChild(astAttr);
                }
            }

            container.appendChild(astEntity);
        }

        // Convert relationships
        const relationships = chart.getRelationships();
        for (let i = 0, len = relationships.length; i < len; i++) {
            const rel = relationships[i];
            const astRel = new ChartRelationshipNode({
                from: rel.from,
                to: rel.to,
                cardinality: rel.cardinality,
                label: rel.label,
                identifying: rel.identifying,
                styleClass: rel.class
            });
            container.appendChild(astRel);
        }
    }

    // =========================================================================
    // Tree Diagram Conversion
    // =========================================================================

    /**
     * Convert tree diagram elements
     * @param {Chart} chart
     * @param {ChartContainerNode} container
     */
    _convertTree(chart, container) {
        const root = chart.getRoot();
        if (!root) {
            this._warnings.push("Tree chart has no root node");
            return;
        }

        this._convertTreeNode(root, container, 0);
    }

    /**
     * Convert tree node (recursive)
     * @param {TreeNode} node
     * @param {ChartContainerNode | ChartTreeNode} parent
     * @param {number} depth
     */
    _convertTreeNode(node, parent, depth) {
        const astTreeNode = new ChartTreeNode({
            treeNodeId: node.id,
            label: node.label || node.id,
            collapsed: node.collapsed,
            depth,
            styleClass: node.class
        });

        // Children
        if (node.children) {
            for (let i = 0, len = node.children.length; i < len; i++) {
                this._convertTreeNode(node.children[i], astTreeNode, depth + 1);
            }
        }

        parent.appendChild(astTreeNode);
    }

    // =========================================================================
    // Warnings
    // =========================================================================

    /**
     * Get conversion warnings
     * @returns {string[]}
     */
    getWarnings() {
        return [...this._warnings];
    }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create converter instance
 * @returns {ChartToAstConverter}
 */
export function createChartToAstConverter() {
    return new ChartToAstConverter();
}

/**
 * Quick convert Chart to ChartDocument
 * @param {Chart} chart
 * @param {{ theme?: string }} [options]
 * @returns {ChartDocument}
 */
export function convertChartToDocument(chart, options) {
    const converter = new ChartToAstConverter();
    return converter.convert(chart, options);
}
