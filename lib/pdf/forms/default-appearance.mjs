/**
 * The /DA default-appearance string.
 *
 * /DA is a content-stream fragment, not a structured value: it carries the font
 * and size a field draws its value with (a `Tf` operator naming a resource in
 * the form's /DR) and the colour it draws in (`g`, `rg` or `k`). Generating an
 * appearance means reproducing those operators, so they are parsed out rather
 * than guessed, and the colour operators are carried through verbatim so that a
 * separation or otherwise unusual colour space survives untouched.
 *
 * A size of 0 selects automatic sizing, which the viewer would compute from the
 * widget's height; it is reported as 0 and resolved later by the code that
 * knows the rectangle.
 * @module DefaultAppearance
 */

/** Operators that set a fill colour in a /DA string. */
const COLOUR_OPERATORS = new Set(["g", "rg", "k"]);

/**
 * @typedef {Object} DefaultAppearance
 * @property {string | null} fontResource - Resource name from the last `Tf`, without its solidus.
 * @property {number} fontSize - Size from the last `Tf`; 0 means automatic.
 * @property {string | null} colourOperator - The last colour-setting operator with its operands, verbatim.
 * @property {string} source - The /DA string as read.
 */

/**
 * Split a /DA string into whitespace-separated tokens, keeping name objects
 * whole.
 * @param {string} source
 * @returns {string[]}
 */
function tokenize(source) {
    const matches = source.match(/\/[^\s/[\]<>(){}%]*|[^\s/[\]<>(){}%]+/g);
    return matches === null ? [] : matches;
}

/**
 * Parse a /DA string.
 *
 * The last `Tf` and the last colour operator win, because a /DA that sets
 * the same property twice — which producers do emit — takes effect in
 * stream order.
 * @param {string | null} source
 * @returns {DefaultAppearance}
 */
export function parseDefaultAppearance(source) {
    /** @type {DefaultAppearance} */
    const appearance = {
        fontResource: null,
        fontSize: 0,
        colourOperator: null,
        source: source === null ? "" : source
    };
    if (source === null) {
        return appearance;
    }

    const tokens = tokenize(source);
    for (let i = 0, len = tokens.length; i < len; i++) {
        const token = tokens[i];
        if (token === "Tf" && i >= 2) {
            const name = tokens[i - 2];
            const size = Number(tokens[i - 1]);
            if (name.startsWith("/") && Number.isFinite(size)) {
                appearance.fontResource = name.slice(1);
                appearance.fontSize = size;
            }
            continue;
        }
        if (COLOUR_OPERATORS.has(token)) {
            const operandCount = token === "g" ? 1 : token === "rg" ? 3 : 4;
            if (i < operandCount) {
                continue;
            }
            const operands = tokens.slice(i - operandCount, i);
            let numeric = true;
            for (let j = 0; j < operands.length; j++) {
                if (!Number.isFinite(Number(operands[j]))) {
                    numeric = false;
                }
            }
            if (numeric) {
                appearance.colourOperator = operands.join(" ") + " " + token;
            }
        }
    }
    return appearance;
}

export default { parseDefaultAppearance };
