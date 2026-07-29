#!/usr/bin/env node

import { resolve } from "node:path";

import { verifyLicenseRepository } from "../lib/record-schema/LicenseVerification.mjs";

/**
 * @typedef {Object} CliOptions
 * @property {string} root
 * @property {string | null} canonicalRoot
 * @property {boolean} json
 * @property {boolean} help
 */

/**
 * @param {string[]} argumentsList
 * @returns {CliOptions}
 */
function parseArguments(argumentsList) {
    /** @type {CliOptions} */
    const options = {
        root: ".",
        canonicalRoot: null,
        json: false,
        help: false
    };
    for (let i = 0, len = argumentsList.length; i < len; i++) {
        const argument = argumentsList[i];
        if (argument === "--json") {
            options.json = true;
            continue;
        }
        if (argument === "--help" || argument === "-h") {
            options.help = true;
            continue;
        }
        if (argument === "--root" || argument === "-r") {
            i++;
            if (i >= len) {
                throw new Error(`${argument} requires a path`);
            }
            options.root = argumentsList[i];
            continue;
        }
        if (argument.startsWith("--root=")) {
            options.root = argument.slice("--root=".length);
            continue;
        }
        if (argument === "--canonical-root" || argument === "-c") {
            i++;
            if (i >= len) {
                throw new Error(`${argument} requires a path`);
            }
            options.canonicalRoot = argumentsList[i];
            continue;
        }
        if (argument.startsWith("--canonical-root=")) {
            options.canonicalRoot = argument.slice(
                "--canonical-root=".length
            );
            continue;
        }
        throw new Error(`Unknown argument: ${argument}`);
    }
    return options;
}

function printUsage() {
    console.log(`Usage: verify-license [options]

Verify a repository LICENSE, SCHEMA_UPSTREAM license declaration, and optional
canonical github.com/SolomonDAOrg/licenses checkout.

Options:
  -r, --root <path>             Repository root (default: .)
  -c, --canonical-root <path>   Canonical licenses repository checkout
      --json                    Emit machine-readable JSON
  -h, --help                    Show this help`);
}

/**
 * @param {ReturnType<typeof verifyLicenseRepository>} result
 */
function printHumanResult(result) {
    console.log(
        `Verified ${result.stats.licenses} repository LICENSE document(s); ` +
            `registry-licenses=${result.stats.registry_licenses}; ` +
            `local-registry=${result.local_registry ? "yes" : "no"}; ` +
            `canonical-registry=${result.canonical_registry ? "yes" : "no"}.`
    );
    for (let i = 0, len = result.licenses.length; i < len; i++) {
        const license = result.licenses[i];
        console.log(
            `  ${license.file}: ${license.spdx_license_identifier} ` +
                `${license.computed_checksum_sha256}`
        );
    }
    if (result.issues.length === 0) {
        console.log("No issues found.");
        return;
    }
    for (let i = 0, len = result.issues.length; i < len; i++) {
        const issue = result.issues[i];
        const location = issue.line
            ? `${issue.file}:${issue.line}`
            : issue.file;
        console.log(
            `[${issue.severity.toUpperCase()}] ${location}: ` +
                `${issue.message} (${issue.code})`
        );
    }
}

function main() {
    let options;
    try {
        options = parseArguments(process.argv.slice(2));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        printUsage();
        process.exitCode = 2;
        return;
    }
    if (options.help) {
        printUsage();
        return;
    }
    const root = resolve(process.cwd(), options.root);
    const canonicalRoot = options.canonicalRoot
        ? resolve(process.cwd(), options.canonicalRoot)
        : null;
    const result = verifyLicenseRepository(root, { canonicalRoot });
    if (options.json) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        printHumanResult(result);
    }
    if (result.stats.errors > 0 || result.stats.warnings > 0) {
        process.exitCode = 1;
    }
}

main();
