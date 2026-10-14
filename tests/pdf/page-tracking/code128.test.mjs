import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCode128B } from '../../../lib/pdf/barcodes/code128.mjs';

test('Code 128-B start, data, weighted check symbol and stop', () => {
    const result = encodeCode128B('AB');
    assert.deepEqual(result.symbols, [104, 33, 34, 102, 106]);
    assert.equal(result.widths.join(''), '2112141113231311234111312331112');
    assert.equal(result.moduleCount, 57);
    assert.deepEqual(encodeCode128B('biz').symbols, [104, 66, 73, 90, 71, 106]);
});

test('all printable ASCII characters retain their Code 128-B values', () => {
    const text = Array.from({ length: 95 }, (_, index) => String.fromCharCode(index + 32)).join('');
    const result = encodeCode128B(text);
    assert.deepEqual(result.symbols.slice(1, -2), Array.from({ length: 95 }, (_, index) => index));
    assert.equal(result.moduleCount, (text.length + 2) * 11 + 13);
    assert.ok(result.widths.every(width => width >= 1 && width <= 4));
});

test('control characters and Unicode are rejected rather than silently recoded', () => {
    for (const input of ['', 'a\nb', '\x1f', '\x7f', 'café']) {
        assert.throws(() => encodeCode128B(input), RangeError);
    }
});
