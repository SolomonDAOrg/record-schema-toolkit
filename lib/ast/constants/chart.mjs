/**
 * Chart AST Constants
 * Node types for diagram/chart rendering
 * @module format-ast/chart/constants
 */

/**
 * @typedef {import("../types/chart.mjs").KeyType} KeyType
 * @typedef {import("../types/chart.mjs").ChartType} ChartType
 */

// =============================================================================
// Node Category
// =============================================================================

export const DIAGRAM_CATEGORY = /** @type {const} */ ("diagram");

// =============================================================================
// Chart Node Types
// =============================================================================

export const CHART_NODE_TYPES = /** @type {const} */ ({
    // Container
    CHART: "chart",
    CHART_SUBGRAPH: "chart-subgraph",

    // Flowchart elements
    CHART_NODE: "chart-node",
    CHART_EDGE: "chart-edge",

    // Sequence diagram elements
    CHART_PARTICIPANT: "chart-participant",
    CHART_MESSAGE: "chart-message",
    CHART_NOTE: "chart-note",
    CHART_LOOP: "chart-loop",
    CHART_ACTIVATION: "chart-activation",

    // State diagram elements
    CHART_STATE: "chart-state",
    CHART_TRANSITION: "chart-transition",

    // Entity-relationship elements
    CHART_ENTITY: "chart-entity",
    CHART_ATTRIBUTE: "chart-attribute",
    CHART_RELATIONSHIP: "chart-relationship",

    // Tree elements
    CHART_TREE_NODE: "chart-tree-node"
});

// =============================================================================
// Chart Types
// =============================================================================

export const CHART_TYPES = /** @type {Record<String, ChartType>} */ ({
    FLOWCHART: "flowchart",
    SEQUENCE: "sequence",
    STATE: "state",
    ENTITY: "entity",
    TREE: "tree"
});

// =============================================================================
// Direction
// =============================================================================

export const CHART_DIRECTIONS = /** @type {const} */ ({
    TOP_DOWN: "TD",
    TOP_BOTTOM: "TB",
    LEFT_RIGHT: "LR",
    RIGHT_LEFT: "RL",
    BOTTOM_TOP: "BT"
});

// =============================================================================
// Shape Types
// =============================================================================

export const NODE_SHAPES = /** @type {const} */ ({
    RECT: "rect",
    ROUND: "round",
    STADIUM: "stadium",
    DIAMOND: "diamond",
    HEXAGON: "hexagon",
    PARALLELOGRAM: "parallelogram",
    TRAPEZOID: "trapezoid",
    CIRCLE: "circle",
    CYLINDER: "cylinder",
    SUBROUTINE: "subroutine",
    ASYMMETRIC: "asymmetric",
    NOTE: "note"
});

// =============================================================================
// Arrow/Line Types
// =============================================================================

export const ARROW_TYPES = /** @type {const} */ ({
    NORMAL: "normal",
    OPEN: "open",
    CROSS: "cross",
    NONE: "none"
});

export const LINE_STYLES = /** @type {const} */ ({
    SOLID: "solid",
    DASHED: "dashed",
    DOTTED: "dotted",
    THICK: "thick"
});

// =============================================================================
// Message Types (sequence diagrams)
// =============================================================================

export const MESSAGE_TYPES = /** @type {const} */ ({
    SYNC: "sync",
    ASYNC: "async",
    REPLY: "reply"
});

// =============================================================================
// Cardinality Types (ER diagrams)
// =============================================================================

export const CARDINALITY = /** @type {const} */ ({
    ONE_TO_ONE: "1:1",
    ONE_TO_MANY: "1:N",
    MANY_TO_ONE: "N:1",
    MANY_TO_MANY: "N:M",
    ZERO_ONE_TO_ONE: "0..1:1",
    ZERO_ONE_TO_MANY: "0..1:N",
    ONE_TO_ZERO_ONE: "1:0..1",
    MANY_TO_ZERO_ONE: "N:0..1"
});

// =============================================================================
// Key Types (ER diagrams)
// =============================================================================

export const KEY_TYPES = /** @type {Record<string, KeyType>} **/ ({
    PRIMARY: "primary",
    FOREIGN: "foreign",
    UNIQUE: "unique",
    INDEX: "index",
    NONE: "none"
});

// =============================================================================
// Render Targets
// =============================================================================

export const CHART_RENDER_TARGETS = /** @type {const} */ ({
    SVG: "svg",
    PNG: "png",
    ASCII: "ascii",
    MERMAID: "mermaid"
});

// =============================================================================
// Default Dimensions
// =============================================================================

export const CHART_DEFAULTS = /** @type {const} */ ({
    NODE_MIN_WIDTH: 80,
    NODE_MIN_HEIGHT: 40,
    NODE_PADDING: 12,
    EDGE_MIN_LENGTH: 40,
    SUBGRAPH_PADDING: 20,
    PARTICIPANT_WIDTH: 120,
    PARTICIPANT_HEIGHT: 50,
    MESSAGE_SPACING: 40,
    STATE_RADIUS: 30,
    ENTITY_WIDTH: 160,
    ENTITY_ROW_HEIGHT: 24,
    TREE_LEVEL_SPACING: 60,
    TREE_SIBLING_SPACING: 40
});
