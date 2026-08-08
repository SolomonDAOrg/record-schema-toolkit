#!/usr/bin/env node

import { resolve } from "node:path";
import { CLI } from "../lib/cli/cli.mjs";
import { Repository } from "../lib/record-schema/Repository.mjs";
import { deduplicateIssues } from "../lib/record-schema/util/issues.mjs";
import {
    runAssertions,
    assertionPacksFromProfile
} from "../lib/record-schema/assertions/AssertionRunner.mjs";
import {
    validateAssertionPackDocuments
} from "../lib/record-schema/assertions/AssertionPack.mjs";

const SCRIPT_NAME = "validate";
const DESCRIPTION =
    "Validate record schema, registry integrity, and profile rules (Read-only)";

const schema = {
    flags: {
        json: { description: "Machine-readable JSON output", default: false },
        "fail-on-warn": {
            description: "Exit non-zero on warnings",
            default: true
        },
        "require-base-schemas": {
            description:
                "Fail if any base schema material cannot be resolved from a schema root",
            default: false
        },
        assertions: {
            description:
                "Run the assertion packs the profile declares in rules.assertion_packs",
            default: true
        },
        "no-assertions": {
            description:
                "Run structural and assertion-pack schema validation without executing corpus assertions",
            default: false
        },
        advisory: {
            description: "Promote advisory assertion findings to errors",
            default: false
        },
        production: {
            description: "Alias for --mode production",
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
            default: "registry.profile.yaml",
            type: "string"
        },
        registry: {
            description: "Registry YAML path (repo-relative)",
            default: "registry.yaml",
            type: "string"
        },
        "schema-roots": {
            aliases: [
                "schema-root",
                "schema-material-roots",
                "schema-material-root"
            ],
            description: "Additional schema-material roots (comma-separated)",
            default: [],
            type: "array"
        },
        mode: {
            description: "Named assertion mode",
            default: "development",
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
const schema_material_roots = options["schema-roots"].map((schema_root) =>
    resolve(process.cwd(), schema_root)
);

function run() {
    // 1. Initialize Repository — auto-discovers root, profile, registry, packs
    const repo = Repository.fromFolder(root_dir, {
        schemaMaterialRoots: schema_material_roots
    });

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

    // Base schema material is resolved from the repository, then --schema-roots,
    // then a sibling ../record-schema next to the toolkit. When none of those
    // hold, the schema simply is not there and every check that depends on it is
    // skipped without comment - a corpus missing a required META field validates
    // clean. Say so rather than reporting an unqualified pass.
    const unresolvedBaseSchemas = repo.getUnresolvedBaseSchemaMaterials();
    for (let i = 0, len = unresolvedBaseSchemas.length; i < len; i++) {
        const entry = unresolvedBaseSchemas[i];
        issues.push({
            severity: options["require-base-schemas"] ? "error" : "warn",
            code: "schema.material.unresolved",
            message: `${entry.relative_path} did not resolve from any schema root, leaving ${entry.purpose} unchecked; pass --schema-roots <path-to-record-schema>`,
            file: entry.relative_path
        });
    }

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
            for (
                let schemaIndex = 0, schemaLen = metaSchemas.length;
                schemaIndex < schemaLen;
                schemaIndex++
            ) {
                const schemaErrors = record.metafile.validateSchema(
                    metaSchemas[schemaIndex]
                );
                for (
                    let errorIndex = 0, errorLen = schemaErrors.length;
                    errorIndex < errorLen;
                    errorIndex++
                ) {
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

    // 5. Assertion-pack authoring schema. The engine's runtime validation
    // catches executable shape errors; the normative schema additionally
    // rejects unknown fields and malformed reports/materializers.
    if (profile) {
        const packs = assertionPacksFromProfile(profile.data);
        if (packs.length > 0) {
            const assertionPackSchema = repo.loadSchemaMaterial(
                "schema/assertion.pack.schema.json"
            );
            if (assertionPackSchema === null) {
                issues.push({
                    severity: options["require-base-schemas"] ? "error" : "warn",
                    code: "assertion.pack.schema.unresolved",
                    message:
                        "schema/assertion.pack.schema.json could not be resolved; assertion packs received runtime validation only",
                    file: "schema/assertion.pack.schema.json"
                });
            } else {
                const packSchemaErrors = validateAssertionPackDocuments(
                    root_dir,
                    packs,
                    assertionPackSchema
                );
                for (let i = 0, len = packSchemaErrors.length; i < len; i++) {
                    issues.push({
                        severity: "error",
                        code: "assertion.pack.schema",
                        message: packSchemaErrors[i],
                        file: packSchemaErrors[i].split(":", 1)[0]
                    });
                }
            }
        }
    }

    // 6. Assertions
    //
    // Structural validation has now answered every question that can be asked
    // of one document on its own. The questions that only exist between two
    // documents - an ordinal two records disagree about, a width restated
    // somewhere nothing reads - are the assertion packs, and they are declared
    // by the repository rather than supplied by whoever invoked the toolkit.
    if (options.assertions && !options["no-assertions"] && profile) {
        const packs = assertionPacksFromProfile(profile.data);
        if (packs.length > 0) {
            const assertions = runAssertions(root_dir, {
                packs,
                promoteAdvisory: options.advisory,
                mode: options.production ? "production" : options.mode
            });
            stats.assertions = assertions.executed.length;
            stats.assertion_findings = assertions.findings.length;

            for (let i = 0, len = assertions.findings.length; i < len; i++) {
                const finding = assertions.findings[i];
                issues.push({
                    severity:
                        finding.severity === "warning"
                            ? "warn"
                            : finding.severity,
                    code: `assert.${finding.rule}`,
                    message: finding.message,
                    file: finding.file ?? undefined
                });
            }
        }
    }

    // 6. Output
    const unique_issues = deduplicateIssues(issues);
    if (options.json) {
        console.log(JSON.stringify({ stats, issues: unique_issues }, null, 2));
    } else {
        printHumanReadable(stats, unique_issues);
    }

    // 7. Exit Code
    const errorCount = unique_issues.filter(
        (issue) => issue.severity === "error"
    ).length;
    const warnCount = unique_issues.filter(
        (issue) => issue.severity === "warn"
    ).length;

    if (errorCount > 0 || (options["fail-on-warn"] && warnCount > 0)) {
        process.exit(1);
    }
}

function printHumanReadable(stats, issues) {
    console.log(
        `Checked ${stats.records} records, ${stats.documents} documents${
            stats.assertions === undefined
                ? ""
                : `, ${stats.assertions} assertions`
        }.`
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
