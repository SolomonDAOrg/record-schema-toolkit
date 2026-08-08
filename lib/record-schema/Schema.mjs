/**
 * Schema class for JSON Schema validation
 * @module classes/Schema
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readJson } from "../util/files.mjs";
import { isArray, isDate, isDateTime, isUri } from "../util/general.mjs";
import { hasProperty, hasPropertyOfType, isObject } from "../util/objects.mjs";

/**
 * @typedef {import("../types/general.mjs").Metadata} Metadata
 * @typedef {import("./types/general.mjs").SchemaError} SchemaError
 * @typedef {import("./types/general.mjs").SchemaDefinition} SchemaDefinition
 **/

/**
 * @typedef {Object} SchemaReferenceResolution
 * @property {SchemaDefinition} definition
 * @property {string | null} source_path
 */

/**
 * @callback SchemaReferenceResolver
 * @param {string} reference
 * @param {string | null} source_path
 * @returns {SchemaReferenceResolution | null}
 */

/**
 * JSON Schema wrapper with validation capabilities.
 *
 * The validator intentionally implements the assertion vocabulary used by the
 * Record Schema repositories rather than depending on an external package.
 */
export class Schema {
    /**
     * @param {SchemaDefinition} definition
     * @param {string | null} [source_path]
     * @param {SchemaReferenceResolver | null} [reference_resolver]
     */
    constructor(definition, source_path = null, reference_resolver = null) {
        /** @type {SchemaDefinition} */
        this.definition = definition;

        /** @type {string | null} */
        this.source_path = source_path;

        /** @type {SchemaReferenceResolver | null} */
        this.reference_resolver = reference_resolver;
    }

    // =========================================================================
    // Static Factory Methods
    // =========================================================================

    /**
     * Load schema from JSON file
     * @param {string} abs_path
     * @param {{ referenceResolver?: SchemaReferenceResolver }} [options]
     * @returns {Schema}
     */
    static load(abs_path, options = {}) {
        return new Schema(
            /** @type {SchemaDefinition} */ (readJson(abs_path)),
            abs_path,
            options.referenceResolver || null
        );
    }

    /**
     * Load schema from JSON file if it exists
     * @param {string} abs_path
     * @param {{ referenceResolver?: SchemaReferenceResolver }} [options]
     * @returns {Schema | null}
     */
    static loadIfExists(abs_path, options = {}) {
        if (!existsSync(abs_path)) {
            return null;
        }
        return Schema.load(abs_path, options);
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
            errors,
            this.source_path,
            this.reference_resolver
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
        return Schema._resolveRef(
            this.definition,
            ref,
            this.source_path,
            this.reference_resolver
        ).schema;
    }

    // =========================================================================
    // Private Static Helpers
    // =========================================================================

    /**
     * @param {Metadata} root
     * @param {string} ref
     * @param {string | null} source_path
     * @param {SchemaReferenceResolver | null} reference_resolver
     * @returns {{ schema: unknown, root: Metadata, source_path: string | null }}
     * @private
     */
    static _resolveRef(root, ref, source_path, reference_resolver) {
        const hashIndex = ref.indexOf("#");
        const filePart = hashIndex >= 0 ? ref.slice(0, hashIndex) : ref;
        const fragment = hashIndex >= 0 ? ref.slice(hashIndex + 1) : "";

        if (filePart.length > 0) {
            /** @type {Metadata} */
            let externalRoot;
            /** @type {string | null} */
            let externalSourcePath;
            const isAbsoluteUri = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(filePart);

            if (isAbsoluteUri) {
                const currentId = hasPropertyOfType(root, "$id", "string")
                    ? root["$id"]
                    : null;
                if (currentId === filePart) {
                    externalRoot = root;
                    externalSourcePath = source_path;
                } else {
                    const resolution = reference_resolver
                        ? reference_resolver(filePart, source_path)
                        : null;
                    if (!resolution || !isObject(resolution.definition)) {
                        throw new Error(
                            `External $ref URI is not locally resolvable: ${filePart}`
                        );
                    }
                    externalRoot = /** @type {Metadata} */ (
                        resolution.definition
                    );
                    externalSourcePath = resolution.source_path;
                }
            } else {
                if (!source_path) {
                    throw new Error(`External $ref has no source path: ${ref}`);
                }
                externalSourcePath = resolve(dirname(source_path), filePart);
                externalRoot = /** @type {Metadata} */ (
                    readJson(externalSourcePath)
                );
            }

            const externalSchema =
                fragment.length > 0
                    ? Schema._resolveInternalRef(externalRoot, `#${fragment}`)
                    : externalRoot;
            return {
                schema: externalSchema,
                root: externalRoot,
                source_path: externalSourcePath
            };
        }

        return {
            schema: Schema._resolveInternalRef(
                root,
                fragment.length === 0
                    ? "#"
                    : fragment.startsWith("#")
                    ? fragment
                    : `#${fragment}`
            ),
            root,
            source_path
        };
    }

    /**
     * @param {Metadata} root
     * @param {string} ref
     * @returns {unknown}
     * @private
     */
    static _resolveInternalRef(root, ref) {
        if (ref === "#" || ref === "") {
            return root;
        }
        if (!ref.startsWith("#/")) {
            throw new Error(`Invalid $ref path: ${ref}`);
        }
        const parts = ref.slice(2).split("/");
        /** @type {unknown} */
        let current = root;
        for (let i = 0, len = parts.length; i < len; i++) {
            const key = parts[i].replace(/~1/g, "/").replace(/~0/g, "~");
            if (!isObject(current) && !isArray(current)) {
                throw new Error(`Invalid $ref path: ${ref}`);
            }
            const container =
                /** @type {Record<string, unknown> | unknown[]} */ (current);
            if (!Object.prototype.hasOwnProperty.call(container, key)) {
                throw new Error(`Invalid $ref path: ${ref}`);
            }
            current = container[key];
        }
        return current;
    }

    /**
     * @param {unknown} value
     * @param {unknown} schema
     * @param {Metadata} root
     * @param {string} path
     * @param {SchemaError[]} errors
     * @param {string | null} source_path
     * @param {SchemaReferenceResolver | null} reference_resolver
     * @private
     */
    static _validateWithSchema(
        value,
        schema,
        root,
        path,
        errors,
        source_path,
        reference_resolver
    ) {
        if (schema === true) {
            return;
        }
        if (schema === false) {
            errors.push({ path, message: "Value is rejected by false schema" });
            return;
        }
        if (!isObject(schema)) {
            return;
        }

        if (hasPropertyOfType(schema, "$ref", "string")) {
            try {
                const resolved = Schema._resolveRef(
                    root,
                    schema["$ref"],
                    source_path,
                    reference_resolver
                );
                Schema._validateWithSchema(
                    value,
                    resolved.schema,
                    resolved.root,
                    path,
                    errors,
                    resolved.source_path,
                    reference_resolver
                );
            } catch (error) {
                errors.push({
                    path,
                    message:
                        error instanceof Error
                            ? error.message
                            : "Unable to resolve $ref"
                });
            }
        }

        if (isArray(schema["allOf"])) {
            const branches = /** @type {unknown[]} */ (schema["allOf"]);
            for (let i = 0, len = branches.length; i < len; i++) {
                Schema._validateWithSchema(
                    value,
                    branches[i],
                    root,
                    path,
                    errors,
                    source_path,
                    reference_resolver
                );
            }
        }

        if (isArray(schema["anyOf"])) {
            const branches = /** @type {unknown[]} */ (schema["anyOf"]);
            const branchResults = Schema._validateBranches(
                value,
                branches,
                root,
                path,
                source_path,
                reference_resolver
            );
            if (branchResults.matchCount === 0) {
                errors.push({
                    path,
                    message: `Value does not match anyOf (${branches.length} options)`
                });
                Schema._appendBestBranchErrors(branchResults.errors, errors);
            }
        }

        if (isArray(schema["oneOf"])) {
            const branches = /** @type {unknown[]} */ (schema["oneOf"]);
            const branchResults = Schema._validateBranches(
                value,
                branches,
                root,
                path,
                source_path,
                reference_resolver
            );
            if (branchResults.matchCount !== 1) {
                errors.push({
                    path,
                    message: `Value must match exactly one oneOf option; matched ${branchResults.matchCount} of ${branches.length}`
                });
                if (branchResults.matchCount === 0) {
                    Schema._appendBestBranchErrors(
                        branchResults.errors,
                        errors
                    );
                }
            }
        }

        if (hasProperty(schema, "not")) {
            /** @type {SchemaError[]} */
            const localErrors = [];
            Schema._validateWithSchema(
                value,
                schema["not"],
                root,
                path,
                localErrors,
                source_path,
                reference_resolver
            );
            if (localErrors.length === 0) {
                errors.push({
                    path,
                    message: "Value matches a disallowed schema"
                });
            }
        }

        if (hasProperty(schema, "if")) {
            /** @type {SchemaError[]} */
            const conditionErrors = [];
            Schema._validateWithSchema(
                value,
                schema["if"],
                root,
                path,
                conditionErrors,
                source_path,
                reference_resolver
            );
            const branch =
                conditionErrors.length === 0 ? schema["then"] : schema["else"];
            if (branch !== undefined) {
                Schema._validateWithSchema(
                    value,
                    branch,
                    root,
                    path,
                    errors,
                    source_path,
                    reference_resolver
                );
            }
        }

        if (hasProperty(schema, "const")) {
            if (!Schema._deepEqual(value, schema["const"])) {
                errors.push({
                    path,
                    message: `Expected const ${JSON.stringify(schema["const"])}`
                });
                return;
            }
        }

        if (isArray(schema["enum"])) {
            const allowed = /** @type {unknown[]} */ (schema["enum"]);
            let matched = false;
            for (let i = 0, len = allowed.length; i < len; i++) {
                if (Schema._deepEqual(value, allowed[i])) {
                    matched = true;
                    break;
                }
            }
            if (!matched) {
                errors.push({
                    path,
                    message: `Expected one of enum values (${allowed.length})`
                });
                return;
            }
        }

        if (hasProperty(schema, "type")) {
            const typeValue = schema["type"];
            const allowedTypes = isArray(typeValue)
                ? typeValue.filter((entry) => typeof entry === "string")
                : typeof typeValue === "string"
                ? [typeValue]
                : [];
            if (allowedTypes.length > 0) {
                let typeMatched = false;
                for (let i = 0, len = allowedTypes.length; i < len; i++) {
                    if (Schema._matchesType(value, allowedTypes[i])) {
                        typeMatched = true;
                        break;
                    }
                }
                if (!typeMatched) {
                    errors.push({
                        path,
                        message: `Expected type ${allowedTypes.join(" | ")}`
                    });
                    return;
                }
            }
        }

        if (isObject(value)) {
            Schema._validateObject(
                value,
                schema,
                root,
                path,
                errors,
                source_path,
                reference_resolver
            );
        } else if (isArray(value)) {
            Schema._validateArray(
                value,
                schema,
                root,
                path,
                errors,
                source_path,
                reference_resolver
            );
        } else if (typeof value === "string") {
            Schema._validateString(value, schema, path, errors);
        } else if (typeof value === "number") {
            Schema._validateNumericBounds(value, schema, path, errors);
        }
    }

    /**
     * @param {unknown} value
     * @param {unknown[]} branches
     * @param {Metadata} root
     * @param {string} path
     * @param {string | null} source_path
     * @param {SchemaReferenceResolver | null} reference_resolver
     * @returns {{ matchCount: number, errors: SchemaError[][] }}
     * @private
     */
    static _validateBranches(
        value,
        branches,
        root,
        path,
        source_path,
        reference_resolver
    ) {
        let matchCount = 0;
        /** @type {SchemaError[][]} */
        const branchErrors = [];
        for (let i = 0, len = branches.length; i < len; i++) {
            /** @type {SchemaError[]} */
            const localErrors = [];
            Schema._validateWithSchema(
                value,
                branches[i],
                root,
                path,
                localErrors,
                source_path,
                reference_resolver
            );
            if (localErrors.length === 0) {
                matchCount++;
            }
            branchErrors.push(localErrors);
        }
        return { matchCount, errors: branchErrors };
    }

    /**
     * @param {SchemaError[][]} branchErrors
     * @param {SchemaError[]} errors
     * @private
     */
    static _appendBestBranchErrors(branchErrors, errors) {
        if (branchErrors.length === 0) {
            return;
        }
        let best = branchErrors[0];
        for (let i = 1, len = branchErrors.length; i < len; i++) {
            if (branchErrors[i].length < best.length) {
                best = branchErrors[i];
            }
        }
        for (let i = 0, len = best.length; i < len; i++) {
            errors.push(best[i]);
        }
    }

    /**
     * @param {unknown} value
     * @param {string} typeName
     * @returns {boolean}
     * @private
     */
    static _matchesType(value, typeName) {
        if (typeName === "object") {
            return isObject(value);
        }
        if (typeName === "array") {
            return isArray(value);
        }
        if (typeName === "string") {
            return typeof value === "string";
        }
        if (typeName === "integer") {
            return (
                typeof value === "number" &&
                Number.isFinite(value) &&
                Number.isInteger(value)
            );
        }
        if (typeName === "number") {
            return typeof value === "number" && Number.isFinite(value);
        }
        if (typeName === "boolean") {
            return typeof value === "boolean";
        }
        if (typeName === "null") {
            return value === null;
        }
        return true;
    }

    /**
     * @param {Metadata} value
     * @param {Metadata} schema
     * @param {Metadata} root
     * @param {string} path
     * @param {SchemaError[]} errors
     * @param {string | null} source_path
     * @param {SchemaReferenceResolver | null} reference_resolver
     * @private
     */
    static _validateObject(
        value,
        schema,
        root,
        path,
        errors,
        source_path,
        reference_resolver
    ) {
        const keys = Object.keys(value);
        if (
            hasPropertyOfType(schema, "minProperties", "number") &&
            keys.length < schema["minProperties"]
        ) {
            errors.push({
                path,
                message: `Expected at least ${schema["minProperties"]} properties`
            });
        }
        if (
            hasPropertyOfType(schema, "maxProperties", "number") &&
            keys.length > schema["maxProperties"]
        ) {
            errors.push({
                path,
                message: `Expected at most ${schema["maxProperties"]} properties`
            });
        }

        if (isArray(schema["required"])) {
            const required = /** @type {unknown[]} */ (schema["required"]);
            for (let i = 0, len = required.length; i < len; i++) {
                const key = required[i];
                if (typeof key !== "string") {
                    continue;
                }
                if (!hasProperty(value, key)) {
                    errors.push({
                        path: path ? `${path}.${key}` : key,
                        message: "Missing required property"
                    });
                }
            }
        }

        if (hasProperty(schema, "propertyNames")) {
            for (let i = 0, len = keys.length; i < len; i++) {
                const keyPath = path
                    ? `${path}.{propertyName:${keys[i]}}`
                    : `{propertyName:${keys[i]}}`;
                Schema._validateWithSchema(
                    keys[i],
                    schema["propertyNames"],
                    root,
                    keyPath,
                    errors,
                    source_path,
                    reference_resolver
                );
            }
        }

        if (isObject(schema["dependentRequired"])) {
            const dependencies = /** @type {Metadata} */ (
                schema["dependentRequired"]
            );
            const dependencyKeys = Object.keys(dependencies);
            for (let i = 0, len = dependencyKeys.length; i < len; i++) {
                const key = dependencyKeys[i];
                if (!hasProperty(value, key) || !isArray(dependencies[key])) {
                    continue;
                }
                const required = /** @type {unknown[]} */ (dependencies[key]);
                for (let j = 0, jLen = required.length; j < jLen; j++) {
                    const requiredKey = required[j];
                    if (
                        typeof requiredKey === "string" &&
                        !hasProperty(value, requiredKey)
                    ) {
                        errors.push({
                            path: path ? `${path}.${requiredKey}` : requiredKey,
                            message: `Property is required when ${key} is present`
                        });
                    }
                }
            }
        }

        const properties = isObject(schema["properties"])
            ? /** @type {Metadata} */ (schema["properties"])
            : {};
        /** @type {{ expression: RegExp, schema: unknown }[]} */
        const patternProperties = [];
        if (isObject(schema["patternProperties"])) {
            const rawPatterns = /** @type {Metadata} */ (
                schema["patternProperties"]
            );
            const patternKeys = Object.keys(rawPatterns);
            for (let i = 0, len = patternKeys.length; i < len; i++) {
                try {
                    patternProperties.push({
                        expression: new RegExp(patternKeys[i]),
                        schema: rawPatterns[patternKeys[i]]
                    });
                } catch {
                    errors.push({
                        path,
                        message: `Invalid patternProperties expression: ${patternKeys[i]}`
                    });
                }
            }
        }

        const additionalProperties = hasProperty(schema, "additionalProperties")
            ? schema["additionalProperties"]
            : true;

        for (let i = 0, len = keys.length; i < len; i++) {
            const key = keys[i];
            const childPath = path ? `${path}.${key}` : key;
            let evaluated = false;
            if (hasProperty(properties, key)) {
                evaluated = true;
                Schema._validateWithSchema(
                    value[key],
                    properties[key],
                    root,
                    childPath,
                    errors,
                    source_path,
                    reference_resolver
                );
            }

            for (
                let j = 0, patternLen = patternProperties.length;
                j < patternLen;
                j++
            ) {
                if (!patternProperties[j].expression.test(key)) {
                    continue;
                }
                evaluated = true;
                Schema._validateWithSchema(
                    value[key],
                    patternProperties[j].schema,
                    root,
                    childPath,
                    errors,
                    source_path,
                    reference_resolver
                );
            }

            if (evaluated) {
                continue;
            }
            if (additionalProperties === false) {
                errors.push({
                    path: childPath,
                    message: "Unknown property (additionalProperties=false)"
                });
            } else if (additionalProperties !== true) {
                Schema._validateWithSchema(
                    value[key],
                    additionalProperties,
                    root,
                    childPath,
                    errors,
                    source_path,
                    reference_resolver
                );
            }
        }
    }

    /**
     * @param {unknown[]} value
     * @param {Metadata} schema
     * @param {Metadata} root
     * @param {string} path
     * @param {SchemaError[]} errors
     * @param {string | null} source_path
     * @param {SchemaReferenceResolver | null} reference_resolver
     * @private
     */
    static _validateArray(
        value,
        schema,
        root,
        path,
        errors,
        source_path,
        reference_resolver
    ) {
        if (
            hasPropertyOfType(schema, "minItems", "number") &&
            value.length < schema["minItems"]
        ) {
            errors.push({
                path,
                message: `Expected at least ${schema["minItems"]} items`
            });
        }
        if (
            hasPropertyOfType(schema, "maxItems", "number") &&
            value.length > schema["maxItems"]
        ) {
            errors.push({
                path,
                message: `Expected at most ${schema["maxItems"]} items`
            });
        }
        if (schema["uniqueItems"] === true) {
            for (let i = 0, len = value.length; i < len; i++) {
                for (let j = i + 1; j < len; j++) {
                    if (Schema._deepEqual(value[i], value[j])) {
                        errors.push({
                            path,
                            message: `Expected unique items; duplicate indexes ${i} and ${j}`
                        });
                        i = len;
                        break;
                    }
                }
            }
        }

        if (isArray(schema["prefixItems"])) {
            const prefixItems = /** @type {unknown[]} */ (
                schema["prefixItems"]
            );
            const count = Math.min(prefixItems.length, value.length);
            for (let i = 0; i < count; i++) {
                Schema._validateWithSchema(
                    value[i],
                    prefixItems[i],
                    root,
                    `${path}[${i}]`,
                    errors,
                    source_path,
                    reference_resolver
                );
            }
        }

        if (hasProperty(schema, "items")) {
            const startIndex = isArray(schema["prefixItems"])
                ? /** @type {unknown[]} */ (schema["prefixItems"]).length
                : 0;
            for (let i = startIndex, len = value.length; i < len; i++) {
                Schema._validateWithSchema(
                    value[i],
                    schema["items"],
                    root,
                    `${path}[${i}]`,
                    errors,
                    source_path,
                    reference_resolver
                );
            }
        }

        if (hasProperty(schema, "contains")) {
            let matchCount = 0;
            for (let i = 0, len = value.length; i < len; i++) {
                /** @type {SchemaError[]} */
                const localErrors = [];
                Schema._validateWithSchema(
                    value[i],
                    schema["contains"],
                    root,
                    `${path}[${i}]`,
                    localErrors,
                    source_path,
                    reference_resolver
                );
                if (localErrors.length === 0) {
                    matchCount++;
                }
            }
            const minimum = hasPropertyOfType(schema, "minContains", "number")
                ? schema["minContains"]
                : 1;
            const maximum = hasPropertyOfType(schema, "maxContains", "number")
                ? schema["maxContains"]
                : null;
            if (matchCount < minimum) {
                errors.push({
                    path,
                    message: `Expected contains to match at least ${minimum} items; matched ${matchCount}`
                });
            }
            if (maximum !== null && matchCount > maximum) {
                errors.push({
                    path,
                    message: `Expected contains to match at most ${maximum} items; matched ${matchCount}`
                });
            }
        }
    }

    /**
     * @param {string} value
     * @param {Metadata} schema
     * @param {string} path
     * @param {SchemaError[]} errors
     * @private
     */
    static _validateString(value, schema, path, errors) {
        if (
            hasPropertyOfType(schema, "minLength", "number") &&
            value.length < schema["minLength"]
        ) {
            errors.push({
                path,
                message: `Expected minLength ${schema["minLength"]}`
            });
        }
        if (
            hasPropertyOfType(schema, "maxLength", "number") &&
            value.length > schema["maxLength"]
        ) {
            errors.push({
                path,
                message: `Expected maxLength ${schema["maxLength"]}`
            });
        }
        if (hasPropertyOfType(schema, "pattern", "string")) {
            try {
                const expression = new RegExp(schema["pattern"]);
                if (!expression.test(value)) {
                    errors.push({
                        path,
                        message: `String does not match pattern ${schema["pattern"]}`
                    });
                }
            } catch {
                errors.push({
                    path,
                    message: `Invalid schema pattern ${schema["pattern"]}`
                });
            }
        }
        if (hasPropertyOfType(schema, "format", "string")) {
            const format = schema["format"];
            if (format === "date" && !isDate(value)) {
                errors.push({
                    path,
                    message: "String is not a date (YYYY-MM-DD)"
                });
            } else if (format === "date-time" && !isDateTime(value)) {
                errors.push({ path, message: "String is not a date-time" });
            } else if (format === "uri" && !isUri(value)) {
                errors.push({ path, message: "String is not a valid URI" });
            } else if (
                format === "uri-reference" &&
                !Schema._isUriReference(value)
            ) {
                errors.push({
                    path,
                    message: "String is not a valid URI reference"
                });
            }
        }
    }

    /**
     * @param {string} value
     * @returns {boolean}
     * @private
     */
    static _isUriReference(value) {
        if (
            !/^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]*$/.test(value) ||
            /%(?![0-9A-Fa-f]{2})/.test(value)
        ) {
            return false;
        }
        try {
            new URL(value, "https://record-schema.invalid/");
            return true;
        } catch {
            return false;
        }
    }

    /**
     * @param {number} value
     * @param {Metadata} schema
     * @param {string} path
     * @param {SchemaError[]} errors
     * @private
     */
    static _validateNumericBounds(value, schema, path, errors) {
        if (!Number.isFinite(value)) {
            errors.push({ path, message: "Expected finite number" });
            return;
        }
        if (
            hasPropertyOfType(schema, "minimum", "number") &&
            value < schema["minimum"]
        ) {
            errors.push({ path, message: `Expected >= ${schema["minimum"]}` });
        }
        if (
            hasPropertyOfType(schema, "maximum", "number") &&
            value > schema["maximum"]
        ) {
            errors.push({ path, message: `Expected <= ${schema["maximum"]}` });
        }
        if (
            hasPropertyOfType(schema, "exclusiveMinimum", "number") &&
            value <= schema["exclusiveMinimum"]
        ) {
            errors.push({
                path,
                message: `Expected > ${schema["exclusiveMinimum"]}`
            });
        }
        if (
            hasPropertyOfType(schema, "exclusiveMaximum", "number") &&
            value >= schema["exclusiveMaximum"]
        ) {
            errors.push({
                path,
                message: `Expected < ${schema["exclusiveMaximum"]}`
            });
        }
        if (
            hasPropertyOfType(schema, "multipleOf", "number") &&
            schema["multipleOf"] > 0
        ) {
            const quotient = value / schema["multipleOf"];
            if (
                Math.abs(quotient - Math.round(quotient)) >
                Number.EPSILON * 8
            ) {
                errors.push({
                    path,
                    message: `Expected multipleOf ${schema["multipleOf"]}`
                });
            }
        }
    }

    /**
     * @param {unknown} left
     * @param {unknown} right
     * @returns {boolean}
     * @private
     */
    static _deepEqual(left, right) {
        if (Object.is(left, right)) {
            return true;
        }
        if (isArray(left) && isArray(right)) {
            if (left.length !== right.length) {
                return false;
            }
            for (let i = 0, len = left.length; i < len; i++) {
                if (!Schema._deepEqual(left[i], right[i])) {
                    return false;
                }
            }
            return true;
        }
        if (isObject(left) && isObject(right)) {
            const leftKeys = Object.keys(left);
            const rightKeys = Object.keys(right);
            if (leftKeys.length !== rightKeys.length) {
                return false;
            }
            for (let i = 0, len = leftKeys.length; i < len; i++) {
                const key = leftKeys[i];
                if (
                    !hasProperty(right, key) ||
                    !Schema._deepEqual(left[key], right[key])
                ) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }
}
