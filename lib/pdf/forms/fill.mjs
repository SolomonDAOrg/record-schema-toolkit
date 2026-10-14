/**
 * Writing values into an interactive form.
 *
 * A fill sets each field's /V, updates what its widgets display, and leaves the
 * rest of the document byte-for-byte alone: the reader appends an incremental
 * update, so the original revision survives intact underneath. Both halves
 * matter. /V is what a reader extracting data sees; the widget's appearance is
 * what a person or a printer sees, and a viewer only regenerates appearances if
 * the form asks it to, so this writes them rather than deferring.
 *
 * Values are checked against the field they are going to. A button is set to a
 * state its own appearance dictionary declares, a choice to an option its /Opt
 * lists, a text value against /MaxLen; anything else is refused rather than
 * written as a value the form has no meaning for. Nothing is invented to make a
 * value fit: a field whose form supplies no font for its /DA, or a button with
 * no appearance for the requested state, is reported as an error naming the
 * field.
 *
 * XFA is the one thing a caller must decide for itself. A form carrying an /XFA
 * entry describes its fields twice, and the two descriptions are filled
 * differently; writing only the AcroForm half leaves a viewer that prefers XFA
 * showing the unfilled form. Rather than guess, a fill of such a form requires
 * an explicit `xfa` choice.
 * @module FormFill
 */

import { DictionaryEdits } from "../dictionary-edits.mjs";
import { encodeTextString } from "../encoding/index.mjs";
import { escapePdfName, encodeUtf8 } from "../primitives.mjs";
import { getRaw, serializeDict } from "../reader.mjs";

import {
    buildTextAppearanceStream,
    buildAppearanceXObject
} from "./appearance.mjs";
import {
    layoutSingleLine,
    layoutMultiLine,
    layoutComb
} from "./appearance-layout.mjs";
import { parseDefaultAppearance } from "./default-appearance.mjs";
import {
    readAcroForm,
    indexFieldsByName,
    resolveValue
} from "./field-tree.mjs";
import { resolveFormFont } from "./font-resource.mjs";

/** The appearance state of an unselected button. */
const OFF_STATE = "Off";

/**
 * @typedef {import("./types.mjs").FormField} FormField
 * @typedef {import("./types.mjs").FormWidget} FormWidget
 * @typedef {import("./types.mjs").FormFieldInput} FormFieldInput
 * @typedef {import("./types.mjs").AcroForm} AcroForm
 * @typedef {import("./font-resource.mjs").FormFont} FormFont
 * @typedef {import("./default-appearance.mjs").DefaultAppearance} DefaultAppearance
 * @typedef {import("../reader.mjs").PdfEditor} PdfEditor
 */

/**
 * @typedef {Object} FillOptions
 * @property {"keep" | "remove"} [xfa] - Required when the form carries /XFA.
 * @property {boolean} [needAppearances=false] - Also ask the viewer to regenerate appearances.
 * @property {boolean} [allowReadOnly=false] - Permit writing to fields flagged read-only.
 * @property {boolean} [generateAppearances=true] - Write appearance streams for the values set.
 */

/**
 * @typedef {Object} FilledField
 * @property {string} name
 * @property {FormField["type"]} type
 * @property {number} widgetsUpdated - Widgets whose appearance or state was rewritten.
 * @property {string[]} unmappedCharacters - Characters the field's font cannot encode.
 */

/**
 * @typedef {Object} FillResult
 * @property {FilledField[]} filled
 * @property {boolean} xfaRemoved
 * @property {boolean} needAppearancesSet
 */

/**
 * The font a field draws its value with, and the /DA that selected it.
 * @param {PdfEditor} editor
 * @param {AcroForm} form
 * @param {FormField} field
 * @returns {{ appearance: DefaultAppearance, font: FormFont | null }}
 */
function fieldFont(editor, form, field) {
    const appearance = parseDefaultAppearance(
        field.defaultAppearance ?? form.defaultAppearance
    );
    const font =
        appearance.fontResource === null
            ? null
            : resolveFormFont(
                  editor,
                  form.defaultResourcesRaw,
                  appearance.fontResource
              );
    if (appearance.fontResource !== null && font === null) {
        throw new Error(
            "forms: field " +
                field.name +
                " names font /" +
                appearance.fontResource +
                ", which the form's /DR does not define"
        );
    }
    return { appearance, font };
}

/**
 * Lay out and emit the appearance stream for one widget of a variable-text
 * field, returning the new XObject's object id.
 * @param {PdfEditor} editor
 * @param {FormField} field
 * @param {FormWidget} widget
 * @param {string} text
 * @param {DefaultAppearance} appearance
 * @param {FormFont | null} font
 * @returns {{ objectId: number, unmapped: string[] }}
 */
function writeTextAppearance(editor, field, widget, text, appearance, font) {
    if (widget.rectangle === null) {
        throw new Error(
            "forms: widget of field " + field.name + " has no usable /Rect"
        );
    }
    const boxWidth = widget.rectangle[2] - widget.rectangle[0];
    const boxHeight = widget.rectangle[3] - widget.rectangle[1];

    const combCells =
        field.type === "text" && field.comb && field.maxLength !== null
            ? field.maxLength
            : null;
    const layout =
        combCells !== null
            ? layoutComb(
                  font,
                  text,
                  appearance.fontSize,
                  boxWidth,
                  boxHeight,
                  combCells
              )
            : field.type === "text" && field.multiline
            ? layoutMultiLine(
                  font,
                  text,
                  appearance.fontSize,
                  boxWidth,
                  boxHeight,
                  field.quadding
              )
            : layoutSingleLine(
                  font,
                  text,
                  appearance.fontSize,
                  boxWidth,
                  boxHeight,
                  field.quadding
              );

    const stream = buildTextAppearanceStream(
        layout,
        font,
        appearance,
        boxWidth,
        boxHeight
    );
    const bytes = encodeUtf8(stream.content);
    const objectId = ++editor.maxId;
    editor.added.push({
        id: objectId,
        kind: "stream",
        bytes,
        text: buildAppearanceXObject(
            boxWidth,
            boxHeight,
            appearance.fontResource === null ? "Helv" : appearance.fontResource,
            font === null ? null : font.objectId,
            bytes.length
        )
    });
    return { objectId, unmapped: stream.unmapped };
}

/**
 * Point a widget's /AP /N at a new appearance stream, keeping any /D and /R
 * entries the widget already had.
 * @param {PdfEditor} editor
 * @param {DictionaryEdits} edits
 * @param {FormWidget} widget
 * @param {number} appearanceId
 * @returns {void}
 */
function setNormalAppearance(editor, edits, widget, appearanceId) {
    const existing = resolveValue(editor, getRaw(widget.entries, "AP"));
    /** @type {{ key: string, raw: string }[]} */
    const entries =
        existing.kind === "dictionary"
            ? existing.entries.map((entry) => ({ ...entry }))
            : [];
    let replaced = false;
    for (let i = 0, len = entries.length; i < len; i++) {
        if (entries[i].key === "N") {
            entries[i].raw = appearanceId + " 0 R";
            replaced = true;
        }
    }
    if (!replaced) {
        entries.push({ key: "N", raw: appearanceId + " 0 R" });
    }
    edits.set(widget.id, widget.entries, "AP", serializeDict(entries));
}

/**
 * Collect the characters an appearance could not encode, without duplicates.
 * @param {string[]} into
 * @param {string[]} characters
 * @returns {void}
 */
function mergeUnmapped(into, characters) {
    for (let i = 0, len = characters.length; i < len; i++) {
        if (!into.includes(characters[i])) {
            into.push(characters[i]);
        }
    }
}

/**
 * Reject an input whose shape the field cannot hold.
 * @param {FormField} field
 * @param {FormFieldInput} input
 * @returns {string}
 */
function requireString(field, input) {
    if (typeof input !== "string") {
        throw new Error(
            "forms: field " +
                field.name +
                " is a " +
                field.type +
                " field and takes a string value"
        );
    }
    return input;
}

/**
 * Draw `text` into every widget of a variable-text field.
 * @param {PdfEditor} editor
 * @param {DictionaryEdits} edits
 * @param {AcroForm} form
 * @param {FormField} field
 * @param {string} text
 * @returns {string[]} characters the font could not encode
 */
function drawValue(editor, edits, form, field, text) {
    const { appearance, font } = fieldFont(editor, form, field);
    /** @type {string[]} */
    const unmapped = [];
    for (let i = 0, len = field.widgets.length; i < len; i++) {
        const widget = field.widgets[i];
        const written = writeTextAppearance(
            editor,
            field,
            widget,
            text,
            appearance,
            font
        );
        mergeUnmapped(unmapped, written.unmapped);
        setNormalAppearance(editor, edits, widget, written.objectId);
    }
    return unmapped;
}

/**
 * Apply a value to a text field.
 * @param {PdfEditor} editor
 * @param {DictionaryEdits} edits
 * @param {AcroForm} form
 * @param {import("./types.mjs").TextFormField} field
 * @param {FormFieldInput} input
 * @param {boolean} generateAppearances
 * @returns {FilledField}
 */
function fillTextField(editor, edits, form, field, input, generateAppearances) {
    if (input === null) {
        edits.remove(field.id, field.entries, "V");
        return {
            name: field.name,
            type: field.type,
            widgetsUpdated: 0,
            unmappedCharacters: []
        };
    }
    const text = requireString(field, input);
    const length = [...text].length;
    if (field.maxLength !== null && length > field.maxLength) {
        throw new Error(
            "forms: value for field " +
                field.name +
                " is " +
                length +
                " characters and exceeds its /MaxLen of " +
                field.maxLength
        );
    }

    edits.set(field.id, field.entries, "V", encodeTextString(text));
    if (!generateAppearances) {
        return {
            name: field.name,
            type: field.type,
            widgetsUpdated: 0,
            unmappedCharacters: []
        };
    }
    return {
        name: field.name,
        type: field.type,
        widgetsUpdated: field.widgets.length,
        unmappedCharacters: drawValue(editor, edits, form, field, text)
    };
}

/**
 * Apply a value to a button field.
 *
 * The state written must be one the widget's own /AP declares; a state the file
 * has no appearance for would leave the button set to something no viewer can
 * draw. Each widget is set to the chosen state only if it owns that state, and
 * to Off otherwise, which is how a radio group's widgets share one value.
 * @param {DictionaryEdits} edits
 * @param {import("./types.mjs").ButtonFormField} field
 * @param {FormFieldInput} input
 * @returns {FilledField}
 */
function fillButtonField(edits, field, input) {
    if (field.buttonKind === "push") {
        throw new Error(
            "forms: field " + field.name + " is a pushbutton and holds no value"
        );
    }

    /** @type {string} */
    let state;
    if (input === false || input === null) {
        state = OFF_STATE;
    } else if (input === true) {
        if (field.onStates.length !== 1) {
            throw new Error(
                "forms: field " +
                    field.name +
                    " has " +
                    field.onStates.length +
                    " on states, so it must be set by name, not true"
            );
        }
        state = field.onStates[0];
    } else {
        state = requireString(field, input);
        if (state !== OFF_STATE && !field.onStates.includes(state)) {
            throw new Error(
                "forms: field " +
                    field.name +
                    " has no appearance state " +
                    state +
                    "; it declares " +
                    (field.onStates.length === 0
                        ? "none"
                        : field.onStates.join(", "))
            );
        }
    }

    edits.set(field.id, field.entries, "V", escapePdfName(state));

    for (let i = 0, len = field.widgets.length; i < len; i++) {
        const widget = field.widgets[i];
        const widgetState =
            state !== OFF_STATE && widget.onStates.includes(state)
                ? state
                : OFF_STATE;
        edits.set(widget.id, widget.entries, "AS", escapePdfName(widgetState));
    }
    return {
        name: field.name,
        type: field.type,
        widgetsUpdated: field.widgets.length,
        unmappedCharacters: []
    };
}

/**
 * Apply a value to a choice field.
 *
 * Values name export values from /Opt. A field that permits free text accepts a
 * value outside the list; one that does not refuses it, since the form offers
 * no meaning for it.
 * @param {PdfEditor} editor
 * @param {DictionaryEdits} edits
 * @param {AcroForm} form
 * @param {import("./types.mjs").ChoiceFormField} field
 * @param {FormFieldInput} input
 * @param {boolean} generateAppearances
 * @returns {FilledField}
 */
function fillChoiceField(
    editor,
    edits,
    form,
    field,
    input,
    generateAppearances
) {
    if (input === null) {
        edits.remove(field.id, field.entries, "V");
        return {
            name: field.name,
            type: field.type,
            widgetsUpdated: 0,
            unmappedCharacters: []
        };
    }
    if (typeof input === "boolean") {
        throw new Error(
            "forms: field " +
                field.name +
                " is a choice field and takes a string or an array of strings"
        );
    }
    const selections = typeof input === "string" ? [input] : input;
    if (selections.length === 0) {
        throw new Error(
            "forms: field " +
                field.name +
                " was given an empty selection; pass null to clear it"
        );
    }
    if (selections.length > 1 && !field.multiSelect) {
        throw new Error(
            "forms: field " +
                field.name +
                " is not multi-select and takes a single value"
        );
    }
    if (field.options.length > 0 && !field.edit) {
        for (let i = 0, len = selections.length; i < len; i++) {
            const known = field.options.some(
                (option) => option.exportValue === selections[i]
            );
            if (!known) {
                throw new Error(
                    "forms: field " +
                        field.name +
                        " has no option with export value " +
                        JSON.stringify(selections[i])
                );
            }
        }
    }

    edits.set(
        field.id,
        field.entries,
        "V",
        selections.length === 1
            ? encodeTextString(selections[0])
            : "[" + selections.map(encodeTextString).join(" ") + "]"
    );

    if (field.options.length > 0) {
        /** @type {number[]} */
        const indices = [];
        for (let i = 0, len = field.options.length; i < len; i++) {
            if (selections.includes(field.options[i].exportValue)) {
                indices.push(i);
            }
        }
        if (indices.length > 0) {
            edits.set(
                field.id,
                field.entries,
                "I",
                "[" + indices.join(" ") + "]"
            );
        }
    }

    if (!generateAppearances) {
        return {
            name: field.name,
            type: field.type,
            widgetsUpdated: 0,
            unmappedCharacters: []
        };
    }

    const shownOption = field.options.find(
        (option) => option.exportValue === selections[0]
    );
    const shown =
        shownOption === undefined ? selections[0] : shownOption.displayText;
    return {
        name: field.name,
        type: field.type,
        widgetsUpdated: field.widgets.length,
        unmappedCharacters: drawValue(editor, edits, form, field, shown)
    };
}

/**
 * Write values into the document's interactive form.
 *
 * The editor is mutated in place; call its `save()` to serialise the resulting
 * incremental update. Keys of `values` are fully-qualified field names as
 * `readAcroForm` reports them. Every name and value is checked before anything
 * is written, so a rejected fill leaves the editor untouched.
 * @param {PdfEditor} editor
 * @param {Record<string, FormFieldInput>} values
 * @param {FillOptions} [options]
 * @returns {FillResult}
 */
export function fillFormFields(editor, values, options) {
    const settings = options || {};
    const generateAppearances = settings.generateAppearances !== false;

    const form = readAcroForm(editor);
    if (form === null) {
        throw new Error("forms: the document declares no AcroForm");
    }
    if (form.hasXfa && settings.xfa === undefined) {
        throw new Error(
            "forms: this form carries an /XFA entry, which describes its" +
                ' fields a second time. Pass xfa: "remove" to drop the XFA' +
                " description so viewers use the filled AcroForm, or" +
                ' xfa: "keep" to leave it in place.'
        );
    }

    const index = indexFieldsByName(form.fields);
    /** @type {{ field: FormField, input: FormFieldInput }[]} */
    const planned = [];
    const names = Object.keys(values);
    for (let i = 0, len = names.length; i < len; i++) {
        const field = index.get(names[i]);
        if (field === undefined) {
            throw new Error("forms: no field named " + names[i]);
        }
        if (field.readOnly && settings.allowReadOnly !== true) {
            throw new Error(
                "forms: field " +
                    names[i] +
                    " is read-only; pass allowReadOnly to write it anyway"
            );
        }
        if (field.type === "signature") {
            throw new Error(
                "forms: field " +
                    names[i] +
                    " is a signature field; use addSignatureField and saveSigned"
            );
        }
        if (field.type === "unknown") {
            throw new Error(
                "forms: field " +
                    names[i] +
                    " declares no usable /FT and cannot be filled"
            );
        }
        planned.push({ field, input: values[names[i]] });
    }

    const edits = new DictionaryEdits();
    /** @type {FilledField[]} */
    const filled = [];
    for (let i = 0, len = planned.length; i < len; i++) {
        const { field, input } = planned[i];
        if (field.type === "text") {
            filled.push(
                fillTextField(
                    editor,
                    edits,
                    form,
                    field,
                    input,
                    generateAppearances
                )
            );
            continue;
        }
        if (field.type === "button") {
            filled.push(fillButtonField(edits, field, input));
            continue;
        }
        if (field.type === "signature") {
            continue;
        }
        filled.push(
            fillChoiceField(
                editor,
                edits,
                form,
                /** @type {import("./types.mjs").ChoiceFormField} */ (field),
                input,
                generateAppearances
            )
        );
    }

    const needAppearancesSet = settings.needAppearances === true;
    const xfaRemoved = form.hasXfa && settings.xfa === "remove";
    if (needAppearancesSet) {
        edits.set(form.id, form.entries, "NeedAppearances", "true");
    }
    if (xfaRemoved) {
        edits.remove(form.id, form.entries, "XFA");
    }

    edits.flush(editor);
    return { filled, xfaRemoved, needAppearancesSet };
}

/**
 * Read every value the form currently holds, keyed by fully-qualified name.
 * @param {PdfEditor} editor
 * @returns {Map<string, import("./types.mjs").FormFieldValue>}
 */
export function readFormValues(editor) {
    const form = readAcroForm(editor);
    /** @type {Map<string, import("./types.mjs").FormFieldValue>} */
    const values = new Map();
    if (form === null) {
        return values;
    }
    for (let i = 0, len = form.fields.length; i < len; i++) {
        values.set(form.fields[i].name, form.fields[i].value);
    }
    return values;
}

export default { fillFormFields, readFormValues };
