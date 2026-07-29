#!/usr/bin/env node

import { resolve } from "node:path";
import { CLI } from "../lib/cli/cli.mjs";
import { Repository } from "../lib/record-schema/Repository.mjs";

const SCRIPT_NAME = "validate";
const DESCRIPTION =
    "Validate record schema, registry integrity, and profile rules (Read-only)";

const schema = {
    flags: {
        json: { description: "Machine-readable JSON output", default: false },
        "fail-on-warn": {
            description: "Exit non-zero on warnings",
            default: true
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
            default: "registry.profile.yaml",
            type: "string"
        },
        registry: {
            description: "Registry YAML path (repo-relative)",
            default: "registry.yaml",
            type: "string"
        }
    }
};

const options = CLI.handleCLI({
    scriptName: SCRIPT_NAME,
    description: DESCRIPTION,
    schema
});
const root_dir = resolve(process.cwd(), options.root);

function run() {
    // 1. Initialize Repository — auto-discovers root, profile, registry, packs
    const repo = Repository.fromFolder(root_dir);

    // Override with explicit CLI args if provided
    if (options.profile !== "registry.profile.yaml") {
        repo.loadProfile(options.profile);
    }
    if (options.registry !== "registry.yaml") {
        repo.loadRegistry(options.registry);
    }

    const profile = repo.getProfile();
    const registry = repo.getRegistry();

    const issues = [];
    const stats = { records: 0, documents: 0 };

    console.error("Validating repository structure and schemas...");

    // 3. Validate Global Configs (Profile & Registry schemas)
    if (profile) {
        issues.push(...repo.validateProfile());
        issues.push(...repo.validateRequiredPaths());
        issues.push(...repo.validateConfiguredSchemaMaterials());
    } else {
        issues.push({
            severity: "warn",
            code: "config.profile.missing",
            message: `Profile not found at ${options.profile}`,
            file: options.profile
        });
    }

    if (registry) {
        issues.push(...repo.validateRegistry(options.registry));
    } else {
        issues.push({
            severity: "warn",
            code: "config.registry.missing",
            message: `Registry not found at ${options.registry}`,
            file: options.registry
        });
    }

    // 4. Record & Metafile Validation
    const records = repo.findRecords();
    stats.records = records.length;

    // Load schemas once
    const metaSchemas = repo.getRecordMetaSchemas();

    for (let i = 0; i < records.length; i++) {
        const record = records[i];

        // Validate META.yaml Schema
        if (record.metafile) {
            for (let schemaIndex = 0, schemaLen = metaSchemas.length; schemaIndex < schemaLen; schemaIndex++) {
                const schemaErrors = record.metafile.validateSchema(metaSchemas[schemaIndex]);
                for (let errorIndex = 0, errorLen = schemaErrors.length; errorIndex < errorLen; errorIndex++) {
                    issues.push({
                        severity: "error",
                        code: "meta.schema",
                        message: schemaErrors[errorIndex].message,
                        file: record.rel_path + "/_META.yaml"
                    });
                }
            }

            // Validate Business Logic (Constraints from Profile buckets)
            const bucket = profile ? profile.getBucket(record.bucket) : null;
            const constraints = bucket ? bucket.constraints : null;

            const metaIssues = record.metafile.validate(
                record.record_id,
                record.dir_name,
                constraints,
                registry
            );

            // Remap Metafile issues to include file path
            metaIssues.forEach((mi) => {
                issues.push({
                    ...mi,
                    file: record.rel_path + "/_META.yaml"
                });
            });

            // Validate Document Existence Referenced in META
            if (!record.metafile.primaryDocumentExists(record.abs_path)) {
                issues.push({
                    severity: "error",
                    code: "meta.ref.missing",
                    message: `Primary document not found: ${record.metafile.getPrimaryDocumentPath()}`,
                    file: record.rel_path
                });
            }

            issues.push(...repo.validateStructuredDocuments(record));
            issues.push(...repo.validateLanguageRuleDocuments(record));
        } else {
            issues.push({
                severity: "error",
                code: "record.meta.missing",
                message: `Missing _META.yaml for record ${record.record_id}`,
                file: record.rel_path
            });
        }

        // Count documents
        const docs = repo.findDocumentsInRecord(record);
        stats.documents += docs.length;
    }

    // 5. Output
    if (options.json) {
        console.log(JSON.stringify({ stats, issues }, null, 2));
    } else {
        printHumanReadable(stats, issues);
    }

    // 6. Exit Code
    const errorCount = issues.filter((i) => i.severity === "error").length;
    const warnCount = issues.filter((i) => i.severity === "warn").length;

    if (errorCount > 0 || (options["fail-on-warn"] && warnCount > 0)) {
        process.exit(1);
    }
}

function printHumanReadable(stats, issues) {
    console.log(
        `Checked ${stats.records} records, ${stats.documents} documents.`
    );

    if (issues.length === 0) {
        console.log("No issues found.");
        return;
    }

    // Group by file
    const byFile = {};
    issues.forEach((i) => {
        const f = i.file || "General";
        if (!byFile[f]) byFile[f] = [];
        byFile[f].push(i);
    });

    Object.keys(byFile)
        .sort()
        .forEach((f) => {
            console.log(`\n${f}:`);
            byFile[f].forEach((i) => {
                const label = i.severity.toUpperCase();
                console.log(`  [${label}] ${i.message} (${i.code})`);
            });
        });
    console.log("");
}

try {
    run();
} catch (err) {
    console.error(err);
    process.exit(1);
}
