#!/usr/bin/env node

import { resolve } from "node:path";
import { CLI } from "../lib/cli/cli.mjs";
import { Repository } from "../lib/record-schema/Repository.mjs";
import {
    assertionPacksFromProfile
} from "../lib/record-schema/assertions/AssertionRunner.mjs";
import { materializeAssertions } from "../lib/record-schema/assertions/AssertionMaterializer.mjs";

const options = CLI.handleCLI({
    scriptName: "materialize",
    description: "Materialise deterministic state declared by assertion packs",
    schema: {
        flags: {
            write: {
                description: "Write changed outputs; default is a read-only drift report",
                default: false
            },
            json: { description: "Machine-readable JSON output", default: false }
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
            only: {
                description: "Materialise only these rule ids (comma-separated)",
                default: [],
                type: "array"
            }
        }
    }
});

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

const result = materializeAssertions(rootDirectory, {
    packs,
    only: options.only.length === 0 ? undefined : options.only,
    write: options.write
});

if (options.json) {
    console.log(JSON.stringify(result, null, 2));
} else {
    for (let i = 0, len = result.outputs.length; i < len; i++) {
        const output = result.outputs[i];
        const state = output.changed
            ? options.write
                ? "written"
                : "drift"
            : "current";
        console.log(`${output.rule.padEnd(28)} ${state.padEnd(7)} ${output.file}`);
    }
    for (let i = 0, len = result.errors.length; i < len; i++) {
        console.error(result.errors[i]);
    }
}

if (result.errors.length > 0) process.exit(2);
if (!options.write && result.outputs.some((output) => output.changed)) process.exit(1);
