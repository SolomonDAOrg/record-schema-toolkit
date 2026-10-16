import { complexField, relativePageField } from "../../../docx/fields.mjs";
import { resolveVariable } from "../../composers/DocumentComposer.mjs";
import { textRun, field } from "../../../docx/styles.mjs";
import { escapeXml } from "../../../docx/xml.mjs";
import { RELATIONSHIP_TYPES } from "../../../docx/package/Package.mjs";
import { imageRun } from "../../../docx/media.mjs";

/** @typedef {import("../../types/core.mjs").BaseNode} BaseNode */
/** @typedef {import("./content.mjs").DocxContentRenderer} DocxContentRenderer */
/** @typedef {import("../../../docx/styles.mjs").RunStyle} RunStyle */
/** @typedef {import("../../nodes/BaseNode.mjs").TextNode} TextNode */
/** @typedef {import("../../nodes/BaseNode.mjs").FormFieldNode} FormFieldNode */
/** @typedef {import("../../nodes/ProseNode.mjs").InlineFormatNode} InlineFormatNode */
/** @typedef {import("../../nodes/ProseNode.mjs").ImageNode} ImageNode */
/** @typedef {import("../../nodes/ProseNode.mjs").LinkNode} LinkNode */

/** @param {BaseNode} node @returns {string} */
export function plainText(node) {
    switch (node.type) {
        case "text":
            return /** @type {TextNode} */ (node).text;
        case "form-field":
            return (
                /** @type {FormFieldNode} */ (node).value ??
                /** @type {FormFieldNode} */ (node).rawText
            );
        case "break":
            return "\n";
        case "code-block":
            return /** @type {import("../../nodes/ProseNode.mjs").CodeBlockNode} */ (
                node
            ).code;
        default:
            return node.children.map(plainText).join("");
    }
}

/** @param {string} format @param {RunStyle} style @returns {RunStyle} */
export function formattedStyle(format, style) {
    switch (format) {
        case "bold":
            return { ...style, bold: true };
        case "italic":
            return { ...style, italic: true };
        case "underline":
            return { ...style, underline: true };
        case "strikethrough":
            return { ...style, strikethrough: true };
        case "code":
            return { ...style, monospace: true };
        case "superscript":
            return { ...style, superscript: true };
        case "subscript":
            return { ...style, subscript: true };
        default:
            throw new Error("Unsupported DOCX inline format: " + format);
    }
}

/** @param {DocxContentRenderer} renderer @param {BaseNode} node @param {RunStyle} inherited @returns {string} */
export function renderInline(renderer, node, inherited) {
    const style = renderer.style({ ...inherited, ...node.textStyle });
    switch (node.type) {
        case "text": {
            const text = /** @type {TextNode} */ (node);
            const formats = text.formats ?? [];
            if (!formats.length) return textRun(text.text, style);
            const boundaries = [
                ...new Set([
                    0,
                    text.text.length,
                    ...formats.flatMap((format) => [format.start, format.end])
                ])
            ].sort((a, b) => a - b);
            if (boundaries[0] < 0 || boundaries.at(-1) > text.text.length)
                throw new Error("Invalid text formatting range");
            return boundaries
                .slice(0, -1)
                .map((start, index) => {
                    const end = boundaries[index + 1];
                    const current = formats
                        .filter(
                            (format) =>
                                format.start <= start && format.end >= end
                        )
                        .reduce(
                            (result, format) =>
                                formattedStyle(format.type, result),
                            style
                        );
                    return textRun(
                        text.text.slice(start, end),
                        renderer.style(current)
                    );
                })
                .join("");
        }
        case "inline-format": {
            const formatted = formattedStyle(
                /** @type {InlineFormatNode} */ (node).formatType,
                style
            );
            return node.children
                .map((child) => renderInline(renderer, child, formatted))
                .join("");
        }
        case "break":
            const breakNode =
                /** @type {import("../../nodes/BaseNode.mjs").BreakNode} */ (
                    node
                );

            return (
                "<w:r><w:br" +
                ((breakNode.breakType ?? breakNode.attrs.breakType) === "page"
                    ? ' w:type="page"'
                    : "") +
                "/></w:r>"
            );
        case "link": {
            const link = /** @type {LinkNode} */ (node);
            const content = node.children
                .map((child) =>
                    renderInline(renderer, child, {
                        ...style,
                        color: style.color ?? "#0000EE",
                        underline: true
                    })
                )
                .join("");
            if (link.href.startsWith("#")) {
                const bookmark = renderer.bookmark(link.href.slice(1));
                return (
                    '<w:hyperlink w:anchor="' +
                    bookmark.name +
                    '" w:history="1">' +
                    content +
                    "</w:hyperlink>"
                );
            }
            const relationship = renderer.document.archive.relate(
                renderer.part,
                RELATIONSHIP_TYPES.hyperlink,
                link.href,
                true
            );
            return (
                '<w:hyperlink r:id="' +
                relationship +
                '" w:history="1">' +
                content +
                "</w:hyperlink>"
            );
        }
        case "image": {
            const image = /** @type {ImageNode} */ (node);
            return imageRun(
                renderer.document.archive,
                renderer.part,
                {
                    ...image,
                    sourceBytes: /** @type {Uint8Array | undefined} */ (
                        image.attrs.sourceBytes
                    )
                },
                ++renderer.document.identifier,
                renderer.width
            );
        }
        case "form-field": {
            const control = /** @type {FormFieldNode} */ (node);
            if (renderer.literalFields)
                return textRun(control.value ?? control.rawText, style);
            const identifier = ++renderer.document.identifier;
            const name =
                control.name ?? control.fieldNameKey ?? control.placeholderText;
            if (control.fieldType === "signature")
                renderer.warn(
                    "DOCX signature fields are editable signing placeholders; PDF digital-signature operations do not apply."
                );
            if (control.required || control.maxLength)
                renderer.warn(
                    "DOCX content controls retain field content but do not enforce PDF required or maximum-length constraints."
                );
            const value = control.value ?? control.rawText;
            return (
                '<w:sdt><w:sdtPr><w:alias w:val="' +
                escapeXml(control.tooltip ?? control.placeholderText) +
                '"/><w:tag w:val="' +
                escapeXml(name) +
                '"/><w:id w:val="' +
                identifier +
                '"/>' +
                (control.readOnly ? '<w:lock w:val="sdtContentLocked"/>' : "") +
                "<w:text" +
                (control.attrs.multiline === true ? ' w:multiLine="1"' : "") +
                "/></w:sdtPr><w:sdtContent>" +
                textRun(value || "                    ", {
                    ...style,
                    underline:
                        control.fieldType === "signature" || style.underline
                }) +
                "</w:sdtContent></w:sdt>"
            );
        }
        default:
            throw new Error("Unsupported DOCX inline node: " + node.type);
    }
}

/** @param {DocxContentRenderer} renderer @param {import("../../types/core.mjs").HeaderFooterContent} content @param {RunStyle} style @returns {string} */
export function renderVariableContent(renderer, content, style) {
    if (
        content === null ||
        content === undefined ||
        typeof content === "string"
    )
        return textRun(String(content ?? ""), style);
    if (!("type" in content))
        return content
            .map((item) => renderVariableContent(renderer, item, style))
            .join("");
    const formats = {
        roman: "roman",
        "roman-upper": "ROMAN",
        alpha: "alphabetic",
        "alpha-upper": "ALPHABETIC",
        arabic: "Arabic"
    };
    const suffix =
        content.format && formats[content.format]
            ? " \\* " + formats[content.format]
            : "";
    switch (content.name) {
        case "page":
        case "pageNumber":
            return relativePageField(
                renderer.pageStartBookmark ?? "NumberingStart",
                renderer.startPageNumber ?? 1,
                suffix
            );
        case "totalPages":
            return complexField([
                "= ",
                { instruction: ["PAGEREF BodyEnd \\* Arabic"] },
                " - ",
                { instruction: ["PAGEREF NumberingStart \\* Arabic"] },
                " + 1" + suffix
            ]);
        case "sectionPage":
        case "sectionPageNumber":
            return relativePageField(renderer.sectionBookmark, 1, suffix);
        case "sectionTotal":
        case "sectionTotalPages":
            return field("SECTIONPAGES" + suffix);
        default:
            return textRun(
                resolveVariable(content, {
                    page: 0,
                    totalPages: 0,
                    sectionPage: 0,
                    sectionTotal: 0,
                    variables: renderer.variables
                }),
                style
            );
    }
}
