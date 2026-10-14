/**
 * The interactive-form model: what a reader of an AcroForm gets back, and what
 * a filler accepts.
 *
 * Field kinds are a discriminated union rather than one record with optional
 * members, so that a property only exists where the format defines it: a comb
 * setting belongs to a text field and an option list to a choice field, and
 * neither is meaningful on the other. Values are likewise tagged, because a
 * text field's string, a button's state name and a list box's selection are
 * different things that a bare string would flatten together.
 * @module FormTypes
 */

/**
 * A widget annotation: one on-page appearance of a field. A field with a single
 * appearance usually merges the widget into the field dictionary, in which case
 * the widget's `id` is the field's own object id.
 * @typedef {Object} FormWidget
 * @property {number} id - Object id of the annotation dictionary.
 * @property {{ key: string, raw: string }[]} entries
 * @property {[number, number, number, number] | null} rectangle - Normalised /Rect as [x0, y0, x1, y1] in default user space.
 * @property {number | null} pageId - Object id of the /P page, when the annotation names one.
 * @property {boolean} merged - True when the annotation and the field are one dictionary.
 * @property {string[]} onStates - /AP /N keys other than Off, in file order.
 * @property {string | null} appearanceState - The /AS name currently selected.
 */

/**
 * The value a field carries. `absent` distinguishes a field with no /V from one
 * whose /V is an empty string, which are different states in a form.
 * @typedef {(
 *   | { kind: "absent" }
 *   | { kind: "text", text: string }
 *   | { kind: "state", state: string }
 *   | { kind: "selection", values: string[] }
 *   | { kind: "signature", id: number }
 * )} FormFieldValue
 */

/**
 * One entry of a choice field's /Opt list. `exportValue` is what the form
 * submits; `displayText` is what the viewer shows, and equals `exportValue`
 * when the entry is a bare string rather than a pair.
 * @typedef {Object} ChoiceOption
 * @property {string} exportValue
 * @property {string} displayText
 */

/**
 * Members every field kind carries.
 * @typedef {Object} FormFieldBase
 * @property {number} id - Object id of the terminal field dictionary.
 * @property {{ key: string, raw: string }[]} entries
 * @property {string} name - Fully-qualified name: partial names joined by ".".
 * @property {string[]} namePath - The partial names that compose `name`.
 * @property {number} fieldFlags - The inherited /Ff bit field, 0 when unset.
 * @property {boolean} readOnly
 * @property {boolean} required
 * @property {boolean} noExport
 * @property {string | null} defaultAppearance - Inherited /DA string, or null.
 * @property {number | null} quadding - Inherited /Q, or null when unset.
 * @property {FormFieldValue} value
 * @property {FormFieldValue} defaultValue - The inherited /DV.
 * @property {FormWidget[]} widgets
 */

/**
 * @typedef {FormFieldBase & {
 *   type: "text",
 *   multiline: boolean,
 *   password: boolean,
 *   fileSelect: boolean,
 *   doNotSpellCheck: boolean,
 *   doNotScroll: boolean,
 *   comb: boolean,
 *   richText: boolean,
 *   maxLength: number | null
 * }} TextFormField
 */

/**
 * `buttonKind` follows the /Ff radio and pushbutton bits. `onStates` is the
 * union of the widgets' appearance states, which is what a caller must choose
 * from when checking a box or selecting a radio option.
 * @typedef {FormFieldBase & {
 *   type: "button",
 *   buttonKind: "checkbox" | "radio" | "push",
 *   noToggleToOff: boolean,
 *   radiosInUnison: boolean,
 *   onStates: string[]
 * }} ButtonFormField
 */

/**
 * @typedef {FormFieldBase & {
 *   type: "choice",
 *   combo: boolean,
 *   edit: boolean,
 *   sort: boolean,
 *   multiSelect: boolean,
 *   commitOnSelChange: boolean,
 *   doNotSpellCheck: boolean,
 *   options: ChoiceOption[]
 * }} ChoiceFormField
 */

/**
 * @typedef {FormFieldBase & { type: "signature" }} SignatureFormField
 */

/**
 * A terminal field whose /FT is missing or unrecognised. Kept in the model
 * rather than dropped, so that enumerating a form accounts for every field the
 * file actually declares.
 * @typedef {FormFieldBase & { type: "unknown", fieldType: string | null }} UnknownFormField
 */

/**
 * @typedef {(
 *   | TextFormField
 *   | ButtonFormField
 *   | ChoiceFormField
 *   | SignatureFormField
 *   | UnknownFormField
 * )} FormField
 */

/**
 * The AcroForm dictionary itself, with the pieces a filler needs.
 * @typedef {Object} AcroForm
 * @property {number} id - Object id of the AcroForm dictionary.
 * @property {{ key: string, raw: string }[]} entries
 * @property {string | null} defaultAppearance - Form-wide /DA.
 * @property {number | null} defaultResourcesId - Object id of /DR when indirect.
 * @property {string | null} defaultResourcesRaw - Raw /DR when direct.
 * @property {boolean} needAppearances
 * @property {boolean} hasXfa - True when /XFA is present.
 * @property {FormField[]} fields
 */

/**
 * The value a caller assigns to a field.
 *
 * A string sets a text field or names a button state or choice option; an array
 * of strings sets a multi-select list box; `false` clears a button to Off; null
 * removes the value. The kinds a given field accepts are checked at fill time
 * against that field's type.
 * @typedef {string | string[] | boolean | null} FormFieldInput
 */

export {};
