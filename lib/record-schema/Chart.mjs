/**
 * Chart class for record-schema-chart diagram definitions
 * @module classes/Chart
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { Schema } from "./Schema.mjs";
import { parseYaml, stringifyYaml } from "../parsing/yaml.mjs";

// ============================================================================
// Constants
// ============================================================================

/**
 * Valid chart types
 * @type {readonly string[]}
 */
const CHART_TYPES = ["flowchart", "sequence", "state", "entity", "tree"];

/**
 * Valid graph directions
 * @type {readonly string[]}
 */
const DIRECTIONS = ["TD", "TB", "LR", "RL", "BT"];

/**
 * Shape name to symbol mapping
 * @type {Record<string, string>}
 */
const SHAPE_SYMBOLS = {
    rect: "[ ]",
    round: "( )",
    stadium: "([ ])",
    diamond: "{ }",
    hexagon: "{{ }}",
    parallelogram: "[/ /]",
    trapezoid: "[\\ /]",
    circle: "(( ))",
    cylinder: "[( )]",
    subroutine: "[[ ]]",
    asymmetric: "> ]",
    note: "[ . ]"
};

/**
 * Symbol to shape name mapping (reverse of SHAPE_SYMBOLS)
 * @type {Record<string, string>}
 */
const SYMBOL_TO_SHAPE = Object.fromEntries(
    Object.entries(SHAPE_SYMBOLS).map(([k, v]) => [v, k])
);

/**
 * Edge shorthand pattern
 * Matches: "a --> b", "a --> b : label", "a -.-> b", "a ==> b", etc.
 * @type {RegExp}
 */
const EDGE_SHORTHAND_PATTERN =
    /^([a-z][a-z0-9_]*)\s*(-->|-.->|==>|<-->|--o|--x|---)\s*([a-z][a-z0-9_]*)(?:\s*:\s*(.+))?$/;

/**
 * Arrow symbol to style mapping
 * @type {Record<string, { arrow: string, lineStyle: string, bidirectional: boolean }>}
 */
const ARROW_STYLES = {
    "-->": { arrow: "normal", lineStyle: "solid", bidirectional: false },
    "-.->": { arrow: "normal", lineStyle: "dashed", bidirectional: false },
    "==>": { arrow: "normal", lineStyle: "thick", bidirectional: false },
    "<-->": { arrow: "normal", lineStyle: "solid", bidirectional: true },
    "--o": { arrow: "open", lineStyle: "solid", bidirectional: false },
    "--x": { arrow: "cross", lineStyle: "solid", bidirectional: false },
    "---": { arrow: "none", lineStyle: "solid", bidirectional: false }
};

/**
 * Node ID pattern
 * @type {RegExp}
 */
const NODE_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * @typedef {Object} ChartMetadata
 * @property {string} [title]
 * @property {string} [description]
 * @property {string} [author]
 * @property {string} [record_id]
 * @property {string} [created]
 * @property {string} [updated]
 */

/**
 * @typedef {Object} ChartNode
 * @property {string} id
 * @property {string} [label]
 * @property {string} [shape]
 * @property {string} [class]
 * @property {string} [url]
 * @property {string} [tooltip]
 */

/**
 * @typedef {Object} ChartEdge
 * @property {string} from
 * @property {string} to
 * @property {string} [label]
 * @property {string} [line_style]
 * @property {string} [arrow]
 * @property {string} [class]
 * @property {boolean} [bidirectional]
 */

/**
 * @typedef {Object} ChartSubgraph
 * @property {string} id
 * @property {string} [label]
 * @property {string[]} [nodes]
 * @property {ChartSubgraph[]} [contains]
 * @property {string} [class]
 */

/**
 * @typedef {Object} SequenceParticipant
 * @property {string} id
 * @property {string} [label]
 * @property {string} [class]
 */

/**
 * @typedef {Object} SequenceMessage
 * @property {string} from
 * @property {string} to
 * @property {string} [label]
 * @property {"sync" | "async" | "reply"} [type]
 * @property {string} [class]
 */

/**
 * @typedef {Object} SequenceNote
 * @property {string[]} [over]
 * @property {string} label
 * @property {"left" | "right" | "over"} [position]
 * @property {string} [class]
 */

/**
 * @typedef {Object} SequenceLoop
 * @property {string} label
 * @property {number[]} [messages]
 * @property {string} [class]
 */

/**
 * @typedef {Object} StateNode
 * @property {string} id
 * @property {string} [label]
 * @property {boolean} [initial]
 * @property {boolean} [final]
 * @property {string} [entry_action]
 * @property {string} [exit_action]
 * @property {StateNode[]} [substates]
 * @property {string} [class]
 */

/**
 * @typedef {Object} StateTransition
 * @property {string} from
 * @property {string} to
 * @property {string} [trigger]
 * @property {string} [guard]
 * @property {string} [action]
 * @property {string} [line_style]
 * @property {string} [class]
 */

/**
 * @typedef {Object} EntityAttribute
 * @property {string} name
 * @property {string} [type]
 * @property {"primary" | "foreign" | "unique" | "index" | "none"} [key]
 * @property {boolean} [nullable]
 * @property {string|number|boolean|null} [default]
 */

/**
 * @typedef {Object} Entity
 * @property {string} id
 * @property {string} [label]
 * @property {EntityAttribute[]} [attributes]
 * @property {string} [class]
 */

/**
 * @typedef {Object} EntityRelationship
 * @property {string} from
 * @property {string} to
 * @property {"1:1" | "1:N" | "N:1" | "N:M" | "0..1:1" | "0..1:N" | "1:0..1" | "N:0..1"} cardinality
 * @property {string} [label]
 * @property {boolean} [identifying]
 * @property {string} [line_style]
 * @property {string} [class]
 */

/**
 * @typedef {Object} TreeNode
 * @property {string} id
 * @property {string} [label]
 * @property {TreeNode[]} [children]
 * @property {boolean} [collapsed]
 * @property {string} [class]
 */

/**
 * @typedef {Object} ChartData
 * @property {string} schema
 * @property {number} schema_version
 * @property {"flowchart" | "sequence" | "state" | "entity" | "tree"} [chart_type]
 * @property {"TD" | "TB" | "LR" | "RL" | "BT"} [direction]
 * @property {ChartMetadata} [metadata]
 * @property {ChartNode[]} [nodes]
 * @property {(string|ChartEdge)[]} [edges]
 * @property {ChartSubgraph[]} [subgraphs]
 * @property {SequenceParticipant[]} [participants]
 * @property {SequenceMessage[]} [messages]
 * @property {SequenceNote[]} [notes]
 * @property {SequenceLoop[]} [loops]
 * @property {StateNode[]} [states]
 * @property {StateTransition[]} [transitions]
 * @property {Entity[]} [entities]
 * @property {EntityRelationship[]} [relationships]
 * @property {TreeNode} [root]
 */

/**
 * @typedef {Object} ValidationIssue
 * @property {"error" | "warning" | "info"} severity
 * @property {string} code
 * @property {string} message
 * @property {string} [path]
 */

/**
 * @typedef {Object} ParsedEdge
 * @property {string} from
 * @property {string} to
 * @property {string|null} label
 * @property {string} arrow
 * @property {string} lineStyle
 * @property {boolean} bidirectional
 */

// ============================================================================
// Chart Class
// ============================================================================

/**
 * Chart representing a record-schema-chart diagram definition
 */
export class Chart {
    /**
     * @param {ChartData} data
     * @param {string|null} [sourcePath]
     */
    constructor(data, sourcePath = null) {
        /** @type {ChartData} */
        this.data = data;
        /** @type {string|null} */
        this.sourcePath = sourcePath;
        /** @type {ChartEdge[]|null} */
        this._normalizedEdges = null;
        /** @type {Map<string, ChartNode>|null} */
        this._nodeMap = null;
    }

    // =========================================================================
    // Static Factory Methods
    // =========================================================================

    /**
     * Load chart from file (JSON or YAML)
     * @param {string} absPath
     * @returns {Chart}
     */
    static load(absPath) {
        const text = readFileSync(absPath, "utf8");
        const ext = extname(absPath).toLowerCase();
        if (ext === ".json") {
            return Chart.fromJson(text, absPath);
        }
        if (ext === ".yaml" || ext === ".yml") {
            return Chart.fromYaml(text, absPath);
        }
        // Try JSON first, then YAML
        try {
            return Chart.fromJson(text, absPath);
        } catch {
            return Chart.fromYaml(text, absPath);
        }
    }

    /**
     * Load chart from file if it exists
     * @param {string} absPath
     * @returns {Chart|null}
     */
    static loadIfExists(absPath) {
        if (!existsSync(absPath)) {
            return null;
        }
        return Chart.load(absPath);
    }

    /**
     * Create chart from JSON string
     * @param {string} json
     * @param {string|null} [sourcePath]
     * @returns {Chart}
     */
    static fromJson(json, sourcePath = null) {
        const data = /** @type {ChartData} */ (JSON.parse(json));
        return new Chart(data, sourcePath);
    }

    /**
     * Create chart from YAML string
     * @param {string} yaml
     * @param {string|null} [sourcePath]
     * @returns {Chart}
     */
    static fromYaml(yaml, sourcePath = null) {
        const data = /** @type {ChartData} */ (
            parseYaml(yaml, { filename: sourcePath || undefined })
        );
        return new Chart(data, sourcePath);
    }

    /**
     * Create chart from raw data object
     * @param {ChartData} data
     * @param {string|null} [sourcePath]
     * @returns {Chart}
     */
    static fromData(data, sourcePath = null) {
        return new Chart(data, sourcePath);
    }

    /**
     * Create empty flowchart
     * @returns {Chart}
     */
    static empty() {
        return new Chart({
            schema: "record-schema-chart",
            schema_version: 1,
            chart_type: "flowchart",
            nodes: [],
            edges: []
        });
    }

    // =========================================================================
    // Schema Info
    // =========================================================================

    /**
     * Get schema identifier
     * @returns {string}
     */
    getSchema() {
        return this.data.schema;
    }

    /**
     * Get schema version
     * @returns {number}
     */
    getSchemaVersion() {
        return this.data.schema_version;
    }

    /**
     * Check if this is a valid record-schema-chart
     * @returns {boolean}
     */
    isRecordSchemaChart() {
        return this.data.schema === "record-schema-chart";
    }

    // =========================================================================
    // Chart Type and Direction
    // =========================================================================

    /**
     * Get chart type
     * @returns {"flowchart" | "sequence" | "state" | "entity" | "tree"}
     */
    getChartType() {
        return this.data.chart_type || "flowchart";
    }

    /**
     * Get graph direction
     * @returns {"TD" | "TB" | "LR" | "RL" | "BT"}
     */
    getDirection() {
        return this.data.direction || "TD";
    }

    /**
     * Check if chart is flowchart type
     * @returns {boolean}
     */
    isFlowchart() {
        return this.getChartType() === "flowchart";
    }

    /**
     * Check if chart is sequence diagram type
     * @returns {boolean}
     */
    isSequence() {
        return this.getChartType() === "sequence";
    }

    /**
     * Check if chart is state diagram type
     * @returns {boolean}
     */
    isState() {
        return this.getChartType() === "state";
    }

    /**
     * Check if chart is entity-relationship diagram type
     * @returns {boolean}
     */
    isEntity() {
        return this.getChartType() === "entity";
    }

    /**
     * Check if chart is tree diagram type
     * @returns {boolean}
     */
    isTree() {
        return this.getChartType() === "tree";
    }

    // =========================================================================
    // Metadata
    // =========================================================================

    /**
     * Get chart metadata
     * @returns {ChartMetadata|null}
     */
    getMetadata() {
        return this.data.metadata || null;
    }

    /**
     * Get chart title
     * @returns {string|null}
     */
    getTitle() {
        return this.data.metadata?.title || null;
    }

    /**
     * Get chart description
     * @returns {string|null}
     */
    getDescription() {
        return this.data.metadata?.description || null;
    }

    /**
     * Get associated record ID
     * @returns {string|null}
     */
    getRecordId() {
        return this.data.metadata?.record_id || null;
    }

    // =========================================================================
    // Flowchart Accessors
    // =========================================================================

    /**
     * Get nodes (for flowchart type)
     * @returns {ChartNode[]}
     */
    getNodes() {
        return this.data.nodes || [];
    }

    /**
     * Get node by ID
     * @param {string} id
     * @returns {ChartNode|null}
     */
    getNode(id) {
        if (!this._nodeMap) {
            this._nodeMap = new Map();
            const nodes = this.getNodes();
            for (let i = 0, len = nodes.length; i < len; i++) {
                this._nodeMap.set(nodes[i].id, nodes[i]);
            }
        }
        return this._nodeMap.get(id) || null;
    }

    /**
     * Get raw edges (may include shorthand strings)
     * @returns {(string|ChartEdge)[]}
     */
    getRawEdges() {
        return this.data.edges || [];
    }

    /**
     * Get normalized edges (all parsed to object form)
     * @returns {ChartEdge[]}
     */
    getEdges() {
        if (this._normalizedEdges) {
            return this._normalizedEdges;
        }
        this._normalizedEdges = [];
        const raw = this.getRawEdges();
        for (let i = 0, len = raw.length; i < len; i++) {
            const edge = raw[i];
            if (typeof edge === "string") {
                const parsed = Chart.parseEdgeShorthand(edge);
                if (parsed) {
                    this._normalizedEdges.push({
                        from: parsed.from,
                        to: parsed.to,
                        label: parsed.label || undefined,
                        arrow: parsed.arrow,
                        line_style: parsed.lineStyle,
                        bidirectional: parsed.bidirectional || undefined
                    });
                }
            } else {
                this._normalizedEdges.push(edge);
            }
        }
        return this._normalizedEdges;
    }

    /**
     * Get subgraphs
     * @returns {ChartSubgraph[]}
     */
    getSubgraphs() {
        return this.data.subgraphs || [];
    }

    // =========================================================================
    // Sequence Diagram Accessors
    // =========================================================================

    /**
     * Get participants (for sequence type)
     * @returns {SequenceParticipant[]}
     */
    getParticipants() {
        return this.data.participants || [];
    }

    /**
     * Get messages (for sequence type)
     * @returns {SequenceMessage[]}
     */
    getMessages() {
        return this.data.messages || [];
    }

    /**
     * Get notes (for sequence type)
     * @returns {SequenceNote[]}
     */
    getNotes() {
        return this.data.notes || [];
    }

    /**
     * Get loops (for sequence type)
     * @returns {SequenceLoop[]}
     */
    getLoops() {
        return this.data.loops || [];
    }

    // =========================================================================
    // State Diagram Accessors
    // =========================================================================

    /**
     * Get states (for state type)
     * @returns {StateNode[]}
     */
    getStates() {
        return this.data.states || [];
    }

    /**
     * Get initial state
     * @returns {StateNode|null}
     */
    getInitialState() {
        const states = this.getStates();
        for (let i = 0, len = states.length; i < len; i++) {
            if (states[i].initial) {
                return states[i];
            }
        }
        return null;
    }

    /**
     * Get final states
     * @returns {StateNode[]}
     */
    getFinalStates() {
        const states = this.getStates();
        /** @type {StateNode[]} */
        const finals = [];
        for (let i = 0, len = states.length; i < len; i++) {
            if (states[i].final) {
                finals.push(states[i]);
            }
        }
        return finals;
    }

    /**
     * Get transitions (for state type)
     * @returns {StateTransition[]}
     */
    getTransitions() {
        return this.data.transitions || [];
    }

    // =========================================================================
    // Entity-Relationship Diagram Accessors
    // =========================================================================

    /**
     * Get entities (for entity type)
     * @returns {Entity[]}
     */
    getEntities() {
        return this.data.entities || [];
    }

    /**
     * Get relationships (for entity type)
     * @returns {EntityRelationship[]}
     */
    getRelationships() {
        return this.data.relationships || [];
    }

    // =========================================================================
    // Tree Diagram Accessors
    // =========================================================================

    /**
     * Get root node (for tree type)
     * @returns {TreeNode|null}
     */
    getRoot() {
        return this.data.root || null;
    }

    /**
     * Flatten tree to array of nodes with depth info
     * @returns {{ node: TreeNode, depth: number, path: string[] }[]}
     */
    flattenTree() {
        /** @type {{ node: TreeNode, depth: number, path: string[] }[]} */
        const result = [];
        const root = this.getRoot();
        if (!root) {
            return result;
        }
        Chart._flattenTreeNode(root, 0, [], result);
        return result;
    }

    /**
     * @param {TreeNode} node
     * @param {number} depth
     * @param {string[]} path
     * @param {{ node: TreeNode, depth: number, path: string[] }[]} result
     * @private
     */
    static _flattenTreeNode(node, depth, path, result) {
        const currentPath = [...path, node.id];
        result.push({ node, depth, path: currentPath });
        if (node.children) {
            for (let i = 0, len = node.children.length; i < len; i++) {
                Chart._flattenTreeNode(
                    node.children[i],
                    depth + 1,
                    currentPath,
                    result
                );
            }
        }
    }

    // =========================================================================
    // Validation
    // =========================================================================

    /**
     * Validate chart against schema
     * @param {Schema} schema
     * @returns {import("./Schema.mjs").SchemaError[]}
     */
    validateSchema(schema) {
        return schema.validate(this.data);
    }

    /**
     * Validate chart structure (beyond schema validation)
     * @returns {ValidationIssue[]}
     */
    validate() {
        /** @type {ValidationIssue[]} */
        const issues = [];

        // Check required fields
        if (this.data.schema !== "record-schema-chart") {
            issues.push({
                severity: "error",
                code: "chart.schema.invalid",
                message: `Invalid schema: expected "record-schema-chart", got "${this.data.schema}"`,
                path: "schema"
            });
        }

        if (
            typeof this.data.schema_version !== "number" ||
            this.data.schema_version < 1
        ) {
            issues.push({
                severity: "error",
                code: "chart.schema_version.invalid",
                message: `Invalid schema_version: expected integer >= 1`,
                path: "schema_version"
            });
        }

        // Check chart type
        const chartType = this.getChartType();
        if (!CHART_TYPES.includes(chartType)) {
            issues.push({
                severity: "error",
                code: "chart.chart_type.invalid",
                message: `Invalid chart_type: "${chartType}"`,
                path: "chart_type"
            });
        }

        // Check direction
        const direction = this.data.direction;
        if (direction && !DIRECTIONS.includes(direction)) {
            issues.push({
                severity: "error",
                code: "chart.direction.invalid",
                message: `Invalid direction: "${direction}"`,
                path: "direction"
            });
        }

        // Type-specific validation
        if (chartType === "flowchart") {
            this._validateFlowchart(issues);
        } else if (chartType === "sequence") {
            this._validateSequence(issues);
        } else if (chartType === "state") {
            this._validateState(issues);
        } else if (chartType === "entity") {
            this._validateEntity(issues);
        } else if (chartType === "tree") {
            this._validateTree(issues);
        }

        return issues;
    }

    /**
     * @param {ValidationIssue[]} issues
     * @private
     */
    _validateFlowchart(issues) {
        const nodes = this.getNodes();
        /** @type {Set<string>} */
        const nodeIds = new Set();
        /** @type {Set<string>} */
        const referencedIds = new Set();

        // Check node IDs
        for (let i = 0, len = nodes.length; i < len; i++) {
            const node = nodes[i];
            if (!NODE_ID_PATTERN.test(node.id)) {
                issues.push({
                    severity: "error",
                    code: "chart.node.id.invalid",
                    message: `Invalid node ID: "${node.id}" (must match ${NODE_ID_PATTERN})`,
                    path: `nodes[${i}].id`
                });
            }
            if (nodeIds.has(node.id)) {
                issues.push({
                    severity: "error",
                    code: "chart.node.id.duplicate",
                    message: `Duplicate node ID: "${node.id}"`,
                    path: `nodes[${i}].id`
                });
            }
            nodeIds.add(node.id);
        }

        // Check edges
        const edges = this.getEdges();
        for (let i = 0, len = edges.length; i < len; i++) {
            const edge = edges[i];
            referencedIds.add(edge.from);
            referencedIds.add(edge.to);
            if (!nodeIds.has(edge.from)) {
                issues.push({
                    severity: "error",
                    code: "chart.edge.from.undefined",
                    message: `Edge references undefined node: "${edge.from}"`,
                    path: `edges[${i}].from`
                });
            }
            if (!nodeIds.has(edge.to)) {
                issues.push({
                    severity: "error",
                    code: "chart.edge.to.undefined",
                    message: `Edge references undefined node: "${edge.to}"`,
                    path: `edges[${i}].to`
                });
            }
        }

        // Check subgraph node references
        const subgraphs = this.getSubgraphs();
        for (let i = 0, len = subgraphs.length; i < len; i++) {
            const sg = subgraphs[i];
            if (sg.nodes) {
                for (let j = 0, jlen = sg.nodes.length; j < jlen; j++) {
                    const nodeId = sg.nodes[j];
                    referencedIds.add(nodeId);
                    if (!nodeIds.has(nodeId)) {
                        issues.push({
                            severity: "error",
                            code: "chart.subgraph.node.undefined",
                            message: `Subgraph references undefined node: "${nodeId}"`,
                            path: `subgraphs[${i}].nodes[${j}]`
                        });
                    }
                }
            }
        }

        // Warn about orphan nodes
        for (const id of nodeIds) {
            if (!referencedIds.has(id)) {
                issues.push({
                    severity: "warning",
                    code: "chart.node.orphan",
                    message: `Node "${id}" is not referenced by any edge or subgraph`
                });
            }
        }
    }

    /**
     * @param {ValidationIssue[]} issues
     * @private
     */
    _validateSequence(issues) {
        const participants = this.getParticipants();
        /** @type {Set<string>} */
        const participantIds = new Set();

        for (let i = 0, len = participants.length; i < len; i++) {
            const p = participants[i];
            if (!NODE_ID_PATTERN.test(p.id)) {
                issues.push({
                    severity: "error",
                    code: "chart.participant.id.invalid",
                    message: `Invalid participant ID: "${p.id}"`,
                    path: `participants[${i}].id`
                });
            }
            if (participantIds.has(p.id)) {
                issues.push({
                    severity: "error",
                    code: "chart.participant.id.duplicate",
                    message: `Duplicate participant ID: "${p.id}"`,
                    path: `participants[${i}].id`
                });
            }
            participantIds.add(p.id);
        }

        const messages = this.getMessages();
        for (let i = 0, len = messages.length; i < len; i++) {
            const msg = messages[i];
            if (!participantIds.has(msg.from)) {
                issues.push({
                    severity: "error",
                    code: "chart.message.from.undefined",
                    message: `Message references undefined participant: "${msg.from}"`,
                    path: `messages[${i}].from`
                });
            }
            if (!participantIds.has(msg.to)) {
                issues.push({
                    severity: "error",
                    code: "chart.message.to.undefined",
                    message: `Message references undefined participant: "${msg.to}"`,
                    path: `messages[${i}].to`
                });
            }
        }

        const loops = this.getLoops();
        for (let i = 0, len = loops.length; i < len; i++) {
            const loop = loops[i];
            if (loop.messages) {
                for (let j = 0, jlen = loop.messages.length; j < jlen; j++) {
                    const idx = loop.messages[j];
                    if (idx < 0 || idx >= messages.length) {
                        issues.push({
                            severity: "error",
                            code: "chart.loop.message.invalid",
                            message: `Loop references invalid message index: ${idx}`,
                            path: `loops[${i}].messages[${j}]`
                        });
                    }
                }
            }
        }
    }

    /**
     * @param {ValidationIssue[]} issues
     * @private
     */
    _validateState(issues) {
        const states = this.getStates();
        /** @type {Set<string>} */
        const stateIds = new Set();
        let initialCount = 0;

        /**
         * @param {StateNode[]} stateList
         * @param {string} pathPrefix
         */
        const collectStateIds = (stateList, pathPrefix) => {
            for (let i = 0, len = stateList.length; i < len; i++) {
                const state = stateList[i];
                const path = `${pathPrefix}[${i}]`;
                if (!NODE_ID_PATTERN.test(state.id)) {
                    issues.push({
                        severity: "error",
                        code: "chart.state.id.invalid",
                        message: `Invalid state ID: "${state.id}"`,
                        path: `${path}.id`
                    });
                }
                if (stateIds.has(state.id)) {
                    issues.push({
                        severity: "error",
                        code: "chart.state.id.duplicate",
                        message: `Duplicate state ID: "${state.id}"`,
                        path: `${path}.id`
                    });
                }
                stateIds.add(state.id);
                if (state.initial) {
                    initialCount++;
                }
                if (state.substates) {
                    collectStateIds(state.substates, `${path}.substates`);
                }
            }
        };

        collectStateIds(states, "states");

        if (initialCount === 0) {
            issues.push({
                severity: "warning",
                code: "chart.state.initial.missing",
                message: "No initial state defined"
            });
        } else if (initialCount > 1) {
            issues.push({
                severity: "error",
                code: "chart.state.initial.multiple",
                message: `Multiple initial states defined (${initialCount})`
            });
        }

        const transitions = this.getTransitions();
        for (let i = 0, len = transitions.length; i < len; i++) {
            const t = transitions[i];
            if (!stateIds.has(t.from)) {
                issues.push({
                    severity: "error",
                    code: "chart.transition.from.undefined",
                    message: `Transition references undefined state: "${t.from}"`,
                    path: `transitions[${i}].from`
                });
            }
            if (!stateIds.has(t.to)) {
                issues.push({
                    severity: "error",
                    code: "chart.transition.to.undefined",
                    message: `Transition references undefined state: "${t.to}"`,
                    path: `transitions[${i}].to`
                });
            }
        }
    }

    /**
     * @param {ValidationIssue[]} issues
     * @private
     */
    _validateEntity(issues) {
        const entities = this.getEntities();
        /** @type {Set<string>} */
        const entityIds = new Set();

        for (let i = 0, len = entities.length; i < len; i++) {
            const entity = entities[i];
            if (!NODE_ID_PATTERN.test(entity.id)) {
                issues.push({
                    severity: "error",
                    code: "chart.entity.id.invalid",
                    message: `Invalid entity ID: "${entity.id}"`,
                    path: `entities[${i}].id`
                });
            }
            if (entityIds.has(entity.id)) {
                issues.push({
                    severity: "error",
                    code: "chart.entity.id.duplicate",
                    message: `Duplicate entity ID: "${entity.id}"`,
                    path: `entities[${i}].id`
                });
            }
            entityIds.add(entity.id);

            // Check attributes
            if (entity.attributes) {
                /** @type {Set<string>} */
                const attrNames = new Set();
                let primaryCount = 0;
                for (
                    let j = 0, jlen = entity.attributes.length;
                    j < jlen;
                    j++
                ) {
                    const attr = entity.attributes[j];
                    if (attrNames.has(attr.name)) {
                        issues.push({
                            severity: "error",
                            code: "chart.entity.attribute.duplicate",
                            message: `Duplicate attribute name: "${attr.name}" in entity "${entity.id}"`,
                            path: `entities[${i}].attributes[${j}].name`
                        });
                    }
                    attrNames.add(attr.name);
                    if (attr.key === "primary") {
                        primaryCount++;
                    }
                }
                if (primaryCount > 1) {
                    issues.push({
                        severity: "warning",
                        code: "chart.entity.primary_key.multiple",
                        message: `Entity "${entity.id}" has ${primaryCount} primary keys`
                    });
                }
            }
        }

        const relationships = this.getRelationships();
        for (let i = 0, len = relationships.length; i < len; i++) {
            const rel = relationships[i];
            if (!entityIds.has(rel.from)) {
                issues.push({
                    severity: "error",
                    code: "chart.relationship.from.undefined",
                    message: `Relationship references undefined entity: "${rel.from}"`,
                    path: `relationships[${i}].from`
                });
            }
            if (!entityIds.has(rel.to)) {
                issues.push({
                    severity: "error",
                    code: "chart.relationship.to.undefined",
                    message: `Relationship references undefined entity: "${rel.to}"`,
                    path: `relationships[${i}].to`
                });
            }
        }
    }

    /**
     * @param {ValidationIssue[]} issues
     * @private
     */
    _validateTree(issues) {
        const root = this.getRoot();
        if (!root) {
            issues.push({
                severity: "error",
                code: "chart.tree.root.missing",
                message: "Tree chart requires a root node"
            });
            return;
        }

        /** @type {Set<string>} */
        const nodeIds = new Set();

        /**
         * @param {TreeNode} node
         * @param {string} pathPrefix
         */
        const validateNode = (node, pathPrefix) => {
            if (!NODE_ID_PATTERN.test(node.id)) {
                issues.push({
                    severity: "error",
                    code: "chart.tree.node.id.invalid",
                    message: `Invalid tree node ID: "${node.id}"`,
                    path: `${pathPrefix}.id`
                });
            }
            if (nodeIds.has(node.id)) {
                issues.push({
                    severity: "error",
                    code: "chart.tree.node.id.duplicate",
                    message: `Duplicate tree node ID: "${node.id}"`,
                    path: `${pathPrefix}.id`
                });
            }
            nodeIds.add(node.id);
            if (node.children) {
                for (let i = 0, len = node.children.length; i < len; i++) {
                    validateNode(
                        node.children[i],
                        `${pathPrefix}.children[${i}]`
                    );
                }
            }
        };

        validateNode(root, "root");
    }

    // =========================================================================
    // Edge Parsing
    // =========================================================================

    /**
     * Parse edge shorthand syntax
     * @param {string} shorthand
     * @returns {ParsedEdge|null}
     */
    static parseEdgeShorthand(shorthand) {
        const match = EDGE_SHORTHAND_PATTERN.exec(shorthand.trim());
        if (!match) {
            return null;
        }
        const [, from, arrowSym, to, label] = match;
        const style = ARROW_STYLES[arrowSym] || ARROW_STYLES["-->"];
        return {
            from,
            to,
            label: label?.trim() || null,
            arrow: style.arrow,
            lineStyle: style.lineStyle,
            bidirectional: style.bidirectional
        };
    }

    /**
     * Convert edge to shorthand syntax
     * @param {ChartEdge} edge
     * @returns {string}
     */
    static edgeToShorthand(edge) {
        let arrow = "-->";
        if (edge.bidirectional) {
            arrow = "<-->";
        } else if (edge.arrow === "open") {
            arrow = "--o";
        } else if (edge.arrow === "cross") {
            arrow = "--x";
        } else if (edge.arrow === "none") {
            arrow = "---";
        } else if (edge.line_style === "dashed") {
            arrow = "-.->";
        } else if (edge.line_style === "thick") {
            arrow = "==>";
        }
        let result = `${edge.from} ${arrow} ${edge.to}`;
        if (edge.label) {
            result += ` : ${edge.label}`;
        }
        return result;
    }

    // =========================================================================
    // Shape Utilities
    // =========================================================================

    /**
     * Normalize shape to name form
     * @param {string} shape
     * @returns {string}
     */
    static normalizeShapeName(shape) {
        return SYMBOL_TO_SHAPE[shape] || shape;
    }

    /**
     * Get shape symbol from name
     * @param {string} shapeName
     * @returns {string}
     */
    static getShapeSymbol(shapeName) {
        return SHAPE_SYMBOLS[shapeName] || shapeName;
    }

    // =========================================================================
    // Collected References (for class/style validation)
    // =========================================================================

    /**
     * Get all class references used in this chart
     * @returns {Set<string>}
     */
    getClassReferences() {
        /** @type {Set<string>} */
        const classes = new Set();

        /**
         * @param {{ class?: string }|undefined} item
         */
        const addIfPresent = (item) => {
            if (item?.class) {
                classes.add(item.class);
            }
        };

        // Nodes
        const nodes = this.getNodes();
        for (let i = 0, len = nodes.length; i < len; i++) {
            addIfPresent(nodes[i]);
        }

        // Edges
        const edges = this.getEdges();
        for (let i = 0, len = edges.length; i < len; i++) {
            addIfPresent(edges[i]);
        }

        // Subgraphs
        /**
         * @param {ChartSubgraph[]} subgraphs
         */
        const processSubgraphs = (subgraphs) => {
            for (let i = 0, len = subgraphs.length; i < len; i++) {
                addIfPresent(subgraphs[i]);
                if (subgraphs[i].contains) {
                    processSubgraphs(subgraphs[i].contains);
                }
            }
        };
        processSubgraphs(this.getSubgraphs());

        // Participants
        const participants = this.getParticipants();
        for (let i = 0, len = participants.length; i < len; i++) {
            addIfPresent(participants[i]);
        }

        // Messages
        const messages = this.getMessages();
        for (let i = 0, len = messages.length; i < len; i++) {
            addIfPresent(messages[i]);
        }

        // Notes
        const notes = this.getNotes();
        for (let i = 0, len = notes.length; i < len; i++) {
            addIfPresent(notes[i]);
        }

        // Loops
        const loops = this.getLoops();
        for (let i = 0, len = loops.length; i < len; i++) {
            addIfPresent(loops[i]);
        }

        // States
        /**
         * @param {StateNode[]} states
         */
        const processStates = (states) => {
            for (let i = 0, len = states.length; i < len; i++) {
                addIfPresent(states[i]);
                if (states[i].substates) {
                    processStates(states[i].substates);
                }
            }
        };
        processStates(this.getStates());

        // Transitions
        const transitions = this.getTransitions();
        for (let i = 0, len = transitions.length; i < len; i++) {
            addIfPresent(transitions[i]);
        }

        // Entities
        const entities = this.getEntities();
        for (let i = 0, len = entities.length; i < len; i++) {
            addIfPresent(entities[i]);
        }

        // Relationships
        const relationships = this.getRelationships();
        for (let i = 0, len = relationships.length; i < len; i++) {
            addIfPresent(relationships[i]);
        }

        // Tree nodes
        /**
         * @param {TreeNode|null} node
         */
        const processTreeNode = (node) => {
            if (!node) {
                return;
            }
            addIfPresent(node);
            if (node.children) {
                for (let i = 0, len = node.children.length; i < len; i++) {
                    processTreeNode(node.children[i]);
                }
            }
        };
        processTreeNode(this.getRoot());

        return classes;
    }

    // =========================================================================
    // Serialization
    // =========================================================================

    /**
     * Serialize to JSON string
     * @param {number} [indent]
     * @returns {string}
     */
    toJson(indent = 2) {
        return JSON.stringify(this.data, null, indent);
    }

    /**
     * Serialize to YAML string
     * @returns {string}
     */
    toYaml() {
        return stringifyYaml(this.data);
    }

    /**
     * Save chart to its source path
     * @returns {boolean}
     */
    save() {
        if (!this.sourcePath) {
            return false;
        }
        const ext = extname(this.sourcePath).toLowerCase();
        const content = ext === ".json" ? this.toJson() : this.toYaml();
        writeFileSync(this.sourcePath, content, "utf8");
        return true;
    }

    /**
     * Save chart to a specific path
     * @param {string} absPath
     */
    saveTo(absPath) {
        const ext = extname(absPath).toLowerCase();
        const content = ext === ".json" ? this.toJson() : this.toYaml();
        writeFileSync(absPath, content, "utf8");
        this.sourcePath = absPath;
    }

    // =========================================================================
    // Cloning
    // =========================================================================

    /**
     * Create a deep copy of this chart
     * @returns {Chart}
     */
    clone() {
        const dataCopy = JSON.parse(JSON.stringify(this.data));
        return new Chart(dataCopy, this.sourcePath);
    }

    /**
     * Create a copy with new data
     * @param {Partial<ChartData>} overrides
     * @returns {Chart}
     */
    withData(overrides) {
        const merged = { ...this.data, ...overrides };
        return new Chart(merged, this.sourcePath);
    }
}
