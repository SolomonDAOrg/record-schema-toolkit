import test from 'node:test';
import assert from 'node:assert/strict';
import { createTwoPassPdfRenderer } from '../../../lib/ast/renderers/TwoPassPdfRenderer.mjs';
import { PdfContentStreamBuilder } from '../../../lib/pdf/content-stream.mjs';
import { extractText } from '../../../lib/pdf/extract-text.mjs';
import { loadPdf, getRaw } from '../../../lib/pdf/reader.mjs';

function renderPhysicalPages(enabled, overrides = {}) {
    const renderer = createTwoPassPdfRenderer({
        pageConfig: { size: 'a4', margins: { top: 54, bottom: 54, left: 58, right: 64 } },
        variables: { documentId: 'CON-00002/0.7' },
        pageTracking: { enabled, ...overrides },
        coverConfig: { suppressHeader: true, suppressFooter: true, suppressPageNumbering: true }
    });
    const state = renderer.initializeState();
    const font = state.doc.registerFont('Helvetica');
    state.pages = [0, 1, 2].map(number => ({
        pageNumber: number,
        sectionId: number === 0 ? 'cover' : 'agreement',
        sectionPageNumber: number,
        sectionTotalPages: 2,
        contentBuilder: new PdfContentStreamBuilder().beginText().setFont(font, 12)
            .moveTextPosition(58, 740).showText(number === 0 ? 'Cover' : 'Agreement').endText(),
        headerFooterBuilder: new PdfContentStreamBuilder(),
        linkAnnotations: []
    }));
    return renderer.buildPdf(state);
}

test('final output stamps all physical pages including an unnumbered cover', () => {
    const bytes = renderPhysicalPages(true);
    const reader = loadPdf(bytes);
    const extracted = extractText(bytes);
    assert.equal(reader.pageCount(), 3);
    for (let index = 0; index < 3; index++) {
        const payload = 'CON-00002/0.7|' + (index + 1) + '/3';
        assert.equal(extracted.pages[index].split(payload).length - 1, 1);
        const page = reader.getDict(reader.getPageTree().leafIds[index]);
        assert.equal(getRaw(page.entries, 'MediaBox'), '[0 0 595 842]');
    }
});

test('cover suppression preserves physical page numbering on the body', () => {
    const text = extractText(renderPhysicalPages(true, { suppressCover: true }));
    assert.doesNotMatch(text.pages[0], /CON-00002/);
    assert.match(text.pages[1], /CON-00002\/0.7\|2\/3/);
    assert.match(text.pages[2], /CON-00002\/0.7\|3\/3/);
});

test('disabled tracking does not add a mark or change page count', () => {
    const bytes = renderPhysicalPages(false);
    assert.equal(loadPdf(bytes).pageCount(), 3);
    assert.doesNotMatch(extractText(bytes).text, /CON-00002/);
});
