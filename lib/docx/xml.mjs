export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
export const WORD_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const RELATIONSHIP_NAMESPACE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const DOCUMENT_NAMESPACES = 'xmlns:w="' + WORD_NAMESPACE + '" xmlns:r="' + RELATIONSHIP_NAMESPACE + '" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w10="urn:schemas-microsoft-com:office:word"';

/** @param {string | number} value @returns {string} */
export function escapeXml(value) {
    const text = String(value);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(text) || /[\uD800-\uDFFF]/u.test(text)) {
        throw new Error("DOCX text contains an invalid XML character");
    }
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** @param {number} points @returns {number} */
export function twips(points) {
    if (!Number.isFinite(points)) throw new Error("Invalid DOCX dimension");
    return Math.round(points * 20);
}

/** @param {string | number | undefined} value @param {string} [fallback] @returns {string} */
export function color(value, fallback = "000000") {
    if (value === undefined) return fallback;
    if (Number.isFinite(value)) {
        const channel = Math.round(Math.max(0, Math.min(1, Number(value))) * 255).toString(16).padStart(2, "0");
        return channel.repeat(3);
    }
    const hex = String(value).replace(/^#/, "");
    if (/^[0-9a-f]{3}$/i.test(hex)) return [...hex].map(character => character + character).join("");
    if (/^[0-9a-f]{6}$/i.test(hex)) return hex;
    if (hex === "none" || hex === "auto") return "auto";
    throw new Error("Unsupported DOCX color: " + value);
}
