import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutPageTracking } from '../../../lib/pdf/page-tracking/layout.mjs';
import { renderPageTracking } from '../../../lib/pdf/page-tracking/render.mjs';

const context = { pageWidth: 595, pageHeight: 842, rightMargin: 64, pageNumber: 1, totalPages: 12, documentId: 'CON-00002/0.7' };

test('tracking is opt-in and uses physical page counts', () => {
    assert.equal(layoutPageTracking({}, context), null);
    const result = layoutPageTracking({ enabled: true }, context);
    assert.equal(result.payload, 'CON-00002/0.7|1/12');
    assert.equal(result.x, 583);
    assert.equal(result.y, 24);
    assert.equal(result.quietZone, 6);
    assert.ok(result.x - result.height >= 595 - 64);
    assert.ok(result.y + result.width <= 842);
});

test('rotated vector bars have a clear quiet zone and a readable matching identifier', () => {
    const result = layoutPageTracking({ enabled: true }, context);
    const stream = renderPageTracking(result, 'F1');
    assert.match(stream, /0 1 -1 0 583 24 cm/);
    assert.match(stream, /\/Artifact BMC/);
    assert.match(stream, /\(CON-00002\/0.7\|1\/12\) Tj/);
    const rectangles = [...stream.matchAll(/([0-9.]+) ([0-9.]+) ([0-9.]+) ([0-9.]+) re/g)];
    const bars = rectangles.slice(1);
    assert.equal(Number(bars[0][1]), result.quietZone);
    const last = bars.at(-1);
    assert.ok(Math.abs(Number(last[1]) + Number(last[3]) + result.quietZone - result.width) < 0.001);
});

test('invalid geometry, identifiers and insufficient margin are rejected', () => {
    for (const configuration of [
        { moduleWidth: 0 }, { barHeight: -1 }, { fontSize: NaN },
        { quietZoneModules: 9 }, { rightInset: -1 }, { bottomInset: 900 },
        { identifier: 'X'.repeat(300) }, { identifier: '' }
    ]) assert.throws(() => layoutPageTracking({ enabled: true, ...configuration }, context), RangeError);
    assert.throws(() => {
        // @ts-expect-error Exercise rejection of an unsupported symbology at the public boundary.
        layoutPageTracking({ enabled: true, symbology: 'qr' }, context);
    }, RangeError);
    for (const overrides of [{ rightMargin: 20 }, { pageNumber: 0 }, { totalPages: 0 }, { pageHeight: NaN }]) {
        assert.throws(() => layoutPageTracking({ enabled: true }, { ...context, ...overrides }), RangeError);
    }
});

test('suppressed labels leave vector bars and preserve both quiet zones', () => {
    const result = layoutPageTracking({ enabled: true, showText: false }, context);
    assert.equal(result.barOffset, 0);
    assert.equal(result.height, 14);
    assert.doesNotMatch(renderPageTracking(result, 'F1'), /Tj/);
});
