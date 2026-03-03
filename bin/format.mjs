#!/usr/bin/env node

import { resolve } from "node:path";
import { CLI } from "../lib/cli/cli.mjs";
import { Repository } from "../lib/record-schema/Repository.mjs";
import { FormattingPack } from "../lib/record-schema/FormattingPack.mjs";

const SCRIPT_NAME = "format";
const DESCRIPTION =
    "Format record repository (normalization, encoding, whitespace)";

const schema = {
    flags: {
        "dry-run": {
            description: "Show what would be changed without writing",
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
        packs: {
            description: "Formatting pack JSON paths",
            default: [],
            type: "array"
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

    // Override with explicit pack paths if provided
    if (options.packs && options.packs.length > 0) {
        repo.loadPacks(options.packs);
    }

    const policy = repo.getPolicy();

    console.error("Scanning repository for formatting...");

    const changedFiles = [];
    const records = repo.findRecords();

    // Helper to process a doc
    const processDoc = (doc, rel_path) => {
        if (!doc.isText()) return;

        let currentDoc = doc;
        let modified = false;

        // 1. Baseline Normalization (BOM, EOL, Trailing Whitespace)
        const baseline = currentDoc.normalizeBaseline();
        if (baseline.text !== currentDoc.text) {
            currentDoc = baseline;
            modified = true;
        }

        // 2. Canonical ASCII (Quotes, Dashes)
        // We only apply this if we are fairly certain it's safe (e.g. Markdown/Text)
        if (doc.isMarkdown()) {
            const result = currentDoc.normalizeCanonicalAscii();
            if (result.changed) {
                currentDoc = currentDoc.withText(result.text);
                modified = true;
            }
        }

        if (modified) {
            changedFiles.push(rel_path);
            if (!options["dry-run"]) {
                currentDoc.save();
            }
        }
    };

    // Iterate Records
    records.forEach((record) => {
        const docs = repo.findDocumentsInRecord(record);
        docs.forEach((doc) => {
            const rel_path = repo.getRelativePath(doc.source_path);
            processDoc(doc, rel_path);
        });
    });

    // Iterate Root Docs (License, Readme)
    const rootDocs = repo.findRootDocuments();
    rootDocs.forEach((doc) => {
        const rel_path = repo.getRelativePath(doc.source_path);
        processDoc(doc, rel_path);
    });

    if (changedFiles.length === 0) {
        console.log("Nothing to format.");
        return;
    }

    if (options["dry-run"]) {
        console.log("Dry run. The following files would be changed:");
        changedFiles.forEach((f) => console.log(` - ${f}`));
    } else {
        console.log(`Formatted ${changedFiles.length} files.`);
    }
}

try {
    run();
} catch (err) {
    console.error(err);
    process.exit(1);
}
