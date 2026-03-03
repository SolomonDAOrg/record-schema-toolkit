/**
 * CsvRenderer - Renders tabular data to CSV
 * @module format-ast/renderers/CsvRenderer
 */

import { BaseRenderer, NodeHandlerRegistry } from "./BaseRenderer.mjs";
import { TABULAR_NODE_TYPES } from "../constants/core.mjs";

/**
 * @typedef {import("../types/core.mjs").RenderCapabilities} RenderCapabilities
 * @typedef {import("../documents/BaseDocument.mjs").BaseDocument} BaseDocument
 * @typedef {import("./BaseRenderer.mjs").RenderResult} RenderResult
 * @typedef {import("./BaseRenderer.mjs").RenderOptions} RenderOptions
 */

/**
 * @typedef {Object} CsvOptions
 * @property {string} [delimiter] - Field delimiter (default: ",")
 * @property {string} [lineEnding] - Line ending (default: "\r\n")
 * @property {boolean} [quoteAll] - Quote all fields
 * @property {boolean} [includeHeaders] - Include header row
 */

/**
 * CSV Renderer - extracts tabular data and outputs CSV
 */
export class CsvRenderer extends BaseRenderer {
    /**
     * @param {CsvOptions} [options]
     */
    constructor(options = {}) {
        super();

        /** @type {string} */
        this.delimiter = options.delimiter || ",";

        /** @type {string} */
        this.lineEnding = options.lineEnding || "\r\n";

        /** @type {boolean} */
        this.quoteAll = options.quoteAll || false;

        /** @type {boolean} */
        this.includeHeaders = options.includeHeaders !== false;
    }

    /** @override */
    getName() {
        return "csv";
    }

    /** @override */
    getMimeType() {
        return "text/csv";
    }

    /** @override */
    getExtension() {
        return "csv";
    }

    /** @override */
    getCapabilities() {
        return {
            supportsInlineFormatting: false,
            supportsTables: true,
            supportsImages: false,
            supportsHeadersFooters: false,
            supportsPageBreaks: false,
            supportsFormulas: false,
            supportsMultipleSheets: false,
            supportsHyperlinks: false,
            supportsColors: false,
            supportsBorders: false,
            supportedNodeTypes: [
                TABULAR_NODE_TYPES.TABLE,
                TABULAR_NODE_TYPES.ROW,
                TABULAR_NODE_TYPES.HEADER_ROW,
                TABULAR_NODE_TYPES.CELL,
                TABULAR_NODE_TYPES.HEADER_CELL
            ]
        };
    }

    /**
     * @override
     * @param {BaseDocument} document
     * @param {RenderOptions} [options]
     * @returns {RenderResult}
     */
    render(document, options = {}) {
        this.clearMessages();

        try {
            // Find all tables in document
            const tables = document.findByType(TABULAR_NODE_TYPES.TABLE);

            if (tables.length === 0) {
                this.addWarning("No tables found in document");
                return this.successResult("", options.filename);
            }

            if (tables.length > 1) {
                this.addWarning(
                    `Found ${tables.length} tables, only first will be exported`
                );
            }

            const table = tables[0];
            const rows = this._extractRows(table);
            const csv = this._rowsToCsv(rows);

            return this.successResult(csv, options.filename);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return this.failureResult(message);
        }
    }

    /**
     * Extract row data from table node
     * @private
     * @param {import("../nodes/BaseNode.mjs").BaseNode} table
     * @returns {string[][]}
     */
    _extractRows(table) {
        /** @type {string[][]} */
        const rows = [];

        for (let i = 0, len = table.children.length; i < len; i++) {
            const row = table.children[i];
            const isHeader =
                row.type === TABULAR_NODE_TYPES.HEADER_ROW ||
                row.getAttr("isHeader", false);

            // Skip header if not included
            if (isHeader && !this.includeHeaders) {
                continue;
            }

            /** @type {string[]} */
            const cells = [];
            for (let j = 0, jlen = row.children.length; j < jlen; j++) {
                const cell = row.children[j];
                cells.push(cell.getTextContent());
            }
            rows.push(cells);
        }

        return rows;
    }

    /**
     * Convert rows to CSV string
     * @private
     * @param {string[][]} rows
     * @returns {string}
     */
    _rowsToCsv(rows) {
        /** @type {string[]} */
        const lines = [];

        for (let i = 0, len = rows.length; i < len; i++) {
            const row = rows[i];
            /** @type {string[]} */
            const escapedCells = [];

            for (let j = 0, jlen = row.length; j < jlen; j++) {
                escapedCells.push(this._escapeCell(row[j]));
            }

            lines.push(escapedCells.join(this.delimiter));
        }

        return lines.join(this.lineEnding);
    }

    /**
     * Escape cell value for CSV
     * @private
     * @param {string} value
     * @returns {string}
     */
    _escapeCell(value) {
        const needsQuotes =
            this.quoteAll ||
            value.includes(this.delimiter) ||
            value.includes('"') ||
            value.includes("\n") ||
            value.includes("\r");

        if (!needsQuotes) {
            return value;
        }

        // Escape quotes by doubling them
        const escaped = value.replace(/"/g, '""');
        return `"${escaped}"`;
    }
}

/**
 * Create CSV renderer
 * @param {CsvOptions} [options]
 * @returns {CsvRenderer}
 */
export function createCsvRenderer(options) {
    return new CsvRenderer(options);
}
