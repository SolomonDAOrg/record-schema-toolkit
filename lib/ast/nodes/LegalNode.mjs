/**
 * LegalNode - Legal document structure nodes
 * Extends ProseNode for legal-specific structures
 * @module format-ast/nodes/LegalNode
 */

import { ProseNode, ParagraphNode, createParagraph } from "./ProseNode.mjs";
import { createText, TextNode } from "./BaseNode.mjs";
import { LEGAL_NODE_TYPES } from "../constants/core.mjs";

/**
 * @typedef {import("../types/core.mjs").LegalNodeType} LegalNodeType
 * @typedef {import("./BaseNode.mjs").BaseNodeData} BaseNodeData
 * @typedef {import("./BaseNode.mjs").BaseNode} BaseNode
 */

// =============================================================================
// Article
// =============================================================================

/**
 * @typedef {Object} ArticleData
 * @property {string} [number] - "I", "II", "1", "2", etc.
 * @property {string} [title]
 * @property {boolean} [numbered]
 */

/**
 * Article node - top-level legal section (Article I, Article II, etc.)
 */
export class ArticleNode extends ProseNode {
    /**
     * @param {string} [number]
     * @param {string} [title]
     * @param {BaseNodeData & ArticleData} [data]
     */
    constructor(number, title, data = {}) {
        super(/** @type {any} */ (LEGAL_NODE_TYPES.ARTICLE), data);

        /** @type {string | undefined} */
        this.number = number || data.number;

        /** @type {string | undefined} */
        this.title = title || data.title;

        /** @type {boolean} */
        this.numbered = data.numbered !== false;
    }

    /**
     * Add section to article
     * @param {string} [number]
     * @param {string} [title]
     * @param {BaseNodeData & SectionData} [data]
     * @returns {SectionNode}
     */
    addSection(number, title, data) {
        const section = new SectionNode(number, title, data);
        this.appendChild(section);
        return section;
    }

    /**
     * Get formatted heading
     * @returns {string}
     */
    getHeading() {
        const parts = [];
        if (this.numbered && this.number) {
            parts.push(`Article ${this.number}`);
        }
        if (this.title) {
            if (parts.length > 0) {
                parts.push(": ");
            }
            parts.push(this.title);
        }
        return parts.join("");
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        if (this.number) {
            obj.number = this.number;
        }
        if (this.title) {
            obj.title = this.title;
        }
        if (!this.numbered) {
            obj.numbered = false;
        }
        return obj;
    }
}

// =============================================================================
// Section
// =============================================================================

/**
 * @typedef {Object} SectionData
 * @property {string} [number] - "1.1", "1.2", etc.
 * @property {string} [title]
 * @property {boolean} [numbered]
 */

/**
 * Section node - subdivision of article
 */
export class SectionNode extends ProseNode {
    /**
     * @param {string} [number]
     * @param {string} [title]
     * @param {BaseNodeData & SectionData} [data]
     */
    constructor(number, title, data = {}) {
        super(/** @type {any} */ (LEGAL_NODE_TYPES.SECTION), data);

        /** @type {string | undefined} */
        this.number = number || data.number;

        /** @type {string | undefined} */
        this.title = title || data.title;

        /** @type {boolean} */
        this.numbered = data.numbered !== false;
    }

    /**
     * Add clause to section
     * @param {string} [number]
     * @param {string | BaseNode[]} [content]
     * @param {BaseNodeData & ClauseData} [data]
     * @returns {ClauseNode}
     */
    addClause(number, content, data) {
        const clause = new ClauseNode(number, content, data);
        this.appendChild(clause);
        return clause;
    }

    /**
     * Add paragraph to section
     * @param {string | BaseNode[]} content
     * @returns {ParagraphNode}
     */
    addParagraph(content) {
        const p = createParagraph(content);
        this.appendChild(p);
        return p;
    }

    /**
     * Get formatted heading
     * @returns {string}
     */
    getHeading() {
        const parts = [];
        if (this.numbered && this.number) {
            parts.push(`Section ${this.number}`);
        }
        if (this.title) {
            if (parts.length > 0) {
                parts.push(". ");
            }
            parts.push(this.title);
        }
        return parts.join("");
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        if (this.number) {
            obj.number = this.number;
        }
        if (this.title) {
            obj.title = this.title;
        }
        if (!this.numbered) {
            obj.numbered = false;
        }
        return obj;
    }
}

// =============================================================================
// Clause
// =============================================================================

/**
 * @typedef {Object} ClauseData
 * @property {string} [number] - "(a)", "(b)", "(i)", etc.
 * @property {boolean} [numbered]
 */

/**
 * Clause node - individual provision or paragraph with optional numbering
 */
export class ClauseNode extends ProseNode {
    /**
     * @param {string} [number]
     * @param {string | BaseNode[]} [content]
     * @param {BaseNodeData & ClauseData} [data]
     */
    constructor(number, content, data = {}) {
        super(/** @type {any} */ (LEGAL_NODE_TYPES.CLAUSE), data);

        /** @type {string | undefined} */
        this.number = number || data.number;

        /** @type {boolean} */
        this.numbered = data.numbered !== false;

        if (content) {
            if (typeof content === "string") {
                this.appendChild(createText(content));
            } else {
                this.appendChildren(content);
            }
        }
    }

    /**
     * Add sub-clause
     * @param {string} [number]
     * @param {string | BaseNode[]} [content]
     * @param {BaseNodeData & ClauseData} [data]
     * @returns {ClauseNode}
     */
    addSubClause(number, content, data) {
        const sub = new ClauseNode(number, content, data);
        this.appendChild(sub);
        return sub;
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
        if (this.number) {
            obj.number = this.number;
        }
        if (!this.numbered) {
            obj.numbered = false;
        }
        return obj;
    }
}

// =============================================================================
// Definition
// =============================================================================

/**
 * @typedef {Object} DefinitionData
 * @property {string} [term]
 * @property {string} [sortKey] - For alphabetizing
 */

/**
 * Definition node - defined term
 */
export class DefinitionNode extends ProseNode {
    /**
     * @param {string} term
     * @param {string | BaseNode[]} definition
     * @param {BaseNodeData & DefinitionData} [data]
     */
    constructor(term, definition, data = {}) {
        super(/** @type {any} */ (LEGAL_NODE_TYPES.DEFINITION), data);

        /** @type {string} */
        this.term = term;

        /** @type {string} */
        this.sortKey = data.sortKey || term.toLowerCase();

        if (typeof definition === "string") {
            this.appendChild(createText(definition));
        } else {
            this.appendChildren(definition);
        }

        this.normalizeDefinitionBody();
    }

    /**
     * Normalize definition children so they contain only the definition body
     * (never the leading defined term / quotes / separator).
     *
     * This prevents duplicated output when renderers print `term` separately.
     */
    normalizeDefinitionBody() {
        const rawTerm = typeof this.term === "string" ? this.term.trim() : "";
        if (rawTerm.length === 0) {
            return;
        }

        const term = rawTerm.replace(/^[\"“]/, "").replace(/[\"”]$/, "");
        if (term.trim().length === 0) {
            return;
        }

        const fullText = this.getDefinitionText();
        const prefixLen = this.computeLeadingDefinitionPrefixLength(
            term.trim(),
            fullText
        );
        if (prefixLen <= 0) {
            return;
        }

        this.consumeLeadingCharsFromChildren(prefixLen);
        this.trimLeadingWhitespaceFromChildren();
    }

    /**
     * @param {string} term
     * @param {string} fullText
     * @returns {number}
     */
    computeLeadingDefinitionPrefixLength(term, fullText) {
        const escaped = this.escapeRegExp(term);

        // Strip: optional quotes + term + optional quotes + whitespace + optional separator.
        // Separator handles common authoring styles: `"Term" -- ...`, `"Term" — ...`, `"Term": ...`, `"Term" means ...`.
        const re = new RegExp(
            `^\\s*[\\"“]?${escaped}[\\"”]?\\s*(?:(?:--|—|–|-|:)\\s*)?`,
            "i"
        );
        const match = fullText.match(re);
        return match && match[0] ? match[0].length : 0;
    }

    /**
     * @param {string} value
     * @returns {string}
     */
    escapeRegExp(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    /**
     * @param {number} count
     */
    consumeLeadingCharsFromChildren(count) {
        let remaining = count;

        while (this.children.length > 0 && remaining > 0) {
            const node = this.children[0];
            const consumed = this.consumeLeadingCharsFromNode(node, remaining);
            remaining -= consumed;

            if (consumed === 0) {
                // Node did not contribute text (or couldn't be consumed). Drop it to make progress.
                this.children.shift();
                continue;
            }

            if (this.isNodeEmpty(node)) {
                this.children.shift();
            }
        }
    }

    /**
     * @param {import("./BaseNode.mjs").BaseNode} node
     * @param {number} remaining
     * @returns {number}
     */
    consumeLeadingCharsFromNode(node, remaining) {
        if (remaining <= 0) {
            return 0;
        }

        const nodeText = node.getTextContent();

        if (node.type === "text") {
            const take = Math.min(nodeText.length, remaining);
            /** @type {TextNode} */ (node).setTextContent(nodeText.slice(take));
            return take;
        }

        if (!node.children || node.children.length === 0) {
            return 0;
        }

        let consumedTotal = 0;
        while (node.children.length > 0 && consumedTotal < remaining) {
            const child = node.children[0];
            const consumed = this.consumeLeadingCharsFromNode(
                child,
                remaining - consumedTotal
            );
            consumedTotal += consumed;

            if (consumed === 0) {
                node.children.shift();
                continue;
            }

            if (this.isNodeEmpty(child)) {
                node.children.shift();
            }
        }

        return consumedTotal;
    }

    /**
     * @param {import("./BaseNode.mjs").BaseNode} node
     * @returns {boolean}
     */
    isNodeEmpty(node) {
        const nodeText = node.getTextContent();

        if (node.type === "text") {
            return nodeText.length === 0;
        }
        return !node.children || node.children.length === 0;
    }

    /**
     * Trim leading whitespace in the remaining definition body.
     */
    trimLeadingWhitespaceFromChildren() {
        if (this.children.length === 0) {
            return;
        }

        const fullText = this.getDefinitionText();
        const leadingWsMatch = fullText.match(/^\s+/);
        const wsLen =
            leadingWsMatch && leadingWsMatch[0] ? leadingWsMatch[0].length : 0;
        if (wsLen > 0) {
            this.consumeLeadingCharsFromChildren(wsLen);
        }
    }

    /**
     * Get definition text
     * @returns {string}
     */
    getDefinitionText() {
        let text = "";
        for (let i = 0, len = this.children.length; i < len; i++) {
            text += this.children[i].getTextContent();
        }
        return text;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.term = this.term;
        obj.sortKey = this.sortKey;
        return obj;
    }
}

// =============================================================================
// Recital
// =============================================================================

/**
 * @typedef {Object} RecitalData
 * @property {string} [label] - "WHEREAS", "RECITAL A", etc.
 */

/**
 * Recital node - preamble/whereas clause
 */
export class RecitalNode extends ProseNode {
    /**
     * @param {string} label
     * @param {string | BaseNode[]} content
     * @param {BaseNodeData & RecitalData} data
     */
    constructor(label, content, data = {}) {
        super(/** @type {any} */ (LEGAL_NODE_TYPES.RECITAL), data);

        /** @type {string | undefined} */
        this.label = label || data.label;

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
        if (this.label) {
            obj.label = this.label;
        }
        return obj;
    }
}

// =============================================================================
// Signature Block
// =============================================================================

/**
 * @typedef {Object} SignatoryData
 * @property {string} name
 * @property {string} [title]
 * @property {string} [organization]
 * @property {string} [date]
 * @property {string} [signature] - Could be image path or encoded signature
 * @property {string} [directive]
 * @property {string} [variant]
 */

/**
 * @typedef {Object} SignatureBlockData
 * @property {SignatoryData[]} [signatories]
 * @property {string} [title]
 * @property {boolean} [dated]
 * @property {string} [witnessLabel]
 * @property {string} [partyLabel]
 * @property {string} [bodyText]
 * @property {string} [by]
 * @property {string[]} [fields]
 * @property {Record<string, string>} [values]
 * @property {string} [directive]
 * @property {string} [variant]
 */

/**
 * Signature block node
 */
export class SignatureBlockNode extends ProseNode {
    /**
     * @param {BaseNodeData & SignatureBlockData} [data]
     */
    constructor(data = {}) {
        super(/** @type {any} */ (LEGAL_NODE_TYPES.SIGNATURE_BLOCK), data);

        /** @type {SignatoryData[]} */
        this.signatories = data.signatories || [];

        /** @type {boolean} */
        this.dated = data.dated !== false;

        /** @type {string | undefined} */
        this.witnessLabel = data.witnessLabel;
    }

    /**
     * Add signatory
     * @param {SignatoryData} signatory
     * @returns {this}
     */
    addSignatory(signatory) {
        this.signatories.push(signatory);
        return this;
    }

    /** @override */
    canHaveChildren() {
        return false;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.signatories = this.signatories;
        if (!this.dated) {
            obj.dated = false;
        }
        if (this.witnessLabel) {
            obj.witnessLabel = this.witnessLabel;
        }
        return obj;
    }
}

// =============================================================================
// Notice
// =============================================================================

/**
 * @typedef {Object} NoticeData
 * @property {"info" | "warning" | "important" | "legal"} [level]
 * @property {string} [title]
 */

/**
 * Notice/callout node
 */
export class NoticeNode extends ProseNode {
    /**
     * @param {string | BaseNode[]} content
     * @param {BaseNodeData & NoticeData} [data]
     */
    constructor(content, data = {}) {
        super(/** @type {any} */ (LEGAL_NODE_TYPES.NOTICE), data);

        /** @type {"info" | "warning" | "important" | "legal"} */
        this.level = data.level || "info";

        /** @type {string | undefined} */
        this.title = data.title;

        if (typeof content === "string") {
            this.appendChild(createParagraph(content));
        } else {
            this.appendChildren(content);
        }
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.level = this.level;
        if (this.title) {
            obj.title = this.title;
        }
        return obj;
    }
}

// =============================================================================
// Schedule / Exhibit
// =============================================================================

/**
 * @typedef {Object} ScheduleData
 * @property {string} [number] - "A", "B", "1", etc.
 * @property {string} [title]
 */

/**
 * Schedule/Exhibit node - attachment/appendix
 */
export class ScheduleNode extends ProseNode {
    /**
     * @param {string} [number]
     * @param {string} [title]
     * @param {BaseNodeData & ScheduleData} [data]
     */
    constructor(number, title, data = {}) {
        super(/** @type {any} */ (LEGAL_NODE_TYPES.SCHEDULE), data);

        /** @type {string | undefined} */
        this.number = number || data.number;

        /** @type {string | undefined} */
        this.title = title || data.title;
    }

    /**
     * Get formatted heading
     * @returns {string}
     */
    getHeading() {
        const parts = [];
        if (this.number) {
            parts.push(`Schedule ${this.number}`);
        }
        if (this.title) {
            if (parts.length > 0) {
                parts.push(": ");
            }
            parts.push(this.title);
        }
        return parts.join("");
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        if (this.number) {
            obj.number = this.number;
        }
        if (this.title) {
            obj.title = this.title;
        }
        return obj;
    }
}

/**
 * Exhibit node - similar to schedule but typically for evidence/supporting docs
 */
export class ExhibitNode extends ProseNode {
    /**
     * @param {string} [number]
     * @param {string} [title]
     * @param {BaseNodeData & ScheduleData} [data]
     */
    constructor(number, title, data = {}) {
        super(/** @type {any} */ (LEGAL_NODE_TYPES.EXHIBIT), data);

        /** @type {string | undefined} */
        this.number = number || data.number;

        /** @type {string | undefined} */
        this.title = title || data.title;
    }

    /**
     * Get formatted heading
     * @returns {string}
     */
    getHeading() {
        const parts = [];
        if (this.number) {
            parts.push(`Exhibit ${this.number}`);
        }
        if (this.title) {
            if (parts.length > 0) {
                parts.push(": ");
            }
            parts.push(this.title);
        }
        return parts.join("");
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        if (this.number) {
            obj.number = this.number;
        }
        if (this.title) {
            obj.title = this.title;
        }
        return obj;
    }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * @param {string} [number]
 * @param {string} [title]
 * @param {BaseNodeData & ArticleData} [data]
 * @returns {ArticleNode}
 */
export function createArticle(number, title, data) {
    return new ArticleNode(number, title, data);
}

/**
 * @param {string} [number]
 * @param {string} [title]
 * @param {BaseNodeData & SectionData} [data]
 * @returns {SectionNode}
 */
export function createSection(number, title, data) {
    return new SectionNode(number, title, data);
}

/**
 * @param {string} [number]
 * @param {string | BaseNode[]} [content]
 * @param {BaseNodeData & ClauseData} [data]
 * @returns {ClauseNode}
 */
export function createClause(number, content, data) {
    return new ClauseNode(number, content, data);
}

/**
 * @param {string} term
 * @param {string | BaseNode[]} definition
 * @param {BaseNodeData & DefinitionData} [data]
 * @returns {DefinitionNode}
 */
export function createDefinition(term, definition, data) {
    return new DefinitionNode(term, definition, data);
}

/**
 * @param {string} label
 * @param {string | BaseNode[]} content
 * @param {BaseNodeData & RecitalData} [data]
 * @returns {RecitalNode}
 */
export function createRecital(label, content, data) {
    return new RecitalNode(label, content, data);
}

/**
 * @param {BaseNodeData & SignatureBlockData} [data]
 * @returns {SignatureBlockNode}
 */
export function createSignatureBlock(data) {
    return new SignatureBlockNode(data);
}

/**
 * @param {string | BaseNode[]} content
 * @param {BaseNodeData & NoticeData} [data]
 * @returns {NoticeNode}
 */
export function createNotice(content, data) {
    return new NoticeNode(content, data);
}

/**
 * @param {string} [number]
 * @param {string} [title]
 * @param {BaseNodeData & ScheduleData} [data]
 * @returns {ScheduleNode}
 */
export function createSchedule(number, title, data) {
    return new ScheduleNode(number, title, data);
}

/**
 * @param {string} [number]
 * @param {string} [title]
 * @param {BaseNodeData & ScheduleData} [data]
 * @returns {ExhibitNode}
 */
export function createExhibit(number, title, data) {
    return new ExhibitNode(number, title, data);
}
