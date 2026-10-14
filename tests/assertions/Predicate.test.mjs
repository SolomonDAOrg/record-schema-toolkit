import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePredicate, looseEqual } from "../../lib/record-schema/assertions/Predicate.mjs";

test("predicate operands can resolve selector bindings", () => {
    assert.equal(
        evaluatePredicate(
            { "#record": { eq: "#captured_record" } },
            {},
            { "#record": "FSM-00001", "#captured_record": "FSM-00001" }
        ),
        true
    );
});

test("expression predicates inherit selector bindings", () => {
    assert.equal(
        evaluatePredicate(
            { expr: { assert: "record == captured && count == 2" } },
            {},
            {
                "#record": "FSM-00001",
                "#captured": "FSM-00001",
                "#count": 2
            }
        ),
        true
    );
});


test("loose equality preserves integer precision beyond Number safe range", () => {
    assert.equal(looseEqual("0x40c6cde8260871e2", "0x40c6cde8260871e3"), false);
    assert.equal(looseEqual("0x10", 16), true);
    assert.equal(looseEqual("9007199254740993", "9007199254740992"), false);
});
