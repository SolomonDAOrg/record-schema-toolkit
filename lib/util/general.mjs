/** @typedef {import("../types/general.mjs").Metadata} Metadata */

/**
 * @param {unknown} val
 * @returns {val is unknown[]}
 */
function isArray(val) {
    return Array.isArray(val);
}

/**
 * @param {unknown} val
 * @returns {val is string}
 */
function isString(val) {
    return typeof val === "string";
}

/**
 * @param {unknown} val
 * @returns {val is number}
 */
function isNumber(val) {
    return typeof val === "number";
}

/**
 * @param {unknown} val
 * @returns {val is number}
 */
function isFiniteNumber(val) {
    return typeof val === "number" && Number.isFinite(val);
}

/**
 * @param {unknown} val
 * @returns {val is boolean}
 */
function isBoolean(val) {
    return typeof val === "boolean";
}

/**
 * @param {unknown} val
 * @returns {boolean}
 */
function isDate(val) {
    if (typeof val !== "string") {
        return false;
    }
    return /^\d{4}-\d{2}-\d{2}$/.test(val);
}

/**
 * @param {unknown} val
 * @returns {boolean}
 */
function isDateTime(val) {
    if (typeof val !== "string") {
        return false;
    }
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        val
    );
}

/**
 * @param {unknown} val
 * @returns {boolean}
 */
function isUri(val) {
    if (typeof val !== "string") {
        return false;
    }
    try {
        new URL(val);
        return true;
    } catch {
        return false;
    }
}

/**
 * @param {unknown} val
 * @returns {boolean}
 */
function isTruthy(val) {
    return typeof val === "boolean"
        ? val === true
        : typeof val === "number"
        ? val === 1
            ? true
            : false
        : typeof val === "string"
        ? val === "1" ||
          val === "true" ||
          val === "TRUE" ||
          val === "yes" ||
          val === "YES" ||
          val === "t" ||
          val === "T" ||
          val === "Y" ||
          val === "y"
        : false;
}

// =========================================================================
// Type-Narrowing Helpers (value + fallback)
// =========================================================================

/**
 * Return `value` if it is a string, otherwise `fallback`.
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string|undefined}
 */
function stringOr(value, fallback) {
    return typeof value === "string" ? value : fallback;
}

/**
 * Return `value` if it is a boolean, otherwise `fallback`.
 * @param {unknown} value
 * @param {boolean} [fallback]
 * @returns {boolean|undefined}
 */
function boolOr(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
}

/**
 * Return `value` if it is a finite number, otherwise `fallback`.
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number|undefined}
 */
function numberOr(value, fallback) {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : fallback;
}

/**
 * Return `value` if it is a string present in `allowed`, otherwise `fallback`.
 * @param {unknown} value
 * @param {string[]} allowed
 * @param {string} fallback
 * @returns {string}
 */
function enumOr(value, allowed, fallback) {
    return typeof value === "string" && allowed.includes(value)
        ? value
        : fallback;
}

/**
 * @template {any} A
 * @overload
 * @param {A | null} [value]
 * @param {A} [fallback]
 * @returns {A}
 */
/**
 * Return `value` if it is a array, otherwise `fallback` or empty array.
 * @param {unknown} value
 * @param {[]} [fallback]
 * @returns {unknown[]}
 */
function arrayOr(value, fallback) {
    return Array.isArray(value)
        ? value
        : fallback !== undefined
        ? fallback
        : [];
}

export {
    isArray,
    isString,
    isNumber,
    isFiniteNumber,
    isBoolean,
    isDate,
    isDateTime,
    isUri,
    isTruthy,
    stringOr,
    boolOr,
    numberOr,
    enumOr,
    arrayOr
};
