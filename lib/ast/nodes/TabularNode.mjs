/**
 * TabularNode - Table and data-oriented content nodes
 * @module format-ast/nodes/TabularNode
 */

import { BaseNode, createText } from "./BaseNode.mjs";
import { NODE_CATEGORIES, TABULAR_NODE_TYPES } from "../constants/core.mjs";

/**
 * @typedef {import("../types/core.mjs").TabularNodeType} TabularNodeType
 * @typedef {import("../types/core.mjs").HorizontalAlign} HorizontalAlign
 * @typedef {import("../types/core.mjs").VerticalAlign} VerticalAlign
 * @typedef {import("../types/core.mjs").CellStyle} CellStyle
 * @typedef {import("../types/core.mjs").ColumnDef} ColumnDef
 * @typedef {import("../types/core.mjs").BorderStyle} BorderStyle
 * @typedef {import("../types/core.mjs").TableRenderConfig} TableRenderConfig
 * @typedef {import("./BaseNode.mjs").BaseNodeData} BaseNodeData
 */

// =============================================================================
// TabularNode Base
// =============================================================================

/**
 * Base class for tabular/data nodes
 * @extends BaseNode
 */
export class TabularNode extends BaseNode {
    /**
     * @param {TabularNodeType} type
     * @param {BaseNodeData} [data]
     */
    constructor(type, data = {}) {
        super(type, data);
        this.category = NODE_CATEGORIES.TABULAR;
    }
}

// =============================================================================
// Table
// =============================================================================

/**
 * @typedef {Object} TableData
 * @property {ColumnDef[]} [columns]
 * @property {string} [caption]
 * @property {boolean} [headerRow] - First row is header
 * @property {boolean} [header_row] - Snake_case alias
 * @property {boolean} [stripedRows]
 * @property {boolean} [striped_rows] - Snake_case alias
 * @property {BorderStyle} [borderStyle]
 * @property {BorderStyle} [border_style] - Snake_case alias
 * @property {"fixed" | "auto"} [layout]
 * @property {TableRenderConfig} [table] - Per-table render overrides
 * @property {TableRenderConfig} [table_style] - Snake_case alias
 * @property {TableRenderConfig} [tableStyle] - CamelCase alias
 */

/**
 * Table node - container for rows
 * @extends {TabularNode}
 * @property {RowNode[]} children - Base class type overloads
 * @property {BaseNodeData & TableData} attrs  - Base class type overloads
 */
export class TableNode extends TabularNode {
    /**
     * @param {BaseNodeData & TableData} [data]
     */
    constructor(data = {}) {
        super(TABULAR_NODE_TYPES.TABLE, data);

        /** @type {ColumnDef[]} */
        this.columns = data.columns || [];

        /** @type {string | undefined} */
        this.caption = data.caption;

        /** @type {boolean} */
        this.headerRow = (data.headerRow ?? data.header_row) !== false;

        /** @type {boolean} */
        this.stripedRows = (data.stripedRows ?? data.striped_rows) === true;

        /** @type {BorderStyle | undefined} */
        this.borderStyle = data.borderStyle ?? data.border_style;

        /** @type {"fixed" | "auto"} */
        this.layout = data.layout || "auto";

        /** @type {RowNode[]} */
        this.children;

        /** @type {BaseNodeData & TableData} */
        this.attrs;
    }

    /**
     * Add header row
     * @param {(string | CellData)[]} cells
     * @returns {RowNode}
     */
    addHeaderRow(cells) {
        const row = new RowNode({ isHeader: true });
        for (let i = 0, len = cells.length; i < len; i++) {
            const cell = cells[i];
            if (typeof cell === "string") {
                row.appendChild(new CellNode(cell, { isHeader: true }));
            } else {
                row.appendChild(
                    new CellNode(cell.content, { ...cell, isHeader: true })
                );
            }
        }
        this.appendChild(row);
        return row;
    }

    /**
     * Add data row
     * @param {(string | number | CellData)[]} cells
     * @returns {RowNode}
     */
    addRow(cells) {
        const row = new RowNode();
        for (let i = 0, len = cells.length; i < len; i++) {
            const cell = cells[i];
            if (typeof cell === "string" || typeof cell === "number") {
                row.appendChild(new CellNode(String(cell)));
            } else {
                row.appendChild(new CellNode(cell.content, cell));
            }
        }
        this.appendChild(row);
        return row;
    }

    /**
     * Set column definitions
     * @param {ColumnDef[]} columns
     * @returns {this}
     */
    setColumns(columns) {
        this.columns = columns;
        return this;
    }

    /**
     * Get row count
     * @returns {number}
     */
    rowCount() {
        return this.children.length;
    }

    /**
     * Get column count (from first row or columns def)
     * @returns {number}
     */
    columnCount() {
        if (this.columns.length > 0) {
            return this.columns.length;
        }
        const firstRow = this.children[0];
        if (firstRow) {
            return firstRow.children.length;
        }
        return 0;
    }

    /**
     * Get row by index
     * @param {number} index
     * @returns {RowNode | undefined}
     */
    getRow(index) {
        return /** @type {RowNode | undefined} */ (this.children[index]);
    }

    /**
     * Get cell by row/col
     * @param {number} row
     * @param {number} col
     * @returns {CellNode | undefined}
     */
    getCell(row, col) {
        const r = this.getRow(row);
        if (r) {
            return /** @type {CellNode | undefined} */ (r.children[col]);
        }
        return undefined;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        if (this.columns.length > 0) {
            obj.columns = this.columns;
        }
        if (this.caption) {
            obj.caption = this.caption;
        }
        if (!this.headerRow) {
            obj.headerRow = false;
        }
        if (this.stripedRows) {
            obj.stripedRows = true;
        }
        if (this.borderStyle) {
            obj.borderStyle = this.borderStyle;
        }
        if (this.layout !== "auto") {
            obj.layout = this.layout;
        }
        return obj;
    }
}

// =============================================================================
// Row
// =============================================================================

/**
 * @typedef {Object} RowData
 * @property {boolean} [isHeader]
 * @property {number} [height]
 * @property {string | number} [backgroundColor]
 * @property {string | number} [background_color] - Snake_case alias
 */

/**
 * Row node - container for cells
 * @extends {TabularNode}
 * @property {CellNode[]} children - Base class type overloads
 * @property {BaseNodeData & RowData} attrs  - Base class type overloads
 */
export class RowNode extends TabularNode {
    /**
     * @param {BaseNodeData & RowData} [data]
     */
    constructor(data = {}) {
        super(
            data.isHeader
                ? TABULAR_NODE_TYPES.HEADER_ROW
                : TABULAR_NODE_TYPES.ROW,
            data
        );

        /** @type {boolean} */
        this.isHeader = data.isHeader || false;

        /** @type {number | undefined} */
        this.height = data.height;

        /** @type {string | number | undefined} */
        this.backgroundColor = data.backgroundColor ?? data.background_color;

        /** @type {CellNode[]} */
        this.children;

        /** @type {BaseNodeData & RowData} */
        this.attrs;
    }

    /**
     * Add cell
     * @param {string | number | BaseNode[]} content
     * @param {CellData} [data]
     * @returns {CellNode}
     */
    addCell(content, data) {
        const cell = new CellNode(
            typeof content === "number" ? String(content) : content,
            { ...data, isHeader: this.isHeader }
        );
        this.appendChild(cell);
        return cell;
    }

    /**
     * Get cell by index
     * @param {number} index
     * @returns {CellNode | undefined}
     */
    getCell(index) {
        return /** @type {CellNode | undefined} */ (this.children[index]);
    }

    /**
     * Cell count
     * @returns {number}
     */
    cellCount() {
        return this.children.length;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        if (this.isHeader) {
            obj.isHeader = true;
        }
        if (this.height !== undefined) {
            obj.height = this.height;
        }
        if (this.backgroundColor) {
            obj.backgroundColor = this.backgroundColor;
        }
        return obj;
    }
}

// =============================================================================
// Cell
// =============================================================================

/**
 * @typedef {Object} CellData
 * @property {string | BaseNode[]} [content]
 * @property {boolean} [isHeader]
 * @property {number} [colspan]
 * @property {number} [rowspan]
 * @property {HorizontalAlign} [align]
 * @property {VerticalAlign} [verticalAlign]
 * @property {boolean} [wrap]
 * @property {string} [numberFormat]
 * @property {string} [formula] - For spreadsheet renderers
 * @property {CellStyle} [style]
 */

/**
 * Cell node - contains content or value
 * @extends {TabularNode}
 * @property {BaseNodeData & CellData} attrs  - Base class type overloads
 */
export class CellNode extends TabularNode {
    /**
     * @param {string | BaseNode[]} content
     * @param {BaseNodeData & CellData} [data]
     */
    constructor(content, data = {}) {
        super(
            data.isHeader
                ? TABULAR_NODE_TYPES.HEADER_CELL
                : TABULAR_NODE_TYPES.CELL,
            data
        );

        /** @type {boolean} */
        this.isHeader = data.isHeader || false;

        /** @type {number} */
        this.colspan = data.colspan || 1;

        /** @type {number} */
        this.rowspan = data.rowspan || 1;

        /** @type {HorizontalAlign | undefined} */
        this.align = data.align;

        /** @type {VerticalAlign | undefined} */
        this.verticalAlign = data.verticalAlign;

        /** @type {boolean} */
        this.wrap = data.wrap !== false;

        /** @type {string | undefined} */
        this.numberFormat = data.numberFormat;

        /** @type {string | undefined} */
        this.formula = data.formula;

        /** @type {CellStyle | undefined} */
        this.style = data.style;

        if (typeof content === "string") {
            this.appendChild(createText(content));
        } else {
            this.appendChildren(content);
        }

        /** @type {BaseNodeData & CellData} */
        this.attrs;
    }

    /**
     * Get raw value (first text content)
     * @returns {string}
     */
    getValue() {
        let text = "";
        for (let i = 0, len = this.children.length; i < len; i++) {
            text += this.children[i].getTextContent();
        }
        return text;
    }

    /**
     * Set value
     * @param {string} value
     * @returns {this}
     */
    setValue(value) {
        this.clearChildren();
        this.appendChild(createText(value));
        return this;
    }

    /**
     * Set formula (for spreadsheet renderers)
     * @param {string} formula
     * @returns {this}
     */
    setFormula(formula) {
        this.formula = formula;
        return this;
    }

    /** @override */
    getTextContent() {
        return this.getValue();
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        if (this.isHeader) {
            obj.isHeader = true;
        }
        if (this.colspan !== 1) {
            obj.colspan = this.colspan;
        }
        if (this.rowspan !== 1) {
            obj.rowspan = this.rowspan;
        }
        if (this.align) {
            obj.align = this.align;
        }
        if (this.verticalAlign) {
            obj.verticalAlign = this.verticalAlign;
        }
        if (!this.wrap) {
            obj.wrap = false;
        }
        if (this.numberFormat) {
            obj.numberFormat = this.numberFormat;
        }
        if (this.formula) {
            obj.formula = this.formula;
        }
        if (this.style) {
            obj.style = this.style;
        }
        return obj;
    }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create table
 * @param {BaseNodeData & TableData} [data]
 * @returns {TableNode}
 */
export function createTable(data) {
    return new TableNode(data);
}

/**
 * Create row
 * @param {BaseNodeData & RowData} [data]
 * @returns {RowNode}
 */
export function createRow(data) {
    return new RowNode(data);
}

/**
 * Create header row
 * @param {BaseNodeData & RowData} [data]
 * @returns {RowNode}
 */
export function createHeaderRow(data) {
    return new RowNode({ ...data, isHeader: true });
}

/**
 * Create cell
 * @param {string | BaseNode[]} content
 * @param {BaseNodeData & CellData} [data]
 * @returns {CellNode}
 */
export function createCell(content, data) {
    return new CellNode(content, data);
}

/**
 * Create header cell
 * @param {string | BaseNode[]} content
 * @param {BaseNodeData & CellData} [data]
 * @returns {CellNode}
 */
export function createHeaderCell(content, data) {
    return new CellNode(content, { ...data, isHeader: true });
}

/**
 * Create table from 2D array of data
 * @param {(string | number)[][]} data
 * @param {{ headers?: boolean, columns?: ColumnDef[] }} [options]
 * @returns {TableNode}
 */
export function createTableFromData(data, options = {}) {
    const table = new TableNode({
        columns: options.columns,
        headerRow: options.headers !== false
    });

    for (let i = 0, len = data.length; i < len; i++) {
        const rowData = data[i];
        const isHeader = options.headers !== false && i === 0;
        const row = new RowNode({ isHeader });

        for (let j = 0, jlen = rowData.length; j < jlen; j++) {
            const val = rowData[j];
            row.appendChild(new CellNode(String(val), { isHeader }));
        }

        table.appendChild(row);
    }

    return table;
}

/**
 * Create table from array of objects
 * @template {Record<string, unknown>} T
 * @param {T[]} data
 * @param {{ columns?: (keyof T)[], headers?: Record<keyof T, string> }} [options]
 * @returns {TableNode}
 */
export function createTableFromObjects(data, options = {}) {
    if (data.length === 0) {
        return new TableNode();
    }

    const columns =
        options.columns || /** @type {(keyof T)[]} */ (Object.keys(data[0]));
    const table = new TableNode({ headerRow: true });

    // Header row
    const headerRow = new RowNode({ isHeader: true });
    for (let i = 0, len = columns.length; i < len; i++) {
        const col = columns[i];
        const header = options.headers?.[col] || String(col);
        headerRow.appendChild(new CellNode(header, { isHeader: true }));
    }
    table.appendChild(headerRow);

    // Data rows
    for (let i = 0, len = data.length; i < len; i++) {
        const item = data[i];
        const row = new RowNode();
        for (let j = 0, jlen = columns.length; j < jlen; j++) {
            const col = columns[j];
            const val = item[col];
            row.appendChild(new CellNode(val == null ? "" : String(val)));
        }
        table.appendChild(row);
    }

    return table;
}
