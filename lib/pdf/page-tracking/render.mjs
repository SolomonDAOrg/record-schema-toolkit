import { PdfContentStreamBuilder } from '../content-stream.mjs';

/** @typedef {import('./types.mjs').PageTrackingLayout} PageTrackingLayout */

/**
 * Paint a vector tracking mark after pagination, independently of running furniture.
 * @param {PageTrackingLayout} layout
 * @param {string} fontResource
 * @returns {string}
 */
export function renderPageTracking(layout, fontResource) {
    const stream = new PdfContentStreamBuilder();
    stream.saveState().beginArtifact().transform(0, 1, -1, 0, layout.x, layout.y);
    stream.setFillColor(1, 1, 1).rectangle(0, 0, layout.width, layout.height).fill();
    stream.setFillColor(0, 0, 0);
    let position = layout.quietZone;
    for (let index = 0; index < layout.widths.length; index++) {
        const width = layout.widths[index] * layout.moduleWidth;
        if (index % 2 === 0) {
            stream.rectangle(position, layout.barOffset, width, layout.barHeight).fill();
        }
        position += width;
    }
    if (layout.showText) {
        stream.beginText().setFont(fontResource, layout.fontSize)
            .setTextMatrix(1, 0, 0, 1, layout.quietZone, 1.5).showText(layout.payload).endText();
    }
    stream.endMarkedContent().restoreState();
    return stream.build();
}
