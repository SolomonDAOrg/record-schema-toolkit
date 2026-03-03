/**
 * PDF Primitives - Low-level PDF object generation
 * Zero dependencies, pure ESM
 * @module PdfPrimitives
 */

// ============================================================================
// Constants
// ============================================================================

const PDF_VERSION = "%PDF-1.4";
const PDF_EOF = "%%EOF";

// ============================================================================
// Type Definitions (JSDoc)
// ============================================================================

/**
 * @typedef {Object} PdfObject
 * @property {number} id
 * @property {number} generation
 * @property {Uint8Array} data
 */

/**
 * @typedef {Object} PdfXrefEntry
 * @property {number} offset
 * @property {number} generation
 * @property {"n" | "f"} type
 */

// ============================================================================
// Text Encoding Utilities
// ============================================================================

/**
 * Encodes a string to UTF-8 bytes
 * @param {string} str
 * @returns {Uint8Array}
 */
export function encodeUtf8(str) {
    const bytes = [];
    for (let i = 0, len = str.length; i < len; i++) {
        let code = str.charCodeAt(i);
        if (code < 0x80) {
            bytes.push(code);
        } else if (code < 0x800) {
            bytes.push(0xc0 | (code >> 6));
            bytes.push(0x80 | (code & 0x3f));
        } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < len) {
            const next = str.charCodeAt(i + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
                i = i + 1;
                bytes.push(0xf0 | (code >> 18));
                bytes.push(0x80 | ((code >> 12) & 0x3f));
                bytes.push(0x80 | ((code >> 6) & 0x3f));
                bytes.push(0x80 | (code & 0x3f));
            } else {
                bytes.push(0xef, 0xbf, 0xbd);
            }
        } else if (code >= 0xdc00 && code <= 0xdfff) {
            bytes.push(0xef, 0xbf, 0xbd);
        } else {
            bytes.push(0xe0 | (code >> 12));
            bytes.push(0x80 | ((code >> 6) & 0x3f));
            bytes.push(0x80 | (code & 0x3f));
        }
    }
    return new Uint8Array(bytes);
}

/**
 * Concatenates multiple Uint8Arrays
 * @param {Uint8Array[]} arrays
 * @returns {Uint8Array}
 */
export function concatBytes(arrays) {
    let totalLen = 0;
    for (let i = 0, len = arrays.length; i < len; i++) {
        totalLen = totalLen + arrays[i].length;
    }
    const result = new Uint8Array(totalLen);
    let offset = 0;
    for (let i = 0, len = arrays.length; i < len; i++) {
        result.set(arrays[i], offset);
        offset = offset + arrays[i].length;
    }
    return result;
}

// ============================================================================
// PDF String Escaping
// ============================================================================

/**
 * Escapes a string for use in PDF literal strings
 * @param {string} str
 * @returns {string}
 */
/**
 * Escapes a string for use in PDF literal strings, handling WinAnsi mappings
 * @param {string} str
 * @returns {string}
 */
export function escapePdfString(str) {
    let result = "";
    for (let i = 0, len = str.length; i < len; i++) {
        const ch = str.charAt(i);
        let code = str.charCodeAt(i);

        // Handle simple escapes
        if (ch === "\\") {
            result += "\\\\";
            continue;
        } else if (ch === "(") {
            result += "\\(";
            continue;
        } else if (ch === ")") {
            result += "\\)";
            continue;
        } else if (code === 10) result += "\\n";
        else if (code === 13) result += "\\r";
        else if (code === 9) result += "\\t";
        else if (code === 8) result += "\\b";
        else if (code === 12) result += "\\f";
        else {
            // Manual mapping of common Unicode chars to WinAnsi (Windows-1252)
            if (code > 255) {
                switch (code) {
                    case 0x2022:
                        code = 149;
                        break; // • Bullet
                    case 0x2013:
                        code = 150;
                        break; // – En dash
                    case 0x2014:
                        code = 151;
                        break; // — Em dash
                    case 0x2018:
                        code = 145;
                        break; // ‘ Left single quote
                    case 0x2019:
                        code = 146;
                        break; // ’ Right single quote
                    case 0x201c:
                        code = 147;
                        break; // “ Left double quote
                    case 0x201d:
                        code = 148;
                        break; // ” Right double quote
                    case 0x2026:
                        code = 133;
                        break; // … Ellipsis
                    case 0x20ac:
                        code = 128;
                        break; // € Euro
                    default:
                        // Fallback: replace unknown high-unicode chars with '?'
                        // to prevent garbage output like €42
                        code = 63;
                }
            }

            if (code < 32 || code > 126) {
                // Use octal escape for non-printable ASCII and Extended ASCII
                const octal = code.toString(8).padStart(3, "0");
                result += "\\" + octal;
            } else {
                result += String.fromCharCode(code);
            }
        }
    }
    return result;
}

/**
 * Encodes string as PDF hex string with BOM for Unicode
 * @param {string} str
 * @returns {string}
 */
export function encodePdfHexString(str) {
    // UTF-16BE with BOM
    let hex = "FEFF";
    for (let i = 0, len = str.length; i < len; i++) {
        const code = str.charCodeAt(i);
        hex = hex + code.toString(16).toUpperCase().padStart(4, "0");
    }
    return "<" + hex + ">";
}

/**
 * Escapes a name for PDF name objects
 * @param {string} name
 * @returns {string}
 */
export function escapePdfName(name) {
    let result = "/";
    for (let i = 0, len = name.length; i < len; i++) {
        const code = name.charCodeAt(i);
        if (
            code >= 33 &&
            code <= 126 &&
            code !== 35 && // #
            code !== 40 && // (
            code !== 41 && // )
            code !== 60 && // <
            code !== 62 && // >
            code !== 91 && // [
            code !== 93 && // ]
            code !== 123 && // {
            code !== 125 && // }
            code !== 47 && // /
            code !== 37 // %
        ) {
            result = result + name.charAt(i);
        } else {
            result =
                result + "#" + code.toString(16).toUpperCase().padStart(2, "0");
        }
    }
    return result;
}

// ============================================================================
// PDF Object Formatting
// ============================================================================

/**
 * Creates an indirect object wrapper
 * @param {number} id
 * @param {string} content
 * @returns {string}
 */
export function formatIndirectObject(id, content) {
    return `${id} 0 obj\n${content}\nendobj\n`;
}

/**
 * Creates a PDF dictionary
 * @param {Record<string, string>} entries
 * @returns {string}
 */
export function formatDictionary(entries) {
    const keys = Object.keys(entries);
    if (keys.length === 0) {
        return "<<>>";
    }
    let result = "<<\n";
    for (let i = 0, len = keys.length; i < len; i++) {
        const key = keys[i];
        result = result + "  /" + key + " " + entries[key] + "\n";
    }
    result = result + ">>";
    return result;
}

/**
 * Creates a PDF array
 * @param {string[]} items
 * @returns {string}
 */
export function formatArray(items) {
    return "[" + items.join(" ") + "]";
}

/**
 * Creates a PDF stream object
 * @param {Record<string, string>} dictEntries
 * @param {Uint8Array} streamData
 * @returns {string}
 */
export function formatStreamObject(dictEntries, streamData) {
    const entries = { ...dictEntries };
    entries["Length"] = String(streamData.length);
    const dict = formatDictionary(entries);
    // We'll handle binary data specially - return marker
    return dict + "\nstream\n";
}

/**
 * Creates an object reference
 * @param {number} id
 * @returns {string}
 */
export function formatRef(id) {
    return `${id} 0 R`;
}

// ============================================================================
// PDF Document Structure
// ============================================================================

/**
 * Creates PDF header bytes
 * @returns {Uint8Array}
 */
export function createPdfHeader() {
    // Include binary comment to indicate binary content
    return encodeUtf8(PDF_VERSION + "\n%\x80\x81\x82\x83\n");
}

/**
 * Creates xref table
 * @param {PdfXrefEntry[]} entries
 * @returns {string}
 */
export function createXrefTable(entries) {
    let result = "xref\n";
    result = result + `0 ${entries.length}\n`;
    for (let i = 0, len = entries.length; i < len; i++) {
        const entry = entries[i];
        const offsetStr = String(entry.offset).padStart(10, "0");
        const genStr = String(entry.generation).padStart(5, "0");
        result = result + `${offsetStr} ${genStr} ${entry.type} \n`;
    }
    return result;
}

/**
 * Creates PDF trailer
 * @param {number} size - Total number of objects
 * @param {number} rootRef - Catalog object ID
 * @param {number} xrefOffset - Byte offset of xref table
 * @param {number} [infoRef] - Optional Info object ID
 * @returns {string}
 */
export function createTrailer(size, rootRef, xrefOffset, infoRef) {
    const entries = {
        Size: String(size),
        Root: formatRef(rootRef)
    };
    if (infoRef !== undefined) {
        entries["Info"] = formatRef(infoRef);
    }
    const dict = formatDictionary(entries);
    return `trailer\n${dict}\nstartxref\n${xrefOffset}\n${PDF_EOF}\n`;
}

// ============================================================================
// Standard PDF Objects
// ============================================================================

/**
 * Creates a catalog object
 * @param {number} pagesRef
 * @param {number} [outlinesRef] - Optional Outlines root object ID
 * @returns {string}
 */
export function createCatalog(pagesRef, outlinesRef) {
    /** @type {Record<string, string>} */
    const entries = {
        Type: "/Catalog",
        Pages: formatRef(pagesRef)
    };
    if (outlinesRef != null) {
        entries.Outlines = formatRef(outlinesRef);
        entries.PageMode = "/UseOutlines";
    }
    return formatDictionary(entries);
}

/**
 * Creates a pages object
 * @param {number[]} pageRefs
 * @param {number} count
 * @returns {string}
 */
export function createPages(pageRefs, count) {
    const kids = formatArray(pageRefs.map(formatRef));
    return formatDictionary({
        Type: "/Pages",
        Kids: kids,
        Count: String(count)
    });
}

/**
 * Creates a page object
 * @param {number} parentRef
 * @param {number} width
 * @param {number} height
 * @param {number} contentsRef
 * @param {number} resourcesRef
 * @returns {string}
 */
export function createPage(
    parentRef,
    width,
    height,
    contentsRef,
    resourcesRef
) {
    return formatDictionary({
        Type: "/Page",
        Parent: formatRef(parentRef),
        MediaBox: formatArray(["0", "0", String(width), String(height)]),
        Contents: formatRef(contentsRef),
        Resources: formatRef(resourcesRef)
    });
}

/**
 * Creates a resources object with fonts
 * @param {Record<string, number>} fonts - Font name to object ID mapping
 * @returns {string}
 */
export function createResources(fonts) {
    /** @type {Record<string, string>} */
    const fontEntries = {};
    const fontNames = Object.keys(fonts);
    for (let i = 0, len = fontNames.length; i < len; i++) {
        const name = fontNames[i];
        fontEntries[name] = formatRef(fonts[name]);
    }
    return formatDictionary({
        Font: formatDictionary(fontEntries)
    });
}

/**
 * Creates a Type1 font object (built-in PDF fonts)
 * @param {string} baseFont - e.g., "Helvetica", "Times-Roman", "Courier"
 * @returns {string}
 */
export function createType1Font(baseFont) {
    return formatDictionary({
        Type: "/Font",
        Subtype: "/Type1",
        BaseFont: "/" + baseFont,
        Encoding: "/WinAnsiEncoding"
    });
}

/**
 * Creates a document info object
 * @param {Object} info
 * @param {string} [info.title]
 * @param {string} [info.author]
 * @param {string} [info.subject]
 * @param {string} [info.creator]
 * @param {string | null} [info.producer] - Producer string, null to omit, undefined for default
 * @param {boolean} [info.includeDates=true] - Whether to include creation/mod dates
 * @returns {string}
 */
export function createDocumentInfo(info) {
    /** @type {Record<string, string>} */
    const entries = {};
    if (info.title) {
        entries["Title"] = encodePdfHexString(info.title);
    }
    if (info.author) {
        entries["Author"] = encodePdfHexString(info.author);
    }
    if (info.subject) {
        entries["Subject"] = encodePdfHexString(info.subject);
    }
    if (info.creator) {
        entries["Creator"] = encodePdfHexString(info.creator);
    }
    // Producer: null = omit, undefined = default, string = custom
    if (info.producer === undefined) {
        entries["Producer"] = "(Solomon DAO PDF Generator)";
    } else if (info.producer !== null && info.producer.length > 0) {
        entries["Producer"] = "(" + escapePdfString(info.producer) + ")";
    }
    // Dates: optionally include
    if (info.includeDates !== false) {
        const now = new Date();
        const dateStr = formatPdfDate(now);
        entries["CreationDate"] = `(${dateStr})`;
        entries["ModDate"] = `(${dateStr})`;
    }
    return formatDictionary(entries);
}

/**
 * Formats a date for PDF
 * @param {Date} date
 * @returns {string}
 */
export function formatPdfDate(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const hours = String(date.getUTCHours()).padStart(2, "0");
    const minutes = String(date.getUTCMinutes()).padStart(2, "0");
    const seconds = String(date.getUTCSeconds()).padStart(2, "0");
    return `D:${year}${month}${day}${hours}${minutes}${seconds}Z`;
}

// ============================================================================
// Export
// ============================================================================

export default {
    encodeUtf8,
    concatBytes,
    escapePdfString,
    encodePdfHexString,
    escapePdfName,
    formatIndirectObject,
    formatDictionary,
    formatArray,
    formatStreamObject,
    formatRef,
    createPdfHeader,
    createXrefTable,
    createTrailer,
    createCatalog,
    createPages,
    createPage,
    createResources,
    createType1Font,
    createDocumentInfo,
    formatPdfDate
};
