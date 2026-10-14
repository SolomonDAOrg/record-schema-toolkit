/**
 * Parsing the raw object text the reader keeps for each dictionary entry.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    parseValue,
    parseArrayItems,
    parseDictionaryEntries,
    dictionaryEntry,
    asName,
    asText,
    asNumber,
    asReference
} from "../../lib/pdf/object-values.mjs";

test("indirect references parse to their object id and generation", () => {
    const value = parseValue("12 0 R");
    assert.deepEqual(value, { kind: "reference", id: 12, generation: 0 });
    assert.equal(asReference(value), 12);
    assert.equal(asReference(parseValue("/Name")), null);
});

test("names, booleans and null parse as themselves", () => {
    assert.equal(asName(parseValue("/Widget")), "Widget");
    assert.deepEqual(parseValue("true"), { kind: "boolean", value: true });
    assert.deepEqual(parseValue("false"), { kind: "boolean", value: false });
    assert.deepEqual(parseValue("null"), { kind: "null" });
});

test("numbers keep their sign and fraction", () => {
    assert.equal(asNumber(parseValue("8388608")), 8388608);
    assert.equal(asNumber(parseValue("-3.5")), -3.5);
    assert.equal(asNumber(parseValue(".25")), 0.25);
    assert.equal(asNumber(parseValue("+7")), 7);
});

test("literal and hex strings both yield text", () => {
    assert.equal(asText(parseValue("(Acme)")), "Acme");
    assert.equal(asText(parseValue("<41 42>")), "AB");
    assert.equal(
        asText(parseValue("<FEFF00660031005F00300031005B0030005D>")),
        "f1_01[0]"
    );
});

test("a dictionary keeps its entries in file order with raw values", () => {
    const value = parseValue("<< /FT /Tx /Ff 8388608 /T (name) >>");
    assert.equal(value.kind, "dictionary");
    assert.deepEqual(
        value.entries.map((entry) => entry.key),
        ["FT", "Ff", "T"]
    );
    assert.equal(dictionaryEntry(value, "Ff"), "8388608");
    assert.equal(dictionaryEntry(value, "Missing"), undefined);
});

test("nested dictionaries are kept whole as raw text", () => {
    const appearance = parseValue(
        "<</D<</1 12 0 R/Off 11 0 R>>/N<</1 13 0 R>>>>"
    );
    const normal = parseValue(dictionaryEntry(appearance, "N"));
    assert.deepEqual(
        /** @type {any} */ (normal).entries.map((entry) => entry.key),
        ["1"]
    );
});

test("dictionary keys resolve their hash escapes", () => {
    const value = parseValue("<< /On#20Two 1 0 R >>");
    assert.equal(dictionaryEntry(value, "On Two"), "1 0 R");
});

test("arrays split at value boundaries, including nested arrays", () => {
    const flat = parseArrayItems("[(Alpha) (Beta)]");
    assert.deepEqual(flat.map(asText), ["Alpha", "Beta"]);

    const nested = parseArrayItems("[[(a)(A)] [(b)(B)]]");
    assert.equal(nested.length, 2);
    assert.equal(nested[0].kind, "array");
    assert.deepEqual(nested[0].items.map(asText), ["a", "A"]);
});

test("an array of references keeps every one", () => {
    const items = parseArrayItems("[934 0 R 935 0 R 936 0 R]");
    assert.deepEqual(items.map(asReference), [934, 935, 936]);
});

test("delimiters inside strings do not split a value", () => {
    const items = parseArrayItems("[(a]b) (c>>d)]");
    assert.deepEqual(items.map(asText), ["a]b", "c>>d"]);
});

test("malformed or absent text parses to null rather than throwing", () => {
    assert.deepEqual(parseValue(undefined), { kind: "null" });
    assert.deepEqual(parseValue("   "), { kind: "null" });
    assert.deepEqual(parseValue("endobj"), { kind: "null" });
    assert.deepEqual(parseDictionaryEntries("[1 2]"), []);
    assert.deepEqual(parseArrayItems("<< /A 1 >>"), []);
});
