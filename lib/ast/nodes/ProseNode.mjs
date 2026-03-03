/**
 * ProseNode - Document-oriented content nodes
 * @module format-ast/nodes/ProseNode
 */

import { BaseNode, createText } from "./BaseNode.mjs";
import { NODE_CATEGORIES, PROSE_NODE_TYPES } from "../constants/core.mjs";

/**
 * @typedef {import("../types/core.mjs").ProseNodeType} ProseNodeType
 * @typedef {import("../types/core.mjs").HorizontalAlign} HorizontalAlign
 * @typedef {import("../types/core.mjs").InlineFormat} InlineFormat
 * @typedef {import("../types/core.mjs").InlineFormatType} InlineFormatType
 * @typedef {import("./BaseNode.mjs").BaseNodeData} BaseNodeData
 */

// =============================================================================
// ProseNode Base
// =============================================================================

/**
 * Base class for prose/document nodes
 * @extends BaseNode
 */
export class ProseNode extends BaseNode {
    /**
     * @param {ProseNodeType} type
     * @param {BaseNodeData} [data]
     */
    constructor(type, data = {}) {
        super(type, data);
        this.category = NODE_CATEGORIES.PROSE;
    }
}

// =============================================================================
// Heading
// =============================================================================

/**
 * @typedef {Object} HeadingData
 * @property {1 | 2 | 3 | 4 | 5 | 6} level
 * @property {string} [numbering] - e.g., "1.2.3" or "Article I"
 * @property {boolean} [includeInToc]
 */

/**
 * Heading node
 */
export class HeadingNode extends ProseNode {
    /**
     * @param {1 | 2 | 3 | 4 | 5 | 6} level
     * @param {string | BaseNode[]} content
     * @param {BaseNodeData & Partial<HeadingData>} [data]
     */
    constructor(
        level,
        content,
        data = /** @type {Partial<HeadingData>} */ ({})
    ) {
        super(PROSE_NODE_TYPES.HEADING, data);

        /** @type {1 | 2 | 3 | 4 | 5 | 6} */
        this.level = level;

        /** @type {string | undefined} */
        this.numbering = data.numbering;

        /** @type {boolean} */
        this.includeInToc = data.includeInToc !== false;

        if (typeof content === "string") {
            this.appendChild(createText(content));
        } else {
            this.appendChildren(content);
        }
    }

    /** @override */
    getTextContent() {
        let text = "";
        for (let i = 0, len = this.children.length; i < len; i++) {
            text += this.children[i].getTextContent();
        }
        return text;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.level = this.level;
        if (this.numbering) {
            obj.numbering = this.numbering;
        }
        if (!this.includeInToc) {
            obj.includeInToc = false;
        }
        return obj;
    }
}

// =============================================================================
// Paragraph
// =============================================================================

/**
 * @typedef {Object} ParagraphData
 * @property {HorizontalAlign} [align]
 * @property {number} [indent] - First line indent in points
 * @property {number} [hangingIndent]
 */

/**
 * Paragraph node
 */
export class ParagraphNode extends ProseNode {
    /**
     * @param {string | BaseNode[]} content
     * @param {BaseNodeData & ParagraphData} [data]
     */
    constructor(content, data = {}) {
        super(PROSE_NODE_TYPES.PARAGRAPH, data);

        /** @type {HorizontalAlign | undefined} */
        this.align = data.align;

        /** @type {number | undefined} */
        this.indent = data.indent;

        /** @type {number | undefined} */
        this.hangingIndent = data.hangingIndent;

        if (typeof content === "string") {
            this.appendChild(createText(content));
        } else {
            this.appendChildren(content);
        }
    }

    /** @override */
    getTextContent() {
        let text = "";
        for (let i = 0, len = this.children.length; i < len; i++) {
            text += this.children[i].getTextContent();
        }
        return text;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        if (this.align) {
            obj.align = this.align;
        }
        if (this.indent !== undefined) {
            obj.indent = this.indent;
        }
        if (this.hangingIndent !== undefined) {
            obj.hangingIndent = this.hangingIndent;
        }
        return obj;
    }
}

// =============================================================================
// List
// =============================================================================

/**
 * @typedef {Object} ListData
 * @property {"ordered" | "unordered"} [listType]
 * @property {number} [startNumber]
 * @property {"decimal" | "alpha" | "roman" | "Alpha" | "Roman"} [numberStyle]
 * @property {string} [bulletChar]
 * @property {number} [indentLevel]
 */

/**
 * List node
 */
export class ListNode extends ProseNode {
    /**
     * @param {"ordered" | "unordered"} listType
     * @param {BaseNodeData & ListData} [data]
     */
    constructor(listType, data = /** @type {BaseNodeData & ListData} */ ({})) {
        super(PROSE_NODE_TYPES.LIST, data);

        /** @type {"ordered" | "unordered"} */
        this.listType = listType;

        /** @type {number} */
        this.startNumber = data.startNumber || 1;

        /** @type {"decimal" | "alpha" | "roman" | "Alpha" | "Roman"} */
        this.numberStyle = data.numberStyle || "decimal";

        /** @type {string} */
        this.bulletChar = data.bulletChar || "•";

        /** @type {number} */
        this.indentLevel = data.indentLevel || 0;
    }

    /**
     * Add list item
     * @param {string | BaseNode[]} content
     * @param {BaseNodeData} [data]
     * @returns {ListItemNode}
     */
    addItem(content, data) {
        const item = new ListItemNode(content, data);
        this.appendChild(item);
        return item;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.listType = this.listType;
        if (this.listType === "ordered") {
            obj.startNumber = this.startNumber;
            obj.numberStyle = this.numberStyle;
        } else {
            obj.bulletChar = this.bulletChar;
        }
        if (this.indentLevel > 0) {
            obj.indentLevel = this.indentLevel;
        }
        return obj;
    }
}

/**
 * List item node
 */
export class ListItemNode extends ProseNode {
    /**
     * @param {string | BaseNode[]} content
     * @param {BaseNodeData} [data]
     */
    constructor(content, data = {}) {
        super(PROSE_NODE_TYPES.LIST_ITEM, data);

        if (typeof content === "string") {
            this.appendChild(createText(content));
        } else {
            this.appendChildren(content);
        }
    }

    /** @override */
    getTextContent() {
        let text = "";
        for (let i = 0, len = this.children.length; i < len; i++) {
            text += this.children[i].getTextContent();
        }
        return text;
    }
}

// =============================================================================
// Blockquote
// =============================================================================

/**
 * Blockquote node
 */
export class BlockquoteNode extends ProseNode {
    /**
     * @param {string | BaseNode[]} content
     * @param {BaseNodeData & { attribution?: string }} [data]
     */
    constructor(content, data = {}) {
        super(PROSE_NODE_TYPES.BLOCKQUOTE, data);

        /** @type {string | undefined} */
        this.attribution = data.attribution;

        if (typeof content === "string") {
            this.appendChild(new ParagraphNode(content));
        } else {
            this.appendChildren(content);
        }
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        if (this.attribution) {
            obj.attribution = this.attribution;
        }
        return obj;
    }
}

// =============================================================================
// Code Block
// =============================================================================

/**
 * @typedef {Object} CodeBlockData
 * @property {string} [language]
 * @property {boolean} [lineNumbers]
 * @property {number} [startLine]
 * @property {number[]} [highlightLines]
 */

/**
 * Code block node
 */
export class CodeBlockNode extends ProseNode {
    /**
     * @param {string} code
     * @param {BaseNodeData & CodeBlockData} [data]
     */
    constructor(code, data = {}) {
        super(PROSE_NODE_TYPES.CODE_BLOCK, data);

        /** @type {string} */
        this.code = code;

        /** @type {string | undefined} */
        this.language = data.language;

        /** @type {boolean} */
        this.lineNumbers = data.lineNumbers || false;

        /** @type {number} */
        this.startLine = data.startLine || 1;

        /** @type {number[]} */
        this.highlightLines = data.highlightLines || [];
    }

    /** @override */
    canHaveChildren() {
        return false;
    }

    /** @override */
    getTextContent() {
        return this.code;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.code = this.code;
        if (this.language) {
            obj.language = this.language;
        }
        if (this.lineNumbers) {
            obj.lineNumbers = true;
            obj.startLine = this.startLine;
        }
        if (this.highlightLines.length > 0) {
            obj.highlightLines = this.highlightLines;
        }
        return obj;
    }
}

// =============================================================================
// Horizontal Rule
// =============================================================================

/**
 * @typedef {Object} HorizontalRuleData
 * @property {number} [widthPercent]
 * @property {number} [thickness]
 * @property {string} [color]
 */

/**
 * Horizontal rule node
 */
export class HorizontalRuleNode extends ProseNode {
    /**
     * @param {BaseNodeData & HorizontalRuleData} [data]
     */
    constructor(data = {}) {
        super(PROSE_NODE_TYPES.HORIZONTAL_RULE, data);

        /** @type {number} */
        this.widthPercent = data.widthPercent || 100;

        /** @type {number} */
        this.thickness = data.thickness || 1;

        /** @type {string | undefined} */
        this.color = data.color;
    }

    /** @override */
    canHaveChildren() {
        return false;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        if (this.widthPercent !== 100) {
            obj.widthPercent = this.widthPercent;
        }
        if (this.thickness !== 1) {
            obj.thickness = this.thickness;
        }
        if (this.color) {
            obj.color = this.color;
        }
        return obj;
    }
}

// =============================================================================
// Image
// =============================================================================

/**
 * @typedef {Object} ImageData
 * @property {string} src
 * @property {string} [alt]
 * @property {string} [title]
 * @property {number} [width]
 * @property {number} [height]
 * @property {"inline" | "block" | "float-left" | "float-right"} [display]
 */

/**
 * Image node
 */
export class ImageNode extends ProseNode {
    /**
     * @param {string} src
     * @param {BaseNodeData & ImageData} [data]
     */
    constructor(src, data = /** @type {BaseNodeData & ImageData} */ ({})) {
        super(PROSE_NODE_TYPES.IMAGE, data);

        /** @type {string} */
        this.src = src;

        /** @type {string | undefined} */
        this.alt = data.alt;

        /** @type {string | undefined} */
        this.title = data.title;

        /** @type {number | undefined} */
        this.width = data.width;

        /** @type {number | undefined} */
        this.height = data.height;

        /** @type {"inline" | "block" | "float-left" | "float-right"} */
        this.display = data.display || "block";
    }

    /** @override */
    canHaveChildren() {
        return false;
    }

    /** @override */
    isBlock() {
        return this.display !== "inline";
    }

    /** @override */
    isInline() {
        return this.display === "inline";
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.src = this.src;
        if (this.alt) {
            obj.alt = this.alt;
        }
        if (this.title) {
            obj.title = this.title;
        }
        if (this.width !== undefined) {
            obj.width = this.width;
        }
        if (this.height !== undefined) {
            obj.height = this.height;
        }
        if (this.display !== "block") {
            obj.display = this.display;
        }
        return obj;
    }
}

// =============================================================================
// Link
// =============================================================================

/**
 * @typedef {Object} LinkData
 * @property {string} href
 * @property {string} [title]
 * @property {"_self" | "_blank"} [target]
 */

/**
 * Link node - wraps inline content
 */
export class LinkNode extends ProseNode {
    /**
     * @param {string} href
     * @param {string | BaseNode[]} content
     * @param {BaseNodeData & Partial<LinkData>} [data]
     */
    constructor(
        href,
        content,
        data = /** @type {BaseNodeData & Partial<LinkData>} */ ({})
    ) {
        super(PROSE_NODE_TYPES.LINK, data);

        /** @type {string} */
        this.href = href;

        /** @type {string | undefined} */
        this.title = data.title;

        /** @type {"_self" | "_blank"} */
        this.target = data.target || "_self";

        if (typeof content === "string") {
            this.appendChild(createText(content));
        } else {
            this.appendChildren(content);
        }
    }

    /** @override */
    isBlock() {
        return false;
    }

    /** @override */
    isInline() {
        return true;
    }

    /** @override */
    getTextContent() {
        let text = "";
        for (let i = 0, len = this.children.length; i < len; i++) {
            text += this.children[i].getTextContent();
        }
        return text;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.href = this.href;
        if (this.title) {
            obj.title = this.title;
        }
        if (this.target !== "_self") {
            obj.target = this.target;
        }
        return obj;
    }
}

// =============================================================================
// Inline Format Wrapper
// =============================================================================

/**
 * Inline format wrapper - applies format to children
 */
export class InlineFormatNode extends ProseNode {
    /**
     * @param {InlineFormatType} formatType
     * @param {string | BaseNode[]} content
     * @param {BaseNodeData} [data]
     */
    constructor(formatType, content, data = {}) {
        super(PROSE_NODE_TYPES.INLINE_FORMAT, data);

        /** @type {InlineFormatType} */
        this.formatType = formatType;

        if (typeof content === "string") {
            this.appendChild(createText(content));
        } else {
            this.appendChildren(content);
        }
    }

    /** @override */
    isBlock() {
        return false;
    }

    /** @override */
    isInline() {
        return true;
    }

    /** @override */
    getTextContent() {
        let text = "";
        for (let i = 0, len = this.children.length; i < len; i++) {
            text += this.children[i].getTextContent();
        }
        return text;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.formatType = this.formatType;
        return obj;
    }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * @param {1 | 2 | 3 | 4 | 5 | 6} level
 * @param {string | BaseNode[]} content
 * @param {BaseNodeData & Partial<HeadingData>} [data]
 * @returns {HeadingNode}
 */
export function createHeading(level, content, data) {
    return new HeadingNode(level, content, data);
}

/**
 * @param {string | BaseNode[]} content
 * @param {BaseNodeData & ParagraphData} [data]
 * @returns {ParagraphNode}
 */
export function createParagraph(content, data) {
    return new ParagraphNode(content, data);
}

/**
 * @param {"ordered" | "unordered"} listType
 * @param {BaseNodeData & ListData} [data]
 * @returns {ListNode}
 */
export function createList(listType, data) {
    return new ListNode(listType, data);
}

/**
 * @param {string | BaseNode[]} content
 * @param {BaseNodeData} [data]
 * @returns {ListItemNode}
 */
export function createListItem(content, data) {
    return new ListItemNode(content, data);
}

/**
 * @param {string | BaseNode[]} content
 * @param {BaseNodeData & { attribution?: string }} [data]
 * @returns {BlockquoteNode}
 */
export function createBlockquote(content, data) {
    return new BlockquoteNode(content, data);
}

/**
 * @param {string} code
 * @param {BaseNodeData & CodeBlockData} [data]
 * @returns {CodeBlockNode}
 */
export function createCodeBlock(code, data) {
    return new CodeBlockNode(code, data);
}

/**
 * @param {BaseNodeData & HorizontalRuleData} [data]
 * @returns {HorizontalRuleNode}
 */
export function createHorizontalRule(data) {
    return new HorizontalRuleNode(data);
}

/**
 * @param {string} src
 * @param {BaseNodeData & ImageData} [data]
 * @returns {ImageNode}
 */
export function createImage(src, data) {
    return new ImageNode(src, data);
}

/**
 * @param {string} href
 * @param {string | BaseNode[]} content
 * @param {BaseNodeData & Partial<LinkData>} [data]
 * @returns {LinkNode}
 */
export function createLink(href, content, data) {
    return new LinkNode(href, content, data);
}

/**
 * @param {string | BaseNode[]} content
 * @param {BaseNodeData} [data]
 * @returns {InlineFormatNode}
 */
export function createBold(content, data) {
    return new InlineFormatNode("bold", content, data);
}

/**
 * @param {string | BaseNode[]} content
 * @param {BaseNodeData} [data]
 * @returns {InlineFormatNode}
 */
export function createItalic(content, data) {
    return new InlineFormatNode("italic", content, data);
}

/**
 * @param {string | BaseNode[]} content
 * @param {BaseNodeData} [data]
 * @returns {InlineFormatNode}
 */
export function createUnderline(content, data) {
    return new InlineFormatNode("underline", content, data);
}

/**
 * @param {string | BaseNode[]} content
 * @param {BaseNodeData} [data]
 * @returns {InlineFormatNode}
 */
export function createInlineCode(content, data) {
    return new InlineFormatNode("code", content, data);
}
