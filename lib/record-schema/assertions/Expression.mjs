/**
 * Expressions for corpus assertions.
 *
 * The `derive` rule kind needs arithmetic over values a selector pulled out of
 * the corpus - a sum of member widths against a declared width, a product of
 * cardinality bounds against a declared budget. This is that arithmetic and
 * nothing more: no host escape, no property access, no calls into the
 * repository. A declaration the corpus cannot state in these operators is one
 * the corpus should state differently.
 *
 * @module record-schema/assertions/Expression
 */

import { coerceNumber, looseEqual } from "./Predicate.mjs";

/** @typedef {import("./types/general.mjs").Token} Token */

const PUNCTUATION = [
    "&&",
    "||",
    "==",
    "!=",
    "<=",
    ">=",
    "<",
    ">",
    "+",
    "-",
    "*",
    "/",
    "%",
    "(",
    ")",
    ",",
    "!"
];

/** @type {Map<string, Token[]>} */
const LEX_CACHE = new Map();

// `&&` and `||` short-circuit. The parser still has to consume the tokens of the
// side it does not need - abandoning the walk would leave the index wrong - so
// the side is parsed with evaluation suppressed instead. Under suppression an
// unbound name and an unusable number are values rather than faults, because
// `len(x) >= 2 && max(x) <= 4 * len(x)` is written precisely so the right side
// never has to hold for an empty list.
let suppressDepth = 0;

/**
 * Evaluate an expression against a binding map.
 *
 * @param {string} source
 * @param {Record<string, unknown>} bindings
 * @returns {unknown}
 */
export function evaluateExpression(source, bindings) {
    const tokens = lex(source);
    const state = { tokens, index: 0, bindings, source };
    suppressDepth = 0;
    const value = parseOr(state);

    if (state.index < tokens.length) {
        throw new Error(
            `expression "${source}": unexpected "${tokens[state.index].text}"`
        );
    }

    return value;
}

/**
 * @param {string} source
 * @returns {Token[]}
 */
function lex(source) {
    const cached = LEX_CACHE.get(source);
    if (cached !== undefined) {
        return cached;
    }

    /** @type {Token[]} */
    const tokens = [];
    let index = 0;

    while (index < source.length) {
        const character = source[index];

        if (character === " " || character === "\t" || character === "\n") {
            index += 1;
            continue;
        }

        if (character === '"' || character === "'") {
            const close = source.indexOf(character, index + 1);
            if (close === -1) {
                throw new Error(`expression "${source}": unterminated string`);
            }
            tokens.push({
                kind: "string",
                text: source.slice(index + 1, close)
            });
            index = close + 1;
            continue;
        }

        if (/[0-9]/.test(character)) {
            const match =
                /^(?:0[xX][0-9a-fA-F_]+|[0-9][0-9_]*(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(
                    source.slice(index)
                );
            if (match === null) {
                throw new Error(`expression "${source}": bad number`);
            }
            tokens.push({ kind: "number", text: match[0] });
            index += match[0].length;
            continue;
        }

        if (/[A-Za-z_]/.test(character)) {
            const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index));
            const text = /** @type {RegExpExecArray} */ (match)[0];
            tokens.push({ kind: "name", text });
            index += text.length;
            continue;
        }

        const punctuation = PUNCTUATION.find((candidate) =>
            source.startsWith(candidate, index)
        );
        if (punctuation === undefined) {
            throw new Error(
                `expression "${source}": unexpected "${character}"`
            );
        }
        tokens.push({ kind: "punct", text: punctuation });
        index += punctuation.length;
    }

    LEX_CACHE.set(source, tokens);
    return tokens;
}

/**
 * @typedef {{ tokens: Token[], index: number, bindings: Record<string, unknown>, source: string }} ParserState
 */

/**
 * @param {ParserState} state
 * @param {string} text
 * @returns {boolean}
 */
function accept(state, text) {
    const token = state.tokens[state.index];
    if (token !== undefined && token.kind === "punct" && token.text === text) {
        state.index += 1;
        return true;
    }
    return false;
}

/**
 * @param {ParserState} state
 * @param {string} text
 * @returns {void}
 */
function expect(state, text) {
    if (!accept(state, text)) {
        throw new Error(`expression "${state.source}": expected "${text}"`);
    }
}

/**
 * @param {ParserState} state
 * @returns {unknown}
 */
function parseOr(state) {
    let left = parseAnd(state);
    while (accept(state, "||")) {
        if (truthy(left)) {
            suppressDepth += 1;
            parseAnd(state);
            suppressDepth -= 1;
            left = true;
            continue;
        }
        left = truthy(parseAnd(state));
    }
    return left;
}

/**
 * @param {ParserState} state
 * @returns {unknown}
 */
function parseAnd(state) {
    let left = parseComparison(state);
    while (accept(state, "&&")) {
        if (!truthy(left)) {
            suppressDepth += 1;
            parseComparison(state);
            suppressDepth -= 1;
            left = false;
            continue;
        }
        left = truthy(parseComparison(state));
    }
    return left;
}

/**
 * @param {ParserState} state
 * @returns {unknown}
 */
function parseComparison(state) {
    let left = parseAdditive(state);

    for (;;) {
        if (accept(state, "==")) {
            left = looseEqual(left, parseAdditive(state));
            continue;
        }
        if (accept(state, "!=")) {
            left = !looseEqual(left, parseAdditive(state));
            continue;
        }
        if (accept(state, "<=")) {
            left = number(left) <= number(parseAdditive(state));
            continue;
        }
        if (accept(state, ">=")) {
            left = number(left) >= number(parseAdditive(state));
            continue;
        }
        if (accept(state, "<")) {
            left = number(left) < number(parseAdditive(state));
            continue;
        }
        if (accept(state, ">")) {
            left = number(left) > number(parseAdditive(state));
            continue;
        }
        return left;
    }
}

/**
 * @param {ParserState} state
 * @returns {unknown}
 */
function parseAdditive(state) {
    let left = parseMultiplicative(state);

    for (;;) {
        if (accept(state, "+")) {
            left = number(left) + number(parseMultiplicative(state));
            continue;
        }
        if (accept(state, "-")) {
            left = number(left) - number(parseMultiplicative(state));
            continue;
        }
        return left;
    }
}

/**
 * @param {ParserState} state
 * @returns {unknown}
 */
function parseMultiplicative(state) {
    let left = parseUnary(state);

    for (;;) {
        if (accept(state, "*")) {
            left = number(left) * number(parseUnary(state));
            continue;
        }
        if (accept(state, "/")) {
            const divisor = number(parseUnary(state));
            if (divisor === 0) {
                throw new Error(
                    `expression "${state.source}": division by zero`
                );
            }
            left = number(left) / divisor;
            continue;
        }
        if (accept(state, "%")) {
            const divisor = number(parseUnary(state));
            if (divisor === 0) {
                throw new Error(`expression "${state.source}": modulo by zero`);
            }
            left = number(left) % divisor;
            continue;
        }
        return left;
    }
}

/**
 * @param {ParserState} state
 * @returns {unknown}
 */
function parseUnary(state) {
    if (accept(state, "!")) {
        return !truthy(parseUnary(state));
    }
    if (accept(state, "-")) {
        return -number(parseUnary(state));
    }
    return parsePrimary(state);
}

/**
 * @param {ParserState} state
 * @returns {unknown}
 */
function parsePrimary(state) {
    const token = state.tokens[state.index];
    if (token === undefined) {
        throw new Error(`expression "${state.source}": unexpected end`);
    }

    if (accept(state, "(")) {
        const value = parseOr(state);
        expect(state, ")");
        return value;
    }

    if (token.kind === "number") {
        state.index += 1;
        const text = token.text.replace(/_/g, "");
        return text.startsWith("0x") || text.startsWith("0X")
            ? Number.parseInt(text, 16)
            : Number(text);
    }

    if (token.kind === "string") {
        state.index += 1;
        return token.text;
    }

    if (token.kind === "name") {
        state.index += 1;

        if (token.text === "true") {
            return true;
        }
        if (token.text === "false") {
            return false;
        }
        if (token.text === "null") {
            return null;
        }

        if (accept(state, "(")) {
            /** @type {unknown[]} */
            const args = [];
            if (!accept(state, ")")) {
                do {
                    args.push(parseOr(state));
                } while (accept(state, ","));
                expect(state, ")");
            }
            return callFunction(token.text, args, state.source);
        }

        if (!Object.prototype.hasOwnProperty.call(state.bindings, token.text)) {
            if (suppressDepth > 0) {
                return null;
            }
            throw new Error(
                `expression "${state.source}": unbound name "${token.text}"`
            );
        }
        return state.bindings[token.text];
    }

    throw new Error(`expression "${state.source}": unexpected "${token.text}"`);
}

/**
 * @param {string} name
 * @param {unknown[]} args
 * @param {string} source
 * @returns {unknown}
 */
function callFunction(name, args, source) {
    switch (name) {
        case "sum":
            return list(args[0]).reduce(
                (total, item) => /** @type {number} */ (total) + number(item),
                0
            );
        case "product":
            return list(args[0]).reduce(
                (total, item) => /** @type {number} */ (total) * number(item),
                1
            );
        case "len":
        case "count":
            return list(args[0]).length;
        case "min": {
            const items = listOrArgs(args).map(number);
            return items.length === 0 ? null : Math.min(...items);
        }
        case "max": {
            const items = listOrArgs(args).map(number);
            return items.length === 0 ? null : Math.max(...items);
        }
        case "numbers":
            // Members whose value is an expression string rather than a literal
            // carry no ordinal to compare. Dropping them is the same judgement
            // the arithmetic already makes, stated where a reader can see it.
            return list(args[0])
                .map((item) => coerceNumber(item))
                .filter((item) => item !== null);
        case "abs":
            return Math.abs(number(args[0]));
        case "ceil":
            return Math.ceil(number(args[0]));
        case "floor":
            return Math.floor(number(args[0]));
        case "round":
            return Math.round(number(args[0]));
        case "int":
            return Math.trunc(number(args[0]));
        case "first": {
            const items = list(args[0]);
            return items.length === 0 ? null : items[0];
        }
        case "last": {
            const items = list(args[0]);
            return items.length === 0 ? null : items[items.length - 1];
        }
        case "distinct":
            return distinct(list(args[0])).length;
        case "all_equal":
            return distinct(list(args[0])).length <= 1;
        case "defined":
            return args[0] !== undefined && args[0] !== null;
        case "align":
            return alignUp(number(args[0]), number(args[1]));
        case "bits_to_bytes":
            return Math.ceil(number(args[0]) / 8);
        case "pow":
            return Math.pow(number(args[0]), number(args[1]));
        case "contains":
            return list(args[0]).some((item) => looseEqual(item, args[1]));
        case "lookup": {
            const table = args[0];
            if (table === null || typeof table !== "object") {
                return null;
            }
            const key = String(args[1]);
            const map = /** @type {Record<string, unknown>} */ (table);
            return Object.prototype.hasOwnProperty.call(map, key)
                ? map[key]
                : null;
        }
        case "lookup_all": {
            // Unresolved keys are dropped rather than defaulted. A caller that
            // needs every key to resolve compares the returned length against
            // the input length; defaulting to zero would let a width table with
            // a missing entry sum to the declared total by luck.
            const table = args[0];
            if (table === null || typeof table !== "object") {
                return [];
            }
            const map = /** @type {Record<string, unknown>} */ (table);
            /** @type {unknown[]} */
            const out = [];
            const keys = list(args[1]);
            for (let i = 0, len = keys.length; i < len; i++) {
                const key = String(keys[i]);
                if (Object.prototype.hasOwnProperty.call(map, key)) {
                    out.push(map[key]);
                }
            }
            return out;
        }
        case "tiles": {
            // Offsets and widths tile [0, total) exactly: no gap, no overlap,
            // starting at zero and ending at the declared size. A gap is a byte
            // no reader knows how to skip and no writer knows what to put in.
            const offsets = list(args[0]).map(number);
            const widths = list(args[1]).map(number);
            if (offsets.length !== widths.length || offsets.length === 0) {
                return false;
            }
            const spans = offsets
                .map((offset, index) => [offset, widths[index]])
                .sort((left, right) => left[0] - right[0]);
            let cursor = 0;
            for (let i = 0, len = spans.length; i < len; i++) {
                if (spans[i][0] !== cursor) {
                    return false;
                }
                cursor += spans[i][1];
            }
            return cursor === number(args[2]);
        }
        case "overlaps": {
            const offsets = list(args[0]).map(number);
            const widths = list(args[1]).map(number);
            if (offsets.length !== widths.length) {
                return false;
            }
            const spans = offsets
                .map((offset, index) => [offset, offset + widths[index]])
                .sort((left, right) => left[0] - right[0]);
            for (let i = 1, len = spans.length; i < len; i++) {
                if (spans[i][0] < spans[i - 1][1]) {
                    return true;
                }
            }
            return false;
        }
        case "sorted_ascending": {
            const items = list(args[0]).map(number);
            for (let i = 1, len = items.length; i < len; i++) {
                if (items[i] < items[i - 1]) {
                    return false;
                }
            }
            return true;
        }
        case "contiguous_from": {
            const items = list(args[0])
                .map(number)
                .sort((a, b) => a - b);
            let expected = number(args[1]);
            for (let i = 0, len = items.length; i < len; i++) {
                if (items[i] !== expected) {
                    return false;
                }
                expected += 1;
            }
            return true;
        }
        default:
            throw new Error(
                `expression "${source}": unknown function "${name}"`
            );
    }
}

/**
 * @param {number} value
 * @param {number} alignment
 * @returns {number}
 */
function alignUp(value, alignment) {
    if (alignment <= 0) {
        return value;
    }
    const remainder = value % alignment;
    return remainder === 0 ? value : value + (alignment - remainder);
}

/**
 * @param {unknown[]} items
 * @returns {unknown[]}
 */
function distinct(items) {
    /** @type {unknown[]} */
    const seen = [];
    for (let i = 0, len = items.length; i < len; i++) {
        if (!seen.some((candidate) => looseEqual(candidate, items[i]))) {
            seen.push(items[i]);
        }
    }
    return seen;
}

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
function list(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (value === undefined || value === null) {
        return [];
    }
    return [value];
}

/**
 * @param {unknown[]} args
 * @returns {unknown[]}
 */
function listOrArgs(args) {
    if (args.length === 1 && Array.isArray(args[0])) {
        return args[0];
    }
    return args;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function number(value) {
    if (typeof value === "boolean") {
        return value ? 1 : 0;
    }
    const coerced = coerceNumber(value);
    if (coerced === null) {
        if (suppressDepth > 0) {
            return Number.NaN;
        }
        throw new Error(`expression: "${String(value)}" is not a number`);
    }
    return coerced;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function truthy(value) {
    if (Array.isArray(value)) {
        return value.length > 0;
    }
    return Boolean(value);
}
