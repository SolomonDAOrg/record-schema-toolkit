/**
 * Checking a form pack against the two things it sits between.
 *
 * A binding names a template field on one side and a PDF field on the other,
 * and neither name is checked by the pack's own schema: the schema can say a
 * target is a non-empty string, not that the document declares it. Both ends
 * drift — a template gains a field, a published form is reissued with renumbered
 * boxes — and the failure mode is silent, because writing a value into a field
 * that is not the one meant still produces a plausible-looking PDF.
 *
 * These checks are separate from filling so that a pack can be verified without
 * an instance, which is what a lint step over a registry of packs needs.
 * @module forms/verify
 */

/** @typedef {import("./types.mjs").FormDefinition} FormDefinition */
/** @typedef {import("./types.mjs").FormBinding} FormBinding */
/** @typedef {import("../types/general.mjs").ValidationError} ValidationError */
/** @typedef {import("../templates/types.mjs").TemplateContract} TemplateContract */
/** @typedef {import("../../pdf/forms/types.mjs").AcroForm} AcroForm */
/** @typedef {import("../../pdf/forms/types.mjs").FormField} FormField */

/** The field type each binding kind requires of its template field. */
const REQUIRED_FIELD_TYPE = {
    check: "boolean",
    button_group: "enum",
    choice: "enum"
};

/**
 * Check a form's bindings against the template contract they read from.
 *
 * An enum field is checked for coverage: a declared value with no option is a
 * value the instance may legally hold and the binding cannot express, which
 * would fail only once someone chose it.
 * @param {FormDefinition} form
 * @param {Pick<TemplateContract, "fields">} contract
 * @returns {ValidationError[]}
 */
export function verifyAgainstContract(form, contract) {
    /** @type {ValidationError[]} */
    const errors = [];
    const declared = contract && contract.fields ? contract.fields : {};

    for (let i = 0, len = form.bindings.length; i < len; i++) {
        const binding = form.bindings[i];
        const path = `bindings[${i}]`;
        if (!Object.hasOwn(declared, binding.field)) {
            errors.push({
                path: `${path}.field`,
                message: `The template declares no field named ${binding.field}`
            });
            continue;
        }

        const field = declared[binding.field];
        const required = REQUIRED_FIELD_TYPE[binding.bind];
        if (required !== undefined && field.type !== required) {
            errors.push({
                path: `${path}.field`,
                message:
                    `A ${binding.bind} binding needs a field of type ` +
                    `${required}; ${binding.field} is ${field.type}`
            });
            continue;
        }

        if (binding.bind === "text" || binding.bind === "segments") {
            if (binding.source === "value" && field.type === "boolean") {
                errors.push({
                    path: `${path}.source`,
                    message:
                        `${binding.field} is a boolean; its raw value is ` +
                        "not text. Bind its display form instead."
                });
            }
            continue;
        }

        if (binding.bind === "button_group" || binding.bind === "choice") {
            const offered = new Set(
                binding.options.map((option) => option.value)
            );
            if ("values" in field) {
                for (let j = 0, count = field.values.length; j < count; j++) {
                    if (!offered.has(field.values[j])) {
                        errors.push({
                            path: `${path}.options`,
                            message:
                                `${binding.field} may hold ` +
                                `"${field.values[j]}", which no option binds`
                        });
                    }
                }
                for (const value of offered) {
                    if (!field.values.includes(value)) {
                        errors.push({
                            path: `${path}.options`,
                            message:
                                `Option "${value}" is outside the declared ` +
                                `values of ${binding.field}`
                        });
                    }
                }
            }
        }
    }
    return errors;
}

/**
 * The PDF field kind each binding kind writes to.
 */
const REQUIRED_TARGET_TYPE = {
    text: "text",
    segments: "text",
    check: "button",
    button_group: "button",
    choice: "choice"
};

/**
 * Check one target against the document.
 * @param {Map<string, FormField>} index
 * @param {string} target
 * @param {string} expected
 * @param {string} path
 * @param {ValidationError[]} errors
 * @returns {FormField | null}
 */
function checkTarget(index, target, expected, path, errors) {
    const field = index.get(target);
    if (field === undefined) {
        errors.push({
            path,
            message: `The document declares no field named ${target}`
        });
        return null;
    }
    if (field.type !== expected) {
        errors.push({
            path,
            message:
                `${target} is a ${field.type} field; this binding ` +
                `writes a ${expected} field`
        });
        return null;
    }
    return field;
}

/**
 * Check a button target offers the appearance state the binding names.
 * @param {FormField} field
 * @param {string | undefined} on_state
 * @param {string} path
 * @param {ValidationError[]} errors
 * @returns {void}
 */
function checkOnState(field, on_state, path, errors) {
    if (field.type !== "button") {
        return;
    }
    if (on_state === undefined) {
        if (field.onStates.length !== 1) {
            errors.push({
                path,
                message:
                    `${field.name} declares ${field.onStates.length} ` +
                    "appearance states, so the binding must name one"
            });
        }
        return;
    }
    if (!field.onStates.includes(on_state)) {
        errors.push({
            path,
            message:
                `${field.name} has no appearance state ${on_state}; ` +
                `it declares ${field.onStates.join(", ") || "none"}`
        });
    }
}

/**
 * Check a form's bindings against the AcroForm they write to.
 *
 * Segment lengths are checked against the target's /MaxLen where the document
 * states one, because a published form's comb boxes carry exactly the number of
 * characters they are drawn for.
 * @param {FormDefinition} form
 * @param {AcroForm} acroForm
 * @returns {ValidationError[]}
 */
export function verifyAgainstDocument(form, acroForm) {
    /** @type {ValidationError[]} */
    const errors = [];
    /** @type {Map<string, FormField>} */
    const index = new Map();
    for (let i = 0, len = acroForm.fields.length; i < len; i++) {
        index.set(acroForm.fields[i].name, acroForm.fields[i]);
    }

    for (let i = 0, len = form.bindings.length; i < len; i++) {
        const binding = form.bindings[i];
        const path = `bindings[${i}]`;
        const expected = REQUIRED_TARGET_TYPE[binding.bind];

        if (binding.bind === "segments") {
            for (let j = 0, count = binding.segments.length; j < count; j++) {
                const segment = binding.segments[j];
                const field = checkTarget(
                    index,
                    segment.target,
                    expected,
                    `${path}.segments[${j}].target`,
                    errors
                );
                if (
                    field !== null &&
                    field.type === "text" &&
                    field.maxLength !== null &&
                    segment.length > field.maxLength
                ) {
                    errors.push({
                        path: `${path}.segments[${j}].length`,
                        message:
                            `${segment.target} holds at most ` +
                            `${field.maxLength} characters; the segment ` +
                            `claims ${segment.length}`
                    });
                }
            }
            continue;
        }

        if (binding.bind === "button_group") {
            for (let j = 0, count = binding.options.length; j < count; j++) {
                const option = binding.options[j];
                const field = checkTarget(
                    index,
                    option.target,
                    expected,
                    `${path}.options[${j}].target`,
                    errors
                );
                if (field !== null) {
                    checkOnState(
                        field,
                        option.on_state,
                        `${path}.options[${j}].on_state`,
                        errors
                    );
                }
            }
            continue;
        }

        const field = checkTarget(
            index,
            binding.target,
            expected,
            `${path}.target`,
            errors
        );
        if (field === null) {
            continue;
        }
        if (binding.bind === "check") {
            checkOnState(field, binding.on_state, `${path}.on_state`, errors);
            continue;
        }
        if (binding.bind === "choice" && field.type === "choice") {
            const offered = new Set(
                field.options.map((option) => option.exportValue)
            );
            for (let j = 0, count = binding.options.length; j < count; j++) {
                const wanted = binding.options[j].export;
                if (offered.size > 0 && !offered.has(wanted)) {
                    errors.push({
                        path: `${path}.options[${j}].export`,
                        message:
                            `${binding.target} offers no option with ` +
                            `export value "${wanted}"`
                    });
                }
            }
        }
    }
    return errors;
}

export default { verifyAgainstContract, verifyAgainstDocument };
