/**
 * Prefilling a published PDF from a document instance.
 *
 * This is the step that touches the world: it reads the pinned document, checks
 * it is the revision the pack was written against, verifies the bindings
 * against both the template contract and the document's own field table, and
 * only then writes. The order matters — every check that can be made before the
 * first byte is written is made there, so a form that cannot be filled
 * correctly is refused rather than half filled.
 *
 * The result is an incremental update: the published form survives byte for
 * byte underneath the values, which is what lets the filed document still be
 * shown to be the form that was issued.
 *
 * Whether the result stays an interactive form is the caller's to decide, not
 * the pack's: the same binding produces a form to send to a counterparty and a
 * flattened copy to bind into a packet. Flattening is therefore an option here
 * rather than a property of the form.
 * @module forms/prefill
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
    fillFormFields,
    flattenFormFields,
    loadPdf,
    readAcroForm
} from "../../pdf/index.mjs";

import { bindInstanceToForm } from "./bind-instance.mjs";
import { verifyAgainstContract, verifyAgainstDocument } from "./verify.mjs";

/** @typedef {import("./types.mjs").FormDefinition} FormDefinition */
/** @typedef {import("./types.mjs").PrefillResult} PrefillResult */
/** @typedef {import("../templates/DocumentInstance.mjs").DocumentInstance} DocumentInstance */
/** @typedef {import("../types/general.mjs").ValidationError} ValidationError */

/**
 * @typedef {Object} PrefillOptions
 * @property {boolean} [flatten=false] - Paint the values into the page and
 *   remove the form, producing a document that can be merged into another
 *   without leaving widgets behind that belong to no form.
 */

/**
 * @param {string} label
 * @param {ValidationError[]} errors
 * @returns {void}
 */
function throwIfInvalid(label, errors) {
    if (errors.length === 0) {
        return;
    }
    const lines = errors.map((error) => error.path + ": " + error.message);
    throw new Error(label + "\n  " + lines.join("\n  "));
}

/**
 * Fill a form's PDF from a document instance.
 *
 * `documentPath` is the resolved location of the PDF the form pins; callers
 * normally obtain it from `FormPack.resolveDocumentPath`. The checksum is
 * verified before anything is read from the file as a form, because a pack
 * whose document has been reissued names fields that may no longer mean what
 * the pack says they mean.
 * @param {FormDefinition} form
 * @param {DocumentInstance} instance
 * @param {string} documentPath
 * @param {PrefillOptions} [options]
 * @returns {PrefillResult}
 */
export function prefillForm(form, instance, documentPath, options) {
    const bytes = new Uint8Array(readFileSync(documentPath));
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== form.document.sha256) {
        throw new Error(
            "form prefill: " +
                documentPath +
                " is not the revision this form was written against.\n" +
                "  expected sha256 " +
                form.document.sha256 +
                "\n  found    sha256 " +
                digest
        );
    }

    throwIfInvalid(
        "form prefill: the bindings do not match the template contract.",
        verifyAgainstContract(form, instance.contract)
    );

    const editor = loadPdf(bytes);
    const acroForm = readAcroForm(editor);
    if (acroForm === null) {
        throw new Error(
            "form prefill: " + documentPath + " declares no interactive form"
        );
    }
    throwIfInvalid(
        "form prefill: the bindings do not match the document.",
        verifyAgainstDocument(form, acroForm)
    );

    const bound = bindInstanceToForm(form, instance);
    const fill = fillFormFields(editor, bound.values, {
        xfa: form.xfa,
        needAppearances: form.need_appearances === true,
        allowReadOnly: form.allow_read_only === true
    });

    if (options === undefined || options.flatten !== true) {
        return {
            bytes: editor.save(),
            documentPath,
            unresolved: bound.unresolved,
            skipped: bound.skipped,
            fill,
            flatten: null
        };
    }

    // Flattening reads the appearances the fill just wrote, so it runs over the
    // saved update rather than the editor that produced it.
    const flattening = loadPdf(editor.save());
    const flatten = flattenFormFields(flattening);
    return {
        bytes: flattening.save(),
        documentPath,
        unresolved: bound.unresolved,
        skipped: bound.skipped,
        fill,
        flatten
    };
}

export default { prefillForm };
