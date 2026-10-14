/**
 * Turning a resolved document instance into values for a PDF's form fields.
 *
 * This is the whole of the mapping and none of the input or output: it reads an
 * instance that is already resolved and a form that is already verified, and
 * returns what the PDF layer should write. Keeping it free of file access means
 * the mapping can be checked as data — which fields a given instance would
 * fill, and which it would leave — without producing a document.
 *
 * A field the instance did not resolve is not simply skipped. Which of the four
 * things to do with it is the form's own declaration, because the answer is a
 * property of the document being filled: a placeholder belongs on a draft for
 * internal review and never on a return that will be filed.
 * @module forms/bind-instance
 */

/** @typedef {import("./types.mjs").FormDefinition} FormDefinition */
/** @typedef {import("./types.mjs").FormBinding} FormBinding */
/** @typedef {import("./types.mjs").BoundValues} BoundValues */
/** @typedef {import("../templates/DocumentInstance.mjs").DocumentInstance} DocumentInstance */
/** @typedef {import("../../pdf/forms/types.mjs").FormFieldInput} FormFieldInput */

/** Character classes `retain` may keep before a value is split into segments. */
const RETAIN_PATTERNS = {
    all: null,
    digits: /[^0-9]/g,
    letters: /[^A-Za-z]/g,
    alphanumeric: /[^0-9A-Za-z]/g
};

/**
 * The reading of an instance field a binding asks for.
 * @param {DocumentInstance} instance
 * @param {FormBinding} binding
 * @returns {string}
 */
function readText(instance, binding) {
    if ("source" in binding && binding.source === "value") {
        const raw = instance.values[binding.field];
        if (typeof raw !== "string") {
            throw new Error(
                "form binding: field " +
                    binding.field +
                    " has no raw text value to write"
            );
        }
        return raw;
    }
    return instance.text[binding.field];
}

/**
 * The PDF fields a binding writes when its value is not available.
 * @param {FormBinding} binding
 * @returns {string[]}
 */
function targetsOf(binding) {
    if (binding.bind === "segments") {
        return binding.segments.map((segment) => segment.target);
    }
    if (binding.bind === "button_group") {
        return binding.options.map((option) => option.target);
    }
    return [binding.target];
}

/**
 * Write a value across a binding's segment targets.
 * @param {import("./types.mjs").SegmentsBinding} binding
 * @param {string} value
 * @param {Record<string, FormFieldInput>} values
 * @returns {void}
 */
function applySegments(binding, value, values) {
    const pattern = RETAIN_PATTERNS[binding.retain || "all"];
    const retained = pattern === null ? value : value.replace(pattern, "");
    const characters = [...retained];

    let expected = 0;
    for (let i = 0, len = binding.segments.length; i < len; i++) {
        expected = expected + binding.segments[i].length;
    }
    if (characters.length !== expected) {
        throw new Error(
            "form binding: field " +
                binding.field +
                " is " +
                characters.length +
                " characters after retaining " +
                (binding.retain || "all") +
                ", but its segments account for " +
                expected
        );
    }

    let at = 0;
    for (let i = 0, len = binding.segments.length; i < len; i++) {
        const segment = binding.segments[i];
        values[segment.target] = characters
            .slice(at, at + segment.length)
            .join("");
        at = at + segment.length;
    }
}

/**
 * Write a button group, clearing every option the value did not select.
 * @param {import("./types.mjs").ButtonGroupBinding} binding
 * @param {string} value
 * @param {Record<string, FormFieldInput>} values
 * @returns {void}
 */
function applyButtonGroup(binding, value, values) {
    const selected = binding.options.find((option) => option.value === value);
    if (selected === undefined) {
        throw new Error(
            "form binding: field " +
                binding.field +
                " holds " +
                JSON.stringify(value) +
                ", which no option of this binding binds"
        );
    }
    for (let i = 0, len = binding.options.length; i < len; i++) {
        const option = binding.options[i];
        values[option.target] =
            option === selected ? option.on_state ?? true : false;
    }
}

/**
 * Bind a resolved instance to a form's declared PDF fields.
 *
 * The returned `values` are keyed by fully-qualified PDF field name and are
 * ready for the PDF layer. Nothing is written for a binding the form's
 * unresolved policy says to skip, and those targets are reported instead.
 * @param {FormDefinition} form
 * @param {DocumentInstance} instance
 * @returns {BoundValues}
 */
export function bindInstanceToForm(form, instance) {
    /** @type {Record<string, FormFieldInput>} */
    const values = Object.create(null);
    /** @type {string[]} */
    const unresolved = [];
    /** @type {string[]} */
    const skipped = [];

    for (let i = 0, len = form.bindings.length; i < len; i++) {
        const binding = form.bindings[i];
        const writesText =
            binding.bind === "text" || binding.bind === "segments";

        if (instance.unresolved.has(binding.field)) {
            if (!unresolved.includes(binding.field)) {
                unresolved.push(binding.field);
            }
            if (form.unresolved === "error") {
                throw new Error(
                    "form binding: the instance leaves " +
                        binding.field +
                        " unresolved, and this form refuses to prefill without it"
                );
            }
            if (form.unresolved === "skip") {
                const targets = targetsOf(binding);
                for (let j = 0, count = targets.length; j < count; j++) {
                    skipped.push(targets[j]);
                }
                continue;
            }
            if (form.unresolved === "placeholder" && binding.bind === "text") {
                values[binding.target] = instance.text[binding.field];
                continue;
            }
            // "blank", and "placeholder" on targets that cannot show one: a
            // button has no text, and a placeholder has no character counts to
            // split across a binding's segments.
            const targets = targetsOf(binding);
            for (let j = 0, count = targets.length; j < count; j++) {
                values[targets[j]] = writesText ? "" : false;
            }
            continue;
        }

        if (binding.bind === "text") {
            values[binding.target] = readText(instance, binding);
            continue;
        }
        if (binding.bind === "segments") {
            applySegments(binding, readText(instance, binding), values);
            continue;
        }
        if (binding.bind === "check") {
            const raw = instance.values[binding.field];
            if (typeof raw !== "boolean") {
                throw new Error(
                    "form binding: field " +
                        binding.field +
                        " is not a boolean and cannot select a check box"
                );
            }
            const selects = binding.when === undefined ? true : binding.when;
            values[binding.target] =
                raw === selects ? binding.on_state ?? true : false;
            continue;
        }
        if (binding.bind === "button_group") {
            const raw = instance.values[binding.field];
            if (typeof raw !== "string") {
                throw new Error(
                    "form binding: field " +
                        binding.field +
                        " is not a name and cannot select a button"
                );
            }
            applyButtonGroup(binding, raw, values);
            continue;
        }

        const raw = instance.values[binding.field];
        if (typeof raw !== "string") {
            throw new Error(
                "form binding: field " +
                    binding.field +
                    " is not a name and cannot select an option"
            );
        }
        const option = binding.options.find((entry) => entry.value === raw);
        if (option === undefined) {
            throw new Error(
                "form binding: field " +
                    binding.field +
                    " holds " +
                    JSON.stringify(raw) +
                    ", which no option of this binding binds"
            );
        }
        values[binding.target] = option.export;
    }

    return { values, unresolved, skipped };
}

export default { bindInstanceToForm };
