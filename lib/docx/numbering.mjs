import { XML_DECLARATION, WORD_NAMESPACE, escapeXml } from "./xml.mjs";

/** @typedef {import("../ast/nodes/ProseNode.mjs").ListNode} ListNode */

export class Numbering {
    constructor() {
        /** @type {ListNode[]} */
        this.lists = [];
    }
    /** @param {ListNode} list @returns {number} */
    add(list) {
        this.lists.push(list);
        return this.lists.length;
    }
    /** @returns {string} */
    build() {
        const formats = { decimal: "decimal", alpha: "lowerLetter", Alpha: "upperLetter", roman: "lowerRoman", Roman: "upperRoman" };
        const definitions = this.lists.map((list, index) => {
            const format = list.listType === "unordered" ? "bullet" : formats[list.numberStyle ?? "decimal"];
            if (!format) throw new Error("Unsupported DOCX list numbering style");
            return '<w:abstractNum w:abstractNumId="' + index + '"><w:multiLevelType w:val="multilevel"/>' +
                Array.from({length: 9}, (_, level) => '<w:lvl w:ilvl="' + level + '"><w:start w:val="' + (list.startNumber ?? 1) + '"/><w:numFmt w:val="' + format +
                    '"/><w:lvlText w:val="' + escapeXml(format === "bullet" ? list.bulletChar ?? "•" : "%" + (level + 1) + ".") +
                    '"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="' + ((level + 1) * 720) +
                    '"/></w:tabs><w:ind w:left="' + ((level + 1) * 720) + '" w:hanging="360"/></w:pPr></w:lvl>').join("") + "</w:abstractNum>";
        }).join("");
        return XML_DECLARATION + '<w:numbering xmlns:w="' + WORD_NAMESPACE + '">' + definitions +
            this.lists.map((_, index) => '<w:num w:numId="' + (index + 1) + '"><w:abstractNumId w:val="' + index + '"/></w:num>').join("") + "</w:numbering>";
    }
}
