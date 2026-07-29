/**
 * Pure ESM Markdown Parser - No dependencies, AST output only
 * @module MarkdownParser
 */

// ============================================================================
// Type Definitions (JSDoc)
// ============================================================================

/**
 * @typedef {"paragraph" | "heading" | "list" | "list-item"
 * | "horizontal-rule" | "page-break"
 * | "table" | "table-row" | "table-cell"
 * | "bold" | "strong" | "italic" | "underline"
 * | "em" | "emphasis"
 * | "text" | "code-inline" | "code-block" | "code"
 * | "blank" | "line-break" | "directive" | "notice"
 * | "link" | "form-field"} MarkdownNodeType
 */

/**
 * @typedef {Object} MarkdownNode
 * @property {MarkdownNodeType} type
 * @property {string} content
 * @property {MarkdownNode[]} children
 * @property {number} [level]
 * @property {string} [anchorId]
 * @property {Record<string, unknown>} [attrs]
 */

/**
 * @typedef {Object} MarkdownDocEntry
 * @property {string} key
 * @property {string} anchorId
 * @property {string} summary
 * @property {number} nodeIndex
 */

/**
 * @typedef {Object.<string, MarkdownDocEntry>} MarkdownDocIndex
 */

/**
 * @typedef {Object} ParsedMarkdownDoc
 * @property {MarkdownNode[]} nodes
 * @property {MarkdownDocIndex} index
 */

/**
 * @typedef {Object.<number, string>} MarkdownDocAnchorIndex
 */

// ============================================================================
// Constants
// ============================================================================

const CHAR_NEWLINE = 10;
const CHAR_CR = 13;
const CHAR_SPACE = 32;
const CHAR_HASH = 35;
const CHAR_STAR = 42;
const CHAR_DASH = 45;
const CHAR_DOT = 46;
const CHAR_UNDERSCORE = 95;
const CHAR_BACKTICK = 96;
const CHAR_EM_DASH_START = 226;
const CHAR_LT = 60;
const CHAR_GT = 62;
const CHAR_SLASH = 47;
const CHAR_COLON = 58;
const CHAR_BACKSLASH = 92;
const CHAR_PIPE = 124;

const CHAR_QUESTION = 63;
const CHAR_EXCLAIM = 33;
const CHAR_SEMICOLON = 59;
const CHAR_COMMA = 44;

const CHAR_OPEN_BRACKET = 91;
const CHAR_CLOSE_BRACKET = 93;
const CHAR_OPEN_PAREN = 40;
const CHAR_CLOSE_PAREN = 41;

const ESCAPABLE_INLINE_CHARACTERS = new Set([
    CHAR_BACKSLASH,
    CHAR_STAR,
    CHAR_UNDERSCORE,
    CHAR_BACKTICK,
    CHAR_PIPE,
    CHAR_OPEN_BRACKET,
    CHAR_CLOSE_BRACKET,
    CHAR_OPEN_PAREN,
    CHAR_CLOSE_PAREN
]);

const MAX_LIST_LEVEL = 8;
const INDENT_SPACES_PER_LEVEL = 2;

/**
 * Characters that signal the end of a sentence / clause.
 * When a line ends with one of these, a soft-wrapped newline is treated as a
 * hard break (i.e. the next source line starts a new paragraph / segment).
 * @type {ReadonlySet<number>}
 */
const SENTENCE_TERMINATORS = new Set([
    CHAR_DOT, // .
    CHAR_QUESTION, // ?
    CHAR_EXCLAIM, // !
    CHAR_COLON, // :
    CHAR_SEMICOLON // ;
]);

/**
 * Characters after which a trailing space on a source line opts in to
 * soft-wrap joining. Superset of SENTENCE_TERMINATORS — also includes comma.
 * @type {ReadonlySet<number>}
 */
const SOFT_WRAP_JOINERS = new Set([
    CHAR_DOT, // .
    CHAR_QUESTION, // ?
    CHAR_EXCLAIM, // !
    CHAR_COLON, // :
    CHAR_SEMICOLON, // ;
    CHAR_CLOSE_PAREN // ) — closes a link
]);

/**
 * Returns true when the trimmed content ends with a sentence-terminating
 * character (.  ?  !  :  ;).  Used by soft-wrap mode to decide whether a
 * source newline should be preserved as a hard break.
 * @param {string} content
 * @returns {boolean}
 */

/**
 * @param {string} value
 * @returns {boolean}
 */
function isLikelyBracketPlaceholderContent(value) {
    const trimmed = value.trim();
    if (trimmed.length < 2 || trimmed.length > 120) {
        return false;
    }
    if (!/[A-Za-z]/.test(trimmed)) {
        return false;
    }
    if (/^[0-9\s,.;:()_-]+$/.test(trimmed)) {
        return false;
    }
    if (/^(?:https?:\/\/|www\.)/i.test(trimmed)) {
        return false;
    }
    if (/^[A-Za-z]:\\/.test(trimmed)) {
        return false;
    }
    return !/[{}<>]/.test(trimmed);
}

/**
 * @param {string} value
 * @returns {string}
 */
function canonicalInlineFieldKey(value) {
    return (
        value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "") || "field"
    );
}

/**
 * @param {string} content
 * @returns {boolean}
 */
function endsWithSentenceTerminator(content) {
    let i = content.length - 1;
    // Skip trailing whitespace
    while (i >= 0 && content.charCodeAt(i) === CHAR_SPACE) {
        i = i - 1;
    }
    if (i < 0) {
        return false;
    }
    // If content ends with a link's closing `)`, walk back past `](url)` to
    // find the char before the link — e.g. "see [foo](url)." → finds the `.`
    // before `[foo](url)`.  Without this, URLs containing dots could cause
    // the check to silently skip past the structural `)`.
    if (content.charCodeAt(i) === CHAR_CLOSE_PAREN) {
        // Scan backwards for the matching `(`
        let depth = 1;
        let j = i - 1;
        while (j >= 0 && depth > 0) {
            const c = content.charCodeAt(j);
            if (c === CHAR_CLOSE_PAREN) {
                depth = depth + 1;
            } else if (c === CHAR_OPEN_PAREN) {
                depth = depth - 1;
            }
            j = j - 1;
        }
        // Expect `]` immediately before `(`
        if (
            depth === 0 &&
            j >= 0 &&
            content.charCodeAt(j) === CHAR_CLOSE_BRACKET
        ) {
            // Find matching `[`
            let k = j - 1;
            while (k >= 0 && content.charCodeAt(k) !== CHAR_OPEN_BRACKET) {
                k = k - 1;
            }
            if (k > 0) {
                // Check the char before the `[`
                let before = k - 1;
                while (
                    before >= 0 &&
                    content.charCodeAt(before) === CHAR_SPACE
                ) {
                    before = before - 1;
                }
                if (before >= 0) {
                    return SENTENCE_TERMINATORS.has(content.charCodeAt(before));
                }
            }
            // Link was at the very start — no preceding char
            return false;
        }
    }
    return SENTENCE_TERMINATORS.has(content.charCodeAt(i));
}

// ============================================================================
// Core Parser Functions
// ============================================================================

/**
 * Groups flat list-item nodes into nested list structures
 * @param {MarkdownNode[]} nodes
 * @returns {MarkdownNode[]}
 */
function groupListItems(nodes) {
    /** @type {MarkdownNode[]} */
    const grouped = [];
    /** @type {{ level: number; listNode: MarkdownNode }[]} */
    const stack = [];

    for (let i = 0, len = nodes.length; i < len; i++) {
        const node = nodes[i];

        if (node.type !== "list-item") {
            stack.length = 0;
            grouped.push(node);
            continue;
        }

        const nodeLevel =
            node.level !== undefined && node.level >= 0 ? node.level : 0;
        let level = nodeLevel;
        if (level > MAX_LIST_LEVEL) {
            level = MAX_LIST_LEVEL;
        }

        if (stack.length === 0) {
            /** @type {MarkdownNode} */
            const listNode = {
                type: "list",
                content: "",
                children: [node]
            };
            grouped.push(listNode);
            stack.push({ level, listNode });
            continue;
        }

        let top = stack[stack.length - 1];

        if (level > top.level) {
            const parentListNode = top.listNode;
            const parentChildren = parentListNode.children;
            const parentItem =
                parentChildren.length > 0
                    ? parentChildren[parentChildren.length - 1]
                    : undefined;

            if (!parentItem) {
                top.listNode.children.push(node);
                continue;
            }

            /** @type {MarkdownNode} */
            const nestedList = {
                type: "list",
                content: "",
                children: [node]
            };
            parentItem.children.push(nestedList);
            stack.push({ level, listNode: nestedList });
            continue;
        }

        if (level === top.level) {
            top.listNode.children.push(node);
            continue;
        }

        while (stack.length > 0 && stack[stack.length - 1].level > level) {
            stack.pop();
        }

        if (stack.length === 0) {
            /** @type {MarkdownNode} */
            const listNode = {
                type: "list",
                content: "",
                children: [node]
            };
            grouped.push(listNode);
            stack.push({ level, listNode });
        } else {
            top = stack[stack.length - 1];
            top.listNode.children.push(node);
        }
    }

    return grouped;
}

/**
 * Parses inline content (bold, italic, code, text) from a string
 * @param {string} content
 * @returns {MarkdownNode[]}
 */
function parseInlineContent(content) {
    /** @type {MarkdownNode[]} */
    const nodes = [];
    const len = content.length;
    let pos = 0;

    while (pos < len) {
        const ch = content.charCodeAt(pos);

        if (ch === CHAR_BACKSLASH && pos + 1 < len) {
            const escapedCharacter = content.charCodeAt(pos + 1);
            if (ESCAPABLE_INLINE_CHARACTERS.has(escapedCharacter)) {
                nodes.push({
                    type: "text",
                    content: content[pos + 1],
                    children: []
                });
                pos = pos + 2;
                continue;
            }
        }

        if (ch === CHAR_STAR) {
            if (pos + 1 < len && content.charCodeAt(pos + 1) === CHAR_STAR) {
                let endPos = pos + 2;
                let foundEnd = false;
                while (endPos < len - 1) {
                    if (
                        content.charCodeAt(endPos) === CHAR_STAR &&
                        content.charCodeAt(endPos + 1) === CHAR_STAR
                    ) {
                        foundEnd = true;
                        break;
                    }
                    endPos = endPos + 1;
                }

                if (foundEnd) {
                    const boldContent = content.slice(pos + 2, endPos);
                    nodes.push({
                        type: "bold",
                        content: boldContent,
                        children: parseInlineContent(boldContent)
                    });
                    pos = endPos + 2;
                    continue;
                }
            }
        }

        if (ch === CHAR_BACKTICK) {
            let endPos = pos + 1;
            while (endPos < len) {
                if (content.charCodeAt(endPos) === CHAR_BACKTICK) {
                    break;
                }
                endPos = endPos + 1;
            }

            if (endPos < len) {
                const codeContent = content.slice(pos + 1, endPos);
                nodes.push({
                    type: "code-inline",
                    content: codeContent,
                    children: []
                });
                pos = endPos + 1;
                continue;
            }
        }

        if (ch === CHAR_UNDERSCORE) {
            let endPos = pos + 1;
            while (endPos < len) {
                if (content.charCodeAt(endPos) === CHAR_UNDERSCORE) {
                    break;
                }
                endPos = endPos + 1;
            }

            if (endPos < len) {
                const italicContent = content.slice(pos + 1, endPos);
                nodes.push({
                    type: "italic",
                    content: italicContent,
                    children: parseInlineContent(italicContent)
                });
                pos = endPos + 1;
                continue;
            }
        }

        if (ch === CHAR_OPEN_BRACKET) {
            // GitHub-style link: [label](url)
            let closeLabel = pos + 1;
            while (
                closeLabel < len &&
                content.charCodeAt(closeLabel) !== CHAR_CLOSE_BRACKET
            ) {
                closeLabel = closeLabel + 1;
            }
            if (
                closeLabel < len &&
                closeLabel + 1 < len &&
                content.charCodeAt(closeLabel + 1) === CHAR_OPEN_PAREN
            ) {
                let closeParen = closeLabel + 2;
                while (
                    closeParen < len &&
                    content.charCodeAt(closeParen) !== CHAR_CLOSE_PAREN
                ) {
                    closeParen = closeParen + 1;
                }
                if (closeParen < len) {
                    const label = content.slice(pos + 1, closeLabel);
                    const href = content.slice(closeLabel + 2, closeParen);
                    nodes.push({
                        type: "link",
                        content: label,
                        children: [
                            { type: "text", content: label, children: [] }
                        ],
                        attrs: { href }
                    });
                    pos = closeParen + 1;
                    continue;
                }
            }

            if (closeLabel < len) {
                const rawText = content.slice(pos, closeLabel + 1);
                const placeholderText = content
                    .slice(pos + 1, closeLabel)
                    .trim();

                if (isLikelyBracketPlaceholderContent(placeholderText)) {
                    nodes.push({
                        type: "form-field",
                        content: placeholderText,
                        children: [],
                        attrs: {
                            fieldType: "text",
                            rawText,
                            placeholderText,
                            fieldNameKey:
                                canonicalInlineFieldKey(placeholderText)
                        }
                    });
                    pos = closeLabel + 1;
                    continue;
                }
            }
        }

        let textEnd = pos + 1;
        while (textEnd < len) {
            const c = content.charCodeAt(textEnd);
            if (
                c === CHAR_BACKSLASH ||
                c === CHAR_STAR ||
                c === CHAR_BACKTICK ||
                c === CHAR_UNDERSCORE ||
                c === CHAR_OPEN_BRACKET
            ) {
                break;
            }
            textEnd = textEnd + 1;
        }

        const textContent = content.slice(pos, textEnd);
        nodes.push({
            type: "text",
            content: textContent,
            children: []
        });
        pos = textEnd;
    }

    return nodes;
}

/**
 * Parses a code block starting after the opening ```
 * @param {string} markdown
 * @param {number} start
 * @param {number} end
 * @returns {{ node: MarkdownNode; endPos: number }}
 */
function parseCodeBlock(markdown, start, end) {
    let pos = start;
    while (pos < end) {
        const ch = markdown.charCodeAt(pos);
        if (ch === CHAR_NEWLINE || ch === CHAR_CR) {
            pos = pos + 1;
            if (
                ch === CHAR_CR &&
                pos < end &&
                markdown.charCodeAt(pos) === CHAR_NEWLINE
            ) {
                pos = pos + 1;
            }
            break;
        }
        pos = pos + 1;
    }

    const codeStart = pos;
    let codeEnd = pos;

    while (codeEnd < end) {
        if (markdown.charCodeAt(codeEnd) === CHAR_BACKTICK) {
            let backtickCount = 0;
            let checkPos = codeEnd;
            while (
                checkPos < end &&
                markdown.charCodeAt(checkPos) === CHAR_BACKTICK
            ) {
                backtickCount = backtickCount + 1;
                checkPos = checkPos + 1;
            }

            if (backtickCount >= 3) {
                pos = checkPos;
                while (pos < end) {
                    const ch = markdown.charCodeAt(pos);
                    if (ch === CHAR_NEWLINE || ch === CHAR_CR) {
                        pos = pos + 1;
                        if (
                            ch === CHAR_CR &&
                            pos < end &&
                            markdown.charCodeAt(pos) === CHAR_NEWLINE
                        ) {
                            pos = pos + 1;
                        }
                        break;
                    }
                    pos = pos + 1;
                }
                break;
            }
        }
        codeEnd = codeEnd + 1;
    }

    const content = markdown.slice(codeStart, codeEnd);

    return {
        node: {
            type: "code-block",
            content,
            children: []
        },
        endPos: pos
    };
}

/**
 * Parses a paragraph node
 * @param {string} markdown
 * @param {number} start
 * @param {number} end
 * @param {number} [indentSpaces]
 * @returns {MarkdownNode}
 */
function parseParagraph(markdown, start, end, indentSpaces = 0) {
    const content = markdown.slice(start, end);
    const children = parseInlineContent(content);

    /** @type {Record<string, unknown> | undefined} */
    const attrs =
        typeof indentSpaces === "number" && indentSpaces > 0
            ? { indentSpaces }
            : undefined;

    return {
        type: "paragraph",
        content,
        children,
        attrs
    };
}

/**
 * Extracts key and summary from **key** — summary pattern
 * @param {string} content
 * @param {number} firstStar - Position of opening **
 * @param {number} secondStar - Position of closing **
 * @returns {{ key: string; summary: string } | null}
 */
function extractKeyAndSummary(content, firstStar, secondStar) {
    if (firstStar === -1 || secondStar === -1 || secondStar <= firstStar + 2) {
        return null;
    }

    const key = content.slice(firstStar + 2, secondStar);
    if (key.length === 0) {
        return null;
    }

    let summary = key;

    let dashPos = -1;
    for (let i = secondStar + 2, len = content.length; i < len - 2; i++) {
        if (
            content.charCodeAt(i) === CHAR_EM_DASH_START &&
            content.charCodeAt(i + 1) === 128 &&
            content.charCodeAt(i + 2) === 147
        ) {
            dashPos = i;
            break;
        }
    }

    if (dashPos !== -1) {
        let afterDashStart = dashPos + 3;
        while (
            afterDashStart < content.length &&
            content.charCodeAt(afterDashStart) === CHAR_SPACE
        ) {
            afterDashStart = afterDashStart + 1;
        }

        if (afterDashStart < content.length) {
            let dotPos = -1;
            for (
                let i = afterDashStart, len = content.length;
                i < len - 1;
                i++
            ) {
                if (
                    content.charCodeAt(i) === CHAR_DOT &&
                    content.charCodeAt(i + 1) === CHAR_SPACE
                ) {
                    dotPos = i;
                    break;
                }
            }

            if (dotPos !== -1) {
                summary = content.slice(afterDashStart, dotPos + 1).trim();
            } else {
                summary = content.slice(afterDashStart).trim();
            }
        }
    }

    return { key, summary };
}

/**
 * Finds **key** pattern positions in content
 * @param {string} content
 * @returns {{ firstStar: number; secondStar: number }}
 */
function findStarPattern(content) {
    let firstStar = -1;
    let secondStar = -1;

    for (let i = 0, len = content.length - 1; i < len; i++) {
        if (
            content.charCodeAt(i) === CHAR_STAR &&
            content.charCodeAt(i + 1) === CHAR_STAR
        ) {
            if (firstStar === -1) {
                firstStar = i;
            } else {
                secondStar = i;
                break;
            }
        }
    }

    return { firstStar, secondStar };
}

/**
 * Parses a heading node
 * @param {string} markdown
 * @param {number} start
 * @param {number} end
 * @param {number} nodeIndex
 * @param {MarkdownDocIndex} index
 * @returns {MarkdownNode}
 */
function parseHeading(markdown, start, end, nodeIndex, index) {
    let level = 0;
    let pos = start;
    while (pos < end && markdown.charCodeAt(pos) === CHAR_HASH) {
        level = level + 1;
        pos = pos + 1;
    }

    while (pos < end && markdown.charCodeAt(pos) === CHAR_SPACE) {
        pos = pos + 1;
    }

    const content = markdown.slice(pos, end);
    const children = parseInlineContent(content);

    const { firstStar, secondStar } = findStarPattern(content);

    /** @type {string | undefined} */
    let anchorId;

    const extracted = extractKeyAndSummary(content, firstStar, secondStar);
    if (extracted) {
        const { key, summary } = extracted;
        const anchor = `mb-doc-${key}`;
        anchorId = anchor;
        if (!Object.prototype.hasOwnProperty.call(index, key)) {
            index[key] = {
                key,
                anchorId: anchor,
                summary,
                nodeIndex
            };
        }
    }

    return {
        type: "heading",
        content,
        children,
        level,
        anchorId
    };
}

/**
 * Parses a list item node
 * @param {string} markdown
 * @param {number} markerPos
 * @param {number} end
 * @param {number} nodeIndex
 * @param {MarkdownDocIndex} index
 * @param {number} level
 * @returns {MarkdownNode}
 */
function parseListItem(markdown, markerPos, end, nodeIndex, index, level) {
    let pos = markerPos + 1;
    while (pos < end && markdown.charCodeAt(pos) === CHAR_SPACE) {
        pos = pos + 1;
    }

    const content = markdown.slice(pos, end);

    /** @type {MarkdownNode | undefined} */
    let headingChild;
    const contentLen = content.length;
    let headingPos = 0;

    while (
        headingPos < contentLen &&
        content.charCodeAt(headingPos) === CHAR_SPACE
    ) {
        headingPos = headingPos + 1;
    }

    if (
        headingPos < contentLen &&
        content.charCodeAt(headingPos) === CHAR_HASH
    ) {
        let levelCount = 0;
        let hp = headingPos;

        while (hp < contentLen && content.charCodeAt(hp) === CHAR_HASH) {
            levelCount = levelCount + 1;
            hp = hp + 1;
        }

        while (hp < contentLen && content.charCodeAt(hp) === CHAR_SPACE) {
            hp = hp + 1;
        }

        const headingText = content.slice(hp);
        const headingChildren = parseInlineContent(headingText);

        headingChild = {
            type: "heading",
            content: headingText,
            children: headingChildren,
            level: levelCount
        };
    }

    const children = headingChild
        ? [headingChild]
        : parseInlineContent(content);

    const { firstStar, secondStar } = findStarPattern(content);

    let anchorId = "";
    const extracted = extractKeyAndSummary(content, firstStar, secondStar);
    if (extracted) {
        const { key, summary } = extracted;
        anchorId = `mb-doc-${key}`;
        if (!Object.prototype.hasOwnProperty.call(index, key)) {
            index[key] = {
                key,
                anchorId,
                summary,
                nodeIndex
            };
        }
    }

    return {
        type: "list-item",
        content,
        children,
        level,
        anchorId: anchorId !== "" ? anchorId : undefined
    };
}

// ============================================================================
// Pipe table parsing (GFM-style) - source-level support (no post-processing)
// ============================================================================

/**
 * Skip one or more newline sequences (
,
, or
).
 * @param {string} markdown
 * @param {number} pos
 * @param {number} len
 * @returns {number}
 */
function skipNewlines(markdown, pos, len) {
    let p = pos;
    while (p < len) {
        const c = markdown.charCodeAt(p);
        if (c === CHAR_NEWLINE) {
            p = p + 1;
            continue;
        }
        if (c === CHAR_CR) {
            p = p + 1;
            if (p < len && markdown.charCodeAt(p) === CHAR_NEWLINE) {
                p = p + 1;
            }
            continue;
        }
        break;
    }
    return p;
}

/**
 * Get basic bounds for a single line starting at lineStart.
 * @param {string} markdown
 * @param {number} lineStart
 * @param {number} len
 * @returns {{ lineStart: number, lineEnd: number, firstNonSpace: number, lastNonSpace: number, isEmpty: boolean }}
 */
function getLineBounds(markdown, lineStart, len) {
    let lineEnd = lineStart;
    while (lineEnd < len) {
        const c = markdown.charCodeAt(lineEnd);
        if (c === CHAR_NEWLINE || c === CHAR_CR) {
            break;
        }
        lineEnd = lineEnd + 1;
    }

    let firstNonSpace = lineStart;
    while (
        firstNonSpace < lineEnd &&
        markdown.charCodeAt(firstNonSpace) === CHAR_SPACE
    ) {
        firstNonSpace = firstNonSpace + 1;
    }

    let lastNonSpace = lineEnd;
    while (
        lastNonSpace > lineStart &&
        markdown.charCodeAt(lastNonSpace - 1) === CHAR_SPACE
    ) {
        lastNonSpace = lastNonSpace - 1;
    }

    return {
        lineStart,
        lineEnd,
        firstNonSpace,
        lastNonSpace,
        isEmpty: lastNonSpace <= firstNonSpace
    };
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isPipeTableSeparatorLine(line) {
    const t = line.trim();
    if (t.length === 0) return false;
    if (t.indexOf("|") === -1) return false;
    if (t.indexOf("-") === -1) return false;

    // Must contain only pipes, colons, dashes and whitespace
    const stripped = t.replace(/[|:\-\s]/g, "");
    return stripped.length === 0;
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isPipeTableHeaderLine(line) {
    const t = line.trim();
    if (t.length === 0) return false;
    if (t.indexOf("|") === -1) return false;
    if (isPipeTableSeparatorLine(t)) return false;

    // Require at least 2 cells to avoid accidental matches.
    const cells = splitPipeTableRow(t);
    return cells.length >= 2;
}

/**
 * Split a pipe-table row into cells, honoring backslash-escaped pipes.
 * @param {string} line
 * @returns {string[]}
 */
function splitPipeTableRow(line) {
    const t = line.trim();
    /** @type {string[]} */
    const cells = [];
    let cur = "";
    let escaped = false;

    for (let i = 0, len = t.length; i < len; i++) {
        const ch = t.charCodeAt(i);

        if (escaped) {
            if (ch === CHAR_PIPE) {
                cur += t[i];
            } else {
                cur += `\\${t[i]}`;
            }
            escaped = false;
            continue;
        }

        if (ch === CHAR_BACKSLASH) {
            escaped = true;
            continue;
        }

        if (ch === CHAR_PIPE) {
            cells.push(cur.trim());
            cur = "";
            continue;
        }

        cur += t[i];
    }

    if (escaped) {
        cur += "\\";
    }

    cells.push(cur.trim());

    const hasLeadingPipe = t.charCodeAt(0) === CHAR_PIPE;
    const hasTrailingPipe = t.charCodeAt(t.length - 1) === CHAR_PIPE;

    if (hasLeadingPipe && cells.length > 0 && cells[0] === "") {
        cells.shift();
    }
    if (hasTrailingPipe && cells.length > 0 && cells[cells.length - 1] === "") {
        cells.pop();
    }

    return cells;
}

/**
 * Parse the alignment/column definition line.
 * @param {string} line
 * @returns {('left' | 'right' | 'center' | undefined)[]}
 */
function parsePipeTableAlignments(line) {
    const parts = splitPipeTableRow(line);
    /** @type {('left' | 'right' | 'center' | undefined)[]} */
    const aligns = [];

    for (let i = 0, len = parts.length; i < len; i++) {
        const seg = parts[i].trim();
        const starts = seg.length > 0 && seg.charCodeAt(0) === CHAR_COLON;
        const ends =
            seg.length > 0 && seg.charCodeAt(seg.length - 1) === CHAR_COLON;

        if (starts && ends) {
            aligns.push("center");
        } else if (starts) {
            aligns.push("left");
        } else if (ends) {
            aligns.push("right");
        } else {
            aligns.push(undefined);
        }
    }

    return aligns;
}

// ============================================================================
// Directive block parsing  :::name [title] ... :::
// ============================================================================

/**
 * Parses a directive block starting after the opening `:::name` line.
 * Scans forward until a line containing only `:::` (closing fence).
 * The inner text is stored verbatim as `content` for the converter to re-parse.
 *
 * @param {string} markdown
 * @param {number} openingLineEnd - position of the newline at the end of the opening `:::name` line
 * @param {number} end
 * @param {string} directiveName - lowercase directive name (e.g. "notice")
 * @param {string} title - optional title text from the opening line
 * @returns {{ node: MarkdownNode; endPos: number }}
 */
function parseDirectiveBlock(
    markdown,
    openingLineEnd,
    end,
    directiveName,
    title
) {
    // Step past the opening line's newline
    let pos = openingLineEnd;
    if (pos < end) {
        const c = markdown.charCodeAt(pos);
        if (c === CHAR_CR) {
            pos = pos + 1;
            if (pos < end && markdown.charCodeAt(pos) === CHAR_NEWLINE) {
                pos = pos + 1;
            }
        } else if (c === CHAR_NEWLINE) {
            pos = pos + 1;
        }
    }

    const contentStart = pos;
    let contentEnd = pos;
    let endPos = end; // fallback: consume to EOF if no closing fence found

    while (pos < end) {
        // Find end of current line
        let lineEnd = pos;
        while (lineEnd < end) {
            const c = markdown.charCodeAt(lineEnd);
            if (c === CHAR_NEWLINE || c === CHAR_CR) {
                break;
            }
            lineEnd = lineEnd + 1;
        }

        const lineText = markdown.slice(pos, lineEnd).trim();

        if (lineText === ":::") {
            contentEnd = pos;
            // Step past the closing ::: and its newline
            endPos = lineEnd;
            if (endPos < end) {
                const c = markdown.charCodeAt(endPos);
                if (c === CHAR_CR) {
                    endPos = endPos + 1;
                    if (
                        endPos < end &&
                        markdown.charCodeAt(endPos) === CHAR_NEWLINE
                    ) {
                        endPos = endPos + 1;
                    }
                } else if (c === CHAR_NEWLINE) {
                    endPos = endPos + 1;
                }
            }
            break;
        }

        // Advance past this line and its newline
        pos = lineEnd;
        if (pos < end) {
            const c = markdown.charCodeAt(pos);
            if (c === CHAR_CR) {
                pos = pos + 1;
                if (pos < end && markdown.charCodeAt(pos) === CHAR_NEWLINE) {
                    pos = pos + 1;
                }
            } else if (c === CHAR_NEWLINE) {
                pos = pos + 1;
            }
        }
    }

    // If no closing fence was found, consume everything that was scanned
    if (contentEnd <= contentStart) {
        contentEnd = pos;
    }

    // Strip trailing newlines from inner content
    let rawContent = markdown.slice(contentStart, contentEnd);
    let trimEnd = rawContent.length;
    while (trimEnd > 0) {
        const c = rawContent.charCodeAt(trimEnd - 1);
        if (c === CHAR_NEWLINE || c === CHAR_CR) {
            trimEnd = trimEnd - 1;
        } else {
            break;
        }
    }
    const innerText = rawContent.slice(0, trimEnd);

    // Parse inner content immediately — children are fully built here in the
    // parser, not deferred to the converter.
    const inner =
        innerText.length > 0
            ? parseMarkdownDoc(innerText)
            : { nodes: [], index: {} };

    /** @type {Record<string, unknown>} */
    const attrs = {
        directive: directiveName,
        name: directiveName
    };
    if (title.length > 0) {
        attrs.title = title;
    }

    return {
        node: {
            type: "directive",
            content: innerText,
            children: inner.nodes,
            attrs
        },
        endPos
    };
}

/**
 * @typedef {Object} MarkdownParseOptions
 * @property {boolean} [softWrap] - When true, source newlines inside
 *   paragraphs and continuations are treated as spaces unless the preceding
 *   line ends with a sentence terminator (.  ?  !  :  ;).  Useful when
 *   markdown has been reflowed to a max line length and the hard wraps
 *   should not produce visual line breaks.
 */

/**
 * Parses a markdown document into an AST
 * @param {string} markdown
 * @param {MarkdownParseOptions} [options]
 * @returns {ParsedMarkdownDoc}
 */
function parseMarkdownDoc(markdown, options) {
    const softWrap = options !== undefined && options.softWrap === true;
    /** @type {MarkdownNode[]} */
    const nodes = [];
    /** @type {MarkdownDocIndex} */
    const index = {};
    const len = markdown.length;
    let pos = 0;
    let nodeIndex = 0;

    /** @type {MarkdownNode | undefined} */
    let lastListItem;
    let lastListItemIndentSpaces = 0;
    // Current soft-join segment for list-item continuation: content string and
    // the index into lastListItem.children where this segment's nodes begin.
    // Resets on hard-break or new list-item so the re-parse only covers the
    // current run of joined lines.
    let lastListItemSegContent = "";
    let lastListItemSegChildStart = 0;

    // Paragraph continuation state: tracks the most recent paragraph so that
    // indented lines following it (even across intervening nested lists) can
    // be merged back as continuation content.
    /** @type {MarkdownNode | undefined} */
    let lastParagraph;
    let lastParagraphIndentSpaces = 0;
    let sawNewlineSkip = false;
    // Tracks whether the most recently completed source line had a trailing
    // space.  Used in soft-wrap mode as the opt-in signal: trailing space →
    // join next continuation with a space; no trailing space → hard break.
    let prevLineSoftJoin = false;

    while (pos < len) {
        const ch = markdown.charCodeAt(pos);

        if (ch === CHAR_NEWLINE || ch === CHAR_CR) {
            pos = pos + 1;
            if (
                ch === CHAR_CR &&
                pos < len &&
                markdown.charCodeAt(pos) === CHAR_NEWLINE
            ) {
                pos = pos + 1;
            }
            // Two consecutive newline-skips means a blank line gap;
            // break paragraph continuation.
            if (sawNewlineSkip) {
                lastParagraph = undefined;
            }
            sawNewlineSkip = true;
            continue;
        }

        sawNewlineSkip = false;

        const lineStart = pos;
        let lineEnd = pos;
        while (lineEnd < len) {
            const c = markdown.charCodeAt(lineEnd);
            if (c === CHAR_NEWLINE || c === CHAR_CR) {
                break;
            }
            lineEnd = lineEnd + 1;
        }

        let firstNonSpace = lineStart;
        while (
            firstNonSpace < lineEnd &&
            markdown.charCodeAt(firstNonSpace) === CHAR_SPACE
        ) {
            firstNonSpace = firstNonSpace + 1;
        }

        if (firstNonSpace === lineEnd) {
            nodes.push({
                type: "blank",
                content: "",
                children: []
            });
            nodeIndex = nodeIndex + 1;
            pos = lineEnd;
            lastListItem = undefined;
            lastParagraph = undefined;
            prevLineSoftJoin = false;
            continue;
        }

        const indentSpaces = firstNonSpace - lineStart;
        const firstChar = markdown.charCodeAt(firstNonSpace);

        let lastNonSpace = lineEnd;
        while (
            lastNonSpace > firstNonSpace &&
            markdown.charCodeAt(lastNonSpace - 1) === CHAR_SPACE
        ) {
            lastNonSpace = lastNonSpace - 1;
        }

        // Soft-wrap opt-out: when the last non-space char is a clause/sentence
        // terminator (.,;:?!,) and there is NO trailing space, force a hard break.
        // Everything else (plain words, or terminator + trailing space) soft-joins.
        const lastCh =
            lastNonSpace > firstNonSpace
                ? markdown.charCodeAt(lastNonSpace - 1)
                : -1;
        const softJoinThisLine =
            softWrap &&
            !(SOFT_WRAP_JOINERS.has(lastCh) && lastNonSpace === lineEnd);

        if (firstChar === CHAR_LT) {
            const raw = markdown.slice(firstNonSpace, lastNonSpace);
            if (isPageBreakCommentLine(raw)) {
                nodes.push({
                    type: "page-break",
                    content: "",
                    children: []
                });
                nodeIndex = nodeIndex + 1;
                pos = lineEnd;
                lastListItem = undefined;
                lastParagraph = undefined;
                continue;
            }
        }

        if (firstChar === CHAR_HASH) {
            const headingNode = parseHeading(
                markdown,
                firstNonSpace,
                lineEnd,
                nodeIndex,
                index
            );
            nodes.push(headingNode);
            nodeIndex = nodeIndex + 1;
            pos = lineEnd;
            lastListItem = undefined;
            lastParagraph = undefined;
            continue;
        }

        // Pipe tables (GFM-style)
        if (indentSpaces <= 3) {
            const rawLine = markdown.slice(firstNonSpace, lastNonSpace);
            if (isPipeTableHeaderLine(rawLine)) {
                const sepStart = skipNewlines(markdown, lineEnd, len);
                if (sepStart < len) {
                    const sepBounds = getLineBounds(markdown, sepStart, len);
                    if (!sepBounds.isEmpty) {
                        const sepLine = markdown.slice(
                            sepBounds.firstNonSpace,
                            sepBounds.lastNonSpace
                        );

                        if (isPipeTableSeparatorLine(sepLine)) {
                            const headerCells = splitPipeTableRow(rawLine);
                            const aligns = parsePipeTableAlignments(sepLine);
                            const colCount = Math.max(
                                headerCells.length,
                                aligns.length
                            );

                            /** @type {MarkdownNode[]} */
                            const rows = [];

                            // Header row
                            /** @type {MarkdownNode[]} */
                            const headerRowCells = [];
                            for (let ci = 0; ci < colCount; ci++) {
                                const cellText =
                                    headerCells[ci] !== undefined
                                        ? headerCells[ci]
                                        : "";
                                const align = aligns[ci];
                                headerRowCells.push({
                                    type: "table-cell",
                                    content: cellText,
                                    children: parseInlineContent(cellText),
                                    attrs: align ? { align } : undefined
                                });
                            }
                            rows.push({
                                type: "table-row",
                                content: "",
                                children: headerRowCells,
                                attrs: { isHeader: true }
                            });

                            // Data rows
                            let rowStart = skipNewlines(
                                markdown,
                                sepBounds.lineEnd,
                                len
                            );
                            let tableEnd = sepBounds.lineEnd;

                            while (rowStart < len) {
                                const b = getLineBounds(
                                    markdown,
                                    rowStart,
                                    len
                                );
                                if (b.isEmpty) {
                                    tableEnd = b.lineEnd;
                                    break;
                                }

                                const rowLine = markdown.slice(
                                    b.firstNonSpace,
                                    b.lastNonSpace
                                );

                                if (rowLine.indexOf("|") === -1) {
                                    tableEnd = b.lineEnd;
                                    break;
                                }
                                if (isPipeTableSeparatorLine(rowLine)) {
                                    tableEnd = b.lineEnd;
                                    break;
                                }

                                const dataCells = splitPipeTableRow(rowLine);
                                if (dataCells.length < 2) {
                                    tableEnd = b.lineEnd;
                                    break;
                                }

                                /** @type {MarkdownNode[]} */
                                const dataRowCells = [];
                                for (let ci = 0; ci < colCount; ci++) {
                                    const cellText =
                                        dataCells[ci] !== undefined
                                            ? dataCells[ci]
                                            : "";
                                    const align = aligns[ci];
                                    dataRowCells.push({
                                        type: "table-cell",
                                        content: cellText,
                                        children: parseInlineContent(cellText),
                                        attrs: align ? { align } : undefined
                                    });
                                }

                                rows.push({
                                    type: "table-row",
                                    content: "",
                                    children: dataRowCells
                                });

                                tableEnd = b.lineEnd;
                                rowStart = skipNewlines(
                                    markdown,
                                    b.lineEnd,
                                    len
                                );
                            }

                            /** @type {{ align?: 'left' | 'right' | 'center' }[]} */
                            const columns = [];
                            for (let ci = 0; ci < colCount; ci++) {
                                const a = aligns[ci];
                                columns.push(a ? { align: a } : {});
                            }

                            nodes.push({
                                type: "table",
                                content: "",
                                children: rows,
                                attrs: {
                                    headerRow: true,
                                    columns
                                }
                            });

                            nodeIndex = nodeIndex + 1;
                            pos = tableEnd;
                            lastListItem = undefined;
                            lastParagraph = undefined;
                            continue;
                        }
                    }
                }
            }
        }

        if (firstChar === CHAR_DASH) {
            let dashCount = 0;
            let checkPos = firstNonSpace;
            let isOnlyDashes = true;
            while (checkPos < lineEnd) {
                const c = markdown.charCodeAt(checkPos);
                if (c === CHAR_DASH) {
                    dashCount = dashCount + 1;
                } else if (c !== CHAR_SPACE) {
                    isOnlyDashes = false;
                    break;
                }
                checkPos = checkPos + 1;
            }

            if (isOnlyDashes && dashCount >= 3) {
                nodes.push({
                    type: "horizontal-rule",
                    content: "",
                    children: []
                });
                nodeIndex = nodeIndex + 1;
                pos = lineEnd;
                lastListItem = undefined;
                lastParagraph = undefined;
                continue;
            }

            let listLevel = 0;
            if (indentSpaces > 0) {
                listLevel = Math.floor(indentSpaces / INDENT_SPACES_PER_LEVEL);
                if (listLevel < 0) {
                    listLevel = 0;
                } else if (listLevel > MAX_LIST_LEVEL) {
                    listLevel = MAX_LIST_LEVEL;
                }
            }

            const listItemNode = parseListItem(
                markdown,
                firstNonSpace,
                lineEnd,
                nodeIndex,
                index,
                listLevel
            );
            nodes.push(listItemNode);
            nodeIndex = nodeIndex + 1;
            pos = lineEnd;
            lastListItem = listItemNode;
            lastListItemIndentSpaces = indentSpaces;
            lastListItemSegContent = listItemNode.content;
            lastListItemSegChildStart = 0;
            prevLineSoftJoin = softJoinThisLine;
            // NOTE: do NOT clear lastParagraph here — list items nested under
            // a paragraph (e.g. sub-bullets within a numbered definition) should
            // allow continuation lines after the list to merge back.
            continue;
        }

        // ::: directive blocks (e.g. :::notice Optional Title)
        if (firstChar === CHAR_COLON) {
            if (
                firstNonSpace + 2 < lineEnd &&
                markdown.charCodeAt(firstNonSpace + 1) === CHAR_COLON &&
                markdown.charCodeAt(firstNonSpace + 2) === CHAR_COLON
            ) {
                // Read directive name (non-space token after :::)
                let dpos = firstNonSpace + 3;
                while (
                    dpos < lineEnd &&
                    markdown.charCodeAt(dpos) === CHAR_SPACE
                ) {
                    dpos = dpos + 1;
                }
                let dnameEnd = dpos;
                while (
                    dnameEnd < lineEnd &&
                    markdown.charCodeAt(dnameEnd) !== CHAR_SPACE
                ) {
                    dnameEnd = dnameEnd + 1;
                }
                const directiveName = markdown
                    .slice(dpos, dnameEnd)
                    .toLowerCase()
                    .trim();

                if (directiveName.length > 0) {
                    // Optional title: remainder of the opening line after the directive name
                    let titleStart = dnameEnd;
                    while (
                        titleStart < lineEnd &&
                        markdown.charCodeAt(titleStart) === CHAR_SPACE
                    ) {
                        titleStart = titleStart + 1;
                    }
                    const title =
                        titleStart < lineEnd
                            ? markdown.slice(titleStart, lineEnd).trim()
                            : "";

                    const directiveResult = parseDirectiveBlock(
                        markdown,
                        lineEnd,
                        len,
                        directiveName,
                        title
                    );
                    nodes.push(directiveResult.node);
                    nodeIndex = nodeIndex + 1;
                    pos = directiveResult.endPos;
                    lastListItem = undefined;
                    lastParagraph = undefined;
                    continue;
                }
            }
        }

        if (firstChar === CHAR_BACKTICK) {
            let backtickCount = 0;
            let checkPos = firstNonSpace;
            while (
                checkPos < lineEnd &&
                markdown.charCodeAt(checkPos) === CHAR_BACKTICK
            ) {
                backtickCount = backtickCount + 1;
                checkPos = checkPos + 1;
            }

            if (backtickCount >= 3) {
                const codeBlockResult = parseCodeBlock(markdown, lineEnd, len);
                nodes.push(codeBlockResult.node);
                nodeIndex = nodeIndex + 1;
                pos = codeBlockResult.endPos;
                lastListItem = undefined;
                lastParagraph = undefined;
                continue;
            }
        }

        if (lastListItem && indentSpaces > lastListItemIndentSpaces) {
            const continuationContent = markdown.slice(firstNonSpace, lineEnd);

            if (prevLineSoftJoin) {
                // Extend the current segment and re-parse just that segment,
                // replacing its children so cross-line inline spans resolve.
                lastListItemSegContent =
                    lastListItemSegContent + " " + continuationContent;
                lastListItem.content =
                    lastListItem.content + " " + continuationContent;
                lastListItem.children.length = lastListItemSegChildStart;
                const reparsed = parseInlineContent(lastListItemSegContent);
                for (let i = 0, cLen = reparsed.length; i < cLen; i++) {
                    lastListItem.children.push(reparsed[i]);
                }
            } else {
                // Hard break — finalise current segment, start a new one.
                const inlineChildren = parseInlineContent(continuationContent);
                lastListItem.children.push({
                    type: "line-break",
                    content: "",
                    children: []
                });
                for (let i = 0, cLen = inlineChildren.length; i < cLen; i++) {
                    lastListItem.children.push(inlineChildren[i]);
                }
                lastListItem.content =
                    lastListItem.content + "\n" + continuationContent;
                // New segment begins after the line-break node.
                lastListItemSegContent = continuationContent;
                lastListItemSegChildStart =
                    lastListItem.children.length - inlineChildren.length;
            }

            pos = lineEnd;
            prevLineSoftJoin = softJoinThisLine;
            continue;
        }

        // Paragraph continuation: an indented line that follows a paragraph
        // (possibly with intervening nested list items) should merge back
        // into the owning paragraph.  This handles the common legal-document
        // pattern where a numbered definition has sub-bullets followed by
        // body text at the same indent:
        //
        //   2. **"Term"** means … that:
        //      - condition A; and
        //      - condition B.
        //      Term also includes …        ← continuation of the "2." paragraph
        //
        if (lastParagraph && indentSpaces > lastParagraphIndentSpaces) {
            const continuationContent = markdown.slice(firstNonSpace, lineEnd);

            // Legal sub-item markers (e.g. "(a) ...", "i. ...", "a) ...") should
            // NOT be swallowed into the parent paragraph.  Emit them as their own
            // paragraph so the AST converter can detect the run-in label and indent
            // them properly beneath the parent.
            if (isLegalSubItemStart(continuationContent)) {
                const paragraphNode = parseParagraph(
                    markdown,
                    firstNonSpace,
                    lineEnd,
                    indentSpaces
                );
                nodes.push(paragraphNode);
                nodeIndex = nodeIndex + 1;
                pos = lineEnd;
                lastListItem = undefined;
                lastParagraph = paragraphNode;
                lastParagraphIndentSpaces = indentSpaces;
                continue;
            }

            const inlineChildren = parseInlineContent(continuationContent);

            // Keep raw content in sync, then re-parse children from the full
            // combined string so inline spans (bold, links, etc.) that cross
            // the line boundary are resolved correctly.
            lastParagraph.content = prevLineSoftJoin
                ? lastParagraph.content + " " + continuationContent
                : lastParagraph.content + "\n" + continuationContent;

            if (prevLineSoftJoin) {
                lastParagraph.children = parseInlineContent(
                    lastParagraph.content
                );
            } else {
                lastParagraph.children.push({
                    type: "line-break",
                    content: "",
                    children: []
                });
                for (let i = 0, cLen = inlineChildren.length; i < cLen; i++) {
                    lastParagraph.children.push(inlineChildren[i]);
                }
            }

            pos = lineEnd;
            prevLineSoftJoin = softJoinThisLine;
            // Re-arm list-item tracking in case more sub-lists follow
            lastListItem = undefined;
            continue;
        }

        // Soft-wrap merge: if enabled and the previous paragraph did not end
        // with a sentence terminator and we are at the same indent level,
        // merge the current line into the previous paragraph with a space
        // instead of creating a new paragraph node.
        if (
            prevLineSoftJoin &&
            lastParagraph &&
            indentSpaces === lastParagraphIndentSpaces
        ) {
            const continuationContent = markdown.slice(
                firstNonSpace,
                lastNonSpace
            );

            lastParagraph.content =
                lastParagraph.content + " " + continuationContent;

            // Re-parse children from the full combined string so inline spans
            // (bold, links, etc.) that cross the line boundary are resolved.
            lastParagraph.children = parseInlineContent(lastParagraph.content);

            pos = lineEnd;
            prevLineSoftJoin = softJoinThisLine;
            lastListItem = undefined;
            continue;
        }

        const paragraphNode = parseParagraph(
            markdown,
            firstNonSpace,
            lineEnd,
            indentSpaces
        );
        nodes.push(paragraphNode);
        nodeIndex = nodeIndex + 1;
        pos = lineEnd;
        lastListItem = undefined;
        lastParagraph = paragraphNode;
        lastParagraphIndentSpaces = indentSpaces;
        prevLineSoftJoin = softJoinThisLine;
    }

    // Second pass: allow **key** — summary anchors inside plain paragraphs
    for (let i = 0, nLen = nodes.length; i < nLen; i++) {
        const node = nodes[i];
        if (node.type !== "paragraph") {
            continue;
        }

        const content = node.content;
        let firstStar = -1;
        let secondStar = -1;
        let starCount = 0;

        for (let j = 0, cLen = content.length; j < cLen; j++) {
            if (content.charCodeAt(j) === CHAR_STAR) {
                if (starCount === 0) {
                    firstStar = j;
                } else if (starCount === 1) {
                    secondStar = j;
                    break;
                }
                starCount = starCount + 1;
            }
        }

        if (
            firstStar === -1 ||
            secondStar === -1 ||
            secondStar <= firstStar + 2
        ) {
            continue;
        }

        const key = content.slice(firstStar + 2, secondStar);
        if (key.length === 0) {
            continue;
        }

        if (Object.prototype.hasOwnProperty.call(index, key)) {
            continue;
        }

        let summary = key;

        let dashPos = -1;
        for (let j = secondStar + 2, cLen = content.length; j < cLen - 2; j++) {
            if (
                content.charCodeAt(j) === CHAR_EM_DASH_START &&
                content.charCodeAt(j + 1) === 128 &&
                content.charCodeAt(j + 2) === 147
            ) {
                dashPos = j;
                break;
            }
        }

        if (dashPos !== -1) {
            let afterDashStart = dashPos + 3;
            while (
                afterDashStart < content.length &&
                content.charCodeAt(afterDashStart) === CHAR_SPACE
            ) {
                afterDashStart = afterDashStart + 1;
            }

            if (afterDashStart < content.length) {
                let dotPos = -1;
                for (
                    let j = afterDashStart, cLen = content.length;
                    j < cLen - 1;
                    j++
                ) {
                    if (
                        content.charCodeAt(j) === CHAR_DOT &&
                        content.charCodeAt(j + 1) === CHAR_SPACE
                    ) {
                        dotPos = j;
                        break;
                    }
                }

                if (dotPos !== -1) {
                    summary = content.slice(afterDashStart, dotPos + 1).trim();
                } else {
                    summary = content.slice(afterDashStart).trim();
                }
            }
        }

        const anchorId = `mb-doc-${key}`;
        node.anchorId = anchorId;

        index[key] = {
            key,
            anchorId,
            summary,
            nodeIndex: i
        };
    }

    return { nodes: groupListItems(nodes), index };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Builds an anchor index mapping nodeIndex -> anchorId
 * @param {MarkdownDocIndex} index
 * @returns {MarkdownDocAnchorIndex}
 */
function buildAnchorIndex(index) {
    /** @type {MarkdownDocAnchorIndex} */
    const anchors = {};
    const keys = Object.keys(index);
    for (let i = 0, len = keys.length; i < len; i++) {
        const key = keys[i];
        const entry = index[key];
        anchors[entry.nodeIndex] = entry.anchorId;
    }
    return anchors;
}

/**
 * Builds a summary string for a given key by collecting text from the node subtree
 * @param {string} key
 * @param {ParsedMarkdownDoc} doc
 * @returns {string}
 */
function buildSummaryForKey(key, doc) {
    if (!Object.prototype.hasOwnProperty.call(doc.index, key)) {
        return "";
    }

    const entry = doc.index[key];
    const anchorId = entry.anchorId;

    const rootNodes = doc.nodes;
    /** @type {MarkdownNode[]} */
    const stack = [];

    for (let i = 0, len = rootNodes.length; i < len; i++) {
        stack.push(rootNodes[i]);
    }

    /** @type {MarkdownNode | undefined} */
    let target;

    while (stack.length > 0) {
        const node = stack.pop();
        if (!node) {
            continue;
        }
        if (node.anchorId === anchorId) {
            target = node;
            break;
        }
        const children = node.children;
        for (let i = children.length - 1; i >= 0; i--) {
            stack.push(children[i]);
        }
    }

    if (!target) {
        return entry.summary;
    }

    /** @type {string[]} */
    const textParts = [];
    /** @type {MarkdownNode[]} */
    const textStack = [target];

    while (textStack.length > 0) {
        const current = textStack.pop();
        if (!current) {
            continue;
        }

        if (
            current.type === "text" ||
            current.type === "bold" ||
            current.type === "italic" ||
            current.type === "code-inline" ||
            current.type === "code-block"
        ) {
            if (current.content.length > 0) {
                textParts.push(current.content);
            }
        }

        const children = current.children;
        for (let i = children.length - 1; i >= 0; i--) {
            textStack.push(children[i]);
        }
    }

    if (textParts.length === 0) {
        return entry.summary;
    }

    let combined = "";
    for (let i = 0, len = textParts.length; i < len; i++) {
        const text = textParts[i].trim();
        if (text.length === 0) {
            continue;
        }
        if (combined.length === 0) {
            combined = text;
        } else {
            combined = `${combined} ${text}`;
        }
    }

    if (combined.length === 0) {
        return entry.summary;
    }

    const maxLength = 220;
    if (combined.length <= maxLength) {
        return combined;
    }

    let cut = maxLength;
    while (cut > 0 && combined.charCodeAt(cut) !== CHAR_SPACE) {
        cut = cut - 1;
    }
    if (cut <= 0) {
        cut = maxLength;
    }

    let truncated = combined.slice(0, cut);
    let end = truncated.length;
    while (end > 0 && truncated.charCodeAt(end - 1) === CHAR_SPACE) {
        end = end - 1;
    }

    truncated = truncated.slice(0, end);
    return `${truncated}…`;
}

/**
 * Gets the anchor ID for a given node index
 * @param {number} nodeIndex
 * @param {MarkdownDocAnchorIndex} anchorIndex
 * @returns {string | undefined}
 */
function getAnchorIdForNode(nodeIndex, anchorIndex) {
    return Object.prototype.hasOwnProperty.call(anchorIndex, nodeIndex)
        ? anchorIndex[nodeIndex]
        : undefined;
}

/**
 * Gets a doc entry by key
 * @param {string} key
 * @param {MarkdownDocIndex} index
 * @returns {MarkdownDocEntry | undefined}
 */
function getEntryByKey(key, index) {
    return Object.prototype.hasOwnProperty.call(index, key)
        ? index[key]
        : undefined;
}

/**
 * Extracts all text content from a node and its children
 * @param {MarkdownNode} node
 * @returns {string}
 */
function extractTextContent(node) {
    /** @type {string[]} */
    const parts = [];
    /** @type {MarkdownNode[]} */
    const stack = [node];

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
            continue;
        }

        if (current.content.length > 0) {
            parts.push(current.content);
        }

        const children = current.children;
        for (let i = children.length - 1; i >= 0; i--) {
            stack.push(children[i]);
        }
    }

    return parts.join(" ");
}

/**
 * Walks the AST and calls visitor for each node
 * @param {MarkdownNode[]} nodes
 * @param {(node: MarkdownNode, depth: number) => void} visitor
 */
function walkNodes(nodes, visitor) {
    /** @type {{ node: MarkdownNode; depth: number }[]} */
    const stack = [];

    for (let i = nodes.length - 1; i >= 0; i--) {
        stack.push({ node: nodes[i], depth: 0 });
    }

    while (stack.length > 0) {
        const item = stack.pop();
        if (!item) {
            continue;
        }

        visitor(item.node, item.depth);

        const children = item.node.children;
        for (let i = children.length - 1; i >= 0; i--) {
            stack.push({ node: children[i], depth: item.depth + 1 });
        }
    }
}

/**
 * Finds all nodes of a specific type
 * @param {MarkdownNode[]} nodes
 * @param {MarkdownNodeType} type
 * @returns {MarkdownNode[]}
 */
function findNodesByType(nodes, type) {
    /** @type {MarkdownNode[]} */
    const result = [];

    walkNodes(nodes, (node) => {
        if (node.type === type) {
            result.push(node);
        }
    });

    return result;
}

// ============================================================================
// Line Length and Reflow Functions
// ============================================================================

/**
 * @typedef {Object} LongLineInfo
 * @property {number} line - 1-indexed line number
 * @property {number} length - Length of the line
 * @property {string} sample - Truncated sample (max 120 chars)
 */

/**
 * Checks if a line looks like a table line (contains pipes and table-like patterns)
 * @param {string} line
 * @returns {boolean}
 */
function isTableLine(line) {
    // Must contain a pipe character
    if (!line.includes("|")) {
        return false;
    }
    // Table header/data lines have multiple pipes
    // Table separator lines have patterns like |---|, |:---|, |---:|, |:---:|
    const trimmed = line.trim();
    // Check for separator pattern: contains |, -, and optionally :
    if (/^\|?[\s:|-]+\|[\s:|-]*\|?$/.test(trimmed)) {
        return true;
    }
    // Check for table data/header lines: |...|...|
    if (/^\|.*\|$/.test(trimmed) || /^\|.*\|.*\|/.test(trimmed)) {
        return true;
    }
    // Also match separator without leading pipe: :---|:---|
    if (/^:?-+:?(\s*\|\s*:?-+:?)+/.test(trimmed)) {
        return true;
    }
    return false;
}

/**
 * Checks if a line contains a URL
 * @param {string} line
 * @returns {boolean}
 */
function containsUrl(line) {
    return (
        line.includes("https://") ||
        line.includes("http://") ||
        line.includes("www.")
    );
}

/**
 * Checks if a line looks like a hash or base64 string (alphanumeric, no spaces, long)
 * @param {string} line
 * @returns {boolean}
 */
function isHashLike(line) {
    const trimmed = line.trim();
    // Must be at least 32 chars to look like a hash
    if (trimmed.length < 32) {
        return false;
    }
    // No spaces allowed
    if (trimmed.includes(" ")) {
        return false;
    }
    // Must be alphanumeric with possible base64 chars (+/=)
    return /^[a-zA-Z0-9+/=]+$/.test(trimmed);
}

/**
 * @typedef {Object} FindLongLinesOptions
 * @property {boolean} [softWrap] - When true, always returns an empty array.
 *   Soft-wrap source files have intentionally long clause lines; line-width
 *   violations are suppressed at the pack level via soft_wrap_preferred.
 */

/**
 * Finds lines that exceed the max width, ignoring code fences, tables, URLs, and hashes.
 * Pass `options.softWrap = true` to suppress all results for soft-wrap files.
 * @param {string} text
 * @param {number} maxWidth
 * @param {FindLongLinesOptions} [options]
 * @returns {LongLineInfo[]}
 */
function findLongLinesMarkdown(text, maxWidth, options) {
    /** @type {LongLineInfo[]} */
    const results = [];

    if (options !== undefined && options.softWrap === true) {
        return results;
    }

    if (text.length === 0) {
        return results;
    }

    const lines = text.split("\n");
    let inCodeFence = false;

    for (let i = 0, len = lines.length; i < len; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Check for code fence toggle
        if (trimmed.startsWith("```")) {
            inCodeFence = !inCodeFence;
            continue;
        }

        // Skip lines inside code fences
        if (inCodeFence) {
            continue;
        }

        // Skip if line is within max width
        if (line.length <= maxWidth) {
            continue;
        }

        // Skip table lines
        if (isTableLine(line)) {
            continue;
        }

        // Skip lines with URLs
        if (containsUrl(line)) {
            continue;
        }

        // Skip hash-like lines
        if (isHashLike(line)) {
            continue;
        }

        // Line is too long - add to results
        const sample = line.length > 120 ? line.slice(0, 120) : line;
        results.push({
            line: i + 1, // 1-indexed
            length: line.length,
            sample
        });
    }

    return results;
}

/**
 * @typedef {Object} ReflowResult
 * @property {string} text - The reflowed text
 * @property {boolean} changed - Whether any changes were made
 */

/**
 * Checks if a line is a heading
 * @param {string} line
 * @returns {boolean}
 */
function isHeading(line) {
    const trimmed = line.trimStart();
    return trimmed.startsWith("#");
}

/**
 * Checks if a line is a blockquote
 * @param {string} line
 * @returns {boolean}
 */
function isBlockquote(line) {
    const trimmed = line.trimStart();
    return trimmed.startsWith(">");
}

/**
 * Checks if a line is a horizontal rule
 * @param {string} line
 * @returns {boolean}
 */
function isHorizontalRule(line) {
    const trimmed = line.trim();
    return /^[-*_]{3,}$/.test(trimmed);
}

/**
 * Checks if a line is a list item (bullet or numbered)
 * @param {string} line
 * @returns {boolean}
 */
function isListItem(line) {
    const trimmed = line.trimStart();
    return (
        trimmed.startsWith("- ") ||
        trimmed.startsWith("* ") ||
        /^\d+\.\s/.test(trimmed)
    );
}

/**
 * Checks if a line starts a code fence
 * @param {string} line
 * @returns {boolean}
 */
function isCodeFenceStart(line) {
    return line.trimStart().startsWith("```");
}

/**
 * Checks if content starts with a legal/formal sub-item marker.
 * Used to prevent paragraph continuation from swallowing indented sub-items
 * like (a), (b), (i), a., A., 2.A.1, etc.
 *
 * @param {string} content - The text content (already trimmed of leading whitespace)
 * @returns {boolean}
 */
function isLegalSubItemStart(content) {
    // (a), (1), (iv), (A), (XII)  — parenthesized markers
    // a), A), 1)                  — letter/number + closing paren
    // a., A., 1., 2.              — letter/number + period
    // 2.A.1, 2.A                  — compound numbering (first sub must be alpha
    //                               so "2.2 through" section refs don't match)
    return /^(?:\((?:\d+|[A-Za-z]|[ivxlcdmIVXLCDM]+)\)\s|[A-Za-z][.)]\s|\d+[.)]\s|\d+\.[A-Za-z][A-Za-z0-9.]*\.?\s)/.test(
        content
    );
}

/**
 * Checks if a comment line is a page break
 * @param {string} line
 * @returns {boolean}
 */
function isPageBreakCommentLine(line) {
    // Accept: <!-- pagebreak -->, <!--pagebreak-->, <!-- page-break -->, <!-- page break -->
    if (!line.startsWith("<!--") || !line.endsWith("-->")) {
        return false;
    }
    const inner = line.slice(4, -3).trim().toLowerCase();
    return (
        inner === "pagebreak" ||
        inner === "page-break" ||
        inner === "page break"
    );
}

/**
 * Wraps text to specified max width, respecting word boundaries
 * @param {string} text
 * @param {number} maxWidth
 * @param {string} continuationIndent
 * @returns {string}
 */
function wrapText(text, maxWidth, continuationIndent = "") {
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0) {
        return "";
    }

    /** @type {string[]} */
    const outputLines = [];
    let currentLine = words[0];

    for (let i = 1, len = words.length; i < len; i++) {
        const word = words[i];
        const testLine = currentLine + " " + word;
        const effectiveWidth =
            outputLines.length === 0
                ? maxWidth
                : maxWidth - continuationIndent.length;

        if (testLine.length <= effectiveWidth) {
            currentLine = testLine;
        } else {
            outputLines.push(currentLine);
            currentLine = word;
        }
    }

    if (currentLine.length > 0) {
        outputLines.push(currentLine);
    }

    // Add continuation indent to all lines except the first
    for (let i = 1, len = outputLines.length; i < len; i++) {
        outputLines[i] = continuationIndent + outputLines[i];
    }

    return outputLines.join("\n");
}

/**
 * @typedef {Object} ReflowOptions
 * @property {boolean} [softWrap] - When true, skip paragraph reflow entirely.
 *   Baseline cleanup (CRLF, trailing whitespace) is handled upstream by
 *   normalizeBaseline(); this flag only suppresses word-wrap reflow, which
 *   is incorrect for source files where each clause lives on its own line.
 * @property {string} [continuationIndent] - Indent prepended to every
 *   continuation line when a paragraph wraps.  Defaults to "" (no indent).
 *   Set to e.g. "    " (four spaces) for legal/soft-wrap files to produce a
 *   consistent left gutter on wrapped lines.
 */

/**
 * Reflows markdown text to fit within max width while preserving structure.
 * Pass `options.softWrap = true` to skip reflow (used for legal prose files
 * where long clause lines are intentional).
 * @param {string} text
 * @param {number} maxWidth
 * @param {ReflowOptions} [options]
 * @returns {ReflowResult}
 */
function reflowMarkdown(text, maxWidth, options) {
    if (text.length === 0) {
        return { text: "", changed: false };
    }

    if (options !== undefined && options.softWrap === true) {
        return { text, changed: false };
    }

    /** @type {string} */
    const paragraphContinuationIndent =
        options !== undefined && typeof options.continuationIndent === "string"
            ? options.continuationIndent
            : "";

    const lines = text.split("\n");
    /** @type {string[]} */
    const outputLines = [];
    let changed = false;
    let inCodeFence = false;

    let i = 0;
    const len = lines.length;

    let lastListLong = false;
    let lastListIndent = 0;

    while (i < len) {
        const line = lines[i];
        const trimmed = line.trimStart();

        // Handle code fences
        if (trimmed.startsWith("```")) {
            inCodeFence = !inCodeFence;
            outputLines.push(line);
            i++;
            continue;
        }

        // Preserve content inside code fences
        if (inCodeFence) {
            outputLines.push(line);
            i++;
            continue;
        }

        // Preserve blank lines
        if (trimmed.length === 0) {
            outputLines.push(line);
            i++;
            continue;
        }

        // Preserve headings
        if (isHeading(line)) {
            outputLines.push(line);
            i++;
            continue;
        }

        // Wrap blockquotes: collect consecutive "> " lines, re-wrap content,
        // then re-emit each wrapped line with the ">" prefix restored so
        // continuation lines stay aligned under the content start.
        if (isBlockquote(line)) {
            // Determine the prefix: leading whitespace + ">" + optional space
            const bqLeadLen = line.length - line.trimStart().length;
            const bqLead = line.slice(0, bqLeadLen);
            const afterLead = line.slice(bqLeadLen); // starts with ">"
            const hasSpace =
                afterLead.length > 1 && afterLead.charCodeAt(1) === CHAR_SPACE;
            const bqPrefix = bqLead + (hasSpace ? "> " : ">");
            const bqPrefixLen = bqPrefix.length;
            const contentWidth = maxWidth - bqPrefixLen;

            // Accumulate content from consecutive blockquote lines that share
            // the same prefix (same nesting level).  A blank blockquote line
            // (`> ` with no text) flushes the current paragraph and emits a
            // blank blockquote line so internal spacing is preserved.
            let bqContent = afterLead.slice(hasSpace ? 2 : 1);

            i++;
            while (i < len) {
                const nextLine = lines[i];
                if (!isBlockquote(nextLine)) {
                    break;
                }
                const nextAfterLead = nextLine.trimStart();
                const nextHasSpace =
                    nextAfterLead.length > 1 &&
                    nextAfterLead.charCodeAt(1) === CHAR_SPACE;
                const nextContent = nextAfterLead
                    .slice(nextHasSpace ? 2 : 1)
                    .trim();

                // Blank blockquote line — flush current paragraph, emit the
                // blank line as-is, then start fresh.
                if (nextContent.length === 0) {
                    if (bqContent.trim().length > 0) {
                        const wrapped = wrapText(
                            bqContent.trim(),
                            contentWidth
                        );
                        const wLines = wrapped.split("\n");
                        for (let w = 0, wLen = wLines.length; w < wLen; w++) {
                            outputLines.push(bqPrefix + wLines[w]);
                        }
                    }
                    outputLines.push(nextLine);
                    bqContent = "";
                    i++;
                    continue;
                }

                bqContent = bqContent + " " + nextContent;
                i++;
            }

            // Flush remaining content
            const trimmedBqContent = bqContent.trim();
            if (trimmedBqContent.length > 0) {
                if (trimmedBqContent.length <= contentWidth) {
                    outputLines.push(bqPrefix + trimmedBqContent);
                } else {
                    const wrapped = wrapText(trimmedBqContent, contentWidth);
                    const wLines = wrapped.split("\n");
                    for (let w = 0, wLen = wLines.length; w < wLen; w++) {
                        outputLines.push(bqPrefix + wLines[w]);
                    }
                }
            }

            continue;
        }

        // Preserve horizontal rules
        if (isHorizontalRule(line)) {
            outputLines.push(line);
            i++;
            continue;
        }

        // Preserve table lines
        if (isTableLine(line)) {
            outputLines.push(line);
            i++;
            continue;
        }

        /** Minimum list length before inter-item blank lines are inserted. */
        const LONG_LIST_THRESHOLD = 6;

        // Handle list items
        if (isListItem(line)) {
            const leadingSpaces = line.length - line.trimStart().length;
            const indent = line.slice(0, leadingSpaces);
            const trimmedLine = line.trimStart();

            // Count full run: backward + forward, skipping blank lines between items.
            let listRunLength = 1;
            let listRunLines = 0; // non-blank source lines in the run

            /**
             * Returns true for lines that terminate a list run (structural elements,
             * or a list item at a different indent level).
             * @param {string} pl
             * @returns {boolean}
             */
            const isListTerminator = (pl) =>
                isHeading(pl) ||
                isHorizontalRule(pl) ||
                isBlockquote(pl) ||
                isCodeFenceStart(pl) ||
                isTableLine(pl) ||
                isPageBreakCommentLine(pl) ||
                (isListItem(pl) &&
                    pl.length - pl.trimStart().length !== leadingSpaces);

            // Backward: list items + their continuation lines
            for (let peek = i - 1; peek >= 0; peek--) {
                const pl = lines[peek];
                const pt = pl.trim();
                if (pt.length === 0) {
                    continue;
                } // blank between items
                if (isListTerminator(pl)) {
                    break;
                }
                if (isListItem(pl)) {
                    listRunLength++;
                } // same-indent item
                listRunLines++; // count items + their continuation lines
                // else: continuation line of a previous item — skip over it
            }
            // Forward: list items + their continuation lines
            for (let peek = i + 1; peek < len; peek++) {
                const pl = lines[peek];
                const pt = pl.trim();
                if (pt.length === 0) {
                    continue;
                }
                if (isListTerminator(pl)) {
                    break;
                }
                if (isListItem(pl)) {
                    listRunLength++;
                }
                listRunLines++;
                // else: continuation line of a future item — skip over it
            }
            // +1 for the current item itself (not yet in peek range)
            const longList =
                listRunLength >= LONG_LIST_THRESHOLD ||
                listRunLines + 1 >= LONG_LIST_THRESHOLD;

            // Find the marker (- or * or number.)
            let markerEnd = 0;
            if (trimmedLine.startsWith("- ") || trimmedLine.startsWith("* ")) {
                markerEnd = 2;
            } else {
                // Numbered list
                const match = trimmedLine.match(/^(\d+\.)\s/);
                if (match) {
                    markerEnd = match[0].length;
                }
            }

            const marker = trimmedLine.slice(0, markerEnd);
            let content = trimmedLine.slice(markerEnd);

            // Collect continuation lines
            let lastListSourceLine = line;
            i++;

            while (i < len) {
                const nextLine = lines[i];
                const nextTrimmed = nextLine.trim();

                // Stop at blank line
                if (nextTrimmed.length === 0) {
                    break;
                }

                // Stop at another list item
                if (isListItem(nextLine)) {
                    break;
                }

                // Stop at legal sub-items like (a), (b), (i) — must stay on
                // their own lines, not get merged into the list item body
                if (isLegalSubItemStart(nextTrimmed)) {
                    break;
                }

                // Stop at heading, blockquote, etc
                if (
                    isHeading(nextLine) ||
                    isBlockquote(nextLine) ||
                    isHorizontalRule(nextLine) ||
                    isCodeFenceStart(nextLine) ||
                    isTableLine(nextLine)
                ) {
                    break;
                }

                // Stop if the last consumed source line had a clause-break signal
                if (/[:.;] $/.test(lastListSourceLine)) {
                    break;
                }

                // Merge continuation (no indent check — a col-0 line that is
                // not structural is still continuation of this list item)
                content = content + " " + nextTrimmed;
                lastListSourceLine = nextLine;
                i++;
            }

            // Preserve clause-break trailing space on the last source line
            const listHasPunctBreak = /[:.;] $/.test(lastListSourceLine);
            const cleanListContent = content.replace(/ +$/, "");

            // Wrap the list item content
            // Continuation indent must match marker width so wrapped lines
            // align with the content start (e.g. "4. " → 3 spaces, "- " → 2)
            const markerIndent = " ".repeat(marker.length);
            const firstLineMax = maxWidth - indent.length - marker.length;

            if (cleanListContent.length <= firstLineMax) {
                const out = indent + marker + cleanListContent;
                outputLines.push(listHasPunctBreak ? out + " " : out);
            } else {
                // Do NOT pass markerIndent to wrapText — wrapText subtracts
                // continuationIndent.length from maxWidth a second time, making
                // continuation lines shorter than the first line.  Instead wrap
                // with no indent and prepend markerIndent manually so every
                // wrapped line uses the same content budget (firstLineMax).
                const wrapped = wrapText(cleanListContent, firstLineMax);
                const wrappedLines = wrapped.split("\n");
                outputLines.push(indent + marker + wrappedLines[0]);
                for (let j = 1, wLen = wrappedLines.length; j < wLen; j++) {
                    const isLast = j === wLen - 1;
                    const outLine = indent + markerIndent + wrappedLines[j];
                    outputLines.push(
                        isLast && listHasPunctBreak ? outLine + " " : outLine
                    );
                }
            }

            // Normalize inter-item blank: consume any source blank(s) between this
            // item and the next same-indent list item, then re-insert iff longList.
            if (i < len && lines[i].trim().length === 0) {
                let afterBlank = i + 1;
                while (
                    afterBlank < len &&
                    lines[afterBlank].trim().length === 0
                ) {
                    afterBlank++;
                }
                const nextIsListItem =
                    afterBlank < len &&
                    isListItem(lines[afterBlank]) &&
                    lines[afterBlank].length -
                        lines[afterBlank].trimStart().length ===
                        leadingSpaces;
                if (nextIsListItem) {
                    i = afterBlank; // consume the source blank(s)
                    if (longList) {
                        outputLines.push("");
                    }
                }
                // else: blank terminates the list — let the outer loop emit it normally
            } else if (
                longList &&
                i < len &&
                isListItem(lines[i]) &&
                lines[i].length - lines[i].trimStart().length === leadingSpaces
            ) {
                outputLines.push(""); // source had no blank but we need one
            }

            lastListLong = longList;
            lastListIndent = leadingSpaces;

            continue;
        }

        // Legal sub-items like (a), (b), (i), a., 2.A.1 — wrap like list
        // items: preserve leading block indent, align continuation under the
        // content start (after the marker).
        if (isLegalSubItemStart(trimmed)) {
            const leadingSpaces = line.length - line.trimStart().length;
            const blockIndent = line.slice(0, leadingSpaces);

            // Extract the marker (including trailing space)
            const markerMatch = trimmed.match(
                /^(\((?:\d+|[A-Za-z]|[ivxlcdmIVXLCDM]+)\) ?|[A-Za-z][.)]\s+|\d+[.)]\s+|\d+(?:\.[A-Za-z0-9]+)+\.?\s+)/
            );
            const marker = markerMatch ? markerMatch[1] : "";
            let content = trimmed.slice(marker.length);

            // Collect continuation lines (indented deeper than block level)
            i++;
            let lastSubSourceLine = line;

            while (i < len) {
                const nextLine = lines[i];
                const nextTrimmed = nextLine.trim();

                if (nextTrimmed.length === 0) {
                    break;
                }
                if (isLegalSubItemStart(nextTrimmed)) {
                    break;
                }
                if (
                    isHeading(nextLine) ||
                    isBlockquote(nextLine) ||
                    isHorizontalRule(nextLine) ||
                    isListItem(nextLine) ||
                    isCodeFenceStart(nextLine) ||
                    isTableLine(nextLine)
                ) {
                    break;
                }
                // Stop if the last consumed source line had a clause-break signal
                if (/[:.;] $/.test(lastSubSourceLine)) {
                    break;
                }
                const nextLeadingSpaces =
                    nextLine.length - nextLine.trimStart().length;
                if (nextLeadingSpaces <= leadingSpaces) {
                    break;
                }
                content = content + " " + nextTrimmed;
                lastSubSourceLine = nextLine;
                i++;
            }

            // Preserve clause-break trailing space on the last source line
            const subHasPunctBreak = /[:.;] $/.test(lastSubSourceLine);

            // trimStart() may keep trailing space — strip before adding back
            const cleanSubContent = content.replace(/ +$/, "");

            // Continuation aligns with text content start (after marker)
            const markerIndent = " ".repeat(marker.length);
            const firstLineMax = maxWidth - leadingSpaces - marker.length;

            if (cleanSubContent.length <= firstLineMax) {
                const out = blockIndent + marker + cleanSubContent;
                outputLines.push(subHasPunctBreak ? out + " " : out);
            } else {
                // Same fix as the list-item path: wrap without continuationIndent
                // to avoid double-subtracting marker.length, then prepend manually.
                const wrapped = wrapText(cleanSubContent, firstLineMax);
                const wrappedLines = wrapped.split("\n");
                outputLines.push(blockIndent + marker + wrappedLines[0]);
                for (let j = 1, wLen = wrappedLines.length; j < wLen; j++) {
                    const isLast = j === wLen - 1;
                    const outLine =
                        blockIndent + markerIndent + wrappedLines[j];
                    outputLines.push(
                        isLast && subHasPunctBreak ? outLine + " " : outLine
                    );
                }
            }

            if (lastListLong && i < len) {
                const nxt = lines[i];
                if (nxt.trim().length === 0) {
                    let afterBlank = i + 1;
                    while (
                        afterBlank < len &&
                        lines[afterBlank].trim().length === 0
                    ) {
                        afterBlank++;
                    }
                    const nextIsParentItem =
                        afterBlank < len &&
                        isListItem(lines[afterBlank]) &&
                        lines[afterBlank].length -
                            lines[afterBlank].trimStart().length ===
                            lastListIndent;
                    if (nextIsParentItem) {
                        i = afterBlank;
                        outputLines.push("");
                    }
                } else if (
                    isListItem(nxt) &&
                    nxt.length - nxt.trimStart().length === lastListIndent
                ) {
                    outputLines.push("");
                }
            }

            continue;
        }

        // Any structural break resets the list context
        lastListLong = false;

        // Paragraph reflow: accumulate consecutive plain-prose lines, join
        // with a single space, and re-wrap to maxWidth.
        // Lines containing URLs are passed through unchanged to avoid
        // mangling link syntax.

        // Only skip reflow for lines where a URL is the dominant content
        // (i.e. the trimmed line is essentially just a URL with no surrounding
        // prose). Inline citations like "See www.example.com for details" are
        // still reflowed — the URL stays intact since wrapText wraps at spaces.
        const looksLikeUrlLine =
            (trimmed.startsWith("https://") ||
                trimmed.startsWith("http://") ||
                trimmed.startsWith("www.")) &&
            !trimmed.includes(" ");
        if (looksLikeUrlLine) {
            outputLines.push(line);
            i++;
            continue;
        }

        {
            const leadingSpaces = line.length - line.trimStart().length;
            const indent = line.slice(0, leadingSpaces);
            let content = trimmed;

            i++;
            while (i < len) {
                const nextLine = lines[i];
                const nextTrimmed = nextLine.trim();

                if (nextTrimmed.length === 0) {
                    break;
                }
                if (
                    isHeading(nextLine) ||
                    isBlockquote(nextLine) ||
                    isHorizontalRule(nextLine) ||
                    isListItem(nextLine) ||
                    isCodeFenceStart(nextLine) ||
                    isTableLine(nextLine) ||
                    isLegalSubItemStart(nextTrimmed) ||
                    isPageBreakCommentLine(nextLine) ||
                    containsUrl(nextLine)
                ) {
                    break;
                }
                // Different indent level = different block
                const nextLeading =
                    nextLine.length - nextLine.trimStart().length;
                if (nextLeading !== leadingSpaces) {
                    break;
                }

                content = content + " " + nextTrimmed;
                i++;
            }

            const budget = maxWidth - leadingSpaces;
            if (content.length <= budget) {
                outputLines.push(indent + content);
            } else {
                const wrapped = wrapText(content, budget);
                const wrappedLines = wrapped.split("\n");
                for (let j = 0, wLen = wrappedLines.length; j < wLen; j++) {
                    outputLines.push(indent + wrappedLines[j]);
                }
            }
            continue;
        }
    }

    const result = outputLines.join("\n");
    if (result !== text) {
        changed = true;
    }

    return { text: result, changed };
}

/**
 * Extract the first H1 title from markdown.
 * @param {string} markdown
 * @returns {string}
 */
function extractTitleFromMarkdown(markdown) {
    const lines = markdown.split("\n");
    for (let i = 0, len = lines.length; i < len; i++) {
        const line = lines[i].trim();
        if (line.startsWith("# ")) {
            return line.slice(2).trim();
        }
    }
    return "Untitled";
}

// ============================================================================
// Exports
// ============================================================================

export {
    groupListItems,
    parseInlineContent,
    parseCodeBlock,
    parseParagraph,
    extractKeyAndSummary,
    findStarPattern,
    parseHeading,
    parseListItem,
    parseMarkdownDoc,
    buildAnchorIndex,
    buildSummaryForKey,
    getAnchorIdForNode,
    getEntryByKey,
    extractTextContent,
    extractTitleFromMarkdown,
    walkNodes,
    findNodesByType,
    isTableLine,
    containsUrl,
    isHashLike,
    findLongLinesMarkdown,
    isHeading,
    isBlockquote,
    isHorizontalRule,
    isListItem,
    isLegalSubItemStart,
    isCodeFenceStart,
    isPageBreakCommentLine,
    wrapText,
    reflowMarkdown,
    endsWithSentenceTerminator,
    isLikelyBracketPlaceholderContent,
    canonicalInlineFieldKey
};
