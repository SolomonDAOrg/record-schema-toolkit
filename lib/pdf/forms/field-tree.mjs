/**
 * Reading an AcroForm: the field tree, attribute inheritance, and the widget
 * annotations each terminal field draws itself with.
 *
 * A form is a tree whose interior nodes group fields and whose leaves are the
 * fields that hold values. A leaf inherits /FT, /Ff, /V, /DV, /DA, /Q, /MaxLen
 * and /Opt from its ancestors and, for /DA and /Q, from the AcroForm itself, so
 * a leaf read in isolation misstates its own type and styling. Names compose
 * the same way: the fully-qualified name that addresses a field is its
 * ancestors' partial names and its own, joined by ".".
 *
 * A leaf is a field whose kids, if any, are widget annotations rather than
 * further fields — a kid is a field exactly when it carries a partial name.
 * Where a field has one appearance, producers usually merge the widget into the
 * field dictionary instead of giving it a kid, and both shapes appear in the
 * wild, so the model reports widgets uniformly either way.
 * @module FieldTree
 */

import {
    parseValue,
    parseArrayItems,
    dictionaryEntry,
    asName,
    asNumber
} from "../object-values.mjs";
import { getRaw, refId } from "../reader.mjs";

import {
    COMMON_FIELD_FLAGS,
    TEXT_FIELD_FLAGS,
    BUTTON_FIELD_FLAGS,
    CHOICE_FIELD_FLAGS,
    hasFlag,
    buttonKindFromFlags
} from "./field-flags.mjs";

/** Attributes a field inherits from its ancestors. */
const INHERITED_KEYS = ["FT", "Ff", "V", "DV", "DA", "Q", "MaxLen", "Opt"];

/** Guards against a /Parent or /Kids cycle in a malformed file. */
const MAX_FIELD_DEPTH = 64;

/**
 * @typedef {import("./types.mjs").FormField} FormField
 * @typedef {import("./types.mjs").FormWidget} FormWidget
 * @typedef {import("./types.mjs").FormFieldValue} FormFieldValue
 * @typedef {import("./types.mjs").ChoiceOption} ChoiceOption
 * @typedef {import("./types.mjs").AcroForm} AcroForm
 * @typedef {import("../object-values.mjs").PdfValue} PdfValue
 * @typedef {import("../reader.mjs").PdfEditor} PdfEditor
 */

/**
 * Read an object's dictionary entries, or null when the id names no readable
 * object. A dangling reference in one branch of a form should not prevent the
 * rest from being read.
 * @param {PdfEditor} editor
 * @param {number} id
 * @returns {{ key: string, raw: string }[] | null}
 */
function readDictionary(editor, id) {
    try {
        return editor.getDict(id).entries;
    } catch {
        return null;
    }
}

/**
 * Parse a raw value, following indirect references to the object they name.
 * @param {PdfEditor} editor
 * @param {string | undefined} raw
 * @returns {PdfValue}
 */
export function resolveValue(editor, raw) {
    let value = parseValue(raw);
    let hops = 0;
    while (value.kind === "reference" && hops < MAX_FIELD_DEPTH) {
        hops = hops + 1;
        let body;
        try {
            body = editor.getObjectRaw(value.id).dictPart;
        } catch {
            return { kind: "null" };
        }
        value = parseValue(body);
    }
    return value;
}

/**
 * The object ids an array of references names, in file order.
 * @param {string | undefined} raw
 * @returns {number[]}
 */
function referencedIds(raw) {
    if (raw === undefined) {
        return [];
    }
    /** @type {number[]} */
    const ids = [];
    const items = parseArrayItems(raw);
    for (let i = 0, len = items.length; i < len; i++) {
        const item = items[i];
        if (item.kind === "reference") {
            ids.push(item.id);
        }
    }
    return ids;
}

/**
 * The /AP /N appearance-state names of a widget, excluding Off.
 *
 * A checkbox names its on state whatever the producer chose — "Yes", "1",
 * "On" — so the names have to be read rather than assumed.
 * @param {PdfEditor} editor
 * @param {{ key: string, raw: string }[]} entries
 * @returns {string[]}
 */
function widgetOnStates(editor, entries) {
    const appearance = resolveValue(editor, getRaw(entries, "AP"));
    const normalRaw = dictionaryEntry(appearance, "N");
    if (normalRaw === undefined) {
        return [];
    }
    const normal = resolveValue(editor, normalRaw);
    if (normal.kind !== "dictionary") {
        return [];
    }
    /** @type {string[]} */
    const states = [];
    for (let i = 0, len = normal.entries.length; i < len; i++) {
        const key = normal.entries[i].key;
        if (key !== "Off" && !states.includes(key)) {
            states.push(key);
        }
    }
    return states;
}

/**
 * Normalise a /Rect to [x0, y0, x1, y1] with the lower-left corner first, which
 * is not guaranteed by the file.
 * @param {PdfEditor} editor
 * @param {{ key: string, raw: string }[]} entries
 * @returns {[number, number, number, number] | null}
 */
function widgetRectangle(editor, entries) {
    const rect = resolveValue(editor, getRaw(entries, "Rect"));
    if (rect.kind !== "array" || rect.items.length < 4) {
        return null;
    }
    /** @type {number[]} */
    const numbers = [];
    for (let i = 0; i < 4; i++) {
        const coordinate = asNumber(rect.items[i]);
        if (coordinate === null) {
            return null;
        }
        numbers.push(coordinate);
    }
    return [
        Math.min(numbers[0], numbers[2]),
        Math.min(numbers[1], numbers[3]),
        Math.max(numbers[0], numbers[2]),
        Math.max(numbers[1], numbers[3])
    ];
}

/**
 * Build the widget record for an annotation dictionary.
 * @param {PdfEditor} editor
 * @param {number} id
 * @param {{ key: string, raw: string }[]} entries
 * @param {boolean} merged
 * @returns {FormWidget}
 */
function toWidget(editor, id, entries, merged) {
    const pageRaw = getRaw(entries, "P");
    return {
        id,
        entries,
        rectangle: widgetRectangle(editor, entries),
        pageId: pageRaw === undefined ? null : refId(pageRaw),
        merged,
        onStates: widgetOnStates(editor, entries),
        appearanceState: asName(resolveValue(editor, getRaw(entries, "AS")))
    };
}

/**
 * Interpret a terminal field's /V against its field type.
 * @param {PdfEditor} editor
 * @param {string | undefined} raw
 * @param {string | null} fieldType
 * @returns {FormFieldValue}
 */
function toFieldValue(editor, raw, fieldType) {
    if (raw === undefined) {
        return { kind: "absent" };
    }
    if (fieldType === "Sig") {
        const reference = parseValue(raw);
        return reference.kind === "reference"
            ? { kind: "signature", id: reference.id }
            : { kind: "absent" };
    }
    const value = resolveValue(editor, raw);
    if (value.kind === "name") {
        return { kind: "state", state: value.name };
    }
    if (value.kind === "string") {
        return fieldType === "Ch"
            ? { kind: "selection", values: [value.text] }
            : { kind: "text", text: value.text };
    }
    if (value.kind === "array") {
        /** @type {string[]} */
        const values = [];
        for (let i = 0, len = value.items.length; i < len; i++) {
            const item = value.items[i];
            if (item.kind === "string") {
                values.push(item.text);
            }
        }
        return { kind: "selection", values };
    }
    return { kind: "absent" };
}

/**
 * Read a choice field's /Opt list. An entry is either the export value alone or
 * a two-element array pairing the export value with the text shown.
 * @param {PdfEditor} editor
 * @param {string | undefined} raw
 * @returns {ChoiceOption[]}
 */
function toChoiceOptions(editor, raw) {
    if (raw === undefined) {
        return [];
    }
    const value = resolveValue(editor, raw);
    if (value.kind !== "array") {
        return [];
    }
    /** @type {ChoiceOption[]} */
    const options = [];
    for (let i = 0, len = value.items.length; i < len; i++) {
        const item = value.items[i];
        if (item.kind === "string") {
            options.push({ exportValue: item.text, displayText: item.text });
            continue;
        }
        if (item.kind === "array" && item.items.length >= 2) {
            const exported = item.items[0];
            const displayed = item.items[1];
            if (exported.kind === "string" && displayed.kind === "string") {
                options.push({
                    exportValue: exported.text,
                    displayText: displayed.text
                });
            }
        }
    }
    return options;
}

/**
 * Assemble a terminal field from its own entries and the attributes in force at
 * its position in the tree.
 * @param {PdfEditor} editor
 * @param {number} id
 * @param {{ key: string, raw: string }[]} entries
 * @param {string[]} namePath
 * @param {Record<string, string>} inherited
 * @param {FormWidget[]} widgets
 * @returns {FormField}
 */
function toField(editor, id, entries, namePath, inherited, widgets) {
    const fieldType = inherited.FT ? asName(parseValue(inherited.FT)) : null;
    const flagsValue = inherited.Ff ? asNumber(parseValue(inherited.Ff)) : null;
    const fieldFlags = flagsValue === null ? 0 : flagsValue;
    const quadding = inherited.Q ? asNumber(parseValue(inherited.Q)) : null;
    const defaultAppearanceValue = inherited.DA
        ? resolveValue(editor, inherited.DA)
        : { kind: /** @type {const} */ ("null") };

    /** @type {import("./types.mjs").FormFieldBase} */
    const base = {
        id,
        entries,
        name: namePath.join("."),
        namePath,
        fieldFlags,
        readOnly: hasFlag(fieldFlags, COMMON_FIELD_FLAGS.READ_ONLY),
        required: hasFlag(fieldFlags, COMMON_FIELD_FLAGS.REQUIRED),
        noExport: hasFlag(fieldFlags, COMMON_FIELD_FLAGS.NO_EXPORT),
        defaultAppearance:
            defaultAppearanceValue.kind === "string"
                ? defaultAppearanceValue.text
                : null,
        quadding,
        value: toFieldValue(editor, inherited.V, fieldType),
        defaultValue: toFieldValue(editor, inherited.DV, fieldType),
        widgets
    };

    if (fieldType === "Tx") {
        const maxLength = inherited.MaxLen
            ? asNumber(parseValue(inherited.MaxLen))
            : null;
        return {
            ...base,
            type: "text",
            multiline: hasFlag(fieldFlags, TEXT_FIELD_FLAGS.MULTILINE),
            password: hasFlag(fieldFlags, TEXT_FIELD_FLAGS.PASSWORD),
            fileSelect: hasFlag(fieldFlags, TEXT_FIELD_FLAGS.FILE_SELECT),
            doNotSpellCheck: hasFlag(
                fieldFlags,
                TEXT_FIELD_FLAGS.DO_NOT_SPELL_CHECK
            ),
            doNotScroll: hasFlag(fieldFlags, TEXT_FIELD_FLAGS.DO_NOT_SCROLL),
            comb: hasFlag(fieldFlags, TEXT_FIELD_FLAGS.COMB),
            richText: hasFlag(fieldFlags, TEXT_FIELD_FLAGS.RICH_TEXT),
            maxLength
        };
    }
    if (fieldType === "Btn") {
        /** @type {string[]} */
        const onStates = [];
        for (let i = 0, len = widgets.length; i < len; i++) {
            const states = widgets[i].onStates;
            for (let j = 0, count = states.length; j < count; j++) {
                if (!onStates.includes(states[j])) {
                    onStates.push(states[j]);
                }
            }
        }
        return {
            ...base,
            type: "button",
            buttonKind: buttonKindFromFlags(fieldFlags),
            noToggleToOff: hasFlag(
                fieldFlags,
                BUTTON_FIELD_FLAGS.NO_TOGGLE_TO_OFF
            ),
            radiosInUnison: hasFlag(
                fieldFlags,
                BUTTON_FIELD_FLAGS.RADIOS_IN_UNISON
            ),
            onStates
        };
    }
    if (fieldType === "Ch") {
        return {
            ...base,
            type: "choice",
            combo: hasFlag(fieldFlags, CHOICE_FIELD_FLAGS.COMBO),
            edit: hasFlag(fieldFlags, CHOICE_FIELD_FLAGS.EDIT),
            sort: hasFlag(fieldFlags, CHOICE_FIELD_FLAGS.SORT),
            multiSelect: hasFlag(fieldFlags, CHOICE_FIELD_FLAGS.MULTI_SELECT),
            commitOnSelChange: hasFlag(
                fieldFlags,
                CHOICE_FIELD_FLAGS.COMMIT_ON_SEL_CHANGE
            ),
            doNotSpellCheck: hasFlag(
                fieldFlags,
                CHOICE_FIELD_FLAGS.DO_NOT_SPELL_CHECK
            ),
            options: toChoiceOptions(editor, inherited.Opt)
        };
    }
    if (fieldType === "Sig") {
        return { ...base, type: "signature" };
    }
    return { ...base, type: "unknown", fieldType };
}

/**
 * Walk one node of the field tree, appending the terminal fields beneath it.
 * @param {PdfEditor} editor
 * @param {number} id
 * @param {string[]} parentPath
 * @param {Record<string, string>} parentInherited
 * @param {FormField[]} out
 * @param {Set<number>} seen
 * @param {number} depth
 * @returns {void}
 */
function collect(editor, id, parentPath, parentInherited, out, seen, depth) {
    if (seen.has(id) || depth > MAX_FIELD_DEPTH) {
        return;
    }
    seen.add(id);
    const entries = readDictionary(editor, id);
    if (entries === null) {
        return;
    }

    /** @type {Record<string, string>} */
    const inherited = { ...parentInherited };
    for (let i = 0, len = INHERITED_KEYS.length; i < len; i++) {
        const key = INHERITED_KEYS[i];
        const raw = getRaw(entries, key);
        if (raw !== undefined) {
            inherited[key] = raw;
        }
    }

    const partialValue = resolveValue(editor, getRaw(entries, "T"));
    const namePath =
        partialValue.kind === "string" && partialValue.text.length > 0
            ? [...parentPath, partialValue.text]
            : parentPath;

    const kidIds = referencedIds(getRaw(entries, "Kids"));
    /** @type {{ id: number, entries: { key: string, raw: string }[] }[]} */
    const fieldKids = [];
    /** @type {FormWidget[]} */
    const widgetKids = [];
    for (let i = 0, len = kidIds.length; i < len; i++) {
        const kidEntries = readDictionary(editor, kidIds[i]);
        if (kidEntries === null) {
            continue;
        }
        if (getRaw(kidEntries, "T") !== undefined) {
            fieldKids.push({ id: kidIds[i], entries: kidEntries });
        } else {
            widgetKids.push(toWidget(editor, kidIds[i], kidEntries, false));
        }
    }

    if (fieldKids.length > 0) {
        for (let i = 0, len = fieldKids.length; i < len; i++) {
            collect(
                editor,
                fieldKids[i].id,
                namePath,
                inherited,
                out,
                seen,
                depth + 1
            );
        }
        return;
    }

    const widgets =
        widgetKids.length > 0
            ? widgetKids
            : asName(parseValue(getRaw(entries, "Subtype") || "")) === "Widget"
            ? [toWidget(editor, id, entries, true)]
            : [];

    out.push(toField(editor, id, entries, namePath, inherited, widgets));
}

/**
 * Read the document's interactive form.
 *
 * Returns null when the catalog declares no AcroForm. A form whose /AcroForm is
 * a direct dictionary is rejected: filling writes the dictionary back as an
 * indirect object, which a direct one has no identity for.
 * @param {PdfEditor} editor
 * @returns {AcroForm | null}
 */
export function readAcroForm(editor) {
    const catalog = editor.getDict(editor.rootId);
    const raw = getRaw(catalog.entries, "AcroForm");
    if (raw === undefined) {
        return null;
    }
    const id = refId(raw);
    if (id === null) {
        throw new Error("forms: /AcroForm must be an indirect object");
    }
    const entries = editor.getDict(id).entries;

    /** @type {FormField[]} */
    const fields = [];
    const seen = new Set();
    /** @type {Record<string, string>} */
    const formInherited = {};
    const formDefaultAppearance = getRaw(entries, "DA");
    const formQuadding = getRaw(entries, "Q");
    if (formDefaultAppearance !== undefined) {
        formInherited.DA = formDefaultAppearance;
    }
    if (formQuadding !== undefined) {
        formInherited.Q = formQuadding;
    }

    const rootIds = referencedIds(getRaw(entries, "Fields"));
    for (let i = 0, len = rootIds.length; i < len; i++) {
        collect(editor, rootIds[i], [], formInherited, fields, seen, 0);
    }

    const defaultResourcesRaw = getRaw(entries, "DR");
    const needAppearances = resolveValue(
        editor,
        getRaw(entries, "NeedAppearances")
    );
    const defaultAppearance = resolveValue(editor, formDefaultAppearance);

    return {
        id,
        entries,
        defaultAppearance:
            defaultAppearance.kind === "string" ? defaultAppearance.text : null,
        defaultResourcesId:
            defaultResourcesRaw === undefined
                ? null
                : refId(defaultResourcesRaw),
        defaultResourcesRaw: defaultResourcesRaw ?? null,
        needAppearances:
            needAppearances.kind === "boolean" && needAppearances.value,
        hasXfa: getRaw(entries, "XFA") !== undefined,
        fields
    };
}

/**
 * Index fields by fully-qualified name.
 *
 * A name that two terminal fields share is a defect in the file, and it is
 * reported rather than resolved by discarding one of them.
 * @param {FormField[]} fields
 * @returns {Map<string, FormField>}
 */
export function indexFieldsByName(fields) {
    /** @type {Map<string, FormField>} */
    const index = new Map();
    for (let i = 0, len = fields.length; i < len; i++) {
        const field = fields[i];
        if (index.has(field.name)) {
            throw new Error(
                "forms: duplicate fully-qualified field name: " + field.name
            );
        }
        index.set(field.name, field);
    }
    return index;
}

export default { readAcroForm, indexFieldsByName, resolveValue };
