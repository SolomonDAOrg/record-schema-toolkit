/**
 * PDF page merging.
 *
 * Combines the pages of several unencrypted, classic-xref PDFs into one fresh
 * document: every object is copied into a single id space with all indirect
 * references rewritten, the leaf pages are re-parented under one new page tree,
 * and a new catalog + xref + trailer are written. Reuses the reader for parsing.
 *
 * Scope: merges page content and its dependencies (resources, fonts, images,
 * XObjects). Document-level structures that would collide across files —
 * outlines, AcroForm fields, the EmbeddedFiles name tree — are not merged.
 * @module Merge
 */

import { loadPdf, scanDict, getRaw } from "./reader.mjs";
import {
    encodeUtf8,
    concatBytes,
    createXrefTable,
    createTrailer
} from "./primitives.mjs";

const decoder = new TextDecoder("latin1");

/** Resource sub-dictionaries whose entries are named and prunable. */
const PRUNABLE_CATEGORIES = [
    "Font",
    "XObject",
    "ExtGState",
    "ColorSpace",
    "Shading",
    "Pattern",
    "Properties"
];

/**
 * Collect every /Name token appearing in a page's (decoded) content stream(s).
 * These identify the resources the page actually references.
 * @param {import("./reader.mjs").PdfEditor} ed
 * @param {string | undefined} contentsRaw - the page's /Contents value
 * @returns {Set<string>}
 */
function collectUsedNames(ed, contentsRaw) {
    /** @type {Set<string>} */
    const names = new Set();
    if (!contentsRaw) {
        return names;
    }
    const refIds = [...contentsRaw.matchAll(/(\d+)\s+\d+\s+R/g)].map((m) =>
        parseInt(m[1], 10)
    );
    for (let i = 0, len = refIds.length; i < len; i++) {
        let text;
        try {
            const raw = ed.getObjectRaw(refIds[i]);
            const { entries } = scanDict(raw.dictPart, 0);
            const decoded = ed.decodeStreamBytes(entries, raw.streamBytes);
            text = decoder.decode(decoded);
        } catch {
            continue;
        }
        for (const m of text.matchAll(/\/([^\s/<>\[\]()]+)/g)) {
            names.add(m[1]);
        }
    }
    return names;
}

/**
 * Prune a resource dictionary to only the named entries a page uses, returning
 * the rebuilt dictionary text and the object ids it still references.
 * @param {string} resourcesStr - the /Resources dictionary text
 * @param {Set<string>} usedNames
 * @returns {{ pruned: string, refs: number[] }}
 */
function pruneResources(resourcesStr, usedNames) {
    const { entries } = scanDict(resourcesStr, 0);
    /** @type {number[]} */
    const refs = [];
    /** @type {string[]} */
    const out = [];
    for (let i = 0, len = entries.length; i < len; i++) {
        const e = entries[i];
        if (
            PRUNABLE_CATEGORIES.indexOf(e.key) >= 0 &&
            e.raw.trim().startsWith("<<")
        ) {
            const sub = scanDict(e.raw, 0).entries;
            /** @type {string[]} */
            const keptEntries = [];
            for (let j = 0, jlen = sub.length; j < jlen; j++) {
                if (usedNames.has(sub[j].key)) {
                    keptEntries.push("/" + sub[j].key + " " + sub[j].raw);
                    for (const m of sub[j].raw.matchAll(/(\d+)\s+\d+\s+R/g)) {
                        refs.push(parseInt(m[1], 10));
                    }
                }
            }
            if (keptEntries.length > 0) {
                out.push("/" + e.key + " << " + keptEntries.join(" ") + " >>");
            }
        } else {
            // keep non-prunable entries (e.g. ProcSet) verbatim
            out.push("/" + e.key + " " + e.raw);
            for (const m of e.raw.matchAll(/(\d+)\s+\d+\s+R/g)) {
                refs.push(parseInt(m[1], 10));
            }
        }
    }
    return { pruned: "<< " + out.join(" ") + " >>", refs };
}

/**
 * Rewrite every indirect reference "N G R" in a serialized dictionary using a
 * remap function, leaving literal/hex strings untouched.
 * @param {string} dictStr
 * @param {(id: number) => number} remap
 * @returns {string}
 */
export function rewriteRefs(dictStr, remap) {
    let out = "";
    let i = 0;
    const n = dictStr.length;
    while (i < n) {
        const c = dictStr[i];
        if (c === "<" && dictStr[i + 1] === "<") {
            out = out + "<<";
            i = i + 2;
            continue;
        }
        if (c === ">" && dictStr[i + 1] === ">") {
            out = out + ">>";
            i = i + 2;
            continue;
        }
        if (c === "(") {
            let depth = 1;
            let j = i + 1;
            while (j < n && depth > 0) {
                if (dictStr[j] === "\\") {
                    j = j + 2;
                } else {
                    if (dictStr[j] === "(") {
                        depth = depth + 1;
                    } else if (dictStr[j] === ")") {
                        depth = depth - 1;
                    }
                    j = j + 1;
                }
            }
            out = out + dictStr.slice(i, j);
            i = j;
            continue;
        }
        if (c === "<" && dictStr[i + 1] !== "<") {
            let j = i + 1;
            while (j < n && dictStr[j] !== ">") {
                j = j + 1;
            }
            j = j + 1;
            out = out + dictStr.slice(i, j);
            i = j;
            continue;
        }
        const m = /^(\d+)(\s+)(\d+)(\s+)R\b/.exec(dictStr.slice(i));
        if (m) {
            out = out + remap(parseInt(m[1], 10)) + m[2] + m[3] + m[4] + "R";
            i = i + m[0].length;
            continue;
        }
        out = out + c;
        i = i + 1;
    }
    return out;
}

/**
 * Force a page dict's /Parent to a given object id (adding it if absent).
 * @param {string} dictStr
 * @param {number} parentId
 * @returns {string}
 */
export function setParent(dictStr, parentId) {
    const ref = parentId + " 0 R";
    if (/\/Parent\s+\d+\s+\d+\s+R/.test(dictStr)) {
        return dictStr.replace(/\/Parent\s+\d+\s+\d+\s+R/, "/Parent " + ref);
    }
    return dictStr.replace(/>>\s*$/, " /Parent " + ref + " >>");
}

/**
 * Assemble a fresh PDF from copied objects + an ordered page list. Writes a new
 * catalog (id 1) and page tree (id 2), then all objects, an xref table, and a
 * trailer. Object ids must already be assigned (1 and 2 reserved).
 * @param {{ id: number, dictPart: string, streamBytes: Uint8Array | null }[]} outObjects
 * @param {number[]} newPageIds - page object ids, in order
 * @returns {Uint8Array}
 */
export function assemblePdf(outObjects, newPageIds) {
    const catalogId = 1;
    const pagesTreeId = 2;

    outObjects.push({
        id: catalogId,
        dictPart: "<<\n  /Type /Catalog\n  /Pages " + pagesTreeId + " 0 R\n>>",
        streamBytes: null
    });
    const kids = newPageIds.map((id) => id + " 0 R").join(" ");
    outObjects.push({
        id: pagesTreeId,
        dictPart:
            "<<\n  /Type /Pages\n  /Kids [" +
            kids +
            "]\n  /Count " +
            newPageIds.length +
            "\n>>",
        streamBytes: null
    });

    outObjects.sort((a, b) => a.id - b.id);

    /** @type {Uint8Array[]} */
    const chunks = [];
    let offset = 0;
    const push = (u8) => {
        chunks.push(u8);
        offset = offset + u8.length;
    };

    push(encodeUtf8("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n"));

    const maxId = outObjects[outObjects.length - 1].id;
    /** @type {number[]} */
    const objectOffsets = new Array(maxId + 1).fill(0);
    for (let i = 0, len = outObjects.length; i < len; i++) {
        const o = outObjects[i];
        objectOffsets[o.id] = offset;
        if (o.streamBytes) {
            push(encodeUtf8(o.id + " 0 obj\n" + o.dictPart + "\nstream\n"));
            push(o.streamBytes);
            push(encodeUtf8("\nendstream\nendobj\n"));
        } else {
            push(encodeUtf8(o.id + " 0 obj\n" + o.dictPart + "\nendobj\n"));
        }
    }

    const xrefOffset = offset;
    /** @type {import("./primitives.mjs").PdfXrefEntry[]} */
    const xrefEntries = [{ offset: 0, generation: 65535, type: "f" }];
    for (let id = 1; id <= maxId; id++) {
        xrefEntries.push({
            offset: objectOffsets[id],
            generation: 0,
            type: "n"
        });
    }
    push(encodeUtf8(createXrefTable(xrefEntries)));
    push(encodeUtf8(createTrailer(maxId + 1, catalogId, xrefOffset)));

    return concatBytes(chunks);
}

/**
 * Merge the pages of multiple PDFs into a single new PDF.
 * @param {Uint8Array[]} buffers - source PDFs (2 or more)
 * @returns {Uint8Array}
 */
export function mergePdfs(buffers, options) {
    if (!buffers || buffers.length === 0) {
        throw new Error("mergePdfs: no input");
    }
    const password = options && options.password;

    let nextId = 3;
    /** @type {{ id: number, dictPart: string, streamBytes: Uint8Array | null }[]} */
    const outObjects = [];
    /** @type {number[]} new page object ids, in order */
    const newPageIds = [];

    for (let e = 0, elen = buffers.length; e < elen; e++) {
        const ed = loadPdf(buffers[e], { password });
        const { nodeIds, leafIds } = ed.getPageTree();

        /** @type {Set<number>} objects to skip (catalog + page-tree nodes) */
        const skip = new Set(nodeIds);
        skip.add(ed.rootId);

        /** @type {Map<number, number>} source id -> new id */
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
        for (let i = 0, len = ids.length; i < len; i++) {
            const srcId = ids[i];
            if (skip.has(srcId)) {
                continue;
            }
            const raw = ed.getObjectRaw(srcId);
            let dictPart = rewriteRefs(raw.dictPart, remapFn);
            if (leafSet.has(srcId)) {
                dictPart = setParent(dictPart, 2);
                newPageIds.push(remap.get(srcId));
            }
            outObjects.push({
                id: remap.get(srcId),
                dictPart,
                streamBytes: raw.streamBytes
            });
        }
    }

    return assemblePdf(outObjects, newPageIds);
}

/**
 * Replace a page dict's /Resources value (ref or inline) with new text.
 * @param {string} dictPart
 * @param {string} newResources
 * @returns {string}
 */
function replaceResourcesValue(dictPart, newResources) {
    if (/\/Resources\s+\d+\s+\d+\s+R/.test(dictPart)) {
        return dictPart.replace(
            /\/Resources\s+\d+\s+\d+\s+R/,
            "/Resources " + newResources
        );
    }
    const idx = dictPart.indexOf("/Resources");
    if (idx < 0) {
        return dictPart.replace(
            />>\s*$/,
            " /Resources " + newResources + " >>"
        );
    }
    // inline dict: find the balanced << >> after /Resources
    let p = dictPart.indexOf("<<", idx);
    let depth = 0;
    let end = p;
    for (; end < dictPart.length; end++) {
        if (dictPart[end] === "<" && dictPart[end + 1] === "<") {
            depth++;
            end++;
        } else if (dictPart[end] === ">" && dictPart[end + 1] === ">") {
            depth--;
            end++;
            if (depth === 0) {
                end++;
                break;
            }
        }
    }
    return dictPart.slice(0, p) + newResources + dictPart.slice(end);
}

/**
 * Extract (and optionally reorder) pages from a PDF into a new PDF. Each page's
 * resources are pruned to only what its content stream references, so the result
 * is lean — an extracted text page won't carry an unrelated embedded font.
 * @param {Uint8Array} buffer - source PDF
 * @param {number[]} pageNumbers - 1-based page numbers, in the desired output order
 * @returns {Uint8Array}
 */
export function extractPages(buffer, pageNumbers, options) {
    const ed = loadPdf(buffer, { password: options && options.password });
    const leaves = ed.getPageTree().leafIds;
    /** @type {number[]} source page object ids, in requested order */
    const selected = pageNumbers.map((n) => {
        if (n < 1 || n > leaves.length) {
            throw new Error("extractPages: page " + n + " out of range");
        }
        return leaves[n - 1];
    });
    const selectedSet = new Set(selected);

    /** @type {Map<number, boolean>} */
    const pageCache = new Map();
    const isForeignPage = (id) => {
        if (selectedSet.has(id)) {
            return false;
        }
        if (!pageCache.has(id)) {
            let pg = false;
            try {
                pg = /\/Type\s*\/Page\b/.test(ed.getObjectRaw(id).dictPart);
            } catch {
                pg = false;
            }
            pageCache.set(id, pg);
        }
        return pageCache.get(id);
    };

    // For each distinct selected page, compute pruned resources + the object refs
    // it still needs (content streams, annotations, kept resources).
    /** @type {Map<number, { pruned: string, seeds: number[] }>} */
    const pageInfo = new Map();
    for (const pid of selected) {
        if (pageInfo.has(pid)) {
            continue;
        }
        const { entries } = scanDict(ed.getObjectRaw(pid).dictPart, 0);
        const contentsRaw = getRaw(entries, "Contents");
        const usedNames = collectUsedNames(ed, contentsRaw);

        let resourcesStr = "<< >>";
        const resRaw = getRaw(entries, "Resources");
        if (resRaw && resRaw.trim().startsWith("<<")) {
            resourcesStr = resRaw;
        } else if (resRaw) {
            const rid = parseInt(/(\d+)\s+\d+\s+R/.exec(resRaw)[1], 10);
            resourcesStr = ed.getObjectRaw(rid).dictPart;
        }
        const { pruned, refs } = pruneResources(resourcesStr, usedNames);

        const seeds = refs.slice();
        for (const key of ["Contents", "Annots"]) {
            const raw = getRaw(entries, key);
            if (raw) {
                for (const m of raw.matchAll(/(\d+)\s+\d+\s+R/g)) {
                    seeds.push(parseInt(m[1], 10));
                }
            }
        }
        pageInfo.set(pid, { pruned, seeds });
    }

    // Reachability: selected pages are copied specially; follow their seeds and
    // the transitive closure from there (skipping /Parent and foreign pages).
    /** @type {Set<number>} */
    const reachable = new Set(selected);
    /** @type {number[]} */
    const queue = [];
    for (const pid of selected) {
        for (const s of pageInfo.get(pid).seeds) {
            queue.push(s);
        }
    }
    while (queue.length > 0) {
        const id = queue.pop();
        if (reachable.has(id) || isForeignPage(id)) {
            continue;
        }
        reachable.add(id);
        let dictPart;
        try {
            dictPart = ed.getObjectRaw(id).dictPart;
        } catch {
            continue;
        }
        const scan = dictPart.replace(/\/Parent\s+\d+\s+\d+\s+R/g, "");
        for (const m of scan.matchAll(/(\d+)\s+\d+\s+R\b/g)) {
            const rid = parseInt(m[1], 10);
            if (!reachable.has(rid) && !isForeignPage(rid)) {
                queue.push(rid);
            }
        }
    }

    let nextId = 3;
    /** @type {Map<number, number>} */
    const remap = new Map();
    for (const id of reachable) {
        remap.set(id, nextId++);
    }
    const remapFn = (id) => {
        const r = remap.get(id);
        return r !== undefined ? r : id;
    };

    /** @type {{ id: number, dictPart: string, streamBytes: Uint8Array | null }[]} */
    const outObjects = [];
    for (const id of reachable) {
        const raw = ed.getObjectRaw(id);
        if (selectedSet.has(id)) {
            let dictPart = replaceResourcesValue(
                raw.dictPart,
                pageInfo.get(id).pruned
            );
            // drop /StructParents (structure tree isn't carried over)
            dictPart = dictPart.replace(/\/StructParents\s+\d+/, "");
            dictPart = rewriteRefs(dictPart, remapFn);
            dictPart = setParent(dictPart, 2);
            outObjects.push({
                id: remap.get(id),
                dictPart,
                streamBytes: raw.streamBytes
            });
        } else {
            outObjects.push({
                id: remap.get(id),
                dictPart: rewriteRefs(raw.dictPart, remapFn),
                streamBytes: raw.streamBytes
            });
        }
    }
    const newPageIds = selected.map((id) => remap.get(id));
    return assemblePdf(outObjects, newPageIds);
}

/**
 * Produce a new PDF with the given 1-based pages removed.
 * @param {Uint8Array} buffer
 * @param {number[]} pageNumbers - pages to drop
 * @returns {Uint8Array}
 */
export function removePages(buffer, pageNumbers, options) {
    const ed = loadPdf(buffer, { password: options && options.password });
    const total = ed.getPageTree().leafIds.length;
    const drop = new Set(pageNumbers);
    /** @type {number[]} */
    const keep = [];
    for (let n = 1; n <= total; n++) {
        if (!drop.has(n)) {
            keep.push(n);
        }
    }
    if (keep.length === 0) {
        throw new Error(
            "removePages: refusing to produce a zero-page document"
        );
    }
    return extractPages(buffer, keep, options);
}

export default { mergePdfs, extractPages, removePages };
