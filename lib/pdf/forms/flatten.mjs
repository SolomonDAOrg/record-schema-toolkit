/**
 * Flattening an interactive form into ordinary page content.
 *
 * A filled form is two things at once: field values a reader can extract, and
 * widget annotations that draw them. Flattening keeps the second and discards
 * the first — each widget's appearance is painted into the page it sits on, the
 * annotations are removed, and the form is removed from the catalog. What comes
 * out looks identical and can no longer be edited, re-read as data, or carried
 * into another document as a form.
 *
 * This is the operation that makes a filled form safe to combine with other
 * documents. Page merging deliberately does not carry a form across, since two
 * forms would collide in one field-name space; merging a filled form without
 * flattening it first leaves its widgets behind as annotations belonging to a
 * form that no longer exists.
 *
 * Placement follows ISO 32000-1 12.5.5: the appearance's bounding box is
 * transformed by its own matrix, and the result is mapped onto the annotation
 * rectangle. Honouring that rather than drawing the appearance at the
 * rectangle's origin is what keeps a rotated or offset appearance where its
 * producer put it.
 * @module Flatten
 */

import { DictionaryEdits } from "../dictionary-edits.mjs";
import { asNumber, dictionaryEntry, parseValue } from "../object-values.mjs";
import { encodeUtf8 } from "../primitives.mjs";
import { getRaw, refId, serializeDict } from "../reader.mjs";

import { ANNOTATION_FLAGS, hasFlag } from "./field-flags.mjs";
import { readAcroForm, resolveValue } from "./field-tree.mjs";

/** Identity transformation, used when an appearance declares no /Matrix. */
const IDENTITY = [1, 0, 0, 1, 0, 0];

/**
 * @typedef {import("../reader.mjs").PdfEditor} PdfEditor
 * @typedef {import("./types.mjs").FormWidget} FormWidget
 */

/**
 * @typedef {Object} FlattenResult
 * @property {number} fieldsFlattened
 * @property {number} widgetsPainted - Widgets whose appearance was drawn.
 * @property {number} widgetsRemoved - Widgets removed from their page.
 * @property {string[]} withoutAppearance - Fields with a widget that had nothing to draw.
 */

/**
 * Format a number for a content stream without a trailing run of zeros.
 * @param {number} value
 * @returns {string}
 */
function formatNumber(value) {
    return String(Number(value.toFixed(6)));
}

/**
 * Apply a transformation matrix to a point.
 * @param {number[]} matrix
 * @param {number} x
 * @param {number} y
 * @returns {[number, number]}
 */
function transform(matrix, x, y) {
    return [
        matrix[0] * x + matrix[2] * y + matrix[4],
        matrix[1] * x + matrix[3] * y + matrix[5]
    ];
}

/**
 * The axis-aligned bounds of a bounding box once its matrix is applied.
 * @param {number[]} bbox - [x0, y0, x1, y1]
 * @param {number[]} matrix
 * @returns {[number, number, number, number]}
 */
function transformedBounds(bbox, matrix) {
    const corners = [
        transform(matrix, bbox[0], bbox[1]),
        transform(matrix, bbox[2], bbox[1]),
        transform(matrix, bbox[2], bbox[3]),
        transform(matrix, bbox[0], bbox[3])
    ];
    const xs = corners.map((corner) => corner[0]);
    const ys = corners.map((corner) => corner[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/**
 * Read a numeric array of a known length, or null.
 * @param {PdfEditor} editor
 * @param {string | undefined} raw
 * @param {number} length
 * @returns {number[] | null}
 */
function numberArray(editor, raw, length) {
    const value = resolveValue(editor, raw);
    if (value.kind !== "array" || value.items.length < length) {
        return null;
    }
    /** @type {number[]} */
    const numbers = [];
    for (let i = 0; i < length; i++) {
        const entry = asNumber(value.items[i]);
        if (entry === null) {
            return null;
        }
        numbers.push(entry);
    }
    return numbers;
}

/**
 * The object id of the appearance stream a widget currently shows.
 *
 * A widget whose normal appearance is a dictionary of states shows the one its
 * /AS names; a state with no entry — an unchecked box whose producer supplied
 * only an on appearance — draws nothing, which is what the viewer does too.
 * @param {PdfEditor} editor
 * @param {FormWidget} widget
 * @returns {number | null}
 */
function appearanceStreamId(editor, widget) {
    const appearance = resolveValue(editor, getRaw(widget.entries, "AP"));
    const normalRaw = dictionaryEntry(appearance, "N");
    if (normalRaw === undefined) {
        return null;
    }
    const direct = refId(normalRaw);
    const normal = resolveValue(editor, normalRaw);
    if (normal.kind !== "dictionary") {
        return null;
    }
    // A stream object resolves to its own dictionary, which has no state keys.
    if (direct !== null && dictionaryEntry(normal, "BBox") !== undefined) {
        return direct;
    }
    const state = widget.appearanceState;
    if (state === null) {
        return null;
    }
    const stateRaw = dictionaryEntry(normal, state);
    return stateRaw === undefined ? null : refId(stateRaw);
}

/**
 * The content-stream matrix that maps an appearance onto its annotation
 * rectangle, or null when either has no area to map.
 * @param {number[]} rectangle
 * @param {number[]} bbox
 * @param {number[]} matrix
 * @returns {number[] | null}
 */
function placementMatrix(rectangle, bbox, matrix) {
    const bounds = transformedBounds(bbox, matrix);
    const boundsWidth = bounds[2] - bounds[0];
    const boundsHeight = bounds[3] - bounds[1];
    if (boundsWidth === 0 || boundsHeight === 0) {
        return null;
    }
    const scaleX = (rectangle[2] - rectangle[0]) / boundsWidth;
    const scaleY = (rectangle[3] - rectangle[1]) / boundsHeight;
    return [
        scaleX,
        0,
        0,
        scaleY,
        rectangle[0] - bounds[0] * scaleX,
        rectangle[1] - bounds[1] * scaleY
    ];
}

/**
 * True when an annotation's flags say it is not shown.
 * @param {PdfEditor} editor
 * @param {FormWidget} widget
 * @returns {boolean}
 */
function isHidden(editor, widget) {
    const flags = asNumber(resolveValue(editor, getRaw(widget.entries, "F")));
    if (flags === null) {
        return false;
    }
    return (
        hasFlag(flags, ANNOTATION_FLAGS.HIDDEN) ||
        hasFlag(flags, ANNOTATION_FLAGS.NO_VIEW)
    );
}

/**
 * Where a page's resource dictionary actually lives.
 *
 * /Resources is an inheritable page attribute: a page that declares none uses
 * its nearest ancestor's. Writing a fresh dictionary onto such a page would
 * shadow the inherited one and strip the page of the fonts its own content
 * draws with, so the owner is resolved rather than assumed.
 * @param {PdfEditor} editor
 * @param {number} pageId
 * @returns {{ ownerId: number, inline: boolean }}
 */
function resourceOwner(editor, pageId) {
    let id = pageId;
    for (let depth = 0; depth < 64; depth++) {
        const entries = editor.getDict(id).entries;
        const raw = getRaw(entries, "Resources");
        if (raw !== undefined) {
            const indirect = refId(raw);
            return indirect === null
                ? { ownerId: id, inline: true }
                : { ownerId: indirect, inline: false };
        }
        const parent = getRaw(entries, "Parent");
        const parentId = parent === undefined ? null : refId(parent);
        if (parentId === null) {
            break;
        }
        id = parentId;
    }
    return { ownerId: pageId, inline: true };
}

/**
 * Install a page's painted appearances in its resource dictionary, in one
 * write, so that names added for earlier widgets are not lost to later ones.
 * @param {PdfEditor} editor
 * @param {DictionaryEdits} edits
 * @param {number} pageId
 * @param {Map<string, number>} xobjects
 * @returns {void}
 */
function installXObjects(editor, edits, pageId, xobjects) {
    if (xobjects.size === 0) {
        return;
    }
    const owner = resourceOwner(editor, pageId);
    const working = edits.open(
        owner.ownerId,
        editor.getDict(owner.ownerId).entries
    );

    if (!owner.inline) {
        setXObjectEntry(editor, working, xobjects);
        return;
    }

    // The resource dictionary sits inline on the owner, under /Resources.
    for (let i = 0, len = working.length; i < len; i++) {
        if (working[i].key !== "Resources") {
            continue;
        }
        const inline = resolveValue(editor, working[i].raw);
        /** @type {{ key: string, raw: string }[]} */
        const entries =
            inline.kind === "dictionary"
                ? inline.entries.map((entry) => ({ ...entry }))
                : [];
        setXObjectEntry(editor, entries, xobjects);
        working[i].raw = serializeDict(entries);
        return;
    }
    /** @type {{ key: string, raw: string }[]} */
    const entries = [];
    setXObjectEntry(editor, entries, xobjects);
    working.push({ key: "Resources", raw: serializeDict(entries) });
}

/**
 * Merge names into a resource dictionary's /XObject entry.
 * @param {PdfEditor} editor
 * @param {{ key: string, raw: string }[]} entries
 * @param {Map<string, number>} xobjects
 * @returns {void}
 */
function setXObjectEntry(editor, entries, xobjects) {
    const existing = resolveValue(editor, getRaw(entries, "XObject"));
    /** @type {{ key: string, raw: string }[]} */
    const merged =
        existing.kind === "dictionary"
            ? existing.entries.map((entry) => ({ ...entry }))
            : [];
    for (const [name, objectId] of xobjects) {
        let replaced = false;
        for (let i = 0, len = merged.length; i < len; i++) {
            if (merged[i].key === name) {
                merged[i].raw = objectId + " 0 R";
                replaced = true;
            }
        }
        if (!replaced) {
            merged.push({ key: name, raw: objectId + " 0 R" });
        }
    }
    const serialized = serializeDict(merged);
    for (let i = 0, len = entries.length; i < len; i++) {
        if (entries[i].key === "XObject") {
            entries[i].raw = serialized;
            return;
        }
    }
    entries.push({ key: "XObject", raw: serialized });
}

/**
 * Flatten every field of the document's interactive form.
 *
 * The editor is mutated in place; call its `save()` to serialise the resulting
 * incremental update. A document holding a signature that has been applied is
 * refused: flattening would discard the field the signature covers, leaving a
 * document that claims to be signed and no longer carries what was signed.
 * @param {PdfEditor} editor
 * @returns {FlattenResult}
 */
export function flattenFormFields(editor) {
    const form = readAcroForm(editor);
    if (form === null) {
        return {
            fieldsFlattened: 0,
            widgetsPainted: 0,
            widgetsRemoved: 0,
            withoutAppearance: []
        };
    }

    for (let i = 0, len = form.fields.length; i < len; i++) {
        const field = form.fields[i];
        if (field.type === "signature" && field.value.kind === "signature") {
            throw new Error(
                "flatten: field " +
                    field.name +
                    " carries a signature; flattening would discard what it signed"
            );
        }
    }

    const edits = new DictionaryEdits();
    /** @type {Map<number, { painted: string[], removed: Set<number>, xobjects: Map<string, number> }>} */
    const byPage = new Map();
    /** @type {string[]} */
    const withoutAppearance = [];
    let widgetsPainted = 0;
    let widgetsRemoved = 0;

    for (let i = 0, len = form.fields.length; i < len; i++) {
        const field = form.fields[i];
        for (let j = 0, count = field.widgets.length; j < count; j++) {
            const widget = field.widgets[j];
            if (widget.pageId === null) {
                continue;
            }
            if (!byPage.has(widget.pageId)) {
                byPage.set(widget.pageId, {
                    painted: [],
                    removed: new Set(),
                    xobjects: new Map()
                });
            }
            const page = byPage.get(widget.pageId);
            page.removed.add(widget.id);
            widgetsRemoved = widgetsRemoved + 1;

            const streamId = appearanceStreamId(editor, widget);
            if (streamId === null || widget.rectangle === null) {
                if (!withoutAppearance.includes(field.name)) {
                    withoutAppearance.push(field.name);
                }
                continue;
            }
            if (isHidden(editor, widget)) {
                continue;
            }

            const streamEntries = parseValue(
                editor.getObjectRaw(streamId).dictPart
            );
            const bbox = numberArray(
                editor,
                dictionaryEntry(streamEntries, "BBox"),
                4
            );
            if (bbox === null) {
                if (!withoutAppearance.includes(field.name)) {
                    withoutAppearance.push(field.name);
                }
                continue;
            }
            const matrix =
                numberArray(
                    editor,
                    dictionaryEntry(streamEntries, "Matrix"),
                    6
                ) || IDENTITY;
            const placement = placementMatrix(widget.rectangle, bbox, matrix);
            if (placement === null) {
                continue;
            }

            const name = "FlatFm" + streamId + "x" + widget.id;
            page.xobjects.set(name, streamId);
            page.painted.push(
                "q " +
                    placement.map(formatNumber).join(" ") +
                    " cm /" +
                    name +
                    " Do Q"
            );
            widgetsPainted = widgetsPainted + 1;
        }
    }

    for (const [pageId, page] of byPage) {
        const pageEntries = editor.getDict(pageId).entries;
        const working = edits.open(pageId, pageEntries);
        pruneAnnotations(editor, working, page.removed);
        if (page.painted.length > 0) {
            installXObjects(editor, edits, pageId, page.xobjects);
            appendPageContent(editor, working, page.painted.join("\n"));
        }
    }

    // The catalog's form goes last: every widget it described is gone.
    const catalog = editor.getDict(editor.rootId);
    edits.remove(editor.rootId, catalog.entries, "AcroForm");
    edits.flush(editor);

    return {
        fieldsFlattened: form.fields.length,
        widgetsPainted,
        widgetsRemoved,
        withoutAppearance
    };
}

/**
 * Drop the given annotations from a page's /Annots, keeping the rest.
 * @param {PdfEditor} editor
 * @param {{ key: string, raw: string }[]} working
 * @param {Set<number>} removed
 * @returns {void}
 */
function pruneAnnotations(editor, working, removed) {
    const annots = resolveValue(editor, getRaw(working, "Annots"));
    if (annots.kind !== "array") {
        return;
    }
    /** @type {string[]} */
    const kept = [];
    for (let i = 0, len = annots.items.length; i < len; i++) {
        const item = annots.items[i];
        if (item.kind === "reference" && removed.has(item.id)) {
            continue;
        }
        if (item.kind === "reference") {
            kept.push(item.id + " 0 R");
        }
    }
    for (let i = 0, len = working.length; i < len; i++) {
        if (working[i].key === "Annots") {
            working[i].raw = "[" + kept.join(" ") + "]";
            return;
        }
    }
}

/**
 * Append painting operators to a page.
 *
 * The page's own content is bracketed in a saved graphics state first, so that
 * content leaving the state unbalanced cannot carry a stray transformation into
 * the appearances painted after it.
 * @param {PdfEditor} editor
 * @param {{ key: string, raw: string }[]} working
 * @param {string} operators
 * @returns {void}
 */
function appendPageContent(editor, working, operators) {
    const openId = ++editor.maxId;
    const openBytes = encodeUtf8("q\n");
    editor.added.push({
        id: openId,
        kind: "stream",
        bytes: openBytes,
        text: "<< /Length " + openBytes.length + " >>"
    });

    const paintId = ++editor.maxId;
    const paintBytes = encodeUtf8("Q\n" + operators + "\n");
    editor.added.push({
        id: paintId,
        kind: "stream",
        bytes: paintBytes,
        text: "<< /Length " + paintBytes.length + " >>"
    });

    const contents = getRaw(working, "Contents");
    /** @type {string} */
    let next;
    if (contents === undefined) {
        next = "[" + openId + " 0 R " + paintId + " 0 R]";
    } else if (contents.trim().startsWith("[")) {
        next =
            "[" +
            openId +
            " 0 R " +
            contents.trim().slice(1, -1).trim() +
            " " +
            paintId +
            " 0 R]";
    } else {
        next =
            "[" + openId + " 0 R " + contents.trim() + " " + paintId + " 0 R]";
    }
    for (let i = 0, len = working.length; i < len; i++) {
        if (working[i].key === "Contents") {
            working[i].raw = next;
            return;
        }
    }
    working.push({ key: "Contents", raw: next });
}

export default { flattenFormFields };
