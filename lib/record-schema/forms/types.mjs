/**
 * The form-pack model: what a pack declares, and what binding an instance to
 * one produces.
 *
 * Binding kinds are a discriminated union on `bind`, because the kinds differ
 * in how a value reaches the page — whole, split across boxes, as a selected
 * button, as a chosen option — and each carries the targets that only its own
 * kind has. A pack that tried to express all of them in one shape would have to
 * leave most of its properties optional, and an omission would then be
 * indistinguishable from a mistake.
 * @module forms/types
 */

/**
 * @typedef {Object} FormPackData
 * @property {string} schema
 * @property {number} schema_version
 * @property {string} pack_id
 * @property {string} [description]
 * @property {string[]} [imports]
 * @property {Record<string, FormDefinition>} forms
 */

/**
 * @typedef {Object} FormDocument
 * @property {string} path - Path to the PDF, resolved the way pack imports are.
 * @property {string} sha256 - Checksum of the revision this pack was written against.
 */

/**
 * What to do with a template field the instance leaves unresolved.
 *
 * `placeholder` writes the template's draft placeholder, which only a text
 * target can show; a button target treats it as `blank` and is cleared.
 * @typedef {"skip" | "blank" | "placeholder" | "error"} UnresolvedPolicy
 */

/**
 * @typedef {Object} FormDefinition
 * @property {string} [title]
 * @property {FormDocument} document
 * @property {"keep" | "remove"} xfa
 * @property {boolean} [need_appearances]
 * @property {boolean} [allow_read_only]
 * @property {UnresolvedPolicy} unresolved
 * @property {FormBinding[]} bindings
 */

/**
 * Which reading of an instance field to write: the display form the template's
 * own typing produces, or the raw value behind it.
 * @typedef {"text" | "value"} BindingSource
 */

/**
 * @typedef {Object} TextBinding
 * @property {"text"} bind
 * @property {string} field
 * @property {string} target
 * @property {BindingSource} [source]
 */

/**
 * @typedef {Object} SegmentTarget
 * @property {string} target
 * @property {number} length
 */

/**
 * @typedef {Object} SegmentsBinding
 * @property {"segments"} bind
 * @property {string} field
 * @property {BindingSource} [source]
 * @property {"all" | "digits" | "letters" | "alphanumeric"} [retain]
 * @property {SegmentTarget[]} segments
 */

/**
 * @typedef {Object} CheckBinding
 * @property {"check"} bind
 * @property {string} field
 * @property {string} target
 * @property {string} [on_state]
 * @property {boolean} [when] - The boolean value that selects the button; defaults to true.
 */

/**
 * @typedef {Object} ButtonGroupOption
 * @property {string} value
 * @property {string} target
 * @property {string} [on_state]
 */

/**
 * @typedef {Object} ButtonGroupBinding
 * @property {"button_group"} bind
 * @property {string} field
 * @property {ButtonGroupOption[]} options
 */

/**
 * @typedef {Object} ChoiceOptionBinding
 * @property {string} value
 * @property {string} export
 */

/**
 * @typedef {Object} ChoiceBinding
 * @property {"choice"} bind
 * @property {string} field
 * @property {string} target
 * @property {ChoiceOptionBinding[]} options
 */

/**
 * @typedef {(
 *   | TextBinding
 *   | SegmentsBinding
 *   | CheckBinding
 *   | ButtonGroupBinding
 *   | ChoiceBinding
 * )} FormBinding
 */

/**
 * The result of binding an instance to a form.
 *
 * `values` is ready to hand to the PDF layer. `unresolved` names the template
 * fields the instance did not resolve, and `skipped` the PDF fields left
 * untouched because of them, so a caller can report what a filled form is still
 * missing rather than inferring it from blanks.
 * @typedef {Object} BoundValues
 * @property {Record<string, import("../../pdf/forms/types.mjs").FormFieldInput>} values
 * @property {string[]} unresolved
 * @property {string[]} skipped
 */

/**
 * @typedef {Object} PrefillResult
 * @property {Uint8Array} bytes - The filled PDF, as an incremental update over the original.
 * @property {string} documentPath
 * @property {string[]} unresolved
 * @property {string[]} skipped
 * @property {import("../../pdf/forms/fill.mjs").FillResult} fill
 * @property {import("../../pdf/forms/flatten.mjs").FlattenResult | null} flatten - What flattening did, or null when the form was left interactive.
 */

export {};
