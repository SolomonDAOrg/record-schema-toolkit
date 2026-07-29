#!/usr/bin/env node

import { resolve, join } from "node:path";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";

import { CLI } from "../lib/cli/cli.mjs";
import { Repository } from "../lib/record-schema/Repository.mjs";
import { RenderPack } from "../lib/record-schema/RenderPack.mjs";
import { Registry } from "../lib/record-schema/Registry.mjs";

import {
    createArticlePageBreakRule,
    createDocumentPipeline,
    createLegalKeepTogetherRule
} from "../lib/ast/pipelines/DocumentPipeline.mjs";
import { createTwoPassPdfRenderer } from "../lib/ast/renderers/TwoPassPdfRenderer.mjs";
import { parseMarkdownDoc } from "../lib/index.mjs";
import { convertMarkdownToDocument } from "../lib/ast/converters/MarkdownToAstConverter.mjs";

import { FilingPacketGenerator } from "../lib/record-schema/generators/FilingPacketGenerator.mjs";
import { IndManager } from "../lib/record-schema/IndManager.mjs";

const SCRIPT_NAME = "render";
const DESCRIPTION = "Render records to PDF using RenderPacks";

const schema = {
    flags: {
        verbose: {
            aliases: ["v"],
            description:
                "Verbose output: trace render pack, meta, cover, and rule resolution",
            default: false
        },
        packet: {
            aliases: ["pkt"],
            description: "Generate filing packets",
            default: false
        },
        overwrite: { description: "Overwrite existing files", default: false },
        "update-meta": {
            description: "Update META.yaml with packet hash",
            default: false
        },
        "exclude-ind": {
            description: "Exclude IND from PDF output",
            default: false
        },
        "generate-ind": {
            description: "Auto-generate IND and write to markdown files",
            default: false
        },
        "signing-page": {
            description:
                "Append a signing/execution page at the end (not counted in pagination). Uses signing_page from render pack packet_config",
            default: false
        },
        "ind-in-footer": {
            description: "Show IND in PDF footer (ignored if --exclude-ind)",
            default: false
        },
        "ind-in-header": {
            description: "Show IND in PDF header (ignored if --exclude-ind)",
            default: false
        },
        "no-discovery": {
            description: "Disable automatic repository root discovery",
            default: false
        },
        "disable-page-break-rules": {
            description: "Disable automatic page break rules",
            default: false
        },
        "no-watermark": {
            description: "Disable draft watermark on cover page",
            default: false
        },
        watermark: {
            description: "Enable draft watermark on cover page",
            default: false
        },
        "disable-soft-wrap": {
            description: "Disable soft wrap for markdown documents",
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
            description: "Output directory (default: {record}/pdf)",
            default: null,
            type: "string"
        },
        "render-pack": {
            description: "Render pack JSON path",
            default: null,
            type: "string"
        },
        "packet-name": {
            description:
                "Override packet filename (default: {RECORD_ID}_PKT-filing.pdf)",
            default: null,
            type: "string"
        },
        "record-filter": {
            description: "Filter by Record ID substring",
            default: null,
            type: "string"
        },
        "phase-filter": {
            description: "Filter by status.phase (comma-separated)",
            default: null,
            type: "array"
        },
        "doc-type-filter": {
            description: "Filter documents by doc type code (comma-separated)",
            default: null,
            type: "array"
        },
        author: {
            description: "Author name for PDF metadata",
            default: null,
            type: "string"
        },
        "cover-title": {
            description: "Override cover page title",
            default: null,
            type: "string"
        },
        "cover-entity": {
            description: "Override cover page entity name",
            default: null,
            type: "string"
        },
        "cover-subtitle": {
            description: "Override cover page subtitle",
            default: null,
            type: "string"
        },
        "cover-effective-date": {
            description: "Override cover page effective date (ISO format)",
            default: null,
            type: "string"
        },
        "cover-version": {
            description: "Override cover page version string",
            default: null,
            type: "string"
        },
        "cover-document-id": {
            description: "Override cover page document ID",
            default: null,
            type: "string"
        },
        "cover-confidentiality": {
            description: "Override cover page confidentiality notice",
            default: null,
            type: "string"
        },
        "cover-kind": {
            description:
                "Override document kind for cover template selection (e.g. master_agreement, company_agreement, generic)",
            default: null,
            type: "string"
        },
        "signing-witness-clause": {
            description: "Override witness clause text on signing page",
            default: null,
            type: "string"
        },
        "signing-parties": {
            description:
                'Override signing parties as JSON array, e.g. \'[{"label":"COMPANY:","signatories":[{"name":"Jane Doe","title":"CEO"}]}]\'',
            default: null,
            type: "string"
        },
        "watermark-text": {
            description: "Watermark text (default: DRAFT)",
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

function run() {
    // 1. Load Repository with discovery
    /** @type {Repository} */
    let repo;

    if (options["no-discovery"]) {
        // Legacy behavior: use directory as-is
        repo = Repository.open(inputDir);
    } else {
        // New behavior: discover repository root, detect record directory
        repo = Repository.openWithDiscovery(inputDir, {
            verbose: options.verbose
        });

        if (repo.hasTargetRecord()) {
            console.log(
                `Detected record directory: ${
                    repo.getTargetRecord()?.record_id
                }`
            );
        }
        console.log(`Repository root: ${repo.root_dir}`);

        const profile = repo.getProfile();
        if (profile && profile.source_path) {
            console.log(`Loaded profile: ${profile.source_path}`);
        }
    }

    // Attempt to load registry (assuming standard path or handled by repo in future)
    const registry = new Registry();

    const verbose = options.verbose;

    // 2. Load Render Pack — CLI flag overrides profile pack_paths
    /** @type {RenderPack} */
    let renderPack;
    if (options["render-pack"]) {
        renderPack = RenderPack.load(
            resolve(process.cwd(), options["render-pack"])
        );
        console.log(`Render pack (CLI): ${options["render-pack"]}`);
    } else {
        const profile = repo.getProfile();
        const packPaths = profile ? profile.getPackPaths() : [];

        if (verbose) {
            console.log(`\n[VERBOSE] === Profile / Pack Path Discovery ===`);
            console.log(
                `[VERBOSE] profile loaded: ${!!profile}${
                    profile?.source_path ? " (" + profile.source_path + ")" : ""
                }`
            );
            console.log(
                `[VERBOSE] profile.getPackPaths() returned: ${packPaths.length} entries`
            );
            for (let pi = 0, plen = packPaths.length; pi < plen; pi++) {
                const pe = packPaths[pi];
                console.log(`[VERBOSE]   [${pi}] ${JSON.stringify(pe)}`);
            }
        }

        // Priority 1: Repo already hydrated render packs (from discovery or toolkit fallback)
        if (repo.getRenderPolicy() || repo.getPacketConfig()) {
            renderPack = new RenderPack(
                {
                    schema: "record-schema-render-pack",
                    schema_version: 1,
                    pack_id: "discovery-merged",
                    document_policies: repo.getRenderPolicy() || {},
                    packet_config: repo.getPacketConfig() || undefined
                },
                null
            );
            if (verbose) {
                console.log(
                    `[VERBOSE] render pack (discovery-hydrated): has policy=${!!repo.getRenderPolicy()} has packet_config=${!!repo.getPacketConfig()}`
                );
            }
            console.log(`Render pack (discovery)`);
        } else {
            // Priority 2: Profile pack paths (resolved relative to repo root)
            /** @type {string[]} */
            const renderPackPaths = [];
            for (let i = 0, len = packPaths.length; i < len; i++) {
                const entry = packPaths[i];
                if (
                    entry &&
                    typeof entry === "object" &&
                    entry !== null &&
                    entry &&
                    /** @type {Object} **/ (entry).type === "render"
                ) {
                    const p = /** @type {Object} **/ (entry).path;
                    // Resolve relative to repo root; skip if not found
                    if (existsSync(resolve(repo.root_dir, p))) {
                        renderPackPaths.push(p);
                    } else if (verbose) {
                        console.log(
                            `[VERBOSE] render pack path not found in repo: ${p} (${resolve(
                                repo.root_dir,
                                p
                            )})`
                        );
                    }
                }
            }

            if (verbose) {
                console.log(
                    `[VERBOSE] render pack paths (type=render, in repo): ${
                        renderPackPaths.length > 0
                            ? renderPackPaths.join(", ")
                            : "(none)"
                    }`
                );
            }

            if (renderPackPaths.length > 0) {
                const result = RenderPack.loadMerged(
                    repo.root_dir,
                    renderPackPaths
                );
                renderPack = new RenderPack(
                    {
                        schema: "record-schema-render-pack",
                        schema_version: 1,
                        pack_id: "profile-merged",
                        document_policies: result.policy,
                        packet_config: result.packet_config
                    },
                    null
                );
                console.log(
                    `Render pack (profile): ${renderPackPaths.join(", ")}`
                );
            } else {
                // Priority 3: Empty
                renderPack = RenderPack.empty("default");
            }
        }
    }

    if (verbose) {
        console.log(`\n[VERBOSE] === Render Pack Resolution ===`);
        console.log(`[VERBOSE] pack_id: ${renderPack.data.pack_id}`);
        console.log(`[VERBOSE] schema: ${renderPack.data.schema}`);
        console.log(
            `[VERBOSE] has packet_config: ${!!renderPack.data.packet_config}`
        );
        if (renderPack.data.packet_config) {
            const pc = renderPack.data.packet_config;
            console.log(
                `[VERBOSE]   default_entity_name: ${
                    pc.default_entity_name ?? "(unset)"
                }`
            );
            console.log(
                `[VERBOSE]   default_document_title: ${
                    pc.default_document_title ?? "(unset)"
                }`
            );
            console.log(
                `[VERBOSE]   header_text: ${pc.header_text ?? "(unset)"}`
            );
            console.log(
                `[VERBOSE]   header_title_format: ${
                    pc.header_title_format ?? "(unset)"
                }`
            );
            console.log(
                `[VERBOSE]   section_page_break: ${
                    pc.section_page_break ?? "(unset)"
                }`
            );
            console.log(
                `[VERBOSE]   cover_templates keys: ${
                    pc.cover_templates
                        ? Object.keys(pc.cover_templates).join(", ") ||
                          "(empty)"
                        : "(unset)"
                }`
            );
            console.log(
                `[VERBOSE]   cover_config: ${
                    pc.cover_config
                        ? JSON.stringify(pc.cover_config)
                        : "(unset)"
                }`
            );
            console.log(
                `[VERBOSE]   entity_extraction: ${
                    pc.entity_extraction
                        ? JSON.stringify(pc.entity_extraction)
                        : "(unset)"
                }`
            );
            console.log(
                `[VERBOSE]   path_to_title keys: ${
                    pc.path_to_title
                        ? Object.keys(pc.path_to_title).join(", ") || "(empty)"
                        : "(unset)"
                }`
            );
            console.log(
                `[VERBOSE]   name_patterns: ${
                    pc.name_patterns
                        ? JSON.stringify(pc.name_patterns)
                        : "(unset)"
                }`
            );
            console.log(
                `[VERBOSE]   document_kind_default: ${
                    pc.document_kind_default ?? "(unset)"
                }`
            );
            console.log(
                `[VERBOSE]   document_kind_map: ${
                    pc.document_kind_map
                        ? JSON.stringify(pc.document_kind_map)
                        : "(unset)"
                }`
            );
        }
        const dp = renderPack.data.document_policies;
        if (dp) {
            console.log(`[VERBOSE] has document_policies: true`);
            console.log(
                `[VERBOSE]   defaults: ${
                    dp.defaults ? JSON.stringify(dp.defaults) : "(unset)"
                }`
            );
            console.log(
                `[VERBOSE]   targets: ${
                    dp.targets ? Object.keys(dp.targets).join(", ") : "(unset)"
                }`
            );
            console.log(
                `[VERBOSE]   render_profiles: ${
                    dp.render_profiles
                        ? Object.keys(dp.render_profiles).join(", ")
                        : "(unset)"
                }`
            );
            console.log(
                `[VERBOSE]   rulesets: ${
                    dp.rulesets ? dp.rulesets.length + " rules" : "(unset)"
                }`
            );
            if (dp.rulesets) {
                for (let ri = 0, rlen = dp.rulesets.length; ri < rlen; ri++) {
                    const rs = dp.rulesets[ri];
                    console.log(
                        `[VERBOSE]     [${ri}] id=${
                            rs.id
                        } selectors=${JSON.stringify(
                            rs.selectors
                        )} render=${JSON.stringify(rs.render)}`
                    );
                }
            }
            console.log(
                `[VERBOSE]   spacing_policy: ${
                    dp.spacing_policy ? "present" : "(unset)"
                }`
            );
        }
    }

    // Initialize Services
    const indManager = new IndManager(registry);
    const packetGenerator = new FilingPacketGenerator(
        repo,
        indManager,
        renderPack,
        verbose,
        Boolean(options["render-pack"])
    );

    // 3. Select Records with Predicate
    // Use findRecordsWithTarget to prioritize target record if we started from record dir
    const phaseFilter = options["phase-filter"];
    const records = repo.findRecordsWithTarget((r) => {
        // ID Filter
        if (
            options["record-filter"] &&
            !r.record_id.includes(options["record-filter"])
        ) {
            return false;
        }
        // Phase Filter
        if (phaseFilter && phaseFilter.length > 0) {
            const phase = r.metafile ? r.metafile.getPhase() : null;
            if (!phase || !phaseFilter.includes(phase)) {
                return false;
            }
        }
        return true;
    });

    console.log(`Found ${records.length} records to process.`);

    if (records.length === 0) {
        console.log("No records found. Check:");
        console.log("  - Directory contains *_META.yaml file");
        console.log("  - Directory name matches pattern: XX-NNNNN-slug");
        console.log("  - Profile buckets are configured correctly");
        return;
    }

    // 4. Render Loop
    for (let i = 0; i < records.length; i++) {
        const record = records[i];

        // ---------------------------------------------------------
        // A. Filing Packet Generation
        // ---------------------------------------------------------
        if (options.packet) {
            console.log(`Generating packet for ${record.record_id}...`);

            if (verbose) {
                console.log(`[VERBOSE] === Record: ${record.record_id} ===`);
                console.log(`[VERBOSE] abs_path: ${record.abs_path}`);
                console.log(`[VERBOSE] rel_path: ${record.rel_path}`);
                console.log(`[VERBOSE] dir_name: ${record.dir_name}`);
                console.log(`[VERBOSE] has metafile: ${!!record.metafile}`);
                if (record.metafile) {
                    const md = record.metafile.data;
                    console.log(`[VERBOSE] meta.id: ${md.id ?? "(unset)"}`);
                    console.log(
                        `[VERBOSE] meta.series_code: ${
                            md.series_code ?? "(unset)"
                        }`
                    );
                    console.log(
                        `[VERBOSE] meta.extensions: ${
                            md.extensions
                                ? JSON.stringify(Object.keys(md.extensions))
                                : "(unset)"
                        }`
                    );
                    if (md.extensions) {
                        console.log(
                            `[VERBOSE] meta.extensions.formatting: ${
                                md.extensions.formatting
                                    ? JSON.stringify(md.extensions.formatting)
                                    : "(unset)"
                            }`
                        );
                        console.log(
                            `[VERBOSE] meta.extensions.dao_proposals: ${
                                md.extensions.dao_proposals
                                    ? "present"
                                    : "(unset)"
                            }`
                        );
                    }
                    console.log(
                        `[VERBOSE] meta.documents.primary: ${
                            md.documents?.primary
                                ? md.documents.primary.length + " entries"
                                : "(unset)"
                        }`
                    );
                    console.log(
                        `[VERBOSE] meta.assembly.pack: ${
                            md.assembly?.pack
                                ? md.assembly.pack.length + " entries"
                                : "(unset)"
                        }`
                    );
                    console.log(
                        `[VERBOSE] meta.timeline: ${
                            md.timeline
                                ? JSON.stringify(md.timeline)
                                : "(unset)"
                        }`
                    );
                }
            }

            // Build signing page override config from CLI args
            const signingPageConfig = (() => {
                const witnessClause =
                    options["signing-witness-clause"] || undefined;
                const partiesJson = options["signing-parties"];

                if (!witnessClause && !partiesJson) {
                    return undefined;
                }

                /** @type {any} */
                const cfg = {};

                if (witnessClause) {
                    cfg.witnessClause = witnessClause;
                }

                if (partiesJson) {
                    try {
                        const parsed = JSON.parse(partiesJson);
                        if (Array.isArray(parsed) && parsed.length > 0) {
                            cfg.parties = parsed;
                        }
                    } catch (parseErr) {
                        console.error(
                            `  [WARN] Failed to parse --signing-parties JSON: ${parseErr.message}`
                        );
                    }
                }

                return Object.keys(cfg).length > 0 ? cfg : undefined;
            })();

            const result = packetGenerator.generate(record, {
                exclude_ind: options["exclude-ind"],
                ind_in_footer: options["ind-in-footer"],
                ind_in_header: options["ind-in-header"],
                overwrite: options.overwrite,
                packet_name: options["packet-name"],
                author: options.author,
                signing_page: options["signing-page"],
                signing_page_config: signingPageConfig,
                cover_overrides: {
                    title: options["cover-title"] || undefined,
                    entity_name: options["cover-entity"] || undefined,
                    subtitle: options["cover-subtitle"] || undefined,
                    effective_date:
                        options["cover-effective-date"] || undefined,
                    version: options["cover-version"] || undefined,
                    document_id: options["cover-document-id"] || undefined,
                    confidentiality:
                        options["cover-confidentiality"] || undefined,
                    document_kind: options["cover-kind"] || undefined,
                    noWatermark: options["no-watermark"] === true,
                    watermark: options["watermark"] === true,
                    watermark_text:
                        options["watermark"] === true
                            ? options["watermark-text"] ?? "DRAFT"
                            : undefined
                },
                disable_page_break_rules:
                    options["disable-page-break-rules"] === true,
                disable_soft_wrap: options["disable-soft_wrap"] === true
            });

            if (result.success) {
                console.log(`  Success: ${result.rel_path}`);
                if (options["update-meta"] && record.metafile) {
                    record.metafile.updatePacketInfo(
                        result.rel_path,
                        result.hash
                    );
                    try {
                        record.metafile.save();
                        console.log(`  Updated META.yaml`);
                    } catch (err) {
                        console.error(
                            `  Failed to update META.yaml: ${err.message}`
                        );
                    }
                }
            } else {
                console.error(`  Failed: ${result.error}`, result);
            }
            continue; // Skip individual docs if only generating packet (optional behavior)
        }

        // ---------------------------------------------------------
        // B. Individual Documents
        // ---------------------------------------------------------
        const outputDir = options.output
            ? join(options.output, record.dir_name)
            : join(record.abs_path, "pdf");

        mkdirSync(outputDir, { recursive: true });

        // Filter Documents with Predicate
        const doc_typeFilter = options["doc-type-filter"];

        const docs = repo.findDocumentsInRecord(record, (doc) => {
            if (doc_typeFilter && doc_typeFilter.length > 0) {
                const fileInfo = doc.getFileInfo();
                if (
                    !fileInfo.doc_type ||
                    !doc_typeFilter.includes(fileInfo.doc_type)
                ) {
                    return false;
                }
            }
            return true;
        });

        for (const doc of docs) {
            if (!doc.isMarkdown()) continue;

            const fileInfo = doc.getFileInfo();
            const rel_path = repo.getRelativePath(doc.source_path);

            // --- 1. Generate IND (Parity Feature) ---
            if (options["generate-ind"]) {
                const ind = indManager.generateInd(
                    record.record_id,
                    fileInfo.doc_type,
                    // Version handling would ideally come from doc metadata or repo state
                    // For now, defaulting to null/current as per old script behavior
                    null
                );

                const changed = indManager.applyIndToPath(doc.source_path, ind);
                if (changed) {
                    console.log(`  [IND] Updated ${rel_path} with ID: ${ind}`);
                    // Reload doc content if we are going to render it immediately
                    doc.reload();
                }
            }

            // --- 2. Configure Renderer ---
            const config = renderPack.resolveForFile({
                rel_path: rel_path,
                doc_type: fileInfo.doc_type,
                ext: fileInfo.ext
            });

            if (verbose) {
                console.log(`[VERBOSE] --- Resolve for ${rel_path} ---`);
                console.log(
                    `[VERBOSE]   doc_type=${fileInfo.doc_type} ext=${fileInfo.ext}`
                );
                console.log(
                    `[VERBOSE]   resolved config: ${
                        config
                            ? JSON.stringify({
                                  base_font_size: config.base_font_size,
                                  line_spacing: config.line_spacing,
                                  margins: config.margins,
                                  horizontal_rule: config.horizontal_rule
                              })
                            : "(null)"
                    }`
                );
            }

            // Extract Metadata
            const metadata = doc.getMetadata() ? doc.getMetadata().data : {};

            const pipeline = createDocumentPipeline().addFormattingRules([
                createLegalKeepTogetherRule(),
                createArticlePageBreakRule()
            ]);
            const renderer = createTwoPassPdfRenderer({
                pageConfig: config?.margins ? { margins: config.margins } : {},
                baseFontSize: config?.base_font_size || 10,
                horizontalRule: { behavior: "rule" },
                verbose: verbose,
                metadata: {
                    title: `${record.record_id} — ${
                        metadata.Title || fileInfo.base_name
                    }`,
                    author: options.author || metadata.Author || "",
                    subject: `${record.record_id} ${
                        fileInfo.doc_type || ""
                    }`.trim(),
                    creator: "Solomon DAO - Record Schema",
                    producer: "Solomon DAO - Record Render"
                }
            });

            pipeline.setRenderer(renderer);

            // --- 3. Inject PDF Metadata (Parity Feature) ---
            const renderMetadata = {
                ...metadata,
                Title: metadata.Title || fileInfo.base_name,
                Author: options.author || metadata.Author,
                Subject: `${record.record_id} ${fileInfo.doc_type}`,
                Producer: "Solomon DAO - Record Render"
            };

            console.log(`Rendering: ${rel_path}`);

            const ast = convertMarkdownToDocument(
                parseMarkdownDoc(
                    doc.text,
                    options["disable-soft-wrap"] === true
                        ? undefined
                        : { softWrap: true }
                )
            );

            const result = pipeline.processSingle({
                id: fileInfo.record_id || "UNKNOWN",
                name: renderMetadata.Title,
                root: ast.root,
                metadata: renderMetadata
            });

            if (result.success && result.renderResult?.output) {
                const outPath = join(outputDir, fileInfo.base_name + ".pdf");

                if (!options.overwrite && existsSync(outPath)) {
                    console.log("  Skipping (exists)");
                    continue;
                }

                writeFileSync(outPath, result.renderResult.output);
            } else {
                console.error(`Failed to render ${rel_path}`);
            }
        }
    }
}

try {
    run();
} catch (err) {
    console.error(err);
    process.exit(1);
}
