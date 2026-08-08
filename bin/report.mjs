#!/usr/bin/env node

import { resolve } from "node:path";
import { CLI } from "../lib/cli/cli.mjs";
import { Repository } from "../lib/record-schema/Repository.mjs";
import { assertionPacksFromProfile } from "../lib/record-schema/assertions/AssertionRunner.mjs";
import { generateAssertionReport } from "../lib/record-schema/assertions/AssertionReport.mjs";

const options = CLI.handleCLI({
    scriptName: "report",
    description: "Render a named report declared by assertion packs",
    schema: {
        flags: {
            json: { description: "Machine-readable JSON output", default: false },
            verbose: {
                description: "Include report detail rows where declared",
                default: false
            }
        },
        values: {
            root: {
                aliases: ["r"],
                description: "Repository root",
                default: ".",
                type: "string"
            },
            profile: {
                aliases: ["p"],
                description: "Registry profile YAML path (repo-relative)",
                default: null,
                type: "string"
            },
            packs: {
                aliases: ["pack"],
                description: "Assertion pack paths (comma-separated)",
                default: [],
                type: "array"
            },
            report: {
                aliases: ["name"],
                description: "Named report id",
                default: null,
                type: "string"
            }
        }
    }
});

if (options.report === null || options.report.length === 0) {
    console.error("Pass --report <name>.");
    process.exit(2);
}

const rootDirectory = resolve(process.cwd(), options.root);
let packs = options.packs;
if (packs.length === 0) {
    const repository = Repository.fromFolder(rootDirectory, {});
    if (options.profile !== null) repository.loadProfile(options.profile);
    const profile = repository.getProfile();
    packs = profile === null || profile === undefined
        ? []
        : assertionPacksFromProfile(profile.data);
}
if (packs.length === 0) {
    console.error("No assertion packs declared. Pass --packs or load a profile.");
    process.exit(2);
}

const result = generateAssertionReport(rootDirectory, {
    packs,
    report: options.report,
    verbose: options.verbose
});

if (options.json) {
    console.log(JSON.stringify(result, null, 2));
} else if (result.errors.length === 0) {
    process.stdout.write(result.text);
} else {
    for (let i = 0, len = result.errors.length; i < len; i++) {
        console.error(result.errors[i]);
    }
}

if (result.errors.length > 0) process.exit(2);
