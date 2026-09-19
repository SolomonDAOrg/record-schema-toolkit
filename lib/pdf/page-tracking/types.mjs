/**
 * @typedef {Object} PageTrackingConfig
 * @property {boolean} [enabled=false]
 * @property {boolean} [suppressCover=false] - Omit tracking on cover and dust-cover pages.
 * @property {boolean} [suppressSigning=true] - Omit tracking on signing pages.
 * @property {'code128-b'} [symbology='code128-b']
 * @property {string} [identifier] - Defaults to the renderer's documentId variable.
 * @property {number} [moduleWidth=0.6] - Narrow module width in PDF points.
 * @property {number} [barHeight=14] - Bar height before rotation, in points.
 * @property {number} [quietZoneModules=10] - Clear modules at each end.
 * @property {number} [rightInset=12] - Distance from the paper's right edge, in points.
 * @property {number} [bottomInset=24] - Distance from the paper's bottom edge, in points.
 * @property {boolean} [showText=true]
 * @property {number} [fontSize=5]
 */

/**
 * @typedef {Object} PageTrackingContext
 * @property {number} pageWidth
 * @property {number} pageHeight
 * @property {number} rightMargin
 * @property {number} pageNumber - Physical page number, including covers.
 * @property {number} totalPages - Physical page count, including covers.
 * @property {string} documentId
 */

/**
 * @typedef {Object} PageTrackingLayout
 * @property {string} payload
 * @property {number} width
 * @property {number} height
 * @property {number} moduleWidth
 * @property {number} barHeight
 * @property {number} quietZone
 * @property {number} barOffset
 * @property {number} fontSize
 * @property {boolean} showText
 * @property {number} x
 * @property {number} y
 * @property {number[]} widths
 */
export {};
