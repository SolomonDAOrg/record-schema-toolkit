import test from "node:test";
import assert from "node:assert/strict";
import { parseDelimitedRecords } from "../../lib/parsing/delimited.mjs";

test("CSV and TSV preserve quoted delimiters, quotes, newlines and empty fields", () => {
    assert.deepEqual(parseDelimitedRecords('\uFEFFA,B,C\r\n"one,two","a""b","line\r\nbreak"\r\nx,,', ','), [
        ["A", "B", "C"], ["one,two", 'a"b', "line\nbreak"], ["x", "", ""]
    ]);
    assert.deepEqual(parseDelimitedRecords('A\tB\n"one\ttwo"\tvalue\n', '\t'), [["A", "B"], ["one\ttwo", "value"]]);
    assert.deepEqual(parseDelimitedRecords('A,B\n\n', ','), [["A", "B"], [""]]);
    assert.deepEqual(parseDelimitedRecords('', ','), []);
});

test("malformed quoted records fail explicitly", () => {
    for (const source of ['A\n"unclosed', 'A\n"closed"extra', 'A\nplain"quote']) {
        assert.throws(() => parseDelimitedRecords(source, ','), /quote|quoted/);
    }
});
