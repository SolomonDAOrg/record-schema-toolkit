/**
 * @typedef {Object} TableReportSection
 * @property {'table'} kind
 * @property {string} title
 * @property {Record<string, unknown>[]} rows
 * @property {Record<string, Record<string, unknown>[]>} details
 */

/**
 * @typedef {Object} ReachSummaryRow
 * @property {string} rule
 * @property {number} nodes
 * @property {number} reached
 * @property {number} unreachable
 * @property {number} accepted
 * @property {Record<string, number>} tiers
 * @property {Record<string, number>} categories
 */

/**
 * @typedef {Object} ReachSummarySection
 * @property {'reach_summary'} kind
 * @property {ReachSummaryRow[]} rows
 */

/**
 * @typedef {Object} ReachCatalogueSection
 * @property {'reach_catalogue'} kind
 * @property {{ label: string, total: number, realised: number, weak: { member: string, tier: string }[] }[]} rows
 */

/**
 * @typedef {Object} TextReportSection
 * @property {'text'} kind
 * @property {string} text
 */

/** @typedef {TableReportSection | ReachSummarySection | ReachCatalogueSection | TextReportSection} ReportSection */
export {};
