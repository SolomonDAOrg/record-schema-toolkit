#!/usr/bin/env node

/**
 * Issue the filled PDF forms a record declares.
 *
 * A record declares its forms under `extensions.prefilled_forms`; the bindings
 * live in form packs, and the values come from the record's document instance.
 * This walks the repository, issues every declared form, and reports what each
 * one left unresolved.
 *
 * @module bin/prefill
 */

import { resolve } from "node:path";

import { CLI } from "../lib/cli/cli.mjs";
import { Repository } from "../lib/record-schema/Repository.mjs";
import { PrefilledFormGenerator } from "../lib/record-schema/generators/PrefilledFormGenerator.mjs";

const SCRIPT_NAME = "prefill";
const DESCRIPTION = "Issue the filled PDF forms a record declares";

const options = CLI.handleCLI({
    scriptName: SCRIPT_NAME,
    description: DESCRIPTION,
    schema: {
        flags: {
            list: {
                description:
                    "Report what each record declares without writing anything",
                default: false
            },
            overwrite: {
                description: "Replace an output that already exists",
                default: false
            },
            json: {
                description: "Machine-readable JSON output",
                default: false
            },
            verbose: {
                description: "Verbose diagnostics",
                default: false
            },
            "no-discovery": {
                description: "Disable automatic repository root discovery",
                default: false
            }
        },
        values: {
            root: {
                aliases: ["r"],
                description: "Repository root or record directory",
                default: ".",
                type: "string"
            },
            instance: {
                description: "Named instance declared in series META",
                default: null,
                type: "string"
            },
            stage: {
                description: "Named instance stage: draft or for_execution",
                default: null,
                type: "string"
            },
            "record-filter": {
                description: "Filter by Record ID substring",
                default: null,
                type: "string"
            },
            "form-filter": {
                description: "Issue only forms whose id matches this substring",
                default: null,
                type: "string"
            }
        }
    },
    examples: {
        "Issue every declared form in the repository": `${SCRIPT_NAME}`,
        "Report what a record would issue": `${SCRIPT_NAME} --list -r records/TAX-00001-w9`,
        "Re-issue one record's forms at the draft stage":
            `${SCRIPT_NAME} --record-filter TAX-00001` +
            " --stage draft --overwrite"
    }
});

const inputDirectory = resolve(process.cwd(), options.root);

/**
 * @param {string} message
 * @returns {void}
 */
function trace(message) {
    console.log(message);
}

/**
 * Open the repository the way the other record commands do.
 * @returns {Repository}
 */
function openRepository() {
    if (options["no-discovery"]) {
        return Repository.open(inputDirectory);
    }
    return Repository.openWithDiscovery(inputDirectory, {
        verbose: options.verbose
    });
}

/**
 * The records in scope that declare at least one form.
 * @param {Repository} repository
 * @returns {import("../lib/record-schema/types/general.mjs").RecordInfo[]}
 */
function selectRecords(repository) {
    const filter = options["record-filter"];
    return repository.findRecordsWithTarget((record) => {
        if (filter && !record.record_id.includes(filter)) {
            return false;
        }
        return PrefilledFormGenerator.declares(record);
    });
}

/**
 * Whether an output passes the form filter.
 * @param {Object} output
 * @returns {boolean}
 */
function wanted(output) {
    const filter = options["form-filter"];
    return !filter || String(output.form).includes(filter);
}

/**
 * Report what the records declare, without issuing anything.
 * @param {import("../lib/record-schema/types/general.mjs").RecordInfo[]} records
 * @returns {number} exit code
 */
function listDeclarations(records) {
    /** @type {Object[]} */
    const listed = [];
    for (let i = 0, len = records.length; i < len; i++) {
        const record = records[i];
        const declaration = PrefilledFormGenerator.readDeclaration(record);
        const outputs = declaration.outputs.filter(wanted);
        if (outputs.length === 0) {
            continue;
        }
        listed.push({
            record: record.record_id,
            packs: declaration.packs,
            outputs
        });
    }

    if (options.json) {
        console.log(JSON.stringify({ records: listed }, null, 2));
        return 0;
    }
    for (let i = 0, len = listed.length; i < len; i++) {
        const entry = listed[i];
        console.log(entry.record);
        for (let j = 0, count = entry.outputs.length; j < count; j++) {
            const output = entry.outputs[j];
            const flat = output.flatten === true ? " (flattened)" : "";
            console.log(
                `  ${String(output.form).padEnd(24)} ${output.path}${flat}`
            );
        }
    }
    return 0;
}

/**
 * Issue the declared forms.
 * @param {Repository} repository
 * @param {import("../lib/record-schema/types/general.mjs").RecordInfo[]} records
 * @returns {number} exit code
 */
function issueForms(repository, records) {
    const generator = new PrefilledFormGenerator(repository, {
        verbose: options.verbose,
        trace
    });

    /** @type {Object[]} */
    const issued = [];
    /** @type {{ record: string, error: string }[]} */
    const failures = [];

    for (let i = 0, len = records.length; i < len; i++) {
        const record = records[i];
        /** @type {Object} */
        let result;
        try {
            result = generator.generate(record, {
                instance: options.instance ?? undefined,
                stage: options.stage ?? undefined,
                overwrite: options.overwrite
            });
        } catch (error) {
            failures.push({
                record: record.record_id,
                error: error instanceof Error ? error.message : String(error)
            });
            continue;
        }

        if (!result.success) {
            failures.push({ record: record.record_id, error: result.error });
            continue;
        }
        for (let j = 0, count = result.outputs.length; j < count; j++) {
            const output = result.outputs[j];
            if (wanted(output)) {
                issued.push({ record: record.record_id, ...output });
            }
        }
    }

    if (options.json) {
        console.log(JSON.stringify({ issued, failures }, null, 2));
    } else {
        for (let i = 0, len = issued.length; i < len; i++) {
            const output = issued[i];
            const flat = output.flattened ? " flattened" : "";
            console.log(
                `${output.record.padEnd(14)} ${output.path}${flat}` +
                    `  sha256:${output.hash.slice(0, 12)}`
            );
            if (output.unresolved.length > 0) {
                console.log(
                    `  unresolved: ${output.unresolved.join(", ")}` +
                        `  (${output.skipped.length} field${
                            output.skipped.length === 1 ? "" : "s"
                        } left blank)`
                );
            }
        }
        for (let i = 0, len = failures.length; i < len; i++) {
            console.error(`${failures[i].record}: ${failures[i].error}`);
        }
    }

    return failures.length > 0 ? 1 : 0;
}

const repository = openRepository();
const records = selectRecords(repository);

if (records.length === 0) {
    console.log("No records declare prefilled forms. Check:");
    console.log("  - META declares extensions.prefilled_forms.outputs");
    console.log("  - The record is inside a configured bucket");
    console.log("  - --record-filter matches a Record ID");
    process.exit(0);
}

process.exit(
    options.list ? listDeclarations(records) : issueForms(repository, records)
);
