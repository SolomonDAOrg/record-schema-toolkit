/**
 * True redaction: remove text drawn inside given rectangles (so it is no longer
 * present or extractable), paint an opaque box over each region, and rewrite the
 * whole document — the original content is discarded rather than left behind in
 * a previous revision.
 *
 * A content-stream interpreter tracks the CTM (cm, q/Q) and text matrices
 * (BT, Tm, Td/TD/T*) and the font size (Tf); text-showing operators whose
 * estimated bounding box overlaps a redaction rectangle are dropped. Width is
 * intentionally over-estimated so redaction errs toward removing too much.
 * Horizontal text; no dependencies. @module Redact
 */

import { loadPdf, scanDict, getRaw } from "./reader.mjs";
import { assemblePdf, rewriteRefs, setParent } from "./merge.mjs";
import { tokenizeContent } from "./extract-text.mjs";
import { deflateBytes } from "./compress.mjs";
import { encodeUtf8 } from "./primitives.mjs";

const dec = new TextDecoder("latin1");

const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** compose(A,B): apply B then A. */
function compose(A, B) {
    return {
        a: A.a * B.a + A.c * B.b,
        b: A.b * B.a + A.d * B.b,
        c: A.a * B.c + A.c * B.d,
        d: A.b * B.c + A.d * B.d,
        e: A.a * B.e + A.c * B.f + A.e,
        f: A.b * B.e + A.d * B.f + A.f
    };
}

/** @returns {[number, number]} */
function apply(M, x, y) {
    return [M.a * x + M.c * y + M.e, M.b * x + M.d * y + M.f];
}

function translate(tx, ty) {
    return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

/** Build a matrix from the last 6 numeric operands. */
function matrixFromOperands(ops) {
    const nums = ops.filter((o) => o.t === "num").map((o) => parseFloat(o.v));
    const n = nums.slice(-6);
    if (n.length < 6) {
        return { ...IDENTITY };
    }
    return { a: n[0], b: n[1], c: n[2], d: n[3], e: n[4], f: n[5] };
}

/** Number of code bytes in a string operand (proxy for glyph count). */
function stringByteLen(tok) {
    if (tok[0] === "<") {
        return Math.ceil(tok.slice(1, -1).replace(/\s/g, "").length / 2);
    }
    // literal: rough count of the inner characters
    let count = 0;
    let i = 1;
    let depth = 1;
    while (i < tok.length && depth > 0) {
        const c = tok[i];
        if (c === "\\") {
            count = count + 1;
            i = i + 2;
        } else if (c === "(") {
            depth = depth + 1;
            count = count + 1;
            i = i + 1;
        } else if (c === ")") {
            depth = depth - 1;
            if (depth > 0) {
                count = count + 1;
            }
            i = i + 1;
        } else {
            count = count + 1;
            i = i + 1;
        }
    }
    return count;
}

/** Does the text at the current state overlap any redaction rect? */
function textInRegion(glyphCount, ctm, tm, fontSize, rects) {
    const wText = glyphCount * 0.5 * fontSize; // over-estimate favors removal
    const [sx, sy] = apply(ctm, tm.e, tm.f);
    const [ex, ey] = apply(ctm, tm.a * wText + tm.e, tm.b * wText + tm.f);
    const minX = Math.min(sx, ex);
    const maxX = Math.max(sx, ex);
    const height = fontSize * Math.abs(ctm.d * tm.d || 1);
    const yLo = Math.min(sy, ey) - height * 0.25;
    const yHi = Math.max(sy, ey) + height;
    for (let i = 0, len = rects.length; i < len; i++) {
        const r = rects[i];
        const rx2 = r.x + r.width;
        const ry2 = r.y + r.height;
        if (maxX >= r.x && minX <= rx2 && yHi >= r.y && yLo <= ry2) {
            return true;
        }
    }
    return false;
}

/**
 * Rewrite a content stream, dropping text drawn inside the rects and appending
 * an opaque box over each region.
 * @param {string} content
 * @param {{ x: number, y: number, width: number, height: number, color?: [number,number,number] }[]} rects
 * @returns {string}
 */
function redactContent(content, rects) {
    const toks = tokenizeContent(content);
    let ctm = { ...IDENTITY };
    /** @type {any[]} */
    const ctmStack = [];
    let tm = { ...IDENTITY };
    let tlm = { ...IDENTITY };
    let fontSize = 1;
    let leading = 0;
    /** @type {any[]} */
    let ops = [];
    /** @type {string[]} */
    const out = [];
    const emit = () => {
        for (let i = 0; i < ops.length; i++) {
            out.push(ops[i].v);
        }
    };

    for (let i = 0, len = toks.length; i < len; i++) {
        const tk = toks[i];
        if (tk.t !== "op" || tk.v === "[" || tk.v === "]") {
            ops.push(tk);
            continue;
        }
        const op = tk.v;
        if (op === "cm") {
            ctm = compose(ctm, matrixFromOperands(ops));
            emit();
            out.push(op);
        } else if (op === "q") {
            ctmStack.push({ ...ctm });
            emit();
            out.push(op);
        } else if (op === "Q") {
            ctm = ctmStack.pop() || { ...IDENTITY };
            emit();
            out.push(op);
        } else if (op === "BT") {
            tm = { ...IDENTITY };
            tlm = { ...IDENTITY };
            emit();
            out.push(op);
        } else if (op === "Tm") {
            tm = matrixFromOperands(ops);
            tlm = { ...tm };
            emit();
            out.push(op);
        } else if (op === "Td" || op === "TD") {
            const nums = ops
                .filter((o) => o.t === "num")
                .map((o) => parseFloat(o.v));
            const tx = nums[nums.length - 2] || 0;
            const ty = nums[nums.length - 1] || 0;
            if (op === "TD") {
                leading = -ty;
            }
            tlm = compose(tlm, translate(tx, ty));
            tm = { ...tlm };
            emit();
            out.push(op);
        } else if (op === "T*") {
            tlm = compose(tlm, translate(0, -leading));
            tm = { ...tlm };
            emit();
            out.push(op);
        } else if (op === "TL") {
            const n = ops
                .filter((o) => o.t === "num")
                .map((o) => parseFloat(o.v));
            leading = n[n.length - 1] || 0;
            emit();
            out.push(op);
        } else if (op === "Tf") {
            const n = ops
                .filter((o) => o.t === "num")
                .map((o) => parseFloat(o.v));
            fontSize = n[n.length - 1] || 1;
            emit();
            out.push(op);
        } else if (op === "Tj") {
            const strTok = ops[ops.length - 1];
            const glyphs =
                strTok && strTok.t === "str" ? stringByteLen(strTok.v) : 0;
            if (!textInRegion(glyphs, ctm, tm, fontSize, rects)) {
                emit();
                out.push(op);
            }
        } else if (op === "TJ") {
            let glyphs = 0;
            for (let k = 0; k < ops.length; k++) {
                if (ops[k].t === "str") {
                    glyphs = glyphs + stringByteLen(ops[k].v);
                }
            }
            if (!textInRegion(glyphs, ctm, tm, fontSize, rects)) {
                emit();
                out.push(op);
            }
        } else if (op === "'" || op === '"') {
            tlm = compose(tlm, translate(0, -leading));
            tm = { ...tlm };
            const strTok = ops[ops.length - 1];
            const glyphs =
                strTok && strTok.t === "str" ? stringByteLen(strTok.v) : 0;
            if (textInRegion(glyphs, ctm, tm, fontSize, rects)) {
                out.push("T*"); // keep the line advance, drop the text
            } else {
                emit();
                out.push(op);
            }
        } else {
            emit();
            out.push(op);
        }
        ops = [];
    }

    // Paint an opaque box over each redacted region (default black).
    let boxes = "\nq\n";
    for (let i = 0, len = rects.length; i < len; i++) {
        const r = rects[i];
        const col = r.color || [0, 0, 0];
        boxes =
            boxes +
            col[0] +
            " " +
            col[1] +
            " " +
            col[2] +
            " rg " +
            r.x +
            " " +
            r.y +
            " " +
            r.width +
            " " +
            r.height +
            " re f\n";
    }
    boxes = boxes + "Q\n";

    return out.join(" ") + boxes;
}

/** Rewrite a stream dict's /Length and /Filter after replacing its bytes. */
function setStreamDict(dictPart, newLen, compressed) {
    let d = dictPart.replace(
        /\/Length\s+\d+(\s+\d+\s+R)?/,
        "/Length " + newLen
    );
    if (!/\/Length\s/.test(d)) {
        d = d.replace(/>>\s*$/, " /Length " + newLen + " >>");
    }
    if (compressed) {
        if (!/\/Filter/.test(d)) {
            d = d.replace(/>>\s*$/, " /Filter /FlateDecode >>");
        }
    } else {
        d = d.replace(/\/Filter\s*\/FlateDecode/, "");
    }
    return d;
}

/**
 * Redact rectangular regions on the given pages, returning a new PDF in which
 * the covered text has been removed and boxed over.
 * @param {Uint8Array} bytes
 * @param {{ page: number, x: number, y: number, width: number, height: number, color?: [number,number,number] }[]} redactions
 * @param {{ password?: string }} [options]
 * @returns {Uint8Array}
 */
export function redactRegions(bytes, redactions, options) {
    const ed = loadPdf(bytes, options);
    const { nodeIds, leafIds } = ed.getPageTree();

    /** @type {Map<number, any[]>} pageIndex -> rects */
    const byPage = new Map();
    for (let i = 0, len = redactions.length; i < len; i++) {
        const idx = redactions[i].page - 1;
        if (idx < 0 || idx >= leafIds.length) {
            throw new Error(
                "redactRegions: page " + redactions[i].page + " out of range"
            );
        }
        if (!byPage.has(idx)) {
            byPage.set(idx, []);
        }
        byPage.get(idx).push(redactions[i]);
    }

    // Compute replacement content bytes per affected content-stream object.
    /** @type {Map<number, { bytes: Uint8Array, compressed: boolean }>} */
    const contentReplacements = new Map();
    for (const [idx, rects] of byPage) {
        const pEntries = scanDict(
            ed.getObjectRaw(leafIds[idx]).dictPart,
            0
        ).entries;
        const contentsRaw = getRaw(pEntries, "Contents") || "";
        const cids = [...contentsRaw.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) =>
            parseInt(m[1], 10)
        );
        let content = "";
        for (let k = 0; k < cids.length; k++) {
            const raw = ed.getObjectRaw(cids[k]);
            content =
                content +
                dec.decode(
                    ed.decodeStreamBytes(
                        scanDict(raw.dictPart, 0).entries,
                        raw.streamBytes
                    )
                ) +
                "\n";
        }
        const redacted = encodeUtf8(redactContent(content, rects));
        const compressed = deflateBytes(redacted);
        contentReplacements.set(cids[0], {
            bytes: compressed,
            compressed: true
        });
        for (let k = 1; k < cids.length; k++) {
            contentReplacements.set(cids[k], {
                bytes: encodeUtf8(""),
                compressed: false
            });
        }
    }

    // Full-document rewrite (discarding original content) with substitution.
    const skip = new Set(nodeIds);
    skip.add(ed.rootId);
    let nextId = 3;
    /** @type {Map<number, number>} */
    const remap = new Map();
    const ids = ed.allObjectIds();
    for (let i = 0, len = ids.length; i < len; i++) {
        if (!skip.has(ids[i])) {
            remap.set(ids[i], nextId++);
        }
    }
    const remapFn = (id) => {
        const r = remap.get(id);
        return r !== undefined ? r : id;
    };

    const leafSet = new Set(leafIds);
    /** @type {{ id: number, dictPart: string, streamBytes: Uint8Array | null }[]} */
    const outObjects = [];
    /** @type {number[]} */
    const newPageIds = [];
    for (let i = 0, len = ids.length; i < len; i++) {
        const id = ids[i];
        if (skip.has(id)) {
            continue;
        }
        const raw = ed.getObjectRaw(id);
        let dictPart = rewriteRefs(raw.dictPart, remapFn);
        let streamBytes = raw.streamBytes;
        if (contentReplacements.has(id)) {
            const rep = contentReplacements.get(id);
            streamBytes = rep.bytes;
            dictPart = setStreamDict(
                dictPart,
                rep.bytes.length,
                rep.compressed
            );
        }
        if (leafSet.has(id)) {
            dictPart = setParent(dictPart, 2);
            newPageIds.push(remap.get(id));
        }
        outObjects.push({ id: remap.get(id), dictPart, streamBytes });
    }
    return assemblePdf(outObjects, newPageIds);
}

export default { redactRegions };
