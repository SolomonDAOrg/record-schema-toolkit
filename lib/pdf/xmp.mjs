/**
 * XMP metadata packet generation.
 *
 * Builds a well-formed XMP (RDF/XML) document for embedding as the catalog
 * /Metadata stream — the modern metadata standard (PDF 2.0 deprecates the Info
 * dictionary) and the basis for PDF/A. Covers Dublin Core (title/creator/
 * description), the XMP basic schema (CreatorTool/dates), and the PDF schema
 * (Producer/Keywords), with an optional PDF/A identification block. No deps.
 * @module Xmp
 */

/** @param {string} s @returns {string} XML-escaped text */
function xmlEscape(s) {
    return String(s === undefined || s === null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

/**
 * Format a Date as W3C/ISO-8601 with timezone offset (e.g. 2026-07-18T09:30:00+00:00).
 * @param {Date} d
 * @returns {string}
 */
export function formatXmpDate(d) {
    const p = (v) => String(v).padStart(2, "0");
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? "+" : "-";
    const oh = p(Math.floor(Math.abs(off) / 60));
    const om = p(Math.abs(off) % 60);
    return (
        d.getFullYear() +
        "-" +
        p(d.getMonth() + 1) +
        "-" +
        p(d.getDate()) +
        "T" +
        p(d.getHours()) +
        ":" +
        p(d.getMinutes()) +
        ":" +
        p(d.getSeconds()) +
        sign +
        oh +
        ":" +
        om
    );
}

/**
 * @typedef {Object} XmpFields
 * @property {string} [title]
 * @property {string} [author]
 * @property {string} [subject]
 * @property {string} [creator] - authoring tool (xmp:CreatorTool)
 * @property {string} [producer]
 * @property {string} [keywords]
 * @property {Date} [createDate]
 * @property {Date} [modifyDate]
 * @property {number} [pdfaPart] - if set, adds pdfaid:part (e.g. 2)
 * @property {string} [pdfaConformance] - if set, adds pdfaid:conformance (e.g. "B")
 */

/**
 * Build an XMP metadata packet.
 * @param {XmpFields} fields
 * @returns {string}
 */
export function buildXmp(fields) {
    const f = fields || {};
    /** @type {string[]} */
    const props = [];

    if (f.title) {
        props.push(
            '        <dc:title><rdf:Alt><rdf:li xml:lang="x-default">' +
                xmlEscape(f.title) +
                "</rdf:li></rdf:Alt></dc:title>"
        );
    }
    if (f.author) {
        props.push(
            "        <dc:creator><rdf:Seq><rdf:li>" +
                xmlEscape(f.author) +
                "</rdf:li></rdf:Seq></dc:creator>"
        );
    }
    if (f.subject) {
        props.push(
            '        <dc:description><rdf:Alt><rdf:li xml:lang="x-default">' +
                xmlEscape(f.subject) +
                "</rdf:li></rdf:Alt></dc:description>"
        );
    }
    if (f.creator) {
        props.push(
            "        <xmp:CreatorTool>" +
                xmlEscape(f.creator) +
                "</xmp:CreatorTool>"
        );
    }
    if (f.createDate) {
        props.push(
            "        <xmp:CreateDate>" +
                formatXmpDate(f.createDate) +
                "</xmp:CreateDate>"
        );
    }
    if (f.modifyDate) {
        props.push(
            "        <xmp:ModifyDate>" +
                formatXmpDate(f.modifyDate) +
                "</xmp:ModifyDate>"
        );
    }
    if (f.producer) {
        props.push(
            "        <pdf:Producer>" + xmlEscape(f.producer) + "</pdf:Producer>"
        );
    }
    if (f.keywords) {
        props.push(
            "        <pdf:Keywords>" + xmlEscape(f.keywords) + "</pdf:Keywords>"
        );
    }
    if (f.pdfaPart !== undefined) {
        props.push("        <pdfaid:part>" + f.pdfaPart + "</pdfaid:part>");
    }
    if (f.pdfaConformance) {
        props.push(
            "        <pdfaid:conformance>" +
                xmlEscape(f.pdfaConformance) +
                "</pdfaid:conformance>"
        );
    }

    return (
        '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n' +
        '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Solomon DAO PDF">\n' +
        '  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n' +
        '    <rdf:Description rdf:about=""\n' +
        '        xmlns:dc="http://purl.org/dc/elements/1.1/"\n' +
        '        xmlns:xmp="http://ns.adobe.com/xap/1.0/"\n' +
        '        xmlns:pdf="http://ns.adobe.com/pdf/1.3/"\n' +
        '        xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">\n' +
        props.join("\n") +
        (props.length > 0 ? "\n" : "") +
        "    </rdf:Description>\n" +
        "  </rdf:RDF>\n" +
        "</x:xmpmeta>\n" +
        '<?xpacket end="w"?>'
    );
}

export default { buildXmp, formatXmpDate };
