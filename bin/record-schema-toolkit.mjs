#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const commands = new Map([
    ["apply-language-rules", "apply-language-rules.mjs"],
    ["assert", "assert.mjs"],
    ["chart", "chart.mjs"],
    ["doctor", "doctor.mjs"],
    ["format", "format.mjs"],
    ["generate-index", "generate-index.mjs"],
    ["lint", "lint.mjs"],
    ["materialize", "materialize.mjs"],
    ["render", "render.mjs"],
    ["report", "report.mjs"],
    ["validate", "validate.mjs"],
    ["verify-license", "verify-license.mjs"]
]);

function printUsage() {
    process.stdout.write(
        [
            "Record Schema Toolkit",
            "",
            "Usage: record-schema-toolkit <command> [options]",
            "",
            "Commands:",
            ...[...commands.keys()].map((name) => `  ${name}`),
            ""
        ].join("\n")
    );
}

const commandName = process.argv[2];
if (commandName === undefined || commandName === "--help" || commandName === "-h") {
    printUsage();
    process.exit(0);
}

const scriptName = commands.get(commandName);
if (scriptName === undefined) {
    process.stderr.write(`Unknown command: ${commandName}\n\n`);
    printUsage();
    process.exit(2);
}

const binDirectory = dirname(fileURLToPath(import.meta.url));
const outcome = spawnSync(
    process.execPath,
    [resolve(binDirectory, scriptName), ...process.argv.slice(3)],
    { stdio: "inherit" }
);
if (outcome.error !== undefined) {
    process.stderr.write(`${outcome.error.message}\n`);
    process.exit(2);
}
process.exit(outcome.status ?? 2);
