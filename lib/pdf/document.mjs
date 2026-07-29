/**
 * PDF Document Builder - Assembles complete PDF documents
 * Zero dependencies, pure ESM
 * Enhanced with link annotation support (internal + external)
 * @module PdfDocument
 */

import {
    encodeUtf8,
    concatBytes,
    formatIndirectObject,
    createPdfHeader,
    createXrefTable,
    createTrailer,
    createCatalog,
    createPages,
    createPage,
    createResources,
    createType1Font,
    createDocumentInfo,
    formatDictionary,
    formatArray,
    formatRef,
    escapePdfString,
    escapePdfName,
    formatPdfDate
} from "./primitives.mjs";

import {
    parseTtfFont,
    buildTtfFontDict,
    buildFontDescriptor,
    buildFontDescriptorCFF,
    buildToUnicodeCMap,
    buildType0FontDict,
    buildCIDFontDict,
    buildCIDFontDictCFF,
    buildCIDWArray,
    buildCIDToUnicodeCMap
} from "./font-embed.mjs";

import { parseWoff2 } from "./woff2-embed.mjs";

import { subsetFont, subsetTag } from "./subset.mjs";

import { deflateBytes } from "./compress.mjs";

import { createHash } from "node:crypto";

import { createEncryption, randomFileId } from "./crypt.mjs";

import { buildXmp } from "./xmp.mjs";

import { getSrgbIccProfile } from "./icc.mjs";

import {
    parseJpeg,
    parsePng,
    buildJpegXObjectDict,
    buildPngXObjectDict,
    buildSmaskXObjectDict
} from "./image-embed.mjs";

// ============================================================================
// Type Definitions (JSDoc)
// ============================================================================

/**
 * @typedef {Object} PdfDocumentOptions
 * @property {number} [width=612] - Page width in points (612 = 8.5in)
 * @property {number} [height=792] - Page height in points (792 = 11in)
 * @property {string} [title]
 * @property {string} [author]
 * @property {string} [subject]
 * @property {string} [creator]
 * @property {string} [keywords]
 * @property {string | null} [producer] - Producer string: null to omit, undefined for default
 * @property {boolean} [includeDates=true] - Whether to include creation/mod dates
 * @property {boolean} [omitInfo=false] - Omit entire Info dictionary (cleanest output)
 * @property {boolean} [compress=true] - FlateDecode content + embedded font streams
 * @property {boolean} [metadata=false] - Emit an XMP /Metadata stream
 * @property {string | number} [pdfa] - PDF/A conformance, e.g. "2b", "2a", "3b", 1
 * @property {{ iccProfile?: Uint8Array, n?: number, identifier?: string, info?: string }} [outputIntent] - ICC output intent (defaults to sRGB for PDF/A)
 * @property {boolean} [tagged=false] - Emit a structure tree (tagged/accessible PDF)
 * @property {EncryptionOptions} [encryption] - Enable RC4/AES-128/AES-256 encryption
 */

/**
 * @typedef {Object} EncryptionOptions
 * @property {"aes-128" | "aes-256"} [algorithm] - cipher/handler version (default "aes-128" = V4/R4; "aes-256" = V5/R6)
 * @property {string} [userPassword] - open password (default "": encrypted but opens without a prompt)
 * @property {string} [ownerPassword] - permissions password (default = userPassword)
 * @property {Object} [permissions] - printing/modifying/copying/annotating/fillingForms/accessibility/assembling/highResPrinting (each default true)
 */

/**
 * @typedef {Object} PdfPageContent
 * @property {Uint8Array} streamData
 */

/**
 * @typedef {Object} PdfFontInfo
 * @property {string} name - Resource name (F1, F2, etc.)
 * @property {string} baseFont - PDF font name
 * @property {number} objectId
 */

/**
 * @typedef {Object} EmbeddedFontInfo
 * @property {string} name         - Resource name (e.g. "F10")
 * @property {import("./font-embed.mjs").TtfParsed} metrics
 * @property {number} fontDictId
 * @property {number} descriptorId
 * @property {number} fileStreamId
 */

/**
 * @typedef {Object} CIDFontInfo
 * @property {string} name - Resource name (e.g. "F10")
 * @property {import("./font-embed.mjs").TtfParsed} metrics
 * @property {Map<number, number>} usedGlyphs - glyph id -> Unicode code point
 * @property {number} fontDictId - Type0 font dict
 * @property {number} cidFontId - descendant CIDFontType2
 * @property {number} descriptorId
 * @property {number} fileStreamId
 * @property {number} toUnicodeId
 */

/**
 * @typedef {Object} ImageXObjectInfo
 * @property {string} name         - Resource name (e.g. "Im1")
 * @property {"jpeg" | "png"} format
 * @property {import("./image-embed.mjs").ParsedJpeg | import("./image-embed.mjs").ParsedPng} parsed
 * @property {number} xObjectId
 * @property {number} [smaskId]
 */

/**
 * @typedef {Object} FormXObjectInfo
 * @property {string} name - Resource name (e.g. "Fm1")
 * @property {Uint8Array} contentStream - form content operators
 * @property {[number, number, number, number]} bbox - clipping bounding box
 * @property {[number, number, number, number, number, number] | undefined} matrix
 * @property {number} xObjectId
 */

/**
 * @typedef {Object} AttachmentInfo
 * @property {Uint8Array} bytes - raw file contents
 * @property {string} name - filename shown in the viewer
 * @property {string | undefined} mimeType - e.g. "application/xml"
 * @property {string | undefined} description
 * @property {string | undefined} relationship - AFRelationship (Data/Source/Alternative/...)
 * @property {number} streamId - embedded file stream object ID
 * @property {number} filespecId - file specification object ID
 */

/**
 * @typedef {Object} LinkAnnotation
 * @property {"internal" | "external"} type
 * @property {number} x - Left edge of link rectangle
 * @property {number} y - Bottom edge of link rectangle
 * @property {number} width - Width of link rectangle
 * @property {number} height - Height of link rectangle
 * @property {string} [targetNodeId] - For internal links (unused in PDF, for reference)
 * @property {number} [targetPage] - For internal links (1-indexed page number)
 * @property {number} [targetY] - For internal links (Y position on target page)
 * @property {string} [url] - For external links
 */

/**
 * @typedef {Object} FormFieldAnnotation
 * @property {"form"} type
 * @property {"text" | "signature"} fieldType
 * @property {string} name
 * @property {string} [tooltip]
 * @property {number} x - Left edge of widget rectangle
 * @property {number} y - Bottom edge of widget rectangle
 * @property {number} width - Width of widget rectangle
 * @property {number} height - Height of widget rectangle
 * @property {string} [value]
 * @property {boolean} [readOnly]
 * @property {boolean} [required]
 * @property {number} [fontSize]
 * @property {number} [maxLength]
 */

/**
 * @typedef {Object} PageOptions
 * @property {number} [width] - Page width in points (defaults to the document width)
 * @property {number} [height] - Page height in points (defaults to the document height)
 * @property {number} [rotate] - Clockwise display rotation; must be a multiple of 90
 */

/**
 * @typedef {Object} PageData
 * @property {Uint8Array} contentStream
 * @property {(LinkAnnotation | FormFieldAnnotation)[]} annotations
 * @property {number} width
 * @property {number} height
 * @property {number} rotate
 */

/**
 * @typedef {Object} OutlineItem
 * @property {string} title - Bookmark title text
 * @property {number} level - Nesting level (1 = top-level)
 * @property {number} targetPage - 1-indexed page number
 * @property {number} [targetY] - Y position on target page (top of page if omitted)
 */

// ============================================================================
// Standard Font Metrics (approximate for Type1 fonts)
// ============================================================================

/**
 * Approximate character widths for Helvetica (per 1000 units)
 * @type {Record<string, number>}
 */
const HELVETICA_WIDTHS = {
    " ": 278,
    "!": 278,
    '"': 355,
    "#": 556,
    $: 556,
    "%": 889,
    "&": 667,
    "'": 191,
    "(": 333,
    ")": 333,
    "*": 389,
    "+": 584,
    ",": 278,
    "-": 333,
    ".": 278,
    "/": 278,
    0: 556,
    1: 556,
    2: 556,
    3: 556,
    4: 556,
    5: 556,
    6: 556,
    7: 556,
    8: 556,
    9: 556,
    ":": 278,
    ";": 278,
    "<": 584,
    "=": 584,
    ">": 584,
    "?": 556,
    "@": 1015,
    A: 667,
    B: 667,
    C: 722,
    D: 722,
    E: 667,
    F: 611,
    G: 778,
    H: 722,
    I: 278,
    J: 500,
    K: 667,
    L: 556,
    M: 833,
    N: 722,
    O: 778,
    P: 667,
    Q: 778,
    R: 722,
    S: 667,
    T: 611,
    U: 722,
    V: 667,
    W: 944,
    X: 667,
    Y: 667,
    Z: 611,
    "[": 278,
    "\\": 278,
    "]": 278,
    "^": 469,
    _: 556,
    "`": 333,
    a: 556,
    b: 556,
    c: 500,
    d: 556,
    e: 556,
    f: 278,
    g: 556,
    h: 556,
    i: 222,
    j: 222,
    k: 500,
    l: 222,
    m: 833,
    n: 556,
    o: 556,
    p: 556,
    q: 556,
    r: 333,
    s: 500,
    t: 278,
    u: 556,
    v: 500,
    w: 722,
    x: 500,
    y: 500,
    z: 500,
    "{": 334,
    "|": 260,
    "}": 334,
    "~": 584,

    "\u00A0": 278,

    "\u00AD": 333,
    "\u2010": 761,
    "\u2011": 761,
    "\u2012": 761,
    "\u2013": 556,
    "\u2014": 1000,
    "\u2015": 761,
    "\u2212": 549,

    "\u2026": 1000,
    "\u2022": 350,
    "\u00B7": 278,

    "\u2018": 222,
    "\u2019": 222,
    "\u201C": 333,
    "\u201D": 333
};

const HELVETICA_BOLD_WIDTHS = {
    " ": 278,
    "!": 333,
    '"': 474,
    "#": 556,
    $: 556,
    "%": 889,
    "&": 722,
    "'": 238,
    "(": 333,
    ")": 333,
    "*": 389,
    "+": 584,
    ",": 278,
    "-": 333,
    ".": 278,
    "/": 278,
    0: 556,
    1: 556,
    2: 556,
    3: 556,
    4: 556,
    5: 556,
    6: 556,
    7: 556,
    8: 556,
    9: 556,
    ":": 333,
    ";": 333,
    "<": 584,
    "=": 584,
    ">": 584,
    "?": 611,
    "@": 975,
    A: 722,
    B: 722,
    C: 722,
    D: 722,
    E: 667,
    F: 611,
    G: 778,
    H: 722,
    I: 278,
    J: 556,
    K: 722,
    L: 611,
    M: 833,
    N: 722,
    O: 778,
    P: 667,
    Q: 778,
    R: 722,
    S: 667,
    T: 611,
    U: 722,
    V: 667,
    W: 944,
    X: 667,
    Y: 667,
    Z: 611,
    "[": 333,
    "\\": 278,
    "]": 333,
    "^": 584,
    _: 556,
    "`": 333,
    a: 556,
    b: 611,
    c: 556,
    d: 611,
    e: 556,
    f: 333,
    g: 611,
    h: 611,
    i: 278,
    j: 278,
    k: 556,
    l: 278,
    m: 889,
    n: 611,
    o: 611,
    p: 611,
    q: 611,
    r: 389,
    s: 556,
    t: 333,
    u: 611,
    v: 556,
    w: 778,
    x: 556,
    y: 556,
    z: 500,
    "{": 389,
    "|": 280,
    "}": 389,
    "~": 584,

    "\u00A0": 278,

    "\u00AD": 333,
    "\u2010": 761,
    "\u2011": 761,
    "\u2012": 761,
    "\u2013": 556,
    "\u2014": 1000,
    "\u2015": 761,
    "\u2212": 549,

    "\u2026": 1000,
    "\u2022": 350,
    "\u00B7": 278,

    "\u2018": 278,
    "\u2019": 278,
    "\u201C": 500,
    "\u201D": 500
};

/**
 * Approximate character widths for Times-Roman (per 1000 units).
 * These are the standard Type 1 metrics for the core PDF Times faces. Using
 * Helvetica metrics for Times makes wrapping and centered/right alignment look
 * visibly wrong, especially in dense legal documents.
 * @type {Record<string, number>}
 */
const TIMES_ROMAN_WIDTHS = {
    " ": 250,
    "!": 333,
    '"': 408,
    "#": 500,
    $: 500,
    "%": 833,
    "&": 778,
    "'": 180,
    "(": 333,
    ")": 333,
    "*": 500,
    "+": 564,
    ",": 250,
    "-": 333,
    ".": 250,
    "/": 278,
    0: 500,
    1: 500,
    2: 500,
    3: 500,
    4: 500,
    5: 500,
    6: 500,
    7: 500,
    8: 500,
    9: 500,
    ":": 278,
    ";": 278,
    "<": 564,
    "=": 564,
    ">": 564,
    "?": 444,
    "@": 921,
    A: 722,
    B: 667,
    C: 667,
    D: 722,
    E: 611,
    F: 556,
    G: 722,
    H: 722,
    I: 333,
    J: 389,
    K: 722,
    L: 611,
    M: 889,
    N: 722,
    O: 722,
    P: 556,
    Q: 722,
    R: 667,
    S: 556,
    T: 611,
    U: 722,
    V: 722,
    W: 944,
    X: 722,
    Y: 722,
    Z: 611,
    "[": 333,
    "\\": 278,
    "]": 333,
    "^": 469,
    _: 500,
    "`": 333,
    a: 444,
    b: 500,
    c: 444,
    d: 500,
    e: 444,
    f: 333,
    g: 500,
    h: 500,
    i: 278,
    j: 278,
    k: 500,
    l: 278,
    m: 778,
    n: 500,
    o: 500,
    p: 500,
    q: 500,
    r: 333,
    s: 389,
    t: 278,
    u: 500,
    v: 500,
    w: 722,
    x: 500,
    y: 500,
    z: 444,
    "{": 480,
    "|": 200,
    "}": 480,
    "~": 541,

    " ": 250,
    "­": 333,
    "‐": 333,
    "‑": 333,
    "‒": 500,
    "–": 500,
    "—": 1000,
    "―": 1000,
    "−": 564,
    "…": 1000,
    "•": 350,
    "·": 250,
    "‘": 333,
    "’": 333,
    "“": 444,
    "”": 444
};

/** @type {Record<string, number>} */
const TIMES_BOLD_WIDTHS = {
    ...TIMES_ROMAN_WIDTHS,
    " ": 250,
    "!": 333,
    '"': 555,
    "%": 1000,
    "&": 833,
    "'": 278,
    "+": 570,
    ":": 333,
    ";": 333,
    "<": 570,
    "=": 570,
    ">": 570,
    "?": 500,
    "@": 930,
    A: 722,
    B: 667,
    C: 722,
    D: 722,
    E: 667,
    F: 611,
    G: 778,
    H: 778,
    I: 389,
    J: 500,
    K: 778,
    L: 667,
    M: 944,
    N: 722,
    O: 778,
    P: 611,
    Q: 778,
    R: 722,
    S: 556,
    T: 667,
    U: 722,
    V: 722,
    W: 1000,
    X: 722,
    Y: 722,
    Z: 667,
    a: 500,
    b: 556,
    c: 444,
    d: 556,
    e: 444,
    f: 333,
    g: 500,
    h: 556,
    i: 278,
    j: 333,
    k: 556,
    l: 278,
    m: 833,
    n: 556,
    o: 500,
    p: 556,
    q: 556,
    r: 444,
    s: 389,
    t: 333,
    u: 556,
    v: 500,
    w: 722,
    x: 500,
    y: 500,
    z: 444,
    "‘": 333,
    "’": 333,
    "“": 500,
    "”": 500
};

/** @type {Record<string, number>} */
const TIMES_ITALIC_WIDTHS = {
    ...TIMES_ROMAN_WIDTHS,
    '"': 420,
    "'": 214,
    "+": 675,
    "<": 675,
    "=": 675,
    ">": 675,
    "?": 500,
    "@": 920,
    A: 611,
    B: 611,
    C: 667,
    D: 722,
    E: 611,
    F: 611,
    G: 722,
    H: 722,
    I: 333,
    J: 444,
    K: 667,
    L: 556,
    M: 833,
    N: 667,
    O: 722,
    P: 611,
    Q: 722,
    R: 611,
    S: 500,
    T: 556,
    U: 722,
    V: 611,
    W: 833,
    X: 611,
    Y: 556,
    Z: 556,
    "[": 389,
    "]": 389,
    "^": 422,
    a: 500,
    b: 500,
    c: 444,
    d: 500,
    e: 444,
    f: 278,
    g: 500,
    h: 500,
    i: 278,
    j: 278,
    k: 444,
    l: 278,
    m: 722,
    n: 500,
    o: 500,
    p: 500,
    q: 500,
    r: 389,
    s: 389,
    t: 278,
    u: 500,
    v: 444,
    w: 667,
    x: 444,
    y: 444,
    z: 389
};

/** @type {Record<string, number>} */
const TIMES_BOLD_ITALIC_WIDTHS = {
    ...TIMES_BOLD_WIDTHS,
    "!": 389,
    "%": 833,
    "@": 832,
    A: 667,
    B: 667,
    C: 667,
    D: 722,
    E: 667,
    F: 667,
    G: 722,
    H: 778,
    I: 389,
    J: 500,
    K: 667,
    L: 611,
    M: 889,
    N: 722,
    O: 722,
    P: 611,
    Q: 722,
    R: 667,
    S: 556,
    T: 611,
    U: 722,
    V: 667,
    W: 889,
    X: 667,
    Y: 611,
    Z: 611,
    a: 500,
    b: 500,
    c: 444,
    d: 500,
    e: 444,
    f: 333,
    g: 500,
    h: 556,
    i: 278,
    j: 278,
    k: 500,
    l: 278,
    m: 778,
    n: 556,
    o: 500,
    p: 500,
    q: 500,
    r: 389,
    s: 389,
    t: 278,
    u: 556,
    v: 444,
    w: 667,
    x: 500,
    y: 444,
    z: 389
};

const COURIER_WIDTH = 600; // Monospace - all chars same width

const DEFAULT_CHAR_WIDTH = 556;

const EMBEDDED_FONT_METRICS_BY_ALIAS = new Map();

/**
 * Measure text width against parsed embedded font metrics.
 * Uses real cmap + hmtx lookups when available, including supplementary-plane
 * code points. Falls back to the legacy 0..255 width table only when needed.
 * @param {import("./font-embed.mjs").TtfParsed} embeddedMetrics
 * @param {string} text
 * @param {number} fontSize
 * @returns {number}
 */
function measureEmbeddedMetricsTextWidth(embeddedMetrics, text, fontSize) {
    let width = 0;
    for (let i = 0, len = text.length; i < len; ) {
        const codePoint = text.codePointAt(i);
        if (codePoint === undefined) {
            break;
        }

        if (typeof embeddedMetrics.widthForCodePoint === "function") {
            width = width + embeddedMetrics.widthForCodePoint(codePoint);
        } else {
            width =
                width +
                (codePoint < 256
                    ? embeddedMetrics.charWidths[codePoint]
                    : embeddedMetrics.missingWidth || 500);
        }

        i = i + (codePoint > 0xffff ? 2 : 1);
    }
    return (width / 1000) * fontSize;
}

// ============================================================================
// Font Width Lookup
// ============================================================================

/**
 * Get font metrics for a base font
 * @param {string} baseFont
 * @returns {Record<string, number> | number}
 */
export function getFontMetrics(baseFont) {
    if (baseFont === "Helvetica") {
        return HELVETICA_WIDTHS;
    }
    if (baseFont === "Helvetica-Bold") {
        return HELVETICA_BOLD_WIDTHS;
    }
    if (
        baseFont === "Helvetica-Oblique" ||
        baseFont === "Helvetica-BoldOblique"
    ) {
        return baseFont.includes("Bold")
            ? HELVETICA_BOLD_WIDTHS
            : HELVETICA_WIDTHS;
    }
    if (baseFont.startsWith("Courier")) {
        return COURIER_WIDTH;
    }
    if (baseFont === "Times-BoldItalic") {
        return TIMES_BOLD_ITALIC_WIDTHS;
    }
    if (baseFont === "Times-Bold") {
        return TIMES_BOLD_WIDTHS;
    }
    if (baseFont === "Times-Italic") {
        return TIMES_ITALIC_WIDTHS;
    }
    if (baseFont === "Times-Roman" || baseFont.startsWith("Times")) {
        return TIMES_ROMAN_WIDTHS;
    }
    return HELVETICA_WIDTHS;
}

/**
 * Measure text width in points
 * @param {string} text
 * @param {string} baseFont
 * @param {number} fontSize
 * @returns {number}
 */
export function measureTextWidth(text, baseFont, fontSize) {
    const embeddedMetrics = EMBEDDED_FONT_METRICS_BY_ALIAS.get(baseFont);
    let width = 0;

    if (embeddedMetrics) {
        return measureEmbeddedMetricsTextWidth(embeddedMetrics, text, fontSize);
    }

    const metrics = getFontMetrics(baseFont);

    if (typeof metrics === "number") {
        width = text.length * metrics;
    } else {
        for (let i = 0, len = text.length; i < len; i++) {
            const ch = text.charAt(i);
            const charWidth = metrics[ch];
            if (charWidth !== undefined) {
                width = width + charWidth;
            } else {
                width = width + DEFAULT_CHAR_WIDTH;
            }
        }
    }

    return (width / 1000) * fontSize;
}

/**
 * Normalize a page rotation to the [0, 360) range in multiples of 90.
 * @param {number} [rotate]
 * @returns {number}
 */
function normalizeRotation(rotate) {
    if (rotate === undefined || rotate === 0) {
        return 0;
    }
    if (!Number.isFinite(rotate) || rotate % 90 !== 0) {
        throw new Error(
            "PDF page rotation must be a multiple of 90, got " + rotate
        );
    }
    return ((rotate % 360) + 360) % 360;
}

/**
 * Format an alpha/number for an ExtGState value: clamp 0..1 and trim to a short
 * decimal.
 * @param {number} n
 * @returns {string}
 */
function formatGsNum(n) {
    const v = Math.max(0, Math.min(1, n));
    return String(Math.round(v * 1000) / 1000);
}

/**
 * Encode a string as a hex-string body of UTF-16BE bytes with a leading BOM,
 * for PDF text strings that must survive non-ASCII (e.g. Unicode filenames).
 * @param {string} str
 * @returns {string}
 */
function utf16beHex(str) {
    let hex = "FEFF";
    for (let i = 0, len = str.length; i < len; i++) {
        hex =
            hex + str.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
    }
    return hex;
}

// ============================================================================
// PDF Document Builder Class
// ============================================================================

export class PdfDocumentBuilder {
    /**
     * @param {PdfDocumentOptions} [options]
     */
    constructor(options) {
        const opts = options || {};
        /** @type {number} */
        this.pageWidth = opts.width !== undefined ? opts.width : 612;
        /** @type {number} */
        this.pageHeight = opts.height !== undefined ? opts.height : 792;
        /** @type {string | undefined} */
        this.title = opts.title;
        /** @type {string | undefined} */
        this.author = opts.author;
        /** @type {string | undefined} */
        this.subject = opts.subject;
        /** @type {string | undefined} */
        this.creator = opts.creator;
        /** @type {string | null | undefined} */
        this.producer = opts.producer;
        /** @type {string | undefined} */
        this.keywords = opts.keywords;
        /** @type {boolean} */
        this.includeDates = opts.includeDates !== false;
        /** @type {boolean} XMP /Metadata stream */
        this.xmpEnabled = opts.metadata === true;

        // PDF/A conformance: normalize `pdfa` ("2b" / "2a" / 2) to part + level.
        /** @type {number | undefined} */
        this.pdfaPart = undefined;
        /** @type {string | undefined} */
        this.pdfaConformance = undefined;
        if (opts.pdfa) {
            const spec = String(opts.pdfa).toUpperCase();
            const m = /^(\d+)([AB])?$/.exec(spec);
            this.pdfaPart = m ? parseInt(m[1], 10) : 2;
            this.pdfaConformance = m && m[2] ? m[2] : "B";
            this.xmpEnabled = true; // PDF/A requires XMP
        }

        // Output intent (ICC). Enabled explicitly, or defaulted to sRGB for PDF/A.
        /** @type {{ iccProfile: Uint8Array, n: number, identifier: string, info: string } | undefined} */
        this.outputIntent = undefined;
        if (opts.outputIntent) {
            this.outputIntent = {
                iccProfile: opts.outputIntent.iccProfile || getSrgbIccProfile(),
                n: opts.outputIntent.n || 3,
                identifier: opts.outputIntent.identifier || "sRGB IEC61966-2.1",
                info: opts.outputIntent.info || "sRGB IEC61966-2.1"
            };
        } else if (opts.pdfa) {
            this.outputIntent = {
                iccProfile: getSrgbIccProfile(),
                n: 3,
                identifier: "sRGB IEC61966-2.1",
                info: "sRGB IEC61966-2.1"
            };
        }
        /** @type {boolean} */
        this.omitInfo = opts.omitInfo === true;
        /** @type {boolean} */
        this.compressStreams = opts.compress !== false;
        /** @type {EncryptionOptions | undefined} */
        this.encryption = opts.encryption;

        if (opts.pdfa && opts.encryption) {
            throw new Error("PDF/A does not permit encryption");
        }

        /** @type {PageData[]} */
        this.pages = [];

        /** @type {Map<string, PdfFontInfo>} */
        this.fonts = new Map();
        this.nextFontId = 1;

        /** @type {Map<string, string>} */
        this.namedFonts = new Map();

        /** @type {Map<string, EmbeddedFontInfo>} */
        this.embeddedFonts = new Map();

        /** @type {Map<string, CIDFontInfo>} */
        this.cidFonts = new Map();

        /** @type {Map<string, ImageXObjectInfo>} */
        this.images = new Map();
        this.nextImageId = 1;

        /** @type {Map<string, FormXObjectInfo>} */
        this.forms = new Map();
        this.nextFormId = 1;

        /** @type {AttachmentInfo[]} */
        this.attachments = [];

        /** @type {Map<string, string>} Inline shading dicts keyed by resource name */
        this.shadings = new Map();

        /** @type {Map<string, string>} Inline ExtGState dicts keyed by resource name */
        this.extGStates = new Map();
        this.nextGStateId = 1;

        /** @type {Map<string, string>} Inline color space arrays keyed by resource name */
        this.colorSpaces = new Map();
        this.nextColorSpaceId = 1;

        /** @type {OutlineItem[]} */
        this.outlineItems = [];

        /** @type {boolean} emit a structure tree (tagged PDF) */
        this.taggedEnabled = opts.tagged === true;
        /** @type {{ pageIndex: number, type: string, mcid: number, alt?: string }[]} */
        this.structItems = [];

        // Register standard fonts
        this.registerFont("Helvetica");
        this.registerFont("Helvetica-Bold");
        this.registerFont("Helvetica-Oblique");
        this.registerFont("Courier");
        this.registerFont("Courier-Bold");
        this.registerFont("Times-Roman");
        this.registerFont("Times-Bold");
        this.registerFont("Times-Italic");
        this.registerFont("Times-BoldItalic");
    }

    /**
     * Sanitize a PDF Name token (used for resources: /F1, /Im1, etc).
     * Keep it ASCII-safe and delimiter-free.
     * @param {string} name
     * @returns {string}
     */
    sanitizePdfName(name) {
        return String(name).replace(/[^A-Za-z0-9_.-]/g, "_");
    }

    /**
     * Set or update document metadata
     * @param {Object} metadata
     * @param {string} [metadata.title]
     * @param {string} [metadata.author]
     * @param {string} [metadata.subject]
     * @param {string} [metadata.creator]
     * @param {string | null} [metadata.producer]
     * @param {boolean} [metadata.includeDates]
     * @returns {this}
     */
    setMetadata(metadata) {
        if (metadata.title !== undefined) this.title = metadata.title;
        if (metadata.author !== undefined) this.author = metadata.author;
        if (metadata.subject !== undefined) this.subject = metadata.subject;
        if (metadata.creator !== undefined) this.creator = metadata.creator;
        if (metadata.producer !== undefined) this.producer = metadata.producer;
        if (metadata.includeDates !== undefined)
            this.includeDates = metadata.includeDates;
        return this;
    }

    /**
     * Register a Type1 font
     * @param {string} baseFont
     * @returns {string} Resource name
     */
    registerFont(baseFont, srcBytes) {
        // Overload:
        //   registerFont("Helvetica")                  -> Type1 built-in
        //   registerFont("Lilex", Uint8Array(woff2))    -> Embedded font under alias

        const alias = String(baseFont);

        // Embedded font registration
        if (srcBytes !== undefined) {
            const existing = this.namedFonts.get(alias);
            if (existing) {
                return existing;
            }

            const bytes =
                srcBytes instanceof Uint8Array
                    ? srcBytes
                    : srcBytes instanceof ArrayBuffer
                    ? new Uint8Array(srcBytes)
                    : null;
            if (!bytes) {
                throw new Error("registerFont: srcBytes must be Uint8Array");
            }

            // Detect WOFF2 container: "wOF2"
            const isWoff2 =
                bytes.length >= 4 &&
                bytes[0] === 0x77 &&
                bytes[1] === 0x4f &&
                bytes[2] === 0x46 &&
                bytes[3] === 0x32;

            let resName;
            if (isWoff2) {
                resName = this.registerWoff2(bytes);
            } else {
                // TrueType/OpenType (TT outlines) typically starts with 0x00010000 or "true".
                resName = this.registerEmbeddedFont(bytes);
            }

            this.namedFonts.set(alias, resName);

            const embeddedInfo = this.embeddedFonts.get(resName);
            if (embeddedInfo?.metrics) {
                EMBEDDED_FONT_METRICS_BY_ALIAS.set(alias, embeddedInfo.metrics);
            }

            return resName;
        }

        // Built-in Type1 registration
        const mapped = this.namedFonts.get(alias);
        if (mapped) {
            return mapped;
        }

        if (this.fonts.has(alias)) {
            const existing = this.fonts.get(alias);
            const res = existing ? existing.name : "F1";
            this.namedFonts.set(alias, res);
            return res;
        }

        const name = "F" + this.nextFontId;
        this.nextFontId = this.nextFontId + 1;

        this.fonts.set(alias, {
            name,
            baseFont: alias,
            objectId: 0 // Will be assigned during build
        });

        this.namedFonts.set(alias, name);
        return name;
    }

    /**
     * Get font resource name
     * @param {string} baseFont
     * @returns {string}
     */
    getFontName(baseFont) {
        const key = String(baseFont);
        const mapped = this.namedFonts.get(key);
        if (mapped) {
            return mapped;
        }
        const info = this.fonts.get(key);
        if (info) {
            this.namedFonts.set(key, info.name);
            return info.name;
        }
        return this.registerFont(key);
    }

    /**
     * Embed a PNG/JPEG as an XObject under a stable resource name.
     * This is useful when upstream rendering (e.g. SVG) wants deterministic names.
     *
     * @param {string} name
     * @param {Uint8Array} bytes
     * @returns {string} resource name
     */
    embedImageXObject(name, bytes) {
        const safe = this.sanitizePdfName(name);
        if (this.images.has(safe)) {
            return safe;
        }

        // JPEG
        if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
            const parsed = parseJpeg(bytes);
            this.images.set(safe, {
                name: safe,
                format: "jpeg",
                parsed,
                xObjectId: 0
            });
            return safe;
        }

        // PNG signature
        if (
            bytes.length >= 8 &&
            bytes[0] === 0x89 &&
            bytes[1] === 0x50 &&
            bytes[2] === 0x4e &&
            bytes[3] === 0x47 &&
            bytes[4] === 0x0d &&
            bytes[5] === 0x0a &&
            bytes[6] === 0x1a &&
            bytes[7] === 0x0a
        ) {
            const parsed = parsePng(bytes);
            this.images.set(safe, {
                name: safe,
                format: "png",
                parsed,
                xObjectId: 0,
                smaskId: parsed.smaskData ? 0 : undefined
            });
            return safe;
        }

        throw new Error(`Unsupported image format for XObject: ${safe}`);
    }

    /**
     * Register a WOFF2 font for embedding.
     * Decompresses the Brotli-encoded WOFF2 container and reconstructs a valid TTF
     * (including the glyf/loca transform). Returns the resource name for use with setFont().
     * @param {Uint8Array} woff2Bytes - raw .woff2 file bytes
     * @returns {string} resource name
     */
    registerWoff2(woff2Bytes) {
        const metrics = parseWoff2(woff2Bytes);
        const name = "F" + this.nextFontId;
        this.nextFontId = this.nextFontId + 1;
        this.embeddedFonts.set(name, {
            name,
            metrics,
            fontDictId: 0,
            descriptorId: 0,
            fileStreamId: 0
        });
        return name;
    }

    /**
     * Register a TrueType / OpenType (TT outlines) font for embedding.
     * Returns the resource name (e.g. "F10") for use with setFont().
     * The font bytes are parsed immediately; the font is embedded verbatim on build().
     * @param {Uint8Array} fontBytes - raw .ttf / .otf (TT outlines) file bytes
     * @returns {string} resource name
     */
    registerEmbeddedFont(fontBytes) {
        const metrics = parseTtfFont(fontBytes);
        const name = "F" + this.nextFontId;
        this.nextFontId = this.nextFontId + 1;
        this.embeddedFonts.set(name, {
            name,
            metrics,
            fontDictId: 0, // assigned during build()
            descriptorId: 0,
            fileStreamId: 0
        });
        return name;
    }

    /**
     * Register a TrueType font for full-Unicode use as a composite (Type0)
     * font. Unlike registerFont/registerEmbeddedFont (WinAnsi, 256 glyphs), this
     * supports any Unicode text the font covers — CJK, Greek, Cyrillic, symbols.
     *
     * Draw with it by encoding the text to glyph ids first:
     *   const f = doc.registerCIDFont(ttf);
     *   cs.setFont(f, 24).showGlyphHex(doc.encodeCIDText(f, "Ωμέγα Привет"));
     * @param {Uint8Array} fontBytes - raw TrueType (.ttf) bytes
     * @returns {string} resource name (e.g. "F1")
     */
    registerCIDFont(fontBytes) {
        const metrics = parseTtfFont(fontBytes);
        const name = "F" + this.nextFontId;
        this.nextFontId = this.nextFontId + 1;
        this.cidFonts.set(name, {
            name,
            metrics,
            usedGlyphs: new Map(),
            fontDictId: 0,
            cidFontId: 0,
            descriptorId: 0,
            fileStreamId: 0,
            toUnicodeId: 0
        });
        return name;
    }

    /**
     * Encode text into a hex string of 2-byte glyph ids for a composite font,
     * recording the glyphs used (for the /W array and /ToUnicode map). Pass the
     * result to PdfContentStreamBuilder#showGlyphHex.
     * @param {string} fontName - a name returned by registerCIDFont
     * @param {string} text
     * @returns {string} hex glyph string
     */
    encodeCIDText(fontName, text) {
        const cid = this.cidFonts.get(fontName);
        if (!cid) {
            throw new Error("encodeCIDText: unknown CID font " + fontName);
        }
        let hex = "";
        for (const ch of text) {
            const cp = ch.codePointAt(0);
            const gid = cid.metrics.glyphIdForCodePoint(cp);
            // Record even gid 0 (.notdef) so extraction still yields the intended
            // character even where the glyph is missing.
            cid.usedGlyphs.set(gid, cp);
            hex = hex + gid.toString(16).toUpperCase().padStart(4, "0");
        }
        return hex;
    }

    /**
     * Measure the advance width of text in a composite font.
     * @param {string} fontName
     * @param {string} text
     * @param {number} fontSize - in points
     * @returns {number} width in points
     */
    measureCIDText(fontName, text, fontSize) {
        const cid = this.cidFonts.get(fontName);
        if (!cid) {
            return 0;
        }
        let units = 0;
        for (const ch of text) {
            const cp = ch.codePointAt(0);
            const gid = cid.metrics.glyphIdForCodePoint(cp);
            units = units + cid.metrics.widthForGlyphId(gid);
        }
        return (units / 1000) * fontSize;
    }

    /**
     * Register an alias that resolves to a built-in Type1 font.
     * Used when an embedded font file is missing — the alias (e.g. "CormorantGaramond-Regular")
     * is silently remapped to a PDF standard font so rendering continues without a broken font ref.
     * No-op if the alias is already registered.
     * @param {string} alias
     * @param {string} builtinBaseFont  - e.g. "Times-Roman", "Times-Bold"
     * @returns {void}
     */
    registerBuiltinAlias(alias, builtinBaseFont) {
        if (this.namedFonts.has(alias)) {
            return;
        }
        const resName = this.registerFont(builtinBaseFont);
        this.namedFonts.set(alias, resName);
    }

    /**
     * Measure text width for an embedded TrueType font.
     * @param {string} resourceName - resource name returned by registerEmbeddedFont()
     * @param {string} text
     * @param {number} fontSize - in points
     * @returns {number} width in points
     */
    measureEmbeddedFontText(resourceName, text, fontSize) {
        const info = this.embeddedFonts.get(resourceName);
        if (!info) {
            return 0;
        }
        return measureEmbeddedMetricsTextWidth(info.metrics, text, fontSize);
    }

    /**
     * Register a JPEG image for embedding.
     * Returns the XObject resource name (e.g. "Im1") for use with drawImage().
     * @param {Uint8Array} jpegBytes
     * @returns {string} resource name
     */
    registerJpeg(jpegBytes) {
        const parsed = parseJpeg(jpegBytes);
        const name = "Im" + this.nextImageId;
        this.nextImageId = this.nextImageId + 1;
        this.images.set(name, {
            name,
            format: "jpeg",
            parsed,
            xObjectId: 0 // assigned during build()
        });
        return name;
    }

    /**
     * Register a PNG image for embedding.
     * Alpha channels (RGBA / Grayscale+Alpha) are automatically handled via a PDF SMask.
     * Returns the XObject resource name (e.g. "Im1") for use with drawImage().
     * @param {Uint8Array} pngBytes
     * @returns {string} resource name
     */
    registerPng(pngBytes) {
        const parsed = parsePng(pngBytes);
        const name = "Im" + this.nextImageId;
        this.nextImageId = this.nextImageId + 1;
        this.images.set(name, {
            name,
            format: "png",
            parsed,
            xObjectId: 0,
            smaskId: parsed.smaskData ? 0 : undefined
        });
        return name;
    }

    /**
     * Register a Form XObject: a self-contained content stream (vector + text)
     * that can be painted on any number of pages via `Do`, e.g. a watermark, a
     * repeated header/footer, or a logo. Drawing it once and referencing it
     * keeps the file small.
     *
     * The form shares the document's resource dictionary, so any font or image
     * (and any other form) registered on the document is usable inside it by the
     * same resource name.
     *
     * Paint it with PdfContentStreamBuilder#drawForm(name) in a page's content
     * stream. Returns the XObject resource name (e.g. "Fm1").
     * @param {Uint8Array | string} content - form content stream operators
     * @param {{ bbox?: [number, number, number, number], matrix?: [number, number, number, number, number, number] }} [options] - bbox defaults to the full document page
     * @returns {string} resource name
     */
    registerFormXObject(content, options) {
        const opts = options || {};
        const bytes =
            typeof content === "string" ? encodeUtf8(content) : content;
        const name = "Fm" + this.nextFormId;
        this.nextFormId = this.nextFormId + 1;
        this.forms.set(name, {
            name,
            contentStream: bytes,
            bbox: opts.bbox || [0, 0, this.pageWidth, this.pageHeight],
            matrix: opts.matrix,
            xObjectId: 0
        });
        return name;
    }

    /**
     * Attach a file to the document (an embedded file / "paperclip" attachment).
     * The file is added to the /EmbeddedFiles name tree so viewers list it; if a
     * `relationship` is given it is additionally recorded as a document-level
     * associated file (/AF + /AFRelationship), which is what Factur-X / ZUGFeRD
     * and PDF/A-3 require for an embedded invoice XML.
     * @param {Uint8Array | string} content - file contents
     * @param {string} name - filename shown in the viewer (e.g. "invoice.xml")
     * @param {{ mimeType?: string, description?: string, relationship?: "Source" | "Data" | "Alternative" | "Supplement" | "EncryptedPayload" | "FormData" | "Schema" | "Unspecified" }} [options]
     * @returns {this}
     */
    attachFile(content, name, options) {
        const opts = options || {};
        const bytes =
            typeof content === "string" ? encodeUtf8(content) : content;
        this.attachments.push({
            bytes,
            name,
            mimeType: opts.mimeType,
            description: opts.description,
            relationship: opts.relationship,
            streamId: 0,
            filespecId: 0
        });
        return this;
    }

    /**
     * Register an inline axial/radial shading resource.
     * The dict string is embedded directly in the /Shading resource dict
     * (no separate indirect object needed).
     * @param {string} name - Resource name, e.g. "Sh1"
     * @param {string} dictStr - Complete PDF shading dictionary string
     * @returns {string} name
     */
    registerShading(name, dictStr) {
        if (!this.shadings.has(name)) {
            this.shadings.set(name, dictStr);
        }
        return name;
    }

    /**
     * Register a graphics state for transparency and blend modes. Apply it in a
     * content stream with PdfContentStreamBuilder#setExtGState(name), e.g. for a
     * semi-transparent watermark: registerExtGState({ fillAlpha: 0.3 }).
     * @param {{ fillAlpha?: number, strokeAlpha?: number, blendMode?: string }} options
     *   fillAlpha/strokeAlpha are 0..1; blendMode is a PDF blend mode name
     *   (e.g. "Normal", "Multiply", "Screen", "Overlay", "Darken").
     * @returns {string} resource name (e.g. "GS1")
     */
    registerExtGState(options) {
        const opts = options || {};
        /** @type {Record<string, string>} */
        const dict = { Type: "/ExtGState" };
        if (opts.fillAlpha !== undefined) {
            dict.ca = formatGsNum(opts.fillAlpha);
        }
        if (opts.strokeAlpha !== undefined) {
            dict.CA = formatGsNum(opts.strokeAlpha);
        }
        if (opts.blendMode) {
            dict.BM = "/" + opts.blendMode;
        }
        const name = "GS" + this.nextGStateId;
        this.nextGStateId = this.nextGStateId + 1;
        this.extGStates.set(name, formatDictionary(dict));
        return name;
    }

    /**
     * Register a spot (Separation) color for print — e.g. a Pantone ink. The
     * colorant is named and given a DeviceCMYK equivalent; content sets it by
     * tint (0..1) via PdfContentStreamBuilder#setFillSpot(name, tint).
     * @param {string} colorantName - ink name (e.g. "PANTONE 185 C")
     * @param {[number, number, number, number]} cmykEquivalent - fallback CMYK, each 0-1
     * @returns {string} resource name (e.g. "CS1")
     */
    registerSpotColor(colorantName, cmykEquivalent) {
        const cmyk = cmykEquivalent || [0, 0, 0, 1];
        // Type 2 (exponential) tint transform: tint t -> t * cmyk.
        const tintFn = formatDictionary({
            FunctionType: "2",
            Domain: "[0 1]",
            C0: "[0 0 0 0]",
            C1: "[" + cmyk.map((n) => String(n)).join(" ") + "]",
            N: "1"
        });
        const separation =
            "[/Separation " +
            escapePdfName(colorantName) +
            " /DeviceCMYK " +
            tintFn +
            "]";
        const name = "CS" + this.nextColorSpaceId;
        this.nextColorSpaceId = this.nextColorSpaceId + 1;
        this.colorSpaces.set(name, separation);
        return name;
    }

    /**
     * Add a page with content stream
     * @param {Uint8Array} contentStream
     * @param {(LinkAnnotation | FormFieldAnnotation)[]} [annotations]
     * @param {PageOptions} [options] - Per-page size / rotation overrides
     * @returns {this}
     */
    addPage(contentStream, annotations, options) {
        const opts = options || {};
        this.pages.push({
            contentStream,
            annotations: annotations || [],
            width: opts.width !== undefined ? opts.width : this.pageWidth,
            height: opts.height !== undefined ? opts.height : this.pageHeight,
            rotate: normalizeRotation(opts.rotate)
        });
        return this;
    }

    /**
     * Add a page from string content
     * @param {string} content
     * @param {(LinkAnnotation | FormFieldAnnotation)[]} [annotations]
     * @param {PageOptions} [options] - Per-page size / rotation overrides
     * @returns {this}
     */
    addPageFromString(content, annotations, options) {
        return this.addPage(encodeUtf8(content), annotations, options);
    }

    /**
     * Add a page together with its logical structure, producing tagged (accessible)
     * PDF. The content stream should wrap each logical unit in a marked-content
     * sequence via PdfContentStreamBuilder#beginMarkedContent(type, mcid); the
     * `structure` array names each element and the matching MCID.
     *
     *   const cs = new PdfContentStreamBuilder();
     *   cs.beginMarkedContent("H1", 0).beginText()…showText("Title").endText().endMarkedContent();
     *   cs.beginMarkedContent("P", 1).beginText()…showText("Body").endText().endMarkedContent();
     *   doc.addTaggedPage(cs.build(), [{ type: "H1", mcid: 0 }, { type: "P", mcid: 1 }]);
     *
     * @param {string | Uint8Array} content
     * @param {{ type: string, mcid: number, alt?: string }[]} structure
     * @param {(LinkAnnotation | FormFieldAnnotation)[]} [annotations]
     * @param {PageOptions} [options]
     * @returns {this}
     */
    addTaggedPage(content, structure, annotations, options) {
        this.taggedEnabled = true;
        const pageIndex = this.pages.length;
        const bytes =
            typeof content === "string" ? encodeUtf8(content) : content;
        this.addPage(bytes, annotations, options);
        for (let i = 0, len = structure.length; i < len; i++) {
            this.structItems.push({
                pageIndex,
                type: structure[i].type,
                mcid: structure[i].mcid,
                alt: structure[i].alt
            });
        }
        return this;
    }

    /**
     * Add a single outline (bookmark) item
     * @param {OutlineItem} item
     * @returns {this}
     */
    addOutlineItem(item) {
        this.outlineItems.push(item);
        return this;
    }

    /**
     * Set all outline (bookmark) items at once
     * @param {OutlineItem[]} items
     * @returns {this}
     */
    setOutlineItems(items) {
        this.outlineItems = items;
        return this;
    }

    /**
     * Build the complete PDF
     * @returns {Uint8Array}
     */
    build() {
        /** @type {Uint8Array[]} */
        const chunks = [];
        /** @type {number[]} */
        const objectOffsets = [];
        let currentOffset = 0;

        // Helper to write and track offset
        /**
         * @param {Uint8Array} data
         */
        const write = (data) => {
            chunks.push(data);
            currentOffset = currentOffset + data.length;
        };

        /**
         * @param {string} str
         */
        const writeStr = (str) => {
            write(encodeUtf8(str));
        };

        // Encryption context (V4/R4/AESV2). When present, every string and
        // stream is encrypted per object; the /Encrypt dict and trailer /ID are
        // exempt (written directly, not through the emit helpers below).
        const fileId = this.encryption ? randomFileId() : null;
        const enc = this.encryption
            ? createEncryption(
                  this.encryption,
                  /** @type {Uint8Array} */ (fileId)
              )
            : null;

        /**
         * Write a non-stream indirect object, encrypting its strings when enabled.
         * @param {number} id
         * @param {string} body
         */
        const emitObject = (id, body) => {
            const finalBody = enc ? enc.encryptStringsInObject(id, body) : body;
            objectOffsets.push(currentOffset);
            writeStr(formatIndirectObject(id, finalBody));
        };

        /**
         * Write a stream indirect object. `streamBytes` must already be filtered
         * (e.g. Flate-compressed); this applies encryption and sets /Length to the
         * final byte count. Any /Length in `dictEntries` is overridden.
         * @param {number} id
         * @param {Record<string, string>} dictEntries
         * @param {Uint8Array} streamBytes
         */
        const emitStream = (id, dictEntries, streamBytes) => {
            const finalStream = enc
                ? enc.encrypt(id, streamBytes)
                : streamBytes;
            const entries = {
                ...dictEntries,
                Length: String(finalStream.length)
            };
            let dictStr = formatDictionary(entries);
            if (enc) {
                dictStr = enc.encryptStringsInObject(id, dictStr);
            }
            objectOffsets.push(currentOffset);
            writeStr(`${id} 0 obj\n${dictStr}\nstream\n`);
            write(finalStream);
            writeStr("\nendstream\nendobj\n");
        };

        // PDF Header
        const header = createPdfHeader(
            this.pdfaPart && this.pdfaPart >= 2 ? "%PDF-1.7" : undefined
        );
        write(header);

        // Object IDs:
        // 1 = Catalog
        // 2 = Pages
        // 3 = Resources
        // 4... = Fonts
        // after fonts = Pages, their content streams, and annotations
        // last = Info (optional)

        let nextObjId = 1;
        const catalogId = nextObjId++;
        const pagesId = nextObjId++;
        const resourcesId = nextObjId++;

        // Assign font object IDs
        const fontEntries = Array.from(this.fonts.values());
        for (let i = 0, len = fontEntries.length; i < len; i++) {
            fontEntries[i].objectId = nextObjId++;
        }

        // Assign embedded font triple IDs (fontDict + descriptor + fileStream)
        const embeddedFontEntries = Array.from(this.embeddedFonts.values());
        for (let i = 0, len = embeddedFontEntries.length; i < len; i++) {
            const ef = embeddedFontEntries[i];
            ef.fontDictId = nextObjId++;
            ef.descriptorId = nextObjId++;
            ef.fileStreamId = nextObjId++;
        }

        // One shared /ToUnicode CMap stream serves every embedded WinAnsi font.
        const toUnicodeId =
            embeddedFontEntries.length > 0 ? nextObjId++ : undefined;

        // CID (Type0) fonts: Type0 dict + descendant CIDFontType2 + descriptor +
        // FontFile2 stream + per-font ToUnicode stream.
        const cidFontEntries = Array.from(this.cidFonts.values());
        for (let i = 0, len = cidFontEntries.length; i < len; i++) {
            const cf = cidFontEntries[i];
            cf.fontDictId = nextObjId++;
            cf.cidFontId = nextObjId++;
            cf.descriptorId = nextObjId++;
            cf.fileStreamId = nextObjId++;
            cf.toUnicodeId = nextObjId++;
        }

        // Assign image XObject IDs (image stream + optional SMask stream)
        const imageEntries = Array.from(this.images.values());
        for (let i = 0, len = imageEntries.length; i < len; i++) {
            const img = imageEntries[i];
            img.xObjectId = nextObjId++;
            if (img.smaskId !== undefined) {
                img.smaskId = nextObjId++;
            }
        }

        // Assign form XObject IDs (share the /XObject namespace with images)
        const formEntries = Array.from(this.forms.values());
        for (let i = 0, len = formEntries.length; i < len; i++) {
            formEntries[i].xObjectId = nextObjId++;
        }

        // Calculate page, content stream, and annotation IDs
        /** @type {{ pageId: number; contentId: number; annotIds: number[] }[]} */
        const pageObjects = [];
        for (let i = 0, len = this.pages.length; i < len; i++) {
            const pageData = this.pages[i];
            const pageId = nextObjId++;
            const contentId = nextObjId++;

            // Reserve IDs for annotations
            /** @type {number[]} */
            const annotIds = [];
            for (let j = 0, jlen = pageData.annotations.length; j < jlen; j++) {
                annotIds.push(nextObjId++);
            }

            pageObjects.push({ pageId, contentId, annotIds });
        }

        /** @type {number[]} */
        const formFieldObjectIds = [];
        let hasSignatureField = false;
        for (let i = 0, len = this.pages.length; i < len; i++) {
            const pageData = this.pages[i];
            const annotIds = pageObjects[i].annotIds;
            for (let j = 0, jlen = pageData.annotations.length; j < jlen; j++) {
                const annotation = pageData.annotations[j];
                if (annotation?.type !== "form") {
                    continue;
                }
                formFieldObjectIds.push(annotIds[j]);
                if (annotation.fieldType === "signature") {
                    hasSignatureField = true;
                }
            }
        }

        const acroFormId =
            formFieldObjectIds.length > 0 ? nextObjId++ : undefined;

        // Outline (bookmark) objects — allocate before Info so write order matches ID order
        const hasOutlines = this.outlineItems.length > 0;
        const outlinesRootId = hasOutlines ? nextObjId++ : undefined;
        /** @type {number[]} */
        const outlineItemIds = [];
        if (hasOutlines) {
            for (let i = 0, len = this.outlineItems.length; i < len; i++) {
                outlineItemIds.push(nextObjId++);
            }
        }

        // Embedded file attachment objects: stream + filespec per file, then a
        // shared /EmbeddedFiles name-tree dictionary.
        const hasAttachments = this.attachments.length > 0;
        for (let i = 0, len = this.attachments.length; i < len; i++) {
            this.attachments[i].streamId = nextObjId++;
            this.attachments[i].filespecId = nextObjId++;
        }
        const namesDictId = hasAttachments ? nextObjId++ : undefined;

        /** @type {Record<string, string> | undefined} */
        let catalogExtra;
        let namesDictStr = "";
        if (hasAttachments) {
            // Name-tree keys must be unique and sorted; the visible filename
            // comes from the filespec, so the key is just an identifier.
            /** @type {Set<string>} */
            const usedKeys = new Set();
            /** @type {{ key: string; filespecId: number }[]} */
            const treeEntries = [];
            for (let i = 0, len = this.attachments.length; i < len; i++) {
                const a = this.attachments[i];
                let key = a.name;
                let n = 2;
                while (usedKeys.has(key)) {
                    key = a.name + " (" + n + ")";
                    n = n + 1;
                }
                usedKeys.add(key);
                treeEntries.push({ key, filespecId: a.filespecId });
            }
            treeEntries.sort((x, y) =>
                x.key < y.key ? -1 : x.key > y.key ? 1 : 0
            );
            const namesArr = treeEntries
                .map(
                    (e) =>
                        `(${escapePdfString(e.key)}) ${formatRef(e.filespecId)}`
                )
                .join(" ");
            namesDictStr = formatDictionary({
                EmbeddedFiles: formatDictionary({ Names: `[${namesArr}]` })
            });

            catalogExtra = { Names: formatRef(namesDictId) };
            const afRefs = [];
            for (let i = 0, len = this.attachments.length; i < len; i++) {
                if (this.attachments[i].relationship) {
                    afRefs.push(formatRef(this.attachments[i].filespecId));
                }
            }
            if (afRefs.length > 0) {
                catalogExtra.AF = formatArray(afRefs);
            }
        }

        // Info object - respect omitInfo option
        const hasMetadata =
            this.title || this.author || this.subject || this.creator;
        const shouldIncludeInfo = !this.omitInfo && hasMetadata;
        const infoId = shouldIncludeInfo ? nextObjId++ : undefined;

        // XMP metadata stream (catalog /Metadata).
        const metadataId = this.xmpEnabled ? nextObjId++ : undefined;
        let xmpBytes = null;
        if (metadataId !== undefined) {
            const now = new Date();
            xmpBytes = encodeUtf8(
                buildXmp({
                    title: this.title,
                    author: this.author,
                    subject: this.subject,
                    creator: this.creator,
                    producer:
                        this.producer === null ? undefined : this.producer,
                    keywords: this.keywords,
                    createDate: this.includeDates ? now : undefined,
                    modifyDate: this.includeDates ? now : undefined,
                    pdfaPart: this.pdfaPart,
                    pdfaConformance: this.pdfaConformance
                })
            );
            if (!catalogExtra) {
                catalogExtra = {};
            }
            catalogExtra.Metadata = formatRef(metadataId);
        }

        // Output intent (ICC profile stream + catalog /OutputIntents).
        const iccStreamId = this.outputIntent ? nextObjId++ : undefined;
        if (this.outputIntent && iccStreamId !== undefined) {
            if (!catalogExtra) {
                catalogExtra = {};
            }
            const oiDict = formatDictionary({
                Type: "/OutputIntent",
                S: "/GTS_PDFA1",
                OutputConditionIdentifier:
                    "(" + escapePdfString(this.outputIntent.identifier) + ")",
                Info: "(" + escapePdfString(this.outputIntent.info) + ")",
                DestOutputProfile: formatRef(iccStreamId)
            });
            catalogExtra.OutputIntents = "[" + oiDict + "]";
        }

        // Encrypt dictionary object (last; exempt from encryption itself).
        const encryptId = enc ? nextObjId++ : undefined;

        // Tagged PDF: structure-tree object ids + per-page StructParents indices.
        const taggedItems = this.taggedEnabled ? this.structItems : [];
        const hasTags = taggedItems.length > 0;
        /** @type {Map<number, number>} pageIndex -> StructParents index */
        const structParentsByPage = new Map();
        /** @type {number | undefined} */
        let structTreeRootId;
        /** @type {number | undefined} */
        let parentTreeId;
        /** @type {number[]} structItem index -> StructElem object id */
        const structElemIds = [];
        if (hasTags) {
            const taggedPages = Array.from(
                new Set(taggedItems.map((it) => it.pageIndex))
            ).sort((a, b) => a - b);
            for (let i = 0, len = taggedPages.length; i < len; i++) {
                structParentsByPage.set(taggedPages[i], i);
            }
            structTreeRootId = nextObjId++;
            parentTreeId = nextObjId++;
            for (let i = 0, len = taggedItems.length; i < len; i++) {
                structElemIds.push(nextObjId++);
            }
            if (!catalogExtra) {
                catalogExtra = {};
            }
            catalogExtra.StructTreeRoot = formatRef(structTreeRootId);
            catalogExtra.MarkInfo = "<< /Marked true >>";
        }

        // Object 0 placeholder for xref
        objectOffsets.push(0);

        // Write Catalog (object 1)
        emitObject(
            catalogId,
            createCatalog(pagesId, outlinesRootId, acroFormId, catalogExtra)
        );

        // Write Pages (object 2)
        const pageRefs = pageObjects.map((p) => p.pageId);
        emitObject(pagesId, createPages(pageRefs, this.pages.length));

        // Write Resources (object 3)
        /** @type {Record<string, number>} */
        const fontResourceMap = {};
        for (let i = 0, len = fontEntries.length; i < len; i++) {
            const font = fontEntries[i];
            fontResourceMap[font.name] = font.objectId;
        }
        for (let i = 0, len = embeddedFontEntries.length; i < len; i++) {
            const ef = embeddedFontEntries[i];
            fontResourceMap[ef.name] = ef.fontDictId;
        }
        for (let i = 0, len = cidFontEntries.length; i < len; i++) {
            const cf = cidFontEntries[i];
            fontResourceMap[cf.name] = cf.fontDictId;
        }
        /** @type {Record<string, number>} */
        const xObjectResourceMap = {};
        for (let i = 0, len = imageEntries.length; i < len; i++) {
            const img = imageEntries[i];
            xObjectResourceMap[img.name] = img.xObjectId;
        }
        for (let i = 0, len = formEntries.length; i < len; i++) {
            const fm = formEntries[i];
            xObjectResourceMap[fm.name] = fm.xObjectId;
        }
        /** @type {Record<string, string>} */
        const shadingResourceMap = {};
        for (const [shadName, dictStr] of this.shadings) {
            shadingResourceMap[shadName] = dictStr;
        }
        /** @type {Record<string, string>} */
        const extGStateResourceMap = {};
        for (const [gsName, dictStr] of this.extGStates) {
            extGStateResourceMap[gsName] = dictStr;
        }
        /** @type {Record<string, string>} */
        const colorSpaceResourceMap = {};
        for (const [csName, arrStr] of this.colorSpaces) {
            colorSpaceResourceMap[csName] = arrStr;
        }
        emitObject(
            resourcesId,
            createResources(
                fontResourceMap,
                xObjectResourceMap,
                shadingResourceMap,
                extGStateResourceMap,
                colorSpaceResourceMap
            )
        );

        // Write Font objects (Type1 built-ins)
        for (let i = 0, len = fontEntries.length; i < len; i++) {
            const font = fontEntries[i];
            emitObject(font.objectId, createType1Font(font.baseFont));
        }

        // Write embedded TrueType font triples (fontDict + descriptor + file stream)
        for (let i = 0, len = embeddedFontEntries.length; i < len; i++) {
            const ef = embeddedFontEntries[i];

            emitObject(
                ef.fontDictId,
                buildTtfFontDict(ef.metrics, ef.descriptorId, toUnicodeId)
            );

            emitObject(
                ef.descriptorId,
                buildFontDescriptor(ef.metrics, ef.fileStreamId)
            );

            // FontFile2 stream (TrueType program; Flate-compressed when enabled).
            // Length1 remains the uncompressed program length, per spec.
            const ttfBytes = ef.metrics.rawBytes;
            const ttfStreamBytes = this.compressStreams
                ? deflateBytes(ttfBytes)
                : ttfBytes;
            /** @type {Record<string, string>} */
            const ttfDictEntries = { Length1: String(ttfBytes.length) };
            if (this.compressStreams) {
                ttfDictEntries.Filter = "/FlateDecode";
            }
            emitStream(ef.fileStreamId, ttfDictEntries, ttfStreamBytes);
        }

        // Shared /ToUnicode CMap stream (written after the font triples so the
        // object write order continues to match the ID assignment order).
        if (toUnicodeId !== undefined) {
            const cmap = encodeUtf8(buildToUnicodeCMap());
            const cmapStreamBytes = this.compressStreams
                ? deflateBytes(cmap)
                : cmap;
            /** @type {Record<string, string>} */
            const cmapDictEntries = {};
            if (this.compressStreams) {
                cmapDictEntries.Filter = "/FlateDecode";
            }
            emitStream(toUnicodeId, cmapDictEntries, cmapStreamBytes);
        }

        // CID (Type0) font chain.
        for (let i = 0, len = cidFontEntries.length; i < len; i++) {
            const cf = cidFontEntries[i];

            if (cf.metrics.isCFF) {
                // OpenType-CFF: embed the whole font as FontFile3 /Subtype
                // /OpenType with a CIDFontType0 descendant (no subsetting — CFF
                // subsetting is not implemented). The CID is used directly as
                // the glyph id (name-keyed CFF), so no CIDToGIDMap.
                const cffName = cf.metrics.postScriptName;
                emitObject(
                    cf.fontDictId,
                    buildType0FontDict(
                        cf.metrics,
                        cf.cidFontId,
                        cf.toUnicodeId,
                        cffName
                    )
                );
                const wArrayCff = buildCIDWArray(
                    cf.usedGlyphs.keys(),
                    cf.metrics
                );
                emitObject(
                    cf.cidFontId,
                    buildCIDFontDictCFF(
                        cf.metrics,
                        cf.descriptorId,
                        wArrayCff,
                        cffName
                    )
                );
                emitObject(
                    cf.descriptorId,
                    buildFontDescriptorCFF(cf.metrics, cf.fileStreamId, cffName)
                );
                const otfBytes = cf.metrics.rawBytes;
                const otfStreamBytes = this.compressStreams
                    ? deflateBytes(otfBytes)
                    : otfBytes;
                /** @type {Record<string, string>} */
                const otfEntries = { Subtype: "/OpenType" };
                if (this.compressStreams) {
                    otfEntries.Filter = "/FlateDecode";
                }
                emitStream(cf.fileStreamId, otfEntries, otfStreamBytes);

                const cidCmapCff = encodeUtf8(
                    buildCIDToUnicodeCMap(cf.usedGlyphs)
                );
                const cidCmapCffBytes = this.compressStreams
                    ? deflateBytes(cidCmapCff)
                    : cidCmapCff;
                /** @type {Record<string, string>} */
                const cidCmapCffEntries = {};
                if (this.compressStreams) {
                    cidCmapCffEntries.Filter = "/FlateDecode";
                }
                emitStream(cf.toUnicodeId, cidCmapCffEntries, cidCmapCffBytes);
                continue;
            }

            // Subset the font to the glyphs actually used (glyph ids preserved,
            // so /W, /ToUnicode, and the content stream stay valid). Prefix the
            // BaseFont with the conventional 6-letter subset tag.
            const usedGids = new Set(cf.usedGlyphs.keys());
            usedGids.add(0);
            const subsetBytes = subsetFont(cf.metrics.rawBytes, usedGids);
            const subsetName =
                subsetTag(usedGids) + "+" + cf.metrics.postScriptName;

            emitObject(
                cf.fontDictId,
                buildType0FontDict(
                    cf.metrics,
                    cf.cidFontId,
                    cf.toUnicodeId,
                    subsetName
                )
            );

            const wArray = buildCIDWArray(cf.usedGlyphs.keys(), cf.metrics);
            emitObject(
                cf.cidFontId,
                buildCIDFontDict(
                    cf.metrics,
                    cf.descriptorId,
                    wArray,
                    subsetName
                )
            );

            emitObject(
                cf.descriptorId,
                buildFontDescriptor(cf.metrics, cf.fileStreamId, subsetName)
            );

            // FontFile2 (subset font program; Flate-compressed when enabled).
            const ttfBytes = subsetBytes;
            const ttfStreamBytes = this.compressStreams
                ? deflateBytes(ttfBytes)
                : ttfBytes;
            /** @type {Record<string, string>} */
            const ttfEntries = { Length1: String(ttfBytes.length) };
            if (this.compressStreams) {
                ttfEntries.Filter = "/FlateDecode";
            }
            emitStream(cf.fileStreamId, ttfEntries, ttfStreamBytes);

            // GID -> Unicode ToUnicode stream.
            const cidCmap = encodeUtf8(buildCIDToUnicodeCMap(cf.usedGlyphs));
            const cidCmapBytes = this.compressStreams
                ? deflateBytes(cidCmap)
                : cidCmap;
            /** @type {Record<string, string>} */
            const cidCmapEntries = {};
            if (this.compressStreams) {
                cidCmapEntries.Filter = "/FlateDecode";
            }
            emitStream(cf.toUnicodeId, cidCmapEntries, cidCmapBytes);
        }

        // Write image XObjects (and optional SMask streams)
        for (let i = 0, len = imageEntries.length; i < len; i++) {
            const img = imageEntries[i];

            if (img.format === "jpeg") {
                const parsed =
                    /** @type {import("./image-embed.mjs").ParsedJpeg} */ (
                        img.parsed
                    );
                emitStream(
                    img.xObjectId,
                    buildJpegXObjectDict(parsed),
                    parsed.streamData
                );
            } else {
                // PNG — write image XObject first (lower ID), then SMask (higher ID)
                const parsed =
                    /** @type {import("./image-embed.mjs").ParsedPng} */ (
                        img.parsed
                    );

                emitStream(
                    img.xObjectId,
                    buildPngXObjectDict(parsed, img.smaskId),
                    parsed.streamData
                );

                // SMask (alpha channel) — higher ID, written after XObject
                if (img.smaskId !== undefined && parsed.smaskData) {
                    emitStream(
                        img.smaskId,
                        buildSmaskXObjectDict(
                            parsed.width,
                            parsed.height,
                            parsed.smaskData.length
                        ),
                        parsed.smaskData
                    );
                }
            }
        }

        // Write Form XObjects (reusable content; Flate-compressed when enabled).
        // Each shares the document resource dict so it can use the same fonts,
        // images, and other forms by name.
        for (let i = 0, len = formEntries.length; i < len; i++) {
            const fm = formEntries[i];
            const formBytes = this.compressStreams
                ? deflateBytes(fm.contentStream)
                : fm.contentStream;
            /** @type {Record<string, string>} */
            const formDictEntries = {
                Type: "/XObject",
                Subtype: "/Form",
                FormType: "1",
                BBox: formatArray(fm.bbox.map(String)),
                Resources: formatRef(resourcesId)
            };
            if (fm.matrix) {
                formDictEntries.Matrix = formatArray(fm.matrix.map(String));
            }
            if (this.compressStreams) {
                formDictEntries.Filter = "/FlateDecode";
            }
            emitStream(fm.xObjectId, formDictEntries, formBytes);
        }

        // Write Page, Content Stream, and Annotation objects
        for (let i = 0, len = pageObjects.length; i < len; i++) {
            const { pageId, contentId, annotIds } = pageObjects[i];
            const pageData = this.pages[i];
            const contentStream = pageData.contentStream;

            // Page object (with annotations if present)
            emitObject(
                pageId,
                this.createPageWithAnnotations(
                    pagesId,
                    pageData.width,
                    pageData.height,
                    contentId,
                    resourcesId,
                    annotIds,
                    pageData.rotate,
                    structParentsByPage.has(i)
                        ? structParentsByPage.get(i)
                        : undefined
                )
            );

            // Content stream object (Flate-compressed when enabled)
            const contentBytes = this.compressStreams
                ? deflateBytes(contentStream)
                : contentStream;
            /** @type {Record<string, string>} */
            const streamDictEntries = {};
            if (this.compressStreams) {
                streamDictEntries.Filter = "/FlateDecode";
            }
            emitStream(contentId, streamDictEntries, contentBytes);

            // Annotation objects
            for (let j = 0, jlen = annotIds.length; j < jlen; j++) {
                const annotId = annotIds[j];
                const annotation = pageData.annotations[j];
                emitObject(
                    annotId,
                    this.createAnnotationObject(annotation, pageObjects, pageId)
                );
            }
        }

        if (acroFormId !== undefined) {
            const helveticaFont =
                this.fonts.get("Helvetica") ?? fontEntries[0] ?? null;
            const helveticaObjectId =
                helveticaFont?.objectId ?? fontEntries[0]?.objectId;

            if (helveticaObjectId === undefined) {
                throw new Error(
                    "Cannot create AcroForm without at least one registered font"
                );
            }

            emitObject(
                acroFormId,
                this.createAcroForm(
                    formFieldObjectIds,
                    helveticaObjectId,
                    hasSignatureField
                )
            );
        }

        // Write Outline (bookmark) objects
        if (hasOutlines && outlinesRootId !== undefined) {
            // Build the outline tree structure.
            // PDF outlines are a linked-list tree:
            // - Root has /First, /Last, /Count
            // - Each item has /Title, /Dest, /Parent, /Prev, /Next, /First, /Last, /Count
            //
            // We support nested levels: level 1 items are children of root,
            // level 2 items are children of the preceding level 1 item, etc.

            /**
             * @typedef {Object} OutlineTreeNode
             * @property {number} objId
             * @property {string} title
             * @property {number} targetPage - 1-indexed
             * @property {number} targetY
             * @property {number} parentObjId
             * @property {OutlineTreeNode[]} children
             */

            // Build tree from flat level-ordered items
            /** @type {OutlineTreeNode[]} */
            const topLevel = [];

            // Stack tracks the most recent node at each depth.
            // stack[0] = last level-1 node, stack[1] = last level-2 node, etc.
            /** @type {OutlineTreeNode[]} */
            const stack = [];

            for (let i = 0, len = this.outlineItems.length; i < len; i++) {
                const item = this.outlineItems[i];
                const level = Math.max(1, item.level);
                const depth = level - 1; // 0-indexed

                /** @type {OutlineTreeNode} */
                const node = {
                    objId: outlineItemIds[i],
                    title: item.title,
                    targetPage: item.targetPage,
                    targetY: item.targetY ?? this.pageHeight,
                    parentObjId: outlinesRootId,
                    children: []
                };

                if (depth === 0) {
                    // Top-level item — child of root
                    node.parentObjId = outlinesRootId;
                    topLevel.push(node);
                    stack.length = 1;
                    stack[0] = node;
                } else {
                    // Find parent: the most recent node at depth-1
                    const parentDepth = depth - 1;
                    const parent = stack[parentDepth];
                    if (parent) {
                        node.parentObjId = parent.objId;
                        parent.children.push(node);
                    } else {
                        // Orphan — attach to root as fallback
                        node.parentObjId = outlinesRootId;
                        topLevel.push(node);
                    }
                    stack.length = depth + 1;
                    stack[depth] = node;
                }
            }

            /**
             * Count total visible descendants (for /Count).
             * Positive count = open by default.
             * @param {OutlineTreeNode[]} nodes
             * @returns {number}
             */
            const countDescendants = (nodes) => {
                let total = 0;
                for (let i = 0, len = nodes.length; i < len; i++) {
                    total = total + 1 + countDescendants(nodes[i].children);
                }
                return total;
            };

            /**
             * Write a list of sibling outline item objects.
             * @param {OutlineTreeNode[]} siblings
             * @returns {void}
             */
            const writeSiblings = (siblings) => {
                for (let i = 0, len = siblings.length; i < len; i++) {
                    const node = siblings[i];

                    // Resolve destination page object ID
                    const targetPageIndex = node.targetPage - 1;
                    const targetPageObjId =
                        targetPageIndex >= 0 &&
                        targetPageIndex < pageObjects.length
                            ? pageObjects[targetPageIndex].pageId
                            : pageObjects[0].pageId;

                    /** @type {Record<string, string>} */
                    const dict = {
                        Title: "(" + escapePdfString(node.title) + ")",
                        Parent: `${node.parentObjId} 0 R`,
                        Dest: `[${targetPageObjId} 0 R /XYZ 0 ${node.targetY} null]`
                    };

                    // Sibling links
                    if (i > 0) {
                        dict.Prev = `${siblings[i - 1].objId} 0 R`;
                    }
                    if (i < len - 1) {
                        dict.Next = `${siblings[i + 1].objId} 0 R`;
                    }

                    // Children
                    if (node.children.length > 0) {
                        dict.First = `${node.children[0].objId} 0 R`;
                        dict.Last = `${
                            node.children[node.children.length - 1].objId
                        } 0 R`;
                        // Positive count = expanded by default
                        dict.Count = String(countDescendants(node.children));
                    }

                    emitObject(node.objId, formatDictionary(dict));

                    // Recurse into children
                    if (node.children.length > 0) {
                        writeSiblings(node.children);
                    }
                }
            };

            // Write Outlines root object
            /** @type {Record<string, string>} */
            const rootDict = {
                Type: "/Outlines"
            };
            if (topLevel.length > 0) {
                rootDict.First = `${topLevel[0].objId} 0 R`;
                rootDict.Last = `${topLevel[topLevel.length - 1].objId} 0 R`;
                rootDict.Count = String(countDescendants(topLevel));
            } else {
                rootDict.Count = "0";
            }
            emitObject(outlinesRootId, formatDictionary(rootDict));

            // Write all outline item objects
            writeSiblings(topLevel);
        }

        // Write embedded file attachments (stream + filespec per file, then the
        // shared /EmbeddedFiles name-tree dictionary).
        if (hasAttachments) {
            for (let i = 0, len = this.attachments.length; i < len; i++) {
                const a = this.attachments[i];

                // Embedded file stream (Flate-compressed when enabled).
                const streamBytes = this.compressStreams
                    ? deflateBytes(a.bytes)
                    : a.bytes;
                const md5 = createHash("md5").update(a.bytes).digest("hex");
                /** @type {Record<string, string>} */
                const paramsEntries = {
                    Size: String(a.bytes.length),
                    CheckSum: `<${md5}>`
                };
                if (this.includeDates) {
                    const now = `(${formatPdfDate(new Date())})`;
                    paramsEntries.ModDate = now;
                    paramsEntries.CreationDate = now;
                }
                /** @type {Record<string, string>} */
                const efEntries = {
                    Type: "/EmbeddedFile",
                    Params: formatDictionary(paramsEntries)
                };
                if (a.mimeType) {
                    efEntries.Subtype = escapePdfName(a.mimeType);
                }
                if (this.compressStreams) {
                    efEntries.Filter = "/FlateDecode";
                }
                emitStream(a.streamId, efEntries, streamBytes);

                // File specification.
                /** @type {Record<string, string>} */
                const fsEntries = {
                    Type: "/Filespec",
                    F: `(${escapePdfString(a.name)})`,
                    UF: `<${utf16beHex(a.name)}>`,
                    EF: formatDictionary({
                        F: formatRef(a.streamId),
                        UF: formatRef(a.streamId)
                    })
                };
                if (a.description) {
                    fsEntries.Desc = `(${escapePdfString(a.description)})`;
                }
                if (a.relationship) {
                    fsEntries.AFRelationship = "/" + a.relationship;
                }
                emitObject(a.filespecId, formatDictionary(fsEntries));
            }

            // Shared /EmbeddedFiles name-tree dictionary.
            emitObject(namesDictId, namesDictStr);
        }

        // Write Info object (with clean metadata support)
        if (shouldIncludeInfo && infoId !== undefined) {
            emitObject(
                infoId,
                createDocumentInfo({
                    title: this.title,
                    author: this.author,
                    subject: this.subject,
                    creator: this.creator,
                    producer: this.producer,
                    includeDates: this.includeDates
                })
            );
        }

        // Write XMP metadata stream (uncompressed so it stays readable).
        if (metadataId !== undefined && xmpBytes) {
            const streamBytes = enc
                ? enc.encrypt(metadataId, xmpBytes)
                : xmpBytes;
            const dict = formatDictionary({
                Type: "/Metadata",
                Subtype: "/XML",
                Length: String(streamBytes.length)
            });
            objectOffsets.push(currentOffset);
            writeStr(`${metadataId} 0 obj\n${dict}\nstream\n`);
            write(streamBytes);
            writeStr("\nendstream\nendobj\n");
        }

        // Write ICC profile stream (Flate-compressed when enabled).
        if (this.outputIntent && iccStreamId !== undefined) {
            const icc = this.outputIntent.iccProfile;
            const iccStream = this.compressStreams ? deflateBytes(icc) : icc;
            const finalIcc = enc
                ? enc.encrypt(iccStreamId, iccStream)
                : iccStream;
            /** @type {Record<string, string>} */
            const iccEntries = {
                N: String(this.outputIntent.n),
                Length: String(finalIcc.length)
            };
            if (this.compressStreams) {
                iccEntries.Filter = "/FlateDecode";
            }
            const iccDict = formatDictionary(iccEntries);
            objectOffsets.push(currentOffset);
            writeStr(`${iccStreamId} 0 obj\n${iccDict}\nstream\n`);
            write(finalIcc);
            writeStr("\nendstream\nendobj\n");
        }

        // Write Encrypt dictionary (never itself encrypted).
        if (enc && encryptId !== undefined) {
            objectOffsets.push(currentOffset);
            writeStr(formatIndirectObject(encryptId, enc.buildEncryptDict()));
        }

        // Write the structure tree (tagged PDF): StructTreeRoot, ParentTree,
        // then one StructElem per marked item (matching the ID allocation order).
        if (hasTags && structTreeRootId !== undefined) {
            const elemRefs = structElemIds.map((id) => formatRef(id)).join(" ");
            const structTreeRoot = formatDictionary({
                Type: "/StructTreeRoot",
                K: "[" + elemRefs + "]",
                ParentTree: formatRef(parentTreeId),
                ParentTreeNextKey: String(structParentsByPage.size)
            });
            objectOffsets.push(currentOffset);
            writeStr(
                enc
                    ? formatIndirectObject(
                          structTreeRootId,
                          enc.encryptStringsInObject(
                              structTreeRootId,
                              structTreeRoot
                          )
                      )
                    : formatIndirectObject(structTreeRootId, structTreeRoot)
            );

            // ParentTree number tree: StructParents index -> array of elems by MCID.
            /** @type {Map<number, string[]>} */
            const byParent = new Map();
            for (let i = 0, len = taggedItems.length; i < len; i++) {
                const it = taggedItems[i];
                const sp = structParentsByPage.get(it.pageIndex);
                if (!byParent.has(sp)) {
                    byParent.set(sp, []);
                }
                const arr = byParent.get(sp);
                arr[it.mcid] = formatRef(structElemIds[i]);
            }
            const nums = [];
            const sortedParents = Array.from(byParent.keys()).sort(
                (a, b) => a - b
            );
            for (let i = 0, len = sortedParents.length; i < len; i++) {
                const sp = sortedParents[i];
                const arr = byParent.get(sp);
                const filled = [];
                for (let k = 0, klen = arr.length; k < klen; k++) {
                    filled.push(arr[k] !== undefined ? arr[k] : "null");
                }
                nums.push(sp + " [" + filled.join(" ") + "]");
            }
            const parentTree = formatDictionary({
                Nums: "[" + nums.join(" ") + "]"
            });
            objectOffsets.push(currentOffset);
            writeStr(formatIndirectObject(parentTreeId, parentTree));

            // StructElem per item.
            for (let i = 0, len = taggedItems.length; i < len; i++) {
                const it = taggedItems[i];
                const pageRef = formatRef(pageObjects[it.pageIndex].pageId);
                /** @type {Record<string, string>} */
                const se = {
                    Type: "/StructElem",
                    S: "/" + it.type,
                    P: formatRef(structTreeRootId),
                    Pg: pageRef,
                    K: String(it.mcid)
                };
                if (it.alt) {
                    se.Alt = "(" + escapePdfString(it.alt) + ")";
                }
                const seStr = formatDictionary(se);
                objectOffsets.push(currentOffset);
                writeStr(
                    enc
                        ? formatIndirectObject(
                              structElemIds[i],
                              enc.encryptStringsInObject(
                                  structElemIds[i],
                                  seStr
                              )
                          )
                        : formatIndirectObject(structElemIds[i], seStr)
                );
            }
        }

        // Write xref table
        const xrefOffset = currentOffset;
        /** @type {import("./primitives.mjs").PdfXrefEntry[]} */
        const xrefEntries = [];
        // Object 0 is always free
        xrefEntries.push({ offset: 0, generation: 65535, type: "f" });
        for (let i = 1, len = objectOffsets.length; i < len; i++) {
            xrefEntries.push({
                offset: objectOffsets[i],
                generation: 0,
                type: "n"
            });
        }
        writeStr(createXrefTable(xrefEntries));

        // Write trailer (with /ID + /Encrypt when encrypted).
        writeStr(
            createTrailer(
                objectOffsets.length,
                catalogId,
                xrefOffset,
                infoId,
                enc ? enc.fileIdHex : undefined,
                encryptId
            )
        );

        return concatBytes(chunks);
    }

    /**
     * Create page dictionary with optional annotations
     * @param {number} pagesId
     * @param {number} width
     * @param {number} height
     * @param {number} contentId
     * @param {number} resourcesId
     * @param {number[]} annotIds
     * @param {number} [rotate] - Clockwise display rotation (multiple of 90)
     * @param {number} [structParents] - StructParents index for tagged pages
     * @returns {string}
     */
    createPageWithAnnotations(
        pagesId,
        width,
        height,
        contentId,
        resourcesId,
        annotIds,
        rotate,
        structParents
    ) {
        /** @type {Record<string, string>} */
        const dict = {
            Type: "/Page",
            Parent: `${pagesId} 0 R`,
            MediaBox: `[0 0 ${width} ${height}]`,
            Contents: `${contentId} 0 R`,
            Resources: `${resourcesId} 0 R`
        };

        if (rotate) {
            dict.Rotate = String(rotate);
        }

        if (structParents !== undefined) {
            dict.StructParents = String(structParents);
        }

        // Add annotations array if present
        if (annotIds.length > 0) {
            const annotRefs = annotIds.map((id) => `${id} 0 R`).join(" ");
            dict.Annots = `[${annotRefs}]`;
        }

        return formatDictionary(dict);
    }

    /**
     * Create annotation dictionary
     * @param {LinkAnnotation | FormFieldAnnotation} annotation
     * @param {{ pageId: number; contentId: number; annotIds: number[] }[]} pageObjects
     * @param {number} pageId
     * @returns {string}
     */
    createAnnotationObject(annotation, pageObjects, pageId) {
        if (annotation.type === "form") {
            return this.createFormWidgetAnnotation(annotation, pageId);
        }
        return this.createLinkAnnotation(annotation, pageObjects);
    }

    /**
     * Create link annotation dictionary
     * @param {LinkAnnotation} annotation
     * @param {{ pageId: number; contentId: number; annotIds: number[] }[]} pageObjects
     * @returns {string}
     */
    createLinkAnnotation(annotation, pageObjects) {
        // Calculate rect: [x1, y1, x2, y2] (lower-left to upper-right)
        const x1 = annotation.x;
        const y1 = annotation.y;
        const x2 = annotation.x + annotation.width;
        const y2 = annotation.y + annotation.height;

        /** @type {Record<string, string>} */
        const dict = {
            Type: "/Annot",
            Subtype: "/Link",
            Rect: `[${x1} ${y1} ${x2} ${y2}]`,
            Border: "[0 0 0]", // No visible border
            F: "4" // Print flag - annotation prints
        };

        if (annotation.type === "external" && annotation.url) {
            // External URI link
            dict.A = formatDictionary({
                Type: "/Action",
                S: "/URI",
                URI: `(${escapePdfString(annotation.url)})`
            });
        } else if (
            annotation.type === "internal" &&
            annotation.targetPage !== undefined
        ) {
            // Internal destination link
            // Find the page object ID for the target page (1-indexed)
            const targetPageIndex = annotation.targetPage - 1;
            if (targetPageIndex >= 0 && targetPageIndex < pageObjects.length) {
                const targetPageId = pageObjects[targetPageIndex].pageId;
                const targetY = annotation.targetY ?? this.pageHeight;

                // Use XYZ destination: [page /XYZ left top zoom]
                // null values mean "unchanged"
                dict.Dest = `[${targetPageId} 0 R /XYZ 0 ${targetY} null]`;
            }
        }

        return formatDictionary(dict);
    }

    /**
     * Create AcroForm dictionary
     * @param {number[]} fieldObjectIds
     * @param {number} helveticaObjectId
     * @param {boolean} hasSignatureField
     * @returns {string}
     */
    createAcroForm(fieldObjectIds, helveticaObjectId, hasSignatureField) {
        /** @type {Record<string, string>} */
        const dict = {
            Fields: formatArray(fieldObjectIds.map(formatRef)),
            NeedAppearances: "true",
            DR: formatDictionary({
                Font: formatDictionary({
                    Helv: formatRef(helveticaObjectId)
                })
            }),
            DA: `(${escapePdfString("/Helv 10 Tf 0 g")})`
        };

        if (hasSignatureField) {
            dict.SigFlags = "3";
        }

        return formatDictionary(dict);
    }

    /**
     * Create form widget annotation dictionary
     * @param {FormFieldAnnotation} annotation
     * @param {number} pageId
     * @returns {string}
     */
    createFormWidgetAnnotation(annotation, pageId) {
        const x1 = annotation.x;
        const y1 = annotation.y;
        const x2 = annotation.x + annotation.width;
        const y2 = annotation.y + annotation.height;
        let fieldFlags = 0;
        if (annotation.readOnly) {
            fieldFlags = fieldFlags | 1;
        }
        if (annotation.required) {
            fieldFlags = fieldFlags | 2;
        }

        /** @type {Record<string, string>} */
        const dict = {
            Type: "/Annot",
            Subtype: "/Widget",
            Rect: `[${x1} ${y1} ${x2} ${y2}]`,
            F: "4",
            P: formatRef(pageId),
            T: `(${escapePdfString(annotation.name)})`,
            TU: `(${escapePdfString(annotation.tooltip ?? annotation.name)})`,
            FT: annotation.fieldType === "signature" ? "/Sig" : "/Tx",
            Ff: String(fieldFlags),
            Border: "[0 0 0]"
        };

        if (annotation.fieldType === "text") {
            const fontSize =
                annotation.fontSize && annotation.fontSize > 0
                    ? annotation.fontSize
                    : 10;
            dict.DA = `(${escapePdfString(`/Helv ${fontSize} Tf 0 g`)})`;
            dict.Q = "0";
            if (annotation.maxLength && annotation.maxLength > 0) {
                dict.MaxLen = String(Math.trunc(annotation.maxLength));
            }
            if (annotation.value !== undefined) {
                dict.V = `(${escapePdfString(annotation.value)})`;
                dict.DV = `(${escapePdfString(annotation.value)})`;
            }
        }

        return formatDictionary(dict);
    }
}

// ============================================================================
// Export
// ============================================================================

export default {
    PdfDocumentBuilder,
    measureTextWidth,
    getFontMetrics,
    HELVETICA_WIDTHS,
    HELVETICA_BOLD_WIDTHS,
    TIMES_ROMAN_WIDTHS,
    TIMES_BOLD_WIDTHS,
    TIMES_ITALIC_WIDTHS,
    TIMES_BOLD_ITALIC_WIDTHS,
    COURIER_WIDTH
};
