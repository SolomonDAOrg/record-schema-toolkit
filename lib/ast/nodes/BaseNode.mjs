/**
 * BaseNode - Foundation for all Format AST nodes
 * @module format-ast/nodes/BaseNode
 */

import { NODE_CATEGORIES, BASE_NODE_TYPES } from "../constants/core.mjs";

/**
 * @typedef {import("../types/core.mjs").NodeType} NodeType
 * @typedef {import("../types/core.mjs").NodeCategory} NodeCategory
 * @typedef {import("../types/core.mjs").KeepRules} KeepRules
 * @typedef {import("../types/core.mjs").TextStyle} TextStyle
 * @typedef {import("../types/core.mjs").BoxStyle} BoxStyle
 */

/**
 * @typedef {Object} BaseNodeData
 * @property {string} [id]
 * @property {Record<string, unknown>} [attrs]
 * @property {KeepRules} [keepRules]
 * @property {TextStyle} [textStyle]
 * @property {BoxStyle} [boxStyle]
 */

let _nodeIdCounter = 0;

/**
 * Generate unique node ID
 * @returns {string}
 */
function generateNodeId() {
    return `node_${++_nodeIdCounter}`;
}

/**
 * Reset node ID counter (for testing)
 */
export function resetNodeIdCounter() {
    _nodeIdCounter = 0;
}

/**
 * Base class for all AST nodes
 */
export class BaseNode {
    /**
     * @param {NodeType} type
     * @param {BaseNodeData} [data]
     */
    constructor(type, data = {}) {
        /** @type {NodeType} */
        this.type = type;

        /** @type {string} */
        this.id = data.id || generateNodeId();

        /** @type {NodeCategory} */
        this.category = NODE_CATEGORIES.BASE;

        /** @type {BaseNode[]} */
        this.children = [];

        /** @type {Record<string, unknown>} */
        this.attrs = data.attrs || {};

        /** @type {KeepRules | undefined} */
        this.keepRules = data.keepRules;

        /** @type {TextStyle | undefined} */
        this.textStyle = data.textStyle;

        /** @type {BoxStyle | undefined} */
        this.boxStyle = data.boxStyle;
    }

    // =========================================================================
    // Type Checking
    // =========================================================================

    /**
     * Check if node is of given type
     * @param {NodeType} type
     * @returns {boolean}
     */
    isType(type) {
        return this.type === type;
    }

    /**
     * Check if node is in given category
     * @param {NodeCategory} category
     * @returns {boolean}
     */
    isCategory(category) {
        return this.category === category;
    }

    /**
     * Check if node can have children
     * @returns {boolean}
     */
    canHaveChildren() {
        return true;
    }

    /**
     * Check if node is a block-level element
     * @returns {boolean}
     */
    isBlock() {
        return true;
    }

    /**
     * Check if node is an inline element
     * @returns {boolean}
     */
    isInline() {
        return false;
    }

    // =========================================================================
    // Children Management
    // =========================================================================

    /**
     * Add child node
     * @param {BaseNode} child
     * @returns {this}
     */
    appendChild(child) {
        if (!this.canHaveChildren()) {
            throw new Error(`Node type "${this.type}" cannot have children`);
        }
        if (child !== undefined && child !== null) {
            this.children.push(child);
        }
        return this;
    }

    /**
     * Add multiple children
     * @param {BaseNode[]} children
     * @returns {this}
     */
    appendChildren(children) {
        for (let i = 0, len = children.length; i < len; i++) {
            this.appendChild(children[i]);
        }
        return this;
    }

    /**
     * Insert child at index
     * @param {number} index
     * @param {BaseNode} child
     * @returns {this}
     */
    insertChild(index, child) {
        if (!this.canHaveChildren()) {
            throw new Error(`Node type "${this.type}" cannot have children`);
        }
        this.children.splice(index, 0, child);
        return this;
    }

    /**
     * Remove child by index
     * @param {number} index
     * @returns {BaseNode | undefined}
     */
    removeChildAt(index) {
        return this.children.splice(index, 1)[0];
    }

    /**
     * Remove child by reference
     * @param {BaseNode} child
     * @returns {boolean}
     */
    removeChild(child) {
        const index = this.children.indexOf(child);
        if (index !== -1) {
            this.children.splice(index, 1);
            return true;
        }
        return false;
    }

    /**
     * Clear all children
     * @returns {this}
     */
    clearChildren() {
        this.children = [];
        return this;
    }

    /**
     * Check if node has children
     * @returns {boolean}
     */
    hasChildren() {
        return this.children.length > 0;
    }

    /**
     * Get child count
     * @returns {number}
     */
    childCount() {
        return this.children.length;
    }

    /**
     * Get first child
     * @returns {BaseNode | undefined}
     */
    firstChild() {
        return this.children[0];
    }

    /**
     * Get last child
     * @returns {BaseNode | undefined}
     */
    lastChild() {
        return this.children[this.children.length - 1];
    }

    // =========================================================================
    // Attributes
    // =========================================================================

    /**
     * Set attribute
     * @param {string} key
     * @param {unknown} value
     * @returns {this}
     */
    setAttr(key, value) {
        this.attrs[key] = value;
        return this;
    }

    /**
     * Get attribute
     * @template T
     * @param {string} key
     * @param {T} [defaultValue]
     * @returns {T | unknown}
     */
    getAttr(key, defaultValue) {
        if (Object.prototype.hasOwnProperty.call(this.attrs, key)) {
            return this.attrs[key];
        }
        return defaultValue;
    }

    /**
     * Check if attribute exists
     * @param {string} key
     * @returns {boolean}
     */
    hasAttr(key) {
        return Object.prototype.hasOwnProperty.call(this.attrs, key);
    }

    /**
     * Remove attribute
     * @param {string} key
     * @returns {this}
     */
    removeAttr(key) {
        delete this.attrs[key];
        return this;
    }

    // =========================================================================
    // Style Helpers
    // =========================================================================

    /**
     * Set keep rules
     * @param {KeepRules} rules
     * @returns {this}
     */
    setKeepRules(rules) {
        this.keepRules = { ...this.keepRules, ...rules };
        return this;
    }

    /**
     * Set text style
     * @param {TextStyle} style
     * @returns {this}
     */
    setTextStyle(style) {
        this.textStyle = { ...this.textStyle, ...style };
        return this;
    }

    /**
     * Set box style
     * @param {BoxStyle} style
     * @returns {this}
     */
    setBoxStyle(style) {
        this.boxStyle = { ...this.boxStyle, ...style };
        return this;
    }

    // =========================================================================
    // Traversal
    // =========================================================================

    /**
     * Walk tree depth-first
     * @param {(node: BaseNode, depth: number, index: number) => boolean | void} visitor
     * @param {number} [depth]
     * @param {number} [index]
     * @returns {boolean} - false to stop traversal
     */
    walk(visitor, depth = 0, index = 0) {
        const result = visitor(this, depth, index);
        if (result === false) {
            return false;
        }
        for (let i = 0, len = this.children.length; i < len; i++) {
            if (this.children[i].walk(visitor, depth + 1, i) === false) {
                return false;
            }
        }
        return true;
    }

    /**
     * Find nodes matching predicate
     * @param {(node: BaseNode) => boolean} predicate
     * @returns {BaseNode[]}
     */
    findAll(predicate) {
        /** @type {BaseNode[]} */
        const results = [];
        this.walk((node) => {
            if (predicate(node)) {
                results.push(node);
            }
        });
        return results;
    }

    /**
     * Find first node matching predicate
     * @param {(node: BaseNode) => boolean} predicate
     * @returns {BaseNode | undefined}
     */
    findFirst(predicate) {
        /** @type {BaseNode | undefined} */
        let found;
        this.walk((node) => {
            if (predicate(node)) {
                found = node;
                return false;
            }
        });
        return found;
    }

    /**
     * Find node by ID
     * @param {string} id
     * @returns {BaseNode | undefined}
     */
    findById(id) {
        return this.findFirst((node) => node.id === id);
    }

    /**
     * Find all nodes of type
     * @param {NodeType} type
     * @returns {BaseNode[]}
     */
    findByType(type) {
        return this.findAll((node) => node.type === type);
    }

    /**
     * Find all nodes in category
     * @param {NodeCategory} category
     * @returns {BaseNode[]}
     */
    findByCategory(category) {
        return this.findAll((node) => node.category === category);
    }

    // =========================================================================
    // Transformation
    // =========================================================================

    /**
     * Transform tree with visitor
     * @param {(node: BaseNode) => BaseNode | BaseNode[] | null} visitor
     * @returns {BaseNode | null}
     */
    transform(visitor) {
        const result = visitor(this);

        if (result === null) {
            return null;
        }

        if (Array.isArray(result)) {
            // Can't return multiple nodes from root transform
            // This case is handled by parent
            return result[0] || null;
        }

        // Transform children
        /** @type {BaseNode[]} */
        const newChildren = [];
        for (let i = 0, len = result.children.length; i < len; i++) {
            const child = result.children[i];
            const transformed = child.transform(visitor);
            if (transformed === null) {
                continue;
            }
            if (Array.isArray(transformed)) {
                for (let j = 0, jlen = transformed.length; j < jlen; j++) {
                    newChildren.push(transformed[j]);
                }
            } else {
                newChildren.push(transformed);
            }
        }

        result.children = newChildren;
        return result;
    }

    // =========================================================================
    // Cloning
    // =========================================================================

    /**
     * Clone node without children
     * @returns {BaseNode}
     */
    cloneShallow() {
        const clone = new BaseNode(this.type, {
            id: generateNodeId(),
            attrs: { ...this.attrs },
            keepRules: this.keepRules ? { ...this.keepRules } : undefined,
            textStyle: this.textStyle ? { ...this.textStyle } : undefined,
            boxStyle: this.boxStyle ? { ...this.boxStyle } : undefined
        });
        clone.category = this.category;
        return clone;
    }

    /**
     * Clone node with children (deep)
     * @returns {BaseNode}
     */
    clone() {
        const clone = this.cloneShallow();
        for (let i = 0, len = this.children.length; i < len; i++) {
            clone.appendChild(this.children[i].clone());
        }
        return clone;
    }

    // =========================================================================
    // Serialization
    // =========================================================================

    /**
     * Convert to plain object
     * @returns {Record<string, unknown>}
     */
    toJSON() {
        /** @type {Record<string, unknown>} */
        const obj = {
            type: this.type,
            id: this.id,
            category: this.category
        };

        if (Object.keys(this.attrs).length > 0) {
            obj.attrs = this.attrs;
        }

        if (this.keepRules) {
            obj.keepRules = this.keepRules;
        }

        if (this.textStyle) {
            obj.textStyle = this.textStyle;
        }

        if (this.boxStyle) {
            obj.boxStyle = this.boxStyle;
        }

        if (this.children.length > 0) {
            obj.children = this.children.map((c) => c.toJSON());
        }

        return obj;
    }

    /**
     * Get text content (for nodes that have it)
     * @returns {string}
     */
    getTextContent() {
        return "";
    }
}

// =============================================================================
// Concrete Base Node Types
// =============================================================================

/**
 * Text node - leaf node containing text
 */
export class TextNode extends BaseNode {
    /**
     * @param {string} text
     * @param {BaseNodeData & { formats?: import("../types/core.mjs").InlineFormat[] }} [data]
     */
    constructor(text, data = {}) {
        super(BASE_NODE_TYPES.TEXT, data);

        /** @type {string} */
        this.text = text;

        /** @type {import("../types/core.mjs").InlineFormat[]} */
        this.formats = data.formats || [];
    }

    /** @override */
    canHaveChildren() {
        return false;
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
        return this.text;
    }

    /**
     * Set text content
     * @param {string} text
     * @returns {void}
     */
    setTextContent(text) {
        this.text = text;
    }

    /**
     * Add inline format
     * @param {import("../types/core.mjs").InlineFormatType} type
     * @param {number} start
     * @param {number} end
     * @returns {this}
     */
    addFormat(type, start, end) {
        this.formats.push({ type, start, end });
        return this;
    }

    /** @override */
    cloneShallow() {
        const clone = new TextNode(this.text, {
            attrs: { ...this.attrs },
            formats: this.formats.map((f) => ({ ...f })),
            keepRules: this.keepRules ? { ...this.keepRules } : undefined,
            textStyle: this.textStyle ? { ...this.textStyle } : undefined,
            boxStyle: this.boxStyle ? { ...this.boxStyle } : undefined
        });
        return clone;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.text = this.text;
        if (this.formats.length > 0) {
            obj.formats = this.formats;
        }
        return obj;
    }
}

/**
 * Container node - groups other nodes
 */
export class ContainerNode extends BaseNode {
    /**
     * @param {BaseNodeData & { label?: string }} [data]
     */
    constructor(data = {}) {
        super(BASE_NODE_TYPES.CONTAINER, data);

        /** @type {string | undefined} */
        this.label = data.label;
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

/**
 * Break node - page/column/section break
 */
export class BreakNode extends BaseNode {
    /**
     * @param {"page" | "column" | "section"} breakType
     * @param {BaseNodeData} [data]
     */
    constructor(breakType, data = {}) {
        super(BASE_NODE_TYPES.BREAK, data);

        /** @type {"page" | "column" | "section"} */
        this.breakType = breakType;
    }

    /** @override */
    canHaveChildren() {
        return false;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.breakType = this.breakType;
        return obj;
    }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create text node
 * @param {string} text
 * @param {BaseNodeData} [data]
 * @returns {TextNode}
 */
export function createText(text, data) {
    return new TextNode(text, data);
}

/**
 * Create container node
 * @param {BaseNodeData & { label?: string }} [data]
 * @returns {ContainerNode}
 */
export function createContainer(data) {
    return new ContainerNode(data);
}

/**
 * Create page break
 * @param {BaseNodeData} [data]
 * @returns {BreakNode}
 */
export function createPageBreak(data) {
    return new BreakNode("page", data);
}

/**
 * Create section break
 * @param {BaseNodeData} [data]
 * @returns {BreakNode}
 */
export function createSectionBreak(data) {
    return new BreakNode("section", data);
}
