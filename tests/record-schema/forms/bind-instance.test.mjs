// @ts-check

/**
 * Binding a resolved document instance to a form's PDF fields: each binding
 * kind, and what happens to a field the instance did not resolve.
 *
 * @module tests/record-schema/forms/bind-instance_test
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { bindInstanceToForm } from "../../../lib/record-schema/forms/bind-instance.mjs";

import { W9_FIELDS, formDefinition, instance } from "./fixture.mjs";

test("a text binding writes the instance's display form", () => {
    const bound = bindInstanceToForm(formDefinition(), instance());
    assert.equal(bound.values[W9_FIELDS.legalName], "Solomon Labs Pty Ltd");
    assert.equal(bound.values[W9_FIELDS.address], "Level 3, 12 Example Street");
    assert.deepEqual(bound.unresolved, []);
    assert.deepEqual(bound.skipped, []);
});

test("a text binding may take the raw value instead", () => {
    const form = formDefinition();
    form.bindings[0].source = "value";
    const bound = bindInstanceToForm(form, instance());
    assert.equal(bound.values[W9_FIELDS.legalName], "Solomon Labs Pty Ltd");
});

test("a boolean bound as text writes its label, not its raw value", () => {
    const form = formDefinition();
    form.bindings = [
        {
            bind: "text",
            field: "HasForeignPartners",
            target: W9_FIELDS.legalName
        }
    ];
    const bound = bindInstanceToForm(form, instance());
    assert.equal(bound.values[W9_FIELDS.legalName], "No");
});

test("a boolean has no raw text to bind", () => {
    const form = formDefinition();
    form.bindings = [
        {
            bind: "text",
            field: "HasForeignPartners",
            target: W9_FIELDS.legalName,
            source: "value"
        }
    ];
    assert.throws(
        () => bindInstanceToForm(form, instance()),
        /has no raw text value to write/
    );
});

test("a button group selects one option and clears the others", () => {
    const bound = bindInstanceToForm(formDefinition(), instance());
    assert.equal(bound.values[W9_FIELDS.cCorporation], "2");
    assert.equal(bound.values[W9_FIELDS.individual], false);
    assert.equal(bound.values[W9_FIELDS.partnership], false);
});

test("a button group refuses a value none of its options binds", () => {
    const form = formDefinition();
    form.bindings[2].options = form.bindings[2].options.filter(
        (option) => option.value !== "c-corporation"
    );
    assert.throws(
        () => bindInstanceToForm(form, instance()),
        /holds "c-corporation", which no option of this binding binds/
    );
});

test("a check binding selects on the value named by when", () => {
    const yes = bindInstanceToForm(
        formDefinition(),
        instance({ HasForeignPartners: true })
    );
    assert.equal(yes.values[W9_FIELDS.foreignPartners], "1");

    const no = bindInstanceToForm(formDefinition(), instance());
    assert.equal(no.values[W9_FIELDS.foreignPartners], false);
});

test("a check binding can be driven by the negative of its field", () => {
    const form = formDefinition();
    form.bindings[3].when = false;
    const bound = bindInstanceToForm(form, instance());
    assert.equal(bound.values[W9_FIELDS.foreignPartners], "1");
});

test("a check binding without an on state defers to the document", () => {
    const form = formDefinition();
    delete form.bindings[3].on_state;
    const bound = bindInstanceToForm(
        form,
        instance({ HasForeignPartners: true })
    );
    assert.equal(bound.values[W9_FIELDS.foreignPartners], true);
});

test("segments split a value across its targets", () => {
    const bound = bindInstanceToForm(formDefinition(), instance());
    assert.equal(bound.values[W9_FIELDS.einHigh], "98");
    assert.equal(bound.values[W9_FIELDS.einLow], "7654321");
});

test("segments retain only the characters the binding asks for", () => {
    const form = formDefinition();
    const withoutRetain = formDefinition();
    delete withoutRetain.bindings[7].retain;

    assert.equal(
        bindInstanceToForm(form, instance()).values[W9_FIELDS.einHigh],
        "98",
        "punctuation dropped"
    );
    assert.throws(
        () => bindInstanceToForm(withoutRetain, instance()),
        /is 10 characters after retaining all, but its segments account for 9/
    );
});

test("segments refuse a value their lengths do not account for", () => {
    assert.throws(
        () =>
            bindInstanceToForm(
                formDefinition(),
                instance({ EmployerIdentificationNumber: "98-765432" })
            ),
        /is 8 characters after retaining digits, but its segments account for 9/
    );
});

test("a choice binding writes the export value, not the displayed one", () => {
    const form = formDefinition();
    form.bindings = [
        {
            bind: "choice",
            field: "TaxClassification",
            target: W9_FIELDS.legalName,
            options: [
                { value: "individual", export: "IND" },
                { value: "c-corporation", export: "CCORP" },
                { value: "partnership", export: "PART" }
            ]
        }
    ];
    const bound = bindInstanceToForm(form, instance());
    assert.equal(bound.values[W9_FIELDS.legalName], "CCORP");
});

test("skip leaves an unresolved field's targets untouched", () => {
    const bound = bindInstanceToForm(
        formDefinition(),
        instance({ BusinessName: undefined, RequesterNameAddress: undefined })
    );
    assert.deepEqual(bound.unresolved, [
        "BusinessName",
        "RequesterNameAddress"
    ]);
    assert.deepEqual(bound.skipped, [
        W9_FIELDS.businessName,
        W9_FIELDS.requester
    ]);
    assert.equal(Object.hasOwn(bound.values, W9_FIELDS.businessName), false);
});

test("blank clears an unresolved field's targets", () => {
    const bound = bindInstanceToForm(
        formDefinition({ unresolved: "blank" }),
        instance({ BusinessName: undefined })
    );
    assert.equal(bound.values[W9_FIELDS.businessName], "");
    assert.deepEqual(bound.skipped, []);
});

test("blank clears an unresolved button group rather than emptying it", () => {
    const bound = bindInstanceToForm(
        formDefinition({ unresolved: "blank" }),
        instance({ TaxClassification: undefined }, "draft")
    );
    assert.equal(bound.values[W9_FIELDS.individual], false);
    assert.equal(bound.values[W9_FIELDS.cCorporation], false);
    assert.equal(bound.values[W9_FIELDS.partnership], false);
});

test("placeholder writes the template's draft placeholder", () => {
    const bound = bindInstanceToForm(
        formDefinition({ unresolved: "placeholder" }),
        instance({ BusinessName: undefined }, "draft")
    );
    assert.equal(bound.values[W9_FIELDS.businessName], "[Business name]");
});

test("placeholder clears a target that cannot show one", () => {
    const bound = bindInstanceToForm(
        formDefinition({ unresolved: "placeholder" }),
        instance(
            {
                TaxClassification: undefined,
                EmployerIdentificationNumber: undefined
            },
            "draft"
        )
    );
    assert.equal(bound.values[W9_FIELDS.cCorporation], false);
    assert.equal(bound.values[W9_FIELDS.einHigh], "");
    assert.equal(bound.values[W9_FIELDS.einLow], "");
});

test("error refuses to bind an instance with anything unresolved", () => {
    assert.throws(
        () =>
            bindInstanceToForm(
                formDefinition({ unresolved: "error" }),
                instance({ BusinessName: undefined })
            ),
        /leaves BusinessName unresolved, and this form refuses to prefill/
    );
});

test("a fully resolved instance is unaffected by the unresolved policy", () => {
    for (const policy of ["skip", "blank", "placeholder", "error"]) {
        const bound = bindInstanceToForm(
            formDefinition({ unresolved: policy }),
            instance()
        );
        assert.equal(
            bound.values[W9_FIELDS.legalName],
            "Solomon Labs Pty Ltd",
            policy
        );
        assert.deepEqual(bound.unresolved, [], policy);
    }
});
