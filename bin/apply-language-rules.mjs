#!/usr/bin/env node

import { resolve } from "node:path";
import { CLI } from "../lib/cli/cli.mjs";
import { LanguageRuleEngine } from "../lib/language-rules/LanguageRuleEngine.mjs";

const SCRIPT_NAME = "apply-language-rules";
const DESCRIPTION = "Apply language-rule-registry backed rules to a source tree";

const schema = {
    flags: {
        json: { description: "Machine-readable JSON output", default: false },
        fix: { description: "Write safe text fixes", default: false },
        "require-parsers": {
            description: "Treat missing parser adapters as errors",
            default: true
        },
        "fail-on-warn": {
            description: "Exit non-zero when warnings are present",
            default: false
        }
    },
    values: {
        "rules-root": {
            aliases: ["r"],
            description: "Root of the concrete language rules repository, e.g. solomon-language-rules",
            default: ".",
            type: "string"
        },
        "source-root": {
            aliases: ["s"],
            description: "Root of the source repository to check",
            default: ".",
            type: "string"
        },
        "parser-root": {
            aliases: ["p"],
            description: "Root containing compiled parser modules as .mjs files",
            default: "",
            type: "string"
        },
        include: {
            description: "Comma-separated include globs, repo-relative to source-root",
            default: "",
            type: "string"
        },
        exclude: {
            description: "Comma-separated exclude globs, repo-relative to source-root",
            default: "",
            type: "string"
        }
    }
};

const options = CLI.handleCLI({
    scriptName: SCRIPT_NAME,
    description: DESCRIPTION,
    schema
});

try {
    const engine = new LanguageRuleEngine({
        rules_root: resolve(process.cwd(), options["rules-root"]),
        source_root: resolve(process.cwd(), options["source-root"]),
        parser_root: options["parser-root"] ? resolve(process.cwd(), options["parser-root"]) : null,
        fix: options.fix === true,
        require_parsers: options["require-parsers"] === true,
        include_globs: splitCsv(options.include),
        exclude_globs: splitCsv(options.exclude)
    });

    const result = await engine.run();
    if (options.json) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        printHumanReadable(result);
    }

    const errorCount = result.diagnostics.filter((item) => item.severity === "error").length;
    const warnCount = result.diagnostics.filter((item) => item.severity === "warn").length;
    if (errorCount > 0 || (options["fail-on-warn"] === true && warnCount > 0)) {
        process.exit(1);
    }
} catch (err) {
    console.error(err);
    process.exit(1);
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function splitCsv(value) {
    if (typeof value !== "string" || value.trim().length === 0) {
        return [];
    }
    return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
}

/**
 * @param {import("../lib/language-rules/LanguageRuleEngine.mjs").LanguageRuleRunResult} result
 */
function printHumanReadable(result) {
    console.log(`Checked ${result.stats.files} source files, parsed ${result.stats.parsed}, changed ${result.stats.changed}.`);
    if (result.diagnostics.length === 0) {
        console.log("No issues found.");
        return;
    }
    /** @type {Map<string, import("../lib/language-rules/LanguageRuleEngine.mjs").LanguageRuleDiagnostic[]>} */
    const byFile = new Map();
    for (let i = 0, len = result.diagnostics.length; i < len; i++) {
        const diagnostic = result.diagnostics[i];
        const list = byFile.get(diagnostic.file) ?? [];
        list.push(diagnostic);
        byFile.set(diagnostic.file, list);
    }
    const files = Array.from(byFile.keys()).sort();
    for (let i = 0, len = files.length; i < len; i++) {
        const file = files[i];
        console.log(`\n${file}:`);
        const items = byFile.get(file) ?? [];
        items.sort((a, b) => a.line - b.line || a.column - b.column || a.rule_id.localeCompare(b.rule_id));
        for (let j = 0, jLen = items.length; j < jLen; j++) {
            const item = items[j];
            const location = `${item.line}:${item.column}`;
            console.log(`  [${item.severity.toUpperCase()}] ${location} ${item.message} (${item.rule_id})`);
            if (item.suggestion) {
                console.log(`    suggestion: ${item.suggestion}`);
            }
        }
    }
}
