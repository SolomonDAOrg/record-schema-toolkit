/**
 * The /Ff field-flag and /F annotation-flag vocabularies.
 *
 * ISO 32000-1 numbers flag bits from 1, so the mask for bit n is 2^(n-1). The
 * constants below are those masks, named as the specification names them
 * (Tables 226-230 for field flags, Table 165 for annotation flags), so a
 * reader can check a flag against the standard without re-deriving positions.
 *
 * Several bit positions carry a different meaning per field type — bit 19 is
 * Edit on a choice field and NoToggleToOff-adjacent territory elsewhere — so
 * the masks are grouped by the field type that gives them meaning and are not
 * interchangeable across groups.
 * @module FieldFlags
 */

/** Field flags meaningful for every field type (ISO 32000-1 Table 226). */
export const COMMON_FIELD_FLAGS = {
    READ_ONLY: 1 << 0,
    REQUIRED: 1 << 1,
    NO_EXPORT: 1 << 2
};

/** Text field flags (ISO 32000-1 Table 228). */
export const TEXT_FIELD_FLAGS = {
    MULTILINE: 1 << 12,
    PASSWORD: 1 << 13,
    FILE_SELECT: 1 << 20,
    DO_NOT_SPELL_CHECK: 1 << 22,
    DO_NOT_SCROLL: 1 << 23,
    COMB: 1 << 24,
    RICH_TEXT: 1 << 25
};

/** Button field flags (ISO 32000-1 Table 227). */
export const BUTTON_FIELD_FLAGS = {
    NO_TOGGLE_TO_OFF: 1 << 14,
    RADIO: 1 << 15,
    PUSHBUTTON: 1 << 16,
    RADIOS_IN_UNISON: 1 << 25
};

/** Choice field flags (ISO 32000-1 Table 230). */
export const CHOICE_FIELD_FLAGS = {
    COMBO: 1 << 17,
    EDIT: 1 << 18,
    SORT: 1 << 19,
    MULTI_SELECT: 1 << 21,
    DO_NOT_SPELL_CHECK: 1 << 22,
    COMMIT_ON_SEL_CHANGE: 1 << 26
};

/** Annotation flags (ISO 32000-1 Table 165). */
export const ANNOTATION_FLAGS = {
    INVISIBLE: 1 << 0,
    HIDDEN: 1 << 1,
    PRINT: 1 << 2,
    NO_ZOOM: 1 << 3,
    NO_ROTATE: 1 << 4,
    NO_VIEW: 1 << 5,
    READ_ONLY: 1 << 6,
    LOCKED: 1 << 7,
    TOGGLE_NO_VIEW: 1 << 8,
    LOCKED_CONTENTS: 1 << 9
};

/**
 * True when `mask` is set in `flags`.
 * @param {number} flags
 * @param {number} mask
 * @returns {boolean}
 */
export function hasFlag(flags, mask) {
    return (flags & mask) !== 0;
}

/**
 * The button kind a field's flags select.
 *
 * Pushbutton wins over radio because a field carrying both bits is a
 * pushbutton by ISO 32000-1 Table 227; a field carrying neither is a checkbox.
 * @param {number} flags
 * @returns {"checkbox" | "radio" | "push"}
 */
export function buttonKindFromFlags(flags) {
    if (hasFlag(flags, BUTTON_FIELD_FLAGS.PUSHBUTTON)) {
        return "push";
    }
    if (hasFlag(flags, BUTTON_FIELD_FLAGS.RADIO)) {
        return "radio";
    }
    return "checkbox";
}

export default {
    COMMON_FIELD_FLAGS,
    TEXT_FIELD_FLAGS,
    BUTTON_FIELD_FLAGS,
    CHOICE_FIELD_FLAGS,
    ANNOTATION_FLAGS,
    hasFlag,
    buttonKindFromFlags
};
