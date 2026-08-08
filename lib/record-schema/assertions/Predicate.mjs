/**
 * Predicates for corpus assertions.
 *
 * A predicate is a mapping of selector path to condition, evaluated against one
 * value. Two names are reserved as logical combinators - `all`, `any`, `none`,
 * `not` - and everything else is read as a path. A document that genuinely
 * carries a key called `all` is still reachable, as `$.all`.
 *
 * Conditions run against the *set* of values a path selects, not a single
 * value, because a path may select none or many. `exists` and `absent` are
 * defined on the cardinality of that set; every other operator requires a
 * non-empty set and, by default, holds for all of it. `mode: any` relaxes that
 * to at least one.
 *
 * @module record-schema/assertions/Predicate
 */

import { evaluatePath, evaluatePathValues, isPlainObject } from "./Path.mjs";
import { evaluateExpression } from "./Expression.mjs";

/** @typedef {import("./types/general.mjs").Predicate} Predicate */
/** @typedef {import("./types/general.mjs").Condition} Condition */

const LOGICAL_KEYS = new Set(["all", "any", "none", "not", "expr"]);

const CARDINALITY_OPERATORS = new Set([
    "exists",
    "absent",
    "count_eq",
    "count_gte",
    "count_lte"
]);

/**
 * Evaluate a predicate against a value.
 *
 * @param {Predicate | null | undefined} predicate
 * @param {unknown} value
 * @param {Record<string, unknown>} [context] built-in bindings such as #file
 * @returns {boolean}
 */
export function evaluatePredicate(predicate, value, context = {}) {
    if (predicate === null || predicate === undefined) {
        return true;
    }
    if (typeof predicate === "boolean") {
        return predicate;
    }
    if (!isPlainObject(predicate)) {
        throw new Error("predicate must be a mapping");
    }

    const clause = /** @type {Record<string, unknown>} */ (predicate);
    const keys = Object.keys(clause);

    for (let i = 0, len = keys.length; i < len; i++) {
        const key = keys[i];

        if (key === "all") {
            if (!every(clause.all, value, context)) {
                return false;
            }
            continue;
        }
        if (key === "any") {
            if (!some(clause.any, value, context)) {
                return false;
            }
            continue;
        }
        if (key === "none") {
            if (some(clause.none, value, context)) {
                return false;
            }
            continue;
        }
        if (key === "expr") {
            if (!evaluateExpressionClause(clause.expr, value)) {
                return false;
            }
            continue;
        }
        if (key === "not") {
            if (
                evaluatePredicate(
                    /** @type {Predicate} */ (clause.not),
                    value,
                    context
                )
            ) {
                return false;
            }
            continue;
        }

        if (
            !evaluateCondition(
                key,
                /** @type {Condition} */ (clause[key]),
                value,
                context
            )
        ) {
            return false;
        }
    }

    return true;
}

/**
 * An arithmetic guard over the matched value.
 *
 * Some scoping conditions are not "this field equals that" but a relation
 * between several of a node's own numbers - a dense ordinal registry has a
 * maximum near its member count, a sparse allocation table does not. Writing
 * that as a chain of comparisons hides the claim; writing it as an expression
 * states it.
 *
 * @param {unknown} clause
 * @param {unknown} value
 * @returns {boolean}
 */
function evaluateExpressionClause(clause, value) {
    if (!isPlainObject(clause)) {
        throw new Error("`expr` takes { bind, assert }");
    }

    const spec = /** @type {Record<string, unknown>} */ (clause);
    const bindSpec = isPlainObject(spec.bind)
        ? /** @type {Record<string, string>} */ (spec.bind)
        : {};
    const names = Object.keys(bindSpec);

    /** @type {Record<string, unknown>} */
    const bindings = {};

    for (let i = 0, len = names.length; i < len; i++) {
        const name = names[i];
        const expression = bindSpec[name];
        const values = evaluatePathValues(value, expression);

        if (
            expression.includes("[*]") ||
            expression.includes("..") ||
            expression.includes(".*")
        ) {
            bindings[name] = values.map((item) => {
                const numeric = coerceNumber(item);
                return numeric === null ? item : numeric;
            });
            continue;
        }
        bindings[name] = values.length === 0 ? null : values[0];
    }

    return evaluateExpression(String(spec.assert), bindings) === true;
}

/**
 * @param {unknown} list
 * @param {unknown} value
 * @param {Record<string, unknown>} context
 * @returns {boolean}
 */
function every(list, value, context) {
    if (!Array.isArray(list)) {
        throw new Error("`all` takes a list of predicates");
    }
    for (let i = 0, len = list.length; i < len; i++) {
        if (
            !evaluatePredicate(
                /** @type {Predicate} */ (list[i]),
                value,
                context
            )
        ) {
            return false;
        }
    }
    return true;
}

/**
 * @param {unknown} list
 * @param {unknown} value
 * @param {Record<string, unknown>} context
 * @returns {boolean}
 */
function some(list, value, context) {
    if (!Array.isArray(list)) {
        throw new Error("`any`/`none` takes a list of predicates");
    }
    for (let i = 0, len = list.length; i < len; i++) {
        if (
            evaluatePredicate(
                /** @type {Predicate} */ (list[i]),
                value,
                context
            )
        ) {
            return true;
        }
    }
    return false;
}

/**
 * @param {string} pathExpression
 * @param {Condition} condition
 * @param {unknown} value
 * @param {Record<string, unknown>} context
 * @returns {boolean}
 */
function evaluateCondition(pathExpression, condition, value, context) {
    const selected = selectFor(pathExpression, value, context);

    if (!isPlainObject(condition)) {
        return holdsForAll(selected, (item) => looseEqual(item, condition));
    }

    const spec = /** @type {Record<string, unknown>} */ (condition);
    const mode = spec.mode === "any" ? "any" : "all";
    const operators = Object.keys(spec).filter((key) => key !== "mode");

    for (let i = 0, len = operators.length; i < len; i++) {
        const operator = operators[i];
        const operand = spec[operator];

        if (CARDINALITY_OPERATORS.has(operator)) {
            if (!evaluateCardinality(operator, operand, selected)) {
                return false;
            }
            continue;
        }

        if (selected.length === 0) {
            return false;
        }

        /** @type {(item: unknown) => boolean} */
        const test = (item) => evaluateOperator(operator, operand, item);
        const held =
            mode === "any"
                ? holdsForSome(selected, test)
                : holdsForAll(selected, test);

        if (!held) {
            return false;
        }
    }

    return true;
}

/**
 * @param {string} pathExpression
 * @param {unknown} value
 * @param {Record<string, unknown>} context
 * @returns {unknown[]}
 */
function selectFor(pathExpression, value, context) {
    if (pathExpression.startsWith("#")) {
        const bound = context[pathExpression];
        return bound === undefined ? [] : [bound];
    }

    const matches = evaluatePath(value, pathExpression);
    /** @type {unknown[]} */
    const out = [];
    for (let i = 0, len = matches.length; i < len; i++) {
        out.push(matches[i].value);
    }
    return out;
}

/**
 * @param {string} operator
 * @param {unknown} operand
 * @param {unknown[]} selected
 * @returns {boolean}
 */
function evaluateCardinality(operator, operand, selected) {
    if (operator === "exists") {
        return operand === false ? selected.length === 0 : selected.length > 0;
    }
    if (operator === "absent") {
        return operand === false ? selected.length > 0 : selected.length === 0;
    }
    if (operator === "count_eq") {
        return selected.length === Number(operand);
    }
    if (operator === "count_gte") {
        return selected.length >= Number(operand);
    }
    return selected.length <= Number(operand);
}

/**
 * @param {string} operator
 * @param {unknown} operand
 * @param {unknown} item
 * @returns {boolean}
 */
function evaluateOperator(operator, operand, item) {
    switch (operator) {
        case "eq":
            return looseEqual(item, operand);
        case "ne":
            return !looseEqual(item, operand);
        case "in":
            return asArray(operand).some((candidate) =>
                looseEqual(item, candidate)
            );
        case "nin":
            return !asArray(operand).some((candidate) =>
                looseEqual(item, candidate)
            );
        case "gt":
            return toNumber(item) > toNumber(operand);
        case "gte":
            return toNumber(item) >= toNumber(operand);
        case "lt":
            return toNumber(item) < toNumber(operand);
        case "lte":
            return toNumber(item) <= toNumber(operand);
        case "matches":
            return toRegExp(operand).test(toText(item));
        case "not_matches":
            return !toRegExp(operand).test(toText(item));
        case "contains":
            return containsValue(item, operand);
        case "starts_with":
            return toText(item).startsWith(String(operand));
        case "ends_with":
            return toText(item).endsWith(String(operand));
        case "type":
            return matchesType(item, String(operand));
        case "empty":
            return operand === false ? !isEmpty(item) : isEmpty(item);
        case "has_key":
            return (
                isPlainObject(item) &&
                asArray(operand).every((key) =>
                    Object.prototype.hasOwnProperty.call(
                        /** @type {Record<string, unknown>} */ (item),
                        String(key)
                    )
                )
            );
        case "lacks_key":
            return (
                !isPlainObject(item) ||
                asArray(operand).every(
                    (key) =>
                        !Object.prototype.hasOwnProperty.call(
                            /** @type {Record<string, unknown>} */ (item),
                            String(key)
                        )
                )
            );
        default:
            throw new Error(`unknown condition operator "${operator}"`);
    }
}

/**
 * @param {unknown[]} items
 * @param {(item: unknown) => boolean} test
 * @returns {boolean}
 */
function holdsForAll(items, test) {
    for (let i = 0, len = items.length; i < len; i++) {
        if (!test(items[i])) {
            return false;
        }
    }
    return items.length > 0;
}

/**
 * @param {unknown[]} items
 * @param {(item: unknown) => boolean} test
 * @returns {boolean}
 */
function holdsForSome(items, test) {
    for (let i = 0, len = items.length; i < len; i++) {
        if (test(items[i])) {
            return true;
        }
    }
    return false;
}

/**
 * Equality that treats 8 and "8" and 0x08 as the same physical fact, because
 * YAML authors write byte counts all three ways and a gate that reported the
 * difference would be reporting on the parser rather than on the corpus.
 *
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
export function looseEqual(left, right) {
    if (left === right) {
        return true;
    }
    if (left === null || right === null) {
        return false;
    }
    if (typeof left === "object" || typeof right === "object") {
        return JSON.stringify(left) === JSON.stringify(right);
    }
    if (typeof left === "boolean" || typeof right === "boolean") {
        return String(left) === String(right);
    }

    const leftNumber = coerceNumber(left);
    const rightNumber = coerceNumber(right);
    if (leftNumber !== null && rightNumber !== null) {
        return leftNumber === rightNumber;
    }

    return String(left) === String(right);
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
export function coerceNumber(value) {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value !== "string") {
        return null;
    }
    const text = value.trim().replace(/_/g, "");
    if (text.length === 0) {
        return null;
    }
    if (/^[+-]?0[xX][0-9a-fA-F]+$/.test(text)) {
        return Number.parseInt(text, 16);
    }
    if (/^[+-]?0[bB][01]+$/.test(text)) {
        return Number.parseInt(text.replace(/0[bB]/, ""), 2);
    }
    if (/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) {
        return Number(text);
    }
    return null;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function toNumber(value) {
    const coerced = coerceNumber(value);
    return coerced === null ? Number.NaN : coerced;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function toText(value) {
    if (value === null || value === undefined) {
        return "";
    }
    if (typeof value === "object") {
        return JSON.stringify(value);
    }
    return String(value);
}

/**
 * @param {unknown} operand
 * @returns {RegExp}
 */
function toRegExp(operand) {
    if (operand instanceof RegExp) {
        return operand;
    }
    if (isPlainObject(operand)) {
        const spec = /** @type {Record<string, unknown>} */ (operand);
        return new RegExp(String(spec.pattern), String(spec.flags ?? ""));
    }
    return new RegExp(String(operand));
}

/**
 * @param {unknown} operand
 * @returns {unknown[]}
 */
function asArray(operand) {
    return Array.isArray(operand) ? operand : [operand];
}

/**
 * @param {unknown} item
 * @param {unknown} operand
 * @returns {boolean}
 */
function containsValue(item, operand) {
    if (Array.isArray(item)) {
        return item.some((candidate) => looseEqual(candidate, operand));
    }
    if (typeof item === "string") {
        return item.includes(String(operand));
    }
    return false;
}

/**
 * @param {unknown} item
 * @param {string} name
 * @returns {boolean}
 */
function matchesType(item, name) {
    switch (name) {
        case "string":
            return typeof item === "string";
        case "number":
            return typeof item === "number";
        case "integer":
            return typeof item === "number" && Number.isInteger(item);
        case "boolean":
            return typeof item === "boolean";
        case "array":
            return Array.isArray(item);
        case "object":
            return isPlainObject(item);
        case "null":
            return item === null;
        case "scalar":
            return (
                item === null ||
                (typeof item !== "object" && typeof item !== "function")
            );
        default:
            throw new Error(`unknown type name "${name}"`);
    }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isEmpty(value) {
    if (value === null || value === undefined) {
        return true;
    }
    if (typeof value === "string") {
        return value.trim().length === 0;
    }
    if (Array.isArray(value)) {
        return value.length === 0;
    }
    if (isPlainObject(value)) {
        return (
            Object.keys(/** @type {Record<string, unknown>} */ (value))
                .length === 0
        );
    }
    return false;
}
