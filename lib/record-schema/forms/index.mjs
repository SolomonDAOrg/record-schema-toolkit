/**
 * Binding a document instance to the fields of an existing PDF.
 *
 * A form pack declares the mapping; `verifyAgainstContract` and
 * `verifyAgainstDocument` check it against the template it reads from and the
 * document it writes to; `bindInstanceToForm` applies it to one instance as
 * data; `prefillForm` does the same and produces the filled PDF.
 * @module forms
 */

export { bindInstanceToForm } from "./bind-instance.mjs";
export { prefillForm } from "./prefill.mjs";
export {
    describeTemplateFields,
    scaffoldTemplateFields
} from "./template-fields.mjs";
export { verifyAgainstContract, verifyAgainstDocument } from "./verify.mjs";
