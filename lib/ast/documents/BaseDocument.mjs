/**
 * BaseDocument - Document container classes
 * @module format-ast/documents/BaseDocument
 */

import { BaseNode, ContainerNode } from "../nodes/BaseNode.mjs";

/**
 * @typedef {import("../types/core.mjs").DocumentMeta} DocumentMeta
 * @typedef {import("../types/core.mjs").PageConfig} PageConfig
 * @typedef {import("../types/core.mjs").HeaderFooterConfig} HeaderFooterConfig
 * @typedef {import("../types/core.mjs").VariableRef} VariableRef
 */

// =============================================================================
// BaseDocument
// =============================================================================

/**
 * Base document class - container for AST nodes
 */
export class BaseDocument {
    /**
     * @param {Object} [options]
     * @param {DocumentMeta} [options.metadata]
     * @param {Record<string, string | number>} [options.variables]
     */
    constructor(options = {}) {
        /** @type {DocumentMeta} */
        this.metadata = options.metadata || {};

        /** @type {Record<string, string | number>} */
        this.variables = options.variables || {};

        /** @type {BaseNode} */
        this.root = new ContainerNode({ label: "document" });
    }

    // =========================================================================
    // Metadata
    // =========================================================================

    /**
     * Set document title
     * @param {string} title
     * @returns {this}
     */
    setTitle(title) {
        this.metadata.title = title;
        return this;
    }

    /**
     * Set document author
     * @param {string} author
     * @returns {this}
     */
    setAuthor(author) {
        this.metadata.author = author;
        return this;
    }

    /**
     * Set metadata field
     * @param {keyof DocumentMeta} key
     * @param {string} value
     * @returns {this}
     */
    setMeta(key, value) {
        // @ts-ignore
        this.metadata[key] = value;
        return this;
    }

    /**
     * Set custom metadata
     * @param {string} key
     * @param {string} value
     * @returns {this}
     */
    setCustomMeta(key, value) {
        if (!this.metadata.custom) {
            this.metadata.custom = {};
        }
        /** @type {unknown} */ (this.metadata.custom)[key] = value;
        return this;
    }

    // =========================================================================
    // Variables
    // =========================================================================

    /**
     * Set variable
     * @param {string} name
     * @param {string | number} value
     * @returns {this}
     */
    setVariable(name, value) {
        this.variables[name] = value;
        return this;
    }

    /**
     * Get variable
     * @param {string} name
     * @returns {string | number | undefined}
     */
    getVariable(name) {
        return this.variables[name];
    }

    /**
     * Check if variable exists
     * @param {string} name
     * @returns {boolean}
     */
    hasVariable(name) {
        return Object.prototype.hasOwnProperty.call(this.variables, name);
    }

    // =========================================================================
    // Content Management
    // =========================================================================

    /**
     * Append node to document
     * @param {BaseNode} node
     * @returns {this}
     */
    append(node) {
        this.root.appendChild(node);
        return this;
    }

    /**
     * Append multiple nodes
     * @param {BaseNode[]} nodes
     * @returns {this}
     */
    appendAll(nodes) {
        this.root.appendChildren(nodes);
        return this;
    }

    /**
     * Get all children
     * @returns {BaseNode[]}
     */
    getChildren() {
        return this.root.children;
    }

    /**
     * Clear all content
     * @returns {this}
     */
    clear() {
        this.root.clearChildren();
        return this;
    }

    /**
     * Check if document has content
     * @returns {boolean}
     */
    hasContent() {
        return this.root.hasChildren();
    }

    // =========================================================================
    // Traversal Delegates
    // =========================================================================

    /**
     * Walk all nodes
     * @param {(node: BaseNode, depth: number, index: number) => boolean | void} visitor
     * @returns {boolean}
     */
    walk(visitor) {
        return this.root.walk(visitor);
    }

    /**
     * Find all nodes matching predicate
     * @param {(node: BaseNode) => boolean} predicate
     * @returns {BaseNode[]}
     */
    findAll(predicate) {
        return this.root.findAll(predicate);
    }

    /**
     * Find first node matching predicate
     * @param {(node: BaseNode) => boolean} predicate
     * @returns {BaseNode | undefined}
     */
    findFirst(predicate) {
        return this.root.findFirst(predicate);
    }

    /**
     * Find node by ID
     * @param {string} id
     * @returns {BaseNode | undefined}
     */
    findById(id) {
        return this.root.findById(id);
    }

    /**
     * Find all nodes of type
     * @param {import("../types/core.mjs").NodeType} type
     * @returns {BaseNode[]}
     */
    findByType(type) {
        return this.root.findByType(type);
    }

    /**
     * Transform document
     * @param {(node: BaseNode) => BaseNode | BaseNode[] | null} visitor
     * @returns {this}
     */
    transform(visitor) {
        const newRoot = this.root.transform(visitor);
        if (newRoot) {
            this.root = newRoot;
        }
        return this;
    }

    // =========================================================================
    // Serialization
    // =========================================================================

    /**
     * Convert to plain object
     * @returns {Record<string, unknown>}
     */
    toJSON() {
        return {
            type: "document",
            metadata: this.metadata,
            variables: this.variables,
            root: this.root.toJSON()
        };
    }

    /**
     * Clone document
     * @returns {BaseDocument}
     */
    clone() {
        const doc = new BaseDocument({
            metadata: { ...this.metadata },
            variables: { ...this.variables }
        });
        doc.root = this.root.clone();
        return doc;
    }
}

// =============================================================================
// ProseDocument
// =============================================================================

/**
 * Document optimized for prose/narrative content
 */
export class ProseDocument extends BaseDocument {
    /**
     * @param {Object} [options]
     * @param {DocumentMeta} [options.metadata]
     * @param {Record<string, string | number>} [options.variables]
     * @param {PageConfig} [options.pageConfig]
     * @param {HeaderFooterConfig[]} [options.headerFooters]
     */
    constructor(options = {}) {
        super(options);

        /** @type {PageConfig} */
        this.pageConfig = options.pageConfig || {};

        /** @type {HeaderFooterConfig[]} */
        this.headerFooters = options.headerFooters || [];
    }

    /**
     * Set page size
     * @param {import("../types/core.mjs").PageSize} size
     * @returns {this}
     */
    setPageSize(size) {
        this.pageConfig.size = size;
        return this;
    }

    /**
     * Set page orientation
     * @param {import("../types/core.mjs").PageOrientation} orientation
     * @returns {this}
     */
    setOrientation(orientation) {
        this.pageConfig.orientation = orientation;
        return this;
    }

    /**
     * Set page margins
     * @param {import("../types/core.mjs").Margins} margins
     * @returns {this}
     */
    setMargins(margins) {
        this.pageConfig.margins = margins;
        return this;
    }

    /**
     * Add header configuration
     * @param {HeaderFooterConfig} config
     * @returns {this}
     */
    addHeader(config) {
        this.headerFooters.push({ ...config, location: "header" });
        return this;
    }

    /**
     * Add footer configuration
     * @param {HeaderFooterConfig} config
     * @returns {this}
     */
    addFooter(config) {
        this.headerFooters.push({ ...config, location: "footer" });
        return this;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.type = "prose-document";
        obj.pageConfig = this.pageConfig;
        if (this.headerFooters.length > 0) {
            obj.headerFooters = this.headerFooters;
        }
        return obj;
    }

    /** @override */
    clone() {
        const doc = new ProseDocument({
            metadata: { ...this.metadata },
            variables: { ...this.variables },
            pageConfig: { ...this.pageConfig },
            headerFooters: this.headerFooters.map((h) => ({ ...h }))
        });
        doc.root = this.root.clone();
        return doc;
    }
}

// =============================================================================
// TabularDocument
// =============================================================================

/**
 * @typedef {Object} SheetConfig
 * @property {string} name
 * @property {number} [index]
 * @property {boolean} [hidden]
 * @property {string} [tabColor]
 */

/**
 * Document optimized for tabular/spreadsheet content
 */
export class TabularDocument extends BaseDocument {
    /**
     * @param {Object} [options]
     * @param {DocumentMeta} [options.metadata]
     * @param {Record<string, string | number>} [options.variables]
     * @param {SheetConfig[]} [options.sheets]
     */
    constructor(options = {}) {
        super(options);

        /** @type {SheetConfig[]} */
        this.sheets = options.sheets || [{ name: "Sheet1", index: 0 }];

        /** @type {number} */
        this.activeSheet = 0;
    }

    /**
     * Add sheet
     * @param {string} name
     * @param {Omit<SheetConfig, "name">} [config]
     * @returns {number} - Sheet index
     */
    addSheet(name, config = {}) {
        const index = this.sheets.length;
        this.sheets.push({ ...config, name, index });
        return index;
    }

    /**
     * Get sheet by name
     * @param {string} name
     * @returns {SheetConfig | undefined}
     */
    getSheet(name) {
        for (let i = 0, len = this.sheets.length; i < len; i++) {
            if (this.sheets[i].name === name) {
                return this.sheets[i];
            }
        }
        return undefined;
    }

    /**
     * Set active sheet
     * @param {number | string} sheet
     * @returns {this}
     */
    setActiveSheet(sheet) {
        if (typeof sheet === "string") {
            for (let i = 0, len = this.sheets.length; i < len; i++) {
                if (this.sheets[i].name === sheet) {
                    this.activeSheet = i;
                    break;
                }
            }
        } else {
            this.activeSheet = sheet;
        }
        return this;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.type = "tabular-document";
        obj.sheets = this.sheets;
        obj.activeSheet = this.activeSheet;
        return obj;
    }

    /** @override */
    clone() {
        const doc = new TabularDocument({
            metadata: { ...this.metadata },
            variables: { ...this.variables },
            sheets: this.sheets.map((s) => ({ ...s }))
        });
        doc.activeSheet = this.activeSheet;
        doc.root = this.root.clone();
        return doc;
    }
}

// =============================================================================
// LegalDocument
// =============================================================================

/**
 * @typedef {Object} LegalDocumentMeta
 * @property {string} [jurisdiction]
 * @property {string} [governingLaw]
 * @property {string} [effectiveDate]
 * @property {string} [executionDate]
 * @property {string} [version]
 * @property {string} [status] - draft, executed, amended, etc.
 * @property {string[]} [parties]
 */

/**
 * Document optimized for legal instruments
 */
export class LegalDocument extends ProseDocument {
    /**
     * @param {Object} [options]
     * @param {DocumentMeta} [options.metadata]
     * @param {Record<string, string | number>} [options.variables]
     * @param {PageConfig} [options.pageConfig]
     * @param {HeaderFooterConfig[]} [options.headerFooters]
     * @param {LegalDocumentMeta} [options.legalMeta]
     */
    constructor(options = {}) {
        super(options);

        /** @type {LegalDocumentMeta} */
        this.legalMeta = options.legalMeta || {};
    }

    /**
     * Set jurisdiction
     * @param {string} jurisdiction
     * @returns {this}
     */
    setJurisdiction(jurisdiction) {
        this.legalMeta.jurisdiction = jurisdiction;
        return this;
    }

    /**
     * Set governing law
     * @param {string} law
     * @returns {this}
     */
    setGoverningLaw(law) {
        this.legalMeta.governingLaw = law;
        return this;
    }

    /**
     * Set effective date
     * @param {string} date
     * @returns {this}
     */
    setEffectiveDate(date) {
        this.legalMeta.effectiveDate = date;
        return this;
    }

    /**
     * Set parties
     * @param {string[]} parties
     * @returns {this}
     */
    setParties(parties) {
        this.legalMeta.parties = parties;
        return this;
    }

    /**
     * Add party
     * @param {string} party
     * @returns {this}
     */
    addParty(party) {
        if (!this.legalMeta.parties) {
            this.legalMeta.parties = [];
        }
        this.legalMeta.parties.push(party);
        return this;
    }

    /**
     * Set document status
     * @param {string} status
     * @returns {this}
     */
    setStatus(status) {
        this.legalMeta.status = status;
        return this;
    }

    /** @override */
    toJSON() {
        const obj = super.toJSON();
        obj.type = "legal-document";
        obj.legalMeta = this.legalMeta;
        return obj;
    }

    /** @override */
    clone() {
        const doc = new LegalDocument({
            metadata: { ...this.metadata },
            variables: { ...this.variables },
            pageConfig: { ...this.pageConfig },
            headerFooters: this.headerFooters.map((h) => ({ ...h })),
            legalMeta: { ...this.legalMeta }
        });
        doc.root = this.root.clone();
        return doc;
    }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create base document
 * @param {Object} [options]
 * @returns {BaseDocument}
 */
export function createDocument(options) {
    return new BaseDocument(options);
}

/**
 * Create prose document
 * @param {Object} [options]
 * @returns {ProseDocument}
 */
export function createProseDocument(options) {
    return new ProseDocument(options);
}

/**
 * Create tabular document
 * @param {Object} [options]
 * @returns {TabularDocument}
 */
export function createTabularDocument(options) {
    return new TabularDocument(options);
}

/**
 * Create legal document
 * @param {Object} [options]
 * @returns {LegalDocument}
 */
export function createLegalDocument(options) {
    return new LegalDocument(options);
}
