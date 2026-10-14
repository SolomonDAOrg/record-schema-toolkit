#!/usr/bin/env node

/**
 * Print the template fields a form pack expects a record to declare.
 *
 * A form's bindings name template fields, and a record whose template omits one
 * is refused rather than quietly half filled. The requirement is readable off
 * the pack — each binding kind fixes the type of the field it reads, and a
 * binding over options fixes that field's values — so this prints it instead of
 * leaving it to be transcribed by hand.
 *
 * Every field comes out optional with a placeholder. Which entries a form makes
 * mandatory is the form's own rule, not the pack's, so it is left to the author
 * rather than guessed here.
 *
 * @module bin/scaffold-form-fields
 */

import { resolve } from "node:path";

import { CLI } from "../lib/cli/cli.mjs";
import { stringifyYaml } from "../lib/parsing/yaml.mjs";
import { FormPack } from "../lib/record-schema/FormPack.mjs";
import { Repository } from "../lib/record-schema/Repository.mjs";
import {
    describeTemplateFields,
    scaffoldTemplateFields
} from "../lib/record-schema/forms/template-fields.mjs";

const SCRIPT_NAME = "scaffold-form-fields";
const DESCRIPTION =
    "Print the template fields a form pack expects a record to declare";

const options = CLI.handleCLI({
    scriptName: SCRIPT_NAME,
    description: DESCRIPTION,
    schema: {
        flags: {
            list: {
                description: "List the forms the packs in force declare",
                default: false
            },
            template: {
                description:
                    "Wrap the fields in a whole template block skeleton",
                default: false
            },
            "no-discovery": {
                description: "Disable automatic repository root discovery",
                default: false
            }
        },
        values: {
            form: {
                aliases: ["f"],
                description: "Form id to scaffold",
                default: null,
                type: "string"
            },
            pack: {
                aliases: ["packs"],
                description:
                    "Form pack paths (comma-separated); default is the" +
                    " packs the repository configures",
                default: [],
                type: "array"
            },
            root: {
                aliases: ["r"],
                description: "Repository root or record directory",
                default: ".",
                type: "string"
            },
            format: {
                description: "Output format: yaml or json",
                default: "yaml",
                type: "string"
            }
        }
    },
    examples: {
        "List the forms available here": `${SCRIPT_NAME} --list`,
        "Scaffold one form's fields": `${SCRIPT_NAME} --form irs-w9`,
        "Scaffold from a pack directly":
            `${SCRIPT_NAME} --form irs-w9` +
            " --pack forms/packs/irs-w9-2024-03.json"
    }
});

if (options.format !== "yaml" && options.format !== "json") {
    CLI.exitWithError("Unknown format: " + options.format, 2);
}

const inputDirectory = resolve(process.cwd(), options.root);

/**
 * Open the repository the way the other record commands do.
 * @returns {Repository}
 */
function openRepository() {
    if (options["no-discovery"]) {
        return Repository.open(inputDirectory);
    }
    return Repository.openWithDiscovery(inputDirectory, {});
}

/**
 * The forms in force: the packs the repository configures, then any named on
 * the command line, so an unconfigured pack can be inspected in place.
 * @returns {Record<string, import("../lib/record-schema/forms/types.mjs").FormDefinition>}
 */
function resolveForms() {
    const repository = openRepository();
    const paths = repository.getFormPackPaths().concat(options.pack);
    if (paths.length === 0) {
        return {};
    }
    const roots = repository
        .getSchemaMaterialRoots()
        .filter((root) => root !== repository.root_dir);
    return FormPack.loadMerged(repository.root_dir, paths, roots).forms;
}

/**
 * A whole template block around the scaffolded fields.
 * @param {Record<string, Object>} fields
 * @returns {Object}
 */
function templateBlock(fields) {
    return {
        fields,
        metadata: [],
        datasets: {},
        signatures: {},
        instances: { current: "INSTANCE-current.yaml" },
        default_instance: "current"
    };
}

/**
 * The scaffold as text in the requested format.
 * @param {Record<string, Object>} fields
 * @returns {string}
 */
function render(fields) {
    if (options.format === "json") {
        return JSON.stringify(
            options.template ? { template: templateBlock(fields) } : { fields },
            null,
            2
        );
    }

    return stringifyYaml(
        options.template ? { template: templateBlock(fields) } : { fields }
    ).trimEnd();
}

const forms = resolveForms();
const ids = Object.keys(forms);

if (options.list) {
    if (ids.length === 0) {
        console.log("No form packs are in force. Pass --pack, or declare");
        console.log("form_packs in SCHEMA_UPSTREAM.yaml.");
        process.exit(0);
    }
    for (let i = 0, len = ids.length; i < len; i++) {
        const form = forms[ids[i]];
        const described = describeTemplateFields(form);
        const count = Object.keys(described.fields).length;
        console.log(
            `${ids[i].padEnd(24)} ${String(count).padStart(3)} fields  ${
                form.title || ""
            }`.trimEnd()
        );
    }
    process.exit(0);
}

if (options.form === null) {
    CLI.exitWithError(
        "Pass --form <id>, or --list to see what is available",
        2
    );
}
if (!Object.hasOwn(forms, options.form)) {
    console.error(
        `No form pack declares "${options.form}"; the packs in force declare ` +
            (ids.length === 0 ? "none" : ids.join(", "))
    );
    process.exit(2);
}

const form = forms[options.form];
const described = describeTemplateFields(form);
for (let i = 0, len = described.conflicts.length; i < len; i++) {
    console.error(
        `Warning: ${described.conflicts[i]} is read by bindings that need ` +
            "different field types; this scaffold cannot satisfy both."
    );
}

console.log(render(scaffoldTemplateFields(form)));
process.exit(described.conflicts.length > 0 ? 1 : 0);
