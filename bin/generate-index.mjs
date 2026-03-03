#!/usr/bin/env node

/**
 * generate-index.mjs
 *
 * Generates a {RECORD_ID}_IND-index.md file for a given record directory.
 * Reads {RECORD_ID}_META.yaml, resolves document types from assembly.pack and
 * filename conventions, and produces a markdown index ordered by assembly
 * precedence.
 *
 * @module scripts/generate-index
 */

import { resolve, join, basename } from "node:path";
import { writeFileSync, existsSync } from "node:fs";

import { CLI } from "../lib/cli/cli.mjs";
import { Repository } from "../lib/record-schema/Repository.mjs";

const SCRIPT_NAME = "generate-index";
const DESCRIPTION =
    "Generate a {RECORD_ID}_IND-index.md file for a record directory";

const schema = {
    flags: {
        verbose: {
            aliases: ["v"],
            description: "Verbose output",
            default: false
        },
        "no-discovery": {
            description: "Disable automatic repository root discovery",
            default: false
        },
        overwrite: {
            description: "Overwrite existing IND-index file",
            default: false
        }
    },
    values: {
        root: {
            aliases: ["r"],
            description: "Repository root or record directory",
            default: ".",
            type: "string"
        },
        output: {
            aliases: ["o"],
            description:
                "Override output file path (default: {record_dir}/{RECORD_ID}_IND-index.md)",
            default: null,
            type: "string"
        },
        "record-filter": {
            description: "Filter by Record ID substring",
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

const inputDir = resolve(process.cwd(), options.root);

// =========================================================================
// Types
// =========================================================================

/**
 * @typedef {Object} IndexEntry
 * @property {number} precedence
 * @property {string} ind
 * @property {string} doc_type
 * @property {string} label
 * @property {string} tier
 * @property {string} filename
 */

// =========================================================================
// Doc-Type Extraction
// =========================================================================

/**
 * Extract the real document type code from a filename, stripping the record
 * ID prefix first.
 *
 * Pattern: {RECORD_ID}_{DOC_TYPE}-{slug}.ext
 *   e.g. "DP-00000_CHA-SOLOMON_DAO_LLC_Operating_Agreement.md" → "CHA"
 *        "DP-00000_LOG-governance.md" → "LOG"
 *
 * @param {string} filename
 * @param {string} record_id
 * @returns {string|null}
 */
function extractDocTypeFromFilename(filename, record_id) {
    const base = basename(filename);

    // Strip record ID prefix (e.g. "DP-00000_")
    const prefix = record_id + "_";
    if (!base.startsWith(prefix)) {
        return null;
    }
    const remainder = base.slice(prefix.length);

    // Match doc type code at start: "CHA-...", "LOG-...", "MEM-..."
    const match = remainder.match(/^([A-Z]{2,5})(?:-|_)/);
    return match ? match[1] : null;
}

// =========================================================================
// IND Generation
// =========================================================================

/**
 * Generate a stable, human-meaningful IND value for the index table.
 *
 * assembly.pack can legitimately contain multiple entries with the same
 * doc_type (e.g. multiple CHA docs). A plain "{record}-{type}-v{version}"
 * collides and isn't useful in an index, so we derive a suffix from the
 * filename slug.
 *
 * @param {string} record_id
 * @param {string} doc_type
 * @param {string} filename
 * @param {string | undefined | null} version
 * @returns {string}
 */
function generateIndForIndex(record_id, doc_type, filename, version) {
    const v = version ? `-v${version}` : "";

    const base = basename(filename);
    const dot = base.lastIndexOf(".");
    const baseNoExt = dot === -1 ? base : base.slice(0, dot);

    // Expected: {RECORD_ID}_{DOC_TYPE}-{slug}
    const recordPrefix = `${record_id}_`;
    let remainder = baseNoExt;
    if (remainder.startsWith(recordPrefix)) {
        remainder = remainder.slice(recordPrefix.length);
    }

    const dtPrefixDash = `${doc_type}-`;
    const dtPrefixUnderscore = `${doc_type}_`;
    if (remainder.startsWith(dtPrefixDash)) {
        remainder = remainder.slice(dtPrefixDash.length);
    } else if (remainder.startsWith(dtPrefixUnderscore)) {
        remainder = remainder.slice(dtPrefixUnderscore.length);
    }

    // If the remainder is just the doc_type itself (e.g. DP-00000_META.yaml),
    // don't duplicate it.
    if (remainder === doc_type) {
        remainder = "";
    }

    const suffix = remainder && remainder.length > 0 ? `-${remainder}` : "";
    return `${record_id}-${doc_type}${suffix}${v}`;
}

// =========================================================================
// Label Resolution
// =========================================================================

/**
 * Build a lookup from filename → label using the metafile's documents refs
 * and assembly.pack entries.
 *
 * @param {import("../lib/record-schema/Metafile.mjs").Metafile} meta
 * @returns {Map<string, string>}
 */
function buildLabelMap(meta) {
    /** @type {Map<string, string>} */
    const map = new Map();

    // 1. assembly.pack labels (highest quality - explicitly authored)
    const pack = meta.getAssemblyPack();
    for (let i = 0, len = pack.length; i < len; i++) {
        const entry = pack[i];
        if (
            entry &&
            typeof entry.path === "string" &&
            typeof entry.label === "string"
        ) {
            map.set(basename(entry.path), entry.label);
        }
    }

    // 2. documents tier labels (fill gaps)
    const tiers = /** @type {const} */ ([
        "primary",
        "secondary",
        "tertiary",
        "supplemental"
    ]);
    for (let t = 0; t < tiers.length; t++) {
        const refs = meta.getDocumentsByTier(tiers[t]);
        for (let i = 0, len = refs.length; i < len; i++) {
            const ref = refs[i];
            if (
                ref &&
                typeof ref === "object" &&
                typeof ref.path === "string" &&
                typeof ref.label === "string"
            ) {
                const key = basename(ref.path);
                if (!map.has(key)) {
                    map.set(key, ref.label);
                }
            }
        }
    }

    // 3. log
    const logDoc = meta.getDocuments()?.log;
    if (
        logDoc &&
        typeof logDoc === "object" &&
        typeof logDoc.path === "string" &&
        typeof logDoc.label === "string"
    ) {
        const key = basename(logDoc.path);
        if (!map.has(key)) {
            map.set(key, logDoc.label);
        }
    }

    // 4. index
    const indexDoc = meta.getDocuments()?.index;
    if (
        indexDoc &&
        typeof indexDoc === "object" &&
        typeof indexDoc.path === "string" &&
        typeof indexDoc.label === "string"
    ) {
        const key = basename(indexDoc.path);
        if (!map.has(key)) {
            map.set(key, indexDoc.label);
        }
    }

    return map;
}

/**
 * Build a lookup from filename → precedence from assembly.pack.
 * @param {import("../lib/record-schema/Metafile.mjs").Metafile} meta
 * @returns {Map<string, number>}
 */
function buildPrecedenceMap(meta) {
    /** @type {Map<string, number>} */
    const map = new Map();
    const pack = meta.getAssemblyPack();
    for (let i = 0, len = pack.length; i < len; i++) {
        const entry = pack[i];
        if (
            entry &&
            typeof entry.path === "string" &&
            typeof entry.precedence === "number"
        ) {
            map.set(basename(entry.path), entry.precedence);
        }
    }
    return map;
}

/**
 * Build a lookup from filename → doc_type from assembly.pack.
 * @param {import("../lib/record-schema/Metafile.mjs").Metafile} meta
 * @returns {Map<string, string>}
 */
function buildPackDocTypeMap(meta) {
    /** @type {Map<string, string>} */
    const map = new Map();
    const pack = meta.getAssemblyPack();
    for (let i = 0, len = pack.length; i < len; i++) {
        const entry = pack[i];
        if (
            entry &&
            typeof entry.path === "string" &&
            typeof entry.doc_type === "string"
        ) {
            map.set(basename(entry.path), entry.doc_type);
        }
    }
    return map;
}

// =========================================================================
// Tier Resolution
// =========================================================================

/**
 * Resolve which document tier a file belongs to from metafile refs.
 * @param {import("../lib/record-schema/Metafile.mjs").Metafile} meta
 * @param {string} filename
 * @returns {string}
 */
function resolveTier(meta, filename) {
    const tiers = /** @type {const} */ ([
        "primary",
        "secondary",
        "tertiary",
        "supplemental"
    ]);

    for (let t = 0; t < tiers.length; t++) {
        const refs = meta.getDocumentsByTier(tiers[t]);
        for (let i = 0, len = refs.length; i < len; i++) {
            const ref = refs[i];
            const refPath = typeof ref === "string" ? ref : ref?.path;
            if (typeof refPath === "string" && basename(refPath) === filename) {
                return tiers[t];
            }
        }
    }

    const logPath = meta.getLogDocumentPath();
    if (typeof logPath === "string" && basename(logPath) === filename) {
        return "log";
    }

    const indexPath = meta.getIndexDocumentPath();
    if (typeof indexPath === "string" && basename(indexPath) === filename) {
        return "index";
    }

    // Record metafile itself
    if (basename(meta.source_path || "") === filename) {
        return "meta";
    }

    return "-";
}

// =========================================================================
// Markdown Generation
// =========================================================================

/**
 * @param {IndexEntry[]} entries
 * @returns {string}
 */
function buildMarkdownTable(entries) {
    if (entries.length === 0) {
        return "_No documents found._\n";
    }

    /** @type {string[]} */
    const lines = [];

    lines.push("| # | Doc Type | Tier | Title | File |");
    lines.push("| -- | ---- | ---- | ----- | ---- |");

    for (let i = 0, len = entries.length; i < len; i++) {
        const e = entries[i];
        lines.push(
            `| ${e.precedence} | ${e.doc_type} | ${e.tier} | ${e.label} | \`${e.filename}\` |`
        );
    }

    return lines.join("\n") + "\n";
}

/**
 * @param {string} record_id
 * @param {string|undefined} title
 * @param {string|undefined} phase
 * @param {string|undefined} version
 * @param {string|undefined} entityName
 * @param {IndexEntry[]} entries
 * @returns {string}
 */
function buildIndexDocument(
    record_id,
    title,
    phase,
    version,
    entityName,
    entries
) {
    /** @type {string[]} */
    const parts = [];
    const generatedAt = new Date().toISOString();

    parts.push(`# ${record_id} - Document Index\n`);

    if (title) {
        parts.push(`> **${title}**`);
    }
    if (entityName) {
        parts.push(`> ${entityName}`);
    }

    parts.push("");

    parts.push(`**Documents:** ${entries.length}`);
    parts.push(`**Generated:** ${generatedAt}\n`);
    parts.push("---\n");

    parts.push(buildMarkdownTable(entries));

    parts.push("\n---\n");
    parts.push(
        `_This index was auto-generated by \`${SCRIPT_NAME}\`. Do not edit manually._\n`
    );

    return parts.join("\n") + "\n";
}

// =========================================================================
// Main
// =========================================================================

function run() {
    /** @type {Repository} */
    let repo;

    if (options["no-discovery"]) {
        repo = Repository.open(inputDir);
    } else {
        repo = Repository.openWithDiscovery(inputDir, {
            verbose: options.verbose
        });
        console.log(`Repository root: ${repo.root_dir}`);
    }

    if (!repo.hasTargetRecord()) {
        console.error(
            "Error: No target record detected. Point -r at a record directory (e.g. DP-00000-founding-instrument-pack)."
        );
        process.exit(1);
    }

    const verbose = options.verbose;

    // Select records (typically just the target)
    const records = repo.findRecordsWithTarget((r) => {
        if (
            options["record-filter"] &&
            !r.record_id.includes(options["record-filter"])
        ) {
            return false;
        }
        return true;
    });

    if (records.length === 0) {
        console.error("No records matched.");
        process.exit(1);
    }

    for (let ri = 0, rLen = records.length; ri < rLen; ri++) {
        const record = records[ri];
        const meta = record.metafile;

        if (!meta) {
            console.error(
                `Skipping ${record.record_id}: no ${record.record_id}_META.yaml found.`
            );
            continue;
        }

        const recordId = record.record_id;
        const title = meta.getTitle();
        const phase = meta.getPhase();
        const version = meta.getVersion();
        const entityName = meta.getEntityName();

        // Build lookups from metafile
        const labelMap = buildLabelMap(meta);
        const precedenceMap = buildPrecedenceMap(meta);
        const packDocTypeMap = buildPackDocTypeMap(meta);

        if (verbose) {
            console.log(`\n[VERBOSE] Record: ${recordId}`);
            console.log(`[VERBOSE]   labelMap entries: ${labelMap.size}`);
            console.log(
                `[VERBOSE]   precedenceMap entries: ${precedenceMap.size}`
            );
            console.log(
                `[VERBOSE]   packDocTypeMap entries: ${packDocTypeMap.size}`
            );
        }

        // Walk documents (used to discover any markdown docs not referenced in
        // assembly.pack; assembly.pack remains the authoritative ordering.)
        const docs = repo.findDocumentsInRecord(record, () => true);

        if (verbose) {
            console.log(`[VERBOSE]   Total docs found: ${docs.length}`);
        }

        /** @type {IndexEntry[]} */
        const entries = [];
        let fallbackPrecedence = 9000;

        /** @type {Set<string>} */
        const seenFilenames = new Set();

        // Always include the record metafile itself.
        const metaFilename = basename(
            meta.source_path || join(record.abs_path, `${recordId}_META.yaml`)
        );
        entries.push({
            precedence: 0,
            ind: generateIndForIndex(recordId, "META", metaFilename, version),
            doc_type: "META",
            label: "Record Metadata",
            tier: "meta",
            filename: metaFilename
        });
        seenFilenames.add(metaFilename);

        // Prefer authored ordering/labels from assembly.pack (includes the
        // IND-index file itself).
        const pack = meta.getAssemblyPack();
        for (let i = 0, len = pack.length; i < len; i++) {
            const p = pack[i];
            if (!p || typeof p.path !== "string") {
                continue;
            }

            const filename = basename(p.path);
            if (seenFilenames.has(filename)) {
                continue;
            }

            const docType =
                typeof p.doc_type === "string" && p.doc_type.length > 0
                    ? p.doc_type
                    : extractDocTypeFromFilename(filename, recordId) || "?";

            const precedence =
                typeof p.precedence === "number"
                    ? p.precedence
                    : precedenceMap.get(filename) ?? fallbackPrecedence++;

            const label =
                typeof p.label === "string" && p.label.length > 0
                    ? p.label
                    : labelMap.get(filename) || filename;

            const tier = resolveTier(meta, filename);

            entries.push({
                precedence,
                ind: generateIndForIndex(recordId, docType, filename, version),
                doc_type: docType,
                label,
                tier,
                filename
            });
            seenFilenames.add(filename);

            if (verbose) {
                console.log(
                    `[VERBOSE]   ${docType} | ${tier} | ${filename} (pack)`
                );
            }
        }

        // Append any markdown docs that exist in the record dir but are not
        // referenced in assembly.pack.
        for (let di = 0, dLen = docs.length; di < dLen; di++) {
            const doc = docs[di];
            if (!doc.isMarkdown()) {
                continue;
            }

            const filename = basename(doc.source_path);
            if (seenFilenames.has(filename)) {
                continue;
            }

            // 1. Resolve doc type: assembly.pack → filename parse
            let docType = packDocTypeMap.get(filename) || null;
            if (!docType) {
                docType = extractDocTypeFromFilename(filename, recordId);
            }
            if (!docType) {
                docType = "?";
            }

            // 2. Resolve IND
            const ind =
                docType !== "?"
                    ? generateIndForIndex(recordId, docType, filename, version)
                    : "";

            // 3. Resolve label
            const label = labelMap.get(filename) || filename;

            // 4. Resolve tier
            const tier = resolveTier(meta, filename);

            // 5. Resolve precedence
            let precedence = precedenceMap.get(filename);
            if (precedence === undefined) {
                precedence = fallbackPrecedence++;
            }

            entries.push({
                precedence,
                ind,
                doc_type: docType,
                label,
                tier,
                filename
            });
            seenFilenames.add(filename);

            if (verbose) {
                console.log(
                    `[VERBOSE]   ${docType} | ${tier} | ${filename} (extra)`
                );
            }
        }

        // Sort by precedence (then filename for stability)
        entries.sort((a, b) => {
            const d = a.precedence - b.precedence;
            if (d !== 0) {
                return d;
            }
            return a.filename.localeCompare(b.filename);
        });

        console.log(`${recordId}: ${entries.length} documents indexed.`);

        if (entries.length === 0) {
            console.log("No documents to index - skipping file write.");
            if (!verbose) {
                console.log("Hint: re-run with --verbose to diagnose.");
            }
            continue;
        }

        // Build markdown
        const markdown = buildIndexDocument(
            recordId,
            title,
            phase,
            version,
            entityName,
            entries
        );

        // Determine output path
        const outputPath = options.output
            ? resolve(process.cwd(), options.output)
            : join(record.abs_path, `${recordId}_IND-index.md`);

        if (existsSync(outputPath) && !options.overwrite) {
            console.log(`Exists: ${outputPath} (use --overwrite to replace)`);
            continue;
        }

        writeFileSync(outputPath, markdown, "utf8");
        console.log(`Written: ${outputPath}`);
    }
}

try {
    run();
} catch (err) {
    console.error(err);
    process.exit(1);
}
