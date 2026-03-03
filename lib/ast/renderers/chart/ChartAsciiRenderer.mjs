/**
 * Chart Renderers - Render chart AST to various output formats
 * @module format-ast/chart/renderers
 */

import { BaseChartRenderer } from "./BaseChartRenderer.mjs";
import { CHART_TYPES } from "../../constants/chart.mjs";

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
// ASCII Renderer
// =============================================================================

/**
 * ASCII/text chart renderer
 */
export class ChartAsciiRenderer extends BaseChartRenderer {
    /** @override */
    getName() {
        return "chart-ascii";
    }

    /** @override */
    getMimeType() {
        return "text/plain";
    }

    /** @override */
    getExtension() {
        return "txt";
    }

    /**
     * Render chart to ASCII
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

        const boxChars = options.boxChars || "unicode";
        const maxWidth = options.maxWidth || 120;

        try {
            const chartType = document.getChartType();
            let output = "";

            switch (chartType) {
                case CHART_TYPES.FLOWCHART:
                    output = this._renderFlowchartAscii(
                        document,
                        boxChars,
                        maxWidth
                    );
                    break;
                case CHART_TYPES.SEQUENCE:
                    output = this._renderSequenceAscii(
                        document,
                        boxChars,
                        maxWidth
                    );
                    break;
                case CHART_TYPES.TREE:
                    output = this._renderTreeAscii(document, boxChars);
                    break;
                default:
                    output = this._renderFlowchartAscii(
                        document,
                        boxChars,
                        maxWidth
                    );
            }

            return this.successResult(output, options.filename);
        } catch (err) {
            return this.failureResult(String(err));
        }
    }

    /**
     * Render flowchart to ASCII
     */
    _renderFlowchartAscii(document, boxChars, maxWidth) {
        const nodes = document.getChartNodes();
        const edges = document.getChartEdges();

        const box =
            boxChars === "unicode"
                ? {
                      tl: "┌",
                      tr: "┐",
                      bl: "└",
                      br: "┘",
                      h: "─",
                      v: "│",
                      arrow: "→"
                  }
                : {
                      tl: "+",
                      tr: "+",
                      bl: "+",
                      br: "+",
                      h: "-",
                      v: "|",
                      arrow: ">"
                  };

        /** @type {string[]} */
        const lines = [];

        // Title
        const title = document.getTitle();
        if (title) {
            lines.push(title);
            lines.push("=".repeat(title.length));
            lines.push("");
        }

        // Nodes
        lines.push("Nodes:");
        for (let i = 0, len = nodes.length; i < len; i++) {
            const node = nodes[i];
            const label = node.label || node.nodeId;
            const boxWidth = Math.max(label.length + 4, 10);
            lines.push(`  ${box.tl}${box.h.repeat(boxWidth - 2)}${box.tr}`);
            lines.push(`  ${box.v} ${label.padEnd(boxWidth - 4)} ${box.v}`);
            lines.push(`  ${box.bl}${box.h.repeat(boxWidth - 2)}${box.br}`);
            if (i < len - 1) {
                lines.push("");
            }
        }

        // Edges
        if (edges.length > 0) {
            lines.push("");
            lines.push("Edges:");
            for (let i = 0, len = edges.length; i < len; i++) {
                const edge = edges[i];
                let edgeStr = `  ${edge.from} ${box.h}${box.h}${box.arrow} ${edge.to}`;
                if (edge.label) {
                    edgeStr += ` : "${edge.label}"`;
                }
                lines.push(edgeStr);
            }
        }

        return lines.join("\n");
    }

    /**
     * Render sequence diagram to ASCII
     */
    _renderSequenceAscii(document, boxChars, maxWidth) {
        const participants = document.getParticipants();
        const messages = document.getMessages();

        /** @type {string[]} */
        const lines = [];

        // Title
        const title = document.getTitle();
        if (title) {
            lines.push(title);
            lines.push("=".repeat(title.length));
            lines.push("");
        }

        // Participants header
        const pLabels = participants.map((p) => p.label);
        const colWidth = Math.max(...pLabels.map((l) => l.length), 10) + 4;

        // Header row
        lines.push(
            pLabels
                .map((l) =>
                    l.padStart((colWidth + l.length) / 2).padEnd(colWidth)
                )
                .join("")
        );
        lines.push(
            participants
                .map(() => "|".padStart(colWidth / 2).padEnd(colWidth))
                .join("")
        );

        // Messages
        const pIndex = new Map(
            participants.map((p, i) => [p.participantId, i])
        );

        for (let i = 0, len = messages.length; i < len; i++) {
            const msg = messages[i];
            const fromIdx = pIndex.get(msg.from) ?? 0;
            const toIdx = pIndex.get(msg.to) ?? 0;

            const row = new Array(participants.length).fill(
                "|".padStart(colWidth / 2).padEnd(colWidth)
            );

            if (fromIdx < toIdx) {
                // Left to right
                const arrowLine =
                    "-".repeat((toIdx - fromIdx) * colWidth - 2) + ">";
                const start = fromIdx * colWidth + colWidth / 2;
                let line = row.join("");
                line =
                    line.substring(0, start) +
                    arrowLine +
                    line.substring(start + arrowLine.length);
                lines.push(line);
            } else {
                // Right to left
                const arrowLine =
                    "<" + "-".repeat((fromIdx - toIdx) * colWidth - 2);
                const start = toIdx * colWidth + colWidth / 2;
                let line = row.join("");
                line =
                    line.substring(0, start) +
                    arrowLine +
                    line.substring(start + arrowLine.length);
                lines.push(line);
            }

            if (msg.label) {
                const labelLine = row.join("");
                const mid = ((fromIdx + toIdx) / 2) * colWidth;
                lines.push(`${" ".repeat(Math.max(0, mid))}${msg.label}`);
            }
        }

        return lines.join("\n");
    }

    /**
     * Render tree to ASCII
     */
    _renderTreeAscii(document, boxChars) {
        const treeRoot = document.getTreeRoot();
        if (!treeRoot) {
            return "(empty tree)";
        }

        const branch = boxChars === "unicode" ? "├── " : "+-- ";
        const last = boxChars === "unicode" ? "└── " : "`-- ";
        const pipe = boxChars === "unicode" ? "│   " : "|   ";
        const space = "    ";

        /** @type {string[]} */
        const lines = [];

        const renderNode = (node, prefix, isLast) => {
            const connector = isLast ? last : branch;
            lines.push(prefix + connector + node.label);

            const children = node.getChildren();
            for (let i = 0, len = children.length; i < len; i++) {
                const child = children[i];
                const childPrefix = prefix + (isLast ? space : pipe);
                renderNode(child, childPrefix, i === len - 1);
            }
        };

        lines.push(treeRoot.label);
        const children = treeRoot.getChildren();
        for (let i = 0, len = children.length; i < len; i++) {
            renderNode(children[i], "", i === len - 1);
        }

        return lines.join("\n");
    }
}
