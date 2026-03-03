#!/usr/bin/env node

import { resolve } from "node:path";
import { CLI } from "../lib/cli/cli.mjs";
import { Repository } from "../lib/record-schema/Repository.mjs";
import { FormattingPack } from "../lib/record-schema/FormattingPack.mjs";
import { Registry } from "../lib/record-schema/Registry.mjs";

const SCRIPT_NAME = "lint";
const DESCRIPTION =
    "Lint record repository for formatting, style, and metadata issues";

const schema = {
    flags: {
        json: { description: "JSON output", default: false }
    },
    values: {
        root: {
            aliases: ["r"],
            description: "Repository root",
            default: ".",
            type: "string"
        },
        packs: {
            description: "Formatting pack JSON paths",
            default: [],
            type: "array"
        },
        registry: {
            description: "Registry YAML path (repo-relative)",
            default: null,
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
    const repo = Repository.fromFolder(root_dir);

    // Override with explicit CLI args if provided
    if (options.packs && options.packs.length > 0) {
        repo.loadPacks(options.packs);
    }
    if (options.registry) {
        repo.loadRegistry(options.registry);
    }

    const policy = repo.getPolicy() || {};
    const registry = repo.getRegistry();

    const issues = [];
    const records = repo.findRecords();

    console.error(`Linting ${records.length} records using loaded policies...`);

    // Schema for validating Doc Metadata
    const docMetaSchema = repo.getDocMetaSchema();

    records.forEach((record) => {
        const docs = repo.findDocumentsInRecord(record);

        docs.forEach((doc) => {
            const rel_path = repo.getRelativePath(doc.source_path);
            const fileInfo = doc.getFileInfo();
            const isRoot = false;

            const fileCtx = {
                doc_type: fileInfo.doc_type,
                ext: fileInfo.ext,
                is_root_file: isRoot
            };

            // 1. Resolve Policy for File
            const { effective } = FormattingPack.resolveFilePolicy(policy, {
                rel_path,
                ...fileCtx
            });

            // 2. Check File Naming / Structure
            if (doc.isMarkdown()) {
                // Validate doc type against registry
                if (registry && fileInfo.doc_type) {
                    if (!registry.isValidDocTypeCode(fileInfo.doc_type)) {
                        issues.push({
                            severity: "warn",
                            code: "format.doctype.unknown",
                            message: `Unknown document type code: ${fileInfo.doc_type}`,
                            file: rel_path
                        });
                    }
                }

                // Check for Metadata Block
                const meta = doc.getMetadata();
                const hasMeta = meta && !meta.isEmpty();

                if (effective.require_metadata_block && !hasMeta) {
                    issues.push({
                        severity: "error",
                        code: "format.metadata.missing",
                        message: "Document missing required metadata block",
                        file: rel_path
                    });
                }

                if (hasMeta && docMetaSchema) {
                    const metaErrors = doc.validateMetadata(docMetaSchema);
                    metaErrors.forEach((err) => {
                        issues.push({
                            severity: "error",
                            code: "format.metadata.schema",
                            message: `Metadata: ${err.message}`,
                            file: rel_path
                        });
                    });
                }

                // Check Required Fields in Metadata
                if (
                    hasMeta &&
                    Array.isArray(effective.metadata_required_fields)
                ) {
                    effective.metadata_required_fields.forEach((field) => {
                        if (!meta.has(field)) {
                            issues.push({
                                severity: "error",
                                code: "format.metadata.field_missing",
                                message: `Metadata missing required field: ${field}`,
                                file: rel_path
                            });
                        }
                    });
                }
            }

            // 3. Policy-driven content checks (characters, line
            //    width, dialect, footer shapes)
            const contentIssues = FormattingPack.lintDocument(
                policy,
                doc,
                rel_path,
                fileCtx
            );
            for (let ci = 0, clen = contentIssues.length; ci < clen; ci++) {
                issues.push(contentIssues[ci]);
            }
        });
    });

    if (options.json) {
        console.log(JSON.stringify({ issues }, null, 2));
    } else {
        issues.forEach((issue) => {
            console.log(
                `${issue.file}: [${issue.severity.toUpperCase()}] ${
                    issue.message
                } (${issue.code})`
            );
        });
        if (issues.length === 0) console.log("No lint issues found.");
        else console.log(`\nFound ${issues.length} issues.`);
    }

    if (issues.some((i) => i.severity === "error")) process.exit(1);
}

try {
    run();
} catch (err) {
    console.error(err);
    process.exit(1);
}
