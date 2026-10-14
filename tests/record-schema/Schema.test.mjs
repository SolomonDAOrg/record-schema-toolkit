// @ts-check

/**
 * Unit tests for the Schema class.
 *
 * Covers: construction, validate(), isValid(), resolveRef(),
 * Schema.load(), Schema.loadIfExists(), and all validation branches
 * (type, const, enum, allOf, anyOf, $ref, error paths).
 *
 * @module tests/classes/Schema_test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Schema } from "../../lib/record-schema/Schema.mjs";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Write a temp JSON file and return its absolute path.
 * @param {unknown} data
 * @returns {string}
 */
function writeTmpJson(data) {
    const dir = join(
        tmpdir(),
        "schema-test-" + Math.random().toString(36).slice(2)
    );
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "schema.json");
    writeFileSync(file, JSON.stringify(data), "utf8");
    return file;
}

// ============================================================================
// Construction
// ============================================================================

describe("Schema - construction", () => {
    it("stores definition and defaults source_path to null", () => {
        const def = { type: "string" };
        const s = new Schema(def);
        assert.deepEqual(s.definition, def);
        assert.equal(s.source_path, null);
    });

    it("stores provided source_path", () => {
        const s = new Schema({ type: "number" }, "/some/path.json");
        assert.equal(s.source_path, "/some/path.json");
    });
});

// ============================================================================
// Schema.load / Schema.loadIfExists
// ============================================================================

describe("Schema.load", () => {
    it("loads definition from JSON file", () => {
        const def = { type: "object", properties: { id: { type: "integer" } } };
        const path = writeTmpJson(def);
        const s = Schema.load(path);
        assert.deepEqual(s.definition, def);
        assert.equal(s.source_path, path);
        rmSync(path);
    });

    it("throws when file does not exist", () => {
        assert.throws(() => Schema.load("/nonexistent/path/schema.json"));
    });
});

describe("Schema.loadIfExists", () => {
    it("returns Schema when file exists", () => {
        const def = { type: "boolean" };
        const path = writeTmpJson(def);
        const s = Schema.loadIfExists(path);
        assert.ok(s instanceof Schema);
        assert.deepEqual(/** @type {Schema} */ (s).definition, def);
        rmSync(path);
    });

    it("returns null when file does not exist", () => {
        const result = Schema.loadIfExists("/nonexistent/path/schema.json");
        assert.equal(result, null);
    });
});

// ============================================================================
// isValid
// ============================================================================

describe("Schema - isValid", () => {
    it("returns true for valid value", () => {
        const s = new Schema({ type: "string" });
        assert.equal(s.isValid("hello"), true);
    });

    it("returns false for invalid value", () => {
        const s = new Schema({ type: "string" });
        assert.equal(s.isValid(42), false);
    });
});

// ============================================================================
// resolveRef
// ============================================================================

describe("Schema - resolveRef", () => {
    it("resolves a top-level definition ref", () => {
        const s = new Schema({
            definitions: { myType: { type: "string" } }
        });
        const resolved = s.resolveRef("#/definitions/myType");
        assert.deepEqual(resolved, { type: "string" });
    });

    it("resolves a deeply nested ref", () => {
        const s = new Schema({ a: { b: { c: { type: "integer" } } } });
        const resolved = s.resolveRef("#/a/b/c");
        assert.deepEqual(resolved, { type: "integer" });
    });

    it("rejects unresolved absolute URI refs without a resolver", () => {
        const s = new Schema({});
        assert.throws(
            () => s.resolveRef("https://example.com/schema"),
            /External \$ref URI is not locally resolvable/
        );
    });

    it("requires a source path for relative external refs", () => {
        const s = new Schema({});
        assert.throws(
            () => s.resolveRef("./shared.schema.json"),
            /External \$ref has no source path/
        );
    });

    it("resolves absolute URI refs through a caller-provided resolver", () => {
        function resolveSchemaReference(reference) {
            if (reference !== "https://example.test/shared.schema.json") {
                return null;
            }
            return {
                definition: {
                    $defs: {
                        identifier: { type: "integer", minimum: 1 }
                    }
                },
                source_path: "/schemas/shared.schema.json"
            };
        }

        const s = new Schema(
            {
                $ref: "https://example.test/shared.schema.json#/$defs/identifier"
            },
            "/schemas/main.schema.json",
            resolveSchemaReference
        );
        assert.deepEqual(s.validate(1), []);
        assert.ok(s.validate(0).length > 0);
    });

    it("rejects a missing internal JSON pointer target", () => {
        const s = new Schema({ $defs: {} });
        assert.throws(() => s.resolveRef("#/$defs/missing"), /Invalid \$ref path/);
    });

    it("throws when ref path traverses a non-object", () => {
        const s = new Schema({ a: "not-an-object" });
        assert.throws(() => s.resolveRef("#/a/b"));
    });
});

// ============================================================================
// validate - string type
// ============================================================================

describe("Schema.validate - string type", () => {
    it("accepts valid string", () => {
        const s = new Schema({ type: "string" });
        assert.deepEqual(s.validate("hello"), []);
    });

    it("rejects non-string", () => {
        const s = new Schema({ type: "string" });
        assert.ok(s.validate(123).length > 0);
        assert.ok(s.validate(null).length > 0);
        assert.ok(s.validate(true).length > 0);
    });

    it("enforces minLength", () => {
        const s = new Schema({ type: "string", minLength: 3 });
        assert.deepEqual(s.validate("abc"), []);
        const errors = s.validate("ab");
        assert.ok(errors.length > 0);
        assert.ok(errors[0].message.includes("minLength"));
    });

    it("enforces maxLength", () => {
        const s = new Schema({ type: "string", maxLength: 5 });
        assert.deepEqual(s.validate("abcde"), []);
        const errors = s.validate("abcdef");
        assert.ok(errors.length > 0);
        assert.ok(errors[0].message.includes("maxLength"));
    });

    it("enforces pattern", () => {
        const s = new Schema({ type: "string", pattern: "^[a-z]+$" });
        assert.deepEqual(s.validate("abc"), []);
        const errors = s.validate("ABC");
        assert.ok(errors.length > 0);
        assert.ok(errors[0].message.includes("pattern"));
    });

    it("reports invalid regex patterns as schema errors", () => {
        const s = new Schema({ type: "string", pattern: "[invalid(" });
        const errors = s.validate("test");
        assert.equal(errors.length, 1);
        assert.match(errors[0].message, /Invalid schema pattern/);
    });

    it("validates format: date", () => {
        const s = new Schema({ type: "string", format: "date" });
        assert.deepEqual(s.validate("2024-01-15"), []);
        const errors = s.validate("01-15-2024");
        assert.ok(errors.length > 0);
        assert.ok(errors[0].message.includes("date"));
    });

    it("validates format: date-time", () => {
        const s = new Schema({ type: "string", format: "date-time" });
        assert.deepEqual(s.validate("2024-01-15T10:30:00Z"), []);
        assert.deepEqual(s.validate("2024-01-15T10:30:00+05:30"), []);
        assert.ok(s.validate("2024-01-15").length > 0);
    });

    it("validates format: uri", () => {
        const s = new Schema({ type: "string", format: "uri" });
        assert.deepEqual(s.validate("https://example.com"), []);
        assert.deepEqual(s.validate("file:///path/to/file"), []);
        assert.ok(s.validate("not-a-uri").length > 0);
    });

    it("validates format: uri-reference", () => {
        const s = new Schema({ type: "string", format: "uri-reference" });
        assert.deepEqual(s.validate("../schemas/example.json#/$defs/value"), []);
        assert.deepEqual(s.validate("#local-fragment"), []);
        assert.deepEqual(s.validate(""), []);
        assert.ok(s.validate("contains a space").length > 0);
        assert.ok(s.validate("invalid%escape").length > 0);
    });
});

// ============================================================================
// validate - number / integer types
// ============================================================================

describe("Schema.validate - number types", () => {
    it("accepts number and float", () => {
        const s = new Schema({ type: "number" });
        assert.deepEqual(s.validate(42), []);
        assert.deepEqual(s.validate(3.14), []);
    });

    it("rejects string for number", () => {
        const s = new Schema({ type: "number" });
        assert.ok(s.validate("42").length > 0);
    });

    it("accepts integer", () => {
        const s = new Schema({ type: "integer" });
        assert.deepEqual(s.validate(42), []);
    });

    it("rejects float for integer", () => {
        const s = new Schema({ type: "integer" });
        const errors = s.validate(3.14);
        assert.ok(errors.length > 0);
        assert.ok(errors[0].message.includes("integer"));
    });

    it("enforces minimum for number", () => {
        const s = new Schema({ type: "number", minimum: 0 });
        assert.deepEqual(s.validate(0), []);
        const errors = s.validate(-1);
        assert.ok(errors.length > 0);
        assert.ok(errors[0].message.includes(">="));
    });

    it("enforces maximum for number", () => {
        const s = new Schema({ type: "number", maximum: 100 });
        assert.deepEqual(s.validate(100), []);
        const errors = s.validate(101);
        assert.ok(errors.length > 0);
        assert.ok(errors[0].message.includes("<="));
    });

    it("enforces minimum for integer", () => {
        const s = new Schema({ type: "integer", minimum: 1 });
        assert.deepEqual(s.validate(1), []);
        assert.ok(s.validate(0).length > 0);
    });

    it("enforces maximum for integer", () => {
        const s = new Schema({ type: "integer", maximum: 10 });
        assert.deepEqual(s.validate(10), []);
        assert.ok(s.validate(11).length > 0);
    });
});

// ============================================================================
// validate - boolean / null types
// ============================================================================

describe("Schema.validate - boolean and null types", () => {
    it("accepts true and false", () => {
        const s = new Schema({ type: "boolean" });
        assert.deepEqual(s.validate(true), []);
        assert.deepEqual(s.validate(false), []);
    });

    it("rejects string and number for boolean", () => {
        const s = new Schema({ type: "boolean" });
        assert.ok(s.validate("true").length > 0);
        assert.ok(s.validate(1).length > 0);
    });

    it("accepts null for null type", () => {
        const s = new Schema({ type: "null" });
        assert.deepEqual(s.validate(null), []);
    });

    it("rejects non-null for null type", () => {
        const s = new Schema({ type: "null" });
        assert.ok(s.validate(undefined).length > 0);
        assert.ok(s.validate("").length > 0);
        assert.ok(s.validate(0).length > 0);
    });
});

// ============================================================================
// validate - array type
// ============================================================================

describe("Schema.validate - array type", () => {
    it("accepts empty and populated arrays", () => {
        const s = new Schema({ type: "array" });
        assert.deepEqual(s.validate([]), []);
        assert.deepEqual(s.validate([1, 2, 3]), []);
    });

    it("rejects object and string for array", () => {
        const s = new Schema({ type: "array" });
        assert.ok(s.validate({}).length > 0);
        assert.ok(s.validate("array").length > 0);
    });

    it("enforces minItems", () => {
        const s = new Schema({ type: "array", minItems: 2 });
        assert.deepEqual(s.validate([1, 2]), []);
        const errors = s.validate([1]);
        assert.ok(errors.length > 0);
        assert.ok(errors[0].message.includes("at least"));
    });

    it("enforces maxItems", () => {
        const s = new Schema({ type: "array", maxItems: 3 });
        assert.deepEqual(s.validate([1, 2, 3]), []);
        const errors = s.validate([1, 2, 3, 4]);
        assert.ok(errors.length > 0);
        assert.ok(errors[0].message.includes("at most"));
    });

    it("enforces uniqueItems for primitives", () => {
        const s = new Schema({ type: "array", uniqueItems: true });
        assert.deepEqual(s.validate([1, 2, 3]), []);
        const errors = s.validate([1, 2, 1]);
        assert.ok(errors.length > 0);
        assert.ok(errors[0].message.includes("unique"));
    });

    it("enforces uniqueItems for objects using JSON comparison", () => {
        const s = new Schema({ type: "array", uniqueItems: true });
        assert.deepEqual(s.validate([{ a: 1 }, { a: 2 }]), []);
        assert.ok(s.validate([{ a: 1 }, { a: 1 }]).length > 0);
    });

    it("validates items schema", () => {
        const s = new Schema({ type: "array", items: { type: "string" } });
        assert.deepEqual(s.validate(["a", "b", "c"]), []);
        const errors = s.validate(["a", 1, "c"]);
        assert.ok(errors.length > 0);
        assert.ok(errors[0].path.includes("[1]"));
    });

    it("validates nested array items", () => {
        const s = new Schema({
            type: "array",
            items: { type: "array", items: { type: "number" } }
        });
        assert.deepEqual(
            s.validate([
                [1, 2],
                [3, 4]
            ]),
            []
        );
        assert.ok(s.validate([[1, "x"]]).length > 0);
    });
});

// ============================================================================
// validate - object type
// ============================================================================

describe("Schema.validate - object type", () => {
    it("accepts plain objects", () => {
        const s = new Schema({ type: "object" });
        assert.deepEqual(s.validate({}), []);
        assert.deepEqual(s.validate({ a: 1 }), []);
    });

    it("rejects array and null for object", () => {
        const s = new Schema({ type: "object" });
        assert.ok(s.validate([]).length > 0);
        assert.ok(s.validate(null).length > 0);
    });

    it("enforces required properties", () => {
        const s = new Schema({ type: "object", required: ["name", "age"] });
        assert.deepEqual(s.validate({ name: "Jo", age: 30 }), []);
        const errors = s.validate({ name: "Jo" });
        assert.ok(errors.length > 0);
        assert.ok(errors.some((e) => e.path === "age"));
    });

    it("validates properties schema", () => {
        const s = new Schema({
            type: "object",
            properties: {
                name: { type: "string" },
                age: { type: "integer" }
            }
        });
        assert.deepEqual(s.validate({ name: "Jo", age: 30 }), []);
        const errors = s.validate({ name: "Jo", age: "thirty" });
        assert.ok(errors.length > 0);
        assert.equal(errors[0].path, "age");
    });

    it("enforces additionalProperties: false", () => {
        const s = new Schema({
            type: "object",
            properties: { name: { type: "string" } },
            additionalProperties: false
        });
        assert.deepEqual(s.validate({ name: "Jo" }), []);
        const errors = s.validate({ name: "Jo", extra: "field" });
        assert.ok(errors.length > 0);
        assert.ok(errors[0].message.includes("additionalProperties"));
    });

    it("validates additionalProperties with a schema", () => {
        const s = new Schema({
            type: "object",
            properties: { name: { type: "string" } },
            additionalProperties: { type: "number" }
        });
        assert.deepEqual(s.validate({ name: "Jo", score: 100 }), []);
        assert.ok(s.validate({ name: "Jo", score: "high" }).length > 0);
    });

    it("validates patternProperties", () => {
        const s = new Schema({
            type: "object",
            patternProperties: { "^x-": { type: "string" } }
        });
        assert.deepEqual(s.validate({ "x-custom": "value" }), []);
        assert.ok(s.validate({ "x-custom": 123 }).length > 0);
    });

    it("reports invalid patternProperties regex as schema errors", () => {
        const s = new Schema({
            type: "object",
            patternProperties: { "[invalid(": { type: "string" } }
        });
        const errors = s.validate({ test: "value" });
        assert.equal(errors.length, 1);
        assert.match(
            errors[0].message,
            /Invalid patternProperties expression/
        );
    });

    it("allows additional non-pattern keys when patternProperties defined and no additionalProperties restriction", () => {
        const s = new Schema({
            type: "object",
            patternProperties: { "^x-": { type: "string" } }
        });
        assert.deepEqual(s.validate({ other: 42 }), []);
    });
});

// ============================================================================
// validate - const and enum
// ============================================================================

describe("Schema.validate - const and enum", () => {
    it("accepts matching const string", () => {
        const s = new Schema({ const: "fixed" });
        assert.deepEqual(s.validate("fixed"), []);
    });

    it("rejects non-matching const", () => {
        const s = new Schema({ const: "fixed" });
        const errors = s.validate("other");
        assert.ok(errors.length > 0);
        assert.ok(errors[0].message.includes("const"));
    });

    it("validates const for number, boolean, null", () => {
        assert.deepEqual(new Schema({ const: 42 }).validate(42), []);
        assert.deepEqual(new Schema({ const: true }).validate(true), []);
        assert.deepEqual(new Schema({ const: null }).validate(null), []);
        assert.ok(new Schema({ const: 42 }).validate("42").length > 0);
    });

    it("accepts value in enum", () => {
        const s = new Schema({ enum: ["red", "green", "blue"] });
        assert.deepEqual(s.validate("red"), []);
        assert.deepEqual(s.validate("blue"), []);
    });

    it("rejects value not in enum", () => {
        const s = new Schema({ enum: ["red", "green", "blue"] });
        const errors = s.validate("yellow");
        assert.ok(errors.length > 0);
        assert.ok(errors[0].message.includes("enum"));
    });

    it("validates mixed-type enum", () => {
        const s = new Schema({ enum: [1, "one", true, null] });
        assert.deepEqual(s.validate(1), []);
        assert.deepEqual(s.validate("one"), []);
        assert.deepEqual(s.validate(true), []);
        assert.deepEqual(s.validate(null), []);
        assert.ok(s.validate(2).length > 0);
    });
});

// ============================================================================
// validate - allOf and anyOf
// ============================================================================

describe("Schema.validate - allOf and anyOf", () => {
    it("allOf: all sub-schemas must pass", () => {
        const s = new Schema({
            allOf: [
                { type: "object", required: ["name"] },
                { type: "object", required: ["age"] }
            ]
        });
        assert.deepEqual(s.validate({ name: "Jo", age: 30 }), []);
        assert.ok(s.validate({ name: "Jo" }).length > 0);
    });

    it("anyOf: at least one sub-schema must pass", () => {
        const s = new Schema({
            anyOf: [{ type: "string" }, { type: "number" }]
        });
        assert.deepEqual(s.validate("hello"), []);
        assert.deepEqual(s.validate(42), []);
        const errors = s.validate(true);
        assert.ok(errors.length > 0);
        assert.ok(errors[0].message.includes("anyOf"));
    });

    it("anyOf: includes best-match sub-errors", () => {
        const s = new Schema({
            anyOf: [
                { type: "string", minLength: 5 },
                { type: "number", minimum: 10 }
            ]
        });
        const errors = s.validate(true);
        assert.ok(errors.length > 0);
    });
});

// ============================================================================
// validate - $ref
// ============================================================================

describe("Schema.validate - $ref", () => {
    it("resolves internal $ref for object property", () => {
        const s = new Schema({
            type: "object",
            properties: { name: { $ref: "#/definitions/nameType" } },
            definitions: { nameType: { type: "string", minLength: 1 } }
        });
        assert.deepEqual(s.validate({ name: "Jo" }), []);
        assert.ok(s.validate({ name: "" }).length > 0);
    });

    it("resolves $ref inside array items", () => {
        const s = new Schema({
            type: "array",
            items: { $ref: "#/definitions/item" },
            definitions: {
                item: {
                    type: "object",
                    properties: { id: { type: "integer" } }
                }
            }
        });
        assert.deepEqual(s.validate([{ id: 1 }, { id: 2 }]), []);
        assert.ok(s.validate([{ id: "one" }]).length > 0);
    });

    it("resolves deep $ref path", () => {
        const s = new Schema({
            $ref: "#/a/b/c",
            a: { b: { c: { type: "string" } } }
        });
        assert.deepEqual(s.validate("test"), []);
        assert.ok(s.validate(123).length > 0);
    });

    it("reports unresolved external $ref as a validation error", () => {
        const s = new Schema({
            type: "object",
            properties: { x: { $ref: "https://example.com/schema" } }
        });
        const errors = s.validate({ x: "y" });
        assert.ok(
            errors.some((error) =>
                error.message.includes(
                    "External $ref URI is not locally resolvable"
                )
            )
        );
    });
});

// ============================================================================
// validate - error paths
// ============================================================================

describe("Schema.validate - error paths", () => {
    it("reports root path as empty string", () => {
        const errors = new Schema({ type: "string" }).validate(123);
        assert.equal(errors[0].path, "");
    });

    it("reports nested object property path", () => {
        const s = new Schema({
            type: "object",
            properties: {
                user: {
                    type: "object",
                    properties: { name: { type: "string" } }
                }
            }
        });
        const errors = s.validate({ user: { name: 123 } });
        assert.equal(errors[0].path, "user.name");
    });

    it("reports array index path", () => {
        const s = new Schema({ type: "array", items: { type: "string" } });
        const errors = s.validate(["a", "b", 3, "d"]);
        assert.equal(errors[0].path, "[2]");
    });

    it("reports combined object-and-array path", () => {
        const s = new Schema({
            type: "object",
            properties: {
                items: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: { value: { type: "number" } }
                    }
                }
            }
        });
        const errors = s.validate({ items: [{ value: 1 }, { value: "x" }] });
        assert.equal(errors[0].path, "items[1].value");
    });

    it("reports top-level required missing with property name as path", () => {
        const s = new Schema({ type: "object", required: ["id"] });
        const errors = s.validate({});
        assert.equal(errors[0].path, "id");
    });
});

// ============================================================================
// validate - edge cases
// ============================================================================

describe("Schema.validate - edge cases", () => {
    it("empty schema accepts anything", () => {
        const s = new Schema({});
        assert.deepEqual(s.validate("string"), []);
        assert.deepEqual(s.validate(123), []);
        assert.deepEqual(s.validate(null), []);
        assert.deepEqual(s.validate({ any: "thing" }), []);
    });

    it("non-object schema (e.g. string) returns no errors", () => {
        // @ts-ignore - intentional invalid input
        const s = new Schema("invalid");
        assert.deepEqual(s.validate("value"), []);
    });

    it("accumulates multiple required-property errors", () => {
        const s = new Schema({ type: "object", required: ["a", "b", "c"] });
        const errors = s.validate({});
        assert.equal(errors.length, 3);
    });

    it("handles deeply nested arrays with correct path", () => {
        const s = new Schema({
            type: "array",
            items: {
                type: "array",
                items: {
                    type: "array",
                    items: { type: "number" }
                }
            }
        });
        assert.deepEqual(
            s.validate([
                [
                    [1, 2],
                    [3, 4]
                ]
            ]),
            []
        );
        const errors = s.validate([[[1, "x"]]]);
        assert.ok(errors[0].path.includes("[0][0][1]"));
    });

    it("validates complex realistic schema end-to-end", () => {
        const s = new Schema({
            type: "object",
            required: ["id", "data"],
            properties: {
                id: { type: "string", pattern: "^[A-Z]{2}-\\d{5}$" },
                data: {
                    type: "object",
                    properties: {
                        items: {
                            type: "array",
                            minItems: 1,
                            items: {
                                type: "object",
                                required: ["name"],
                                properties: {
                                    name: { type: "string" },
                                    value: { type: "number", minimum: 0 }
                                }
                            }
                        }
                    }
                }
            }
        });

        assert.deepEqual(
            s.validate({
                id: "DP-00001",
                data: { items: [{ name: "item1", value: 10 }] }
            }),
            []
        );

        const errors = s.validate({
            id: "invalid",
            data: { items: [{ name: "item1", value: -5 }] }
        });
        assert.ok(errors.length >= 2);
    });
});
