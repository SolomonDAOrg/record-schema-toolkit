import { encodeCode128B } from '../barcodes/code128.mjs';
import { measureTextWidth } from '../document.mjs';

/** @typedef {import('./types.mjs').PageTrackingConfig} PageTrackingConfig */
/** @typedef {import('./types.mjs').PageTrackingContext} PageTrackingContext */
/** @typedef {import('./types.mjs').PageTrackingLayout} PageTrackingLayout */

/**
 * Place a counterclockwise quarter-turn mark inside the right paper margin.
 * @param {PageTrackingConfig} configuration
 * @param {PageTrackingContext} context
 * @returns {PageTrackingLayout | null}
 */
export function layoutPageTracking(configuration, context) {
    if (!configuration.enabled) return null;
    if ((configuration.symbology ?? 'code128-b') !== 'code128-b') {
        throw new RangeError('Unsupported page tracking symbology');
    }
    for (const value of [context.pageWidth, context.pageHeight, context.rightMargin]) {
        if (!Number.isFinite(value) || value <= 0) throw new RangeError('Invalid page tracking geometry');
    }
    if (context.rightMargin > context.pageWidth) throw new RangeError('Right margin exceeds page width');
    const moduleWidth = configuration.moduleWidth ?? 0.6;
    const barHeight = configuration.barHeight ?? 14;
    const quietZoneModules = configuration.quietZoneModules ?? 10;
    const rightInset = configuration.rightInset ?? 12;
    const bottomInset = configuration.bottomInset ?? 24;
    const fontSize = configuration.fontSize ?? 5;
    const showText = configuration.showText ?? true;
    for (const [name, value] of Object.entries({ moduleWidth, barHeight, fontSize })) {
        if (!Number.isFinite(value) || value <= 0) throw new RangeError(name + ' must be positive');
    }
    for (const [name, value] of Object.entries({ rightInset, bottomInset })) {
        if (!Number.isFinite(value) || value < 0) throw new RangeError(name + ' must be nonnegative');
    }
    if (!Number.isInteger(quietZoneModules) || quietZoneModules < 10) {
        throw new RangeError('Page tracking requires at least ten quiet-zone modules');
    }
    if (!Number.isInteger(context.pageNumber) || !Number.isInteger(context.totalPages) ||
        context.pageNumber < 1 || context.pageNumber > context.totalPages) {
        throw new RangeError('Invalid physical page count for tracking');
    }
    const identifier = configuration.identifier ?? context.documentId;
    if (!identifier) throw new RangeError('Page tracking requires a document identifier');
    const payload = identifier + '|' + context.pageNumber + '/' + context.totalPages;
    const encoded = encodeCode128B(payload);
    const quietZone = quietZoneModules * moduleWidth;
    const width = encoded.moduleCount * moduleWidth + 2 * quietZone;
    const barOffset = showText ? fontSize + 3 : 0;
    const height = barHeight + barOffset;
    if (rightInset + height > context.rightMargin || rightInset + height > context.pageWidth ||
        bottomInset + width > context.pageHeight) {
        throw new RangeError('Page tracking mark does not fit within the right paper margin');
    }
    if (showText && measureTextWidth(payload, 'Helvetica', fontSize) > width - 2 * quietZone) {
        throw new RangeError('Page tracking label exceeds the barcode width');
    }
    return { payload, width, height, moduleWidth, barHeight, quietZone, barOffset, fontSize,
        showText, x: context.pageWidth - rightInset, y: bottomInset, widths: encoded.widths };
}
