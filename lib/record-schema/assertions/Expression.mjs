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

import { createHash } from "node:crypto";
import { coerceNumber, looseEqual } from "./Predicate.mjs";
import { evaluatePathValues, isPlainObject } from "./Path.mjs";

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
            return lengthOf(args[0]);
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
            if (typeof args[0] === "string") {
                return String(args[0]).includes(String(args[1]));
            }
            return list(args[0]).some((item) => looseEqual(item, args[1]));
        case "starts_with":
            return String(args[0] ?? "").startsWith(String(args[1] ?? ""));
        case "ends_with":
            return String(args[0] ?? "").endsWith(String(args[1] ?? ""));
        case "lower":
            return String(args[0] ?? "").toLowerCase();
        case "upper":
            return String(args[0] ?? "").toUpperCase();
        case "trim":
            return String(args[0] ?? "").trim();
        case "concat":
            return args.map((value) => String(value ?? "")).join("");
        case "join":
            return list(args[0]).map(String).join(String(args[1] ?? ","));
        case "json_stringify":
            return JSON.stringify(args[0]);
        case "canonical_json":
            return canonicalJson(args[0], new Set(list(args[1]).map(String)));
        case "normalize_name":
            return normalizeName(String(args[0] ?? ""));
        case "split":
            return String(args[0] ?? "").split(String(args[1] ?? ","));
        case "replace":
            return String(args[0] ?? "").replace(
                new RegExp(String(args[1] ?? ""), String(args[3] ?? "g")),
                String(args[2] ?? "")
            );
        case "matches":
            return new RegExp(String(args[1] ?? ""), String(args[2] ?? "")).test(
                String(args[0] ?? "")
            );
        case "capture": {
            const match = new RegExp(
                String(args[1] ?? ""),
                String(args[3] ?? "")
            ).exec(String(args[0] ?? ""));
            if (match === null) return null;
            const group = args[2] ?? 1;
            return typeof group === "number"
                ? match[group] ?? null
                : match.groups?.[String(group)] ?? null;
        }
        case "keys":
            return isPlainObject(args[0])
                ? Object.keys(/** @type {Record<string, unknown>} */ (args[0]))
                : [];
        case "values":
            return isPlainObject(args[0])
                ? Object.values(/** @type {Record<string, unknown>} */ (args[0]))
                : [];
        case "has_key":
            return (
                isPlainObject(args[0]) &&
                Object.prototype.hasOwnProperty.call(
                    /** @type {Record<string, unknown>} */ (args[0]),
                    String(args[1])
                )
            );
        case "at": {
            const values = evaluatePathValues(args[0], String(args[1] ?? "$"));
            return values.length === 0
                ? null
                : values.length === 1
                ? values[0]
                : values;
        }
        case "all_at":
            return evaluatePathValues(args[0], String(args[1] ?? "$"));
        case "find_by": {
            const items = list(args[0]);
            const path = String(args[1] ?? "$");
            const expected = args[2];
            for (let i = 0, len = items.length; i < len; i++) {
                const values = evaluatePathValues(items[i], path);
                if (
                    values.some((value) => looseEqual(value, expected))
                ) {
                    return items[i];
                }
            }
            return null;
        }
        case "filter_by": {
            const items = list(args[0]);
            const path = String(args[1] ?? "$");
            const expected = args[2];
            return items.filter((item) =>
                evaluatePathValues(item, path).some((value) =>
                    looseEqual(value, expected)
                )
            );
        }
        case "flatten": {
            /** @type {unknown[]} */
            const out = [];
            const values = list(args[0]);
            for (let i = 0, len = values.length; i < len; i++) {
                const child = values[i];
                if (Array.isArray(child)) out.push(...child);
                else out.push(child);
            }
            return out;
        }
        case "concat_lists": {
            /** @type {unknown[]} */
            const out = [];
            for (let i = 0, len = args.length; i < len; i++) {
                const values = list(args[i]);
                for (let j = 0, count = values.length; j < count; j++) {
                    out.push(values[j]);
                }
            }
            return out;
        }
        case "concat_each":
            return list(args[0]).map((value) =>
                `${String(args[1] ?? "")}${String(value ?? "")}${String(args[2] ?? "")}`
            );
        case "compact":
            return list(args[0]).filter(
                (item) => item !== null && item !== undefined
            );
        case "same_set": {
            const left = distinct(list(args[0]));
            const right = distinct(list(args[1]));
            return (
                left.length === right.length &&
                left.every((item) =>
                    right.some((candidate) => looseEqual(item, candidate))
                )
            );
        }
        case "subset":
            return list(args[0]).every((item) =>
                list(args[1]).some((candidate) => looseEqual(item, candidate))
            );
        case "intersects":
            return list(args[0]).some((item) =>
                list(args[1]).some((candidate) => looseEqual(item, candidate))
            );
        case "difference":
            return list(args[0]).filter(
                (item) =>
                    !list(args[1]).some((candidate) =>
                        looseEqual(item, candidate)
                    )
            );
        case "intersection":
            return list(args[0]).filter((item) =>
                list(args[1]).some((candidate) =>
                    looseEqual(item, candidate)
                )
            );
        case "difference_count":
            return list(args[0]).filter(
                (item) =>
                    !list(args[1]).some((candidate) =>
                        looseEqual(item, candidate)
                    )
            ).length;
        case "matching": {
            const expression = new RegExp(
                String(args[1] ?? ""),
                String(args[2] ?? "")
            );
            return list(args[0]).filter((item) =>
                expression.test(String(item ?? ""))
            );
        }
        case "coalesce":
            for (let i = 0, len = args.length; i < len; i++) {
                if (args[i] !== null && args[i] !== undefined) return args[i];
            }
            return null;
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
        case "number_or_null":
            return numberOrNull(args[0]);
        case "choose":
            return truthy(args[0]) ? args[1] : args[2];
        case "binary_width":
            return binaryWidth(
                args[0],
                isPlainObject(args[1])
                    ? /** @type {Record<string, unknown>} */ (args[1])
                    : {},
                isPlainObject(args[2])
                    ? /** @type {Record<string, unknown>} */ (args[2])
                    : {},
                isPlainObject(args[3])
                    ? /** @type {Record<string, unknown>} */ (args[3])
                    : {},
                String(args[4] ?? ""),
                new Set()
            );
        case "layout_span":
            return layoutSpan(list(args[0]));
        case "sum_ceil_div": {
            const divisor = number(args[1]);
            if (divisor <= 0) {
                throw new Error("sum_ceil_div divisor must be positive");
            }
            const values = list(args[0]);
            let total = 0;
            for (let i = 0, len = values.length; i < len; i++) {
                total += Math.ceil(number(values[i]) / divisor);
            }
            return total;
        }
        case "identifier_forms":
            return identifierForms(String(args[0] ?? ""));
        case "scalar_values":
            return scalarValues(args[0]);
        case "strip_wrapping_quotes":
            return stripWrappingQuotes(String(args[0] ?? ""));
        case "has_alpha":
            return /[A-Za-z]/.test(String(args[0] ?? ""));
        case "digest_hex": {
            const value = args[0];
            const hash = createHash("sha256");
            if (value instanceof Uint8Array) {
                hash.update(value);
            } else {
                hash.update(String(value ?? ""), "utf8");
            }
            return hash.digest("hex");
        }
        case "byte_width":
            return byteWidth(args[0]);
        case "to_hex":
            return toHex(args[0], args[1]);
        case "list":
            return args;
        case "slice": {
            const value = args[0];
            const start = number(args[1] ?? 0);
            const end = args[2] === undefined ? undefined : number(args[2]);
            if (Array.isArray(value) || value instanceof Uint8Array) {
                return value.slice(start, end);
            }
            return String(value ?? "").slice(start, end);
        }
        case "unique_values":
            return distinct(list(args[0]));
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
 * Stable JSON representation with selected object keys removed recursively.
 *
 * @param {unknown} value
 * @param {Set<string>} ignoredKeys
 * @returns {string}
 */
function canonicalJson(value, ignoredKeys) {
    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        const parts = [];
        for (let i = 0, len = value.length; i < len; i++) {
            parts.push(canonicalJson(value[i], ignoredKeys));
        }
        return `[${parts.join(",")}]`;
    }
    const objectValue = /** @type {Record<string, unknown>} */ (value);
    const keys = Object.keys(objectValue)
        .filter((key) => !ignoredKeys.has(key))
        .sort();
    const parts = [];
    for (let i = 0, len = keys.length; i < len; i++) {
        const key = keys[i];
        parts.push(`${JSON.stringify(key)}:${canonicalJson(objectValue[key], ignoredKeys)}`);
    }
    return `{${parts.join(",")}}`;
}

/**
 * Convert Pascal/camel/snake names to a single lower-snake comparison form.
 *
 * @param {string} value
 * @returns {string}
 */
function normalizeName(value) {
    return value
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
        .toLowerCase()
        .replace(/_+/g, "_");
}

/**
 * @param {unknown} type
 * @param {Record<string, unknown>} definitions
 * @param {Record<string, unknown>} scalarWidths
 * @param {Record<string, unknown>} fixedWidths
 * @param {string} prefix
 * @param {Set<string>} active
 * @returns {number | null}
 */
function binaryWidth(
    type,
    definitions,
    scalarWidths,
    fixedWidths,
    prefix,
    active
) {
    if (typeof type === "string") {
        const scalar = numberOrNull(scalarWidths[type]);
        if (scalar !== null) return scalar;
        const fixed = numberOrNull(fixedWidths[type]);
        if (fixed !== null) return fixed;

        const qualified = Object.prototype.hasOwnProperty.call(
            definitions,
            `${prefix}${type}`
        )
            ? `${prefix}${type}`
            : type;
        const definition = definitions[qualified];
        if (definition === undefined || active.has(qualified)) return null;
        active.add(qualified);
        const width = binaryWidth(
            definition,
            definitions,
            scalarWidths,
            fixedWidths,
            prefix,
            active
        );
        active.delete(qualified);
        return width;
    }

    if (!isPlainObject(type)) return null;
    const specification = /** @type {Record<string, unknown>} */ (type);

    const directWidth = numberOrNull(specification.width);
    if (directWidth !== null) {
        const kind = String(specification.kind ?? "");
        if (kind === "int" || kind === "uint") {
            return Math.ceil(directWidth / 8);
        }
        return directWidth;
    }

    const byteCount = numberOrNull(
        specification.bytes ?? specification.byte_width
    );
    if (byteCount !== null) return byteCount;

    if (typeof specification.reference === "string") {
        return binaryWidth(
            specification.reference,
            definitions,
            scalarWidths,
            fixedWidths,
            prefix,
            active
        );
    }

    if (
        typeof specification.type === "string" ||
        isPlainObject(specification.type)
    ) {
        const nested = binaryWidth(
            specification.type,
            definitions,
            scalarWidths,
            fixedWidths,
            prefix,
            active
        );
        if (nested !== null) return nested;
    }

    const kind = String(specification.kind ?? "");
    if (kind === "bool") return 1;
    if (kind === "fixed") {
        return numberOrNull(fixedWidths[String(specification.format ?? "")]);
    }
    if (kind === "bytes" || kind === "string") {
        return numberOrNull(
            specification.length ??
                specification.size ??
                specification.capacity ??
                specification.maximum
        );
    }
    if (kind === "array" || kind === "vector" || kind === "list") {
        const count = numberOrNull(
            specification.length ??
                specification.size ??
                specification.arity ??
                specification.capacity
        );
        if (count === null) return null;
        const elementWidth = binaryWidth(
            specification.element ?? specification.items ?? specification.of,
            definitions,
            scalarWidths,
            fixedWidths,
            prefix,
            active
        );
        return elementWidth === null ? null : elementWidth * count;
    }

    const members = Array.isArray(specification.members)
        ? specification.members
        : Array.isArray(specification.fields)
        ? specification.fields
        : null;
    if (members !== null) {
        let total = 0;
        for (let i = 0, len = members.length; i < len; i++) {
            const member = members[i];
            if (!isPlainObject(member)) return null;
            const memberSpecification = /** @type {Record<string, unknown>} */ (
                member
            );
            const memberWidth =
                numberOrNull(
                    memberSpecification.width ?? memberSpecification.byte_width
                ) ??
                binaryWidth(
                    memberSpecification.type,
                    definitions,
                    scalarWidths,
                    fixedWidths,
                    prefix,
                    active
                );
            if (memberWidth === null) return null;
            total += memberWidth;
        }
        return total;
    }

    return null;
}

/**
 * @param {unknown[]} fields
 * @returns {number | null}
 */
function layoutSpan(fields) {
    let span = 0;
    let found = false;
    for (let i = 0, len = fields.length; i < len; i++) {
        if (!isPlainObject(fields[i])) continue;
        const field = /** @type {Record<string, unknown>} */ (fields[i]);
        const offset = numberOrNull(field.offset ?? field.byte_offset);
        const width = numberOrNull(
            field.width ?? field.bytes ?? field.byte_width
        );
        if (offset === null || width === null) continue;
        span = Math.max(span, offset + width);
        found = true;
    }
    return found ? span : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function numberOrNull(value) {
    const converted = coerceNumber(value);
    return converted === null || !Number.isFinite(converted)
        ? null
        : converted;
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function identifierForms(value) {
    const snake = normalizeName(value)
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return distinct([
        value,
        snake,
        snake.toUpperCase(),
        snake.replace(/_/g, "-"),
        snake.replace(/_/g, "")
    ]).map(String);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function scalarValues(value) {
    /** @type {string[]} */
    const values = [];
    const visit = (candidate) => {
        if (
            typeof candidate === "string" ||
            typeof candidate === "number" ||
            typeof candidate === "bigint"
        ) {
            values.push(String(candidate));
            return;
        }
        if (Array.isArray(candidate)) {
            for (let i = 0, len = candidate.length; i < len; i++) {
                visit(candidate[i]);
            }
            return;
        }
        if (isPlainObject(candidate)) {
            const objectValue = /** @type {Record<string, unknown>} */ (
                candidate
            );
            const keys = Object.keys(objectValue);
            for (let i = 0, len = keys.length; i < len; i++) {
                visit(objectValue[keys[i]]);
            }
        }
    };
    visit(value);
    return values;
}

/**
 * @param {string} value
 * @returns {string}
 */
function stripWrappingQuotes(value) {
    let result = value.trim();
    while (result.length >= 2) {
        const firstCharacter = result[0];
        const lastCharacter = result[result.length - 1];
        if (
            (firstCharacter !== "'" && firstCharacter !== '"') ||
            firstCharacter !== lastCharacter
        ) {
            break;
        }
        result = result.slice(1, -1).trim();
    }
    return result;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function byteWidth(value) {
    if (value instanceof Uint8Array) {
        return value.byteLength;
    }
    if (typeof value === "string") {
        if (!/^0[xX][0-9a-fA-F]+$/.test(value)) return null;
        return Math.ceil(value.slice(2).length / 2);
    }
    if (typeof value === "bigint") {
        if (value < 0n) return null;
        return Math.max(1, Math.ceil(value.toString(16).length / 2));
    }
    if (typeof value === "number") {
        if (!Number.isSafeInteger(value) || value < 0) return null;
        return Math.max(1, Math.ceil(value.toString(16).length / 2));
    }
    return null;
}

/**
 * @param {unknown} value
 * @param {unknown} width
 * @returns {string | null}
 */
function toHex(value, width) {
    let hex;
    if (value instanceof Uint8Array) {
        const parts = new Array(value.length);
        for (let i = 0, len = value.length; i < len; i++) {
            parts[i] = value[i].toString(16).padStart(2, "0");
        }
        hex = parts.join("");
    } else if (typeof value === "string" && /^0[xX][0-9a-fA-F]+$/.test(value)) {
        hex = value.slice(2).toLowerCase();
    } else if (typeof value === "bigint" && value >= 0n) {
        hex = value.toString(16);
    } else if (
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0
    ) {
        hex = value.toString(16);
    } else {
        return null;
    }
    const requested = width === undefined ? 0 : Math.trunc(number(width));
    return requested > 0 ? hex.padStart(requested, "0") : hex;
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
 * @returns {number}
 */
function lengthOf(value) {
    if (typeof value === "string" || Array.isArray(value) || value instanceof Uint8Array) {
        return value.length;
    }
    if (value === undefined || value === null) {
        return 0;
    }
    return 1;
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
