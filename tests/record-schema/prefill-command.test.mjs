// @ts-check

/**
 * The prefill command: what it reports, what it writes, and the exit codes a
 * caller can act on.
 *
 * The command is spawned rather than imported, because its contract is the
 * process — output on stdout, failures on stderr, and a status that tells a
 * build whether anything was issued.
 *
 * @module tests/record-schema/prefill-command_test
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadPdf, readAcroForm, readFormValues } from "../../lib/pdf/index.mjs";

import { W9_PATH, W9_SHA256 } from "./forms/fixture.mjs";

const COMMAND = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../bin/prefill.mjs"
);
const PAGE1 = "topmostSubform[0].Page1[0].";

/**
 * A repository whose one record issues a W-9 twice, once flattened.
 * @returns {string} repository root
 */
function buildRepository() {
    const root = mkdtempSync(join(tmpdir(), "prefill-command-"));
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
                    document: { path: "forms/pdf/fw9.pdf", sha256: W9_SHA256 },
                    xfa: "remove",
                    need_appearances: false,
                    unresolved: "skip",
                    bindings: [
                        {
                            bind: "text",
                            field: "LegalName",
                            target: PAGE1 + "f1_01[0]"
                        },
                        {
                            bind: "text",
                            field: "BusinessName",
                            target: PAGE1 + "f1_02[0]"
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

    write(
        "records/TAX-00001-w9/TAX-00001_META.yaml",
        JSON.stringify(
            {
                schema: "record-schema",
                schema_version: 1,
                id: "TAX-00001",
                series_code: "TAX",
                series: 1,
                title: "Taxpayer identification",
                document: { version: "1" },
                status: {
                    phase: "execution",
                    last_updated: "2026-09-21T00:00:00.000Z"
                },
                extensions: {
                    prefilled_forms: {
                        outputs: [
                            {
                                form: "irs-w9",
                                path: "forms/w9.pdf",
                                label: "Form W-9"
                            },
                            {
                                form: "irs-w9",
                                path: "forms/w9-flat.pdf",
                                label: "Form W-9 (flattened)",
                                flatten: true
                            }
                        ]
                    }
                },
                template: {
                    fields: {
                        LegalName: { type: "text", required: true },
                        BusinessName: {
                            type: "text",
                            required: false,
                            draft_placeholder: "[Business name]"
                        }
                    },
                    metadata: [],
                    datasets: {},
                    signatures: {},
                    instances: { current: "TAX-00001_INSTANCE-current.yaml" },
                    default_instance: "current"
                }
            },
            null,
            2
        )
    );
    write(
        "records/TAX-00001-w9/TAX-00001_INSTANCE-current.yaml",
        JSON.stringify(
            {
                schema: "record-schema-document-instance",
                schema_version: 1,
                template: { record_id: "TAX-00001", version: "1" },
                document_id: "W9",
                fields: { LegalName: "Solomon Labs Pty Ltd" },
                datasets: {},
                stages: {
                    draft: {
                        document: { version: "1-draft", path: "d.pdf" }
                    },
                    for_execution: {
                        document: { version: "1", path: "f.pdf" }
                    }
                },
                default_stage: "for_execution"
            },
            null,
            2
        )
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

test("--help describes the command without touching the repository", (t) => {
    const result = spawnSync(process.execPath, [COMMAND, "--help"], {
        encoding: "utf8"
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Issue the filled PDF forms a record declares/);
    assert.match(result.stdout, /--list/);
    assert.match(result.stdout, /--overwrite/);
    assert.match(result.stdout, /--record-filter/);
});

test("--list reports declarations and writes nothing", (t) => {
    const root = buildRepository();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const result = run(root, ["--list"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /TAX-00001/);
    assert.match(result.stdout, /irs-w9\s+forms\/w9\.pdf/);
    assert.match(result.stdout, /forms\/w9-flat\.pdf \(flattened\)/);
    assert.equal(
        existsSync(resolve(root, "records/TAX-00001-w9/forms/w9.pdf")),
        false,
        "listing issues nothing"
    );
});

test("the declared forms are issued", (t) => {
    const root = buildRepository();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const result = run(root, []);
    assert.equal(result.status, 0, result.stderr);
    assert.match(
        result.stdout,
        /TAX-00001\s+forms\/w9\.pdf\s+sha256:[0-9a-f]{12}/
    );
    assert.match(result.stdout, /forms\/w9-flat\.pdf flattened/);
    assert.match(
        result.stdout,
        /unresolved: BusinessName\s+\(1 field left blank\)/
    );

    const issued = resolve(root, "records/TAX-00001-w9/forms/w9.pdf");
    const flat = resolve(root, "records/TAX-00001-w9/forms/w9-flat.pdf");
    assert.ok(existsSync(issued));
    assert.ok(existsSync(flat));

    const values = readFormValues(
        loadPdf(new Uint8Array(readFileSync(issued)))
    );
    assert.deepEqual(values.get(PAGE1 + "f1_01[0]"), {
        kind: "text",
        text: "Solomon Labs Pty Ltd"
    });
    assert.equal(
        readAcroForm(loadPdf(new Uint8Array(readFileSync(flat)))),
        null,
        "the flattened copy is no longer a form"
    );
});

test("an existing output fails with a status a build can act on", (t) => {
    const root = buildRepository();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    assert.equal(run(root, []).status, 0);

    const second = run(root, []);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /already exists: forms\/w9\.pdf/);

    assert.equal(run(root, ["--overwrite"]).status, 0);
});

test("--form-filter narrows what is reported", (t) => {
    const root = buildRepository();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const matched = run(root, ["--list", "--form-filter", "irs-w9"]);
    assert.match(matched.stdout, /forms\/w9\.pdf/);

    const missed = run(root, ["--list", "--form-filter", "irs-w8"]);
    assert.equal(missed.status, 0);
    assert.equal(missed.stdout.trim(), "");
});

test("--record-filter that matches nothing explains itself", (t) => {
    const root = buildRepository();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const result = run(root, ["--record-filter", "ABSENT"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /No records declare prefilled forms/);
    assert.match(result.stdout, /extensions\.prefilled_forms\.outputs/);
});

test("--json reports what was issued and what failed", (t) => {
    const root = buildRepository();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const first = JSON.parse(run(root, ["--json"]).stdout);
    assert.equal(first.issued.length, 2);
    assert.equal(first.failures.length, 0);
    assert.equal(first.issued[0].record, "TAX-00001");
    assert.equal(first.issued[0].form, "irs-w9");
    assert.match(first.issued[0].hash, /^[0-9a-f]{64}$/);
    assert.deepEqual(first.issued[0].unresolved, ["BusinessName"]);

    const second = run(root, ["--json"]);
    assert.equal(second.status, 1);
    const report = JSON.parse(second.stdout);
    assert.equal(report.issued.length, 0);
    assert.equal(report.failures.length, 1);
    assert.equal(report.failures[0].record, "TAX-00001");
});

test("--stage selects the instance stage", (t) => {
    const root = buildRepository();
    t.after(() => rmSync(root, { recursive: true, force: true }));

    const metaPath = resolve(root, "records/TAX-00001-w9/TAX-00001_META.yaml");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.status.phase = "draft";
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    const result = run(root, ["--stage", "draft", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).issued.length, 2);
});

test("the command is reachable through the toolkit dispatcher", (t) => {
    const dispatcher = resolve(dirname(COMMAND), "record-schema-toolkit.mjs");
    const listing = spawnSync(process.execPath, [dispatcher, "--help"], {
        encoding: "utf8"
    });
    assert.match(listing.stdout, /^ {2}prefill$/m);

    const root = buildRepository();
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const result = spawnSync(
        process.execPath,
        [dispatcher, "prefill", "-r", root, "--list"],
        { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /TAX-00001/);
});
