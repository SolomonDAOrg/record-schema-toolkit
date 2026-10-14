import { paragraph, textRun } from "../../../docx/styles.mjs";
import { color, twips } from "../../../docx/xml.mjs";
import { FormFieldNode } from "../../nodes/BaseNode.mjs";
import { measureText } from "./measurements.mjs";

/** @typedef {import("./content.mjs").DocxContentRenderer} DocxContentRenderer */
/** @typedef {import("../../../docx/styles.mjs").RunStyle} RunStyle */
/** @typedef {import("../types/document.mjs").SigningPartySignatory & Pick<import("../../nodes/LegalNode.mjs").SignatoryData, "organization">} SignatureSignatory */
/** @typedef {Omit<import("../../nodes/LegalNode.mjs").SignatureBlockData, "signatories"> & {fieldName?: string, signatories?: SignatureSignatory[]}} SignatureData */
/** @typedef {{attrs: SignatureData, children?: SignatureSource[], signatories?: SignatureData["signatories"], dated?: boolean, witnessLabel?: string}} SignatureSource */
/** @typedef {{width: number, span?: number, background?: string | number, padding?: {top: number, right: number, bottom: number, left: number}, vertical?: "top" | "center" | "bottom"}} SignatureCell */

/** @param {string} label @returns {boolean} */
function signatureField(label) {
    return ["signature", "sign", "by"].includes(
        label.toLowerCase().replace(/[^a-z0-9]+/g, "")
    );
}

/** @param {string} body @param {SignatureCell} cell @returns {string} */
function cellXml(body, cell) {
    return (
        '<w:tc><w:tcPr><w:tcW w:w="' +
        twips(cell.width) +
        '" w:type="dxa"/>' +
        (cell.span ? '<w:gridSpan w:val="' + cell.span + '"/>' : "") +
        (cell.background !== undefined && cell.background !== "none"
            ? '<w:shd w:val="clear" w:fill="' + color(cell.background) + '"/>'
            : "") +
        "<w:tcMar>" +
        Object.entries(cell.padding ?? { top: 0, right: 0, bottom: 0, left: 0 })
            .map(
                ([edge, width]) =>
                    "<w:" + edge + ' w:w="' + twips(width) + '" w:type="dxa"/>'
            )
            .join("") +
        '</w:tcMar><w:vAlign w:val="' +
        (cell.vertical ?? "bottom") +
        '"/></w:tcPr>' +
        body +
        (body.endsWith("</w:tbl>")
            ? paragraph("", { fontSize: 1, lineHeight: 1 })
            : "") +
        "</w:tc>"
    );
}

/** @param {string} cells @param {number} [height] @returns {string} */
function rowXml(cells, height) {
    return (
        "<w:tr><w:trPr><w:cantSplit/>" +
        (height
            ? '<w:trHeight w:val="' + twips(height) + '" w:hRule="atLeast"/>'
            : "") +
        "</w:trPr>" +
        cells +
        "</w:tr>"
    );
}

/** @param {number[]} widths @param {string} rows @param {{borderWidth?: number, borderColor?: string | number, backgroundColor?: string | number, separatorWidth?: number, separatorColor?: string}} [style] @returns {string} */
function tableXml(widths, rows, style = {}) {
    const borders = ["top", "left", "bottom", "right", "insideH", "insideV"]
        .map((edge) => {
            const separator = edge === "insideV";
            const width = separator
                ? style.separatorWidth ?? 0
                : edge === "insideH"
                ? 0
                : style.borderWidth ?? 0;
            return (
                "<w:" +
                edge +
                ' w:val="' +
                (width ? "single" : "nil") +
                '" w:sz="' +
                Math.max(2, Math.round(width * 8)) +
                '" w:color="' +
                color(separator ? style.separatorColor : style.borderColor) +
                '"/>'
            );
        })
        .join("");
    return (
        '<w:tbl><w:tblPr><w:tblW w:w="' +
        twips(widths.reduce((sum, width) => sum + width, 0)) +
        '" w:type="dxa"/><w:tblBorders>' +
        borders +
        "</w:tblBorders>" +
        (style.backgroundColor !== undefined && style.backgroundColor !== "none"
            ? '<w:shd w:val="clear" w:fill="' +
              color(style.backgroundColor) +
              '"/>'
            : "") +
        '<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>' +
        widths
            .map((width) => '<w:gridCol w:w="' + twips(width) + '"/>')
            .join("") +
        "</w:tblGrid>" +
        rows +
        "</w:tbl>"
    );
}

/** @param {DocxContentRenderer} renderer @param {SignatureSource} node @param {RunStyle} inherited @returns {string} */
export function renderSignatureBlock(renderer, node, inherited) {
    const data = node.attrs;
    const variant = data.variant ?? "panel";
    const configuration = {
        ...(variant === "panel"
            ? renderer.configuration.signatureBlockStyle
            : {}),
        ...renderer.configuration.directiveStyles?.["signature-block"],
        ...renderer.configuration.directiveStyles?.[variant]
    };
    const width = renderer.width;
    if (variant === "split") {
        if (
            node.children?.length !== 2 ||
            node.children.some((child) => child.attrs.variant !== "single")
        )
            throw new Error("Split signature-block requires two single blocks");
        const gap = configuration.columnGap ?? 40;
        const columnWidth = (width - gap) / 2;
        if (gap < 0 || columnWidth < 120)
            throw new Error("Split signature-block columns are too narrow");
        const cells = [];
        try {
            renderer.width = columnWidth;
            for (const [index, child] of node.children.entries())
                cells.push(
                    cellXml(renderSignatureBlock(renderer, child, inherited), {
                        width: width / 2,
                        vertical: "top",
                        padding: {
                            top: 0,
                            bottom: 0,
                            left: index ? gap / 2 : 0,
                            right: index ? 0 : gap / 2
                        }
                    })
                );
        } finally {
            renderer.width = width;
        }
        return tableXml([width / 2, width / 2], rowXml(cells.join("")), {
            separatorWidth: configuration.separatorWidth ?? 0.6,
            separatorColor: configuration.separatorColor ?? "#D3DCE2"
        });
    }
    if (variant !== "single" && variant !== "panel")
        throw new Error("Unsupported DOCX signature variant: " + variant);
    const single = variant === "single";
    const style = renderer.style({
        ...inherited,
        fontSize: configuration.fontSize ?? inherited.fontSize,
        lineHeight: 1.3
    });
    /** @type {number | import("../../types/core.mjs").BoxPadding} */
    const padding = configuration.padding ?? (single ? 0 : 12);
    const sides =
        typeof padding === "number"
            ? { top: padding, right: padding, bottom: padding, left: padding }
            : {
                  top: padding.top ?? padding.y ?? 0,
                  right: padding.right ?? padding.x ?? 0,
                  bottom: padding.bottom ?? padding.y ?? 0,
                  left: padding.left ?? padding.x ?? 0
              };
    const title = data.partyLabel ?? data.title;
    const fields =
        data.fields ??
        ((node.dated ?? data.dated) === false
            ? ["Signature", "Name", "Title"]
            : ["Signature", "Name", "Title", "Date"]);
    /** @type {SignatureSignatory[]} */
    const signatories = node.signatories?.length
        ? node.signatories
        : data.signatories?.length
        ? data.signatories
        : [{ values: data.values ?? {} }];
    let output = "";
    for (const signatory of signatories) {
        const standard = new Map([
            ["signature", signatory.signature],
            ["name", signatory.name],
            ["title", signatory.title],
            ["date", signatory.date]
        ]);
        const values = Object.fromEntries(
            fields.map((label) => [
                label,
                signatory.values?.[label] ??
                    data.values?.[label] ??
                    standard.get(label.toLowerCase()) ??
                    ""
            ])
        );
        const labeled = fields.filter(
            (label) =>
                !single ||
                (!signatureField(label) &&
                    !(
                        /^(name|name and capacity)$/i.test(label) &&
                        values[label]
                    ))
        );
        const labelWidth =
            configuration.fieldLabelWidth ??
            (single
                ? Math.max(
                      0,
                      ...labeled.map((label) =>
                          measureText(renderer, label + ":", style)
                      )
                  ) +
                  style.fontSize * 0.75
                : 78);
        if (labelWidth + sides.left + sides.right > width - 48)
            throw new Error(
                "Signature-block labels leave insufficient field width"
            );
        const firstWidth = labelWidth + sides.left;
        let rows = "";
        if (title) {
            const titleStyle = renderer.style({
                ...style,
                bold: !single,
                fontSize:
                    style.fontSize *
                    (single ? 1 : configuration.titleFontScale ?? 1.02),
                color:
                    configuration.titleColor ??
                    (single ? "#61727E" : style.color)
            });
            rows += rowXml(
                cellXml(
                    paragraph(textRun(title, titleStyle), titleStyle, {
                        keepNext: true
                    }),
                    {
                        width,
                        span: 2,
                        vertical: "center",
                        background: single
                            ? undefined
                            : configuration.headerBackgroundColor ??
                              configuration.titleBackgroundColor,
                        padding: {
                            ...sides,
                            bottom: configuration.headerGap ?? 5
                        }
                    }
                )
            );
        }
        for (const body of [data.bodyText, data.by])
            if (body)
                rows += rowXml(
                    cellXml(
                        paragraph(textRun(body, style), style, {
                            keepNext: true
                        }),
                        {
                            width,
                            span: 2,
                            padding: {
                                ...sides,
                                top: 0,
                                bottom: configuration.bodyGap ?? 4.5
                            }
                        }
                    )
                );
        for (const [index, label] of fields.entries()) {
            const signature = signatureField(label);
            const identity = /^(name|name and capacity)$/i.test(label);
            const value = values[label];
            const labelText =
                single && (signature || (identity && value)) ? "" : label + ":";
            const valueStyle = renderer.style({
                ...style,
                bold: identity && Boolean(value),
                color: configuration.valueColor ?? style.color
            });
            const key = label
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "_")
                .replace(/_+$/g, "");
            const name = data.fieldName
                ? signature
                    ? data.fieldName
                    : data.fieldName + "." + key
                : "signature_block." +
                  ++renderer.document.identifier +
                  "." +
                  key;
            const field = new FormFieldNode(value, {
                fieldType: signature ? "signature" : "text",
                name,
                tooltip: (title ? title + " — " : "") + label,
                value,
                readOnly:
                    !signature && Boolean(value) && !/^\[[^\]]+\]$/.test(value)
            });
            const body = renderer.inline([field], valueStyle);
            const keepNext = index < fields.length - 1;
            const border =
                signature || !single
                    ? {
                          width: configuration.borderWidth ?? 0.5,
                          color: configuration.borderColor ?? "#213C51"
                      }
                    : undefined;
            const valueParagraph = paragraph(body, valueStyle, {
                keepNext,
                border,
                borderSpace: 0
            });
            const rowPadding = {
                top: 0,
                bottom:
                    index < fields.length - 1
                        ? configuration.rowGap ?? (single ? 0 : 4)
                        : sides.bottom,
                left: 0,
                right: sides.right
            };
            const cells = labelText
                ? cellXml(
                      paragraph(
                          textRun(labelText, { ...style, bold: !single }),
                          style,
                          { keepNext }
                      ),
                      {
                          width: firstWidth,
                          padding: { ...rowPadding, left: sides.left, right: 4 }
                      }
                  ) +
                  cellXml(valueParagraph, {
                      width: width - firstWidth,
                      padding: rowPadding
                  })
                : cellXml(valueParagraph, {
                      width,
                      span: 2,
                      padding: { ...rowPadding, left: sides.left }
                  });
            rows += rowXml(
                cells,
                signature
                    ? configuration.signatureRowHeight ?? 64
                    : configuration.rowHeight ?? style.fontSize * 1.5
            );
        }
        output += tableXml(
            [firstWidth, width - firstWidth],
            rows,
            single
                ? {}
                : {
                      ...configuration,
                      borderWidth: configuration.borderWidth ?? 1
                  }
        );
        if (signatory.organization)
            output += paragraph(textRun(signatory.organization, style), style);
        output += paragraph(
            "",
            { fontSize: 1, lineHeight: 1 },
            { after: configuration.postGap ?? 6 }
        );
    }
    const witness = node.witnessLabel ?? data.witnessLabel;
    if (witness)
        output += paragraph(textRun(witness, style), style, {
            before: 18,
            border: { width: 0.5 }
        });
    return output;
}
