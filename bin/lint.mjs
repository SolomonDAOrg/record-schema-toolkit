#!/usr/bin/env node

import { resolve } from "node:path";
import { CLI } from "../lib/cli/cli.mjs";
import { Repository } from "../lib/record-schema/Repository.mjs";

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

    if (options.packs && options.packs.length > 0) {
        repo.loadPacks(options.packs);
    }
    if (options.registry) {
        repo.loadRegistry(options.registry);
    }

    const registry = repo.getRegistry();
    const docMetaSchema = repo.getDocMetaSchema();
    const records = repo.findRecords();

    console.error(`Linting ${records.length} records...`);

    /** @type {import("../lib/record-schema/FormattingPack.mjs").LintIssue[]} */
    const issues = [];

    // -------------------------------------------------------------------------
    // Pass 1: policy-driven formatting checks (characters, line width, dialect,
    //         footer shape, metadata block presence + required fields).
    //         Runs through repo.lintDocuments so META.yaml overrides are applied.
    // -------------------------------------------------------------------------
    const fmtIssues = repo.lintDocuments({ scanDir: root_dir });
    for (let i = 0, len = fmtIssues.length; i < len; i++) {
        issues.push(fmtIssues[i]);
    }

    // -------------------------------------------------------------------------
    // Pass 2: registry + schema checks that are not FormattingPack concerns.
    // -------------------------------------------------------------------------
    for (let ri = 0, rlen = records.length; ri < rlen; ri++) {
        const record = records[ri];
        const docs = repo.findDocumentsInRecord(record);

        for (let di = 0, dlen = docs.length; di < dlen; di++) {
            const doc = docs[di];
            const rel_path = repo.getRelativePath(doc.source_path);

            if (!doc.isMarkdown()) {
                continue;
            }

            const fileInfo = doc.getFileInfo();

            // Validate doc type code against registry
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

            // Validate metadata block contents against doc meta schema
            if (docMetaSchema) {
                const meta = doc.getMetadata();
                if (meta && !meta.isEmpty()) {
                    const metaErrors = doc.validateMetadata(docMetaSchema);
                    for (
                        let ei = 0, elen = metaErrors.length;
                        ei < elen;
                        ei++
                    ) {
                        issues.push({
                            severity: "error",
                            code: "format.metadata.schema",
                            message: `Metadata: ${metaErrors[ei].message}`,
                            file: rel_path
                        });
                    }
                }
            }
        }
    }

    if (options.json) {
        console.log(JSON.stringify({ issues }, null, 2));
    } else {
        for (let i = 0, len = issues.length; i < len; i++) {
            const issue = issues[i];
            const loc = issue.line ? `:${issue.line}` : "";
            console.log(
                `${issue.file}${loc}: [${issue.severity.toUpperCase()}] ${
                    issue.message
                } (${issue.code})`
            );
        }
        if (issues.length === 0) {
            console.log("No lint issues found.");
        } else {
            console.log(`\nFound ${issues.length} issues.`);
        }
    }

    if (issues.some((i) => i.severity === "error")) {
        process.exit(1);
    }
}

try {
    run();
} catch (err) {
    console.error(err);
    process.exit(1);
}
