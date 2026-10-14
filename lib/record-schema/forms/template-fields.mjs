/**
 * The template fields a form pack expects a record to declare.
 *
 * A form's bindings name template fields on one side and PDF fields on the
 * other, and a record whose template omits one of them is refused rather than
 * quietly half filled. That strictness is only workable if the requirement can
 * be read off the pack, which it can: each binding kind determines the type of
 * the field it reads, and a binding over a set of options determines that
 * field's values exactly.
 *
 * What comes back is a description, not a contract. It states the type each
 * field must have and, for a choice, the values the binding can express;
 * whether a field is required, what it is called in prose, and what a draft
 * shows in its place are the record's to decide.
 * @module forms/template-fields
 */

/** @typedef {import("./types.mjs").FormDefinition} FormDefinition */
/** @typedef {import("./types.mjs").FormBinding} FormBinding */

/**
 * @typedef {Object} TemplateFieldRequirement
 * @property {"text" | "boolean" | "enum"} type - The template field type this binding needs.
 * @property {string[]} [values] - For an enum, the values the binding binds.
 * @property {string[]} binds - The binding kinds that read this field.
 */

/**
 * The type of template field each binding kind reads.
 * @param {FormBinding} binding
 * @returns {"text" | "boolean" | "enum"}
 */
function requiredType(binding) {
    if (binding.bind === "check") {
        return "boolean";
    }
    if (binding.bind === "button_group" || binding.bind === "choice") {
        return "enum";
    }
    return "text";
}

/**
 * Describe the template fields a form's bindings read.
 *
 * A field read by two bindings of different types is reported as a conflict
 * rather than resolved, because no template field can satisfy both.
 * @param {FormDefinition} form
 * @returns {{ fields: Record<string, TemplateFieldRequirement>, conflicts: string[] }}
 */
export function describeTemplateFields(form) {
    /** @type {Record<string, TemplateFieldRequirement>} */
    const fields = Object.create(null);
    /** @type {string[]} */
    const conflicts = [];

    for (let i = 0, len = form.bindings.length; i < len; i++) {
        const binding = form.bindings[i];
        const type = requiredType(binding);
        const existing = fields[binding.field];

        if (existing === undefined) {
            /** @type {TemplateFieldRequirement} */
            const requirement = { type, binds: [binding.bind] };
            if (type === "enum" && "options" in binding) {
                requirement.values = binding.options.map(
                    (option) => option.value
                );
            }
            fields[binding.field] = requirement;
            continue;
        }

        if (existing.type !== type && !conflicts.includes(binding.field)) {
            conflicts.push(binding.field);
        }
        if (!existing.binds.includes(binding.bind)) {
            existing.binds.push(binding.bind);
        }
        if (
            type === "enum" &&
            existing.values !== undefined &&
            "options" in binding
        ) {
            for (const option of binding.options) {
                if (!existing.values.includes(option.value)) {
                    existing.values.push(option.value);
                }
            }
        }
    }

    return { fields, conflicts };
}

/**
 * A template contract's `fields` block covering everything a form binds.
 *
 * Every field is produced optional with a placeholder naming itself, which is
 * the shape a record starts from and then tightens: a form's own rules about
 * which entries are mandatory are not in the pack, and guessing them here would
 * put requirements into a record that nothing checked.
 * @param {FormDefinition} form
 * @returns {Record<string, Object>}
 */
export function scaffoldTemplateFields(form) {
    const described = describeTemplateFields(form);
    /** @type {Record<string, Object>} */
    const scaffold = Object.create(null);
    const names = Object.keys(described.fields);

    for (let i = 0, len = names.length; i < len; i++) {
        const name = names[i];
        const requirement = described.fields[name];
        if (requirement.type === "boolean") {
            scaffold[name] = {
                type: "boolean",
                required: false,
                true_label: "Yes",
                false_label: "No"
            };
            continue;
        }
        if (requirement.type === "enum") {
            scaffold[name] = {
                type: "enum",
                required: false,
                values: requirement.values ?? [],
                draft_placeholder: "[" + name + "]"
            };
            continue;
        }
        scaffold[name] = {
            type: "text",
            required: false,
            draft_placeholder: "[" + name + "]"
        };
    }
    return scaffold;
}

export default { describeTemplateFields, scaffoldTemplateFields };
