/**
 * Selector paths for corpus assertions.
 *
 * A path is a deliberately small subset of JSONPath. It is small because every
 * construct it admits has to be executable identically by any conforming
 * implementation; an expression language with a host escape hatch would put
 * behaviour back into the consumer, which is the thing this layer exists to
 * remove.
 *
 * Grammar:
 *
 *   path     := "$" segment*
 *   segment  := ".." NAME        recursive descent by key
 *             | "." NAME         child by key
 *             | "." "*"          every child (array item or object value)
 *             | "[" INDEX "]"    array index, negative counts from the end
 *             | "[" "*" "]"      every child
 *             | "[" "'" STR "'" "]"
 *
 * A leading "$" may be omitted. Evaluation is total: a path that matches
 * nothing yields an empty list rather than an error, because "absent" is a
 * condition assertions test rather than a fault.
 *
 * @module record-schema/assertions/Path
 */

/** @typedef {import("./types/general.mjs").PathMatch} PathMatch */
/** @typedef {import("./types/general.mjs").PathSegment} PathSegment */

const NAME_CHARS = /[A-Za-z0-9_\-.]/;

/** @type {Map<string, PathSegment[]>} */
const COMPILE_CACHE = new Map();

/**
 * Compile a selector path into segments.
 *
 * @param {string} expression
 * @returns {PathSegment[]}
 */
export function compilePath(expression) {
    const cached = COMPILE_CACHE.get(expression);
    if (cached !== undefined) {
        return cached;
    }

    const segments = parsePath(expression);
    COMPILE_CACHE.set(expression, segments);
    return segments;
}

/**
 * @param {string} expression
 * @returns {PathSegment[]}
 */
function parsePath(expression) {
    if (typeof expression !== "string" || expression.length === 0) {
        throw new Error("selector path must be a non-empty string");
    }

    let index = 0;
    if (expression[0] === "$") {
        index = 1;
    }

    /** @type {PathSegment[]} */
    const segments = [];

    while (index < expression.length) {
        const character = expression[index];

        if (character === ".") {
            if (expression[index + 1] === ".") {
                index += 2;
                if (expression[index] === "*") {
                    segments.push({ kind: "descend_all" });
                    index += 1;
                    continue;
                }
                const name = readName(expression, index);
                if (name.text.length === 0) {
                    throw new Error(
                        `selector path "${expression}": ".." needs a key or "*"`
                    );
                }
                segments.push({ kind: "descend", name: name.text });
                index = name.next;
                continue;
            }

            index += 1;
            if (expression[index] === "*") {
                segments.push({ kind: "each" });
                index += 1;
                continue;
            }

            const name = readName(expression, index);
            if (name.text.length === 0) {
                throw new Error(
                    `selector path "${expression}": "." needs a key`
                );
            }
            segments.push({ kind: "child", name: name.text });
            index = name.next;
            continue;
        }

        if (character === "[") {
            const close = expression.indexOf("]", index);
            if (close === -1) {
                throw new Error(
                    `selector path "${expression}": unterminated "["`
                );
            }
            const inner = expression.slice(index + 1, close).trim();
            index = close + 1;

            if (inner === "*") {
                segments.push({ kind: "each" });
                continue;
            }
            if (
                (inner.startsWith("'") && inner.endsWith("'")) ||
                (inner.startsWith('"') && inner.endsWith('"'))
            ) {
                segments.push({ kind: "child", name: inner.slice(1, -1) });
                continue;
            }
            if (/^-?\d+$/.test(inner)) {
                segments.push({ kind: "index", index: Number(inner) });
                continue;
            }
            throw new Error(
                `selector path "${expression}": unsupported subscript "${inner}"`
            );
        }

        if (segments.length === 0 && NAME_CHARS.test(character)) {
            const name = readName(expression, index);
            segments.push({ kind: "child", name: name.text });
            index = name.next;
            continue;
        }

        throw new Error(
            `selector path "${expression}": unexpected "${character}" at ${index}`
        );
    }

    return segments;
}

/**
 * @param {string} text
 * @param {number} start
 * @returns {{ text: string, next: number }}
 */
function readName(text, start) {
    let end = start;
    while (end < text.length && NAME_CHARS.test(text[end])) {
        if (text[end] === ".") {
            break;
        }
        end += 1;
    }
    return { text: text.slice(start, end), next: end };
}

/**
 * Evaluate a compiled or literal path against a value.
 *
 * @param {unknown} root
 * @param {string | PathSegment[]} expression
 * @param {string} [basePath]
 * @returns {PathMatch[]}
 */
export function evaluatePath(root, expression, basePath = "$") {
    const segments = Array.isArray(expression)
        ? expression
        : compilePath(expression);

    /** @type {PathMatch[]} */
    let current = [{ path: basePath, value: root, parent: null, key: null }];

    for (let i = 0, len = segments.length; i < len; i++) {
        const segment = segments[i];
        /** @type {PathMatch[]} */
        const next = [];

        for (let j = 0, matchCount = current.length; j < matchCount; j++) {
            applySegment(segment, current[j], next);
        }

        current = next;
        if (current.length === 0) {
            return current;
        }
    }

    return current;
}

/**
 * Evaluate a path and return only the values.
 *
 * @param {unknown} root
 * @param {string | PathSegment[]} expression
 * @returns {unknown[]}
 */
export function evaluatePathValues(root, expression) {
    const matches = evaluatePath(root, expression);
    /** @type {unknown[]} */
    const values = [];
    for (let i = 0, len = matches.length; i < len; i++) {
        values.push(matches[i].value);
    }
    return values;
}

/**
 * Evaluate a path and return the first value, or undefined.
 *
 * @param {unknown} root
 * @param {string | PathSegment[]} expression
 * @returns {unknown}
 */
export function evaluatePathFirst(root, expression) {
    const matches = evaluatePath(root, expression);
    return matches.length === 0 ? undefined : matches[0].value;
}

/**
 * @param {PathSegment} segment
 * @param {PathMatch} match
 * @param {PathMatch[]} out
 * @returns {void}
 */
function applySegment(segment, match, out) {
    const value = match.value;

    if (segment.kind === "child") {
        if (!isIndexable(value)) {
            return;
        }
        const container = /** @type {Record<string, unknown>} */ (value);
        if (!Object.prototype.hasOwnProperty.call(container, segment.name)) {
            return;
        }
        out.push({
            path: `${match.path}.${segment.name}`,
            value: container[segment.name],
            parent: value,
            key: segment.name
        });
        return;
    }

    if (segment.kind === "each") {
        if (Array.isArray(value)) {
            for (let i = 0, len = value.length; i < len; i++) {
                out.push({
                    path: `${match.path}[${i}]`,
                    value: value[i],
                    parent: value,
                    key: i
                });
            }
            return;
        }
        if (isPlainObject(value)) {
            const container = /** @type {Record<string, unknown>} */ (value);
            const keys = Object.keys(container);
            for (let i = 0, len = keys.length; i < len; i++) {
                out.push({
                    path: `${match.path}.${keys[i]}`,
                    value: container[keys[i]],
                    parent: value,
                    key: keys[i]
                });
            }
        }
        return;
    }

    if (segment.kind === "index") {
        if (!Array.isArray(value)) {
            return;
        }
        const resolved =
            segment.index < 0 ? value.length + segment.index : segment.index;
        if (resolved < 0 || resolved >= value.length) {
            return;
        }
        out.push({
            path: `${match.path}[${resolved}]`,
            value: value[resolved],
            parent: value,
            key: resolved
        });
        return;
    }

    if (segment.kind === "descend") {
        descend(match, segment.name, out);
        return;
    }

    if (segment.kind === "descend_all") {
        descendAll(match, out);
    }
}

/**
 * Every descendant node, in document order. `#key` carries the key each node
 * hangs off, which is what a rule banning a spelling rather than a location
 * needs to test.
 *
 * @param {PathMatch} match
 * @param {PathMatch[]} out
 * @returns {void}
 */
function descendAll(match, out) {
    const value = match.value;

    if (Array.isArray(value)) {
        for (let i = 0, len = value.length; i < len; i++) {
            const child = {
                path: `${match.path}[${i}]`,
                value: value[i],
                parent: value,
                key: i
            };
            out.push(child);
            descendAll(child, out);
        }
        return;
    }

    if (!isPlainObject(value)) {
        return;
    }

    const container = /** @type {Record<string, unknown>} */ (value);
    const keys = Object.keys(container);

    for (let i = 0, len = keys.length; i < len; i++) {
        const child = {
            path: `${match.path}.${keys[i]}`,
            value: container[keys[i]],
            parent: value,
            key: keys[i]
        };
        out.push(child);
        descendAll(child, out);
    }
}

/**
 * Recursive descent by key. Order is document order so findings are stable.
 *
 * @param {PathMatch} match
 * @param {string} name
 * @param {PathMatch[]} out
 * @returns {void}
 */
function descend(match, name, out) {
    const value = match.value;

    if (Array.isArray(value)) {
        for (let i = 0, len = value.length; i < len; i++) {
            descend(
                {
                    path: `${match.path}[${i}]`,
                    value: value[i],
                    parent: value,
                    key: i
                },
                name,
                out
            );
        }
        return;
    }

    if (!isPlainObject(value)) {
        return;
    }

    const container = /** @type {Record<string, unknown>} */ (value);
    const keys = Object.keys(container);

    for (let i = 0, len = keys.length; i < len; i++) {
        const key = keys[i];
        const child = container[key];
        const childPath = `${match.path}.${key}`;

        if (key === name) {
            out.push({
                path: childPath,
                value: child,
                parent: value,
                key
            });
        }

        descend(
            { path: childPath, value: child, parent: value, key },
            name,
            out
        );
    }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isIndexable(value) {
    return typeof value === "object" && value !== null;
}
