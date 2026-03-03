/** @typedef {import("../types/general.mjs").Metadata} Metadata */

/**
 * Check if a value is a non-null, non-array object.
 * @template {object} [T=object]
 * @overload
 * @param {unknown} obj
 * @returns {obj is T}
 */
/**
 * @template {object} T
 * @overload
 * @param {T | null | undefined} obj
 * @returns {obj is T}
 */
/**
 * @param {unknown} obj
 * @returns {obj is Metadata}
 */
function isObject(obj) {
    return (
        obj !== null &&
        obj !== undefined &&
        typeof obj === "object" &&
        !Array.isArray(obj)
    );
}

/**
 * Check if an object has a specific property.
 * @template {Metadata} T
 * @template {string} K
 * @param {T} obj
 * @param {K} key
 * @returns {obj is T & Record<K, unknown>}
 */
function hasProperty(obj, key) {
    return (
        obj !== null &&
        obj !== undefined &&
        typeof obj === "object" &&
        key in obj
    );
}

/**
 * Check if an object has a property of a specific runtime type.
 * @template {Metadata} T
 * @template {string} K
 * @template {"string" | "number" | "boolean" | "bigint" | "symbol" | "undefined" | "object" | "function"} Type
 * @param {T} obj
 * @param {K} key
 * @param {Type} propType
 * @returns {obj is T & Record<K, Type extends "string" ? string : Type extends "number" ? number : Type extends "boolean" ? boolean : Type extends "bigint" ? bigint : Type extends "symbol" ? symbol : Type extends "undefined" ? undefined : Type extends "object" ? object : Type extends "function" ? Function : unknown>}
 */
function hasPropertyOfType(obj, key, propType) {
    return hasProperty(obj, key) && typeof obj[key] === propType;
}

/**
 * Check if an object has multiple properties.
 * @template {object} T
 * @template {readonly string[]} K
 * @param {T} obj
 * @param {K} keys
 * @returns {obj is T & Record<K[number], unknown>}
 */
function hasProperties(obj, keys) {
    return (
        obj !== null &&
        obj !== undefined &&
        typeof obj === "object" &&
        keys.every((key) => hasProperty(obj, key))
    );
}

/**
 * Check if a value is a plain object (not array, not class instance, etc.).
 * @param {unknown} obj
 * @returns {obj is Record<string, unknown>}
 */
function isPlainObject(obj) {
    return (
        obj !== null &&
        typeof obj === "object" &&
        !Array.isArray(obj) &&
        Object.getPrototypeOf(obj) === Object.prototype
    );
}

/**
 * Runtime check that an object has exactly one enumerable string key.
 * @param {unknown} obj
 * @returns {obj is import("@solomon-labs/types").AnySingleProperty}
 */
function hasSingleProperty(obj) {
    return (
        obj !== null &&
        typeof obj === "object" &&
        !Array.isArray(obj) &&
        Object.keys(obj).length === 1
    );
}

/**
 * @template {Metadata} T
 * @template {keyof T} K
 * @overload
 * @param {T | null | undefined} obj
 * @param {K} key
 * @returns {obj is T & { [P in K]-?: NonNullable<T[P]> }}
 */
/**
 * @template {Metadata} T
 * @template {keyof T} K
 * @overload
 * @param {T} obj
 * @param {K} key
 * @returns {obj is T & { [P in K]-?: NonNullable<T[P]> }}
 */
/**
 * @template {string | number | symbol} K
 * @overload
 * @param {unknown} obj
 * @param {K} key
 * @returns {obj is Record<K, NonNullable<unknown>> & object}
 */
/**
 * Check if an object has a property whose value is neither null nor undefined.
 * @param {*} obj
 * @param {string | number | symbol} key
 * @returns {boolean}
 */
function hasNonNullishProperty(obj, key) {
    return (
        obj !== null &&
        obj !== undefined &&
        typeof obj === "object" &&
        key in obj &&
        obj[/** @type {*} */ (key)] !== null &&
        obj[/** @type {*} */ (key)] !== undefined
    );
}

/**
 * Extract a value from a nested object using a dot-separated path or an array
 * of candidate paths (first match wins).
 * @param {unknown} data
 * @param {string | string[]} path - Dot-separated path or array of candidate paths.
 * @returns {unknown}
 */
function extractValue(data, path) {
    if (!isObject(data)) {
        return undefined;
    }
    const paths = Array.isArray(path) ? path : [path];
    for (let i = 0, len = paths.length; i < len; i++) {
        const currentPath = paths[i];
        const parts = currentPath.split(".");
        /** @type {*} */
        let current = data;
        for (let j = 0, partsLen = parts.length; j < partsLen; j++) {
            const part = parts[j];
            if (hasNonNullishProperty(current, part)) {
                current = current[part];
            } else {
                current = undefined;
                break;
            }
        }
        if (current !== undefined) {
            return current;
        }
    }
    return undefined;
}

/**
 * @typedef {object} MergeFieldStrategy
 * @property {string[]} [arrayConcat] - Keys whose array values are concatenated.
 * @property {string[]} [shallowMerge] - Keys whose object values are shallow-merged.
 */

/**
 * Shallow-merge `b` onto `a`, skipping any key in `b` whose value is
 * null or undefined so it cannot clobber an existing value in `a`.
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 * @returns {Record<string, unknown>}
 */
function shallowMergeNonNullish(a, b) {
    const out = { ...a };
    for (const key of Object.keys(b)) {
        const bv = b[key];
        if (bv !== null && bv !== undefined) {
            out[key] = bv;
        }
    }
    return out;
}

/**
 * Merge two objects using per-key strategies. Unmatched keys use last-write-wins.
 * Nullish values in `b` are skipped for unmatched keys so they never
 * overwrite existing values in `a`.
 * @template {Record<string, unknown>} T
 * @param {T | null | undefined} a
 * @param {T | null | undefined} b
 * @param {MergeFieldStrategy} [strategy]
 * @returns {T}
 */
function mergeObjects(a, b, strategy) {
    if (!isObject(a)) {
        return /** @type {T} */ (b ?? /** @type {T} */ ({}));
    }
    if (!isObject(b)) {
        return /** @type {T} */ (a);
    }
    const out = /** @type {Record<string, unknown>} */ ({ ...a });
    const concatSet = new Set(strategy?.arrayConcat);
    const mergeSet = new Set(strategy?.shallowMerge);
    for (const key of Object.keys(b)) {
        const av = out[key];
        const bv = b[key];
        if (concatSet.has(key) && Array.isArray(av) && Array.isArray(bv)) {
            out[key] = av.concat(bv);
        } else if (mergeSet.has(key) && isObject(av) && isObject(bv)) {
            out[key] = shallowMergeNonNullish(av, bv);
        } else if (bv !== null && bv !== undefined) {
            out[key] = bv;
        }
    }
    return /** @type {T} */ (out);
}

/**
 * Union two arrays with stable order. String elements are deduplicated;
 * non-strings are always appended.
 * @param {unknown[]} a
 * @param {unknown[]} b
 * @returns {unknown[]}
 */
function mergeArrayUnique(a, b) {
    const out = a.slice();
    for (let i = 0, len = b.length; i < len; i++) {
        const v = b[i];
        if (typeof v === "string") {
            if (!out.includes(v)) {
                out.push(v);
            }
        } else {
            out.push(v);
        }
    }
    return out;
}

/**
 * Deep merge two objects. Arrays are unioned (strings deduplicated),
 * nested objects are recursively merged, scalars use last-write-wins.
 * Nullish values in `b` are skipped — they never overwrite existing
 * values in `a`.
 * @template {Record<string, unknown>} T
 * @param {T | null | undefined} a
 * @param {T | null | undefined} b
 * @returns {T}
 */
function deepMerge(a, b) {
    if (!isObject(a)) {
        return /** @type {T} */ (b ?? /** @type {T} */ ({}));
    }
    if (!isObject(b)) {
        return /** @type {T} */ (a);
    }
    const out = /** @type {Record<string, unknown>} */ ({ ...a });
    for (const k of Object.keys(b)) {
        const bv = b[k];
        if (bv === null || bv === undefined) {
            continue;
        }
        const av = out[k];
        if (Array.isArray(av) && Array.isArray(bv)) {
            out[k] = mergeArrayUnique(av, bv);
        } else if (isObject(av) && isObject(bv)) {
            out[k] = deepMerge(av, bv);
        } else {
            out[k] = bv;
        }
    }
    return /** @type {T} */ (out);
}

/**
 * Return the first candidate that is a non-null object, or null.
 * @param {...unknown} candidates
 * @returns {Record<string, unknown> | null}
 */
function resolveObject(...candidates) {
    for (let i = 0, len = candidates.length; i < len; i++) {
        if (isObject(candidates[i])) {
            return /** @type {Record<string, unknown>} */ (candidates[i]);
        }
    }
    return null;
}

/** @typedef {"string" | "number" | "boolean" | "object"} LayeredType */

/**
 * @typedef {object} LayeredTypeMap
 * @property {string} string
 * @property {number} number
 * @property {boolean} boolean
 * @property {Record<string, unknown>} object
 */

/**
 * Pick the first matching value from layers (highest priority last, scanned in reverse).
 * For "number", only finite values are accepted.
 * @template {LayeredType} T
 * @param {Array<Record<string, unknown> | null | undefined>} layers
 * @param {string} key
 * @param {T} type
 * @param {LayeredTypeMap[T]} [fallback]
 * @returns {LayeredTypeMap[T] | undefined}
 */
function layeredValue(layers, key, type, fallback) {
    for (let i = layers.length - 1; i >= 0; i--) {
        const v = layers[i]?.[key];
        if (type === "object") {
            if (isObject(v)) {
                return /** @type {LayeredTypeMap[T]} */ (v);
            }
        } else if (typeof v === type) {
            if (type === "number" && !Number.isFinite(v)) {
                continue;
            }
            return /** @type {LayeredTypeMap[T]} */ (v);
        }
    }
    return fallback;
}

export {
    isObject,
    isPlainObject,
    hasProperty,
    hasProperties,
    hasPropertyOfType,
    hasNonNullishProperty,
    hasSingleProperty,
    extractValue,
    mergeObjects,
    mergeArrayUnique,
    deepMerge,
    resolveObject,
    layeredValue
};
