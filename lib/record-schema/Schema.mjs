/**
 * Schema class for JSON Schema validation
 * @module classes/Schema
 */

import { existsSync } from "node:fs";
import { readJson } from "../util/files.mjs";
import { isArray, isDate, isDateTime, isUri } from "../util/general.mjs";
import { hasProperty, hasPropertyOfType, isObject } from "../util/objects.mjs";

/**
 * @typedef {import("../types/general.mjs").Metadata} Metadata
 * @typedef {import("./types/general.mjs").SchemaError} SchemaError
 * @typedef {import("./types/general.mjs").SchemaDefinition} SchemaDefinition
 **/

/**
 * JSON Schema wrapper with validation capabilities
 */
export class Schema {
    /**
     * @param {SchemaDefinition} definition
     * @param {string | null} [source_path]
     */
    constructor(definition, source_path = null) {
        /** @type {SchemaDefinition} */
        this.definition = definition;

        /** @type {string | null} */
        this.source_path = source_path;
    }

    // =========================================================================
    // Static Factory Methods
    // =========================================================================

    /**
     * Load schema from JSON file
     * @param {string} abs_path
     * @returns {Schema}
     */
    static load(abs_path) {
        return new Schema(
            /** @type {SchemaDefinition} */ readJson(abs_path),
            abs_path
        );
    }

    /**
     * Load schema from JSON file if it exists
     * @param {string} abs_path
     * @returns {Schema | null}
     */
    static loadIfExists(abs_path) {
        if (!existsSync(abs_path)) {
            return null;
        }
        return Schema.load(abs_path);
    }

    // =========================================================================
    // Instance Methods
    // =========================================================================

    /**
     * Validate a value against this schema
     * @param {unknown} value
     * @returns {SchemaError[]}
     */
    validate(value) {
        /** @type {SchemaError[]} */
        const errors = [];
        Schema._validateWithSchema(
            value,
            this.definition,
            this.definition,
            "",
            errors
        );
        return errors;
    }

    /**
     * Check if a value is valid against this schema
     * @param {unknown} value
     * @returns {boolean}
     */
    isValid(value) {
        return this.validate(value).length === 0;
    }

    /**
     * Get a sub-schema by $ref path
     * @param {string} ref
     * @returns {unknown}
     */
    resolveRef(ref) {
        return Schema._resolveRef(this.definition, ref);
    }

    // =========================================================================
    // Private Static Helpers
    // =========================================================================

    /**
     * @param {Metadata} root
     * @param {string} ref
     * @returns {unknown}
     * @private
     */
    static _resolveRef(root, ref) {
        if (!ref.startsWith("#/")) {
            throw new Error(`Only internal $ref supported: ${ref}`);
        }
        const parts = ref.slice(2).split("/");
        /** @type {unknown} */
        let cur = root;
        for (let i = 0, len = parts.length; i < len; i++) {
            const key = parts[i];
            if (!isObject(cur) && !isArray(cur)) {
                throw new Error(`Invalid $ref path: ${ref}`);
            }
            // @ts-ignore
            cur = cur[key];
        }
        return cur;
    }

    /**
     * @param {unknown} v
     * @param {unknown} schema
     * @param {Metadata} root
     * @param {string} path
     * @param {SchemaError[]} errors
     * @private
     */
    static _validateWithSchema(v, schema, root, path, errors) {
        if (!isObject(schema)) {
            return;
        }

        if (hasPropertyOfType(schema, "$ref", "string")) {
            const resolved = Schema._resolveRef(root, schema["$ref"]);
            Schema._validateWithSchema(v, resolved, root, path, errors);
            return;
        }

        if (isArray(schema["allOf"])) {
            const arr = /** @type {unknown[]} */ (schema["allOf"]);
            for (let i = 0, len = arr.length; i < len; i++) {
                Schema._validateWithSchema(v, arr[i], root, path, errors);
            }
        }

        if (isArray(schema["anyOf"])) {
            const arr = /** @type {unknown[]} */ (schema["anyOf"]);
            /** @type {SchemaError[][]} */
            const candidateErrors = [];
            for (let i = 0, len = arr.length; i < len; i++) {
                /** @type {SchemaError[]} */
                const local = [];
                Schema._validateWithSchema(v, arr[i], root, path, local);
                if (local.length === 0) {
                    return;
                }
                candidateErrors.push(local);
            }
            let best = candidateErrors[0] || [];
            for (let i = 1; i < candidateErrors.length; i++) {
                if (candidateErrors[i].length < best.length) {
                    best = candidateErrors[i];
                }
            }
            errors.push({
                path,
                message: `Value does not match anyOf (${candidateErrors.length} options).`
            });
            for (let i = 0, len = best.length; i < len; i++) {
                errors.push(best[i]);
            }
            return;
        }

        if (hasProperty(schema, "const")) {
            if (v !== schema["const"]) {
                errors.push({
                    path,
                    message: `Expected const ${JSON.stringify(schema["const"])}`
                });
                return;
            }
        }

        if (isArray(schema["enum"])) {
            const arr = /** @type {unknown[]} */ (schema["enum"]);
            let ok = false;
            for (let i = 0, len = arr.length; i < len; i++) {
                if (v === arr[i]) {
                    ok = true;
                    break;
                }
            }
            if (!ok) {
                errors.push({
                    path,
                    message: `Expected one of enum values (${arr.length}).`
                });
                return;
            }
        }

        const t = schema["type"];
        if (typeof t === "string") {
            Schema._validateType(v, t, schema, root, path, errors);
        }
    }

    /**
     * @param {unknown} v
     * @param {string} t
     * @param {Metadata} schema
     * @param {Metadata} root
     * @param {string} path
     * @param {SchemaError[]} errors
     * @private
     */
    static _validateType(v, t, schema, root, path, errors) {
        if (t === "object") {
            Schema._validateObject(v, schema, root, path, errors);
            return;
        }

        if (t === "array") {
            Schema._validateArray(v, schema, root, path, errors);
            return;
        }

        if (t === "string") {
            Schema._validateString(v, schema, path, errors);
            return;
        }

        if (t === "integer") {
            if (typeof v !== "number" || !Number.isInteger(v)) {
                errors.push({ path, message: "Expected integer" });
                return;
            }
            Schema._validateNumericBounds(v, schema, path, errors);
            return;
        }

        if (t === "number") {
            if (typeof v !== "number") {
                errors.push({ path, message: "Expected number" });
                return;
            }
            Schema._validateNumericBounds(v, schema, path, errors);
            return;
        }

        if (t === "boolean") {
            if (typeof v !== "boolean") {
                errors.push({ path, message: "Expected boolean" });
            }
            return;
        }

        if (t === "null") {
            if (v !== null) {
                errors.push({ path, message: "Expected null" });
            }
            return;
        }
    }

    /**
     * @param {unknown} v
     * @param {Metadata} schema
     * @param {Metadata} root
     * @param {string} path
     * @param {SchemaError[]} errors
     * @private
     */
    static _validateObject(v, schema, root, path, errors) {
        if (!isObject(v)) {
            errors.push({ path, message: "Expected object" });
            return;
        }
        const obj = /** @type {Metadata} */ (v);

        if (isArray(schema["required"])) {
            const req = /** @type {unknown[]} */ (schema["required"]);
            for (let i = 0, len = req.length; i < len; i++) {
                const key = req[i];
                if (typeof key !== "string") {
                    continue;
                }
                if (!hasProperty(obj, key)) {
                    errors.push({
                        path: path ? `${path}.${key}` : key,
                        message: "Missing required property"
                    });
                }
            }
        }

        /** @type {Metadata} */
        const props = isObject(schema["properties"])
            ? /** @type {Metadata} */ (schema["properties"])
            : {};
        /** @type {{ re: RegExp, schema: unknown }[]} */
        const pat = [];
        if (isObject(schema["patternProperties"])) {
            const pp = /** @type {Metadata} */ (schema["patternProperties"]);
            for (const k of Object.keys(pp)) {
                try {
                    pat.push({ re: new RegExp(k), schema: pp[k] });
                } catch {
                    // ignore
                }
            }
        }

        const additional = hasProperty(schema, "additionalProperties")
            ? schema["additionalProperties"]
            : true;

        for (const key of Object.keys(obj)) {
            const childPath = path ? `${path}.${key}` : key;
            if (hasProperty(props, key)) {
                Schema._validateWithSchema(
                    obj[key],
                    props[key],
                    root,
                    childPath,
                    errors
                );
                continue;
            }
            let matched = false;
            for (let i = 0, len = pat.length; i < len; i++) {
                if (pat[i].re.test(key)) {
                    matched = true;
                    Schema._validateWithSchema(
                        obj[key],
                        pat[i].schema,
                        root,
                        childPath,
                        errors
                    );
                    break;
                }
            }
            if (!matched) {
                if (additional === false) {
                    errors.push({
                        path: childPath,
                        message: "Unknown property (additionalProperties=false)"
                    });
                } else if (isObject(additional)) {
                    Schema._validateWithSchema(
                        obj[key],
                        additional,
                        root,
                        childPath,
                        errors
                    );
                }
            }
        }
    }

    /**
     * @param {unknown} v
     * @param {Metadata} schema
     * @param {Metadata} root
     * @param {string} path
     * @param {SchemaError[]} errors
     * @private
     */
    static _validateArray(v, schema, root, path, errors) {
        if (!isArray(v)) {
            errors.push({ path, message: "Expected array" });
            return;
        }
        const arr = /** @type {unknown[]} */ (v);

        if (hasPropertyOfType(schema, "minItems", "number")) {
            if (arr.length < schema["minItems"]) {
                errors.push({
                    path,
                    message: `Expected at least ${schema["minItems"]} items`
                });
            }
        }
        if (hasPropertyOfType(schema, "maxItems", "number")) {
            if (arr.length > schema["maxItems"]) {
                errors.push({
                    path,
                    message: `Expected at most ${schema["maxItems"]} items`
                });
            }
        }
        if (schema["uniqueItems"] === true) {
            const seen = new Set();
            for (let i = 0, len = arr.length; i < len; i++) {
                const k = JSON.stringify(arr[i]);
                if (seen.has(k)) {
                    errors.push({ path, message: "Expected unique items" });
                    break;
                }
                seen.add(k);
            }
        }
        if (hasProperty(schema, "items")) {
            const itemSchema = schema["items"];
            for (let i = 0, len = arr.length; i < len; i++) {
                Schema._validateWithSchema(
                    arr[i],
                    itemSchema,
                    root,
                    `${path}[${i}]`,
                    errors
                );
            }
        }
    }

    /**
     * @param {unknown} v
     * @param {Metadata} schema
     * @param {string} path
     * @param {SchemaError[]} errors
     * @private
     */
    static _validateString(v, schema, path, errors) {
        if (typeof v !== "string") {
            errors.push({ path, message: "Expected string" });
            return;
        }
        if (
            hasPropertyOfType(schema, "minLength", "number") &&
            v.length < schema["minLength"]
        ) {
            errors.push({
                path,
                message: `Expected minLength ${schema["minLength"]}`
            });
        }
        if (
            hasPropertyOfType(schema, "maxLength", "number") &&
            v.length > schema["maxLength"]
        ) {
            errors.push({
                path,
                message: `Expected maxLength ${schema["maxLength"]}`
            });
        }
        if (hasPropertyOfType(schema, "pattern", "string")) {
            let re;
            try {
                re = new RegExp(schema["pattern"]);
            } catch {
                re = null;
            }
            if (re && !re.test(v)) {
                errors.push({
                    path,
                    message: `String does not match pattern ${schema["pattern"]}`
                });
            }
        }
        if (hasPropertyOfType(schema, "format", "string")) {
            const fmt = schema["format"];
            if (fmt === "date" && !isDate(v)) {
                errors.push({
                    path,
                    message: "String is not a date (YYYY-MM-DD)"
                });
            }
            if (fmt === "date-time" && !isDateTime(v)) {
                errors.push({ path, message: "String is not a date-time" });
            }
            if (fmt === "uri" && !isUri(v)) {
                errors.push({ path, message: "String is not a valid URI" });
            }
        }
    }

    /**
     * @param {number} v
     * @param {Metadata} schema
     * @param {string} path
     * @param {SchemaError[]} errors
     * @private
     */
    static _validateNumericBounds(v, schema, path, errors) {
        if (
            hasPropertyOfType(schema, "minimum", "number") &&
            v < schema["minimum"]
        ) {
            errors.push({ path, message: `Expected >= ${schema["minimum"]}` });
        }
        if (
            hasPropertyOfType(schema, "maximum", "number") &&
            v > schema["maximum"]
        ) {
            errors.push({ path, message: `Expected <= ${schema["maximum"]}` });
        }
    }
}
