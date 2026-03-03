/**
 * ChartLayoutEngine - Strict Swimlane Layout
 *
 * FIXES:
 * - "Overlapping Boxes": Enforces strict, non-overlapping vertical swimlanes for top-level subgraphs.
 * - "Stacked Nodes": Fixes the layer sorting bug that caused zero-coordinates.
 * - "Arrow Stems": Calculates specific port offsets for every edge to prevent merging.
 *
 * @module format-ast/chart/layout/ChartLayoutEngine
 */

// =============================================================================
// Defaults
// =============================================================================

const DEFAULTS = {
    nodeGapX: 50,
    nodeGapY: 60,
    layerGap: 80,
    swimlaneGap: 100, // Explicit gap between major clusters
    edgeChannelGap: 20,
    crossingSweeps: 4,
    debug: false
};

// =============================================================================
// Utilities
// =============================================================================

function directionInfo(direction) {
    if (direction === "LR") return { isVertical: false, forwardSign: 1 };
    if (direction === "RL") return { isVertical: false, forwardSign: -1 };
    if (direction === "BT") return { isVertical: true, forwardSign: -1 };
    return { isVertical: true, forwardSign: 1 };
}

function cmpId(a, b) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

function dedupeCollinear(points) {
    if (points.length <= 2) return points;
    const out = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
        const a = out[out.length - 1];
        const b = points[i];
        const c = points[i + 1];
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const bcx = c.x - b.x;
        const bcy = c.y - b.y;

        const sameDirX =
            aby === 0 && bcy === 0 && (abx === 0 || abx > 0 === bcx > 0);
        const sameDirY =
            abx === 0 && bcx === 0 && (aby === 0 || aby > 0 === bcy > 0);

        if (sameDirX || sameDirY) continue;
        out.push(b);
    }
    out.push(points[points.length - 1]);
    return out;
}

// =============================================================================
// ChartLayoutEngine
// =============================================================================

export class ChartLayoutEngine {
    constructor(defaults = {}) {
        this.defaults = { ...DEFAULTS, ...defaults };
    }

    /**
     * Strict Swimlane Flowchart Layout
     */
    layoutFlowchart(input) {
        const cfg = { ...this.defaults, ...(input.layoutConfig || {}) };
        const { isVertical, forwardSign } = directionInfo(
            input.direction || "TD"
        );

        const nodeIds = input.nodes.map((n) => n.nodeId).sort(cmpId);
        const sizes = input.nodeSizes;

        // ---------------------------------------------------------------------
        // 1. Assign Layers (Global Ranking)
        // ---------------------------------------------------------------------
        const { rank, maxRank } = this._assignGlobalRanks(nodeIds, input.edges);

        // ---------------------------------------------------------------------
        // 2. Build Swimlanes (Top-Level Clusters)
        // ---------------------------------------------------------------------
        const { swimlanes, nodeToLane } = this._buildSwimlanes(
            nodeIds,
            input.subgraphs,
            input.edges
        );

        // ---------------------------------------------------------------------
        // 3. Layout Each Swimlane Independently
        // ---------------------------------------------------------------------
        // We calculate local X/Y coordinates for each swimlane as if it were its own chart.
        // They share the 'rank' (Y) to keep global alignment, but have independent X.

        const laneLayouts = new Map(); // laneId -> { width, nodePositions: Map<id, {x, width...}> }

        swimlanes.forEach((lane) => {
            laneLayouts.set(
                lane.id,
                this._layoutSingleSwimlane(
                    lane,
                    rank,
                    maxRank,
                    sizes,
                    input.edges,
                    nodeToLane,
                    isVertical,
                    cfg
                )
            );
        });

        // ---------------------------------------------------------------------
        // 4. Stitch Swimlanes Together (Global Coordinate Assignment)
        // ---------------------------------------------------------------------
        const positions = new Map();
        let currentCross = 0;

        // Place swimlanes side-by-side
        swimlanes.forEach((lane) => {
            const layout = laneLayouts.get(lane.id);
            if (!layout) return;

            const laneOffset = currentCross;

            layout.nodePositions.forEach((pos, nodeId) => {
                // Apply global offset
                if (isVertical) {
                    pos.x += laneOffset;
                } else {
                    pos.y += laneOffset;
                }
                positions.set(nodeId, pos);
            });

            currentCross += layout.width + cfg.swimlaneGap;
        });

        // ---------------------------------------------------------------------
        // 5. Invert for reverse directions
        // ---------------------------------------------------------------------
        if (forwardSign < 0) {
            this._invertLayout(positions, isVertical);
        }

        // ---------------------------------------------------------------------
        // 6. Edge Routing with Port Management
        // ---------------------------------------------------------------------
        const edgeRoutes = this._routeEdges(
            input.edges,
            positions,
            isVertical,
            cfg
        );

        // ---------------------------------------------------------------------
        // 7. Calculate Bounds
        // ---------------------------------------------------------------------
        const bounds = this._calcBounds(positions, edgeRoutes);

        return {
            positions,
            edgeRoutes,
            bounds,
            layers: [], // Not strictly needed by renderer, can be empty
            debug: cfg.debug ? { messages: [], overlaps: [] } : undefined
        };
    }

    // =========================================================================
    // Phase 1: Global Ranking (Kahn's Algorithm)
    // =========================================================================

    _assignGlobalRanks(nodeIds, edges) {
        const adj = new Map();
        nodeIds.forEach((id) => adj.set(id, []));
        const inDegree = new Map();
        nodeIds.forEach((id) => inDegree.set(id, 0));

        edges.forEach((e) => {
            if (adj.has(e.from) && adj.has(e.to)) {
                adj.get(e.from).push(e.to);
                inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
            }
        });

        const queue = nodeIds
            .filter((id) => inDegree.get(id) === 0)
            .sort(cmpId);
        const rank = new Map();
        nodeIds.forEach((id) => rank.set(id, 0));

        let processed = 0;
        const sorted = [];

        while (queue.length > 0) {
            const u = queue.shift();
            sorted.push(u);
            processed++;

            const rU = rank.get(u);
            const neighbors = adj.get(u) || [];

            neighbors.forEach((v) => {
                // Longest path layering
                if (rank.get(v) < rU + 1) rank.set(v, rU + 1);

                inDegree.set(v, inDegree.get(v) - 1);
                if (inDegree.get(v) === 0) queue.push(v);
            });
            // Re-sort queue to maintain deterministic order
            queue.sort(cmpId);
        }

        // Handle cycles (if processed < nodeIds.length) - fallback to 0 or simple increments
        if (processed < nodeIds.length) {
            nodeIds.forEach((id) => {
                if (!rank.has(id)) rank.set(id, 0);
            });
        }

        let maxRank = 0;
        rank.forEach((r) => (maxRank = Math.max(maxRank, r)));

        return { rank, maxRank };
    }

    // =========================================================================
    // Phase 2: Build Swimlanes
    // =========================================================================

    _buildSwimlanes(nodeIds, subgraphs, edges) {
        // 1. Map node -> Top Level Cluster ID
        const nodeToLane = new Map();
        const laneIds = new Set();
        const DEFAULT_LANE = "__default__";

        // Helper to find top-most parent
        const findTopParent = (nodeId, sgs) => {
            if (!sgs) return null;
            for (const sg of sgs) {
                // Check recursive first? No, we want TOP level.
                // Does this subgraph contain the node?
                // We need to flatten the lookup.
            }
            // Simpler: Map all nodes to their *immediate* parent, then walk up.
            return null;
        };

        // Flatten subgraph hierarchy
        // We only care about the roots of the forest.
        // A root is a subgraph with no parent.
        // Nodes inside that tree belong to that root.

        const parentMap = new Map(); // childId (node or sg) -> parentSgId

        const traverse = (sgs, parentId) => {
            if (!sgs) return;
            sgs.forEach((sg) => {
                if (parentId) parentMap.set(sg.subgraphId, parentId);
                (sg.nodeIds || []).forEach((nid) => {
                    parentMap.set(nid, sg.subgraphId);
                });
                if (sg.children) traverse(sg.children, sg.subgraphId);
            });
        };

        if (subgraphs) traverse(subgraphs, null);

        // Resolve every node to its root
        nodeIds.forEach((nid) => {
            let curr = nid;
            let root = DEFAULT_LANE;

            // Walk up until we find a subgraph with no parent (or we hit null)
            // But we start at the node's immediate parent
            let p = parentMap.get(curr);
            while (p) {
                root = p;
                p = parentMap.get(p);
            }

            nodeToLane.set(nid, root);
            laneIds.add(root);
        });

        // 2. Create Swimlane Objects
        let lanes = Array.from(laneIds).map((id) => ({
            id,
            nodes: nodeIds.filter((n) => nodeToLane.get(n) === id)
        }));

        // 3. Sort Swimlanes (to minimize crossing between them)
        // Heuristic: Sort by average rank of nodes? Or by connectivity?
        // Simple connectivity sort:
        // Calculate interaction matrix
        const score = new Map();
        lanes.forEach((l) => score.set(l.id, 0));

        // If edges go A->B, A should likely be left of B (or just ordered)
        // In TD layout, X-order is arbitrary, but we want to minimize long diagonal edges.
        // Let's just sort alphabetically or by input order to be stable,
        // OR try to put 'Start' type nodes on left.
        // For now: Sort by ID for stability, then maybe by connectivity.

        lanes.sort((a, b) => {
            if (a.id === DEFAULT_LANE) return -1; // Default/Root left
            if (b.id === DEFAULT_LANE) return 1;
            return cmpId(a.id, b.id);
        });

        return { swimlanes: lanes, nodeToLane };
    }

    // =========================================================================
    // Phase 3: Layout Single Swimlane
    // =========================================================================

    _layoutSingleSwimlane(
        lane,
        rank,
        maxRank,
        sizes,
        edges,
        nodeToLane,
        isVertical,
        cfg
    ) {
        // Filter nodes/edges for this lane
        const laneNodes = lane.nodes;
        const laneNodeSet = new Set(laneNodes);

        // Build local layers
        const layers = Array(maxRank + 1)
            .fill(null)
            .map(() => []);
        laneNodes.forEach((id) => {
            layers[rank.get(id)].push(id);
        });

        // Sort Layers (Barycenter) - only considering in-lane neighbors for now
        // This keeps the lane self-contained and tidy.
        const orderLayers = () => {
            const pos = new Map();
            for (let i = 0; i < layers.length; i++) {
                layers[i].sort(cmpId);
            }

            for (let sweep = 0; sweep < 4; sweep++) {
                // Down
                for (let i = 1; i < layers.length; i++) {
                    const layer = layers[i];
                    const prev = layers[i - 1];
                    prev.forEach((id, idx) => pos.set(id, idx));

                    const weights = layer.map((id) => {
                        let sum = 0,
                            count = 0;
                        edges.forEach((e) => {
                            if (e.to === id && laneNodeSet.has(e.from)) {
                                if (pos.has(e.from)) {
                                    sum += pos.get(e.from);
                                    count++;
                                }
                            }
                        });
                        return { id, w: count === 0 ? -1 : sum / count };
                    });

                    weights.sort((a, b) =>
                        a.w === -1 || b.w === -1 ? cmpId(a.id, b.id) : a.w - b.w
                    );
                    layers[i] = weights.map((x) => x.id);
                }
                // Up
                for (let i = layers.length - 2; i >= 0; i--) {
                    const layer = layers[i];
                    const next = layers[i + 1];
                    next.forEach((id, idx) => pos.set(id, idx));

                    const weights = layer.map((id) => {
                        let sum = 0,
                            count = 0;
                        edges.forEach((e) => {
                            if (e.from === id && laneNodeSet.has(e.to)) {
                                if (pos.has(e.to)) {
                                    sum += pos.get(e.to);
                                    count++;
                                }
                            }
                        });
                        return { id, w: count === 0 ? -1 : sum / count };
                    });

                    weights.sort((a, b) =>
                        a.w === -1 || b.w === -1 ? cmpId(a.id, b.id) : a.w - b.w
                    );
                    layers[i] = weights.map((x) => x.id);
                }
            }
        };
        orderLayers();

        // Assign Coordinates (Local X, Global Y-based main axis)
        const nodePositions = new Map();
        let maxLaneWidth = 0;

        const mainGap = cfg.layerGap;
        const crossGap = isVertical ? cfg.nodeGapX : cfg.nodeGapY;

        let currentMain = 0; // Y coordinate (if vertical)

        // Determine max main size per layer to align rows
        const layerMainSizes = layers.map((layer) => {
            let max = 0;
            layer.forEach((id) => {
                const s = sizes.get(id) || { width: 100, height: 50 };
                const sz = isVertical ? s.height : s.width;
                max = Math.max(max, sz);
            });
            return max;
        });

        // Place nodes
        for (let i = 0; i < layers.length; i++) {
            const layer = layers[i];
            const mainSize = layerMainSizes[i];

            // Calculate width of this row
            let rowWidth = 0;
            layer.forEach((id, idx) => {
                const s = sizes.get(id) || { width: 100, height: 50 };
                const sz = isVertical ? s.width : s.height;
                if (idx > 0) rowWidth += crossGap;
                rowWidth += sz;
            });

            if (rowWidth > maxLaneWidth) maxLaneWidth = rowWidth;

            // Center row in lane? Or Left align? Center is usually better.
            let currentCross = (maxLaneWidth - rowWidth) / 2; // Start centered relative to max width?
            // Actually, best to just start at 0 and center the whole lane later if needed.
            // Let's simple pack left (0) for now, then we can center-align rows.
            currentCross = 0;

            layer.forEach((id) => {
                const s = sizes.get(id) || { width: 100, height: 50 };
                const prim = isVertical ? s.width : s.height;
                const sec = isVertical ? s.height : s.width;

                const mainPos = currentMain + (mainSize - sec) / 2;

                nodePositions.set(id, {
                    x: isVertical ? currentCross : mainPos,
                    y: isVertical ? mainPos : currentCross,
                    width: s.width,
                    height: s.height,
                    layer: i
                });

                currentCross += prim + crossGap;
            });

            currentMain += mainSize + mainGap;
        }

        // Center align rows
        // Find actual max width used
        let realMaxWidth = 0;
        layers.forEach((layer) => {
            if (layer.length === 0) return;
            const first = nodePositions.get(layer[0]);
            const last = nodePositions.get(layer[layer.length - 1]);
            const start = isVertical ? first.x : first.y;
            const end =
                (isVertical ? last.x : last.y) +
                (isVertical ? last.width : last.height);
            realMaxWidth = Math.max(realMaxWidth, end - start);
        });

        layers.forEach((layer) => {
            if (layer.length === 0) return;
            const first = nodePositions.get(layer[0]);
            const last = nodePositions.get(layer[layer.length - 1]);
            const start = isVertical ? first.x : first.y;
            const end =
                (isVertical ? last.x : last.y) +
                (isVertical ? last.width : last.height);
            const w = end - start;

            const offset = (realMaxWidth - w) / 2;
            if (offset > 0) {
                layer.forEach((id) => {
                    const p = nodePositions.get(id);
                    if (isVertical) p.x += offset;
                    else p.y += offset;
                });
            }
        });

        return { width: realMaxWidth, nodePositions };
    }

    _invertLayout(positions, isVertical) {
        let maxMain = 0;
        for (const p of positions.values()) {
            const end = isVertical ? p.y + p.height : p.x + p.width;
            maxMain = Math.max(maxMain, end);
        }
        for (const p of positions.values()) {
            if (isVertical) p.y = maxMain - (p.y + p.height);
            else p.x = maxMain - (p.x + p.width);
        }
    }

    // =========================================================================
    // Phase 6: Routing with Port Management
    // =========================================================================

    _routeEdges(edges, positions, isVertical, cfg) {
        const routes = new Map();

        // Group edges by node to fan them out
        const nodePorts = new Map(); // nodeId -> { incoming: Edge[], outgoing: Edge[] }

        edges.forEach((e) => {
            if (!nodePorts.has(e.from))
                nodePorts.set(e.from, { in: [], out: [] });
            if (!nodePorts.has(e.to)) nodePorts.set(e.to, { in: [], out: [] });

            nodePorts.get(e.from).out.push(e);
            nodePorts.get(e.to).in.push(e);
        });

        const edgePortOffsets = new Map();

        nodePorts.forEach((ports, nodeId) => {
            const p = positions.get(nodeId);
            if (!p) return;

            // Sort edges by destination coordinate (minimizes crossing at the node face)
            const getCoord = (id) => {
                const pos = positions.get(id);
                if (!pos) return 0;
                return isVertical ? pos.x : pos.y;
            };

            ports.out.sort((a, b) => getCoord(a.to) - getCoord(b.to));
            ports.in.sort((a, b) => getCoord(a.from) - getCoord(b.from));

            // Assign Offsets
            const assign = (list, isOut) => {
                if (list.length === 0) return;

                // Spread width: wider for more connections
                const spacing = 16;
                const totalW = (list.length - 1) * spacing;
                const start = -totalW / 2;

                list.forEach((e, idx) => {
                    const offset = start + idx * spacing;
                    if (!edgePortOffsets.has(e.id))
                        edgePortOffsets.set(e.id, {});
                    const entry = edgePortOffsets.get(e.id);
                    if (isOut) entry.fromOffset = offset;
                    else entry.toOffset = offset;
                });
            };

            assign(ports.out, true);
            assign(ports.in, false);
        });

        edges.forEach((e) => {
            const a = positions.get(e.from);
            const b = positions.get(e.to);
            if (!a || !b) return;

            const offsets = edgePortOffsets.get(e.id) || {
                fromOffset: 0,
                toOffset: 0
            };
            const pts = this._computeOrthogonalRoute(
                a,
                b,
                isVertical,
                cfg,
                offsets
            );

            routes.set(e.id, {
                points: pts,
                labelPoint: this._getLabelPoint(pts)
            });
        });

        return routes;
    }

    _computeOrthogonalRoute(from, to, isVertical, cfg, offsets) {
        const fromCx = from.x + from.width / 2;
        const fromCy = from.y + from.height / 2;
        const toCx = to.x + to.width / 2;
        const toCy = to.y + to.height / 2;

        const isForward = isVertical ? toCy > fromCy : toCx > fromCx;

        let start, end;

        if (isVertical) {
            start = {
                x: fromCx + (offsets.fromOffset || 0),
                y: isForward ? from.y + from.height : from.y
            };
            end = {
                x: toCx + (offsets.toOffset || 0),
                y: isForward ? to.y : to.y + to.height
            };
        } else {
            start = {
                x: isForward ? from.x + from.width : from.x,
                y: fromCy + (offsets.fromOffset || 0)
            };
            end = {
                x: isForward ? to.x : to.x + to.width,
                y: toCy + (offsets.toOffset || 0)
            };
        }

        const pts = [start];

        // 3-point Manhattan routing
        if (isVertical) {
            const midY = (start.y + end.y) / 2;
            pts.push({ x: start.x, y: midY });
            pts.push({ x: end.x, y: midY });
        } else {
            const midX = (start.x + end.x) / 2;
            pts.push({ x: midX, y: start.y });
            pts.push({ x: midX, y: end.y });
        }

        pts.push(end);
        return dedupeCollinear(pts);
    }

    _getLabelPoint(pts) {
        if (!pts || pts.length < 2) return { x: 0, y: 0 };
        const midIdx = Math.floor((pts.length - 1) / 2);
        const p1 = pts[midIdx];
        const p2 = pts[midIdx + 1];
        return {
            x: (p1.x + p2.x) / 2,
            y: (p1.y + p2.y) / 2
        };
    }

    _calcBounds(positions, routes) {
        let minX = Infinity,
            minY = Infinity,
            maxX = -Infinity,
            maxY = -Infinity;

        if (positions.size === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };

        positions.forEach((p) => {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x + p.width);
            maxY = Math.max(maxY, p.y + p.height);
        });

        routes.forEach((r) => {
            r.points.forEach((p) => {
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x);
                maxY = Math.max(maxY, p.y);
            });
        });

        return { minX, minY, maxX, maxY };
    }
}
