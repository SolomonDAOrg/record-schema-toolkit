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
    escapePdfString
} from "./primitives.mjs";

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
 * @property {string | null} [producer] - Producer string: null to omit, undefined for default
 * @property {boolean} [includeDates=true] - Whether to include creation/mod dates
 * @property {boolean} [omitInfo=false] - Omit entire Info dictionary (cleanest output)
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
 * @typedef {Object} PageData
 * @property {Uint8Array} contentStream
 * @property {LinkAnnotation[]} annotations
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

const COURIER_WIDTH = 600; // Monospace - all chars same width

const DEFAULT_CHAR_WIDTH = 556;

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
    if (baseFont.startsWith("Times")) {
        // Times is close enough to Helvetica for rough estimates
        return HELVETICA_WIDTHS;
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
    const metrics = getFontMetrics(baseFont);
    let width = 0;

    if (typeof metrics === "number") {
        // Monospace font
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
        /** @type {boolean} */
        this.includeDates = opts.includeDates !== false;
        /** @type {boolean} */
        this.omitInfo = opts.omitInfo === true;

        /** @type {PageData[]} */
        this.pages = [];

        /** @type {Map<string, PdfFontInfo>} */
        this.fonts = new Map();
        this.nextFontId = 1;

        /** @type {OutlineItem[]} */
        this.outlineItems = [];

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
    registerFont(baseFont) {
        if (this.fonts.has(baseFont)) {
            const existing = this.fonts.get(baseFont);
            return existing ? existing.name : "F1";
        }

        const name = "F" + this.nextFontId;
        this.nextFontId = this.nextFontId + 1;

        this.fonts.set(baseFont, {
            name,
            baseFont,
            objectId: 0 // Will be assigned during build
        });

        return name;
    }

    /**
     * Get font resource name
     * @param {string} baseFont
     * @returns {string}
     */
    getFontName(baseFont) {
        const info = this.fonts.get(baseFont);
        if (info) {
            return info.name;
        }
        return this.registerFont(baseFont);
    }

    /**
     * Add a page with content stream
     * @param {Uint8Array} contentStream
     * @param {LinkAnnotation[]} [annotations]
     * @returns {this}
     */
    addPage(contentStream, annotations) {
        this.pages.push({
            contentStream,
            annotations: annotations || []
        });
        return this;
    }

    /**
     * Add a page from string content
     * @param {string} content
     * @param {LinkAnnotation[]} [annotations]
     * @returns {this}
     */
    addPageFromString(content, annotations) {
        return this.addPage(encodeUtf8(content), annotations);
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

        // PDF Header
        const header = createPdfHeader();
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

        // Info object - respect omitInfo option (LAST object ID)
        const hasMetadata =
            this.title || this.author || this.subject || this.creator;
        const shouldIncludeInfo = !this.omitInfo && hasMetadata;
        const infoId = shouldIncludeInfo ? nextObjId++ : undefined;

        // Object 0 placeholder for xref
        objectOffsets.push(0);

        // Write Catalog (object 1)
        objectOffsets.push(currentOffset);
        writeStr(
            formatIndirectObject(
                catalogId,
                createCatalog(pagesId, outlinesRootId)
            )
        );

        // Write Pages (object 2)
        objectOffsets.push(currentOffset);
        const pageRefs = pageObjects.map((p) => p.pageId);
        writeStr(
            formatIndirectObject(
                pagesId,
                createPages(pageRefs, this.pages.length)
            )
        );

        // Write Resources (object 3)
        objectOffsets.push(currentOffset);
        /** @type {Record<string, number>} */
        const fontResourceMap = {};
        for (let i = 0, len = fontEntries.length; i < len; i++) {
            const font = fontEntries[i];
            fontResourceMap[font.name] = font.objectId;
        }
        writeStr(
            formatIndirectObject(resourcesId, createResources(fontResourceMap))
        );

        // Write Font objects
        for (let i = 0, len = fontEntries.length; i < len; i++) {
            const font = fontEntries[i];
            objectOffsets.push(currentOffset);
            writeStr(
                formatIndirectObject(
                    font.objectId,
                    createType1Font(font.baseFont)
                )
            );
        }

        // Write Page, Content Stream, and Annotation objects
        for (let i = 0, len = pageObjects.length; i < len; i++) {
            const { pageId, contentId, annotIds } = pageObjects[i];
            const pageData = this.pages[i];
            const contentStream = pageData.contentStream;

            // Page object (with annotations if present)
            objectOffsets.push(currentOffset);
            writeStr(
                formatIndirectObject(
                    pageId,
                    this.createPageWithAnnotations(
                        pagesId,
                        this.pageWidth,
                        this.pageHeight,
                        contentId,
                        resourcesId,
                        annotIds
                    )
                )
            );

            // Content stream object
            objectOffsets.push(currentOffset);
            const streamDict = formatDictionary({
                Length: String(contentStream.length)
            });
            writeStr(`${contentId} 0 obj\n${streamDict}\nstream\n`);
            write(contentStream);
            writeStr("\nendstream\nendobj\n");

            // Annotation objects
            for (let j = 0, jlen = annotIds.length; j < jlen; j++) {
                const annotId = annotIds[j];
                const annotation = pageData.annotations[j];
                objectOffsets.push(currentOffset);
                writeStr(
                    formatIndirectObject(
                        annotId,
                        this.createLinkAnnotation(annotation, pageObjects)
                    )
                );
            }
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
                    objectOffsets.push(currentOffset);

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

                    writeStr(
                        formatIndirectObject(node.objId, formatDictionary(dict))
                    );

                    // Recurse into children
                    if (node.children.length > 0) {
                        writeSiblings(node.children);
                    }
                }
            };

            // Write Outlines root object
            objectOffsets.push(currentOffset);
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
            writeStr(
                formatIndirectObject(outlinesRootId, formatDictionary(rootDict))
            );

            // Write all outline item objects
            writeSiblings(topLevel);
        }

        // Write Info object (with clean metadata support)
        if (shouldIncludeInfo && infoId !== undefined) {
            objectOffsets.push(currentOffset);
            writeStr(
                formatIndirectObject(
                    infoId,
                    createDocumentInfo({
                        title: this.title,
                        author: this.author,
                        subject: this.subject,
                        creator: this.creator,
                        producer: this.producer,
                        includeDates: this.includeDates
                    })
                )
            );
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

        // Write trailer
        writeStr(
            createTrailer(objectOffsets.length, catalogId, xrefOffset, infoId)
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
     * @returns {string}
     */
    createPageWithAnnotations(
        pagesId,
        width,
        height,
        contentId,
        resourcesId,
        annotIds
    ) {
        /** @type {Record<string, string>} */
        const dict = {
            Type: "/Page",
            Parent: `${pagesId} 0 R`,
            MediaBox: `[0 0 ${width} ${height}]`,
            Contents: `${contentId} 0 R`,
            Resources: `${resourcesId} 0 R`
        };

        // Add annotations array if present
        if (annotIds.length > 0) {
            const annotRefs = annotIds.map((id) => `${id} 0 R`).join(" ");
            dict.Annots = `[${annotRefs}]`;
        }

        return formatDictionary(dict);
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
    COURIER_WIDTH
};
