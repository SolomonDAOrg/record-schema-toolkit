/**
 * Chart Renderers - Render chart AST to various output formats
 * @module format-ast/chart/renderers
 */

import {
    CHART_TYPES,
    CHART_NODE_TYPES,
    NODE_SHAPES,
    ARROW_TYPES,
    LINE_STYLES,
    MESSAGE_TYPES
} from "../../constants/chart.mjs";
import { BaseChartRenderer } from "./BaseChartRenderer.mjs";

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
// Mermaid Export Renderer
// =============================================================================

/**
 * Mermaid syntax export renderer
 */
export class ChartMermaidRenderer extends BaseChartRenderer {
    /** @override */
    getName() {
        return "chart-mermaid";
    }

    /** @override */
    getMimeType() {
        return "text/plain";
    }

    /** @override */
    getExtension() {
        return "mmd";
    }

    /**
     * Render chart to Mermaid syntax
     * @override
     * @param {ChartDocument} document
     * @param {ChartRenderOptions} [options]
     * @returns {ChartRenderResult}
     */
    render(document, options = {}) {
        this.clearMessages();

        const root = document.getRoot();
        if (!root) {
            return this.failureResult("Chart has no content");
        }

        const escapeMode = options.escapeMode || "html_entities";

        try {
            const chartType = document.getChartType();
            let output = "";

            switch (chartType) {
                case CHART_TYPES.FLOWCHART:
                    output = this._renderFlowchartMermaid(document, escapeMode);
                    break;
                case CHART_TYPES.SEQUENCE:
                    output = this._renderSequenceMermaid(document, escapeMode);
                    break;
                case CHART_TYPES.STATE:
                    output = this._renderStateMermaid(document, escapeMode);
                    break;
                case CHART_TYPES.ENTITY:
                    output = this._renderEntityMermaid(document, escapeMode);
                    break;
                default:
                    output = this._renderFlowchartMermaid(document, escapeMode);
            }

            return this.successResult(output, options.filename);
        } catch (err) {
            return this.failureResult(String(err));
        }
    }

    /**
     * Escape text for Mermaid
     * @param {string} text
     * @param {"html_entities" | "none"} mode
     * @returns {string}
     */
    _escape(text, mode) {
        if (mode === "none") {
            return text;
        }
        // HTML entities for Mermaid
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/\(/g, "&#40;")
            .replace(/\)/g, "&#41;")
            .replace(/\[/g, "&#91;")
            .replace(/\]/g, "&#93;")
            .replace(/\{/g, "&#123;")
            .replace(/\}/g, "&#125;");
    }

    /**
     * Render flowchart to Mermaid
     */
    _renderFlowchartMermaid(document, escapeMode) {
        const direction = document.getDirection();
        const nodes = document.getChartNodes();
        const edges = document.getChartEdges();
        const subgraphs = document.getSubgraphs();

        /** @type {string[]} */
        const lines = [];
        lines.push(`flowchart ${direction}`);

        // Nodes
        for (let i = 0, len = nodes.length; i < len; i++) {
            const node = nodes[i];
            const label = this._escape(node.label, escapeMode);
            const shape = this._mermaidShape(node.shape, label);
            lines.push(`    ${node.nodeId}${shape}`);
        }

        // Edges
        for (let i = 0, len = edges.length; i < len; i++) {
            const edge = edges[i];
            const arrow = this._mermaidArrow(edge);
            let line = `    ${edge.from} ${arrow} ${edge.to}`;
            if (edge.label) {
                const label = this._escape(edge.label, escapeMode);
                line = `    ${edge.from} ${arrow}|${label}| ${edge.to}`;
            }
            lines.push(line);
        }

        // Subgraphs
        for (let i = 0, len = subgraphs.length; i < len; i++) {
            this._renderSubgraphMermaid(subgraphs[i], lines, escapeMode, 1);
        }

        return lines.join("\n");
    }

    /**
     * Render subgraph to Mermaid
     */
    _renderSubgraphMermaid(subgraph, lines, escapeMode, indent) {
        const pad = "    ".repeat(indent);
        const label = subgraph.label
            ? this._escape(subgraph.label, escapeMode)
            : subgraph.subgraphId;
        lines.push(`${pad}subgraph ${subgraph.subgraphId}[${label}]`);

        if (subgraph.nodeIds) {
            for (let i = 0, len = subgraph.nodeIds.length; i < len; i++) {
                lines.push(`${pad}    ${subgraph.nodeIds[i]}`);
            }
        }

        // Nested
        for (let i = 0, len = subgraph.children.length; i < len; i++) {
            const child = subgraph.children[i];
            if (child.type === CHART_NODE_TYPES.CHART_SUBGRAPH) {
                this._renderSubgraphMermaid(
                    /** @type {ChartSubgraphNode} */ (child),
                    lines,
                    escapeMode,
                    indent + 1
                );
            }
        }

        lines.push(`${pad}end`);
    }

    /**
     * Get Mermaid shape syntax
     * @param {string} shape
     * @param {string} label
     * @returns {string}
     */
    _mermaidShape(shape, label) {
        switch (shape) {
            case NODE_SHAPES.ROUND:
                return `(${label})`;
            case NODE_SHAPES.STADIUM:
                return `([${label}])`;
            case NODE_SHAPES.DIAMOND:
                return `{${label}}`;
            case NODE_SHAPES.HEXAGON:
                return `{{${label}}}`;
            case NODE_SHAPES.CIRCLE:
                return `((${label}))`;
            case NODE_SHAPES.CYLINDER:
                return `[(${label})]`;
            case NODE_SHAPES.SUBROUTINE:
                return `[[${label}]]`;
            case NODE_SHAPES.ASYMMETRIC:
                return `>${label}]`;
            default:
                return `[${label}]`;
        }
    }

    /**
     * Get Mermaid arrow syntax
     * @param {ChartEdgeItem} edge
     * @returns {string}
     */
    _mermaidArrow(edge) {
        let arrow = "-->";
        if (edge.bidirectional) {
            arrow = "<-->";
        } else if (edge.arrow === ARROW_TYPES.OPEN) {
            arrow = "--o";
        } else if (edge.arrow === ARROW_TYPES.CROSS) {
            arrow = "--x";
        } else if (edge.arrow === ARROW_TYPES.NONE) {
            arrow = "---";
        } else if (edge.lineStyle === LINE_STYLES.DASHED) {
            arrow = "-.->";
        } else if (edge.lineStyle === LINE_STYLES.THICK) {
            arrow = "==>";
        }
        return arrow;
    }

    /**
     * Render sequence diagram to Mermaid
     */
    _renderSequenceMermaid(document, escapeMode) {
        const participants = document.getParticipants();
        const messages = document.getMessages();

        /** @type {string[]} */
        const lines = [];
        lines.push("sequenceDiagram");

        // Participants
        for (let i = 0, len = participants.length; i < len; i++) {
            const p = participants[i];
            const label = this._escape(p.label, escapeMode);
            lines.push(`    participant ${p.participantId} as ${label}`);
        }

        // Messages
        for (let i = 0, len = messages.length; i < len; i++) {
            const msg = messages[i];
            let arrow = "->>";
            if (msg.messageType === MESSAGE_TYPES.ASYNC) {
                arrow = "-)";
            } else if (msg.messageType === MESSAGE_TYPES.REPLY) {
                arrow = "-->>";
            }
            const label = msg.label ? this._escape(msg.label, escapeMode) : "";
            lines.push(`    ${msg.from}${arrow}${msg.to}: ${label}`);
        }

        return lines.join("\n");
    }

    /**
     * Render state diagram to Mermaid
     */
    _renderStateMermaid(document, escapeMode) {
        const states = document.getStates();
        const transitions = document.getTransitions();

        /** @type {string[]} */
        const lines = [];
        lines.push("stateDiagram-v2");

        // States
        for (let i = 0, len = states.length; i < len; i++) {
            const state = states[i];
            if (state.initial) {
                lines.push(`    [*] --> ${state.stateId}`);
            }
            const label = this._escape(state.label, escapeMode);
            lines.push(`    ${state.stateId} : ${label}`);
            if (state.final) {
                lines.push(`    ${state.stateId} --> [*]`);
            }
        }

        // Transitions
        for (let i = 0, len = transitions.length; i < len; i++) {
            const t = transitions[i];
            const label = t.buildLabel();
            if (label) {
                lines.push(
                    `    ${t.from} --> ${t.to} : ${this._escape(
                        label,
                        escapeMode
                    )}`
                );
            } else {
                lines.push(`    ${t.from} --> ${t.to}`);
            }
        }

        return lines.join("\n");
    }

    /**
     * Render ER diagram to Mermaid
     */
    _renderEntityMermaid(document, escapeMode) {
        const entities = document.getEntities();
        const relationships = document.getRelationships();

        /** @type {string[]} */
        const lines = [];
        lines.push("erDiagram");

        // Entities
        for (let i = 0, len = entities.length; i < len; i++) {
            const entity = entities[i];
            const attrs = entity.getAttributes();
            lines.push(`    ${entity.entityId} {`);
            for (let j = 0, jlen = attrs.length; j < jlen; j++) {
                const attr = attrs[j];
                const keyMark =
                    attr.keyType === "primary"
                        ? " PK"
                        : attr.keyType === "foreign"
                        ? " FK"
                        : "";
                lines.push(
                    `        ${attr.dataType || "string"} ${
                        attr.name
                    }${keyMark}`
                );
            }
            lines.push(`    }`);
        }

        // Relationships
        for (let i = 0, len = relationships.length; i < len; i++) {
            const rel = relationships[i];
            const card = this._mermaidCardinality(rel.cardinality);
            const label = rel.label
                ? ` : "${this._escape(rel.label, escapeMode)}"`
                : "";
            lines.push(`    ${rel.from} ${card} ${rel.to}${label}`);
        }

        return lines.join("\n");
    }

    /**
     * Convert cardinality to Mermaid syntax
     * @param {string} cardinality
     * @returns {string}
     */
    _mermaidCardinality(cardinality) {
        switch (cardinality) {
            case "1:1":
                return "||--||";
            case "1:N":
                return "||--o{";
            case "N:1":
                return "}o--||";
            case "N:M":
                return "}o--o{";
            case "0..1:1":
                return "|o--||";
            case "0..1:N":
                return "|o--o{";
            case "1:0..1":
                return "||--o|";
            default:
                return "||--||";
        }
    }
}
