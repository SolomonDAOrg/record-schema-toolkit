/**
 * @typedef {Object} PageCompositionRegion
 * @property {string} sourceHeading - Exact Markdown heading delimiting the source block.
 * @property {number} x
 * @property {number} top
 * @property {number} width
 * @property {number} height
 * @property {number} fontSize
 * @property {number} [lineSpacing]
 * @property {number} [paragraphGap]
 * @property {string} [color]
 * @property {boolean} [bold]
 * @property {boolean} [showHeading]
 * @property {number} [headingFontSize]
 * @property {number} [headingGap]
 * @property {string} [headingColor]
 */

/**
 * @typedef {Object} PageCompositionDecoration
 * @property {number} x
 * @property {number} top
 * @property {number} width
 * @property {number} height
 * @property {string} fill
 */

/**
 * @typedef {Object} PageComposition
 * @property {'fixed'} mode
 * @property {'literal' | 'fields'} [placeholderMode]
 * @property {PageCompositionRegion[]} regions
 * @property {PageCompositionDecoration[]} [decorations]
 */

/**
 * @typedef {Object} PageCompositionSource
 * @property {string} heading
 * @property {import('../../nodes/BaseNode.mjs').BaseNode[]} nodes
 */

export {};
