/**
 * Chart Renderers - Render chart AST to various output formats
 * @module format-ast/chart/renderers
 */

import {
    wrapText,
    estimateCharWidth,
    estimateTextWidth
} from "../../util/text.mjs";
import {
    CHART_TYPES,
    NODE_SHAPES,
    ARROW_TYPES,
    LINE_STYLES,
    MESSAGE_TYPES,
    CHART_DEFAULTS,
    CHART_NODE_TYPES
} from "../../constants/chart.mjs";
import { BaseChartRenderer } from "./BaseChartRenderer.mjs";
import { ChartLayoutEngine } from "../../layout/ChartLayoutEngine_compound.mjs";

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
 * @typedef {import("../../types/chart.mjs").NodePosition} NodePosition
 * @typedef {import("../../types/chart.mjs").NodeSizeInfo} NodeSizeInfo
 * @typedef {import("../../types/chart.mjs").ExtendedNodePosition} ExtendedNodePosition
 */

// =============================================================================
// SVG Renderer
// =============================================================================

/**
 * SVG chart renderer with dynamic sizing
 */
export class ChartSvgRenderer extends BaseChartRenderer {
    /**
     * @param {ChartRenderPackAdapter} adapter
     */
    constructor(adapter) {
        super(adapter);

        /** @type {ChartLayoutEngine} */
        this.chartLayoutEngine = new ChartLayoutEngine();
    }

    /** @override */
    getName() {
        return "chart-svg";
    }

    /** @override */
    getMimeType() {
        return "image/svg+xml";
    }

    /** @override */
    getExtension() {
        return "svg";
    }

    /**
     * Render chart to SVG
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

        const theme = options.theme || document.renderConfig.theme || "default";
        const padding = options.padding ?? document.renderConfig.padding ?? 20;
        const background =
            options.background ??
            document.renderConfig.background ??
            "transparent";

        const maxWidth =
            options.maxWidth ?? document.renderConfig.maxWidth ?? 300;
        // Debug surface: packs/theme/style resolution (printed only when CLI --verbose is enabled)
        this.addWarning(
            `render svg debug theme=${theme} direction=${document.getDirection()} padding=${padding} background=${background} maxWidth=${maxWidth}`
        );
        if (this.adapter) {
            const packs = this.adapter.packs || [];
            /** @type {string[]} */
            const packLabels = [];
            for (let i = 0, len = packs.length; i < len; i++) {
                const p = packs[i];
                const label = p?.pack_id || `pack#${i}`;
                packLabels.push(String(label));
            }
            this.addWarning(
                `render packs count=${packs.length} labels=${packLabels.join(
                    ","
                )}`
            );
            const themeNames = this.adapter.getThemeNames
                ? this.adapter.getThemeNames()
                : [];
            const themeExists = this.adapter.getTheme
                ? !!this.adapter.getTheme(theme)
                : false;
            this.addWarning(
                `render theme exists=${themeExists} available=${
                    themeNames.join(",") || "(none)"
                }`
            );
            const themeData = this.adapter.getTheme
                ? this.adapter.getTheme(theme)
                : null;
            if (themeData) {
                const nd = themeData.node_defaults || {};
                const ed = themeData.edge_defaults || {};
                const sd = themeData.subgraph_defaults || {};
                this.addWarning(
                    `render theme defaults node(fill=${nd.fill} stroke=${nd.stroke} fontFamily=${nd.fontFamily} fontSize=${nd.fontSize})`
                );
                this.addWarning(
                    `render theme defaults edge(stroke=${ed.stroke} strokeWidth=${ed.strokeWidth})`
                );
                this.addWarning(
                    `render theme defaults subgraph(fill=${sd.fill} stroke=${sd.stroke} dash=${sd.strokeDasharray})`
                );
            } else {
                this.addWarning("render theme defaults (none)");
            }
        } else {
            this.addWarning("render packs count=0 (no adapter)");
        }

        try {
            const chartType = document.getChartType();
            let svg = "";

            switch (chartType) {
                case CHART_TYPES.FLOWCHART:
                    svg = this._renderFlowchart(
                        document,
                        theme,
                        padding,
                        background,
                        maxWidth,
                        options
                    );
                    break;
                case CHART_TYPES.SEQUENCE:
                    svg = this._renderSequence(
                        document,
                        theme,
                        padding,
                        background
                    );
                    break;
                case CHART_TYPES.STATE:
                    svg = this._renderState(
                        document,
                        theme,
                        padding,
                        background
                    );
                    break;
                case CHART_TYPES.ENTITY:
                    svg = this._renderEntity(
                        document,
                        theme,
                        padding,
                        background
                    );
                    break;
                case CHART_TYPES.TREE:
                    svg = this._renderTree(
                        document,
                        theme,
                        padding,
                        background
                    );
                    break;
                default:
                    svg = this._renderFlowchart(
                        document,
                        theme,
                        padding,
                        background,
                        maxWidth,
                        options
                    );
            }

            return this.successResult(svg, options.filename);
        } catch (err) {
            return this.failureResult(err);
        }
    }

    // =========================================================================
    // Node Size Calculation
    // =========================================================================

    /**
     * Calculate node dimensions based on content
     * @param {ChartNodeItem} node
     * @param {string} theme
     * @param {number} [maxWidth=300] - Maximum allowed width
     * @returns {NodeSizeInfo}
     */
    _calculateNodeSize(node, theme, maxWidth = 300) {
        const style = this.getNodeStyle(node, theme);
        const fontSize = style.fontSize || 12;
        const lineHeight = fontSize * 1.4;

        // Get padding from style or use defaults
        /** @type {{ top: number, right: number, bottom: number, left: number }} */
        let padding = { top: 12, right: 16, bottom: 12, left: 16 };
        if (style.padding) {
            if (typeof style.padding === "number") {
                padding = {
                    top: style.padding,
                    right: style.padding,
                    bottom: style.padding,
                    left: style.padding
                };
            } else if (typeof style.padding === "object") {
                padding = { ...padding, ...style.padding };
            }
        }

        const contentMaxWidth = maxWidth - padding.left - padding.right;
        const label = node.label || node.nodeId;

        // Wrap text
        const lines = wrapText(label, contentMaxWidth, fontSize);

        // Calculate dimensions
        let maxLineWidth = 0;
        for (let i = 0, len = lines.length; i < len; i++) {
            const lineWidth = estimateTextWidth(lines[i], fontSize);
            if (lineWidth > maxLineWidth) {
                maxLineWidth = lineWidth;
            }
        }

        const textHeight = lines.length * lineHeight;
        const width = Math.max(
            CHART_DEFAULTS.NODE_MIN_WIDTH,
            Math.min(maxWidth, maxLineWidth + padding.left + padding.right)
        );
        const height = Math.max(
            CHART_DEFAULTS.NODE_MIN_HEIGHT,
            textHeight + padding.top + padding.bottom
        );

        return {
            width,
            height,
            lines,
            lineHeight,
            fontSize,
            padding
        };
    }

    /**
     * Render flowchart to SVG
     * @param {ChartDocument} document
     * @param {string} theme
     * @param {number} padding
     * @param {string} background
     * @param {number} maxWidth
     * @returns {string}
     */
    _renderFlowchart(
        document,
        theme,
        padding,
        background,
        maxWidth,
        options = {}
    ) {
        const nodes = document.getChartNodes();
        const edges = document.getChartEdges();
        const subgraphs = document.getSubgraphs ? document.getSubgraphs() : [];
        const direction = document.getDirection();

        const debug = Boolean(options.debug || options.verbose);
        if (debug) {
            this.addWarning(
                `render svg debug theme=${theme} direction=${direction} padding=${padding} background=${background}`
            );
            const adapter = this.adapter;
            if (adapter && typeof adapter.getDebugLines === "function") {
                const lines = adapter.getDebugLines(theme);
                for (let i = 0, len = lines.length; i < len; i++) {
                    this.addWarning(lines[i]);
                }
            }
        }

        // 1. Calculate all node sizes first (needed for layout)
        /** @type {Map<string, NodeSizeInfo>} */
        const nodeSizes = new Map();
        let zeroSizeCount = 0;
        let minW = Number.POSITIVE_INFINITY;
        let minH = Number.POSITIVE_INFINITY;
        let maxW = maxWidth;
        let maxH = 0;
        for (let i = 0, len = nodes.length; i < len; i++) {
            const node = nodes[i];
            const size = this._calculateNodeSize(node, theme);
            nodeSizes.set(node.nodeId, size);
            minW = Math.min(minW, size.width);
            minH = Math.min(minH, size.height);
            maxW = Math.max(maxW, size.width);
            maxH = Math.max(maxH, size.height);
            if (!(size.width > 0 && size.height > 0)) {
                zeroSizeCount++;
                if (debug) {
                    this.addWarning(
                        `nodeSize invalid nodeId=${node.nodeId} width=${size.width} height=${size.height}`
                    );
                }
            }
        }

        if (debug) {
            this.addWarning(
                `nodeSizes count=${nodes.length} minW=${Math.round(
                    minW
                )} minH=${Math.round(minH)} maxW=${Math.round(
                    maxW
                )} maxH=${Math.round(maxH)} zeroOrInvalid=${zeroSizeCount}`
            );

            const limit =
                typeof options.debugNodeLimit === "number"
                    ? Math.max(0, options.debugNodeLimit)
                    : 20;
            for (let i = 0; i < nodes.length && i < limit; i++) {
                const node = nodes[i];
                const s = this.getNodeStyle(node, theme);
                this.addWarning(
                    `nodeStyle nodeId=${node.nodeId} class=${
                        node.styleClass || ""
                    } shape=${s.shape} fontFamily=${s.fontFamily} fontSize=${
                        s.fontSize
                    } fill=${s.fill} stroke=${s.stroke} strokeWidth=${
                        s.strokeWidth
                    }`
                );
            }
        }

        // 2. Use ChartLayoutEngine to get positions and edge routes
        // Resolve layout config from document or defaults
        const layoutConfig = this._resolveFlowchartLayoutConfig(
            document.renderConfig,
            {} // layout options if passed down
        );

        if (debug) {
            layoutConfig.debug = true;
            if (typeof options.debugMaxMessages === "number") {
                layoutConfig.debugMaxMessages = options.debugMaxMessages;
            }
            if (typeof options.debugMaxOverlaps === "number") {
                layoutConfig.debugMaxOverlaps = options.debugMaxOverlaps;
            }
        }

        const layoutResult = this.chartLayoutEngine.layoutFlowchart({
            nodes,
            edges,
            subgraphs,
            direction,
            nodeSizes,
            layoutConfig
        });

        const { positions, edgeRoutes, bounds } = layoutResult;
        if (debug && layoutResult && layoutResult.debug) {
            const msgs = layoutResult.debug.messages || [];
            for (let i = 0, len = msgs.length; i < len; i++) {
                this.addWarning(msgs[i]);
            }
        }

        // 3. Merge text metrics (lines, fontSize) back into positions
        // The engine returns geometry (x,y,w,h), but the renderer needs the text lines calculated in step 1.
        for (const [id, pos] of positions) {
            const sizeInfo = nodeSizes.get(id);
            if (sizeInfo) {
                pos.lines = sizeInfo.lines;
                pos.lineHeight = sizeInfo.lineHeight;
                pos.fontSize = sizeInfo.fontSize;
            }
        }

        // 4. Calculate canvas size from bounds
        const width = bounds.maxX + padding * 2;
        const height = bounds.maxY + padding * 2;

        /** @type {string[]} */
        const parts = [];

        // SVG header
        parts.push(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
        );

        // Background
        if (background !== "transparent") {
            parts.push(
                `  <rect width="100%" height="100%" fill="${background}"/>`
            );
        }

        // Defs for arrows
        parts.push(`  <defs>`);
        parts.push(
            `    <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">`
        );
        parts.push(`      <polygon points="0 0, 10 3.5, 0 7" fill="#666666"/>`);
        parts.push(`    </marker>`);
        parts.push(
            `    <marker id="arrowhead-start" markerWidth="10" markerHeight="7" refX="0" refY="3.5" orient="auto">`
        );
        parts.push(
            `      <polygon points="10 0, 0 3.5, 10 7" fill="#666666"/>`
        );
        parts.push(`    </marker>`);
        parts.push(
            `    <marker id="arrowhead-open" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">`
        );
        parts.push(
            `      <polyline points="0 0, 10 3.5, 0 7" fill="none" stroke="#666666" stroke-width="1.5"/>`
        );
        parts.push(`    </marker>`);
        parts.push(
            `    <marker id="arrowhead-open-start" markerWidth="10" markerHeight="7" refX="0" refY="3.5" orient="auto">`
        );
        parts.push(
            `      <polyline points="10 0, 0 3.5, 10 7" fill="none" stroke="#666666" stroke-width="1.5"/>`
        );
        parts.push(`    </marker>`);
        parts.push(
            `    <marker id="arrowhead-cross" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto">`
        );
        parts.push(
            `      <path d="M2,2 L8,8 M8,2 L2,8" stroke="#666666" stroke-width="1.6" fill="none"/>`
        );
        parts.push(`    </marker>`);
        parts.push(
            `    <marker id="arrowhead-cross-start" markerWidth="10" markerHeight="10" refX="1" refY="5" orient="auto">`
        );
        parts.push(
            `      <path d="M2,2 L8,8 M8,2 L2,8" stroke="#666666" stroke-width="1.6" fill="none"/>`
        );
        parts.push(`    </marker>`);
        parts.push(`  </defs>`);

        // Render subgraphs first (as background boxes)
        if (subgraphs && subgraphs.length > 0) {
            /** @type {{subgraph:any, depth:number}[]} */
            const subgraphsWithDepth = [];
            /** @type {Map<string, number>} */
            const depthBySubgraphId = new Map();

            const visit = (subgraphNode, depth) => {
                if (!subgraphNode || !subgraphNode.subgraphId) return;
                const subgraphId = String(subgraphNode.subgraphId);
                const existingDepth = depthBySubgraphId.get(subgraphId);
                if (
                    typeof existingDepth !== "number" ||
                    depth < existingDepth
                ) {
                    depthBySubgraphId.set(subgraphId, depth);
                }
                subgraphsWithDepth.push({ subgraph: subgraphNode, depth });

                if (
                    !subgraphNode.children ||
                    !Array.isArray(subgraphNode.children)
                )
                    return;
                for (
                    let childIndex = 0,
                        childLength = subgraphNode.children.length;
                    childIndex < childLength;
                    childIndex++
                ) {
                    const childNode = subgraphNode.children[childIndex];
                    if (childNode && childNode.subgraphId)
                        visit(childNode, depth + 1);
                }
            };

            for (
                let topIndex = 0, topLength = subgraphs.length;
                topIndex < topLength;
                topIndex++
            ) {
                visit(subgraphs[topIndex], 0);
            }

            // De-duplicate by subgraphId, then render parents first (lower depth), children last.
            /** @type {Map<string, any>} */
            const subgraphById = new Map();
            for (
                let entryIndex = 0, entryLength = subgraphsWithDepth.length;
                entryIndex < entryLength;
                entryIndex++
            ) {
                const entry = subgraphsWithDepth[entryIndex];
                const subgraphId = String(entry.subgraph.subgraphId);
                if (!subgraphById.has(subgraphId))
                    subgraphById.set(subgraphId, entry.subgraph);
            }

            const orderedSubgraphs = Array.from(subgraphById.values()).sort(
                (left, right) => {
                    const leftDepth =
                        depthBySubgraphId.get(String(left.subgraphId)) || 0;
                    const rightDepth =
                        depthBySubgraphId.get(String(right.subgraphId)) || 0;
                    if (leftDepth !== rightDepth) return leftDepth - rightDepth;
                    const leftId = String(left.subgraphId);
                    const rightId = String(right.subgraphId);
                    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
                }
            );

            for (let i = 0, len = orderedSubgraphs.length; i < len; i++) {
                const subgraph = orderedSubgraphs[i];
                parts.push(
                    this._renderSubgraphSvg(subgraph, positions, theme, padding)
                );
            }
        }

        // Render edges (below nodes)
        for (let i = 0, len = edges.length; i < len; i++) {
            const edge = edges[i];
            const fromPos = positions.get(edge.from);
            const toPos = positions.get(edge.to);
            if (fromPos && toPos) {
                parts.push(
                    this._renderEdgeSvg(
                        edge,
                        fromPos,
                        toPos,
                        theme,
                        padding,
                        edgeRoutes.get(edge.id) || null
                    )
                );
            }
        }

        // Render nodes
        for (let i = 0, len = nodes.length; i < len; i++) {
            const node = nodes[i];
            const pos = positions.get(node.nodeId);
            if (pos) {
                parts.push(this._renderNodeSvg(node, pos, theme, padding));
            }
        }

        parts.push(`</svg>`);

        return parts.join("\n");
    }

    /**
     * Layout flowchart nodes with dynamic sizing
     * @param {ChartNodeItem[]} nodes
     * @param {string} direction
     * @param {Map<string, NodeSizeInfo>} nodeSizes
     * @param {ChartSubgraphNode[]} [subgraphs]
     * @returns {Map<string, ExtendedNodePosition>}
     */
    _layoutFlowchartNodes(nodes, direction, nodeSizes, subgraphs = []) {
        /** @type {Map<string, ExtendedNodePosition>} */
        const positions = new Map();

        const hSpacing = 40;
        const vSpacing = 40;
        const isVertical =
            direction === "TD" || direction === "TB" || direction === "BT";

        // Build subgraph membership map
        /** @type {Map<string, string>} */
        const nodeToSubgraph = new Map();
        /** @type {Map<string, string[]>} */
        const subgraphNodes = new Map();

        /**
         * @param {ChartSubgraphNode[]} sgs
         * @param {string} [parentId]
         */
        const collectSubgraphNodes = (sgs, parentId) => {
            for (let i = 0, len = sgs.length; i < len; i++) {
                const sg = sgs[i];
                const sgId = sg.subgraphId; // || sg.nodeId;
                /** @type {string[]} */
                const memberIds = [];

                if (sg.nodeIds) {
                    for (let j = 0, jlen = sg.nodeIds.length; j < jlen; j++) {
                        nodeToSubgraph.set(sg.nodeIds[j], sgId);
                        memberIds.push(sg.nodeIds[j]);
                    }
                }

                subgraphNodes.set(sgId, memberIds);

                if (sg.children && sg.children.length > 0) {
                    /** @type {ChartSubgraphNode[]} */
                    const children = [];

                    for (let j = 0, len = sg.children.length; j < len; j++) {
                        const child = sg.children[j];
                        if (child.type === CHART_NODE_TYPES.CHART_SUBGRAPH) {
                            children.push(
                                /** @type {ChartSubgraphNode} */ (child)
                            );
                        }
                    }

                    if (children.length) {
                        collectSubgraphNodes(children, sgId);
                    }
                }
            }
        };

        if (subgraphs) {
            collectSubgraphNodes(subgraphs);
        }

        // Group nodes by subgraph
        /** @type {Map<string, ChartNodeItem[]>} */
        const groupedNodes = new Map();
        groupedNodes.set("__root__", []);

        for (let i = 0, len = nodes.length; i < len; i++) {
            const node = nodes[i];
            const sgId = nodeToSubgraph.get(node.nodeId) || "__root__";
            if (!groupedNodes.has(sgId)) {
                groupedNodes.set(sgId, []);
            }
            groupedNodes.get(sgId).push(node);
        }

        // Layout each group
        let groupY = 0;

        for (const [groupId, groupNodes] of groupedNodes) {
            if (groupNodes.length === 0) {
                continue;
            }

            let currentX = 0;
            let currentY = groupY;
            let rowMaxHeight = 0;
            const maxRowWidth = 1400;

            for (let i = 0, len = groupNodes.length; i < len; i++) {
                const node = groupNodes[i];
                const size = nodeSizes.get(node.nodeId) || {
                    width: CHART_DEFAULTS.NODE_MIN_WIDTH,
                    height: CHART_DEFAULTS.NODE_MIN_HEIGHT,
                    lines: [node.label || node.nodeId],
                    lineHeight: 16.8,
                    fontSize: 12,
                    padding: { top: 12, right: 16, bottom: 12, left: 16 }
                };

                // Check if we need to wrap to next row
                if (currentX + size.width > maxRowWidth && currentX > 0) {
                    currentX = 0;
                    currentY += rowMaxHeight + vSpacing;
                    rowMaxHeight = 0;
                }

                positions.set(node.nodeId, {
                    x: currentX,
                    y: currentY,
                    width: size.width,
                    height: size.height,
                    lines: size.lines,
                    lineHeight: size.lineHeight,
                    fontSize: size.fontSize
                });

                currentX += size.width + hSpacing;
                rowMaxHeight = Math.max(rowMaxHeight, size.height);
            }

            groupY = currentY + rowMaxHeight + vSpacing * 2;
        }

        return positions;
    }

    /**
     * Render subgraph background box
     * @param {ChartSubgraphNode} subgraph
     * @param {Map<string, ExtendedNodePosition>} positions
     * @param {string} theme
     * @param {number} padding
     * @returns {string}
     */
    _renderSubgraphSvg(subgraph, positions, theme, padding) {
        const style = this.getSubgraphStyle(subgraph, theme);
        const fill = style.fill || "#f8f9fa";
        const stroke = style.stroke || "#dee2e6";
        const strokeWidth = style.strokeWidth || 1;

        // Find bounding box of member nodes
        const nodeIds = subgraph.nodeIds || [];
        if (nodeIds.length === 0) {
            return "";
        }

        let minX = Infinity,
            minY = Infinity,
            maxX = -Infinity,
            maxY = -Infinity;
        let hasNodes = false;

        for (let i = 0, len = nodeIds.length; i < len; i++) {
            const pos = positions.get(nodeIds[i]);
            if (pos) {
                hasNodes = true;
                minX = Math.min(minX, pos.x);
                minY = Math.min(minY, pos.y);
                maxX = Math.max(maxX, pos.x + pos.width);
                maxY = Math.max(maxY, pos.y + pos.height);
            }
        }

        if (!hasNodes) {
            return "";
        }

        // Add padding around nodes
        const sgPadding = 20;
        const labelHeight = 24;

        const x = minX + padding - sgPadding;
        const y = minY + padding - sgPadding - labelHeight;
        const width = maxX - minX + sgPadding * 2;
        const height = maxY - minY + sgPadding * 2 + labelHeight;

        /** @type {string[]} */
        const parts = [];

        // Background rect
        parts.push(
            `  <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" rx="8"/>`
        );

        // Label
        if (subgraph.label) {
            parts.push(
                `  <text x="${x + 10}" y="${
                    y + 16
                }" fill="#495057" font-size="11" font-weight="600">${this._escapeXml(
                    subgraph.label
                )}</text>`
            );
        }

        return parts.join("\n");
    }

    /**
     * Render node to SVG with proper text wrapping
     * @param {ChartNodeItem} node
     * @param {ExtendedNodePosition} pos
     * @param {string} theme
     * @param {number} padding
     * @returns {string}
     */
    _renderNodeSvg(node, pos, theme, padding) {
        const style = this.getNodeStyle(node, theme);
        const fill = style.fill || "#ffffff";
        const stroke = style.stroke || "#333333";
        const strokeWidth = style.strokeWidth || 1;
        const textColor = style.textColor || "#1a1a1a";

        const x = pos.x + padding;
        const y = pos.y + padding;
        const cx = x + pos.width / 2;
        const cy = y + pos.height / 2;

        const fontSize = pos.fontSize || 12;
        const lineHeight = pos.lineHeight || fontSize * 1.4;
        const lines = pos.lines || [node.label || node.nodeId];

        /** @type {string[]} */
        const parts = [];

        // Shape
        switch (node.shape) {
            case NODE_SHAPES.ROUND:
                parts.push(
                    `  <rect x="${x}" y="${y}" width="${pos.width}" height="${pos.height}" rx="10" ry="10" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
                );
                break;
            case NODE_SHAPES.STADIUM:
                const ry = Math.min(pos.height / 2, 20);
                parts.push(
                    `  <rect x="${x}" y="${y}" width="${pos.width}" height="${pos.height}" rx="${ry}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
                );
                break;
            case NODE_SHAPES.DIAMOND:
                const dx = pos.width / 2;
                const dy = pos.height / 2;
                parts.push(
                    `  <polygon points="${cx},${y} ${
                        x + pos.width
                    },${cy} ${cx},${
                        y + pos.height
                    } ${x},${cy}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
                );
                break;
            case NODE_SHAPES.CIRCLE:
                const r = Math.min(pos.width, pos.height) / 2;
                parts.push(
                    `  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
                );
                break;
            case NODE_SHAPES.CYLINDER:
                const ellipseRy = Math.min(8, pos.height / 6);
                parts.push(
                    `  <path d="M${x},${y + ellipseRy} ` +
                        `a${pos.width / 2},${ellipseRy} 0 0,1 ${pos.width},0 ` +
                        `v${pos.height - ellipseRy * 2} ` +
                        `a${
                            pos.width / 2
                        },${ellipseRy} 0 0,1 ${-pos.width},0 ` +
                        `z" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
                );
                parts.push(
                    `  <ellipse cx="${cx}" cy="${y + ellipseRy}" rx="${
                        pos.width / 2
                    }" ry="${ellipseRy}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
                );
                break;
            default: // RECT
                parts.push(
                    `  <rect x="${x}" y="${y}" width="${pos.width}" height="${pos.height}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
                );
        }

        // Label with tspan for multi-line text
        parts.push(
            this._renderTextSvg(lines, cx, cy, fontSize, lineHeight, textColor)
        );

        return parts.join("\n");
    }

    /**
     * Render multi-line text using tspan elements
     * @param {string[]} lines
     * @param {number} cx - Center X
     * @param {number} cy - Center Y
     * @param {number} fontSize
     * @param {number} lineHeight
     * @param {string} textColor
     * @returns {string}
     */
    _renderTextSvg(lines, cx, cy, fontSize, lineHeight, textColor) {
        if (lines.length === 0) {
            return "";
        }

        const totalHeight = lines.length * lineHeight;
        const startY = cy - totalHeight / 2 + lineHeight * 0.7; // Adjust for baseline

        /** @type {string[]} */
        const tspans = [];
        for (let i = 0, len = lines.length; i < len; i++) {
            const line = lines[i];
            const dy = i === 0 ? 0 : lineHeight;
            tspans.push(
                `<tspan x="${cx}" dy="${dy}">${this._escapeXml(line)}</tspan>`
            );
        }

        return `  <text x="${cx}" y="${startY}" text-anchor="middle" fill="${textColor}" font-size="${fontSize}">${tspans.join(
            ""
        )}</text>`;
    }

    /**
     * Render edge to SVG
     * @param {ChartEdgeItem} edge
     * @param {ExtendedNodePosition} fromPos
     * @param {ExtendedNodePosition} toPos
     * @param {string} theme
     * @param {number} padding
     * @returns {string}
     */
    _renderEdgeSvg(edge, fromPos, toPos, theme, padding, edgeRoute) {
        const style = this.getEdgeStyle(edge, theme);
        const stroke = style.stroke || "#666666";
        const strokeWidth = style.strokeWidth || 1;

        const labelFontSize = style.fontSize || 10;
        const labelFill = style.textColor || stroke;

        let dasharray = "";
        if (edge.lineStyle === LINE_STYLES.DASHED) {
            dasharray = ` stroke-dasharray="5,5"`;
        } else if (edge.lineStyle === LINE_STYLES.DOTTED) {
            dasharray = ` stroke-dasharray="2,2"`;
        }

        /** @type {string} */
        let markerEnd = "";
        /** @type {string} */
        let markerStart = "";

        if (edge.arrow !== ARROW_TYPES.NONE) {
            const markerType =
                edge.arrow === ARROW_TYPES.OPEN
                    ? "arrowhead-open"
                    : edge.arrow === ARROW_TYPES.CROSS
                    ? "arrowhead-cross"
                    : "arrowhead";
            markerEnd = ` marker-end="url(#${markerType})"`;
            if (edge.bidirectional) {
                const startMarkerType =
                    edge.arrow === ARROW_TYPES.OPEN
                        ? "arrowhead-open-start"
                        : edge.arrow === ARROW_TYPES.CROSS
                        ? "arrowhead-cross-start"
                        : "arrowhead-start";
                markerStart = ` marker-start="url(#${startMarkerType})"`;
            }
        }

        /** @type {string[]} */
        const parts = [];

        if (
            edgeRoute &&
            Array.isArray(edgeRoute.points) &&
            edgeRoute.points.length >= 2
        ) {
            const pathD = this._polylineToPathD(edgeRoute.points, padding);
            parts.push(
                `  <path d="${pathD}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dasharray}${markerStart}${markerEnd}/>`
            );

            if (edge.label) {
                const lp =
                    edgeRoute.labelPoint &&
                    typeof edgeRoute.labelPoint.x === "number" &&
                    typeof edgeRoute.labelPoint.y === "number"
                        ? {
                              x: edgeRoute.labelPoint.x + padding,
                              y: edgeRoute.labelPoint.y + padding
                          }
                        : this._polylineMidpoint(edgeRoute.points, padding);
                const escapedLabel = this._escapeXml(edge.label);
                const labelWidth =
                    estimateTextWidth(edge.label, labelFontSize) + 6;
                parts.push(
                    `  <rect x="${lp.x - labelWidth / 2}" y="${
                        lp.y - labelFontSize
                    }" width="${labelWidth}" height="${
                        labelFontSize + 6
                    }" fill="white" opacity="0.85" rx="2"/>`
                );
                parts.push(
                    `  <text x="${lp.x}" y="${lp.y}" text-anchor="middle" fill="${labelFill}" font-size="${labelFontSize}">${escapedLabel}</text>`
                );
            }

            return parts.join("\n");
        }

        // Fallback: straight/curved connector between nodes
        const fromCenterX = fromPos.x + fromPos.width / 2 + padding;
        const fromCenterY = fromPos.y + fromPos.height / 2 + padding;
        const toCenterX = toPos.x + toPos.width / 2 + padding;
        const toCenterY = toPos.y + toPos.height / 2 + padding;

        const deltaX = toCenterX - fromCenterX;
        const deltaY = toCenterY - fromCenterY;

        /** @type {number} */
        let startX;
        /** @type {number} */
        let startY;
        /** @type {number} */
        let endX;
        /** @type {number} */
        let endY;

        if (Math.abs(deltaX) >= Math.abs(deltaY)) {
            // Horizontal-ish connection
            if (deltaX >= 0) {
                startX = fromPos.x + fromPos.width + padding;
                endX = toPos.x + padding;
            } else {
                startX = fromPos.x + padding;
                endX = toPos.x + toPos.width + padding;
            }
            startY = fromCenterY;
            endY = toCenterY;
        } else {
            // Vertical-ish connection
            if (deltaY >= 0) {
                startY = fromPos.y + fromPos.height + padding;
                endY = toPos.y + padding;
            } else {
                startY = fromPos.y + padding;
                endY = toPos.y + toPos.height + padding;
            }
            startX = fromCenterX;
            endX = toCenterX;
        }

        // Draw path (slight curve for diagonal connections)
        if (Math.abs(startX - endX) > 20 && Math.abs(startY - endY) > 20) {
            const controlX = (startX + endX) / 2;
            const controlY = (startY + endY) / 2;
            const pathD =
                `M${startX},${startY} ` +
                `Q${startX},${controlY} ${controlX},${controlY} ` +
                `T${endX},${endY}`;
            parts.push(
                `  <path d="${pathD}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"${dasharray}${markerStart}${markerEnd}/>`
            );
        } else {
            parts.push(
                `  <line x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}" stroke="${stroke}" stroke-width="${strokeWidth}"${dasharray}${markerStart}${markerEnd}/>`
            );
        }

        // Edge label
        if (edge.label) {
            const labelX = (startX + endX) / 2;
            const labelY = (startY + endY) / 2 - 8;
            const escapedLabel = this._escapeXml(edge.label);

            // Background for readability
            const labelWidth = estimateTextWidth(edge.label, labelFontSize) + 6;
            parts.push(
                `  <rect x="${labelX - labelWidth / 2}" y="${
                    labelY - labelFontSize
                }" width="${labelWidth}" height="${
                    labelFontSize + 6
                }" fill="white" opacity="0.85" rx="2"/>`
            );
            parts.push(
                `  <text x="${labelX}" y="${labelY}" text-anchor="middle" fill="${labelFill}" font-size="${labelFontSize}">${escapedLabel}</text>`
            );
        }

        return parts.join("\n");
    }

    // =========================================================================
    // Other Chart Types (unchanged, but should be updated similarly)
    // =========================================================================

    /**
     * Render sequence diagram
     */
    _renderSequence(document, theme, padding, background) {
        const participants = document.getParticipants();
        const messages = document.getMessages();

        const pWidth = CHART_DEFAULTS.PARTICIPANT_WIDTH;
        const pHeight = CHART_DEFAULTS.PARTICIPANT_HEIGHT;
        const msgSpacing = CHART_DEFAULTS.MESSAGE_SPACING;

        const width = participants.length * (pWidth + 40) + padding * 2;
        const height =
            pHeight + messages.length * msgSpacing + padding * 2 + 50;

        /** @type {string[]} */
        const parts = [];
        parts.push(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
        );

        if (background !== "transparent") {
            parts.push(
                `  <rect width="100%" height="100%" fill="${background}"/>`
            );
        }

        // Render participants
        /** @type {Map<string, number>} */
        const participantX = new Map();
        for (let i = 0, len = participants.length; i < len; i++) {
            const p = participants[i];
            const x = padding + i * (pWidth + 40);
            participantX.set(p.participantId, x + pWidth / 2);

            parts.push(
                `  <rect x="${x}" y="${padding}" width="${pWidth}" height="${pHeight}" fill="#ffffff" stroke="#333333"/>`
            );
            parts.push(
                `  <text x="${x + pWidth / 2}" y="${
                    padding + pHeight / 2
                }" text-anchor="middle" dominant-baseline="middle" font-size="12">${this._escapeXml(
                    p.label
                )}</text>`
            );

            // Lifeline
            parts.push(
                `  <line x1="${x + pWidth / 2}" y1="${padding + pHeight}" x2="${
                    x + pWidth / 2
                }" y2="${
                    height - padding
                }" stroke="#333333" stroke-dasharray="5,5"/>`
            );
        }

        // Defs
        parts.push(`  <defs>`);
        parts.push(
            `    <marker id="seqArrow" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">`
        );
        parts.push(`      <polygon points="0 0, 10 3.5, 0 7" fill="#333333"/>`);
        parts.push(`    </marker>`);
        parts.push(`  </defs>`);

        // Render messages
        for (let i = 0, len = messages.length; i < len; i++) {
            const msg = messages[i];
            const y = padding + pHeight + 30 + i * msgSpacing;
            const fromX = participantX.get(msg.from);
            const toX = participantX.get(msg.to);

            if (fromX !== undefined && toX !== undefined) {
                let dasharray = "";
                if (msg.type === MESSAGE_TYPES.REPLY) {
                    dasharray = ' stroke-dasharray="5,5"';
                }

                parts.push(
                    `  <line x1="${fromX}" y1="${y}" x2="${toX}" y2="${y}" stroke="#333333"${dasharray} marker-end="url(#seqArrow)"/>`
                );

                if (msg.label) {
                    const labelX = (fromX + toX) / 2;
                    parts.push(
                        `  <text x="${labelX}" y="${
                            y - 5
                        }" text-anchor="middle" font-size="11">${this._escapeXml(
                            msg.label
                        )}</text>`
                    );
                }
            }
        }

        parts.push(`</svg>`);
        return parts.join("\n");
    }

    /**
     * Render state diagram
     */
    _renderState(document, theme, padding, background) {
        const states = document.getStates();
        const transitions = document.getTransitions();

        const sWidth = CHART_DEFAULTS.STATE_WIDTH;
        const sHeight = CHART_DEFAULTS.STATE_HEIGHT;
        const spacing = 50;

        const cols = Math.ceil(Math.sqrt(states.length));
        const width = cols * (sWidth + spacing) + padding * 2;
        const height =
            Math.ceil(states.length / cols) * (sHeight + spacing) + padding * 2;

        /** @type {string[]} */
        const parts = [];
        parts.push(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
        );

        if (background !== "transparent") {
            parts.push(
                `  <rect width="100%" height="100%" fill="${background}"/>`
            );
        }

        // Defs
        parts.push(`  <defs>`);
        parts.push(
            `    <marker id="stateArrow" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">`
        );
        parts.push(`      <polygon points="0 0, 10 3.5, 0 7" fill="#333333"/>`);
        parts.push(`    </marker>`);
        parts.push(`  </defs>`);

        /** @type {Map<string, {x: number, y: number}>} */
        const statePos = new Map();

        // Render states
        for (let i = 0, len = states.length; i < len; i++) {
            const state = states[i];
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = padding + col * (sWidth + spacing);
            const y = padding + row * (sHeight + spacing);

            statePos.set(state.stateId, { x, y });

            if (state.isInitial) {
                // Initial state marker
                parts.push(
                    `  <circle cx="${x - 20}" cy="${
                        y + sHeight / 2
                    }" r="8" fill="#333333"/>`
                );
                parts.push(
                    `  <line x1="${x - 12}" y1="${
                        y + sHeight / 2
                    }" x2="${x}" y2="${
                        y + sHeight / 2
                    }" stroke="#333333" marker-end="url(#stateArrow)"/>`
                );
            }

            if (state.isFinal) {
                // Final state (double circle)
                parts.push(
                    `  <rect x="${x}" y="${y}" width="${sWidth}" height="${sHeight}" rx="${
                        sHeight / 2
                    }" fill="#ffffff" stroke="#333333" stroke-width="2"/>`
                );
                parts.push(
                    `  <rect x="${x + 4}" y="${y + 4}" width="${
                        sWidth - 8
                    }" height="${sHeight - 8}" rx="${
                        (sHeight - 8) / 2
                    }" fill="#ffffff" stroke="#333333"/>`
                );
            } else {
                parts.push(
                    `  <rect x="${x}" y="${y}" width="${sWidth}" height="${sHeight}" rx="${
                        sHeight / 2
                    }" fill="#ffffff" stroke="#333333"/>`
                );
            }

            parts.push(
                `  <text x="${x + sWidth / 2}" y="${
                    y + sHeight / 2
                }" text-anchor="middle" dominant-baseline="middle" font-size="12">${this._escapeXml(
                    state.label
                )}</text>`
            );
        }

        // Render transitions
        for (let i = 0, len = transitions.length; i < len; i++) {
            const trans = transitions[i];
            const from = statePos.get(trans.from);
            const to = statePos.get(trans.to);

            if (from && to) {
                let label = trans.label || trans.trigger || "";
                if (trans.guard) {
                    label += ` [${trans.guard}]`;
                }
                if (trans.action) {
                    label += ` / ${trans.action}`;
                }

                parts.push(
                    `  <line x1="${from.x + sWidth}" y1="${
                        from.y + sHeight / 2
                    }" x2="${to.x}" y2="${
                        to.y + sHeight / 2
                    }" stroke="#333333" marker-end="url(#stateArrow)"/>`
                );
                if (label) {
                    parts.push(
                        `  <text x="${(from.x + to.x + sWidth) / 2}" y="${
                            (from.y + to.y) / 2 + sHeight / 2 - 5
                        }" text-anchor="middle" font-size="10">${this._escapeXml(
                            label
                        )}</text>`
                    );
                }
            }
        }

        parts.push(`</svg>`);
        return parts.join("\n");
    }

    /**
     * Render entity diagram
     */
    _renderEntity(document, theme, padding, background) {
        const entities = document.getEntities();
        const relationships = document.getRelationships();

        const entityWidth = CHART_DEFAULTS.ENTITY_WIDTH;
        const rowHeight = CHART_DEFAULTS.ENTITY_ROW_HEIGHT;
        const entitySpacing = 60;

        const columnCount = Math.max(1, Math.ceil(Math.sqrt(entities.length)));
        const maxAttributeCount = Math.max(
            ...entities.map((entity) => entity.getAttributes().length),
            3
        );
        const defaultEntityHeight = rowHeight * (maxAttributeCount + 1);

        const canvasWidth =
            columnCount * (entityWidth + entitySpacing) + padding * 2;
        const canvasHeight =
            Math.ceil(entities.length / columnCount) *
                (defaultEntityHeight + entitySpacing) +
            padding * 2;

        /** @type {string[]} */
        const parts = [];
        parts.push(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}">`
        );

        if (background !== "transparent") {
            parts.push(
                `  <rect width="100%" height="100%" fill="${background}"/>`
            );
        }

        /** @type {Map<string, {x: number, y: number, width: number, height: number}>} */
        const entityPositions = new Map();

        /** @type {string[]} */
        const entitySvgParts = [];

        // Layout + draw entities (collect SVG so we can draw relationships underneath)
        for (let index = 0, length = entities.length; index < length; index++) {
            const entity = entities[index];
            const colIndex = index % columnCount;
            const rowIndex = Math.floor(index / columnCount);

            const entityX = padding + colIndex * (entityWidth + entitySpacing);
            const entityY =
                padding + rowIndex * (defaultEntityHeight + entitySpacing);

            const attributes = entity.getAttributes();
            const entityHeight = rowHeight * (attributes.length + 1);

            entityPositions.set(entity.entityId, {
                x: entityX,
                y: entityY,
                width: entityWidth,
                height: entityHeight
            });

            // Entity box
            entitySvgParts.push(
                `  <rect x="${entityX}" y="${entityY}" width="${entityWidth}" height="${entityHeight}" fill="#ffffff" stroke="#333333"/>`
            );

            // Header
            entitySvgParts.push(
                `  <rect x="${entityX}" y="${entityY}" width="${entityWidth}" height="${rowHeight}" fill="#e0e0e0" stroke="#333333"/>`
            );
            entitySvgParts.push(
                `  <text x="${entityX + entityWidth / 2}" y="${
                    entityY + rowHeight / 2
                }" text-anchor="middle" dominant-baseline="middle" font-weight="bold" font-size="12">${this._escapeXml(
                    entity.label
                )}</text>`
            );

            // Attributes
            for (
                let attributeIndex = 0, attributeLength = attributes.length;
                attributeIndex < attributeLength;
                attributeIndex++
            ) {
                const attribute = attributes[attributeIndex];
                const attributeY = entityY + rowHeight * (attributeIndex + 1);

                let prefix = "";
                if (attribute.keyType === "primary") {
                    prefix = "PK ";
                } else if (attribute.keyType === "foreign") {
                    prefix = "FK ";
                }

                entitySvgParts.push(
                    `  <text x="${entityX + 5}" y="${
                        attributeY + rowHeight / 2
                    }" dominant-baseline="middle" font-size="11">${prefix}${this._escapeXml(
                        attribute.name
                    )}${
                        attribute.dataType ? `: ${attribute.dataType}` : ""
                    }</text>`
                );
            }
        }

        // Relationships (draw first so entities sit on top)
        /** @type {string[]} */
        const relationshipSvgParts = [];

        /**
         * @param {unknown} value
         * @returns {string | null}
         */
        const toStringOrNull = (value) => {
            return typeof value === "string" && value.length > 0 ? value : null;
        };

        /**
         * @param {ChartRelationshipNode} relationship
         * @returns {{ from: string | null, to: string | null }}
         */
        const resolveRelationshipEndpoints = (relationship) => {
            const relAny = /** @type {any} */ (relationship);

            const from =
                toStringOrNull(relAny.fromEntityId) ??
                toStringOrNull(relAny.from) ??
                toStringOrNull(relAny.source) ??
                toStringOrNull(relAny.left) ??
                toStringOrNull(relAny.attrs?.fromEntityId) ??
                toStringOrNull(relAny.attrs?.from) ??
                toStringOrNull(relAny.attrs?.source) ??
                null;

            const to =
                toStringOrNull(relAny.toEntityId) ??
                toStringOrNull(relAny.to) ??
                toStringOrNull(relAny.target) ??
                toStringOrNull(relAny.right) ??
                toStringOrNull(relAny.attrs?.toEntityId) ??
                toStringOrNull(relAny.attrs?.to) ??
                toStringOrNull(relAny.attrs?.target) ??
                null;

            return { from, to };
        };

        /**
         * @param {ChartRelationshipNode} relationship
         * @returns {{ fromCardinality: string | null, toCardinality: string | null }}
         */
        const resolveCardinality = (relationship) => {
            const relAny = /** @type {any} */ (relationship);

            const explicitFrom =
                toStringOrNull(relAny.fromCardinality) ??
                toStringOrNull(relAny.leftCardinality) ??
                toStringOrNull(relAny.attrs?.fromCardinality) ??
                toStringOrNull(relAny.attrs?.leftCardinality) ??
                null;

            const explicitTo =
                toStringOrNull(relAny.toCardinality) ??
                toStringOrNull(relAny.rightCardinality) ??
                toStringOrNull(relAny.attrs?.toCardinality) ??
                toStringOrNull(relAny.attrs?.rightCardinality) ??
                null;

            if (explicitFrom || explicitTo) {
                return {
                    fromCardinality: explicitFrom,
                    toCardinality: explicitTo
                };
            }

            const pair =
                toStringOrNull(relAny.cardinality) ??
                toStringOrNull(relAny.attrs?.cardinality) ??
                null;

            if (!pair) {
                return { fromCardinality: null, toCardinality: null };
            }

            const colonIndex = pair.indexOf(":");
            if (colonIndex < 0) {
                return { fromCardinality: pair, toCardinality: pair };
            }

            const left = pair.slice(0, colonIndex).trim();
            const right = pair.slice(colonIndex + 1).trim();
            return {
                fromCardinality: left.length ? left : null,
                toCardinality: right.length ? right : null
            };
        };

        for (
            let relationshipIndex = 0,
                relationshipLength = relationships.length;
            relationshipIndex < relationshipLength;
            relationshipIndex++
        ) {
            const relationship = relationships[relationshipIndex];
            const endpoints = resolveRelationshipEndpoints(relationship);

            if (!endpoints.from || !endpoints.to) {
                continue;
            }

            const fromPos = entityPositions.get(endpoints.from);
            const toPos = entityPositions.get(endpoints.to);
            if (!fromPos || !toPos) {
                continue;
            }

            const fromCenterX = fromPos.x + fromPos.width / 2;
            const fromCenterY = fromPos.y + fromPos.height / 2;
            const toCenterX = toPos.x + toPos.width / 2;
            const toCenterY = toPos.y + toPos.height / 2;

            const deltaX = toCenterX - fromCenterX;
            const deltaY = toCenterY - fromCenterY;

            /** @type {number} */
            let startX;
            /** @type {number} */
            let startY;
            /** @type {number} */
            let endX;
            /** @type {number} */
            let endY;

            if (Math.abs(deltaX) >= Math.abs(deltaY)) {
                // Horizontal-ish
                if (deltaX >= 0) {
                    startX = fromPos.x + fromPos.width;
                    endX = toPos.x;
                } else {
                    startX = fromPos.x;
                    endX = toPos.x + toPos.width;
                }
                startY = fromCenterY;
                endY = toCenterY;
            } else {
                // Vertical-ish
                if (deltaY >= 0) {
                    startY = fromPos.y + fromPos.height;
                    endY = toPos.y;
                } else {
                    startY = fromPos.y;
                    endY = toPos.y + toPos.height;
                }
                startX = fromCenterX;
                endX = toCenterX;
            }

            const relAny = /** @type {any} */ (relationship);
            const isIdentifying =
                relAny.identifying === true ||
                relAny.isIdentifying === true ||
                relAny.attrs?.identifying === true ||
                relAny.attrs?.isIdentifying === true;

            const dasharray = isIdentifying ? "" : ` stroke-dasharray="5,5"`;
            relationshipSvgParts.push(
                `  <line x1="${startX}" y1="${startY}" x2="${endX}" y2="${endY}" stroke="#333333" stroke-width="1"${dasharray}/>`
            );

            // Relationship label
            const relationshipLabel =
                toStringOrNull(relAny.label) ??
                toStringOrNull(relAny.name) ??
                toStringOrNull(relAny.attrs?.label) ??
                toStringOrNull(relAny.attrs?.name) ??
                null;

            if (relationshipLabel) {
                const labelX = (startX + endX) / 2;
                const labelY = (startY + endY) / 2 - 6;
                const labelFontSize = 11;
                const escapedLabel = this._escapeXml(relationshipLabel);
                const labelWidth =
                    estimateTextWidth(relationshipLabel, labelFontSize) + 6;

                relationshipSvgParts.push(
                    `  <rect x="${labelX - labelWidth / 2}" y="${
                        labelY - labelFontSize
                    }" width="${labelWidth}" height="${
                        labelFontSize + 6
                    }" fill="white" opacity="0.9" rx="2"/>`
                );
                relationshipSvgParts.push(
                    `  <text x="${labelX}" y="${labelY}" text-anchor="middle" fill="#333333" font-size="${labelFontSize}">${escapedLabel}</text>`
                );
            }

            // Cardinalities
            const { fromCardinality, toCardinality } =
                resolveCardinality(relationship);

            if (fromCardinality) {
                const fromOffsetX =
                    startX === fromPos.x
                        ? startX - 10
                        : startX === fromPos.x + fromPos.width
                        ? startX + 10
                        : startX;
                const fromOffsetY =
                    startY === fromPos.y
                        ? startY - 10
                        : startY === fromPos.y + fromPos.height
                        ? startY + 14
                        : startY - 6;

                relationshipSvgParts.push(
                    `  <text x="${fromOffsetX}" y="${fromOffsetY}" text-anchor="middle" font-size="10" fill="#333333">${this._escapeXml(
                        fromCardinality
                    )}</text>`
                );
            }

            if (toCardinality) {
                const toOffsetX =
                    endX === toPos.x
                        ? endX - 10
                        : endX === toPos.x + toPos.width
                        ? endX + 10
                        : endX;
                const toOffsetY =
                    endY === toPos.y
                        ? endY - 10
                        : endY === toPos.y + toPos.height
                        ? endY + 14
                        : endY - 6;

                relationshipSvgParts.push(
                    `  <text x="${toOffsetX}" y="${toOffsetY}" text-anchor="middle" font-size="10" fill="#333333">${this._escapeXml(
                        toCardinality
                    )}</text>`
                );
            }
        }

        for (let i = 0, len = relationshipSvgParts.length; i < len; i++) {
            parts.push(relationshipSvgParts[i]);
        }
        for (let i = 0, len = entitySvgParts.length; i < len; i++) {
            parts.push(entitySvgParts[i]);
        }

        parts.push(`</svg>`);
        return parts.join("\n");
    }

    /**
     * Render tree diagram
     */
    _renderTree(document, theme, padding, background) {
        const treeRoot = document.getTreeRoot();
        if (!treeRoot) {
            return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><text x="50" y="25" text-anchor="middle">Empty tree</text></svg>`;
        }

        // Simple tree layout
        const nodeWidth = 100;
        const nodeHeight = 30;
        const levelSpacing = CHART_DEFAULTS.TREE_LEVEL_SPACING;
        const siblingSpacing = CHART_DEFAULTS.TREE_SIBLING_SPACING;

        // Count nodes per level
        /** @type {Map<number, number>} */
        const levelCounts = new Map();
        /** @type {Map<string, {x: number, y: number}>} */
        const positions = new Map();

        /** @type {Map<number, number>} */
        const levelCurrentX = new Map();

        /**
         * @param {ChartTreeNode} node
         * @param {number} depth
         */
        const countNodes = (node, depth) => {
            levelCounts.set(depth, (levelCounts.get(depth) || 0) + 1);
            for (const child of node.getChildren()) {
                countNodes(child, depth + 1);
            }
        };
        countNodes(treeRoot, 0);

        const maxDepth = Math.max(...levelCounts.keys());
        const maxWidth = Math.max(...levelCounts.values());

        const width = maxWidth * (nodeWidth + siblingSpacing) + padding * 2;
        const height =
            (maxDepth + 1) * (nodeHeight + levelSpacing) + padding * 2;

        /**
         * @param {ChartTreeNode} node
         * @param {number} depth
         */
        const layoutNode = (node, depth) => {
            const currentX = levelCurrentX.get(depth) || 0;
            const x = padding + currentX * (nodeWidth + siblingSpacing);
            const y = padding + depth * (nodeHeight + levelSpacing);
            positions.set(node.treeNodeId, { x, y });
            levelCurrentX.set(depth, currentX + 1);

            for (const child of node.getChildren()) {
                layoutNode(child, depth + 1);
            }
        };
        layoutNode(treeRoot, 0);

        /** @type {string[]} */
        const parts = [];
        parts.push(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
        );

        if (background !== "transparent") {
            parts.push(
                `  <rect width="100%" height="100%" fill="${background}"/>`
            );
        }

        // Render edges
        /**
         * @param {ChartTreeNode} node
         */
        const renderEdges = (node) => {
            const pos = positions.get(node.treeNodeId);
            if (!pos) {
                return;
            }
            for (const child of node.getChildren()) {
                const childPos = positions.get(child.treeNodeId);
                if (childPos) {
                    parts.push(
                        `  <line x1="${pos.x + nodeWidth / 2}" y1="${
                            pos.y + nodeHeight
                        }" x2="${childPos.x + nodeWidth / 2}" y2="${
                            childPos.y
                        }" stroke="#333333"/>`
                    );
                }
                renderEdges(child);
            }
        };
        renderEdges(treeRoot);

        // Render nodes
        /**
         * @param {ChartTreeNode} node
         */
        const renderNodes = (node) => {
            const pos = positions.get(node.treeNodeId);
            if (!pos) {
                return;
            }
            parts.push(
                `  <rect x="${pos.x}" y="${pos.y}" width="${nodeWidth}" height="${nodeHeight}" fill="#ffffff" stroke="#333333" rx="3"/>`
            );
            parts.push(
                `  <text x="${pos.x + nodeWidth / 2}" y="${
                    pos.y + nodeHeight / 2
                }" text-anchor="middle" dominant-baseline="middle" font-size="11">${this._escapeXml(
                    node.label
                )}</text>`
            );

            for (const child of node.getChildren()) {
                renderNodes(child);
            }
        };
        renderNodes(treeRoot);

        parts.push(`</svg>`);
        return parts.join("\n");
    }

    /**
     * Resolve layout config from render config + theme.
     * Accepts either camelCase or snake_case for convenience.
     * @param {any} themeConfig
     * @param {any} layoutOptions
     */
    _resolveFlowchartLayoutConfig(themeConfig, layoutOptions) {
        const themeDefaults =
            themeConfig &&
            themeConfig.node_defaults &&
            typeof themeConfig.node_defaults === "object"
                ? themeConfig.node_defaults
                : null;

        const readNum = (obj, ...keys) => {
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                if (!obj) {
                    continue;
                }
                const v = obj[k];
                if (typeof v === "number" && Number.isFinite(v)) {
                    return v;
                }
            }
            return undefined;
        };

        const fromOptions =
            layoutOptions && typeof layoutOptions === "object"
                ? layoutOptions
                : null;

        return {
            nodeGapX:
                readNum(fromOptions, "nodeGapX", "node_gap_x") ??
                readNum(themeDefaults, "nodeGapX", "node_gap_x") ??
                60,
            nodeGapY:
                readNum(fromOptions, "nodeGapY", "node_gap_y") ??
                readNum(themeDefaults, "nodeGapY", "node_gap_y") ??
                40,
            layerGap:
                readNum(fromOptions, "layerGap", "layer_gap") ??
                readNum(themeDefaults, "layerGap", "layer_gap") ??
                80,
            clusterGap:
                readNum(fromOptions, "clusterGap", "cluster_gap") ??
                readNum(themeDefaults, "clusterGap", "cluster_gap") ??
                40,
            edgeChannelGap:
                readNum(fromOptions, "edgeChannelGap", "edge_channel_gap") ??
                readNum(themeDefaults, "edgeChannelGap", "edge_channel_gap") ??
                16,
            edgeMargin:
                readNum(fromOptions, "edgeMargin", "edge_margin") ??
                readNum(themeDefaults, "edgeMargin", "edge_margin") ??
                10,
            crossingSweeps:
                readNum(fromOptions, "crossingSweeps", "crossing_sweeps") ??
                readNum(themeDefaults, "crossingSweeps", "crossing_sweeps") ??
                6,
            relaxIterations:
                readNum(fromOptions, "relaxIterations", "relax_iterations") ??
                readNum(themeDefaults, "relaxIterations", "relax_iterations") ??
                10
        };
    }

    /**
     * @param {{x:number,y:number}[]} points
     * @param {number} padding
     */
    _polylineToPathD(points, padding) {
        let d = "";
        for (let i = 0, len = points.length; i < len; i++) {
            const p = points[i];
            const x = p.x + padding;
            const y = p.y + padding;
            if (i === 0) {
                d = `M${x},${y}`;
            } else {
                d += ` L${x},${y}`;
            }
        }
        return d;
    }

    /**
     * @param {{x:number,y:number}[]} points
     * @param {number} padding
     */
    _polylineMidpoint(points, padding) {
        if (points.length === 0) {
            return { x: padding, y: padding };
        }
        if (points.length === 1) {
            return { x: points[0].x + padding, y: points[0].y + padding };
        }
        let total = 0;
        for (let i = 0; i < points.length - 1; i++) {
            const a = points[i];
            const b = points[i + 1];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            total += Math.sqrt(dx * dx + dy * dy);
        }
        const half = total / 2;
        let acc = 0;
        for (let i = 0; i < points.length - 1; i++) {
            const a = points[i];
            const b = points[i + 1];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const seg = Math.sqrt(dx * dx + dy * dy);
            if (acc + seg >= half) {
                const t = seg === 0 ? 0 : (half - acc) / seg;
                return {
                    x: a.x + dx * t + padding,
                    y: a.y + dy * t + padding
                };
            }
            acc += seg;
        }
        const last = points[points.length - 1];
        return { x: last.x + padding, y: last.y + padding };
    }

    /**
     * Escape XML special characters
     * @param {string} text
     * @returns {string}
     */
    _escapeXml(text) {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
    }
}
