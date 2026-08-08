/**
 * Templates for corpus assertions.
 *
 * A template renders a string from a match: `{$.name}` reads a selector path
 * off the matched value, `{#file}` reads a built-in binding, and `|filter`
 * chains transform the result. Templates render join keys as well as human
 * messages, so the filter set is deliberately confined to transformations that
 * are total and deterministic - a key that depends on locale or on the host is
 * a key two runs disagree about.
 *
 * @module record-schema/assertions/Template
 */

import { evaluatePath } from "./Path.mjs";
import { coerceNumber } from "./Predicate.mjs";

/** @typedef {import("./types/general.mjs").TemplateContext} TemplateContext */

const PLACEHOLDER = /\{\{|\}\}|\{([^{}]+)\}/g;

/**
 * Render a template against a matched value and its bindings.
 *
 * @param {string} template
 * @param {unknown} value
 * @param {TemplateContext} [context]
 * @returns {string}
 */
export function renderTemplate(template, value, context = {}) {
    if (typeof template !== "string") {
        throw new Error("template must be a string");
    }

    return template.replace(PLACEHOLDER, (whole, expression) => {
        if (whole === "{{") {
            return "{";
        }
        if (whole === "}}") {
            return "}";
        }
        return resolveExpression(String(expression), value, context);
    });
}

/**
 * Render a template and return null when any referenced path is absent.
 *
 * A join key built from a missing field is not the empty string; it is no key
 * at all, and collapsing the two silently joins every incomplete row to every
 * other one.
 *
 * @param {string} template
 * @param {unknown} value
 * @param {TemplateContext} [context]
 * @returns {string | null}
 */
export function renderKey(template, value, context = {}) {
    let missing = false;

    const rendered = template.replace(PLACEHOLDER, (whole, expression) => {
        if (whole === "{{") {
            return "{";
        }
        if (whole === "}}") {
            return "}";
        }
        const resolved = resolveExpression(
            String(expression),
            value,
            context,
            true
        );
        if (resolved === null) {
            missing = true;
            return "";
        }
        return resolved;
    });

    return missing ? null : rendered;
}

/**
 * @param {string} expression
 * @param {unknown} value
 * @param {TemplateContext} context
 * @param {boolean} [strict]
 * @returns {string | null}
 */
function resolveExpression(expression, value, context, strict = false) {
    const parts = expression.split("|");

    // `a ?? b` takes the first alternative that resolves. One fact reaches the
    // corpus under more than one key - a width is `width`, `bytes`, or `size`
    // depending on which document states it - and a key template that admits
    // only one of them joins on a fraction of the sites and reports the rest
    // clean because it never looked at them.
    const alternatives = parts[0].split("??").map((part) => part.trim());

    /** @type {unknown} */
    let resolved;

    for (let i = 0, len = alternatives.length; i < len; i++) {
        resolved = resolveOne(alternatives[i], value, context);
        if (resolved !== undefined && resolved !== null) {
            break;
        }
    }

    if (resolved === undefined || resolved === null) {
        if (strict) {
            return null;
        }
        resolved = resolved === null ? "null" : "";
    }

    let text = stringify(resolved);

    for (let i = 1, len = parts.length; i < len; i++) {
        text = applyFilter(parts[i].trim(), text);
    }

    return text;
}

/**
 * @param {string} source
 * @param {unknown} value
 * @param {TemplateContext} context
 * @returns {unknown}
 */
function resolveOne(source, value, context) {
    if (source === "#value" || source === "$" || source === "") {
        return value;
    }
    if (source.startsWith("#")) {
        return context[source];
    }

    const matches = evaluatePath(value, source);
    if (matches.length === 0) {
        return undefined;
    }
    if (matches.length === 1) {
        return matches[0].value;
    }

    /** @type {unknown[]} */
    const collected = [];
    for (let i = 0, len = matches.length; i < len; i++) {
        collected.push(matches[i].value);
    }
    return collected;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function stringify(value) {
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (value === null || value === undefined) {
        return "";
    }
    return JSON.stringify(value);
}

/**
 * @param {string} filter
 * @param {string} text
 * @returns {string}
 */
function applyFilter(filter, text) {
    const open = filter.indexOf("(");
    const name = open === -1 ? filter : filter.slice(0, open);
    const argument =
        open === -1 ? "" : filter.slice(open + 1, filter.lastIndexOf(")"));

    switch (name) {
        case "lower":
            return text.toLowerCase();
        case "upper":
            return text.toUpperCase();
        case "trim":
            return text.trim();
        case "basename":
            return text.slice(text.lastIndexOf("/") + 1);
        case "dirname": {
            const index = text.lastIndexOf("/");
            return index === -1 ? "" : text.slice(0, index);
        }
        case "parent": {
            // The path of the node one level up. Grouping siblings is the most
            // common thing a key template does, and expressing it as a regular
            // expression over a path string is how a rule ends up grouping by a
            // pattern nobody re-reads.
            const bracket = text.lastIndexOf("[");
            const dot = text.lastIndexOf(".");
            const cut = Math.max(bracket, dot);
            return cut <= 0 ? text : text.slice(0, cut);
        }
        case "stem": {
            const base = text.slice(text.lastIndexOf("/") + 1);
            const dot = base.indexOf(".");
            return dot === -1 ? base : base.slice(0, dot);
        }
        case "number": {
            const numeric = coerceNumber(text);
            return numeric === null ? text : String(numeric);
        }
        case "hex": {
            const numeric = coerceNumber(text);
            return numeric === null
                ? text
                : `0x${numeric.toString(16).toUpperCase()}`;
        }
        case "prefix":
            return `${argument}${text}`;
        case "suffix":
            return `${text}${argument}`;
        case "slice": {
            const bounds = argument.split(",").map((part) => part.trim());
            const start = Number(bounds[0] ?? 0);
            const end = bounds.length > 1 ? Number(bounds[1]) : undefined;
            return text.slice(start, end);
        }
        case "replace": {
            const bounds = splitArguments(argument);
            return text.replace(
                new RegExp(bounds[0] ?? "", "g"),
                bounds[1] ?? ""
            );
        }
        case "capture": {
            const match = new RegExp(argument).exec(text);
            if (match === null) {
                return "";
            }
            return match[1] === undefined ? match[0] : match[1];
        }
        default:
            throw new Error(`unknown template filter "${name}"`);
    }
}

/**
 * @param {string} argument
 * @returns {string[]}
 */
function splitArguments(argument) {
    /** @type {string[]} */
    const parts = [];
    let current = "";
    let escaped = false;

    for (let i = 0, len = argument.length; i < len; i++) {
        const character = argument[i];
        if (escaped) {
            current += character;
            escaped = false;
            continue;
        }
        if (character === "\\") {
            // Only a comma and a backslash are escapable here. Every other
            // backslash belongs to the regular expression the argument carries,
            // and swallowing it silently turned `\\[\\d+\\]` into `[d+]` - a
            // pattern that matches nothing and a rule that reports clean.
            const next = argument[i + 1];
            if (next === "," || next === "\\") {
                escaped = true;
                continue;
            }
            current += character;
            continue;
        }
        if (character === ",") {
            parts.push(current);
            current = "";
            continue;
        }
        current += character;
    }

    parts.push(current);
    return parts;
}
