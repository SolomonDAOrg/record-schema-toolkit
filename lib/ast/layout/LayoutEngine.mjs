/**
 * LayoutEngine - First-pass layout calculation
 * Handles page breaks, keep-together rules, and builds node→page mapping
 * @module format-ast/layout/LayoutEngine
 */

import { PAGE_SIZES } from "../constants/core.mjs";

/**
 * @typedef {import("../types/core.mjs").KeepRules} KeepRules
 * @typedef {import("../types/core.mjs").LayoutResult} LayoutResult
 * @typedef {import("../types/core.mjs").LayoutBlock} LayoutBlock
 * @typedef {import("../types/core.mjs").PageConfig} PageConfig
 * @typedef {import("../types/core.mjs").SectionConfig} SectionConfig
 * @typedef {import("../types/core.mjs").NodeType} NodeType
 * @typedef {import("../types/core.mjs").Margins} Margins
 * @typedef {import("../types/core.mjs").TextStyle} TextStyle
 * @typedef {import("../types/core.mjs").LayoutContext} LayoutContext
 * @typedef {import("../types/core.mjs").HeightResult} HeightResult
 * @typedef {import("../types/core.mjs").LinkDestination} LinkDestination
 * @typedef {import("../types/core.mjs").SectionLayoutResult} SectionLayoutResult
 * @typedef {import("../types/core.mjs").PageState} PageState
 * @typedef {import("../types/core.mjs").RequiredMargins} RequiredMargins
 * @typedef {import("../types/core.mjs").HeaderFooterConfig} HeaderFooterConfig
 * @typedef {import("../nodes/BaseNode.mjs").BaseNode} BaseNode
 * @typedef {import("../types/core.mjs").PageComposition} PageComposition
 * @typedef {import("../types/core.mjs").PageCompositionSource} PageCompositionSource
 * @typedef {import("../types/core.mjs").PageCompositionPartition} PageCompositionPartition
 * @typedef {import("../types/core.mjs").ComposedSection} ComposedSection
 */

/**
 * Height calculator function for a node type
 * @typedef {(node: BaseNode, context: LayoutContext) => HeightResult} HeightCalculator
 */

// =============================================================================
// Header/Footer Offset Calculation
// =============================================================================

/**
 * Calculate the vertical offset required for a header or footer.
 * This determines how much the effective content area is reduced.
 * Must match TwoPassPdfRenderer's offset calculation exactly.
 * @param {HeaderFooterConfig | null | undefined} config
 * @returns {number} Offset in points
 */
function calculateHeaderFooterOffset(config) {
    if (!config) {
        return 0;
    }
    // Use MAX fontSize across all columns
    const fontSize =
        Math.max(
            config.columns?.left?.style?.fontSize ?? 0,
            config.columns?.center?.style?.fontSize ?? 0,
            config.columns?.right?.style?.fontSize ?? 0
        ) || 10;
    // Text height + padding/border/gap space + content ascender space
    // Border: 18 (4 gap + 1 border + 5 gap + 8 ascenders)
    // No border: 12 (4 gap + 8 ascenders)
    return fontSize + (config.border ? 18 : 12);
}

/**
 * Calculate the maximum offset across ALL header/footer configs.
 * Different pages may have different headers/footers (first, not-first, odd, even, etc.)
 * We must reserve space for the largest one to ensure consistent layout.
 * @param {ReadonlyArray<HeaderFooterConfig> | undefined} configs
 * @returns {number} Maximum offset in points
 */
function calculateMaxHeaderFooterOffset(configs) {
    if (!configs || configs.length === 0) {
        return 0;
    }
    let maxOffset = 0;
    for (let i = 0, len = configs.length; i < len; i++) {
        const offset = calculateHeaderFooterOffset(configs[i]);
        if (offset > maxOffset) {
            maxOffset = offset;
        }
    }
    return maxOffset;
}

// =============================================================================
// Default Height Calculators
// =============================================================================

/** @type {Record<string, HeightCalculator>} */
const DEFAULT_HEIGHT_CALCULATORS = {
    text: (node, ctx) => {
        const text = /** @type {string} */ (node.attrs?.text) ?? "";
        const fontSize = node.textStyle?.fontSize ?? ctx.baseFontSize;
        const lineHeight = node.textStyle?.lineHeight ?? ctx.lineHeight;
        const lines = Math.ceil(
            measureTextWidth(text, fontSize) / ctx.contentWidth
        );
        const height = lines * (fontSize * lineHeight);
        return {
            height,
            canSplit: lines > 1,
            minHeight: fontSize * lineHeight
        };
    },

    paragraph: (node, ctx) => {
        let height = 0;
        for (let i = 0, len = node.children.length; i < len; i++) {
            const child = node.children[i];
            const calc = getHeightCalculator(child.type);
            height += calc(child, ctx).height;
        }
        // Add paragraph spacing
        height += ctx.baseFontSize * 0.5;
        const minHeight = ctx.baseFontSize * ctx.lineHeight * 2; // At least 2 lines
        return { height, canSplit: true, minHeight };
    },

    heading: (node, ctx) => {
        // HeadingNode stores level as direct property
        const level = /** @type {any} */ (node).level ?? node.attrs?.level ?? 1;
        /** @type {Record<number, number>} */
        const scales = { 1: 2.0, 2: 1.5, 3: 1.25, 4: 1.1, 5: 1.0, 6: 0.9 };
        const fontSize = ctx.baseFontSize * (scales[level] ?? 1);
        const height = fontSize * ctx.lineHeight * 1.5; // Heading + spacing
        return { height, canSplit: false, minHeight: height };
    },

    list: (node, ctx) => {
        let height = 0;
        for (let i = 0, len = node.children.length; i < len; i++) {
            const calc = getHeightCalculator(node.children[i].type);
            height += calc(node.children[i], ctx).height;
        }
        return {
            height,
            canSplit: true,
            minHeight: ctx.baseFontSize * ctx.lineHeight
        };
    },

    "list-item": (node, ctx) => {
        let height = ctx.baseFontSize * ctx.lineHeight;
        for (let i = 0, len = node.children.length; i < len; i++) {
            const calc = getHeightCalculator(node.children[i].type);
            height += calc(node.children[i], ctx).height;
        }
        return { height, canSplit: false, minHeight: height };
    },

    "code-block": (node, ctx) => {
        const code = /** @type {string} */ (node.attrs?.code) ?? "";
        const lines = code.split("\n").length;
        const fontSize = ctx.baseFontSize * 0.9;
        const height = lines * (fontSize * 1.2) + 16; // Padding
        return { height, canSplit: true, minHeight: fontSize * 1.2 * 3 };
    },

    "horizontal-rule": (_node, ctx) => {
        const height = ctx.baseFontSize * 2;
        return { height, canSplit: false, minHeight: height };
    },

    break: (node, _ctx) => {
        const breakType =
            /** @type {any} */ (node).breakType ?? node.attrs?.breakType;
        if (breakType === "page") {
            return { height: Infinity, canSplit: false, minHeight: 0 };
        }
        return { height: _ctx.baseFontSize, canSplit: false, minHeight: 0 };
    },

    // =========================================================================
    // Table Height Calculation
    // =========================================================================
    table: (node, ctx) => {
        let height = 0;
        const cellPadding = 8; // Top + bottom padding per cell
        const borderWidth = 1;

        // Some pipelines serialize tables into attrs.tableData instead of row/cell nodes.
        // If so, estimate height from that representation.
        const tableData = node.attrs?.tableData;
        if (node.children.length === 0 && tableData) {
            const normalized = normalizeTableData(tableData);
            const headers = normalized.headers;
            const rows = normalized.rows;
            const colCount = calculateMaxTableColumnCount(headers, rows);
            const fontSize = ctx.baseFontSize;

            if (headers && node.attrs?.headerRow !== false) {
                const headerHeight =
                    calculateRowHeightFromTextCells(
                        headers,
                        ctx,
                        colCount,
                        fontSize
                    ) +
                    cellPadding +
                    borderWidth;
                height += headerHeight;
            }

            for (let i = 0, len = rows.length; i < len; i++) {
                const rowCells = rows[i];
                const rowHeight =
                    calculateRowHeightFromTextCells(
                        rowCells,
                        ctx,
                        colCount,
                        fontSize
                    ) +
                    cellPadding +
                    borderWidth;
                height += rowHeight;
            }

            if (node.attrs?.caption) {
                height += ctx.baseFontSize * ctx.lineHeight * 1.5;
            }

            const hasHeader =
                node.attrs?.headerRow !== false &&
                !!headers &&
                headers.length > 0;
            const minHeight = hasHeader
                ? calculateMinTableHeightFromTableData(normalized, ctx)
                : ctx.baseFontSize * ctx.lineHeight * 2;

            const totalRows = (hasHeader ? 1 : 0) + rows.length;
            return {
                height,
                canSplit: totalRows > 2,
                minHeight
            };
        }

        for (let i = 0, len = node.children.length; i < len; i++) {
            const row = node.children[i];
            let maxRowHeight = 0;

            // Calculate max height among all cells in row
            for (let j = 0, jlen = row.children.length; j < jlen; j++) {
                const cell = row.children[j];
                const cellHeight = calculateCellHeight(cell, ctx);
                if (cellHeight > maxRowHeight) {
                    maxRowHeight = cellHeight;
                }
            }

            height += maxRowHeight + cellPadding + borderWidth;
        }

        // Add table caption if present
        if (node.attrs?.caption) {
            height += ctx.baseFontSize * ctx.lineHeight * 1.5;
        }

        // Tables with header rows should keep header with at least first data row
        const hasHeader = node.attrs?.headerRow !== false;
        const minHeight = hasHeader
            ? calculateMinTableHeight(node, ctx)
            : ctx.baseFontSize * ctx.lineHeight * 2;

        return {
            height,
            canSplit: node.children.length > 2, // Can split if more than header + 1 row
            minHeight
        };
    },

    row: (node, ctx) => {
        let maxHeight = 0;
        const cellPadding = 8;

        for (let i = 0, len = node.children.length; i < len; i++) {
            const cellHeight = calculateCellHeight(node.children[i], ctx);
            if (cellHeight > maxHeight) {
                maxHeight = cellHeight;
            }
        }

        return {
            height: maxHeight + cellPadding,
            canSplit: false,
            minHeight: maxHeight + cellPadding
        };
    },

    "header-row": (node, ctx) => {
        // Header rows should never split and should stay with next row
        const result = DEFAULT_HEIGHT_CALCULATORS.row(node, ctx);
        return {
            ...result,
            canSplit: false
        };
    },

    cell: (node, ctx) => {
        return {
            height: calculateCellHeight(node, ctx),
            canSplit: false,
            minHeight: ctx.baseFontSize * ctx.lineHeight
        };
    },

    "header-cell": (node, ctx) => {
        return DEFAULT_HEIGHT_CALCULATORS.cell(node, ctx);
    },

    // =========================================================================
    // Legal Nodes
    // =========================================================================
    article: (node, ctx) => {
        // Article heading + children
        let height = ctx.baseFontSize * 2 * ctx.lineHeight; // Title
        for (let i = 0, len = node.children.length; i < len; i++) {
            const calc = getHeightCalculator(node.children[i].type);
            height += calc(node.children[i], ctx).height;
        }
        return {
            height,
            canSplit: true,
            minHeight: ctx.baseFontSize * ctx.lineHeight * 4
        };
    },

    section: (node, ctx) => {
        let height = ctx.baseFontSize * 1.5 * ctx.lineHeight; // Section heading
        for (let i = 0, len = node.children.length; i < len; i++) {
            const calc = getHeightCalculator(node.children[i].type);
            height += calc(node.children[i], ctx).height;
        }
        return {
            height,
            canSplit: true,
            minHeight: ctx.baseFontSize * ctx.lineHeight * 3
        };
    },

    clause: (node, ctx) => {
        let height = 0;
        for (let i = 0, len = node.children.length; i < len; i++) {
            const calc = getHeightCalculator(node.children[i].type);
            height += calc(node.children[i], ctx).height;
        }
        height += ctx.baseFontSize * 0.3; // Spacing
        return {
            height,
            canSplit: true,
            minHeight: ctx.baseFontSize * ctx.lineHeight
        };
    },

    definition: (node, ctx) => {
        let height = ctx.baseFontSize * ctx.lineHeight; // Term
        for (let i = 0, len = node.children.length; i < len; i++) {
            const calc = getHeightCalculator(node.children[i].type);
            height += calc(node.children[i], ctx).height;
        }
        height += ctx.baseFontSize * 0.5; // Spacing
        // Definitions should stay together
        return { height, canSplit: false, minHeight: height };
    },

    "signature-block": (_node, ctx) => {
        // Signature blocks should never split
        const height = ctx.baseFontSize * ctx.lineHeight * 6;
        return { height, canSplit: false, minHeight: height };
    },

    notice: (node, ctx) => {
        let height = ctx.baseFontSize * ctx.lineHeight * 2; // Box padding + title
        for (let i = 0, len = node.children.length; i < len; i++) {
            const calc = getHeightCalculator(node.children[i].type);
            height += calc(node.children[i], ctx).height;
        }
        // Notices should stay together if reasonable
        return {
            height,
            canSplit: height > 300,
            minHeight: ctx.baseFontSize * ctx.lineHeight * 3
        };
    },

    schedule: (node, ctx) => {
        // Schedule heading + children
        let height = ctx.baseFontSize * 1.8 * ctx.lineHeight; // Heading
        for (let i = 0, len = node.children.length; i < len; i++) {
            const calc = getHeightCalculator(node.children[i].type);
            height += calc(node.children[i], ctx).height;
        }
        return {
            height,
            canSplit: true,
            minHeight: ctx.baseFontSize * ctx.lineHeight * 3
        };
    },

    exhibit: (node, ctx) => {
        // Exhibit heading + children (same structure as schedule)
        let height = ctx.baseFontSize * 1.8 * ctx.lineHeight;
        for (let i = 0, len = node.children.length; i < len; i++) {
            const calc = getHeightCalculator(node.children[i].type);
            height += calc(node.children[i], ctx).height;
        }
        return {
            height,
            canSplit: true,
            minHeight: ctx.baseFontSize * ctx.lineHeight * 3
        };
    },

    // =========================================================================
    // Image
    // =========================================================================
    image: (node, ctx) => {
        const requestedHeight =
            /** @type {number} */ (node.attrs?.height) ?? 200;
        const isFullPage =
            node.attrs?.fullPage === true ||
            node.attrs?.pageMode === "full-page";

        if (isFullPage) {
            return {
                height: ctx.contentHeight,
                canSplit: false,
                minHeight: ctx.contentHeight
            };
        }

        const captionHeight =
            node.attrs?.alt && !node.attrs?.sourceBytes
                ? ctx.baseFontSize * ctx.lineHeight
                : 0;
        const totalHeight = Math.min(
            requestedHeight + captionHeight + 10,
            ctx.contentHeight
        );
        return {
            height: totalHeight,
            canSplit: false,
            minHeight: totalHeight
        };
    },

    // =========================================================================
    // Link (inline, minimal height impact)
    // =========================================================================
    link: (node, ctx) => {
        let height = 0;
        for (let i = 0, len = node.children.length; i < len; i++) {
            const calc = getHeightCalculator(node.children[i].type);
            height += calc(node.children[i], ctx).height;
        }
        return { height, canSplit: false, minHeight: height };
    },

    // =========================================================================
    // Cover page and TOC
    // =========================================================================
    "cover-page": (_node, ctx) => {
        // Cover page takes full page
        return {
            height: ctx.contentHeight,
            canSplit: false,
            minHeight: ctx.contentHeight
        };
    },

    toc: (node, ctx) => {
        const entries =
            /** @type {ReadonlyArray<unknown>} */ (node.attrs?.entries) ?? [];
        const height = entries.length * ctx.baseFontSize * ctx.lineHeight * 1.2;
        return {
            height,
            canSplit: true,
            minHeight: ctx.baseFontSize * ctx.lineHeight * 5
        };
    }
};

// =============================================================================
// Table Helper Functions
// =============================================================================

/**
 * Calculate height of a single cell
 * @param {BaseNode} cell
 * @param {LayoutContext} ctx
 * @returns {number}
 */
function calculateCellHeight(cell, ctx) {
    let height = 0;
    const fontSize = cell.textStyle?.fontSize ?? ctx.baseFontSize;

    if (cell.children.length === 0) {
        return fontSize * ctx.lineHeight;
    }

    for (let i = 0, len = cell.children.length; i < len; i++) {
        const child = cell.children[i];
        if (child.type === "text") {
            const text = /** @type {string} */ (child.attrs?.text) ?? "";
            // Estimate column width (assume equal columns for now)
            const colWidth = ctx.contentWidth / 4; // Default estimate
            const lines = Math.max(
                1,
                Math.ceil(measureTextWidth(text, fontSize) / colWidth)
            );
            height += lines * fontSize * ctx.lineHeight;
        } else {
            const calc = getHeightCalculator(child.type);
            height += calc(child, ctx).height;
        }
    }

    return Math.max(height, fontSize * ctx.lineHeight);
}

/**
 * Calculate minimum table height (header + first row)
 * @param {BaseNode} table
 * @param {LayoutContext} ctx
 * @returns {number}
 */
function calculateMinTableHeight(table, ctx) {
    let height = 0;
    const cellPadding = 8;
    const borderWidth = 1;
    const rowsToMeasure = Math.min(2, table.children.length);

    for (let i = 0; i < rowsToMeasure; i++) {
        const row = table.children[i];
        let maxRowHeight = 0;

        for (let j = 0, jlen = row.children.length; j < jlen; j++) {
            const cellHeight = calculateCellHeight(row.children[j], ctx);
            if (cellHeight > maxRowHeight) {
                maxRowHeight = cellHeight;
            }
        }

        height += maxRowHeight + cellPadding + borderWidth;
    }

    return height;
}

/**
 * Normalize a tableData structure into headers + rows.
 * Supports common shapes:
 * - { headers: string[], rows: string[][] }
 * - { header: string[], body: string[][] }
 * - { rows: Array<{cells: unknown[]}> }
 * - string[][]
 * @param {unknown} tableData
 * @returns {{ headers: string[] | null, rows: string[][] }}
 */
function normalizeTableData(tableData) {
    /** @type {string[] | null} */
    let headers = null;
    /** @type {string[][]} */
    let rows = [];

    if (Array.isArray(tableData)) {
        // string[][] or {cells:...}[]
        if (tableData.length > 0 && Array.isArray(tableData[0])) {
            rows = /** @type {string[][]} */ (tableData).map((r) =>
                Array.isArray(r) ? r.map(toCellText) : []
            );
        } else {
            for (let i = 0, len = tableData.length; i < len; i++) {
                const row = /** @type {any} */ (tableData[i]);
                const cells = Array.isArray(row?.cells) ? row.cells : [];
                rows.push(cells.map(toCellText));
            }
        }
        return { headers, rows };
    }

    if (tableData && typeof tableData === "object") {
        const td = /** @type {any} */ (tableData);
        const rawHeaders = td.headers ?? td.header ?? null;
        if (Array.isArray(rawHeaders)) {
            headers = rawHeaders.map(toCellText);
        }

        const rawRows = td.rows ?? td.body ?? td.data ?? [];
        if (Array.isArray(rawRows)) {
            for (let i = 0, len = rawRows.length; i < len; i++) {
                const row = /** @type {any} */ (rawRows[i]);
                if (Array.isArray(row)) {
                    rows.push(row.map(toCellText));
                } else {
                    const cells = Array.isArray(row?.cells) ? row.cells : [];
                    rows.push(cells.map(toCellText));
                }
            }
        }
    }

    return { headers, rows };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function toCellText(value) {
    if (value === null || value === undefined) {
        return "";
    }
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (typeof value === "object") {
        const obj = /** @type {any} */ (value);
        if (typeof obj.text === "string") {
            return obj.text;
        }
        if (typeof obj.content === "string") {
            return obj.content;
        }
        if (typeof obj.value === "string") {
            return obj.value;
        }
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return String(value);
}

/**
 * @param {string[] | null} headers
 * @param {string[][]} rows
 * @returns {number}
 */
function calculateMaxTableColumnCount(headers, rows) {
    let max = headers ? headers.length : 0;
    for (let i = 0, len = rows.length; i < len; i++) {
        const rlen = rows[i]?.length ?? 0;
        if (rlen > max) {
            max = rlen;
        }
    }
    return Math.max(1, max);
}

/**
 * @param {ReadonlyArray<string>} cells
 * @param {LayoutContext} ctx
 * @param {number} colCount
 * @param {number} fontSize
 * @returns {number}
 */
function calculateRowHeightFromTextCells(cells, ctx, colCount, fontSize) {
    const colWidth = ctx.contentWidth / Math.max(1, colCount);
    let maxHeight = fontSize * ctx.lineHeight;

    for (let i = 0, len = cells.length; i < len; i++) {
        const text = cells[i] ?? "";
        const lines = Math.max(
            1,
            Math.ceil(measureTextWidth(text, fontSize) / colWidth)
        );
        const h = lines * fontSize * ctx.lineHeight;
        if (h > maxHeight) {
            maxHeight = h;
        }
    }

    return maxHeight;
}

/**
 * Minimum table height for tableData tables (header + first row).
 * @param {{ headers: string[] | null, rows: string[][] }} normalized
 * @param {LayoutContext} ctx
 * @returns {number}
 */
function calculateMinTableHeightFromTableData(normalized, ctx) {
    const cellPadding = 8;
    const borderWidth = 1;
    const fontSize = ctx.baseFontSize;
    const headers = normalized.headers;
    const rows = normalized.rows;
    const colCount = calculateMaxTableColumnCount(headers, rows);
    let height = 0;

    if (headers && headers.length > 0) {
        height +=
            calculateRowHeightFromTextCells(headers, ctx, colCount, fontSize) +
            cellPadding +
            borderWidth;
    }

    if (rows.length > 0) {
        height +=
            calculateRowHeightFromTextCells(rows[0], ctx, colCount, fontSize) +
            cellPadding +
            borderWidth;
    }

    return height;
}

/**
 * @param {NodeType} type
 * @returns {HeightCalculator}
 */
function getHeightCalculator(type) {
    return DEFAULT_HEIGHT_CALCULATORS[type] ?? defaultHeightCalculator;
}

/**
 * @param {BaseNode} node
 * @param {LayoutContext} ctx
 * @returns {HeightResult}
 */
function defaultHeightCalculator(node, ctx) {
    let height = 0;
    for (let i = 0, len = node.children.length; i < len; i++) {
        const calc = getHeightCalculator(node.children[i].type);
        height += calc(node.children[i], ctx).height;
    }
    if (height === 0) {
        height = ctx.baseFontSize * ctx.lineHeight;
    }
    return {
        height,
        canSplit: true,
        minHeight: ctx.baseFontSize * ctx.lineHeight
    };
}

/**
 * Estimate text width (simplified)
 * @param {string} text
 * @param {number} fontSize
 * @returns {number}
 */
function measureTextWidth(text, fontSize) {
    // Average character width is ~0.5 of font size for proportional fonts
    return text.length * fontSize * 0.5;
}

// =============================================================================
// LayoutEngine Class
// =============================================================================

export class LayoutEngine {
    /**
     * Reserve a scaled logo box and align the selected company regions beside it.
     * The input layout is never mutated, so repeated rendering cannot accumulate shifts.
     * @param {PageComposition} configuration
     * @param {number} pageWidth
     * @param {number} pageHeight
     * @returns {PageComposition}
     */
    layoutLetterheadLogo(configuration, pageWidth, pageHeight) {
        const logo = configuration.letterheadLogo;
        if (!logo || logo.enabled === false) return configuration;
        if (typeof logo.path !== "string" || !logo.path.trim())
            throw new Error("Letterhead logo requires a local SVG path");
        const scale = logo.scale ?? 1;
        const gap = logo.gap ?? 12;
        if (
            ![logo.x, logo.top, logo.width, logo.height, scale, gap].every(
                Number.isFinite
            ) ||
            logo.x < 0 ||
            logo.top < 0 ||
            logo.width <= 0 ||
            logo.height <= 0 ||
            scale <= 0 ||
            gap < 0
        ) {
            throw new Error("Invalid letterhead logo geometry");
        }
        const width = logo.width * scale,
            height = logo.height * scale;
        if (
            !Number.isFinite(width) ||
            !Number.isFinite(height) ||
            logo.x + width > pageWidth ||
            logo.top + height > pageHeight
        )
            throw new Error("Letterhead logo lies outside the physical page");
        if (
            !Array.isArray(logo.shiftSourceHeadings) ||
            logo.shiftSourceHeadings.length === 0 ||
            new Set(logo.shiftSourceHeadings).size !==
                logo.shiftSourceHeadings.length
        ) {
            throw new Error(
                "Letterhead logo requires unique company source headings"
            );
        }
        const selected = new Set(logo.shiftSourceHeadings);
        for (const heading of selected) {
            if (
                !configuration.regions.some(
                    (region) => region.sourceHeading === heading
                )
            )
                throw new Error(
                    "Missing letterhead source heading: " + heading
                );
        }
        const companyRegions = configuration.regions.filter((region) =>
            selected.has(region.sourceHeading)
        );
        const minimumTop = Math.min(
            ...companyRegions.map((region) => region.top)
        );
        const maximumBottom = Math.max(
            ...companyRegions.map((region) => region.top + region.height)
        );
        if (logo.top < minimumTop || logo.top + height > maximumBottom)
            throw new Error(
                "Letterhead logo exceeds the company region height"
            );
        const textX = logo.x + width + gap;
        const regions = configuration.regions.map((region) => {
            if (!selected.has(region.sourceHeading)) return region;
            const available = region.x + region.width - textX;
            if (textX < region.x || available <= 0)
                throw new Error(
                    "Letterhead logo leaves no room beside company region: " +
                        region.sourceHeading
                );
            return { ...region, x: textX, width: available };
        });
        for (const region of regions) {
            if (
                logo.x < region.x + region.width &&
                region.x < logo.x + width &&
                logo.top < region.top + region.height &&
                region.top < logo.top + height
            ) {
                throw new Error(
                    "Letterhead logo overlaps source region: " +
                        region.sourceHeading
                );
            }
        }
        const pagination = configuration.pagination;
        if (
            pagination &&
            logo.x < pagination.x + pagination.width &&
            pagination.x < logo.x + width &&
            logo.top < pagination.top + pagination.fontSize * 1.35 &&
            pagination.top < logo.top + height
        ) {
            throw new Error("Letterhead logo overlaps pagination");
        }
        return { ...configuration, regions };
    }

    /**
     * Fixed compositions account for every source block exactly once.
     * Coordinates are PDF points measured from the physical page's top-left corner.
     * @param {PageComposition} configuration
     * @param {ReadonlyArray<ComposedSection>} sections
     * @param {number} pageWidth
     * @param {number} pageHeight
     * @returns {Map<string, PageCompositionSource>}
     */
    layoutPageComposition(configuration, sections, pageWidth, pageHeight) {
        if (configuration.mode !== "fixed")
            throw new Error("Unsupported page composition mode");
        if (sections.length !== 1)
            throw new Error(
                "Fixed page composition requires one source document"
            );
        if (configuration.regions.length === 0)
            throw new Error("Fixed page composition requires source regions");
        const source = new Map();
        let active = null;
        for (const node of sections[0].content) {
            if (node.type === "heading") {
                const heading = this.extractText(node).trim();
                if (source.has(heading))
                    throw new Error("Duplicate source heading: " + heading);
                active = { heading, nodes: [] };
                source.set(heading, active);
            } else {
                if (active === null)
                    throw new Error(
                        "Content precedes the first source heading"
                    );
                if (
                    node.type !== "paragraph" &&
                    node.type !== "signature-block" &&
                    node.type !== "table" &&
                    node.type !== "image"
                )
                    throw new Error(
                        "Fixed page composition requires paragraph, table, image or signature-block content: " +
                            active.heading
                    );
                active.nodes.push(node);
            }
        }
        if (configuration.pagination) {
            const p = configuration.pagination;
            if (
                ![p.x, p.top, p.width, p.fontSize].every(Number.isFinite) ||
                p.x < 0 ||
                p.top < 0 ||
                p.width <= 0 ||
                p.fontSize <= 0 ||
                p.x + p.width > pageWidth ||
                p.top + p.fontSize * 1.35 > pageHeight
            ) {
                throw new Error(
                    "Page composition pagination lies outside the physical page"
                );
            }
            for (const region of configuration.regions) {
                if (
                    p.x < region.x + region.width &&
                    region.x < p.x + p.width &&
                    p.top < region.top + region.height &&
                    region.top < p.top + p.fontSize * 1.35
                ) {
                    throw new Error(
                        "Page composition pagination overlaps source region: " +
                            region.sourceHeading
                    );
                }
            }
        }
        const selected = new Set();
        for (const region of configuration.regions) {
            if (!source.has(region.sourceHeading))
                throw new Error(
                    "Missing source heading: " + region.sourceHeading
                );
            if (selected.has(region.sourceHeading))
                throw new Error(
                    "Source heading selected twice: " + region.sourceHeading
                );
            if (source.get(region.sourceHeading).nodes.length === 0)
                throw new Error("Empty source block: " + region.sourceHeading);
            selected.add(region.sourceHeading);
            if (!Number.isFinite(region.fontSize) || region.fontSize <= 0)
                throw new Error("Invalid region font size");
            if (
                region.lineSpacing !== undefined &&
                (!Number.isFinite(region.lineSpacing) || region.lineSpacing < 1)
            )
                throw new Error("Invalid region line spacing");
            if (
                region.headingFontSize !== undefined &&
                (!Number.isFinite(region.headingFontSize) ||
                    region.headingFontSize <= 0)
            )
                throw new Error("Invalid heading font size");
            for (const spacing of [region.paragraphGap, region.headingGap]) {
                if (
                    spacing !== undefined &&
                    (!Number.isFinite(spacing) || spacing < 0)
                )
                    throw new Error("Invalid region spacing");
            }
        }
        for (const heading of source.keys()) {
            if (!selected.has(heading))
                throw new Error("Unplaced source heading: " + heading);
        }
        for (const box of [
            ...configuration.regions,
            ...(configuration.decorations ?? [])
        ]) {
            if (
                ![box.x, box.top, box.width, box.height].every(
                    Number.isFinite
                ) ||
                box.x < 0 ||
                box.top < 0 ||
                box.width <= 0 ||
                box.height <= 0 ||
                box.x + box.width > pageWidth ||
                box.top + box.height > pageHeight
            ) {
                throw new Error(
                    "Page composition box lies outside the physical page"
                );
            }
        }
        for (let first = 0; first < configuration.regions.length; first++) {
            const a = configuration.regions[first];
            for (
                let second = first + 1;
                second < configuration.regions.length;
                second++
            ) {
                const b = configuration.regions[second];
                if (
                    a.x < b.x + b.width &&
                    b.x < a.x + a.width &&
                    a.top < b.top + b.height &&
                    b.top < a.top + a.height
                ) {
                    throw new Error(
                        "Overlapping source regions: " +
                            a.sourceHeading +
                            " / " +
                            b.sourceHeading
                    );
                }
            }
        }
        return source;
    }

    /**
     * Split the first-page slots from an explicitly named flowing continuation.
     * @param {PageComposition} configuration
     * @param {ReadonlyArray<ComposedSection>} sections
     * @returns {PageCompositionPartition}
     */
    partitionPageComposition(configuration, sections) {
        if (configuration.mode !== "first-page")
            throw new Error("Unsupported page composition mode");
        if (!configuration.continuationHeading?.trim())
            throw new Error(
                "First-page composition requires a continuation heading"
            );
        if (sections.length !== 1)
            throw new Error(
                "First-page composition requires one source document"
            );
        const section = sections[0];
        const boundaries = [];
        for (let index = 0; index < section.content.length; index++) {
            const node = section.content[index];
            if (
                node.type === "heading" &&
                this.extractText(node).trim() ===
                    configuration.continuationHeading
            )
                boundaries.push(index);
        }
        if (boundaries.length !== 1)
            throw new Error(
                "First-page composition requires exactly one continuation heading: " +
                    configuration.continuationHeading
            );
        const boundary = boundaries[0];
        if (boundary === 0 || boundary === section.content.length - 1)
            throw new Error(
                "First-page composition requires both region content and continuation content"
            );
        return {
            firstPage: {
                ...section,
                content: section.content.slice(0, boundary)
            },
            continuation: {
                ...section,
                config: { ...section.config, startsNewPage: true },
                content: section.content.slice(boundary)
            }
        };
    }

    constructor() {
        /** @type {Map<NodeType, HeightCalculator>} */
        this.heightCalculators = new Map();

        /** @type {LinkDestination[]} */
        this.linkDestinations = [];

        // Register default calculators
        for (const type of Object.keys(DEFAULT_HEIGHT_CALCULATORS)) {
            this.heightCalculators.set(
                /** @type {NodeType} */ (type),
                DEFAULT_HEIGHT_CALCULATORS[type]
            );
        }
    }

    /**
     * Register custom height calculator for a node type
     * @param {NodeType} type
     * @param {HeightCalculator} calc
     * @returns {this}
     */
    registerHeightCalculator(type, calc) {
        this.heightCalculators.set(type, calc);
        return this;
    }

    /**
     * Calculate height for a node
     * @param {BaseNode} node
     * @param {LayoutContext} context
     * @returns {HeightResult}
     */
    calculateHeight(node, context) {
        const calc =
            this.heightCalculators.get(node.type) ?? defaultHeightCalculator;
        return calc(node, context);
    }

    /**
     * Perform layout for a section
     * @param {ReadonlyArray<BaseNode>} nodes
     * @param {SectionConfig} sectionConfig
     * @param {number} startPage
     * @param {PageConfig} defaultPageConfig
     * @param {ReadonlyArray<HeaderFooterConfig>} [defaultHeaders]
     * @param {ReadonlyArray<HeaderFooterConfig>} [defaultFooters]
     * @returns {SectionLayoutResult}
     */
    layoutSection(
        nodes,
        sectionConfig,
        startPage,
        defaultPageConfig,
        defaultHeaders,
        defaultFooters
    ) {
        const pageConfig = sectionConfig.pageConfig ?? defaultPageConfig;

        // Section-specific headers/footers override defaults
        const headers = sectionConfig.headers?.length
            ? sectionConfig.headers
            : defaultHeaders;
        const footers = sectionConfig.footers?.length
            ? sectionConfig.footers
            : defaultFooters;

        const context = this.buildContext(
            pageConfig,
            sectionConfig.id,
            headers,
            footers
        );

        /** @type {PageState} */
        const state = {
            pageNumber: startPage,
            sectionPageNumber: sectionConfig.restartPageNumbers ? 1 : startPage,
            currentY: context.margins.top,
            remainingHeight: context.contentHeight
        };

        /** @type {LayoutBlock[]} */
        const blocks = [];
        /** @type {Map<string, number>} */
        const nodePageMap = new Map();

        for (let i = 0, len = nodes.length; i < len; i++) {
            const node = nodes[i];

            // If this is the start of a sequence of notices, check if they fit together
            if (
                node.type === "notice" &&
                (i === 0 || nodes[i - 1].type !== "notice")
            ) {
                let groupHeight = 0;
                let j = i;

                // Calculate cumulative height of the adjacent notice block
                while (j < len && nodes[j].type === "notice") {
                    const hResult = this.calculateHeight(nodes[j], context);
                    groupHeight += hResult.height;
                    // Add buffer for inter-node spacing (approx 1.5 lines)
                    groupHeight += context.baseFontSize * 1.5;
                    j++;
                }

                // If the entire group fits on a page, but not in the current remaining space,
                // force a new page to keep them together.
                if (
                    groupHeight <= context.contentHeight &&
                    groupHeight > state.remainingHeight
                ) {
                    this.newPage(state, context);
                }
            }

            const layoutBlocks = this.layoutNode(
                node,
                context,
                state,
                nodePageMap
            );
            for (let j = 0, jlen = layoutBlocks.length; j < jlen; j++) {
                blocks.push(layoutBlocks[j]);
            }
        }

        return {
            sectionId: sectionConfig.id,
            startPage,
            endPage: state.pageNumber,
            blocks
        };
    }

    /**
     * Layout a single node
     * @param {BaseNode} node
     * @param {LayoutContext} context
     * @param {PageState} state
     * @param {Map<string, number>} nodePageMap
     * @returns {LayoutBlock[]}
     */
    layoutNode(node, context, state, nodePageMap) {
        /** @type {LayoutBlock[]} */
        const blocks = [];
        const { height, canSplit, minHeight } = this.calculateHeight(
            node,
            context
        );

        // Record node position for link destinations
        nodePageMap.set(node.id, state.pageNumber);
        this.linkDestinations.push({
            nodeId: node.id,
            page: state.pageNumber,
            y: context.pageHeight - state.currentY
        });

        // Handle page break nodes
        const breakType =
            /** @type {any} */ (node).breakType ?? node.attrs?.breakType;
        if (node.type === "break" && breakType === "page") {
            this.newPage(state, context);
            return blocks;
        }

        // Check keep rules
        const keepRules = node.keepRules;
        const keepTogether = keepRules?.keepTogether ?? !canSplit;
        const pageBreakBefore = keepRules?.pageBreakBefore ?? false;

        // Force page break before if requested
        if (pageBreakBefore && state.currentY !== context.margins.top) {
            this.newPage(state, context);
        }

        // Record node's starting page
        nodePageMap.set(node.id, state.pageNumber);

        // Check if node fits on current page
        if (height <= state.remainingHeight) {
            // Fits entirely
            blocks.push({
                nodeId: node.id,
                type: node.type,
                height,
                startPage: state.pageNumber,
                endPage: state.pageNumber,
                startY: state.currentY,
                keepRules
            });

            state.currentY += height;
            state.remainingHeight -= height;
        } else if (keepTogether && height <= context.contentHeight) {
            // Doesn't fit but must stay together and can fit on one page
            this.newPage(state, context);
            nodePageMap.set(node.id, state.pageNumber); // Update page

            blocks.push({
                nodeId: node.id,
                type: node.type,
                height,
                startPage: state.pageNumber,
                endPage: state.pageNumber,
                startY: state.currentY,
                keepRules
            });

            state.currentY += height;
            state.remainingHeight -= height;
        } else if (canSplit || height > context.contentHeight) {
            // Must split across pages
            const splitBlocks = this.splitNode(
                node,
                context,
                state,
                nodePageMap
            );
            for (let i = 0, len = splitBlocks.length; i < len; i++) {
                blocks.push(splitBlocks[i]);
            }
        } else {
            // Can't split but doesn't fit - force onto new page
            this.newPage(state, context);
            nodePageMap.set(node.id, state.pageNumber);

            blocks.push({
                nodeId: node.id,
                type: node.type,
                height: Math.min(height, context.contentHeight),
                startPage: state.pageNumber,
                endPage: state.pageNumber,
                startY: state.currentY,
                keepRules,
                wasSplit: true
            });

            state.currentY += height;
            state.remainingHeight -= height;
        }

        // Handle keepWithNext
        if (keepRules?.keepWithNext) {
            // Mark that next node should try to stay with this one
            // This is handled when laying out the next node
        }

        // Handle pageBreakAfter
        if (keepRules?.pageBreakAfter) {
            this.newPage(state, context);
        }

        return blocks;
    }

    /**
     * Split a node across pages
     * @param {BaseNode} node
     * @param {LayoutContext} context
     * @param {PageState} state
     * @param {Map<string, number>} nodePageMap
     * @returns {LayoutBlock[]}
     */
    splitNode(node, context, state, nodePageMap) {
        /** @type {LayoutBlock[]} */
        const blocks = [];
        const { height, minHeight } = this.calculateHeight(node, context);

        const keepRules = node.keepRules;
        const startPage = state.pageNumber;

        // If node has children, split by children
        if (node.children.length > 0) {
            const startPage = state.pageNumber;
            /** @type {LayoutBlock[]} */
            const childBlocks = [];

            for (let i = 0, len = node.children.length; i < len; i++) {
                const child = node.children[i];
                const nextChild = i + 1 < len ? node.children[i + 1] : null;

                // Prevent orphaned nested headings (e.g. headings inside clauses)
                // by checking the next sibling before laying the heading out.
                if (
                    child.type === "heading" &&
                    nextChild &&
                    nextChild.type !== "break"
                ) {
                    const headingHeightResult = this.calculateHeight(
                        child,
                        context
                    );
                    const nextHeightResult = this.calculateHeight(
                        nextChild,
                        context
                    );
                    const nextPreviewMinHeight = Math.max(
                        nextHeightResult.minHeight ?? 0,
                        context.baseFontSize * context.lineHeight
                    );
                    const requiredHeight =
                        headingHeightResult.height + nextPreviewMinHeight;

                    if (
                        headingHeightResult.height <= context.contentHeight &&
                        requiredHeight > state.remainingHeight &&
                        state.currentY !== context.margins.top
                    ) {
                        this.newPage(state, context);
                    }
                }

                const childLayoutBlocks = this.layoutNode(
                    child,
                    context,
                    state,
                    nodePageMap
                );
                for (
                    let j = 0, jlen = childLayoutBlocks.length;
                    j < jlen;
                    j++
                ) {
                    childBlocks.push(childLayoutBlocks[j]);
                }
            }

            blocks.push({
                nodeId: node.id,
                type: node.type,
                height,
                startPage,
                endPage: state.pageNumber,
                startY: context.margins.top,
                wasSplit: startPage !== state.pageNumber,
                children: childBlocks
            });
        } else {
            // Leaf node that needs splitting (e.g., large text block)
            let remainingHeight = height;
            const startPage = state.pageNumber;

            // Unsplittable oversize leaf nodes can otherwise loop forever here:
            // a full-page image may be measured slightly taller than contentHeight,
            // which means useHeight is always < minHeight and we keep calling newPage().
            if (minHeight >= context.contentHeight) {
                const consumeHeight = Math.min(
                    Math.max(state.remainingHeight, 0),
                    context.contentHeight
                );
                const effectiveHeight =
                    consumeHeight > 0 ? consumeHeight : context.contentHeight;
                state.currentY += effectiveHeight;
                state.remainingHeight -= effectiveHeight;
                remainingHeight = 0;
            }

            while (remainingHeight > 0) {
                if (state.remainingHeight <= 0) {
                    this.newPage(state, context);
                }

                const useHeight = Math.min(
                    remainingHeight,
                    state.remainingHeight
                );

                if (useHeight <= 0) {
                    this.newPage(state, context);
                    continue;
                }

                // Ensure we leave at least minHeight on current page (widow/orphan control)
                if (useHeight < minHeight && remainingHeight > useHeight) {
                    // Too little space, go to next page
                    this.newPage(state, context);
                    continue;
                }

                state.currentY += useHeight;
                state.remainingHeight -= useHeight;
                remainingHeight -= useHeight;

                if (remainingHeight > 0 && state.remainingHeight <= 0) {
                    this.newPage(state, context);
                }
            }
        }

        blocks.push({
            nodeId: node.id,
            type: node.type,
            height,
            startPage,
            endPage: state.pageNumber,
            startY: context.margins.top,
            wasSplit: startPage !== state.pageNumber,
            keepRules
        });

        // Keep with next handling
        if (keepRules?.keepWithNext && state.remainingHeight < minHeight * 2) {
            this.newPage(state, context);
        }

        if (keepRules?.pageBreakAfter) {
            this.newPage(state, context);
        }

        return blocks;
    }

    /**
     * Start a new page
     * @param {PageState} state
     * @param {LayoutContext} context
     * @returns {void}
     */
    newPage(state, context) {
        state.pageNumber++;
        state.sectionPageNumber++;
        state.currentY = context.margins.top;
        state.remainingHeight = context.contentHeight;
    }

    /**
     * Build layout context from page config
     * @param {PageConfig} pageConfig
     * @param {string} sectionId
     * @param {ReadonlyArray<HeaderFooterConfig>} [headers]
     * @param {ReadonlyArray<HeaderFooterConfig>} [footers]
     * @returns {LayoutContext}
     */
    buildContext(pageConfig, sectionId, headers, footers) {
        const size = pageConfig.size ?? "letter";
        const dims = PAGE_SIZES[size];

        const landscape = pageConfig.orientation === "landscape";
        const width =
            pageConfig.width ?? (landscape ? dims.height : dims.width);
        const height =
            pageConfig.height ?? (landscape ? dims.width : dims.height);

        /** @type {RequiredMargins} */
        const margins = {
            top: pageConfig.margins?.top ?? 72,
            bottom: pageConfig.margins?.bottom ?? 72,
            left: pageConfig.margins?.left ?? 72,
            right: pageConfig.margins?.right ?? 72
        };

        // Reserve space for the largest possible header/footer across all configs.
        // This must match TwoPassPdfRenderer's newPage() calculation.
        const headerOffset = calculateMaxHeaderFooterOffset(headers);
        const footerOffset = calculateMaxHeaderFooterOffset(footers);

        /** @type {RequiredMargins} */
        const effectiveMargins = {
            top: margins.top + headerOffset,
            bottom: margins.bottom + footerOffset,
            left: margins.left,
            right: margins.right
        };

        const contentWidth =
            width - effectiveMargins.left - effectiveMargins.right;
        const contentHeight =
            height - effectiveMargins.top - effectiveMargins.bottom;

        return {
            pageWidth: width,
            pageHeight: height,
            contentWidth,
            contentHeight,
            margins: effectiveMargins,
            sectionId,
            baseFontSize: 10,
            lineHeight: 1.5
        };
    }

    /**
     * Perform full layout for composed document
     * @param {ReadonlyArray<{ config: SectionConfig; content: ReadonlyArray<BaseNode> }>} sections
     * @param {PageConfig} defaultPageConfig
     * @param {number} [coverPageHeight]
     * @param {number} [tocHeight]
     * @param {ReadonlyArray<HeaderFooterConfig>} [defaultHeaders]
     * @param {ReadonlyArray<HeaderFooterConfig>} [defaultFooters]
     * @returns {LayoutResult}
     */
    layout(
        sections,
        defaultPageConfig,
        coverPageHeight,
        tocHeight,
        defaultHeaders,
        defaultFooters
    ) {
        // Reset link destinations
        this.linkDestinations = [];

        /** @type {LayoutBlock[]} */
        const allBlocks = [];
        /** @type {Map<string, number>} */
        const nodePageMap = new Map();
        /** @type {{ id: string; startPage: number; endPage: number; pageCount: number }[]} */
        const sectionResults = [];
        /** @type {{ nodeId: string; level: number; title: string; page: number }[]} */
        const tocEntries = [];

        let currentPage = 1;

        // Account for cover page
        if (coverPageHeight !== undefined) {
            currentPage++;
        }

        // Account for TOC pages (estimated)
        if (tocHeight !== undefined) {
            const context = this.buildContext(
                defaultPageConfig,
                "toc",
                defaultHeaders,
                defaultFooters
            );
            const tocPages = Math.ceil(tocHeight / context.contentHeight);
            currentPage += tocPages;
        }

        // Layout each section
        for (let i = 0, len = sections.length; i < len; i++) {
            const section = sections[i];
            const result = this.layoutSection(
                section.content,
                section.config,
                currentPage,
                defaultPageConfig,
                defaultHeaders,
                defaultFooters
            );

            // Merge blocks
            for (let j = 0, jlen = result.blocks.length; j < jlen; j++) {
                allBlocks.push(result.blocks[j]);
            }

            // Build node page map from blocks
            this.extractNodePages(result.blocks, nodePageMap);

            // Collect TOC entries
            this.collectTocEntries(section.content, tocEntries, nodePageMap);

            sectionResults.push({
                id: result.sectionId,
                startPage: result.startPage,
                endPage: result.endPage,
                pageCount: result.endPage - result.startPage + 1
            });

            currentPage = result.endPage + 1;
        }

        return {
            totalPages: currentPage - 1,
            blocks: allBlocks,
            nodePageMap,
            sections: sectionResults,
            tocEntries,
            linkDestinations: this.linkDestinations
        };
    }

    /**
     * Get link destinations (for building PDF links)
     * @returns {ReadonlyArray<LinkDestination>}
     */
    getLinkDestinations() {
        return this.linkDestinations;
    }

    /**
     * Extract node→page mappings from layout blocks
     * @param {ReadonlyArray<LayoutBlock>} blocks
     * @param {Map<string, number>} map
     * @returns {void}
     */
    extractNodePages(blocks, map) {
        for (let i = 0, len = blocks.length; i < len; i++) {
            const block = blocks[i];
            map.set(block.nodeId, block.startPage);
            if (block.children) {
                this.extractNodePages(block.children, map);
            }
        }
    }

    /**
     * Collect TOC entries from nodes
     * @param {ReadonlyArray<BaseNode>} nodes
     * @param {{ nodeId: string; level: number; title: string; page: number }[]} entries
     * @param {Map<string, number>} nodePageMap
     * @returns {void}
     */
    collectTocEntries(nodes, entries, nodePageMap) {
        for (let i = 0, len = nodes.length; i < len; i++) {
            const node = nodes[i];

            if (node.type === "heading") {
                // HeadingNode stores level as direct property, not in attrs
                const level =
                    /** @type {any} */ (node).level ?? node.attrs?.level ?? 1;
                const title = this.extractText(node);
                const page = nodePageMap.get(node.id) ?? 0;
                entries.push({ nodeId: node.id, level, title, page });
            }

            if (node.type === "article") {
                // ArticleNode stores title as direct property
                const title =
                    /** @type {any} */ (node).title ??
                    node.attrs?.title ??
                    this.extractText(node);
                const page = nodePageMap.get(node.id) ?? 0;
                entries.push({ nodeId: node.id, level: 1, title, page });
            }

            if (node.type === "section") {
                // SectionNode stores title as direct property
                const title =
                    /** @type {any} */ (node).title ??
                    node.attrs?.title ??
                    this.extractText(node);
                const page = nodePageMap.get(node.id) ?? 0;
                entries.push({ nodeId: node.id, level: 2, title, page });
            }

            if (node.children.length > 0) {
                this.collectTocEntries(node.children, entries, nodePageMap);
            }
        }
    }

    /**
     * @param {BaseNode} node
     * @returns {string}
     */
    extractText(node) {
        if (node.type === "text") {
            // Use getTextContent() if available, otherwise fall back to attrs.text
            if (typeof node.getTextContent === "function") {
                return node.getTextContent();
            }
            return /** @type {string} */ (node.attrs?.text) ?? "";
        }
        let text = "";
        for (let i = 0, len = node.children.length; i < len; i++) {
            text += this.extractText(node.children[i]);
        }
        return text;
    }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * @returns {LayoutEngine}
 */
export function createLayoutEngine() {
    return new LayoutEngine();
}
