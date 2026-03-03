/**
 * MarkdownToAstConverter - Converts markdown parser AST to Format AST
 * @module format-ast/converters/MarkdownToAstConverter
 */

import {
    NODE_CATEGORIES,
    PROSE_NODE_TYPES,
    BASE_NODE_TYPES,
    TABULAR_NODE_TYPES
} from "../constants/core.mjs";
import {
    BaseNode,
    TextNode,
    ContainerNode,
    BreakNode
} from "../nodes/BaseNode.mjs";
import { TableNode, RowNode, CellNode } from "../nodes/TabularNode.mjs";
import { BaseDocument, ProseDocument } from "../documents/BaseDocument.mjs";

/**
 * @typedef {import("../../parsing/markdown.mjs").MarkdownNode} MarkdownNode
 * @typedef {import("../../parsing/markdown.mjs").MarkdownNodeType} MarkdownNodeType
 * @typedef {import("../types/core.mjs").NodeType} NodeType
 * @typedef {import("../types/core.mjs").InlineFormatType} InlineFormatType
 */

// =============================================================================
// Node Type Mapping
// =============================================================================

/** @type {Record<MarkdownNodeType, NodeType | null>} */
const NODE_TYPE_MAP = {
    table: TABULAR_NODE_TYPES.TABLE,
    "table-row": TABULAR_NODE_TYPES.ROW,
    "table-cell": TABULAR_NODE_TYPES.CELL,
    paragraph: PROSE_NODE_TYPES.PARAGRAPH,
    heading: PROSE_NODE_TYPES.HEADING,
    list: PROSE_NODE_TYPES.LIST,
    "list-item": PROSE_NODE_TYPES.LIST_ITEM,
    "horizontal-rule": PROSE_NODE_TYPES.HORIZONTAL_RULE,
    "page-break": BASE_NODE_TYPES.BREAK,
    bold: PROSE_NODE_TYPES.INLINE_FORMAT,
    italic: PROSE_NODE_TYPES.INLINE_FORMAT,
    underline: PROSE_NODE_TYPES.INLINE_FORMAT,
    text: BASE_NODE_TYPES.TEXT,
    "code-inline": PROSE_NODE_TYPES.INLINE_FORMAT,
    "code-block": PROSE_NODE_TYPES.CODE_BLOCK,
    blank: null,
    "line-break": BASE_NODE_TYPES.BREAK
};

/** @type {Record<string, InlineFormatType>} */
const INLINE_FORMAT_MAP = {
    bold: "bold",
    italic: "italic",
    underline: "underline",
    "code-inline": "code"
};

// =============================================================================
// Prose Node Classes
// =============================================================================

/**
 * Heading node
 */
export class HeadingNode extends BaseNode {
    /**
     * @param {1 | 2 | 3 | 4 | 5 | 6} level
     * @param {import("../nodes/BaseNode.mjs").BaseNodeData & { anchorId?: string }} [data]
     */
    constructor(level, data = {}) {
        super(PROSE_NODE_TYPES.HEADING, data);
        this.category = NODE_CATEGORIES.PROSE;

        /** @type {1 | 2 | 3 | 4 | 5 | 6} */
        this.level = level;

        /** @type {string | undefined} */
        this.anchorId = data.anchorId;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.level = this.level;
        if (this.anchorId) {
            obj.anchorId = this.anchorId;
        }
        return obj;
    }
}

/**
 * Paragraph node
 */
export class ParagraphNode extends BaseNode {
    /**
     * @param {import("../nodes/BaseNode.mjs").BaseNodeData} [data]
     */
    constructor(data = {}) {
        super(PROSE_NODE_TYPES.PARAGRAPH, data);
        this.category = NODE_CATEGORIES.PROSE;
    }
}

/**
 * List node
 */
export class ListNode extends BaseNode {
    /**
     * @param {"ordered" | "unordered"} listType
     * @param {import("../nodes/BaseNode.mjs").BaseNodeData & { startNumber?: number }} [data]
     */
    constructor(listType, data = {}) {
        super(PROSE_NODE_TYPES.LIST, data);
        this.category = NODE_CATEGORIES.PROSE;

        /** @type {"ordered" | "unordered"} */
        this.listType = listType;

        /** @type {number} */
        this.startNumber = data.startNumber || 1;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.listType = this.listType;
        if (this.listType === "ordered") {
            obj.startNumber = this.startNumber;
        }
        return obj;
    }
}

/**
 * List item node
 */
export class ListItemNode extends BaseNode {
    /**
     * @param {import("../nodes/BaseNode.mjs").BaseNodeData} [data]
     */
    constructor(data = {}) {
        super(PROSE_NODE_TYPES.LIST_ITEM, data);
        this.category = NODE_CATEGORIES.PROSE;
    }
}

/**
 * Code block node
 */
export class CodeBlockNode extends BaseNode {
    /**
     * @param {string} code
     * @param {import("../nodes/BaseNode.mjs").BaseNodeData & { language?: string }} [data]
     */
    constructor(code, data = {}) {
        super(PROSE_NODE_TYPES.CODE_BLOCK, data);
        this.category = NODE_CATEGORIES.PROSE;

        /** @type {string} */
        this.code = code;

        /** @type {string | undefined} */
        this.language = data.language;
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
        return obj;
    }
}

/**
 * Horizontal rule node
 */
export class HorizontalRuleNode extends BaseNode {
    /**
     * @param {import("../nodes/BaseNode.mjs").BaseNodeData} [data]
     */
    constructor(data = {}) {
        super(PROSE_NODE_TYPES.HORIZONTAL_RULE, data);
        this.category = NODE_CATEGORIES.PROSE;
    }

    /** @override */
    canHaveChildren() {
        return false;
    }
}

/**
 * Inline format node (wraps formatted text spans)
 */
export class InlineFormatNode extends BaseNode {
    /**
     * @param {InlineFormatType} formatType
     * @param {import("../nodes/BaseNode.mjs").BaseNodeData} [data]
     */
    constructor(formatType, data = {}) {
        super(PROSE_NODE_TYPES.INLINE_FORMAT, data);
        this.category = NODE_CATEGORIES.PROSE;

        /** @type {InlineFormatType} */
        this.formatType = formatType;
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
    toJSON() {
        const obj = super.toJSON();
        obj.formatType = this.formatType;
        return obj;
    }
}

// =============================================================================
// Converter Class
// =============================================================================

/**
 * Converts markdown AST to format-ast
 */
export class MarkdownToAstConverter {
    constructor() {
        /** @type {string[]} */
        this._warnings = [];
    }

    /**
     * Convert parsed markdown to ProseDocument
     * @param {import("../../parsing/markdown.mjs").ParsedMarkdownDoc} parsed
     * @param {{ title?: string }} [options]
     * @returns {ProseDocument}
     */
    convert(parsed, options = {}) {
        this._warnings = [];

        const doc = new ProseDocument({
            metadata: {
                title: options.title
            }
        });

        /** @type {{ label: string; sep: string } | null} */
        let activeRunIn = null;

        /** @type {{ label: string; sep: string } | null} */
        let activeRunInParent = null;

        /** @type {ListItemNode | null} */
        let lastTopLevelListItem = null;

        for (let i = 0, len = parsed.nodes.length; i < len; i++) {
            const node = this._convertNode(parsed.nodes[i]);
            if (!node) {
                continue;
            }

            // Loose-list continuation: some markdown parsers emit the continuation
            // paragraph as a sibling of the list node (after the list) instead of
            // nesting it under the prior list-item. If the paragraph is indented,
            // attach it to the last list-item so the renderer keeps the hanging indent.
            if (
                !activeRunIn &&
                lastTopLevelListItem &&
                node.type === PROSE_NODE_TYPES.PARAGRAPH
            ) {
                const indentLen = this._getLeadingIndentLen(node);
                if (indentLen >= 2) {
                    const srcIndent =
                        node.attrs &&
                        typeof node.attrs.sourceIndentSpaces === "number"
                            ? node.attrs.sourceIndentSpaces
                            : node.attrs &&
                              typeof node.attrs.source_indent_spaces ===
                                  "number"
                            ? node.attrs.source_indent_spaces
                            : 0;

                    // If indentation is virtual (provided by the markdown parser),
                    // do not consume characters from the paragraph text.
                    if (srcIndent < 2) {
                        this._consumeLeadingChars(node, indentLen);
                        this._trimLeadingWhitespace(node);
                    }
                    lastTopLevelListItem.appendChild(node);
                    continue;
                }
            }

            // Run-in label continuation (non-list): indented paragraph immediately
            // following a run-in label paragraph should align under the content block.
            if (node.type === PROSE_NODE_TYPES.PARAGRAPH) {
                const indentLen = this._getLeadingIndentLen(node);
                const ownLabel = this._getRunInLabelInfoFromNode(node);

                if (activeRunIn && !ownLabel && indentLen >= 2) {
                    this._setAttr(
                        node,
                        "runInLabelContinuationLabel",
                        activeRunIn.label
                    );
                    this._setAttr(
                        node,
                        "runInLabelContinuationSep",
                        activeRunIn.sep
                    );

                    // Propagate parent indent so continuations of nested
                    // sub-items (e.g. text under "(a)") also indent under "2.".
                    if (activeRunInParent) {
                        this._setAttr(
                            node,
                            "runInParentLabel",
                            activeRunInParent.label
                        );
                        this._setAttr(
                            node,
                            "runInParentLabelSep",
                            activeRunInParent.sep
                        );
                    }

                    const srcIndent =
                        node.attrs &&
                        typeof node.attrs.sourceIndentSpaces === "number"
                            ? node.attrs.sourceIndentSpaces
                            : node.attrs &&
                              typeof node.attrs.source_indent_spaces ===
                                  "number"
                            ? node.attrs.source_indent_spaces
                            : 0;

                    // Indentation from markdown is not literal spaces in text.
                    if (srcIndent < 2) {
                        this._consumeLeadingChars(node, indentLen);
                        this._trimLeadingWhitespace(node);
                    }
                }

                if (ownLabel) {
                    // If there is an active parent run-in and this paragraph is
                    // indented, record the parent label so the renderer can shift
                    // the margin and nest the sub-item (e.g. "(a)" under "2.").
                    if (activeRunIn && indentLen >= 2) {
                        // For sibling sub-items (e.g. "(b)" following "(a)"),
                        // re-use the existing parent rather than using the
                        // sibling "(a)" as the parent.
                        const parent = activeRunInParent || activeRunIn;
                        this._setAttr(node, "runInParentLabel", parent.label);
                        this._setAttr(node, "runInParentLabelSep", parent.sep);
                        if (!activeRunInParent) {
                            activeRunInParent = activeRunIn;
                        }
                    } else {
                        activeRunInParent = null;
                    }
                    activeRunIn = ownLabel;
                } else if (indentLen < 2) {
                    activeRunIn = null;
                    activeRunInParent = null;
                }
            } else {
                // Keep the active run-in label across indented nested lists so that
                // the list and subsequent indented paragraphs align under the same
                // hanging block.
                if (node.type === PROSE_NODE_TYPES.LIST && activeRunIn) {
                    const srcIndent =
                        node.attrs &&
                        typeof node.attrs.sourceIndentLevel === "number"
                            ? node.attrs.sourceIndentLevel
                            : node.attrs &&
                              typeof node.attrs.source_indent_level === "number"
                            ? node.attrs.source_indent_level
                            : 0;

                    if (srcIndent >= 1) {
                        this._setAttr(
                            node,
                            "runInLabelContinuationLabel",
                            activeRunIn.label
                        );
                        this._setAttr(
                            node,
                            "runInLabelContinuationSep",
                            activeRunIn.sep
                        );
                    } else {
                        activeRunIn = null;
                        activeRunInParent = null;
                    }
                } else {
                    activeRunIn = null;
                    activeRunInParent = null;
                }
            }

            doc.append(node);

            // Arm list continuation only for an immediately preceding top-level list.
            if (node.type === PROSE_NODE_TYPES.LIST) {
                lastTopLevelListItem = this._getLastListItem(node);
            } else {
                lastTopLevelListItem = null;
            }
        }

        return doc;
    }

    /**
     * Convert single markdown node to format-ast node
     * @param {MarkdownNode} mdNode
     * @returns {BaseNode | null}
     */
    _convertNode(mdNode) {
        switch (mdNode.type) {
            case "heading":
                return this._convertHeading(mdNode);

            case "paragraph":
                return this._convertParagraph(mdNode);

            case "list":
                return this._convertList(mdNode);

            case "list-item":
                return this._convertListItem(mdNode);

            case "code-block":
                return this._convertCodeBlock(mdNode);

            case "table":
                return this._convertTable(mdNode);

            case "table-row":
                return this._convertTableRow(mdNode);

            case "table-cell":
                return this._convertTableCell(mdNode);

            case "horizontal-rule":
                return new HorizontalRuleNode();

            case "page-break":
                return new BreakNode("page");

            case "line-break":
                return new BreakNode("section");

            case "text":
                return new TextNode(mdNode.content);

            case "bold":
                return this._convertInlineFormat(mdNode, "bold");

            case "italic":
                return this._convertInlineFormat(mdNode, "italic");

            case "underline":
                return this._convertInlineFormat(mdNode, "underline");

            case "code-inline":
                return this._convertInlineFormat(mdNode, "code");

            case "blank":
                return null;

            default:
                this._warnings.push(`Unknown node type: ${mdNode.type}`);
                return null;
        }
    }

    /**
     * Convert heading
     * @param {MarkdownNode} mdNode
     * @returns {HeadingNode}
     */
    _convertHeading(mdNode) {
        const level = /** @type {1 | 2 | 3 | 4 | 5 | 6} */ (
            Math.min(Math.max(mdNode.level || 1, 1), 6)
        );
        const heading = new HeadingNode(level, {
            anchorId: mdNode.anchorId
        });

        // Convert children (inline content)
        this._convertChildren(mdNode, heading);

        return heading;
    }

    /**
     * Convert paragraph
     * @param {MarkdownNode} mdNode
     * @returns {ParagraphNode}
     */
    _convertParagraph(mdNode) {
        const para = new ParagraphNode();

        // Preserve parser-provided indentation without rendering literal spaces.
        // This feeds continuation / loose-list logic later in conversion.
        const indentSpacesRaw = mdNode.attrs
            ? mdNode.attrs["indentSpaces"]
            : undefined;
        const indentSpaces =
            typeof indentSpacesRaw === "number" && indentSpacesRaw > 0
                ? indentSpacesRaw
                : 0;

        if (indentSpaces > 0) {
            this._setAttr(para, "sourceIndentSpaces", indentSpaces);
        }

        this._convertChildren(mdNode, para);

        // Filing-style run-in labels (e.g., "2. " / "(a) " / "2.A.1 " )
        this._maybeApplyRunInLabelPrefix(para);

        return para;
    }

    /**
     * Convert list
     * @param {MarkdownNode} mdNode
     * @returns {ListNode}
     */
    _convertList(mdNode) {
        // Determine if ordered based on children content
        const isOrdered = this._isOrderedList(mdNode);
        const list = new ListNode(isOrdered ? "ordered" : "unordered");

        // Preserve original indentation level for lists (useful for run-in label continuation).
        // Our markdown parser stores the detected list indentation in each list-item's "level".
        // We capture the first non-zero level (if any) as the list's source indent level.
        let sourceIndentLevel = 0;
        if (Array.isArray(mdNode.children)) {
            for (let i = 0, len = mdNode.children.length; i < len; i++) {
                const ch = mdNode.children[i];
                if (
                    ch &&
                    ch.type === "list-item" &&
                    typeof ch.level === "number" &&
                    ch.level > 0
                ) {
                    sourceIndentLevel = ch.level;
                    break;
                }
            }
        }
        if (sourceIndentLevel > 0) {
            this._setAttr(list, "sourceIndentLevel", sourceIndentLevel);
        }

        // Loose-list normalization: some parsers emit continuation blocks
        // (paragraphs, nested lists, etc.) as siblings of "list-item" nodes
        // within the list. Attach those blocks to the preceding list-item so
        // the renderer keeps the hanging indent.
        /** @type {ListItemNode | null} */
        let lastItem = null;

        if (mdNode.children && mdNode.children.length > 0) {
            for (let i = 0, len = mdNode.children.length; i < len; i++) {
                const child = this._convertNode(mdNode.children[i]);
                if (!child) {
                    continue;
                }

                if (child.type === PROSE_NODE_TYPES.LIST_ITEM) {
                    list.appendChild(child);
                    lastItem = /** @type {ListItemNode} */ (child);
                    continue;
                }

                if (lastItem) {
                    lastItem.appendChild(child);
                } else {
                    list.appendChild(child);
                }
            }
        }

        return list;
    }

    /**
     * Check if list appears to be ordered
     * @param {MarkdownNode} mdNode
     * @returns {boolean}
     */
    _isOrderedList(mdNode) {
        if (mdNode.children.length === 0) {
            return false;
        }
        // Check first item's content for number pattern
        const firstItem = mdNode.children[0];
        if (firstItem && firstItem.content) {
            return /^\d+\./.test(firstItem.content.trim());
        }
        return false;
    }

    /**
     * Convert list item
     * @param {MarkdownNode} mdNode
     * @returns {ListItemNode}
     */
    _convertListItem(mdNode) {
        const item = new ListItemNode();

        let hasNonListChildren = false;
        if (Array.isArray(mdNode.children)) {
            for (let i = 0, len = mdNode.children.length; i < len; i++) {
                const child = mdNode.children[i];
                const type = child && child.type;
                if (type && type !== "list" && type !== "blank") {
                    hasNonListChildren = true;
                    break;
                }
            }
        }

        // Add text content only when the parser didn't already provide inline children.
        if (
            !hasNonListChildren &&
            mdNode.content &&
            mdNode.content.trim().length > 0
        ) {
            // Strip leading marker (-, *, or ordered marker like "2." / "2)")
            let content = mdNode.content.trim();
            content = content.replace(/^[-*]\s*/, "");

            // If this is an ordered list marker, capture it so the renderer can show it
            const orderedMatch = content.match(/^(\d+)([\.\)])\s+/);
            if (orderedMatch) {
                const label = `${orderedMatch[1]}${orderedMatch[2]}`;
                this._setAttr(item, "runInLabel", label);
                this._setAttr(item, "runInLabelSeparator", " ");
            }

            content = content.replace(/^(\d+)([\.\)])\s*/, "");
            if (content.length > 0) {
                item.appendChild(new TextNode(content));
            }
        }

        // Convert nested children (nested lists, etc.)
        this._convertChildren(mdNode, item);

        return item;
    }

    // ---------------------------------------------------------------------
    // Run-in label (semi-inlineblock) support
    // ---------------------------------------------------------------------

    /**
     * Detect prefixes like "2. " / "(a) " / "2.A.1 " on a standalone line and
     * convert a paragraph into a run-in label paragraph (label rendered in a
     * gutter, content block indented so wrapped lines align under the content).
     *
     * Inline uses inside a sentence are unaffected because this only triggers
     * when the prefix is at the start of the paragraph.
     *
     * @param {ParagraphNode} para
     * @returns {void}
     */
    _maybeApplyRunInLabelPrefix(para) {
        const plain = this._extractPlainText(para);
        const match = this._matchRunInLabelPrefix(plain);
        if (!match) return;

        this._setAttr(para, "runInLabel", match.label);
        this._setAttr(para, "runInLabelSeparator", " ");

        // Strip the matched prefix (including trailing whitespace) from inline children
        this._consumeLeadingChars(para, match.prefixLen);
        this._trimLeadingWhitespace(para);
    }

    /**
     * Read run-in label metadata from an already-converted node.
     * @param {BaseNode} node
     * @returns {{ label: string; sep: string } | null}
     */
    _getRunInLabelInfoFromNode(node) {
        if (!node || !node.attrs) return null;

        const raw =
            typeof node.attrs.runInLabel === "string"
                ? node.attrs.runInLabel
                : typeof node.attrs.run_in_label === "string"
                ? node.attrs.run_in_label
                : null;

        if (!raw) return null;
        const label = raw.trim();
        if (label.length === 0) return null;

        const sep =
            typeof node.attrs.runInLabelSeparator === "string"
                ? node.attrs.runInLabelSeparator
                : typeof node.attrs.run_in_label_separator === "string"
                ? node.attrs.run_in_label_separator
                : " ";

        return { label, sep: sep && sep.length > 0 ? sep : " " };
    }

    /**
     * Detect leading indentation on a paragraph (spaces/tabs).
     * Used to decide whether a paragraph is a continuation block.
     *
     * @param {BaseNode} node
     * @returns {number}
     */
    _getLeadingIndentLen(node) {
        const srcIndent =
            node &&
            node.attrs &&
            typeof node.attrs.sourceIndentSpaces === "number"
                ? node.attrs.sourceIndentSpaces
                : node &&
                  node.attrs &&
                  typeof node.attrs.source_indent_spaces === "number"
                ? node.attrs.source_indent_spaces
                : 0;

        if (srcIndent >= 2) {
            return Math.min(srcIndent, 12);
        }

        const plain = this._extractPlainText(node);
        const m = plain.match(/^[ \t]+/);
        if (!m) return 0;

        // Only treat 2+ spaces as structural indent.
        if (m[0].length < 2) return 0;

        // Cap to avoid consuming meaningful spacing in weird cases.
        return Math.min(m[0].length, 12);
    }

    /**
     * Find the last list-item child of a list node.
     * @param {BaseNode} list
     * @returns {ListItemNode | null}
     */
    _getLastListItem(list) {
        if (!list || !Array.isArray(list.children)) return null;

        for (let i = list.children.length - 1; i >= 0; i--) {
            const child = list.children[i];
            if (child && child.type === PROSE_NODE_TYPES.LIST_ITEM) {
                return /** @type {ListItemNode} */ (child);
            }
        }
        return null;
    }

    /**
     * @param {BaseNode} node
     * @returns {string}
     */
    _extractPlainText(node) {
        if (!node) return "";

        if (node.type === BASE_NODE_TYPES.TEXT) {
            if (typeof node.getTextContent === "function") {
                return String(node.getTextContent());
            }
            return node.attrs && typeof node.attrs.text === "string"
                ? node.attrs.text
                : "";
        }

        if (node.type === BASE_NODE_TYPES.BREAK) {
            return "\n";
        }

        let out = "";
        if (Array.isArray(node.children)) {
            for (let i = 0, len = node.children.length; i < len; i++) {
                out += this._extractPlainText(node.children[i]);
            }
        }
        return out;
    }

    /**
     * @param {string} text
     * @returns {{ label: string; prefixLen: number } | null}
     */
    _matchRunInLabelPrefix(text) {
        if (!text || text.length === 0) return null;

        // Strict: start-of-paragraph only, and must be followed by whitespace.
        // Examples:
        //  - 2. Text
        //  - a) Text
        //  - (a) Text
        //  - (i) Text
        //  - (A) Text
        //  - 2.A Text
        //  - 2.A.1 Text
        const re =
            /^\s*(?:\uFEFF)?(?<label>(?:\d+(?:\.[A-Za-z0-9]+)+\.?|\d+[.)]|[A-Za-z][.)]|\((?:\d+|[A-Za-z]|[ivxlcdmIVXLCDM]+)\)))(?<sep>\s+)/;
        const m = text.match(re);
        if (!m || !m.groups || !m.groups.label) return null;

        const label = m.groups.label;
        if (label.length > 32) return null;

        return { label, prefixLen: m[0].length };
    }

    /**
     * Consume leading characters across nested inline children (depth-first).
     * Returns number of characters consumed.
     *
     * @param {BaseNode} node
     * @param {number} count
     * @returns {number}
     */
    _consumeLeadingChars(node, count) {
        if (!node || count <= 0) return 0;

        if (node.type === BASE_NODE_TYPES.TEXT) {
            const current = this._extractPlainText(node);
            const consumed = Math.min(count, current.length);
            const nextText = current.slice(consumed);

            /** @type {TextNode} */ (node).setTextContent(nextText);

            return consumed;
        }

        if (!Array.isArray(node.children) || node.children.length === 0) {
            return 0;
        }

        let consumedTotal = 0;
        for (let i = 0; i < node.children.length && consumedTotal < count; ) {
            const child = node.children[i];
            const consumed = this._consumeLeadingChars(
                child,
                count - consumedTotal
            );
            consumedTotal += consumed;

            // Prune empty nodes
            if (this._isEmptyInlineNode(child)) {
                node.children.splice(i, 1);
                continue;
            }
            i++;
        }

        return consumedTotal;
    }

    /**
     * @param {BaseNode} node
     * @returns {boolean}
     */
    _isEmptyInlineNode(node) {
        if (!node) return true;
        if (node.type === BASE_NODE_TYPES.TEXT) {
            return this._extractPlainText(node).length === 0;
        }
        if (Array.isArray(node.children)) {
            return node.children.length === 0;
        }
        return false;
    }

    /**
     * Trim leading whitespace across inline children (after prefix removal).
     * @param {BaseNode} node
     */
    _trimLeadingWhitespace(node) {
        const plain = this._extractPlainText(node);
        const m = plain.match(/^\s+/);
        if (!m) return;
        this._consumeLeadingChars(node, m[0].length);
    }

    /**
     * Set an attribute across varying BaseNode implementations safely.
     * @param {BaseNode} node
     * @param {string} key
     * @param {any} value
     */
    _setAttr(node, key, value) {
        if (!node) return;
        if (typeof node.setAttr === "function") {
            node.setAttr(key, value);
            return;
        }
        if (!node.attrs || typeof node.attrs !== "object") {
            node.attrs = {};
        }
        node.attrs[key] = value;
    }

    /**
     * Convert code block
     * @param {MarkdownNode} mdNode
     * @returns {CodeBlockNode}
     */
    _convertCodeBlock(mdNode) {
        // Extract language from first line if present
        let code = mdNode.content;
        let language;

        const lines = code.split("\n");
        if (lines.length > 0) {
            const firstLine = lines[0].trim();
            // Check if first line is just a language identifier
            if (
                firstLine.length > 0 &&
                !firstLine.includes(" ") &&
                firstLine.length < 20
            ) {
                language = firstLine;
                code = lines.slice(1).join("\n");
            }
        }

        return new CodeBlockNode(code, { language });
    }

    // ---------------------------------------------------------------------
    // Tables
    // ---------------------------------------------------------------------

    /**
     * Convert table
     * @param {MarkdownNode} mdNode
     * @returns {TableNode}
     */
    _convertTable(mdNode) {
        /** @type {any} */
        const anyNode = mdNode;

        /** @type {any[]} */
        const mdRows = Array.isArray(anyNode.rows)
            ? anyNode.rows
            : Array.isArray(mdNode.children)
            ? mdNode.children
            : [];

        /** @type {any[] | undefined} */
        const aligns = Array.isArray(anyNode.aligns)
            ? anyNode.aligns
            : Array.isArray(anyNode.alignments)
            ? anyNode.alignments
            : Array.isArray(anyNode.columnAlign)
            ? anyNode.columnAlign
            : Array.isArray(anyNode.attrs?.columnAlign)
            ? anyNode.attrs.columnAlign
            : undefined;

        /** @type {any[] | undefined} */
        const mdColumns = Array.isArray(anyNode.columns)
            ? anyNode.columns
            : Array.isArray(anyNode.attrs?.columns)
            ? anyNode.attrs.columns
            : undefined;

        const table = new TableNode({
            caption: anyNode.caption,
            headerRow: anyNode.headerRow !== false
        });

        if (anyNode.caption) {
            this._setAttr(table, "caption", anyNode.caption);
        }
        if (anyNode.headerRow === false) {
            this._setAttr(table, "headerRow", false);
        }

        // Column definitions: prefer explicit parser-provided columns, else derive from aligns.
        if (mdColumns && mdColumns.length > 0) {
            this._setAttr(table, "columns", mdColumns);
        } else if (aligns && aligns.length > 0) {
            /** @type {any[]} */
            const cols = [];
            for (let i = 0, len = aligns.length; i < len; i++) {
                const a = aligns[i];
                const align =
                    a === "center" || a === "right" || a === "left"
                        ? a
                        : undefined;
                cols.push(align ? { align } : {});
            }
            this._setAttr(table, "columns", cols);
        }

        for (let i = 0, len = mdRows.length; i < len; i++) {
            const mdRow = mdRows[i];
            const rowNode = this._convertTableRow(mdRow, i, table);
            if (rowNode) {
                table.appendChild(rowNode);
            }
        }

        return table;
    }

    /**
     * Convert table row
     * @param {MarkdownNode} mdNode
     * @param {number} [rowIndex]
     * @param {TableNode} [table]
     * @returns {RowNode | null}
     */
    _convertTableRow(mdNode, rowIndex = 0, table) {
        /** @type {any} */
        const anyNode = mdNode;

        if (!mdNode) return null;

        /** @type {any[]} */
        const mdCells = Array.isArray(anyNode.cells)
            ? anyNode.cells
            : Array.isArray(mdNode.children)
            ? mdNode.children
            : [];

        const isHeader =
            anyNode.isHeader === true ||
            anyNode.attrs?.isHeader === true ||
            (rowIndex === 0 &&
                (table ? table.attrs?.headerRow !== false : true));

        const row = new RowNode({ isHeader });

        for (let i = 0, len = mdCells.length; i < len; i++) {
            const mdCell = mdCells[i];
            const cell = this._convertTableCell(mdCell, isHeader, table, i);
            if (cell) {
                row.appendChild(cell);
            }
        }

        return row;
    }

    /**
     * Convert table cell
     * @param {MarkdownNode} mdNode
     * @param {boolean} [isHeader]
     * @param {TableNode} [table]
     * @param {number} [colIndex]
     * @returns {CellNode | null}
     */
    _convertTableCell(mdNode, isHeader = false, table, colIndex = 0) {
        if (!mdNode) return null;

        /** @type {any} */
        const anyNode = mdNode;

        // Alignment: prefer explicit cell align, else column align
        /** @type {any} */
        const colDefs = table ? table.attrs?.columns : undefined;
        const colAlign =
            Array.isArray(colDefs) && colDefs[colIndex]
                ? colDefs[colIndex].align
                : undefined;
        const align =
            anyNode.align === "left" ||
            anyNode.align === "center" ||
            anyNode.align === "right"
                ? anyNode.align
                : colAlign === "left" ||
                  colAlign === "center" ||
                  colAlign === "right"
                ? colAlign
                : undefined;

        // Content: prefer inline children, else mdNode.content
        /** @type {BaseNode[]} */
        const inline = this._convertInlineChildren(mdNode);
        const cellContent =
            inline.length > 0
                ? inline
                : typeof anyNode.content === "string"
                ? anyNode.content
                : "";

        const cell = new CellNode(cellContent, { isHeader });
        if (align) {
            this._setAttr(cell, "align", align);
        }

        return cell;
    }

    /**
     * Convert markdown node children into *inline* format nodes (flattening paragraphs).
     * @param {MarkdownNode} mdNode
     * @returns {BaseNode[]}
     */
    _convertInlineChildren(mdNode) {
        /** @type {BaseNode[]} */
        const out = [];

        if (!mdNode || !Array.isArray(mdNode.children)) {
            return out;
        }

        for (let i = 0, len = mdNode.children.length; i < len; i++) {
            const child = mdNode.children[i];
            if (!child) continue;

            if (child.type === "paragraph") {
                // Flatten paragraph contents inside table cells
                if (Array.isArray(child.children)) {
                    for (
                        let j = 0, jlen = child.children.length;
                        j < jlen;
                        j++
                    ) {
                        const grand = child.children[j];
                        const n = this._convertNode(grand);
                        if (n) out.push(n);
                    }
                } else if (typeof child.content === "string") {
                    out.push(new TextNode(child.content));
                }
                continue;
            }

            const n = this._convertNode(child);
            if (n) out.push(n);
        }

        return out;
    }

    /**
     * Convert inline format
     * @param {MarkdownNode} mdNode
     * @param {InlineFormatType} formatType
     * @returns {InlineFormatNode}
     */
    _convertInlineFormat(mdNode, formatType) {
        const format = new InlineFormatNode(formatType);

        if (mdNode.content) {
            format.appendChild(new TextNode(mdNode.content));
        }

        this._convertChildren(mdNode, format);

        return format;
    }

    /**
     * Convert children of a node
     * @param {MarkdownNode} mdNode
     * @param {BaseNode} targetNode
     */
    _convertChildren(mdNode, targetNode) {
        if (!mdNode.children || mdNode.children.length === 0) {
            return;
        }

        for (let i = 0, len = mdNode.children.length; i < len; i++) {
            const child = this._convertNode(mdNode.children[i]);
            if (child) {
                targetNode.appendChild(child);
            }
        }
    }

    /**
     * Get conversion warnings
     * @returns {string[]}
     */
    getWarnings() {
        return [...this._warnings];
    }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create converter instance
 * @returns {MarkdownToAstConverter}
 */
export function createMarkdownConverter() {
    return new MarkdownToAstConverter();
}

/**
 * Quick convert markdown AST to document
 * @param {import("../../parsing/markdown.mjs").ParsedMarkdownDoc} parsed
 * @param {{ title?: string }} [options]
 * @returns {ProseDocument}
 */
export function convertMarkdownToDocument(parsed, options) {
    const converter = new MarkdownToAstConverter();
    return converter.convert(parsed, options);
}
