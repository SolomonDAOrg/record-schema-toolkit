import { parseDelimitedRecords } from "../parsing/delimited.mjs";
import { parseMarkdownDoc } from "../parsing/markdown.mjs";
import { parseYaml } from "../parsing/yaml.mjs";
import { isObject } from "../util/objects.mjs";

/** @typedef {import("../parsing/markdown.mjs").MarkdownNode} MarkdownNode */
/**
 * @typedef {Object} DataTableColumnBase
 * @property {string} header
 * @property {"left" | "center" | "right"} align
 * @property {"auto" | "max-content" | "max-content-padded"} width
 * @property {boolean} [nullable]
 */

/** @typedef {DataTableColumnBase & { type: "text" }} DataTableTextColumn */
/** @typedef {DataTableColumnBase & { type: "date"; format: "YYYY-MM-DD" | "DD MMM YYYY" }} DataTableDateColumn */
/** @typedef {DataTableColumnBase & { type: "decimal"; decimal_places: number; rounding: "half-up" | "reject"; grouping?: boolean }} DataTableDecimalColumn */
/** @typedef {DataTableTextColumn | DataTableDateColumn | DataTableDecimalColumn} DataTableColumn */
/** @typedef {{ columns: DataTableColumn[]; striped_rows?: boolean }} DataTableDefinition */
/** @typedef {{ definition: DataTableDefinition, headers: string[], rows: string[][] }} ParsedDataTable */
/** @typedef {{ path: string, record: number }} DataTableValueLocation */

export class DataTable {
    /**
     * @param {string} relativePath
     * @param {string} definitionSource
     * @param {Uint8Array} sourceBytes
     * @returns {ParsedDataTable}
     */
    static parse(relativePath, definitionSource, sourceBytes) {
        const definition = DataTable.parseDefinition(definitionSource);
        const extension = /\.(csv|tsv)$/i.exec(relativePath)?.[1].toLowerCase();
        if (!extension)
            throw new Error(
                "A data-table source must name a .csv or .tsv file."
            );
        const records = parseDelimitedRecords(
            new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes),
            extension === "csv" ? "," : "\t"
        );
        const headers = records[0];
        if (
            !headers ||
            headers.length !== definition.columns.length ||
            headers.some(
                (header, index) => header !== definition.columns[index].header
            )
        ) {
            throw new Error(
                `Data-table headings must exactly match the declared columns in order: ${relativePath}.`
            );
        }
        const rows = records.slice(1).map((record, index) => {
            if (record.length !== headers.length)
                throw new Error(
                    `Data-table record ${
                        index + 2
                    } has an incorrect field count: ${relativePath}.`
                );
            return record.map((value, columnIndex) =>
                DataTable.formatValue(value, definition.columns[columnIndex], {
                    path: relativePath,
                    record: index + 2
                })
            );
        });
        return { definition, headers, rows };
    }

    /** @param {string} source @returns {DataTableDefinition} */
    static parseDefinition(source) {
        const value = parseYaml(source);
        if (
            !isObject(value) ||
            Object.keys(value).some(
                (key) => !["columns", "striped_rows"].includes(key)
            ) ||
            !Array.isArray(value.columns) ||
            value.columns.length === 0 ||
            (value.striped_rows !== undefined &&
                value.striped_rows !== true &&
                value.striped_rows !== false)
        ) {
            throw new Error(
                "data-table requires columns and an optional boolean striped_rows."
            );
        }
        const headers = new Set();
        for (const column of value.columns) {
            if (
                !isObject(column) ||
                typeof column.header !== "string" ||
                !column.header.trim() ||
                !["text", "date", "decimal"].includes(column.type) ||
                !["left", "center", "right"].includes(column.align) ||
                !["auto", "max-content", "max-content-padded"].includes(
                    column.width
                ) ||
                (column.nullable !== undefined &&
                    column.nullable !== true &&
                    column.nullable !== false)
            ) {
                throw new Error(
                    "Each data-table column requires header, type, align and width."
                );
            }
            const allowed = ["header", "type", "align", "width", "nullable"];
            if (column.type === "date") {
                allowed.push("format");
                if (!["YYYY-MM-DD", "DD MMM YYYY"].includes(column.format))
                    throw new Error(
                        "A date column requires an explicit date format."
                    );
            }
            if (column.type === "decimal") {
                allowed.push("decimal_places", "rounding", "grouping");
                if (
                    !Number.isInteger(column.decimal_places) ||
                    column.decimal_places < 0 ||
                    column.decimal_places > 18 ||
                    !["half-up", "reject"].includes(column.rounding) ||
                    (column.grouping !== undefined &&
                        column.grouping !== true &&
                        column.grouping !== false)
                ) {
                    throw new Error(
                        "A decimal column requires decimal_places from 0 to 18 and explicit rounding."
                    );
                }
            }
            if (Object.keys(column).some((key) => !allowed.includes(key)))
                throw new Error(
                    `Undeclared data-table column property for ${column.header}.`
                );
            if (headers.has(column.header))
                throw new Error(
                    `Duplicate data-table column: ${column.header}.`
                );
            headers.add(column.header);
        }
        if (!value.columns.some((column) => column.width === "auto"))
            throw new Error(
                "A data-table requires at least one auto-width column."
            );
        return /** @type {DataTableDefinition} */ (value);
    }

    /**
     * @param {string} value
     * @param {DataTableColumn} column
     * @param {DataTableValueLocation} [location]
     * @returns {string}
     */
    static formatValue(value, column, location) {
        const prefix = location
            ? `${location.path}: record ${location.record}, ${column.header}: `
            : "";
        if (value === "" && column.nullable) return "";
        if (column.type === "text") {
            if (!value && !column.nullable)
                throw new Error(`${prefix}Required text is empty.`);
            return value;
        }
        if (column.type === "date") {
            const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
            if (!match)
                throw new Error(`${prefix}Expected a date in YYYY-MM-DD form.`);
            const year = Number(match[1]);
            const month = Number(match[2]);
            const day = Number(match[3]);
            const date = new Date(0);
            date.setUTCFullYear(year, month - 1, day);
            if (
                year === 0 ||
                date.getUTCFullYear() !== year ||
                date.getUTCMonth() !== month - 1 ||
                date.getUTCDate() !== day
            )
                throw new Error(`${prefix}Invalid calendar date: ${value}.`);
            return column.format === "YYYY-MM-DD"
                ? value
                : `${match[3]} ${date.toLocaleString("en-US", {
                      month: "short",
                      timeZone: "UTC",
                      calendar: "gregory"
                  })} ${match[1]}`;
        }
        const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
        if (!match)
            throw new Error(`${prefix}Expected an ungrouped decimal amount.`);
        const fraction = match[3] ?? "";
        const discarded = fraction.slice(column.decimal_places);
        if (column.rounding === "reject" && /[1-9]/.test(discarded))
            throw new Error(
                `${prefix}Amount exceeds the declared decimal precision.`
            );
        let units = BigInt(
            match[2] +
                fraction
                    .slice(0, column.decimal_places)
                    .padEnd(column.decimal_places, "0")
        );
        if (column.rounding === "half-up" && discarded && discarded[0] >= "5")
            units++;
        const digits = units
            .toString()
            .padStart(column.decimal_places + 1, "0");
        let integer = column.decimal_places
            ? digits.slice(0, -column.decimal_places)
            : digits;
        if (column.grouping)
            integer = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        return (
            (match[1] && units !== 0n ? "-" : "") +
            integer +
            (column.decimal_places
                ? `.${digits.slice(-column.decimal_places)}`
                : "")
        );
    }

    /**
     * @param {{ text: string, loadResource(relativePath: string): Uint8Array }} document
     * @returns {void}
     */
    static validateMarkdown(document) {
        /** @param {MarkdownNode[]} nodes */
        const visit = (nodes) => {
            for (const node of nodes) {
                if (
                    node.type === "directive" &&
                    node.attrs?.name === "data-table"
                ) {
                    const relativePath = String(node.attrs.title ?? "").trim();
                    DataTable.parse(
                        relativePath,
                        node.content,
                        document.loadResource(relativePath)
                    );
                } else visit(node.children);
            }
        };
        visit(parseMarkdownDoc(document.text).nodes);
    }

    /** @param {string} text @returns {string} */
    static excludeMarkdownDefinitions(text) {
        /** @param {MarkdownNode[]} nodes @returns {string[]} */
        const contents = (nodes) =>
            nodes.flatMap((node) => {
                if (node.type === "directive")
                    return node.attrs?.name === "data-table"
                        ? []
                        : [
                              String(node.attrs?.title ?? ""),
                              ...contents(node.children)
                          ];
                return node.content ? [node.content] : contents(node.children);
            });
        return contents(parseMarkdownDoc(text).nodes).join("\n");
    }
}
