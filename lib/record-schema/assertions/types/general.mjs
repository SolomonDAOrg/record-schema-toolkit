/**
 * Type declarations for the corpus assertion layer.
 * @module record-schema/assertions/types/general
 */

/**
 * @typedef {{ kind: "child", name: string }
 *   | { kind: "descend", name: string }
 *   | { kind: "descend_all" }
 *   | { kind: "each" }
 *   | { kind: "index", index: number }} PathSegment
 */

/**
 * @typedef {object} PathMatch
 * @property {string} path
 * @property {unknown} value
 * @property {unknown} parent
 * @property {string | number | null} key
 */

/**
 * @typedef {Record<string, unknown> | boolean} Predicate
 */

/**
 * @typedef {Record<string, unknown> | string | number | boolean | null} Condition
 */

/**
 * @typedef {Record<string, unknown>} TemplateContext
 */

/**
 * @typedef {{ kind: "number" | "string" | "name" | "punct", text: string }} Token
 */

/**
 * @typedef {object} SourceDefinition
 * @property {string | string[]} [include]
 * @property {string | string[]} [exclude]
 * @property {"auto" | "yaml" | "json" | "markdown" | "text" | "none"} [parse]
 * @property {string | string[]} [doc_types]
 * @property {string | string[]} [schema_ids]
 * @property {string | string[]} [series]
 */

/**
 * @typedef {object} CorpusUnit
 * @property {string} file
 * @property {string} base_name
 * @property {string} stem
 * @property {string} extension
 * @property {string | null} record
 * @property {string | null} series
 * @property {string | null} doc_type
 * @property {string | null} schema_id
 * @property {unknown} data
 * @property {Uint8Array} bytes
 * @property {string} text
 * @property {string[]} lines
 */

/**
 * @typedef {object} SelectorRow
 * @property {CorpusUnit} unit
 * @property {PathMatch} match
 * @property {unknown} value
 * @property {Record<string, unknown>} bindings
 */

/**
 * @typedef {Record<string, any> & {
 *   id: string,
 *   kind: string,
 *   message?: string,
 *   severity?: string,
 *   enabled?: boolean,
 *   source_pack?: string
 * }} AssertionRule
 */

/**
 * @typedef {object} ResolvedPack
 * @property {string | null} source
 * @property {string[]} pack_ids
 * @property {string | null} default_source
 * @property {Record<string, SourceDefinition>} sources
 * @property {Record<string, unknown>} selectors
 * @property {Record<string, unknown>} tables
 * @property {Record<string, unknown>} languages
 * @property {Record<string, unknown>} reports
 * @property {AssertionRule[]} rules
 */

/**
 * @typedef {object} AssertionFinding
 * @property {string} severity
 * @property {string} code
 * @property {string} rule
 * @property {string | null} file
 * @property {string | null} path
 * @property {string} message
 */

/**
 * @typedef {object} ReachNode
 * @property {SelectorRow} row
 * @property {string[]} aliases
 * @property {unknown} origin
 * @property {unknown} group
 * @property {unknown} context
 */

/**
 * @typedef {object} ReachRow
 * @property {string} key
 * @property {boolean} reached
 * @property {string} tier
 * @property {ReachNode} node
 */

/**
 * @typedef {object} ReachBaseline
 * @property {string | null} file
 * @property {Map<string, Record<string, unknown>>} entries
 * @property {string[]} categories
 */

/**
 * @typedef {object} ReachAnalysis
 * @property {ReachRow[]} rows
 * @property {ReachBaseline} baseline
 */

export {};
