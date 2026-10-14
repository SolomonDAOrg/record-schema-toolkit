import { escapeXml } from "./xml.mjs";

/** @typedef {{instruction: Array<string | FieldCode>}} FieldCode */

/** @param {Array<string | FieldCode>} instruction @param {string} [result] @returns {string} */
export function complexField(instruction, result = "") {
    return (
        '<w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r>' +
        instruction
            .map((part) =>
                typeof part !== "string"
                    ? complexField(part.instruction)
                    : '<w:r><w:instrText xml:space="preserve">' +
                      escapeXml(part) +
                      "</w:instrText></w:r>"
            )
            .join("") +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        result +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>'
    );
}

/** @param {string} start @param {number} [first] @param {string} [format] @returns {string} */
export function relativePageField(start, first = 1, format = "") {
    return complexField([
        "= ",
        { instruction: ["PAGE \\* Arabic"] },
        " - ",
        { instruction: ["PAGEREF " + start + " \\* Arabic"] },
        " + " + first + format
    ]);
}
