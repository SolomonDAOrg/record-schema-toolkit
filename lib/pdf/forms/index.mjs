/**
 * Reading and filling AcroForm interactive forms.
 *
 * `readAcroForm` reports every terminal field with its inherited type, flags,
 * value and widgets; `fillFormFields` writes values back through the reader's
 * incremental update, generating the appearance streams that make the values
 * visible. Signature fields are read here but signed elsewhere, through the
 * editor's own signing methods.
 * @module Forms
 */

export {
    readAcroForm,
    indexFieldsByName,
    resolveValue
} from "./field-tree.mjs";
export { fillFormFields, readFormValues } from "./fill.mjs";
export { flattenFormFields } from "./flatten.mjs";
export { parseDefaultAppearance } from "./default-appearance.mjs";
export { resolveFormFont, measureFormText } from "./font-resource.mjs";
export {
    COMMON_FIELD_FLAGS,
    TEXT_FIELD_FLAGS,
    BUTTON_FIELD_FLAGS,
    CHOICE_FIELD_FLAGS,
    ANNOTATION_FLAGS,
    hasFlag,
    buttonKindFromFlags
} from "./field-flags.mjs";
