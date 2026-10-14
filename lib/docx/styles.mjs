import {
    escapeXml,
    twips,
    color,
    XML_DECLARATION,
    WORD_NAMESPACE
} from "./xml.mjs";

/** @typedef {Omit<import("../ast/types/core.mjs").TextStyle, "color"> & { color?: string | number, superscript?: boolean, subscript?: boolean }} RunStyle */
/** @typedef {{ position: number, align: "left" | "center" | "right", leader?: "dot" | "hyphen" | "underscore" | "none" }} ParagraphTab */
/** @typedef {{ before?: number, after?: number, indent?: number, firstLine?: number, hanging?: number, heading?: number, keepNext?: boolean, keepTogether?: boolean, pageBreakBefore?: boolean, numbering?: number, level?: number, border?: import("../ast/types/core.mjs").BorderStyle, borderSpace?: number, borderSide?: "top" | "bottom", shade?: string | number, tabs?: ParagraphTab[] }} ParagraphOptions */

const FONT_NAMES = {
    "Times-Roman": "Times New Roman",
    "Times-Bold": "Times New Roman",
    "Times-Italic": "Times New Roman",
    "Times-BoldItalic": "Times New Roman",
    Helvetica: "Arial",
    "Helvetica-Bold": "Arial",
    "Helvetica-Oblique": "Arial",
    "Helvetica-BoldOblique": "Arial",
    Courier: "Courier New",
    "Courier-Bold": "Courier New",
    "Courier-Oblique": "Courier New",
    "Courier-BoldOblique": "Courier New"
};

/** @param {string} name @returns {string} */
export function fontFamily(name) {
    return FONT_NAMES[name] ?? name;
}

/** @param {RunStyle} [style] @returns {string} */
export function runProperties(style = {}) {
    let xml = "";
    if (style.fontFamily) {
        const name = escapeXml(fontFamily(style.fontFamily));
        xml +=
            '<w:rFonts w:ascii="' +
            name +
            '" w:hAnsi="' +
            name +
            '" w:eastAsia="' +
            name +
            '" w:cs="' +
            name +
            '"/>';
    }
    if (style.bold !== undefined)
        xml += '<w:b w:val="' + Number(style.bold) + '"/>';
    if (style.italic !== undefined)
        xml += '<w:i w:val="' + Number(style.italic) + '"/>';
    if (style.strikethrough !== undefined)
        xml += '<w:strike w:val="' + Number(style.strikethrough) + '"/>';
    if (style.color !== undefined)
        xml += '<w:color w:val="' + color(style.color) + '"/>';
    if (style.letterSpacing !== undefined)
        xml += '<w:spacing w:val="' + twips(style.letterSpacing) + '"/>';
    if (style.fontSize !== undefined) {
        xml +=
            '<w:sz w:val="' +
            Math.round(style.fontSize * 2) +
            '"/><w:szCs w:val="' +
            Math.round(style.fontSize * 2) +
            '"/>';
    }
    if (style.underline !== undefined)
        xml += '<w:u w:val="' + (style.underline ? "single" : "none") + '"/>';
    if (style.backgroundColor)
        xml +=
            '<w:shd w:val="clear" w:fill="' +
            color(style.backgroundColor) +
            '"/>';
    if (style.superscript || style.subscript)
        xml +=
            '<w:vertAlign w:val="' +
            (style.superscript ? "superscript" : "subscript") +
            '"/>';
    return xml ? "<w:rPr>" + xml + "</w:rPr>" : "";
}

/** @param {string} text @param {RunStyle} [style] @returns {string} */
export function textRun(text, style = {}) {
    switch (style.textTransform) {
        case "uppercase":
            text = text.toUpperCase();
            break;
        case "lowercase":
            text = text.toLowerCase();
            break;
        case "capitalize":
            text = text.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
            break;
    }
    const content = text
        .split(/(\r\n|\n|\r|\t)/)
        .map((part) =>
            part === "\t"
                ? "<w:tab/>"
                : /^(\r\n|\n|\r)$/.test(part)
                ? "<w:br/>"
                : '<w:t xml:space="preserve">' + escapeXml(part) + "</w:t>"
        )
        .join("");
    return "<w:r>" + runProperties(style) + content + "</w:r>";
}

/** @param {string} instruction @param {string} [result] @returns {string} */
export function field(instruction, result = "") {
    return (
        '<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> ' +
        escapeXml(instruction) +
        ' </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        textRun(result) +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
    );
}

/** @param {RunStyle} [style] @param {ParagraphOptions} [options] @returns {string} */
export function paragraphProperties(style = {}, options = {}) {
    let xml = "";
    if (options.heading)
        xml += '<w:pStyle w:val="Heading' + options.heading + '"/>';
    if (options.keepNext) xml += "<w:keepNext/>";
    if (options.keepTogether) xml += "<w:keepLines/>";
    if (options.pageBreakBefore) xml += "<w:pageBreakBefore/>";
    xml += "<w:widowControl/>";
    if (options.numbering)
        xml +=
            '<w:numPr><w:ilvl w:val="' +
            (options.level ?? 0) +
            '"/><w:numId w:val="' +
            options.numbering +
            '"/></w:numPr>';
    if (options.border)
        xml +=
            "<w:pBdr><w:" +
            (options.borderSide ?? "bottom") +
            ' w:val="' +
            (options.border.style === "double" ? "double" : "single") +
            '" w:sz="' +
            Math.max(2, Math.round((options.border.width ?? 0.5) * 8)) +
            '" w:space="' +
            Math.round(options.borderSpace ?? 0) +
            '" w:color="' +
            color(options.border.color) +
            '"/></w:pBdr>';
    if (options.shade !== undefined)
        xml += '<w:shd w:val="clear" w:fill="' + color(options.shade) + '"/>';
    if (options.tabs)
        xml +=
            "<w:tabs>" +
            options.tabs
                .map(
                    (tab) =>
                        '<w:tab w:val="' +
                        tab.align +
                        '" w:pos="' +
                        twips(tab.position) +
                        '"' +
                        (tab.leader ? ' w:leader="' + tab.leader + '"' : "") +
                        "/>"
                )
                .join("") +
            "</w:tabs>";
    xml +=
        '<w:spacing w:before="' +
        twips(options.before ?? 0) +
        '" w:after="' +
        twips(options.after ?? 0) +
        '" w:line="' +
        Math.round((style.lineHeight ?? 1.5) * 240) +
        '" w:lineRule="auto"/>';
    if (
        options.indent !== undefined ||
        options.firstLine !== undefined ||
        options.hanging !== undefined
    ) {
        xml +=
            '<w:ind w:left="' +
            twips(options.indent ?? 0) +
            '"' +
            (options.hanging !== undefined
                ? ' w:hanging="' + twips(options.hanging) + '"'
                : options.firstLine !== undefined
                ? ' w:firstLine="' + twips(options.firstLine) + '"'
                : "") +
            "/>";
    }
    if (style.align)
        xml +=
            '<w:jc w:val="' +
            (style.align === "justify" ? "both" : style.align) +
            '"/>';
    return "<w:pPr>" + xml + runProperties(style) + "</w:pPr>";
}

/** @param {string} content @param {RunStyle} [style] @param {ParagraphOptions} [options] @returns {string} */
export function paragraph(content, style, options) {
    return "<w:p>" + paragraphProperties(style, options) + content + "</w:p>";
}

/** @param {RunStyle} style @returns {string} */
export function stylesDocument(style) {
    return (
        XML_DECLARATION +
        '<w:styles xmlns:w="' +
        WORD_NAMESPACE +
        '"><w:docDefaults><w:rPrDefault>' +
        runProperties(style) +
        "</w:rPrDefault><w:pPrDefault>" +
        paragraphProperties(style) +
        '</w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
        Array.from(
            { length: 6 },
            (_, index) =>
                '<w:style w:type="paragraph" w:styleId="Heading' +
                (index + 1) +
                '"><w:name w:val="heading ' +
                (index + 1) +
                '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:outlineLvl w:val="' +
                index +
                '"/></w:pPr></w:style>'
        ).join("") +
        "</w:styles>"
    );
}
