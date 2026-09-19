import { layoutPageComposition } from '../../layout/page-composition/layout.mjs';
import { layoutPlainText } from '../../../pdf/text-layout.mjs';

/** @typedef {import('../../layout/page-composition/types.mjs').PageComposition} PageComposition */
/** @typedef {import('../../types/core.mjs').ComposedSection} ComposedSection */
/** @typedef {import('../TwoPassPdfRenderer.mjs').TwoPassPdfRenderer} TwoPassPdfRenderer */

/**
 * Compose named Markdown blocks using the native font and text renderer.
 * Overflow aborts output rather than clipping, dropping or shrinking source text.
 * @param {TwoPassPdfRenderer} renderer
 * @param {ReadonlyArray<ComposedSection>} sections
 * @param {PageComposition} configuration
 * @returns {Uint8Array}
 */
export function renderPageComposition(renderer, sections, configuration) {
    const state = renderer.initializeState();
    const sources = layoutPageComposition(configuration, sections, state.pageWidth, state.pageHeight, node => renderer.extractPlainText(node));
    const sectionId = sections[0].id;
    const page = renderer.newPage(state, sectionId);
    const builder = page.contentBuilder;
    for (const decoration of configuration.decorations ?? []) {
        renderer.drawFilledRect(builder, decoration.x, state.pageHeight - decoration.top - decoration.height, decoration.width, decoration.height, decoration.fill);
    }
    for (const region of configuration.regions) {
        const source = sources.get(region.sourceHeading);
        const bottom = state.pageHeight - region.top - region.height;
        state.margins = {left: region.x, right: state.pageWidth - region.x - region.width, top: region.top, bottom: bottom - region.fontSize * (region.lineSpacing ?? 1.3) * 2};
        state.contentWidth = region.width;
        state.contentHeight = region.height;
        state.currentY = state.pageHeight - region.top;
        state.lastNodeType = null;
        state.lastInkBottomY = null;
        if (region.showHeading === true) {
            const size = region.headingFontSize ?? 8;
            const font = renderer.getFont(state, true);
            const heading = layoutPlainText(source.heading, region.width, font, size, size * 1.2);
            state.currentY -= size;
            for (const line of heading.lines) {
                renderer.renderTextAt(builder, state, line, region.x, state.currentY, size, font, 'left', region.headingColor ?? region.color);
                state.currentY -= size * 1.2;
            }
            state.currentY += size * 1.2;
            state.currentY -= region.headingGap ?? 7;
        }
        state.currentY -= region.fontSize;
        for (let index = 0; index < source.nodes.length; index++) {
            const runs = renderer.buildInlineRuns(source.nodes[index]).map(run => ({
                ...run,
                bold: region.bold ?? run.bold,
                color: run.color ?? region.color
            }));
            state.currentY = renderer.renderInlineRunsWrapped(runs, state, sectionId, region.x, state.currentY, region.width, region.fontSize, region.lineSpacing ?? 1.3);
            const inkBottom = state.currentY + region.fontSize * (region.lineSpacing ?? 1.3) - region.fontSize * 0.35;
            if (state.currentPage !== page || inkBottom < bottom) {
                throw new Error('Page composition overflow in source heading: ' + source.heading);
            }
            if (index + 1 < source.nodes.length) state.currentY -= region.paragraphGap ?? 4;
        }
    }
    renderer.renumberPages(state);
    renderer.finalizeInternalLinks(state);
    return renderer.buildPdf(state);
}
