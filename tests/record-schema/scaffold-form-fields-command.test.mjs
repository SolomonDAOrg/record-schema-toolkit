// @ts-check

/**
 * The scaffold-form-fields command: what it prints, and the property that makes
 * it worth printing — the scaffold satisfies the pack it came from, and survives
 * a round trip through the parser that will read it back out of a META file.
 *
 * @module tests/record-schema/scaffold-form-fields-command_test
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseYaml } from "../../lib/parsing/yaml.mjs";
import { FormPack } from "../../lib/record-schema/FormPack.mjs";
import { verifyAgainstContract } from "../../lib/record-schema/forms/verify.mjs";

import { W9_PATH, W9_SHA256 } from "./forms/fixture.mjs";

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), "../../bin");
const COMMAND = join(BIN, "scaffold-form-fields.mjs");
const PAGE1 = "topmostSubform[0].Page1[0].";

/**
 * A repository configuring one pack that exercises every binding kind.
 * @returns {string} repository root
 */
function buildRepository() {
    const root = mkdtempSync(join(tmpdir(), "scaffold-command-"));
    /** @param {string} rel @param {string} text */
    const write = (rel, text) => {
        const path = resolve(root, rel);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, text, "utf8");
    };

    mkdirSync(resolve(root, "forms/pdf"), { recursive: true });
    copyFileSync(W9_PATH, resolve(root, "forms/pdf/fw9.pdf"));
    write(
        "forms/packs/w9.json",
        JSON.stringify({
            schema: "record-schema-form-pack",
            schema_version: 1,
            pack_id: "local-w9",
            forms: {
                "irs-w9": {
                    title: "IRS Form W-9 (Rev. March 2024)",
                    document: { path: "forms/pdf/fw9.pdf", sha256: W9_SHA256 },
                    xfa: "remove",
                    unresolved: "skip",
                    bindings: [
                        {
                            bind: "text",
                            field: "LegalName",
                            target: PAGE1 + "f1_01[0]"
                        },
                        {
                            bind: "button_group",
                            field: "TaxClassification",
                            options: [
                                {
                                    value: "individual",
                                    target:
                                        PAGE1 +
                                        "Boxes3a-b_ReadOrder[0].c1_1[0]",
                                    on_state: "1"
                                },
                                {
                                    value: "c-corporation",
                                    target:
                                        PAGE1 +
                                        "Boxes3a-b_ReadOrder[0].c1_1[1]",
                                    on_state: "2"
                                }
                            ]
                        },
                        {
                            bind: "check",
                            field: "HasForeignPartners",
                            target: PAGE1 + "Boxes3a-b_ReadOrder[0].c1_2[0]",
                            on_state: "1"
                        },
                        {
                            bind: "segments",
                            field: "EmployerIdentificationNumber",
                            retain: "digits",
                            segments: [
                                { target: PAGE1 + "f1_14[0]", length: 2 },
                                { target: PAGE1 + "f1_15[0]", length: 7 }
                            ]
                        }
                    ]
                }
            }
        })
    );
    write(
        "SCHEMA_UPSTREAM.yaml",
        [
            "schema: record-schema-upstream",
            "schema_version: 1",
            "",
            "record_schema:",
            "  form_packs:",
            "    - forms/packs/w9.json",
            "  provides:",
            "    - id: tax",
            "      name: Tax",
            "      kind: schema",
            ""
        ].join("\n")
    );
    return root;
}

/**
 * Run the command.
 * @param {string} root
 * @param {string[]} args
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function run(root, args) {
    const result = spawnSync(process.execPath, [COMMAND, "-r", root, ...args], {
        encoding: "utf8"
    });
    return {
        status: result.status ?? -1,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? ""
    };
}

test("--list names the forms and how many fields each needs", (t) => {
    const root = buildRepository();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const result = run(root, ["--list"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /irs-w9\s+4 fields\s+IRS Form W-9/);
});

test("the scaffold names every field the form binds", (t) => {
    const root = buildRepository();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const result = run(root, ["--form", "irs-w9"]);
    assert.equal(result.status, 0, result.stderr);
    const parsed = parseYaml(result.stdout);
    assert.deepEqual(Object.keys(parsed.fields), [
        "LegalName",
        "TaxClassification",
        "HasForeignPartners",
        "EmployerIdentificationNumber"
    ]);
});

test("each binding kind produces the field type it reads", (t) => {
    const root = buildRepository();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const parsed = parseYaml(run(root, ["--form", "irs-w9"]).stdout);
    assert.equal(parsed.fields.LegalName.type, "text");
    assert.equal(parsed.fields.TaxClassification.type, "enum");
    assert.equal(parsed.fields.HasForeignPartners.type, "boolean");
    assert.equal(parsed.fields.EmployerIdentificationNumber.type, "text");
    assert.deepEqual(parsed.fields.TaxClassification.values, [
        "individual",
        "c-corporation"
    ]);
});

test("boolean labels survive as strings, not as YAML booleans", (t) => {
    const root = buildRepository();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const output = run(root, ["--form", "irs-w9"]).stdout;
    assert.match(output, /true_label: "Yes"/, "quoted in the emitted text");

    const parsed = parseYaml(output);
    assert.equal(typeof parsed.fields.HasForeignPartners.true_label, "string");
    assert.equal(parsed.fields.HasForeignPartners.true_label, "Yes");
    assert.equal(parsed.fields.HasForeignPartners.false_label, "No");
});

test("the emitted YAML indents by a single step at each level", (t) => {
    const root = buildRepository();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const lines = run(root, ["--form", "irs-w9"])
        .stdout.split("\n")
        .filter((line) => line.trim().length > 0);
    const widths = new Set(
        lines.map((line) => line.length - line.trimStart().length)
    );
    assert.deepEqual(
        [...widths].sort((a, b) => a - b),
        [0, 2, 4, 6],
        "field names at 2, their keys at 4, sequence items at 6"
    );
});

test("the scaffold satisfies the pack it came from", (t) => {
    const root = buildRepository();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const parsed = parseYaml(run(root, ["--form", "irs-w9"]).stdout);
    const form = FormPack.load(resolve(root, "forms/packs/w9.json")).getForm(
        "irs-w9"
    );
    assert.deepEqual(verifyAgainstContract(form, parsed), []);
});

test("--template wraps the fields in a whole template block", (t) => {
    const root = buildRepository();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const parsed = parseYaml(
        run(root, ["--form", "irs-w9", "--template"]).stdout
    );
    assert.deepEqual(Object.keys(parsed.template).sort(), [
        "datasets",
        "default_instance",
        "fields",
        "instances",
        "metadata",
        "signatures"
    ]);
    assert.equal(Object.keys(parsed.template.fields).length, 4);
    assert.equal(parsed.template.default_instance, "current");
});

test("--format json emits the same fields", (t) => {
    const root = buildRepository();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const asJson = JSON.parse(
        run(root, ["--form", "irs-w9", "--format", "json"]).stdout
    );
    const asYaml = parseYaml(run(root, ["--form", "irs-w9"]).stdout);
    assert.deepEqual(asJson, asYaml);
});

test("an unknown format is refused", (t) => {
    const root = buildRepository();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const result = run(root, ["--form", "irs-w9", "--format", "toml"]);
    assert.equal(result.status, 2);
    assert.match(result.stdout + result.stderr, /Unknown format: toml/);
});

test("a form no pack declares names the ones in force", (t) => {
    const root = buildRepository();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const result = run(root, ["--form", "absent"]);
    assert.equal(result.status, 2);
    assert.match(
        result.stderr,
        /No form pack declares "absent"; the packs in force declare irs-w9/
    );
});

test("--form is required unless listing", (t) => {
    const root = buildRepository();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const result = run(root, []);
    assert.equal(result.status, 2);
    assert.match(result.stdout + result.stderr, /Pass --form <id>/);
});

test("--pack reads a pack the repository does not configure", (t) => {
    const root = buildRepository();
    const elsewhere = mkdtempSync(join(tmpdir(), "scaffold-elsewhere-"));
    t.after(() => {
        rmSync(root, { recursive: true, force: true });
        rmSync(elsewhere, { recursive: true, force: true });
    });

    const result = spawnSync(
        process.execPath,
        [
            COMMAND,
            "-r",
            elsewhere,
            "--pack",
            resolve(root, "forms/packs/w9.json"),
            "--form",
            "irs-w9"
        ],
        { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(Object.keys(parseYaml(result.stdout).fields).length, 4);
});

test("the command is reachable through the toolkit dispatcher", (t) => {
    const root = buildRepository();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const dispatcher = join(BIN, "record-schema-toolkit.mjs");
    const listing = spawnSync(process.execPath, [dispatcher, "--help"], {
        encoding: "utf8"
    });
    assert.match(listing.stdout, /^ {2}scaffold-form-fields$/m);

    const result = spawnSync(
        process.execPath,
        [dispatcher, "scaffold-form-fields", "-r", root, "--list"],
        { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /irs-w9/);
});
