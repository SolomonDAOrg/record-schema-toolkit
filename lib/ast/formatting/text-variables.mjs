/** @typedef {import("../types/core.mjs").FormattingRule} FormattingRule */
/** @typedef {import("../nodes/BaseNode.mjs").TextNode} TextNode */

/**
 * @param {ReadonlyArray<string>} names
 * @param {Readonly<Record<string, string | number>>} variables
 * @returns {FormattingRule}
 */
export function createTextVariableRule(names, variables) {
    const selected = new Set(names);
    for (const name of selected) {
        if (!Object.hasOwn(variables, name)) {
            throw new Error("Unbound text variable: " + name);
        }
    }
    const placeholder = /^\s*\{\{([A-Za-z][A-Za-z0-9]*)\}\}\s*$/;
    return {
        id: "text-variables",
        description: "Resolve selected variables in whole Markdown text spans.",
        match: node => node.type === "text" && selected.has(placeholder.exec(node.getTextContent())?.[1] ?? ""),
        transform: node => {
            const text = /** @type {TextNode} */ (node);
            if (text.formats.length > 0) {
                throw new Error("Text variable spans cannot contain positional inline formats.");
            }
            const match = placeholder.exec(text.text);
            const result = text.cloneShallow();
            result.setTextContent(text.text.replace("{{" + match[1] + "}}", String(variables[match[1]])));
            return result;
        }
    };
}
