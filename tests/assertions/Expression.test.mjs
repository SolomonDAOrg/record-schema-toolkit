import test from "node:test";
import assert from "node:assert/strict";
import { evaluateExpression } from "../../lib/record-schema/assertions/Expression.mjs";

test("arithmetic consumes each operand exactly once", () => {
    assert.equal(evaluateExpression("10 - 3 - 2", {}), 5);
    assert.equal(evaluateExpression("2 + 3 * 4", {}), 14);
});

test("collection and path helpers remain deterministic", () => {
    const bindings = {
        rows: [{ value: 1 }, { value: 2 }],
        left: ["a", "b"],
        right: ["b", "a"]
    };
    assert.equal(evaluateExpression('sum(all_at(rows, "$[*].value"))', bindings), 3);
    assert.equal(evaluateExpression("same_set(left, right)", bindings), true);
});


test("list composition supports declarative contracts", () => {
    assert.deepEqual(
        evaluateExpression("concat_lists(required, optional, mode_required)", {
            required: ["a"],
            optional: ["b"],
            mode_required: ["c"]
        }),
        ["a", "b", "c"]
    );
    assert.deepEqual(
        evaluateExpression("compact(values)", {
            values: ["a", null, undefined, "b"]
        }),
        ["a", "b"]
    );
    assert.deepEqual(
        evaluateExpression("difference(all_values, ignored)", {
            all_values: ["Unknown", "Open", "Close"],
            ignored: ["Unknown"]
        }),
        ["Open", "Close"]
    );
    assert.deepEqual(
        evaluateExpression("matching(all_values, 'Count$')", {
            all_values: ["Open", "ObservationCount", "Close"]
        }),
        ["ObservationCount"]
    );
});

test("object collection lookup remains declarative", () => {
    const rows = [
        { name: "Alpha", value: 1 },
        { name: "Beta", value: 2 },
        { name: "Alpha", value: 3 }
    ];
    assert.deepEqual(
        evaluateExpression("find_by(rows, '$.name', 'Beta')", { rows }),
        rows[1]
    );
    assert.deepEqual(
        evaluateExpression("filter_by(rows, '$.name', 'Alpha')", { rows }),
        [rows[0], rows[2]]
    );
});

test("list key composition is deterministic", () => {
    assert.deepEqual(
        evaluateExpression("concat_each(values, 'FSM-00001|', '')", {
            values: ["Alpha", "Beta"]
        }),
        ["FSM-00001|Alpha", "FSM-00001|Beta"]
    );
});

test("canonical_json ignores named keys recursively and sorts object keys", () => {
    const actual = evaluateExpression(
        "canonical_json(value, 'description')",
        {
            value: {
                z: 3,
                description: "outer",
                a: { description: "inner", y: 2, x: 1 }
            }
        }
    );
    assert.equal(actual, '{"a":{"x":1,"y":2},"z":3}');
});

test("normalize_name provides lower-snake agreement form", () => {
    assert.equal(evaluateExpression("normalize_name(value)", { value: "BigSf" }), "big_sf");
    assert.equal(evaluateExpression("normalize_name(value)", { value: "Q64_64" }), "q64_64");
});

test("storage projection primitives remain corpus-independent", () => {
    const definitions = {
        "FSM-00001|Nested": {
            members: [
                { type: "u16" },
                { type: { kind: "bytes", length: 3 } }
            ]
        },
        "FSM-00001|Outer": {
            members: [
                { type: { reference: "Nested" } },
                { width: 8 }
            ]
        },
        "FSM-00001|Variable": {
            members: [{ type: { kind: "array", element: "u8" } }]
        }
    };
    const scalarWidths = { u8: 1, u16: 2 };
    const fixedWidths = { Q32_32: 8 };

    assert.equal(
        evaluateExpression(
            "binary_width(type, definitions, scalar_widths, fixed_widths, prefix)",
            {
                type: "Outer",
                definitions,
                scalar_widths: scalarWidths,
                fixed_widths: fixedWidths,
                prefix: "FSM-00001|"
            }
        ),
        13
    );
    assert.equal(
        evaluateExpression(
            "binary_width(type, definitions, scalar_widths, fixed_widths, prefix)",
            {
                type: "Variable",
                definitions,
                scalar_widths: scalarWidths,
                fixed_widths: fixedWidths,
                prefix: "FSM-00001|"
            }
        ),
        null
    );
    assert.equal(
        evaluateExpression("layout_span(fields)", {
            fields: [
                { offset: 0, width: 4 },
                { offset: 8, width: 2 }
            ]
        }),
        10
    );
    assert.equal(evaluateExpression("number_or_null(value)", { value: "12" }), 12);
    assert.equal(evaluateExpression("number_or_null(value)", { value: "BOUND" }), null);
    assert.equal(evaluateExpression("choose(ok, left, right)", { ok: true, left: 3, right: 4 }), 3);
});

test("framed cardinalities sum ceiling divisions per independent ring", () => {
    assert.equal(
        evaluateExpression("sum_ceil_div(sizes, interval)", {
            sizes: [61, 15, 2],
            interval: 30
        }),
        5
    );
    assert.throws(
        () =>
            evaluateExpression("sum_ceil_div(sizes, interval)", {
                sizes: [1],
                interval: 0
            }),
        /divisor must be positive/
    );
});

test("identifier and scalar projection helpers support reachability rules", () => {
    assert.deepEqual(
        evaluateExpression("identifier_forms(value)", { value: "Http2OverTls" }),
        [
            "Http2OverTls",
            "http2_over_tls",
            "HTTP2_OVER_TLS",
            "http2-over-tls",
            "http2overtls"
        ]
    );
    assert.deepEqual(
        evaluateExpression("scalar_values(value)", {
            value: {
                name: "Profile",
                nested: ["Exact", 7, true, { mode: "Rollup" }]
            }
        }),
        ["Profile", "Exact", "7", "Rollup"]
    );
    assert.equal(
        evaluateExpression("strip_wrapping_quotes(value)", { value: "'\"quoted\"'" }),
        "quoted"
    );
    assert.equal(evaluateExpression("has_alpha(value)", { value: "48" }), false);
    assert.equal(evaluateExpression("has_alpha(value)", { value: "U48" }), true);
});


test("sum_ceil_div aggregates independently framed ranges", () => {
    assert.equal(
        evaluateExpression("sum_ceil_div(sizes, 64)", {
            sizes: [1, 64, 65]
        }),
        4
    );
});


test("cryptographic and byte projection helpers remain deterministic", () => {
    assert.equal(
        evaluateExpression("slice(digest_hex(value), 0, 16)", {
            value: "event:SwapEvent"
        }),
        "40c6cde8260871e2"
    );
    assert.equal(evaluateExpression("byte_width(value)", { value: "0x0005" }), 2);
    assert.equal(evaluateExpression("byte_width(value)", { value: 256 }), 2);
    assert.equal(evaluateExpression("byte_width(value)", { value: "05" }), null);
    assert.equal(evaluateExpression("to_hex(value, 4)", { value: 5 }), "0005");
    assert.equal(evaluateExpression("to_hex(value)", { value: "0xABcd" }), "abcd");
    assert.deepEqual(evaluateExpression("list(a, b, c)", { a: 1, b: 2, c: 3 }), [1, 2, 3]);
    assert.deepEqual(
        evaluateExpression("slice(values, 1, 3)", { values: [0, 1, 2, 3] }),
        [1, 2]
    );
    assert.deepEqual(
        evaluateExpression("unique_values(values)", { values: ["a", "b", "a"] }),
        ["a", "b"]
    );
});

test("byte expressions preserve Uint8Array semantics", () => {
    const bytes = new Uint8Array([0x61, 0x62, 0x63]);
    assert.equal(evaluateExpression("len(value)", { value: bytes }), 3);
    assert.equal(evaluateExpression("byte_width(value)", { value: bytes }), 3);
    assert.equal(evaluateExpression("to_hex(value)", { value: bytes }), "616263");
    assert.equal(evaluateExpression("to_hex(slice(value, 1, 3))", { value: bytes }), "6263");
    assert.equal(
        evaluateExpression("digest_hex(value)", { value: bytes }),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
});
