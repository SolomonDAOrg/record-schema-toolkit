/**
 * Pack class for form packs (form.pack.schema.json)
 *
 * A form pack maps the typed fields of a document template onto the AcroForm
 * fields of an existing PDF. It is a pack in the same sense as a render pack —
 * it can import others, and a named form declared twice is taken from the pack
 * that imported last — but it resolves by form id rather than by file selector,
 * because a form binding targets one published document rather than a class of
 * files.
 *
 * Each form pins its PDF by checksum. Field names in a published form are the
 * producer's own and are not stable across revisions, so a pack that has drifted
 * from its document would otherwise write values into the wrong boxes.
 * @module classes/FormPack
 */

import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { arrayOr } from "../util/general.mjs";
import { readJson } from "../util/files.mjs";
import { hasPropertyOfType, isObject } from "../util/objects.mjs";

import {
    FORM_PACK_SCHEMA_NAME,
    FORM_PACK_SCHEMA_VERSION,
    PACK_ID_PATTERN
} from "./constants/constants.mjs";

/** @typedef {import("./types/general.mjs").ValidationError} ValidationError */
/** @typedef {import("./types/general.mjs").ValidationResult} ValidationResult */
/** @typedef {import("./forms/types.mjs").FormPackData} FormPackData */
/** @typedef {import("./forms/types.mjs").FormDefinition} FormDefinition */
/** @typedef {import("./forms/types.mjs").FormBinding} FormBinding */

/** The binding kinds a form pack may declare. */
const BIND_KINDS = ["text", "segments", "check", "button_group", "choice"];

/**
 * Form pack representing the binding between template fields and the fields of
 * an existing PDF.
 */
export class FormPack {
    /**
     * @param {FormPackData} data
     * @param {string | null} [source_path]
     */
    constructor(data, source_path = null) {
        /** @type {FormPackData} */
        this.data = data;

        /** @type {string | null} */
        this.source_path = source_path;
    }

    // =========================================================================
    // Static Factory Methods
    // =========================================================================

    /**
     * Load pack from JSON file
     * @param {string} abs_path
     * @returns {FormPack}
     */
    static load(abs_path) {
        return new FormPack(readJson(abs_path), abs_path);
    }

    /**
     * Load pack from JSON file if it exists
     * @param {string} abs_path
     * @returns {FormPack|null}
     */
    static loadIfExists(abs_path) {
        if (!existsSync(abs_path)) {
            return null;
        }
        return FormPack.load(abs_path);
    }

    /**
     * Resolve a pack-relative path against the pack roots, in order.
     * @param {string} root_dir
     * @param {string} rel_or_abs
     * @param {string[]} [search_roots]
     * @returns {string}
     */
    static resolvePath(root_dir, rel_or_abs, search_roots = []) {
        if (isAbsolute(rel_or_abs)) {
            return rel_or_abs;
        }
        const roots = [root_dir].concat(search_roots);
        for (let i = 0, len = roots.length; i < len; i++) {
            const candidate = resolve(roots[i], rel_or_abs);
            if (existsSync(candidate)) {
                return candidate;
            }
        }
        return resolve(root_dir, rel_or_abs);
    }

    /**
     * Load multiple packs with import resolution.
     *
     * Imports are visited depth-first and merged before the pack that named
     * them, so a later pack overrides a form id an earlier one declared. Forms
     * are replaced whole rather than merged field by field: half of one
     * revision's bindings and half of another's would target a document that
     * does not exist.
     * @param {string} root_dir
     * @param {string[]} pack_paths
     * @param {string[]} [search_roots]
     * @returns {{ packs: FormPack[], forms: Record<string, FormDefinition>, pack: FormPack }}
     */
    static loadMerged(root_dir, pack_paths, search_roots = []) {
        /** @type {Set<string>} */
        const seen = new Set();
        /** @type {string[]} */
        const ordered = [];

        /**
         * @param {string} rel_or_abs
         */
        function visit(rel_or_abs) {
            const abs = FormPack.resolvePath(
                root_dir,
                rel_or_abs,
                search_roots
            );
            if (seen.has(abs)) {
                return;
            }
            seen.add(abs);
            const pack = FormPack.load(abs);
            const imports = pack.getImports();
            for (let i = 0, len = imports.length; i < len; i++) {
                visit(imports[i]);
            }
            ordered.push(abs);
        }

        for (let i = 0, len = pack_paths.length; i < len; i++) {
            visit(pack_paths[i]);
        }

        /** @type {FormPack[]} */
        const packs = [];
        /** @type {Record<string, FormDefinition>} */
        const forms = Object.create(null);
        /** @type {Record<string, string>} */
        const origins = Object.create(null);

        for (let i = 0, len = ordered.length; i < len; i++) {
            const pack = FormPack.load(ordered[i]);
            packs.push(pack);
            const declared = pack.getForms();
            const ids = Object.keys(declared);
            for (let j = 0, count = ids.length; j < count; j++) {
                forms[ids[j]] = declared[ids[j]];
                origins[ids[j]] = ordered[i];
            }
        }

        return {
            packs,
            forms,
            pack: new FormPack(
                {
                    schema: FORM_PACK_SCHEMA_NAME,
                    schema_version: FORM_PACK_SCHEMA_VERSION,
                    pack_id: "merged",
                    forms
                },
                null
            )
        };
    }

    // =========================================================================
    // Accessors
    // =========================================================================

    /**
     * Get import paths
     * @returns {string[]}
     */
    getImports() {
        return arrayOr(this.data.imports);
    }

    /**
     * Check if pack has imports
     * @returns {boolean}
     */
    hasImports() {
        return this.getImports().length > 0;
    }

    /**
     * The forms this pack declares, keyed by form id.
     * @returns {Record<string, FormDefinition>}
     */
    getForms() {
        return isObject(this.data.forms) ? this.data.forms : {};
    }

    /**
     * The form ids this pack declares, in file order.
     * @returns {string[]}
     */
    formIds() {
        return Object.keys(this.getForms());
    }

    /**
     * One form by id.
     * @param {string} form_id
     * @returns {FormDefinition}
     */
    getForm(form_id) {
        const forms = this.getForms();
        if (!Object.hasOwn(forms, form_id)) {
            throw new Error(
                "form pack: no form named " +
                    form_id +
                    "; this pack declares " +
                    (this.formIds().length === 0
                        ? "none"
                        : this.formIds().join(", "))
            );
        }
        return forms[form_id];
    }

    /**
     * The absolute path of a form's PDF.
     * @param {string} form_id
     * @param {string} root_dir
     * @param {string[]} [search_roots]
     * @returns {string}
     */
    resolveDocumentPath(form_id, root_dir, search_roots = []) {
        return FormPack.resolvePath(
            root_dir,
            this.getForm(form_id).document.path,
            search_roots
        );
    }

    // =========================================================================
    // Validation
    // =========================================================================

    /**
     * Validate pack data against schema requirements.
     *
     * This is the structural check the other pack classes perform. It does not
     * replace validating against form.pack.schema.json, which states the whole
     * contract; it reports the identity and binding problems that would
     * otherwise surface as an opaque failure to match one of the binding kinds.
     * @returns {ValidationResult}
     */
    validate() {
        /** @type {ValidationError[]} */
        const errors = [];

        if (this.data.schema !== FORM_PACK_SCHEMA_NAME) {
            errors.push({
                path: "schema",
                message:
                    `Expected "${FORM_PACK_SCHEMA_NAME}", got ` +
                    `"${this.data.schema}"`
            });
        }

        if (
            !hasPropertyOfType(this.data, "schema_version", "number") ||
            this.data.schema_version < 1
        ) {
            errors.push({
                path: "schema_version",
                message: "Must be a positive integer"
            });
        }

        if (
            !hasPropertyOfType(this.data, "pack_id", "string") ||
            !PACK_ID_PATTERN.test(this.data.pack_id)
        ) {
            errors.push({
                path: "pack_id",
                message: "Must match pattern ^[a-z][a-z0-9-]{2,}$"
            });
        }

        if (this.data.imports !== undefined) {
            if (!Array.isArray(this.data.imports)) {
                errors.push({ path: "imports", message: "Must be an array" });
            } else {
                for (let i = 0, len = this.data.imports.length; i < len; i++) {
                    if (
                        typeof this.data.imports[i] !== "string" ||
                        this.data.imports[i].length === 0
                    ) {
                        errors.push({
                            path: `imports[${i}]`,
                            message: "Must be a non-empty string"
                        });
                    }
                }
            }
        }

        if (!isObject(this.data.forms)) {
            errors.push({ path: "forms", message: "Must be an object" });
            return { valid: errors.length === 0, errors };
        }

        const ids = Object.keys(this.data.forms);
        for (let i = 0, len = ids.length; i < len; i++) {
            this._validateForm(ids[i], this.data.forms[ids[i]], errors);
        }

        return { valid: errors.length === 0, errors };
    }

    /**
     * @param {string} form_id
     * @param {FormDefinition} form
     * @param {ValidationError[]} errors
     * @returns {void}
     */
    _validateForm(form_id, form, errors) {
        const at = `forms.${form_id}`;
        if (!isObject(form)) {
            errors.push({ path: at, message: "Must be an object" });
            return;
        }
        if (!isObject(form.document)) {
            errors.push({
                path: `${at}.document`,
                message: "Must name the PDF this form fills"
            });
        }
        if (!Array.isArray(form.bindings)) {
            errors.push({
                path: `${at}.bindings`,
                message: "Must be an array"
            });
            return;
        }

        /** @type {Map<string, number>} */
        const targets = new Map();
        for (let i = 0, len = form.bindings.length; i < len; i++) {
            const binding = form.bindings[i];
            const path = `${at}.bindings[${i}]`;
            if (!isObject(binding)) {
                errors.push({ path, message: "Must be an object" });
                continue;
            }
            if (!BIND_KINDS.includes(binding.bind)) {
                errors.push({
                    path: `${path}.bind`,
                    message:
                        `Unknown binding kind "${binding.bind}";` +
                        " expected one of " +
                        BIND_KINDS.join(", ")
                });
                continue;
            }
            this._collectTargets(binding, path, targets, errors);
        }

        for (const [target, count] of targets) {
            if (count > 1) {
                errors.push({
                    path: `${at}.bindings`,
                    message: `Target ${target} is written by ${count} bindings`
                });
            }
        }
    }

    /**
     * Count the PDF fields a binding writes, so that two bindings competing for
     * one field are reported rather than resolved by whichever ran last.
     * @param {FormBinding} binding
     * @param {string} path
     * @param {Map<string, number>} targets
     * @param {ValidationError[]} errors
     * @returns {void}
     */
    _collectTargets(binding, path, targets, errors) {
        /** @param {string} target */
        const count = (target) => {
            targets.set(target, (targets.get(target) || 0) + 1);
        };

        if (binding.bind === "segments") {
            if (!Array.isArray(binding.segments)) {
                errors.push({
                    path: `${path}.segments`,
                    message: "Must be an array"
                });
                return;
            }
            for (let i = 0, len = binding.segments.length; i < len; i++) {
                count(binding.segments[i].target);
            }
            return;
        }
        if (binding.bind === "button_group") {
            if (!Array.isArray(binding.options)) {
                errors.push({
                    path: `${path}.options`,
                    message: "Must be an array"
                });
                return;
            }
            /** @type {Set<string>} */
            const values = new Set();
            for (let i = 0, len = binding.options.length; i < len; i++) {
                const option = binding.options[i];
                count(option.target);
                if (values.has(option.value)) {
                    errors.push({
                        path: `${path}.options[${i}].value`,
                        message: `Duplicate option value "${option.value}"`
                    });
                }
                values.add(option.value);
            }
            return;
        }
        if (binding.bind === "choice") {
            count(binding.target);
            /** @type {Set<string>} */
            const values = new Set();
            const options = arrayOr(binding.options);
            for (let i = 0, len = options.length; i < len; i++) {
                const option = options[i];
                if (values.has(option.value)) {
                    errors.push({
                        path: `${path}.options[${i}].value`,
                        message: `Duplicate option value "${option.value}"`
                    });
                }
                values.add(option.value);
            }
            return;
        }
        count(binding.target);
    }
}

export default { FormPack };
