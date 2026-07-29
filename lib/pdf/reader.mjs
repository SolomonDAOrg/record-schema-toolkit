/**
 * Minimal PDF reader + incremental-update writer.
 *
 * Parses unencrypted PDFs that use classic cross-reference tables (following the
 * /Prev chain) far enough to walk the page tree and edit object dictionaries,
 * then writes an incremental update: the original bytes are preserved verbatim
 * and new/changed objects, a new xref section, and a new trailer (with /Prev)
 * are appended. This is the foundation for stamping/watermarking, and later for
 * merging and signing.
 *
 * Scope: classic xref tables only (no xref/object streams), unencrypted input.
 * These are exactly what this library emits, so its own output round-trips.
 * @module Reader
 */

import {
    encodeUtf8,
    concatBytes,
    createType1Font,
    formatRef,
    escapePdfString,
    formatPdfDate
} from "./primitives.mjs";
import { inflateSync } from "node:zlib";
import { createDecryption } from "./crypt.mjs";

const dec = new TextDecoder("latin1");

// ============================================================================
// Low-level scanners (operate on a Latin-1 string; index == byte offset)
// ============================================================================

/** @param {string} c @returns {boolean} */
function isWs(c) {
    return (
        c === " " ||
        c === "\n" ||
        c === "\r" ||
        c === "\t" ||
        c === "\f" ||
        c === "\0"
    );
}

/** @param {string} c @returns {boolean} */
function isDelim(c) {
    return (
        c === "(" ||
        c === ")" ||
        c === "<" ||
        c === ">" ||
        c === "[" ||
        c === "]" ||
        c === "{" ||
        c === "}" ||
        c === "/" ||
        c === "%"
    );
}

/** @param {string} s @param {number} pos @returns {number} */
function skipWs(s, pos) {
    const n = s.length;
    while (pos < n) {
        const c = s[pos];
        if (c === "%") {
            // comment to end of line
            while (pos < n && s[pos] !== "\n" && s[pos] !== "\r") {
                pos = pos + 1;
            }
        } else if (isWs(c)) {
            pos = pos + 1;
        } else {
            break;
        }
    }
    return pos;
}

/**
 * Scan a single object value starting at pos, returning its raw text and end.
 * @param {string} s
 * @param {number} pos
 * @returns {{ raw: string, end: number }}
 */
function scanValue(s, pos) {
    pos = skipWs(s, pos);
    const start = pos;
    const c = s[pos];
    const n = s.length;

    if (c === "<" && s[pos + 1] === "<") {
        const end = scanDict(s, pos).end;
        return { raw: s.slice(start, end), end };
    }
    if (c === "[") {
        let depth = 0;
        let p = pos;
        while (p < n) {
            const ch = s[p];
            if (ch === "(") {
                p = scanLiteral(s, p);
                continue;
            }
            if (ch === "<" && s[p + 1] === "<") {
                p = scanDict(s, p).end;
                continue;
            }
            if (ch === "<") {
                p = scanHex(s, p);
                continue;
            }
            if (ch === "[") {
                depth = depth + 1;
                p = p + 1;
                continue;
            }
            if (ch === "]") {
                depth = depth - 1;
                p = p + 1;
                if (depth === 0) {
                    break;
                }
                continue;
            }
            p = p + 1;
        }
        return { raw: s.slice(start, p), end: p };
    }
    if (c === "(") {
        const end = scanLiteral(s, pos);
        return { raw: s.slice(start, end), end };
    }
    if (c === "<") {
        const end = scanHex(s, pos);
        return { raw: s.slice(start, end), end };
    }
    if (c === "/") {
        let p = pos + 1;
        while (p < n && !isWs(s[p]) && !isDelim(s[p])) {
            p = p + 1;
        }
        return { raw: s.slice(start, p), end: p };
    }
    // token (number / keyword). Read it, then check for an indirect ref "N G R".
    let p = pos;
    while (p < n && !isWs(s[p]) && !isDelim(s[p])) {
        p = p + 1;
    }
    const tok = s.slice(pos, p);
    if (/^[0-9]+$/.test(tok)) {
        const save = p;
        let q = skipWs(s, p);
        let q2 = q;
        while (q2 < n && !isWs(s[q2]) && !isDelim(s[q2])) {
            q2 = q2 + 1;
        }
        const tok2 = s.slice(q, q2);
        if (/^[0-9]+$/.test(tok2)) {
            let q3 = skipWs(s, q2);
            if (
                s[q3] === "R" &&
                (q3 + 1 >= n || isWs(s[q3 + 1]) || isDelim(s[q3 + 1]))
            ) {
                return { raw: s.slice(start, q3 + 1), end: q3 + 1 };
            }
        }
        p = save;
    }
    return { raw: s.slice(start, p), end: p };
}

/** @param {string} s @param {number} pos @returns {number} position after the closing ) */
function scanLiteral(s, pos) {
    const n = s.length;
    let depth = 0;
    let p = pos;
    while (p < n) {
        const c = s[p];
        if (c === "\\") {
            p = p + 2;
            continue;
        }
        if (c === "(") {
            depth = depth + 1;
        } else if (c === ")") {
            depth = depth - 1;
            if (depth === 0) {
                return p + 1;
            }
        }
        p = p + 1;
    }
    return p;
}

/** @param {string} s @param {number} pos @returns {number} position after the closing > */
function scanHex(s, pos) {
    const n = s.length;
    let p = pos + 1;
    while (p < n && s[p] !== ">") {
        p = p + 1;
    }
    return p + 1;
}

/**
 * Scan a dictionary into ordered key/value entries.
 * @param {string} s
 * @param {number} pos - at the opening <<
 * @returns {{ entries: { key: string, raw: string }[], end: number }}
 */
export function scanDict(s, pos) {
    let p = pos + 2; // skip <<
    /** @type {{ key: string, raw: string }[]} */
    const entries = [];
    const n = s.length;
    while (p < n) {
        p = skipWs(s, p);
        if (s[p] === ">" && s[p + 1] === ">") {
            p = p + 2;
            break;
        }
        if (s[p] !== "/") {
            // malformed; bail
            break;
        }
        // key name
        let k = p + 1;
        while (k < n && !isWs(s[k]) && !isDelim(s[k])) {
            k = k + 1;
        }
        const key = s.slice(p + 1, k);
        const val = scanValue(s, k);
        entries.push({ key, raw: val.raw });
        p = val.end;
    }
    return { entries, end: p };
}

// ============================================================================
// Document parsing
// ============================================================================

/**
 * Reconstruct data filtered with a PNG predictor (used by xref/object streams).
 * @param {Uint8Array} data - predictor-filtered rows (each prefixed by a filter byte)
 * @param {number} columns
 * @param {number} colors
 * @param {number} bpc - bits per component
 * @returns {Uint8Array}
 */
export function applyPngPredictor(data, columns, colors, bpc) {
    const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
    const rowLen = Math.ceil((colors * bpc * columns) / 8);
    /** @type {Uint8Array[]} */
    const rows = [];
    let prev = new Uint8Array(rowLen);
    let pos = 0;
    while (pos + 1 + rowLen <= data.length) {
        const ft = data[pos];
        pos = pos + 1;
        const cur = new Uint8Array(rowLen);
        for (let i = 0; i < rowLen; i++) {
            const x = data[pos + i];
            const a = i >= bpp ? cur[i - bpp] : 0;
            const b = prev[i];
            const c = i >= bpp ? prev[i - bpp] : 0;
            let v;
            if (ft === 1) {
                v = x + a;
            } else if (ft === 2) {
                v = x + b;
            } else if (ft === 3) {
                v = x + Math.floor((a + b) / 2);
            } else if (ft === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a);
                const pb = Math.abs(p - b);
                const pc = Math.abs(p - c);
                const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
                v = x + pr;
            } else {
                v = x;
            }
            cur[i] = v & 0xff;
        }
        rows.push(cur);
        prev = cur;
        pos = pos + rowLen;
    }
    return concatBytes(rows);
}

/** Read a big-endian unsigned integer of n bytes. @returns {number} */
function readUintBE(data, offset, n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
        v = v * 256 + data[offset + i];
    }
    return v;
}

/** @param {{ key: string, raw: string }[]} entries @param {string} key @returns {string | undefined} */
export function getRaw(entries, key) {
    for (let i = 0, len = entries.length; i < len; i++) {
        if (entries[i].key === key) {
            return entries[i].raw;
        }
    }
    return undefined;
}

/** @param {string} raw @returns {number | null} object id if raw is "N G R" */
function refId(raw) {
    const m = /^(\d+)\s+(\d+)\s+R$/.exec(raw.trim());
    return m ? parseInt(m[1], 10) : null;
}

/**
 * Decode a PDF string value (hex <..> or literal (..)) to raw bytes.
 * @param {string | undefined} raw
 * @returns {Uint8Array}
 */
function decodePdfStringBytes(raw) {
    if (!raw) {
        return new Uint8Array(0);
    }
    const t = raw.trim();
    if (t[0] === "<") {
        let hex = t.slice(1, t.indexOf(">")).replace(/\s/g, "");
        if (hex.length % 2 === 1) {
            hex = hex + "0";
        }
        const out = new Uint8Array(hex.length / 2);
        for (let i = 0, len = out.length; i < len; i++) {
            out[i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        return out;
    }
    if (t[0] === "(") {
        /** @type {number[]} */
        const bytes = [];
        let i = 1;
        let depth = 1;
        while (i < t.length && depth > 0) {
            const c = t[i];
            if (c === "\\") {
                const n = t[i + 1];
                const simple = { n: 10, r: 13, t: 9, b: 8, f: 12 };
                if (n in simple) {
                    bytes.push(simple[n]);
                    i = i + 2;
                } else if (n >= "0" && n <= "7") {
                    let oct = "";
                    let k = i + 1;
                    while (
                        k < t.length &&
                        oct.length < 3 &&
                        t[k] >= "0" &&
                        t[k] <= "7"
                    ) {
                        oct = oct + t[k];
                        k = k + 1;
                    }
                    bytes.push(parseInt(oct, 8) & 0xff);
                    i = k;
                } else {
                    bytes.push(n.charCodeAt(0) & 0xff);
                    i = i + 2;
                }
            } else if (c === "(") {
                depth = depth + 1;
                bytes.push(40);
                i = i + 1;
            } else if (c === ")") {
                depth = depth - 1;
                if (depth > 0) {
                    bytes.push(41);
                }
                i = i + 1;
            } else {
                bytes.push(c.charCodeAt(0) & 0xff);
                i = i + 1;
            }
        }
        return new Uint8Array(bytes);
    }
    return new Uint8Array(0);
}

/**
 * Parsed editor over a PDF byte buffer.
 */
export class PdfEditor {
    /** @param {Uint8Array} bytes @param {{ password?: string }} [options] */
    constructor(bytes, options) {
        /** @type {Uint8Array} */
        this.bytes = bytes;
        /** @type {string} */
        this.s = dec.decode(bytes);

        const sx = this.s.lastIndexOf("startxref");
        if (sx < 0) {
            throw new Error("reader: no startxref found");
        }
        const xm = /startxref\s+(\d+)/.exec(this.s.slice(sx));
        if (!xm) {
            throw new Error("reader: malformed startxref");
        }
        /** @type {number} */
        this.startxref = parseInt(xm[1], 10);

        /** @type {Map<number, number>} id -> byte offset (uncompressed objects) */
        this.offsets = new Map();
        /** @type {Map<number, { streamObjNum: number, index: number }>} id -> location in an object stream */
        this.compressed = new Map();
        /** @type {Map<number, { decStr: string, first: number, pairs: { objNum: number, offset: number }[], decodedLen: number }>} */
        this.objStmCache = new Map();
        const trailer = this.parseXrefAt(this.startxref, new Set());
        if (!trailer) {
            throw new Error("reader: could not read trailer");
        }
        /** @type {{ key: string, raw: string }[]} */
        this.trailer = trailer;

        /** @type {{ decrypt: Function, decryptStringsInObject: Function } | null} */
        this.decryptor = null;
        /** @type {number} object id of the /Encrypt dict (never decrypted) */
        this.encryptObjId = -1;
        const encRaw = getRaw(trailer, "Encrypt");
        if (encRaw !== undefined) {
            const encId = refId(encRaw);
            this.encryptObjId = encId === null ? -1 : encId;
            this.setupDecryption(encId, (options && options.password) || "");
        }

        const rootRaw = getRaw(trailer, "Root");
        const rootId = rootRaw ? refId(rootRaw) : null;
        if (rootId === null) {
            throw new Error("reader: no /Root in trailer");
        }
        /** @type {number} */
        this.rootId = rootId;

        let maxId = 0;
        for (const id of this.offsets.keys()) {
            if (id > maxId) {
                maxId = id;
            }
        }
        for (const id of this.compressed.keys()) {
            if (id > maxId) {
                maxId = id;
            }
        }
        const sizeRaw = getRaw(trailer, "Size");
        if (sizeRaw) {
            const sz = parseInt(sizeRaw.trim(), 10);
            if (!Number.isNaN(sz) && sz - 1 > maxId) {
                maxId = sz - 1;
            }
        }
        /** @type {number} */
        this.maxId = maxId;

        /** @type {string | undefined} */
        this.idRaw = getRaw(trailer, "ID");

        /** @type {Map<number, string>} objects re-serialized for the update */
        this.updated = new Map();
        /** @type {{ id: number, kind: "dict" | "stream", text: string, bytes?: Uint8Array }[]} */
        this.added = [];

        // Resolve the ordered list of page leaf object ids.
        /** @type {number[]} */
        this.pageIds = this.collectPages();
    }

    /**
     * Parse the /Encrypt dictionary and build a decryptor for the given password
     * (default empty). Throws on an incorrect password.
     * @param {number | null} encId
     * @param {string} password
     * @returns {void}
     */
    setupDecryption(encId, password) {
        if (encId === null) {
            throw new Error("reader: malformed /Encrypt reference");
        }
        const { entries } = scanDict(this.getObjectRaw(encId).dictPart, 0);
        const num = (k, d) =>
            parseInt((getRaw(entries, k) || String(d)).trim(), 10);
        const v = num("V", 0);
        const cfRaw = getRaw(entries, "CF") || "";
        let cfm = "V2";
        if (v >= 4) {
            const m = /\/CFM\s*\/(\w+)/.exec(cfRaw);
            cfm = m ? m[1] : "AESV2";
        }
        const encMetaRaw = getRaw(entries, "EncryptMetadata");
        /** @type {Uint8Array} */
        let fileId = new Uint8Array(0);
        const idRaw = getRaw(this.trailer, "ID");
        if (idRaw) {
            const first = /(<[0-9A-Fa-f\s]*>|\([^]*?\))/.exec(idRaw);
            if (first) {
                fileId = decodePdfStringBytes(first[1]);
            }
        }
        this.decryptor = createDecryption({
            v,
            r: num("R", 0),
            keyLength: num("Length", 40),
            o: decodePdfStringBytes(getRaw(entries, "O")),
            u: decodePdfStringBytes(getRaw(entries, "U")),
            oe: decodePdfStringBytes(getRaw(entries, "OE")),
            ue: decodePdfStringBytes(getRaw(entries, "UE")),
            p: num("P", 0),
            cfm: /** @type {"V2" | "AESV2" | "AESV3"} */ (cfm),
            encryptMetadata: !(encMetaRaw && /false/.test(encMetaRaw)),
            fileId,
            password
        });
    }

    /**
     * Parse the cross-reference section at an offset (classic table or xref
     * stream), following /Prev, and return the newest trailer entries.
     * @param {number} offset
     * @param {Set<number>} seen
     * @returns {{ key: string, raw: string }[] | null}
     */
    parseXrefAt(offset, seen) {
        if (seen.has(offset) || offset < 0 || offset >= this.s.length) {
            return null;
        }
        seen.add(offset);
        const p = skipWs(this.s, offset);
        if (this.s.slice(p, p + 4) === "xref") {
            return this.parseClassicXref(p + 4, seen);
        }
        return this.parseXrefStream(p, seen);
    }

    /**
     * Classic cross-reference table + trailer.
     * @param {number} p - position after the "xref" keyword
     * @param {Set<number>} seen
     * @returns {{ key: string, raw: string }[]}
     */
    parseClassicXref(p, seen) {
        const s = this.s;
        while (true) {
            p = skipWs(s, p);
            if (s.slice(p, p + 7) === "trailer") {
                p = p + 7;
                break;
            }
            const m = /^(\d+)\s+(\d+)/.exec(s.slice(p, p + 40));
            if (!m) {
                break;
            }
            const startId = parseInt(m[1], 10);
            const count = parseInt(m[2], 10);
            p = p + m[0].length;
            p = skipWs(s, p);
            for (let i = 0; i < count; i++) {
                const em = /^(\d{10})\s(\d{5})\s([nf])/.exec(
                    s.slice(p, p + 20)
                );
                if (em) {
                    const id = startId + i;
                    if (
                        em[3] === "n" &&
                        !this.offsets.has(id) &&
                        !this.compressed.has(id)
                    ) {
                        this.offsets.set(id, parseInt(em[1], 10));
                    }
                }
                p = p + 20;
            }
        }
        p = skipWs(s, p);
        const { entries } = scanDict(s, p);
        const xrefStm = getRaw(entries, "XRefStm"); // hybrid-reference file
        if (xrefStm !== undefined) {
            this.parseXrefAt(parseInt(xrefStm.trim(), 10), seen);
        }
        const prev = getRaw(entries, "Prev");
        if (prev !== undefined) {
            this.parseXrefAt(parseInt(prev.trim(), 10), seen);
        }
        return entries;
    }

    /**
     * Cross-reference stream (PDF 1.5+): a /Type /XRef object whose decoded body
     * encodes the xref entries, plus support for objects stored in object streams.
     * @param {number} p - position at "N G obj"
     * @param {Set<number>} seen
     * @returns {{ key: string, raw: string }[]}
     */
    parseXrefStream(p, seen) {
        const m = /^(\d+)\s+(\d+)\s+obj/.exec(this.s.slice(p, p + 40));
        if (!m) {
            throw new Error("reader: unrecognized cross-reference section");
        }
        p = skipWs(this.s, p + m[0].length);
        const { entries, end } = scanDict(this.s, p);
        const dictStr = this.s.slice(p, end);

        let q = skipWs(this.s, end);
        if (this.s.slice(q, q + 6) !== "stream") {
            throw new Error("reader: malformed xref stream");
        }
        q = q + 6;
        if (this.s[q] === "\r") {
            q = q + 1;
        }
        if (this.s[q] === "\n") {
            q = q + 1;
        }
        const len = this.streamLength(dictStr, q);
        const decoded = this.decodeStreamBytes(
            entries,
            this.bytes.slice(q, q + len)
        );

        // /W [w1 w2 w3]
        const wm = /\/W\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(dictStr);
        if (!wm) {
            throw new Error("reader: xref stream missing /W");
        }
        const w = [
            parseInt(wm[1], 10),
            parseInt(wm[2], 10),
            parseInt(wm[3], 10)
        ];
        const size = parseInt((getRaw(entries, "Size") || "0").trim(), 10);

        // /Index pairs (default [0 Size]).
        /** @type {number[]} */
        let index = [0, size];
        const idxRaw = getRaw(entries, "Index");
        if (idxRaw) {
            index = [...idxRaw.matchAll(/\d+/g)].map((x) => parseInt(x[0], 10));
        }

        const entryLen = w[0] + w[1] + w[2];
        let pos = 0;
        for (let s2 = 0; s2 < index.length; s2 += 2) {
            const start = index[s2];
            const count = index[s2 + 1];
            for (let i = 0; i < count; i++) {
                if (pos + entryLen > decoded.length) {
                    break;
                }
                const type = w[0] === 0 ? 1 : readUintBE(decoded, pos, w[0]);
                const f2 = readUintBE(decoded, pos + w[0], w[1]);
                const f3 = readUintBE(decoded, pos + w[0] + w[1], w[2]);
                pos = pos + entryLen;
                const id = start + i;
                if (this.offsets.has(id) || this.compressed.has(id)) {
                    continue; // newer definition already recorded
                }
                if (type === 1) {
                    this.offsets.set(id, f2);
                } else if (type === 2) {
                    this.compressed.set(id, { streamObjNum: f2, index: f3 });
                }
            }
        }

        const prev = getRaw(entries, "Prev");
        if (prev !== undefined) {
            this.parseXrefAt(parseInt(prev.trim(), 10), seen);
        }
        return entries;
    }

    /**
     * Decode a stream body: apply FlateDecode and any PNG predictor.
     * @param {{ key: string, raw: string }[]} entries
     * @param {Uint8Array} rawBytes
     * @returns {Uint8Array}
     */
    decodeStreamBytes(entries, rawBytes) {
        let data = rawBytes;
        const filter = getRaw(entries, "Filter") || "";
        if (filter.includes("FlateDecode") || filter.includes("Fl")) {
            data = new Uint8Array(inflateSync(Buffer.from(data)));
            const parms =
                getRaw(entries, "DecodeParms") || getRaw(entries, "DP") || "";
            const pm = /\/Predictor\s+(\d+)/.exec(parms);
            const predictor = pm ? parseInt(pm[1], 10) : 1;
            if (predictor >= 10) {
                const col = /\/Columns\s+(\d+)/.exec(parms);
                const colors = /\/Colors\s+(\d+)/.exec(parms);
                const bpc = /\/BitsPerComponent\s+(\d+)/.exec(parms);
                data = applyPngPredictor(
                    data,
                    col ? parseInt(col[1], 10) : 1,
                    colors ? parseInt(colors[1], 10) : 1,
                    bpc ? parseInt(bpc[1], 10) : 8
                );
            }
        }
        return data;
    }

    /**
     * Fetch an object's raw text from an object stream (/Type /ObjStm).
     * @param {number} streamObjNum
     * @param {number} index
     * @returns {string}
     */
    getFromObjStm(streamObjNum, index) {
        let cache = this.objStmCache.get(streamObjNum);
        if (!cache) {
            const off = this.offsets.get(streamObjNum);
            if (off === undefined) {
                throw new Error(
                    "reader: object stream " + streamObjNum + " missing"
                );
            }
            let p = skipWs(this.s, off);
            const m = /^(\d+)\s+(\d+)\s+obj/.exec(this.s.slice(p, p + 40));
            p = skipWs(this.s, p + m[0].length);
            const { entries, end } = scanDict(this.s, p);
            const dictStr = this.s.slice(p, end);
            let q = skipWs(this.s, end) + 6; // past "stream"
            if (this.s[q] === "\r") {
                q = q + 1;
            }
            if (this.s[q] === "\n") {
                q = q + 1;
            }
            const len = this.streamLength(dictStr, q);
            let objStmBytes = this.bytes.slice(q, q + len);
            if (this.decryptor) {
                objStmBytes = this.decryptor.decrypt(streamObjNum, objStmBytes);
            }
            const decoded = this.decodeStreamBytes(entries, objStmBytes);
            const decStr = dec.decode(decoded);
            const n = parseInt((getRaw(entries, "N") || "0").trim(), 10);
            const first = parseInt(
                (getRaw(entries, "First") || "0").trim(),
                10
            );
            /** @type {{ objNum: number, offset: number }[]} */
            const pairs = [];
            let hp = 0;
            for (let i = 0; i < n; i++) {
                const pm = /\s*(\d+)\s+(\d+)/.exec(decStr.slice(hp, hp + 60));
                if (!pm) {
                    break;
                }
                pairs.push({
                    objNum: parseInt(pm[1], 10),
                    offset: parseInt(pm[2], 10)
                });
                hp = hp + pm[0].length;
            }
            cache = { decStr, first, pairs, decodedLen: decoded.length };
            this.objStmCache.set(streamObjNum, cache);
        }
        const pair = cache.pairs[index];
        const startOff = cache.first + pair.offset;
        const endOff =
            index + 1 < cache.pairs.length
                ? cache.first + cache.pairs[index + 1].offset
                : cache.decodedLen;
        return cache.decStr.slice(startOff, endOff).trim();
    }

    /**
     * Parse an indirect object's dictionary by id.
     * @param {number} id
     * @returns {{ entries: { key: string, raw: string }[] }}
     */
    getDict(id) {
        if (this.compressed.has(id)) {
            const loc = this.compressed.get(id);
            const text = this.getFromObjStm(loc.streamObjNum, loc.index);
            const q = skipWs(text, 0);
            if (text[q] === "<" && text[q + 1] === "<") {
                return { entries: scanDict(text, q).entries };
            }
            return { entries: [] };
        }
        const off = this.offsets.get(id);
        if (off === undefined) {
            throw new Error("reader: object " + id + " not in xref");
        }
        let p = skipWs(this.s, off);
        const m = /^(\d+)\s+(\d+)\s+obj/.exec(this.s.slice(p, p + 40));
        if (!m) {
            throw new Error("reader: object " + id + " header malformed");
        }
        p = skipWs(this.s, p + m[0].length);
        if (this.s[p] !== "<" || this.s[p + 1] !== "<") {
            return { entries: [] };
        }
        return { entries: scanDict(this.s, p).entries };
    }

    /** @returns {number[]} */
    collectPages() {
        const catalog = this.getDict(this.rootId);
        const pagesRaw = getRaw(catalog.entries, "Pages");
        const pagesId = pagesRaw ? refId(pagesRaw) : null;
        if (pagesId === null) {
            throw new Error("reader: no /Pages");
        }
        /** @type {number[]} */
        const leaves = [];
        const seen = new Set();
        const walk = (nodeId) => {
            if (seen.has(nodeId)) {
                return;
            }
            seen.add(nodeId);
            const dict = this.getDict(nodeId);
            const type = getRaw(dict.entries, "Type");
            const kidsRaw = getRaw(dict.entries, "Kids");
            if (
                kidsRaw &&
                /Pages/.test(type || "") === false &&
                !/Page\b/.test(type || "")
            ) {
                // has Kids but ambiguous type -> treat as intermediate node
            }
            if (kidsRaw) {
                // intermediate Pages node
                const kidIds = [...kidsRaw.matchAll(/(\d+)\s+\d+\s+R/g)].map(
                    (mm) => parseInt(mm[1], 10)
                );
                for (let i = 0, len = kidIds.length; i < len; i++) {
                    walk(kidIds[i]);
                }
            } else {
                // leaf page
                leaves.push(nodeId);
            }
        };
        walk(pagesId);
        return leaves;
    }

    /** @returns {number} */
    pageCount() {
        return this.pageIds.length;
    }

    /** @returns {number[]} every object id present in the (merged) xref */
    allObjectIds() {
        return [...this.offsets.keys(), ...this.compressed.keys()];
    }

    /**
     * The page tree split into intermediate /Pages nodes and leaf /Page objects.
     * @returns {{ nodeIds: Set<number>, leafIds: number[] }}
     */
    getPageTree() {
        const catalog = this.getDict(this.rootId);
        const pagesRaw = getRaw(catalog.entries, "Pages");
        const pagesId = pagesRaw ? refId(pagesRaw) : null;
        /** @type {Set<number>} */
        const nodeIds = new Set();
        /** @type {number[]} */
        const leafIds = [];
        const seen = new Set();
        const walk = (id) => {
            if (id === null || seen.has(id)) {
                return;
            }
            seen.add(id);
            const d = this.getDict(id);
            const kids = getRaw(d.entries, "Kids");
            if (kids) {
                nodeIds.add(id);
                const ks = [...kids.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) =>
                    parseInt(m[1], 10)
                );
                for (let i = 0, len = ks.length; i < len; i++) {
                    walk(ks[i]);
                }
            } else {
                leafIds.push(id);
            }
        };
        walk(pagesId);
        return { nodeIds, leafIds };
    }

    /**
     * Read an indirect object as a raw dictionary string plus (for streams) its
     * verbatim body bytes. References are NOT rewritten here.
     * @param {number} id
     * @returns {{ dictPart: string, streamBytes: Uint8Array | null }}
     */
    getObjectRaw(id) {
        if (this.compressed.has(id)) {
            const loc = this.compressed.get(id);
            return {
                dictPart: this.getFromObjStm(loc.streamObjNum, loc.index),
                streamBytes: null
            };
        }
        const off = this.offsets.get(id);
        if (off === undefined) {
            throw new Error("reader: object " + id + " not in xref");
        }
        let p = skipWs(this.s, off);
        const m = /^(\d+)\s+(\d+)\s+obj/.exec(this.s.slice(p, p + 40));
        if (!m) {
            throw new Error("reader: object " + id + " header malformed");
        }
        p = skipWs(this.s, p + m[0].length);

        if (this.s[p] === "<" && this.s[p + 1] === "<") {
            const dictEnd = scanDict(this.s, p).end;
            let dictPart = this.s.slice(p, dictEnd);
            let q = skipWs(this.s, dictEnd);
            let streamBytes = null;
            if (this.s.slice(q, q + 6) === "stream") {
                q = q + 6;
                if (this.s[q] === "\r") {
                    q = q + 1;
                }
                if (this.s[q] === "\n") {
                    q = q + 1;
                }
                const len = this.streamLength(dictPart, q);
                streamBytes = this.bytes.slice(q, q + len);
            }
            if (this.decryptor && id !== this.encryptObjId) {
                dictPart = this.decryptor.decryptStringsInObject(id, dictPart);
                if (streamBytes) {
                    streamBytes = this.decryptor.decrypt(id, streamBytes);
                }
            }
            return { dictPart, streamBytes };
        }

        // Non-dict object (number/array/name/etc.): body up to endobj.
        const endIdx = this.s.indexOf("endobj", p);
        let body = this.s.slice(p, endIdx).trimEnd();
        if (this.decryptor && id !== this.encryptObjId) {
            body = this.decryptor.decryptStringsInObject(id, body);
        }
        return { dictPart: body, streamBytes: null };
    }

    /**
     * Determine a stream's byte length from its /Length (direct or indirect),
     * falling back to searching for endstream.
     * @param {string} dictPart
     * @param {number} streamStart
     * @returns {number}
     */
    streamLength(dictPart, streamStart) {
        const m = /\/Length\s+(\d+)(\s+\d+\s+R)?/.exec(dictPart);
        if (m) {
            if (m[2]) {
                const n = this.getObjectNumber(parseInt(m[1], 10));
                if (n !== null) {
                    return n;
                }
            } else {
                return parseInt(m[1], 10);
            }
        }
        let e = this.s.indexOf("endstream", streamStart);
        if (this.s[e - 1] === "\n") {
            e = e - 1;
        }
        if (this.s[e - 1] === "\r") {
            e = e - 1;
        }
        return e - streamStart;
    }

    /**
     * Parse a numeric indirect object (e.g. an indirect /Length).
     * @param {number} id
     * @returns {number | null}
     */
    getObjectNumber(id) {
        if (this.compressed.has(id)) {
            const loc = this.compressed.get(id);
            const t = this.getFromObjStm(loc.streamObjNum, loc.index);
            const nm = /^\d+/.exec(t.trim());
            return nm ? parseInt(nm[0], 10) : null;
        }
        const off = this.offsets.get(id);
        if (off === undefined) {
            return null;
        }
        let p = skipWs(this.s, off);
        const m = /^\d+\s+\d+\s+obj/.exec(this.s.slice(p, p + 40));
        if (!m) {
            return null;
        }
        p = skipWs(this.s, p + m[0].length);
        const nm = /^\d+/.exec(this.s.slice(p, p + 20));
        return nm ? parseInt(nm[0], 10) : null;
    }

    /**
     * Overlay a content-stream fragment on every page via an incremental update.
     * The fragment is placed in a Form XObject with its own Helvetica (/F1), so it
     * cannot collide with a page's own resources; each page gets the form added to
     * its /XObject resources and a "q /Fm{n} Do Q" appended to its /Contents.
     * @param {string} contentOps - drawing operators (may use /F1 for Helvetica)
     * @param {{ bbox?: [number, number, number, number] }} [options]
     * @returns {this}
     */
    overlay(contentOps, options) {
        const opts = options || {};
        const bbox = opts.bbox || [0, 0, 612, 792];

        const helvId = ++this.maxId;
        const formId = ++this.maxId;
        const stampContentId = ++this.maxId;
        const formName = "OvFm" + formId;

        // Helvetica font object.
        this.added.push({
            id: helvId,
            kind: "dict",
            text: createType1Font("Helvetica")
        });

        // Form XObject with its own resources.
        const formDict =
            "<<\n" +
            "  /Type /XObject\n" +
            "  /Subtype /Form\n" +
            "  /FormType 1\n" +
            "  /BBox [" +
            bbox.join(" ") +
            "]\n" +
            "  /Resources << /Font << /F1 " +
            formId_helvRef(helvId) +
            " >> >>\n" +
            "  /Length " +
            encodeUtf8(contentOps).length +
            "\n" +
            ">>";
        this.added.push({
            id: formId,
            kind: "stream",
            text: formDict,
            bytes: encodeUtf8(contentOps)
        });

        // Shared per-page content that paints the form.
        const paint = "q /" + formName + " Do Q";
        const paintDict = "<<\n  /Length " + encodeUtf8(paint).length + "\n>>";
        this.added.push({
            id: stampContentId,
            kind: "stream",
            text: paintDict,
            bytes: encodeUtf8(paint)
        });

        // Track which shared /Resources objects have had the form added.
        const patchedResObjs = new Set();

        for (let i = 0, len = this.pageIds.length; i < len; i++) {
            const pageId = this.pageIds[i];
            const dict = this.getDict(pageId);
            const entries = dict.entries.slice();

            // 1) /Contents -> append the paint stream.
            const contents = getRaw(entries, "Contents");
            let newContents;
            if (contents === undefined) {
                newContents = "[" + formId_ref(stampContentId) + "]";
            } else if (contents.trim().startsWith("[")) {
                newContents = contents.replace(
                    /\]\s*$/,
                    " " + formId_ref(stampContentId) + "]"
                );
            } else {
                newContents =
                    "[" +
                    contents.trim() +
                    " " +
                    formId_ref(stampContentId) +
                    "]";
            }
            setEntry(entries, "Contents", newContents);

            // 2) form must be in this page's /XObject resources.
            const resRaw = getRaw(entries, "Resources");
            const resObjId = resRaw ? refId(resRaw) : null;
            if (resObjId !== null) {
                if (!patchedResObjs.has(resObjId)) {
                    patchedResObjs.add(resObjId);
                    this.patchResources(resObjId, formName, formId);
                }
                this.updated.set(pageId, serializeDict(entries));
            } else if (resRaw && resRaw.trim().startsWith("<<")) {
                // inline resources on the page dict
                const newRes = insertXObject(resRaw, formName, formId);
                setEntry(entries, "Resources", newRes);
                this.updated.set(pageId, serializeDict(entries));
            } else {
                // no resources -> add one
                setEntry(
                    entries,
                    "Resources",
                    "<< /XObject << /" +
                        formName +
                        " " +
                        formId_ref(formId) +
                        " >> >>"
                );
                this.updated.set(pageId, serializeDict(entries));
            }
        }
        return this;
    }

    /**
     * Add the form to a shared /Resources object's /XObject sub-dictionary.
     * @param {number} resObjId
     * @param {string} formName
     * @param {number} formId
     * @returns {void}
     */
    patchResources(resObjId, formName, formId) {
        const dict = this.getDict(resObjId);
        const entries = dict.entries.slice();
        const xobj = getRaw(entries, "XObject");
        if (xobj === undefined) {
            setEntry(
                entries,
                "XObject",
                "<< /" + formName + " " + formId_ref(formId) + " >>"
            );
        } else if (xobj.trim().startsWith("<<")) {
            setEntry(
                entries,
                "XObject",
                insertIntoDict(xobj, formName, formId)
            );
        } else {
            // /XObject is itself an indirect ref -> patch that object
            const xid = refId(xobj);
            if (xid !== null) {
                const xd = this.getDict(xid);
                const xe = xd.entries.slice();
                xe.push({ key: formName, raw: formId_ref(formId) });
                this.updated.set(xid, serializeDict(xe));
            }
        }
        this.updated.set(resObjId, serializeDict(entries));
    }

    /**
     * Serialize the incremental update: original bytes + appended objects + a new
     * xref section + a new trailer referencing the previous one via /Prev.
     * @returns {Uint8Array}
     */
    save() {
        /** @type {{ id: number, chunk: Uint8Array }[]} */
        const objChunks = [];
        for (let i = 0, len = this.added.length; i < len; i++) {
            const o = this.added[i];
            objChunks.push({ id: o.id, chunk: this.serializeObject(o) });
        }
        for (const [id, body] of this.updated) {
            objChunks.push({
                id,
                chunk: encodeUtf8(id + " 0 obj\n" + body + "\nendobj\n")
            });
        }
        objChunks.sort((a, b) => a.id - b.id);

        /** @type {Uint8Array[]} */
        const chunks = [this.bytes];
        let offset = this.bytes.length;

        // Ensure the update starts on a fresh line.
        const sep = encodeUtf8("\n");
        chunks.push(sep);
        offset = offset + sep.length;

        /** @type {Map<number, number>} id -> new offset */
        const newOffsets = new Map();
        let maxWritten = 0;
        for (let i = 0, len = objChunks.length; i < len; i++) {
            newOffsets.set(objChunks[i].id, offset);
            chunks.push(objChunks[i].chunk);
            offset = offset + objChunks[i].chunk.length;
            if (objChunks[i].id > maxWritten) {
                maxWritten = objChunks[i].id;
            }
        }

        // xref section with subsections for the written (contiguous) ids.
        const xrefOffset = offset;
        const ids = objChunks.map((o) => o.id).sort((a, b) => a - b);
        let xref = "xref\n";
        let i = 0;
        while (i < ids.length) {
            let j = i;
            while (j + 1 < ids.length && ids[j + 1] === ids[j] + 1) {
                j = j + 1;
            }
            const startId = ids[i];
            const count = j - i + 1;
            xref = xref + startId + " " + count + "\n";
            for (let k = i; k <= j; k++) {
                const off = String(newOffsets.get(ids[k])).padStart(10, "0");
                xref = xref + off + " 00000 n \n";
            }
            i = j + 1;
        }

        const size = Math.max(this.maxId, maxWritten) + 1;
        let trailer = "trailer\n<<\n";
        trailer = trailer + "  /Size " + size + "\n";
        trailer = trailer + "  /Root " + formId_ref(this.rootId) + "\n";
        trailer = trailer + "  /Prev " + this.startxref + "\n";
        if (this.idRaw !== undefined) {
            trailer = trailer + "  /ID " + this.idRaw + "\n";
        }
        trailer = trailer + ">>\n";
        trailer = trailer + "startxref\n" + xrefOffset + "\n%%EOF\n";

        chunks.push(encodeUtf8(xref + trailer));
        return concatBytes(chunks);
    }

    /**
     * @param {{ id: number, kind: "dict" | "stream", text: string, bytes?: Uint8Array }} o
     * @returns {Uint8Array}
     */
    serializeObject(o) {
        if (o.kind === "stream" && o.bytes) {
            return concatBytes([
                encodeUtf8(o.id + " 0 obj\n" + o.text + "\nstream\n"),
                o.bytes,
                encodeUtf8("\nendstream\nendobj\n")
            ]);
        }
        return encodeUtf8(o.id + " 0 obj\n" + o.text + "\nendobj\n");
    }

    /**
     * Stage an (invisible) digital signature field: a /Sig value dictionary with
     * placeholder /ByteRange and /Contents, a /Widget field, an AcroForm entry
     * (created or merged) with /SigFlags 3, and the widget added to page 1's
     * /Annots. Follow with saveSigned() to compute the byte range and embed the
     * CMS signature. The actual crypto lives in sign.mjs; this stays crypto-free.
     * @param {{ fieldName?: string, name?: string, reason?: string, location?: string, signingTime?: Date, reservedBytes?: number }} [options]
     * @returns {this}
     */
    addSignatureField(options) {
        const opts = options || {};
        const reservedHex = opts.reservedBytes ? opts.reservedBytes * 2 : 16384;

        const sigValueId = ++this.maxId;
        const sigFieldId = ++this.maxId;

        const brPlaceholder = "[0 0000000000 0000000000 0000000000]";
        const contentsPlaceholder = "<" + "0".repeat(reservedHex) + ">";
        let sigDict =
            "<<\n  /Type /Sig\n  /Filter /Adobe.PPKLite\n" +
            "  /SubFilter /adbe.pkcs7.detached\n";
        if (opts.name) {
            sigDict =
                sigDict + "  /Name (" + escapePdfString(opts.name) + ")\n";
        }
        if (opts.reason) {
            sigDict =
                sigDict + "  /Reason (" + escapePdfString(opts.reason) + ")\n";
        }
        if (opts.location) {
            sigDict =
                sigDict +
                "  /Location (" +
                escapePdfString(opts.location) +
                ")\n";
        }
        if (opts.signingTime) {
            sigDict =
                sigDict + "  /M (" + formatPdfDate(opts.signingTime) + ")\n";
        }
        sigDict = sigDict + "  /ByteRange " + brPlaceholder + "\n";
        sigDict = sigDict + "  /Contents " + contentsPlaceholder + "\n>>";
        this.added.push({ id: sigValueId, kind: "dict", text: sigDict });

        const pageId = this.pageIds[0];
        const fieldName = opts.fieldName || "Signature1";
        const fieldDict =
            "<<\n  /Type /Annot\n  /Subtype /Widget\n  /FT /Sig\n" +
            "  /T (" +
            escapePdfString(fieldName) +
            ")\n" +
            "  /V " +
            formId_ref(sigValueId) +
            "\n" +
            "  /F 132\n  /Rect [0 0 0 0]\n  /P " +
            formId_ref(pageId) +
            "\n>>";
        this.added.push({ id: sigFieldId, kind: "dict", text: fieldDict });

        // AcroForm: merge into an existing one, else create and link from catalog.
        const catalog = this.getDict(this.rootId);
        const acroRaw = getRaw(catalog.entries, "AcroForm");
        const acroId = acroRaw ? refId(acroRaw) : null;
        if (acroId !== null) {
            const af = this.getDict(acroId);
            const afEntries = af.entries.slice();
            const fields = getRaw(afEntries, "Fields");
            let newFields;
            if (fields && fields.trim().startsWith("[")) {
                newFields = fields.replace(
                    /\]\s*$/,
                    " " + formId_ref(sigFieldId) + "]"
                );
            } else {
                newFields = "[" + formId_ref(sigFieldId) + "]";
            }
            setEntry(afEntries, "Fields", newFields);
            setEntry(afEntries, "SigFlags", "3");
            this.updated.set(acroId, serializeDict(afEntries));
        } else {
            const newAcroId = ++this.maxId;
            this.added.push({
                id: newAcroId,
                kind: "dict",
                text:
                    "<<\n  /Fields [" +
                    formId_ref(sigFieldId) +
                    "]\n  /SigFlags 3\n>>"
            });
            const catEntries = catalog.entries.slice();
            setEntry(catEntries, "AcroForm", formId_ref(newAcroId));
            this.updated.set(this.rootId, serializeDict(catEntries));
        }

        // Add the widget to page 1's /Annots.
        const pageDict = this.getDict(pageId);
        const pageEntries = pageDict.entries.slice();
        const annots = getRaw(pageEntries, "Annots");
        let newAnnots;
        if (annots && annots.trim().startsWith("[")) {
            newAnnots = annots.replace(
                /\]\s*$/,
                " " + formId_ref(sigFieldId) + "]"
            );
        } else {
            newAnnots = "[" + formId_ref(sigFieldId) + "]";
        }
        setEntry(pageEntries, "Annots", newAnnots);
        this.updated.set(pageId, serializeDict(pageEntries));

        /** @type {{ reservedHex: number, brPlaceholder: string } | undefined} */
        this.sigInfo = { reservedHex, brPlaceholder };
        return this;
    }

    /**
     * Serialize the signed document. Lays out the incremental update, fills in
     * the real /ByteRange, hashes the signed bytes (everything but the /Contents
     * gap), asks `cmsBuilder` for the detached CMS signature over those bytes,
     * and embeds it hex-encoded in the reserved /Contents slot.
     * @param {(signedBytes: Uint8Array) => Uint8Array} cmsBuilder
     * @returns {Uint8Array}
     */
    saveSigned(cmsBuilder) {
        if (!this.sigInfo) {
            throw new Error("saveSigned: call addSignatureField first");
        }
        const buffer = this.save();
        const s = dec.decode(buffer);

        const brIdx = s.indexOf(this.sigInfo.brPlaceholder);
        if (brIdx < 0) {
            throw new Error("sign: ByteRange placeholder not found");
        }
        const cIdx = s.indexOf("/Contents <", brIdx);
        if (cIdx < 0) {
            throw new Error("sign: Contents placeholder not found");
        }
        const P = cIdx + "/Contents ".length; // index of '<'
        const reserved = this.sigInfo.reservedHex;
        const gtPos = P + 1 + reserved; // index of '>'
        if (buffer[gtPos] !== 0x3e) {
            throw new Error("sign: Contents placeholder size mismatch");
        }
        const Q = gtPos + 1;
        const total = buffer.length;

        // /ByteRange sits inside the signed range, so patch it before hashing.
        const brReal =
            "[0 " + pad10(P) + " " + pad10(Q) + " " + pad10(total - Q) + "]";
        patchAscii(buffer, brIdx, brReal);

        const signed = concatBytes([buffer.slice(0, P), buffer.slice(Q)]);
        const cmsDer = cmsBuilder(signed);

        const hex = toHexLower(cmsDer);
        if (hex.length > reserved) {
            throw new Error(
                "sign: signature (" +
                    hex.length / 2 +
                    " bytes) exceeds reserved space; increase reservedBytes"
            );
        }
        patchAscii(buffer, P + 1, hex + "0".repeat(reserved - hex.length));
        return buffer;
    }
}

// small ref helpers (kept terse to avoid importing formatRef churn everywhere)
/** @param {number} id @returns {string} */
function formId_ref(id) {
    return id + " 0 R";
}
/** @param {number} id @returns {string} */
function formId_helvRef(id) {
    return id + " 0 R";
}

/**
 * @param {{ key: string, raw: string }[]} entries
 * @param {string} key
 * @param {string} raw
 * @returns {void}
 */
function setEntry(entries, key, raw) {
    for (let i = 0, len = entries.length; i < len; i++) {
        if (entries[i].key === key) {
            entries[i].raw = raw;
            return;
        }
    }
    entries.push({ key, raw });
}

/** @param {{ key: string, raw: string }[]} entries @returns {string} */
function serializeDict(entries) {
    let out = "<<\n";
    for (let i = 0, len = entries.length; i < len; i++) {
        out = out + "  /" + entries[i].key + " " + entries[i].raw + "\n";
    }
    out = out + ">>";
    return out;
}

/** Insert "/Name id 0 R" before the last >> of an inline dict raw value. */
function insertIntoDict(dictRaw, name, id) {
    return dictRaw.replace(
        />>\s*$/,
        " /" + name + " " + formId_ref(id) + " >>"
    );
}

/** Ensure an inline /Resources raw value contains /XObject with /Name -> form. */
function insertXObject(resRaw, name, id) {
    const xm = /\/XObject\s*<</.exec(resRaw);
    if (xm) {
        // add into the existing /XObject sub-dict (first >> after it)
        const idx = resRaw.indexOf("<<", xm.index + 8);
        // find matching >> for this sub-dict via a simple depth scan
        let depth = 0;
        let p = idx;
        for (; p < resRaw.length; p++) {
            if (resRaw[p] === "<" && resRaw[p + 1] === "<") {
                depth++;
                p++;
            } else if (resRaw[p] === ">" && resRaw[p + 1] === ">") {
                depth--;
                p++;
                if (depth === 0) {
                    break;
                }
            }
        }
        const closeAt = p - 1; // index of the first > of the closing >>
        return (
            resRaw.slice(0, closeAt) +
            " /" +
            name +
            " " +
            formId_ref(id) +
            " " +
            resRaw.slice(closeAt)
        );
    }
    // no /XObject yet
    return resRaw.replace(
        />>\s*$/,
        " /XObject << /" + name + " " + formId_ref(id) + " >> >>"
    );
}

/** @param {number} n @returns {string} */
function pad10(n) {
    return String(n).padStart(10, "0");
}

/** Overwrite buffer bytes at offset with the ASCII codes of str (same length). */
function patchAscii(buffer, offset, str) {
    for (let i = 0, len = str.length; i < len; i++) {
        buffer[offset + i] = str.charCodeAt(i) & 0xff;
    }
}

/** @param {Uint8Array} u @returns {string} */
function toHexLower(u) {
    let s = "";
    for (let i = 0, len = u.length; i < len; i++) {
        s = s + u[i].toString(16).padStart(2, "0");
    }
    return s;
}

/**
 * Load a PDF for reading/editing. For encrypted PDFs, supply the open password
 * (or omit it for documents encrypted with an empty user password).
 * @param {Uint8Array} bytes
 * @param {{ password?: string }} [options]
 * @returns {PdfEditor}
 */
export function loadPdf(bytes, options) {
    return new PdfEditor(bytes, options);
}

export default { loadPdf, PdfEditor };
