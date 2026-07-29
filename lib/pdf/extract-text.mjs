/**
 * Basic text extraction from PDF pages.
 *
 * Walks each page's content stream, tracks the current font, and decodes the
 * text-showing operators (Tj, TJ, ', ") to Unicode — using each font's
 * /ToUnicode CMap when present (both simple and Type0 fonts), else WinAnsi for
 * simple fonts. Line breaks are inferred from text-positioning operators and
 * word gaps from large TJ adjustments. Aims for correct characters and readable
 * order rather than pixel-perfect layout. No dependencies.
 * @module ExtractText
 */

import { loadPdf, scanDict, getRaw } from "./reader.mjs";

const dec = new TextDecoder("latin1");

// WinAnsi (CP1252) high-byte mappings that differ from Latin-1 (0x80..0x9F).
const WINANSI_HIGH = {
    0x80: 0x20ac,
    0x82: 0x201a,
    0x83: 0x0192,
    0x84: 0x201e,
    0x85: 0x2026,
    0x86: 0x2020,
    0x87: 0x2021,
    0x88: 0x02c6,
    0x89: 0x2030,
    0x8a: 0x0160,
    0x8b: 0x2039,
    0x8c: 0x0152,
    0x8e: 0x017d,
    0x91: 0x2018,
    0x92: 0x2019,
    0x93: 0x201c,
    0x94: 0x201d,
    0x95: 0x2022,
    0x96: 0x2013,
    0x97: 0x2014,
    0x98: 0x02dc,
    0x99: 0x2122,
    0x9a: 0x0161,
    0x9b: 0x203a,
    0x9c: 0x0153,
    0x9e: 0x017e,
    0x9f: 0x0178
};

/** @param {number} b @returns {string} */
function winAnsiChar(b) {
    if (b < 0x80 || b > 0x9f) {
        return String.fromCodePoint(b); // ASCII + Latin-1 identity
    }
    const u = WINANSI_HIGH[b];
    return u ? String.fromCodePoint(u) : "";
}

/** Decode a UTF-16BE hex string (handles surrogate pairs). */
function utf16beHexToStr(hex) {
    let out = "";
    for (let i = 0; i + 4 <= hex.length; i += 4) {
        out = out + String.fromCharCode(parseInt(hex.substr(i, 4), 16));
    }
    return out;
}

/**
 * Parse a /ToUnicode CMap into { bytesPerCode, map: Map<number,string> }.
 * @param {string} cmapText
 * @returns {{ bytesPerCode: number, map: Map<number, string> }}
 */
function parseToUnicode(cmapText) {
    /** @type {Map<number, string>} */
    const map = new Map();
    let bytesPerCode = 2;
    const csr =
        /begincodespacerange\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/.exec(
            cmapText
        );
    if (csr) {
        bytesPerCode = Math.max(1, csr[1].length / 2);
    }

    // bfchar: <src> <dst>
    const bfcharBlocks = cmapText.match(/beginbfchar([^]*?)endbfchar/g) || [];
    for (const block of bfcharBlocks) {
        const re = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
        let m;
        while ((m = re.exec(block)) !== null) {
            map.set(parseInt(m[1], 16), utf16beHexToStr(m[2]));
        }
    }
    // bfrange: <lo> <hi> <dst>  (incrementing) or <lo> <hi> [<d1> <d2> ...]
    const bfrangeBlocks =
        cmapText.match(/beginbfrange([^]*?)endbfrange/g) || [];
    for (const block of bfrangeBlocks) {
        const re =
            /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g;
        let m;
        while ((m = re.exec(block)) !== null) {
            const lo = parseInt(m[1], 16);
            const hi = parseInt(m[2], 16);
            if (m[3] !== undefined) {
                const base = m[3];
                for (let code = lo; code <= hi; code++) {
                    const inc = base.slice(0, -4);
                    const last = (parseInt(base.slice(-4), 16) + (code - lo))
                        .toString(16)
                        .padStart(4, "0");
                    map.set(code, utf16beHexToStr(inc + last));
                }
            } else if (m[4] !== undefined) {
                const items = [...m[4].matchAll(/<([0-9A-Fa-f]+)>/g)];
                for (let k = 0; k < items.length && lo + k <= hi; k++) {
                    map.set(lo + k, utf16beHexToStr(items[k][1]));
                }
            }
        }
    }
    return { bytesPerCode, map };
}

/**
 * Build a map of font resource name -> decoder for a page.
 * @param {import("./reader.mjs").PdfEditor} ed
 * @param {{ key: string, raw: string }[]} pageEntries
 * @returns {Map<string, { bytesPerCode: number, toUnicode: Map<number,string> | null }>}
 */
function buildFontMap(ed, pageEntries) {
    /** @type {Map<string, { bytesPerCode: number, toUnicode: Map<number,string> | null }>} */
    const fonts = new Map();
    let resStr = null;
    const resRaw = getRaw(pageEntries, "Resources");
    if (resRaw && resRaw.trim().startsWith("<<")) {
        resStr = resRaw;
    } else if (resRaw) {
        const rid = parseInt(/(\d+)\s+\d+\s+R/.exec(resRaw)[1], 10);
        resStr = ed.getObjectRaw(rid).dictPart;
    }
    if (!resStr) {
        return fonts;
    }
    const resEntries = scanDict(resStr, 0).entries;
    const fontRaw = getRaw(resEntries, "Font");
    if (!fontRaw || !fontRaw.trim().startsWith("<<")) {
        return fonts;
    }
    const fontDict = scanDict(fontRaw, 0).entries;
    for (let i = 0, len = fontDict.length; i < len; i++) {
        const name = fontDict[i].key;
        const fref = /(\d+)\s+\d+\s+R/.exec(fontDict[i].raw);
        if (!fref) {
            continue;
        }
        let entry = { bytesPerCode: 1, toUnicode: null };
        try {
            const fontObj = scanDict(
                ed.getObjectRaw(parseInt(fref[1], 10)).dictPart,
                0
            ).entries;
            const isType0 = /Type0/.test(getRaw(fontObj, "Subtype") || "");
            entry.bytesPerCode = isType0 ? 2 : 1;
            const tuRaw = getRaw(fontObj, "ToUnicode");
            if (tuRaw) {
                const tid = parseInt(/(\d+)\s+\d+\s+R/.exec(tuRaw)[1], 10);
                const raw = ed.getObjectRaw(tid);
                const bytes = ed.decodeStreamBytes(
                    scanDict(raw.dictPart, 0).entries,
                    raw.streamBytes
                );
                const parsed = parseToUnicode(dec.decode(bytes));
                entry.toUnicode = parsed.map;
                entry.bytesPerCode = parsed.bytesPerCode;
            }
        } catch {
            /* ignore malformed font */
        }
        fonts.set(name, entry);
    }
    return fonts;
}

/** Decode a PDF literal/hex string operand into raw code bytes. */
function decodeStringOperand(tok) {
    if (tok[0] === "<") {
        let hex = tok.slice(1, -1).replace(/\s/g, "");
        if (hex.length % 2 === 1) {
            hex = hex + "0";
        }
        const out = new Uint8Array(hex.length / 2);
        for (let i = 0; i < out.length; i++) {
            out[i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        return out;
    }
    /** @type {number[]} */
    const bytes = [];
    let i = 1;
    let depth = 1;
    while (i < tok.length && depth > 0) {
        const c = tok[i];
        if (c === "\\") {
            const n = tok[i + 1];
            const simple = { n: 10, r: 13, t: 9, b: 8, f: 12 };
            if (n in simple) {
                bytes.push(simple[n]);
                i = i + 2;
            } else if (n >= "0" && n <= "7") {
                let oct = "";
                let k = i + 1;
                while (
                    k < tok.length &&
                    oct.length < 3 &&
                    tok[k] >= "0" &&
                    tok[k] <= "7"
                ) {
                    oct = oct + tok[k];
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

/** Decode code bytes to text using the current font. */
function decodeShow(codeBytes, font) {
    let out = "";
    const step = font && font.bytesPerCode === 2 ? 2 : 1;
    for (let i = 0; i + step <= codeBytes.length; i += step) {
        let code = codeBytes[i];
        if (step === 2) {
            code = (codeBytes[i] << 8) | codeBytes[i + 1];
        }
        if (font && font.toUnicode && font.toUnicode.has(code)) {
            out = out + font.toUnicode.get(code);
        } else if (step === 1) {
            out = out + winAnsiChar(code);
        } else {
            out = out + String.fromCharCode(code);
        }
    }
    return out;
}

/**
 * Tokenize a content stream into strings, arrays, names, numbers, and operators.
 * @param {string} s
 * @returns {{ t: string, v: string }[]}
 */
export function tokenizeContent(s) {
    /** @type {{ t: string, v: string }[]} */
    const toks = [];
    let i = 0;
    const n = s.length;
    while (i < n) {
        const c = s[i];
        if (
            c === " " ||
            c === "\n" ||
            c === "\r" ||
            c === "\t" ||
            c === "\0" ||
            c === "\f"
        ) {
            i = i + 1;
        } else if (c === "%") {
            while (i < n && s[i] !== "\n" && s[i] !== "\r") {
                i = i + 1;
            }
        } else if (c === "(") {
            let depth = 1;
            let j = i + 1;
            while (j < n && depth > 0) {
                if (s[j] === "\\") {
                    j = j + 2;
                } else {
                    if (s[j] === "(") depth++;
                    else if (s[j] === ")") depth--;
                    j = j + 1;
                }
            }
            toks.push({ t: "str", v: s.slice(i, j) });
            i = j;
        } else if (c === "<" && s[i + 1] === "<") {
            let depth = 0;
            let j = i;
            while (j < n) {
                if (s[j] === "<" && s[j + 1] === "<") {
                    depth++;
                    j += 2;
                } else if (s[j] === ">" && s[j + 1] === ">") {
                    depth--;
                    j += 2;
                    if (depth === 0) break;
                } else j++;
            }
            toks.push({ t: "dict", v: s.slice(i, j) });
            i = j;
        } else if (c === "<") {
            let j = i + 1;
            while (j < n && s[j] !== ">") j++;
            toks.push({ t: "str", v: s.slice(i, j + 1) });
            i = j + 1;
        } else if (c === "[") {
            toks.push({ t: "op", v: "[" });
            i = i + 1;
        } else if (c === "]") {
            toks.push({ t: "op", v: "]" });
            i = i + 1;
        } else if (c === "/") {
            let j = i + 1;
            while (j < n && !/[\s/<>\[\]()%]/.test(s[j])) j++;
            toks.push({ t: "name", v: s.slice(i, j) });
            i = j;
        } else if (/[-+.\d]/.test(c)) {
            let j = i;
            while (j < n && /[-+.\d]/.test(s[j])) j++;
            toks.push({ t: "num", v: s.slice(i, j) });
            i = j;
        } else {
            let j = i;
            while (j < n && !/[\s/<>\[\]()%]/.test(s[j])) j++;
            toks.push({ t: "op", v: s.slice(i, j) });
            i = j;
        }
    }
    return toks;
}

/** Extract text from a single decoded content stream. */
function extractFromContent(content, fonts) {
    const toks = tokenizeContent(content);
    /** @type {{ t: string, v: string }[]} */
    let stack = [];
    let currentFont = null;
    let out = "";

    for (let i = 0, len = toks.length; i < len; i++) {
        const tk = toks[i];
        if (tk.t !== "op") {
            stack.push(tk);
            continue;
        }
        const op = tk.v;
        if (op === "Tf") {
            const nameTok = stack[stack.length - 2];
            if (nameTok && nameTok.t === "name") {
                currentFont = fonts.get(nameTok.v.slice(1)) || null;
            }
            stack = [];
        } else if (op === "Tj") {
            const strTok = stack[stack.length - 1];
            if (strTok && strTok.t === "str") {
                out =
                    out +
                    decodeShow(decodeStringOperand(strTok.v), currentFont);
            }
            stack = [];
        } else if (op === "'" || op === '"') {
            out = out + "\n";
            const strTok = stack[stack.length - 1];
            if (strTok && strTok.t === "str") {
                out =
                    out +
                    decodeShow(decodeStringOperand(strTok.v), currentFont);
            }
            stack = [];
        } else if (op === "]") {
            // TJ array elements were pushed since the matching '['
            let k = stack.length - 1;
            while (k >= 0 && stack[k].v !== "[") k--;
            const elems = stack.slice(k + 1);
            for (let e = 0; e < elems.length; e++) {
                if (elems[e].t === "str") {
                    out =
                        out +
                        decodeShow(
                            decodeStringOperand(elems[e].v),
                            currentFont
                        );
                } else if (elems[e].t === "num") {
                    const adj = parseFloat(elems[e].v);
                    if (adj < -120) {
                        out = out + " ";
                    }
                }
            }
            stack = stack.slice(0, k); // pop through '['
        } else if (op === "TJ") {
            stack = [];
        } else if (op === "Td" || op === "TD") {
            const ty =
                stack.length >= 2 ? parseFloat(stack[stack.length - 1].v) : 0;
            if (ty !== 0) {
                out = out + "\n";
            }
            stack = [];
        } else if (op === "T*") {
            out = out + "\n";
            stack = [];
        } else if (op === "ET") {
            out = out + "\n";
            stack = [];
        } else {
            stack = [];
        }
    }
    return out;
}

/**
 * Extract text from a PDF, one string per page.
 * @param {Uint8Array} bytes
 * @param {{ password?: string }} [options]
 * @returns {{ pages: string[], text: string }}
 */
export function extractText(bytes, options) {
    const ed = loadPdf(bytes, options);
    const leaves = ed.getPageTree().leafIds;
    /** @type {string[]} */
    const pages = [];
    for (let p = 0, plen = leaves.length; p < plen; p++) {
        const pageEntries = scanDict(
            ed.getObjectRaw(leaves[p]).dictPart,
            0
        ).entries;
        const fonts = buildFontMap(ed, pageEntries);
        const contentsRaw = getRaw(pageEntries, "Contents") || "";
        const refIds = [...contentsRaw.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) =>
            parseInt(m[1], 10)
        );
        let content = "";
        for (let r = 0; r < refIds.length; r++) {
            try {
                const raw = ed.getObjectRaw(refIds[r]);
                const decoded = ed.decodeStreamBytes(
                    scanDict(raw.dictPart, 0).entries,
                    raw.streamBytes
                );
                content = content + dec.decode(decoded) + "\n";
            } catch {
                /* ignore */
            }
        }
        pages.push(
            extractFromContent(content, fonts)
                .replace(/\n{2,}/g, "\n")
                .trim()
        );
    }
    return { pages, text: pages.join("\n\n") };
}

export default { extractText };
