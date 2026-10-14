import assert from "node:assert/strict";
import test from "node:test";

import {
    parseYaml,
    Schema
} from "../lib/index.mjs";

test("JSON Schema supports deep const and type unions", () => {
    const schema = new Schema({
        type: "object",
        required: ["extensions", "value"],
        properties: {
            extensions: {
                const: ["yaml", "json"]
            },
            value: {
                type: ["string", "null"]
            }
        },
        additionalProperties: false
    });

    assert.deepEqual(
        schema.validate({ extensions: ["yaml", "json"], value: null }),
        []
    );
    assert.equal(
        schema.validate({ extensions: ["json", "yaml"], value: 1 }).length,
        2
    );
});

test("JSON Schema supports oneOf, not, and if/then", () => {
    const schema = new Schema({
        oneOf: [
            {
                type: "object",
                required: ["kind", "path"],
                properties: {
                    kind: { const: "file" },
                    path: { type: "string" }
                }
            },
            {
                type: "object",
                required: ["kind", "value"],
                properties: {
                    kind: { const: "literal" },
                    value: { type: "integer" }
                }
            }
        ],
        not: {
            required: ["forbidden"]
        },
        if: {
            properties: { kind: { const: "file" } },
            required: ["kind"]
        },
        then: {
            properties: { path: { pattern: "^records/" } }
        }
    });

    assert.deepEqual(schema.validate({ kind: "file", path: "records/A" }), []);
    assert.ok(schema.validate({ kind: "file", path: "other/A" }).length > 0);
    assert.ok(
        schema.validate({ kind: "literal", value: 1, forbidden: true }).length >
            0
    );
});

test("JSON Schema supports propertyNames, minProperties, and contains", () => {
    const schema = new Schema({
        type: "object",
        minProperties: 1,
        propertyNames: { pattern: "^[A-Z]+$" },
        additionalProperties: {
            type: "array",
            contains: { const: "required" }
        }
    });

    assert.deepEqual(schema.validate({ ABC: ["optional", "required"] }), []);
    assert.ok(schema.validate({ abc: ["optional"] }).length >= 2);
});

test("YAML rejects duplicate block and flow mapping keys", () => {
    assert.throws(
        () => parseYaml("name: first\nname: second\n"),
        /Duplicate mapping key: name/
    );
    assert.throws(
        () => parseYaml("{name: first, name: second}"),
        /Duplicate mapping key: name/
    );
    assert.deepEqual(
        parseYaml("name: first\nname: second\n", {
            allowDuplicateKeys: true
        }),
        { name: "second" }
    );
});

test("YAML merge keys do not make explicit overrides look duplicated", () => {
    assert.deepEqual(
        parseYaml(
            [
                "defaults: &defaults",
                "  enabled: false",
                "value:",
                "  <<: *defaults",
                "  enabled: true",
                ""
            ].join("\n")
        ),
        {
            defaults: { enabled: false },
            value: { enabled: true }
        }
    );
});

test("YAML duplicate detection is independent of object prototype keys", () => {
    assert.throws(
        () => parseYaml("__proto__: first\n__proto__: second\n"),
        /Duplicate mapping key: __proto__/
    );
});
