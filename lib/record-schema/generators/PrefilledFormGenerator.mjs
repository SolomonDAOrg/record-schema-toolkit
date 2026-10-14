/**
 * PrefilledFormGenerator
 *
 * Issues filled copies of published PDF forms for a record: it reads what the
 * record's META declares under `extensions.prefilled_forms`, resolves the form
 * packs that hold the bindings, binds the record's document instance through
 * them, and writes each declared output.
 *
 * It stands apart from the filing-packet pipeline rather than inside it. A
 * packet is composed — sources are parsed, laid out and rendered into one new
 * document — while a filled form is the publisher's own document with values
 * written into it, preserved byte for byte underneath so that what was filed
 * can still be shown to be the form that was issued. Composing a form would
 * destroy exactly the property that makes it a form.
 *
 * The record says which forms it issues and where they land; the bindings live
 * in form packs, because a published form's field names belong to that form and
 * to the revision it was issued in, not to any one record that files it.
 *
 * @module generators/PrefilledFormGenerator
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { loadPdf, readAcroForm } from "../../pdf/index.mjs";
import { arrayOr, boolOr, stringOr } from "../../util/general.mjs";
import { isObject } from "../../util/objects.mjs";
import { FormPack } from "../FormPack.mjs";
import { prefillForm } from "../forms/prefill.mjs";
import { DocumentInstance } from "../templates/DocumentInstance.mjs";

/** @typedef {import("../Repository.mjs").Repository} Repository */
/** @typedef {import("../types/general.mjs").RecordInfo} RecordInfo */
/** @typedef {import("../forms/types.mjs").FormDefinition} FormDefinition */

/**
 * @typedef {Object} PrefilledFormOutput
 * @property {string} form - Form id, as the pack declares it.
 * @property {string} label
 * @property {string} path - Record-relative path written.
 * @property {string} outputPath - Absolute path written.
 * @property {string} hash - sha256 of the bytes written.
 * @property {boolean} flattened
 * @property {string[]} unresolved - Template fields the instance did not resolve.
 * @property {string[]} skipped - PDF fields left untouched because of them.
 */

/**
 * @typedef {Object} PrefilledFormResult
 * @property {boolean} success
 * @property {string} [error]
 * @property {PrefilledFormOutput[]} [outputs]
 * @property {string} [documentId]
 * @property {string} [stage]
 */

export class PrefilledFormGenerator {
    /**
     * @param {Repository} repo
     * @param {{ trace?: (msg: string) => void, verbose?: boolean }} [opts]
     */
    constructor(repo, opts) {
        /** @type {Repository} */
        this._repo = repo;

        /** @type {boolean} */
        this._verbose = opts?.verbose === true;

        /** @type {(msg: string) => void} */
        this._trace_fn =
            typeof opts?.trace === "function" ? opts.trace : () => {};
    }

    /**
     * @param {string} message
     * @returns {void}
     */
    _trace(message) {
        if (this._verbose) {
            this._trace_fn(`[VERBOSE] ${message}`);
        }
    }

    /**
     * The `extensions.prefilled_forms` declaration of a record, or null when it
     * issues no forms.
     * @param {RecordInfo} record
     * @returns {{ packs: string[], outputs: Object[] } | null}
     */
    static readDeclaration(record) {
        const declared = record.metafile?.data?.extensions?.prefilled_forms;
        if (!isObject(declared)) {
            return null;
        }
        const outputs = arrayOr(declared.outputs);
        if (outputs.length === 0) {
            return null;
        }
        return { packs: arrayOr(declared.packs), outputs };
    }

    /**
     * True when a record declares any prefilled form.
     * @param {RecordInfo} record
     * @returns {boolean}
     */
    static declares(record) {
        return PrefilledFormGenerator.readDeclaration(record) !== null;
    }

    /**
     * The roots that pack paths and the documents they pin resolve against.
     * @returns {string[]}
     */
    _searchRoots() {
        const roots = this._repo.getSchemaMaterialRoots();
        /** @type {string[]} */
        const rest = [];
        for (let i = 0, len = roots.length; i < len; i++) {
            if (roots[i] !== this._repo.root_dir) {
                rest.push(roots[i]);
            }
        }
        return rest;
    }

    /**
     * Load every form pack in force for a record: the ones the repository
     * configures, then the ones the record adds, so a record can override a
     * form for itself.
     * @param {string[]} recordPacks
     * @returns {Record<string, FormDefinition>}
     */
    _resolveForms(recordPacks) {
        const configured = this._repo.getFormPackPaths();
        const paths = configured.concat(recordPacks);
        if (paths.length === 0) {
            return {};
        }
        this._trace(`form packs: ${paths.join(", ")}`);
        return FormPack.loadMerged(
            this._repo.root_dir,
            paths,
            this._searchRoots()
        ).forms;
    }

    /**
     * Resolve a record-relative output path, refusing one that would leave the
     * record's own directory.
     * @param {RecordInfo} record
     * @param {string} relativePath
     * @returns {string}
     */
    _resolveOutputPath(record, relativePath) {
        if (isAbsolute(relativePath)) {
            throw new Error(
                "Prefilled form output must be record-relative: " + relativePath
            );
        }
        const absolute = resolve(record.abs_path, relativePath);
        const inside = relative(record.abs_path, absolute);
        if (inside.length === 0 || inside.startsWith("..")) {
            throw new Error(
                "Prefilled form output leaves the record directory: " +
                    relativePath
            );
        }
        return absolute;
    }

    /**
     * Refuse to overwrite a document that carries a signature.
     *
     * The form is read through the general reader rather than the editor's
     * signing-profile accessor, because a published form's fields are
     * hierarchical and that accessor only describes the flat fields the toolkit
     * emits itself.
     * @param {string} outputPath
     * @returns {void}
     */
    _assertNotSigned(outputPath) {
        if (!existsSync(outputPath)) {
            return;
        }
        const form = readAcroForm(
            loadPdf(new Uint8Array(readFileSync(outputPath)))
        );
        if (form === null) {
            return;
        }
        for (let i = 0, len = form.fields.length; i < len; i++) {
            const field = form.fields[i];
            if (
                field.type === "signature" &&
                field.value.kind === "signature"
            ) {
                throw new Error(
                    "A signed PDF cannot be overwritten by prefilling." +
                        " Create a new instance revision and output path."
                );
            }
        }
    }

    /**
     * Issue every filled form the record declares.
     *
     * The record's document instance supplies the values, so a record that
     * issues forms must bind a template; `options.instance` and `options.stage`
     * select which, exactly as they do for a filing packet.
     * @param {RecordInfo} record
     * @param {{ instance?: string, stage?: string, overwrite?: boolean }} [options]
     * @returns {PrefilledFormResult}
     */
    generate(record, options) {
        const settings = options || {};
        const declaration = PrefilledFormGenerator.readDeclaration(record);
        if (declaration === null) {
            return {
                success: false,
                error: "This record declares no prefilled forms."
            };
        }

        const instance = DocumentInstance.load(this._repo, record, {
            instance: settings.instance,
            stage: settings.stage
        });
        if (!instance) {
            return {
                success: false,
                error:
                    "Prefilling a form needs a bound template instance;" +
                    " this record has no template binding contract."
            };
        }
        this._trace(`instance: ${instance.documentId} stage=${instance.stage}`);

        const forms = this._resolveForms(declaration.packs);
        /** @type {PrefilledFormOutput[]} */
        const outputs = [];

        for (let i = 0, len = declaration.outputs.length; i < len; i++) {
            const declared = declaration.outputs[i];
            const formId = stringOr(declared.form);
            if (!Object.hasOwn(forms, formId)) {
                const known = Object.keys(forms);
                return {
                    success: false,
                    error:
                        `No form pack declares "${formId}"; the packs ` +
                        "in force declare " +
                        (known.length === 0 ? "none" : known.join(", "))
                };
            }

            const form = forms[formId];
            const relativePath = stringOr(declared.path);
            const outputPath = this._resolveOutputPath(record, relativePath);

            if (!settings.overwrite && existsSync(outputPath)) {
                return {
                    success: false,
                    error: "Prefilled form already exists: " + relativePath
                };
            }
            this._assertNotSigned(outputPath);

            const documentPath = FormPack.resolvePath(
                this._repo.root_dir,
                form.document.path,
                this._searchRoots()
            );
            const flatten = boolOr(declared.flatten, false);
            this._trace(
                `  ${formId} → ${relativePath} (flatten=${flatten})` +
                    ` from ${documentPath}`
            );

            const filled = prefillForm(form, instance, documentPath, {
                flatten
            });

            mkdirSync(dirname(outputPath), { recursive: true });
            writeFileSync(outputPath, filled.bytes);

            outputs.push({
                form: formId,
                label: stringOr(declared.label) || formId,
                path: relativePath,
                outputPath,
                hash: createHash("sha256").update(filled.bytes).digest("hex"),
                flattened: flatten,
                unresolved: filled.unresolved,
                skipped: filled.skipped
            });
        }

        return {
            success: true,
            outputs,
            documentId: instance.documentId,
            stage: instance.stage
        };
    }
}

export default { PrefilledFormGenerator };
