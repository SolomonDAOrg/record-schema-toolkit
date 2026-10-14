import {
    tableFontSize,
    tableLineHeight
} from "../../layout/table-typography.mjs";
import { calculateTableColumnWidths } from "../../layout/table-columns.mjs";
import { plainText } from "./inline.mjs";
import { measureText } from "./measurements.mjs";
import { paragraph, textRun } from "../../../docx/styles.mjs";
import { color, twips } from "../../../docx/xml.mjs";
import { deepSnakeToCamel } from "../../../util/objects.mjs";

/** @typedef {import("./content.mjs").DocxContentRenderer} DocxContentRenderer */
/** @typedef {import("../../nodes/TabularNode.mjs").TableNode} TableNode */
/** @typedef {import("../../../docx/styles.mjs").RunStyle} RunStyle */

/** @param {import("../../types/core.mjs").TableRenderConfig} configuration @param {boolean} header @param {number} fallback @returns {{top: number, right: number, bottom: number, left: number}} */
function cellPadding(configuration, header, fallback) {
    const padding =
        (header ? configuration.header?.cellPadding : undefined) ??
        configuration.cellPadding ??
        fallback;
    const sides =
        typeof padding === "number"
            ? { top: padding, right: padding, bottom: padding, left: padding }
            : padding;
    return {
        top: sides.top ?? sides.y ?? fallback,
        right: sides.right ?? sides.x ?? fallback,
        bottom: sides.bottom ?? sides.y ?? fallback,
        left: sides.left ?? sides.x ?? fallback
    };
}

/** @param {DocxContentRenderer} renderer @param {TableNode} table @param {RunStyle} style @returns {string} */
export function renderTable(renderer, table, style) {
    const configuration = {
        ...renderer.configuration.table,
        .../** @type {import("../../types/core.mjs").TableRenderConfig} */ (
            deepSnakeToCamel(
                table.attrs.table ??
                    table.attrs.tableStyle ??
                    table.attrs.table_style ??
                    {}
            )
        )
    };
    const columns = table.columns.length
        ? table.columns
        : table.attrs.columns ?? [];
    const count = Math.max(
        columns.length,
        ...table.children.map((row) =>
            row.children.reduce((sum, cell) => sum + (cell.colspan ?? 1), 0)
        ),
        1
    );
    const fontSize = tableFontSize(
        configuration,
        style.fontSize,
        renderer.width / count
    );
    const defaultPadding = Math.max(2, (4 * fontSize) / style.fontSize);
    const widths = calculateTableColumnWidths(columns, renderer.width, count, {
        fontSize,
        measureColumn: (index) => {
            let maximum = 0;
            for (const row of table.children) {
                let columnIndex = 0;
                for (const cell of row.children) {
                    const span = cell.colspan ?? 1;
                    if (columnIndex === index && span === 1) {
                        const header =
                            row.isHeader || row.type === "header-row";
                        const padding = cellPadding(
                            configuration,
                            header,
                            defaultPadding
                        );
                        maximum = Math.max(
                            maximum,
                            measureText(renderer, plainText(cell), {
                                ...style,
                                fontSize,
                                bold: header,
                                ...cell.textStyle,
                                ...cell.style?.text
                            }) +
                                padding.left +
                                padding.right +
                                (configuration.borderWidth ?? 0.5)
                        );
                    }
                    columnIndex += span;
                }
            }
            return Math.ceil(maximum * 1000 + 1) / 1000;
        }
    });
    const borders = ["top", "left", "bottom", "right", "insideH", "insideV"]
        .map(
            (edge) =>
                "<w:" +
                edge +
                ' w:val="' +
                (configuration.borderColor === "none" ||
                configuration.borderWidth === 0
                    ? "nil"
                    : "single") +
                '" w:sz="' +
                Math.max(
                    2,
                    Math.round(
                        (configuration.borderWidth ??
                            table.borderStyle?.width ??
                            0.5) * 8
                    )
                ) +
                '" w:color="' +
                color(configuration.borderColor ?? table.borderStyle?.color) +
                '"/>'
        )
        .join("");
    let xml =
        '<w:tbl><w:tblPr><w:tblW w:w="' +
        twips(widths.reduce((sum, width) => sum + width, 0)) +
        '" w:type="dxa"/><w:tblBorders>' +
        borders +
        '</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>' +
        widths
            .map((width) => '<w:gridCol w:w="' + twips(width) + '"/>')
            .join("") +
        "</w:tblGrid>";
    /** @type {Map<number, {remaining: number, span: number}>} */
    const merges = new Map();
    const inheritedWidth = renderer.width;
    for (let rowIndex = 0; rowIndex < table.children.length; rowIndex++) {
        const row = table.children[rowIndex];
        const header = row.isHeader || row.type === "header-row";
        xml +=
            "<w:tr><w:trPr>" +
            (header ? "<w:tblHeader/>" : "") +
            (row.height
                ? '<w:trHeight w:val="' +
                  twips(row.height) +
                  '" w:hRule="atLeast"/>'
                : "") +
            "</w:trPr>";
        let columnIndex = 0;
        let cellIndex = 0;
        while (columnIndex < count) {
            const merge = merges.get(columnIndex);
            if (merge) {
                xml +=
                    '<w:tc><w:tcPr><w:gridSpan w:val="' +
                    merge.span +
                    '"/><w:vMerge/></w:tcPr><w:p/></w:tc>';
                if (--merge.remaining === 0) merges.delete(columnIndex);
                columnIndex += merge.span;
                continue;
            }
            const cell = row.children[cellIndex++];
            if (!cell) {
                xml += "<w:tc><w:p/></w:tc>";
                columnIndex++;
                continue;
            }
            const span = cell.colspan ?? 1;
            if (
                !Number.isInteger(span) ||
                span < 1 ||
                columnIndex + span > count
            )
                throw new Error("Invalid DOCX table colspan");
            for (let index = columnIndex; index < columnIndex + span; index++)
                if (merges.has(index))
                    throw new Error("Overlapping DOCX table cells");
            const rowspan = cell.rowspan ?? 1;
            if (
                !Number.isInteger(rowspan) ||
                rowspan < 1 ||
                rowIndex + rowspan > table.children.length
            )
                throw new Error("Invalid DOCX table rowspan");
            if (rowspan > 1)
                merges.set(columnIndex, { remaining: rowspan - 1, span });
            const width = widths
                .slice(columnIndex, columnIndex + span)
                .reduce((sum, value) => sum + value, 0);
            const sides = cellPadding(configuration, header, defaultPadding);
            renderer.width = Math.max(1, width - sides.left - sides.right);
            const background =
                cell.style?.backgroundColor ??
                row.backgroundColor ??
                (header
                    ? configuration.header?.backgroundColor ?? "#eeeeee"
                    : configuration.zebra?.enabled || table.stripedRows
                    ? rowIndex % 2
                        ? configuration.zebra?.oddBackground
                        : configuration.zebra?.evenBackground
                    : undefined);
            const textStyle = renderer.style({
                ...style,
                fontSize,
                bold: header,
                ...cell.textStyle,
                ...cell.style?.text,
                color:
                    cell.style?.textColor ??
                    (header ? configuration.header?.textColor : undefined) ??
                    style.color,
                align:
                    cell.align ??
                    cell.style?.align ??
                    columns[columnIndex]?.align ??
                    "left",
                lineHeight: tableLineHeight(configuration, style.lineHeight)
            });
            const body = renderer.blocks(cell.children, textStyle);
            xml +=
                '<w:tc><w:tcPr><w:tcW w:w="' +
                twips(width) +
                '" w:type="dxa"/>' +
                (span > 1 ? '<w:gridSpan w:val="' + span + '"/>' : "") +
                (rowspan > 1 ? '<w:vMerge w:val="restart"/>' : "") +
                (background !== undefined
                    ? '<w:shd w:val="clear" w:fill="' +
                      color(background) +
                      '"/>'
                    : "") +
                "<w:tcMar>" +
                Object.entries(sides)
                    .map(
                        ([side, size]) =>
                            "<w:" +
                            side +
                            ' w:w="' +
                            twips(size) +
                            '" w:type="dxa"/>'
                    )
                    .join("") +
                "</w:tcMar>" +
                '<w:vAlign w:val="' +
                ((cell.verticalAlign ?? configuration.verticalAlign) ===
                "middle"
                    ? "center"
                    : cell.verticalAlign ??
                      configuration.verticalAlign ??
                      "top") +
                '"/></w:tcPr>' +
                body +
                (!body || body.endsWith("</w:tbl>") ? "<w:p/>" : "") +
                "</w:tc>";
            columnIndex += span;
        }
        if (cellIndex < row.children.length)
            throw new Error("DOCX table row exceeds declared grid");
        xml += "</w:tr>";
    }
    renderer.width = inheritedWidth;
    return (
        (table.caption
            ? paragraph(
                  textRun(table.caption, { ...style, bold: true }),
                  style,
                  { keepNext: true }
              )
            : "") +
        xml +
        "</w:tbl>"
    );
}
