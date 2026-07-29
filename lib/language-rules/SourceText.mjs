/**
 * Source text helpers for language rule diagnostics and edits.
 * @module language-rules/SourceText
 */

/**
 * @typedef {object} SourcePosition
 * @property {number} line
 * @property {number} column
 */

/**
 * @typedef {object} SourceRange
 * @property {number} start
 * @property {number} end
 */

/**
 * @typedef {object} TextEdit
 * @property {number} start
 * @property {number} end
 * @property {string} text
 */

/**
 * @param {string} text
 * @returns {number[]}
 */
export function createLineStarts(text) {
    /** @type {number[]} */
    const lineStarts = [0];
    for (let i = 0, len = text.length; i < len; i++) {
        if (text.charCodeAt(i) === 10) {
            lineStarts.push(i + 1);
        }
    }
    return lineStarts;
}

/**
 * @param {number[]} lineStarts
 * @param {number} offset
 * @returns {SourcePosition}
 */
export function offsetToPosition(lineStarts, offset) {
    let low = 0;
    let high = lineStarts.length - 1;
    let found = 0;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const value = lineStarts[mid];
        if (value <= offset) {
            found = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return {
        line: found + 1,
        column: offset - lineStarts[found] + 1
    };
}

/**
 * @param {string} text
 * @param {number[]} lineStarts
 * @param {number} lineIndex
 * @returns {SourceRange}
 */
export function getLineRange(text, lineStarts, lineIndex) {
    const start = lineStarts[lineIndex] ?? text.length;
    const next = lineStarts[lineIndex + 1];
    let end = typeof next === "number" ? next - 1 : text.length;
    if (end > start && text.charCodeAt(end - 1) === 13) {
        end -= 1;
    }
    return { start, end };
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function splitLines(text) {
    return text.split(/\r?\n/);
}

/**
 * @param {string} text
 * @param {TextEdit[]} edits
 * @returns {{ text: string, applied: number, skipped: number }}
 */
export function applyTextEdits(text, edits) {
    const sorted = edits
        .slice()
        .sort((a, b) => b.start - a.start || b.end - a.end);
    let current = text;
    let previousStart = text.length + 1;
    let applied = 0;
    let skipped = 0;
    for (let i = 0, len = sorted.length; i < len; i++) {
        const edit = sorted[i];
        if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end)) {
            skipped += 1;
            continue;
        }
        if (edit.start < 0 || edit.end < edit.start || edit.end > text.length) {
            skipped += 1;
            continue;
        }
        if (edit.end > previousStart) {
            skipped += 1;
            continue;
        }
        current =
            current.slice(0, edit.start) + edit.text + current.slice(edit.end);
        previousStart = edit.start;
        applied += 1;
    }
    return { text: current, applied, skipped };
}

/**
 * @param {string} text
 * @param {number} start
 * @param {number} [maximumLength]
 * @returns {string}
 */
export function excerptAt(text, start, maximumLength = 96) {
    const safeStart = Math.max(0, Math.min(text.length, start));
    const end = Math.min(text.length, safeStart + maximumLength);
    return text.slice(safeStart, end).replace(/\s+/g, " ").trim();
}
