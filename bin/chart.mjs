#!/usr/bin/env node

import { resolve, join, basename, dirname, extname } from "node:path";
import {
    writeFileSync,
    mkdirSync,
    existsSync,
    readdirSync,
    statSync
} from "node:fs";

import { CLI } from "../lib/cli/cli.mjs";
import { Chart } from "../lib/record-schema/Chart.mjs";
import { RenderPack } from "../lib/record-schema/RenderPack.mjs";

import {
    ChartRenderPackAdapter,
    ChartToAstConverter,
    ChartSvgRenderer,
    ChartAsciiRenderer,
    ChartMermaidRenderer
} from "../lib/ast/index.mjs";

/**
 * @typedef {import("../lib/ast/renderers/chart/BaseChartRenderer.mjs").BaseChartRenderer} BaseChartRenderer
 */

// =============================================================================
// Helpers
// =============================================================================

/**
 * Check if path is a chart file
 * @param {string} filePath
 * @returns {boolean}
 */
function isChartFile(filePath) {
    const lower = filePath.toLowerCase();
    return (
        lower.endsWith(".chart.yaml") ||
        lower.endsWith(".chart.yml") ||
        lower.endsWith(".chart.json")
    );
}

/**
 * Find chart files in directory
 * @param {string} dir
 * @param {boolean} recursive
 * @returns {string[]}
 */
function findChartFiles(dir, recursive) {
    /** @type {string[]} */
    const results = [];

    const entries = readdirSync(dir);
    for (let i = 0, len = entries.length; i < len; i++) {
        const entry = entries[i];
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);

        if (stat.isFile() && isChartFile(entry)) {
            results.push(fullPath);
        } else if (stat.isDirectory() && recursive && !entry.startsWith(".")) {
            const nested = findChartFiles(fullPath, recursive);
            for (let j = 0, jlen = nested.length; j < jlen; j++) {
                results.push(nested[j]);
            }
        }
    }

    return results;
}

/**
 * Get output filename for a chart file
 * @param {string} chartPath
 * @param {string} format
 * @param {string | null} outputDir
 * @returns {string}
 */
function getOutputPath(chartPath, format, outputDir) {
    const dir = outputDir || dirname(chartPath);
    let base = basename(chartPath);

    // Remove .chart.yaml/.chart.json extension
    base = base.replace(/\.chart\.(yaml|yml|json)$/i, "");

    const ext = format === "mermaid" ? ".mmd" : `.${format}`;
    return join(dir, base + ext);
}

/**
 * Attempt to resolve render pack paths from the chart document itself.
 * Supported keys (any level): renderPack, render_pack, renderPacks, render_packs
 * Also accepts nested objects like { render: { pack: "..." } }.
 *
 * @param {Chart} chart
 * @param {string} chartPath
 * @returns {string[]}
 */
function getRenderPackPathsFromChart(chart, chartPath) {
    /** @type {string[]} */
    const out = [];

    const pushAny = (v) => {
        if (!v) return;
        if (typeof v === "string") {
            out.push(v);
            return;
        }
        if (Array.isArray(v)) {
            for (let i = 0; i < v.length; i++) {
                if (typeof v[i] === "string") out.push(v[i]);
                else if (
                    v[i] &&
                    typeof v[i] === "object" &&
                    typeof v[i].path === "string"
                )
                    out.push(v[i].path);
            }
            return;
        }
        if (typeof v === "object" && typeof v.path === "string") {
            out.push(v.path);
        }
    };

    /** @type {any} */
    const raw = /** @type {any} */ (chart).data || chart;

    // Common top-level keys
    if (raw && typeof raw === "object") {
        pushAny(raw.renderPack);
        pushAny(raw.render_pack);
        pushAny(raw.renderPacks);
        pushAny(raw.render_packs);

        if (raw.render && typeof raw.render === "object") {
            pushAny(raw.render.pack);
            pushAny(raw.render.packs);
            pushAny(raw.render.renderPack);
            pushAny(raw.render.render_pack);
        }
        if (
            raw.document_policies &&
            typeof raw.document_policies === "object"
        ) {
            pushAny(raw.document_policies.renderPack);
            pushAny(raw.document_policies.render_pack);
            pushAny(raw.document_policies.renderPacks);
            pushAny(raw.document_policies.render_packs);
        }

        // Fallback: shallow scan for keys that look like render-pack declarations
        const seen = new Set();
        /** @type {any[]} */
        const stack = [raw];
        while (stack.length) {
            const cur = stack.pop();
            if (!cur || typeof cur !== "object") continue;
            if (seen.has(cur)) continue;
            seen.add(cur);

            for (const k of Object.keys(cur)) {
                const v = cur[k];
                if (/^render[_-]?packs?$/i.test(k)) pushAny(v);
                if (k === "render" && v && typeof v === "object") stack.push(v);
            }
        }
    }

    // Dedupe + resolve relative paths against chart location
    const chartDir = dirname(chartPath);
    /** @type {string[]} */
    const resolved = [];
    /** @type {Set<string>} */
    const seenPath = new Set();
    for (let i = 0; i < out.length; i++) {
        const p = out[i];
        const abs =
            p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)
                ? p
                : resolve(chartDir, p);
        if (seenPath.has(abs)) continue;
        seenPath.add(abs);
        resolved.push(abs);
    }

    return resolved;
}

/**
 * Load one or more render packs and build an adapter.
 * @param {string[]} packPaths
 * @returns {ChartRenderPackAdapter}
 */
function loadRenderPackAdapter(packPaths) {
    /** @type {any[]} */
    const packs = [];
    for (let i = 0; i < packPaths.length; i++) {
        const pack = RenderPack.load(packPaths[i]);
        packs.push(pack.data);
    }
    return new ChartRenderPackAdapter(packs);
}

/**
 * Get renderer for format
 * @param {string} format
 * @param {ChartRenderPackAdapter | undefined} adapter
 * @returns {BaseChartRenderer}
 */
function getRenderer(format, adapter) {
    switch (format) {
        case "ascii":
            return new ChartAsciiRenderer(adapter);
        case "mermaid":
            return new ChartMermaidRenderer(adapter);
        case "svg":
        default:
            return new ChartSvgRenderer(adapter);
    }
}

/**
 * Render a single chart file
 * @param {string} chartPath
 * @param {Object} opts
 * @param {string} opts.format
 * @param {string | null} opts.outputDir
 * @param {ChartRenderPackAdapter | undefined} opts.adapter
 * @param {boolean} opts.overwrite
 * @param {boolean} opts.stdout
 * @param {boolean} opts.verbose
 * @param {boolean} opts.validate
 * @param {Object} opts.renderOptions
 * @returns {{ success: boolean, outputPath?: string, error?: string, stack?: unknown }}
 */
function renderChart(chartPath, opts) {
    const {
        format,
        outputDir,
        adapter,
        overwrite,
        stdout,
        verbose,
        validate,
        renderOptions
    } = opts;

    // Load chart
    /** @type {Chart} */
    let chart;
    try {
        chart = Chart.load(chartPath);
    } catch (err) {
        return {
            success: false,
            error: `Failed to load: ${err.message}`,
            stack: err.stack
        };
    }

    // Validate
    const issues = chart.validate();
    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warning");

    if (verbose && warnings.length > 0) {
        for (let i = 0, len = warnings.length; i < len; i++) {
            console.warn(`  Warning: ${warnings[i].message}`);
        }
    }

    if (errors.length > 0) {
        const msgs = errors.map((e) => e.message).join("; ");
        return { success: false, error: `Validation failed: ${msgs}` };
    }

    if (validate) {
        return { success: true };
    }

    // Convert to AST
    const converter = new ChartToAstConverter();
    const document = converter.convert(chart);

    const chartWarnings = converter.getWarnings();

    if (warnings.length > 0 && verbose) {
        for (let i = 0, len = chartWarnings.length; i < len; i++) {
            console.warn(`  Converter warning: ${chartWarnings[i]}`);
        }
    }

    // Render
    /** @type {ChartRenderPackAdapter | undefined} */
    let effectiveAdapter = adapter;

    if (!effectiveAdapter) {
        const packPaths = getRenderPackPathsFromChart(chart, chartPath);
        if (packPaths.length) {
            try {
                effectiveAdapter = loadRenderPackAdapter(packPaths);
                if (verbose) {
                    console.warn(
                        `  Render warning: render packs count=${packPaths.length} (from chart)`
                    );
                    for (let i = 0; i < packPaths.length; i++) {
                        console.warn(
                            `  Render warning: render pack[${i}] ${packPaths[i]}`
                        );
                    }
                }
            } catch (err) {
                if (verbose) {
                    console.warn(
                        `  Render warning: failed to load render packs from chart (${err.message})`
                    );
                }
            }
        } else if (verbose) {
            console.warn(`  Render warning: render packs count=0 (no adapter)`);
        }
    } else if (verbose) {
        // Try to print adapter themes for triage
        const themes =
            typeof effectiveAdapter.getThemeNames === "function"
                ? effectiveAdapter.getThemeNames()
                : [];
        console.warn(
            `  Render warning: render packs count=${
                effectiveAdapter.packs?.length ?? 1
            } theme=${renderOptions.theme || "default"} themes=[${themes.join(
                ", "
            )}]`
        );
    }

    const renderer = getRenderer(format, effectiveAdapter);
    const result = renderer.render(document, renderOptions);

    if (!result.success) {
        const errMsg =
            result.errors.length > 0
                ? result.errors.join("; ")
                : "Unknown render error";
        return { success: false, error: errMsg, stack: result.stack };
    }

    if (result.warnings.length > 0 && verbose) {
        for (let i = 0, len = result.warnings.length; i < len; i++) {
            console.warn(`  Render warning: ${result.warnings[i]}`);
        }
    }

    // Output
    if (stdout) {
        if (typeof result.output === "string") {
            process.stdout.write(result.output);
        } else if (result.output instanceof Uint8Array) {
            process.stdout.write(Buffer.from(result.output));
        }
        return { success: true };
    }

    const outputPath = getOutputPath(chartPath, format, outputDir);

    if (!overwrite && existsSync(outputPath)) {
        return {
            success: false,
            error: `Output exists (use --overwrite): ${outputPath}`
        };
    }

    // Ensure output directory exists
    const outDir = dirname(outputPath);
    if (!existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true });
    }

    if (typeof result.output === "string") {
        writeFileSync(outputPath, result.output, "utf8");
    } else if (result.output instanceof Uint8Array) {
        writeFileSync(outputPath, result.output);
    }

    return { success: true, outputPath };
}

// =============================================================================
// Main
// =============================================================================

function main() {
    const cliOptions = {
        scriptName: "chart",
        description:
            "Render chart files (.chart.yaml, .chart.json) to SVG, ASCII, or Mermaid",
        schema: {
            flags: {
                overwrite: {
                    aliases: ["f"],
                    description: "Overwrite existing files",
                    default: false
                },
                recursive: {
                    aliases: ["R"],
                    description:
                        "Recursively find chart files in subdirectories",
                    default: false
                },
                stdout: {
                    description:
                        "Output to stdout instead of files (single file only)",
                    default: false
                },
                validate: {
                    description: "Validate chart files without rendering",
                    default: false
                },
                verbose: {
                    aliases: ["v"],
                    description: "Verbose output",
                    default: false
                }
            },
            values: {
                input: {
                    aliases: ["i"],
                    description: "Input chart file or directory",
                    type: "string"
                },
                output: {
                    aliases: ["o"],
                    description: "Output directory (default: same as input)",
                    default: null,
                    type: "string"
                },
                format: {
                    aliases: ["F"],
                    description: "Output format: svg, ascii, mermaid, all",
                    default: "svg",
                    type: "string"
                },
                theme: {
                    aliases: ["t"],
                    description: "Theme name from render pack",
                    default: "default",
                    type: "string"
                },
                "render-pack": {
                    aliases: ["p"],
                    description: "Render pack JSON path for styling",
                    default: null,
                    type: "string"
                },
                scale: {
                    description: "Scale factor for SVG output",
                    default: "1",
                    type: "string"
                },
                padding: {
                    description: "Padding around chart (pixels)",
                    default: "20",
                    type: "string"
                },
                background: {
                    aliases: ["bg"],
                    description:
                        "Background color (e.g., #ffffff, transparent)",
                    default: null,
                    type: "string"
                },
                "max-width": {
                    description: "Maximum width for ASCII output",
                    default: "120",
                    type: "string"
                },
                "box-chars": {
                    description:
                        "Box character style for ASCII: unicode, ascii",
                    default: "unicode",
                    type: "string"
                }
            }
        }
    };

    const options = CLI.handleCLI(cliOptions);

    if (!options.input) {
        CLI.printHelp(cliOptions);
        process.exit(0);
    }

    const inputPath = resolve(process.cwd(), options.input);
    const outputDir = options.output
        ? resolve(process.cwd(), options.output)
        : null;

    // Load render pack if specified
    /** @type {ChartRenderPackAdapter | undefined} */
    let adapter;
    if (options["render-pack"]) {
        try {
            const pack = RenderPack.load(options["render-pack"]);
            adapter = new ChartRenderPackAdapter(pack.data);
            if (options.verbose) {
                console.log(`Loaded render pack: ${options["render-pack"]}`);
            }
        } catch (err) {
            console.error(`Failed to load render pack: ${err.message}`);
            process.exit(1);
        }
    }

    // Build render options
    const renderOptions = {
        theme: options.theme,
        scale: parseFloat(options.scale) || 1,
        padding: parseInt(options.padding, 10) || 20,
        background: options.background || undefined,
        maxWidth: parseInt(options["max-width"], 10) || 120,
        boxChars: /** @type {"unicode" | "ascii"} */ (options["box-chars"]),
        debug: options.verbose,
        debugNodeLimit: options.verbose ? 40 : 0,
        debugMaxMessages: options.verbose ? 200 : 0,
        debugMaxOverlaps: options.verbose ? 50 : 0
    };

    // Determine formats to render
    /** @type {string[]} */
    let formats;
    if (options.format === "all") {
        formats = ["svg", "ascii", "mermaid"];
    } else {
        formats = [options.format];
    }

    // Find chart files
    /** @type {string[]} */
    let chartFiles;
    const stat = statSync(inputPath);

    if (stat.isFile()) {
        if (!isChartFile(inputPath)) {
            console.error(`Not a chart file: ${inputPath}`);
            process.exit(1);
        }
        chartFiles = [inputPath];
    } else if (stat.isDirectory()) {
        chartFiles = findChartFiles(inputPath, options.recursive);
    } else {
        console.error(`Invalid input: ${inputPath}`);
        process.exit(1);
    }

    if (chartFiles.length === 0) {
        console.log("No chart files found.");
        console.log(
            "Chart files must have extension: .chart.yaml, .chart.yml, or .chart.json"
        );
        return;
    }

    if (options.stdout && (chartFiles.length > 1 || formats.length > 1)) {
        console.error(
            "--stdout can only be used with a single file and single format"
        );
        process.exit(1);
    }

    console.log(`Found ${chartFiles.length} chart file(s) to process.`);

    // Process each chart file
    let successCount = 0;
    let failCount = 0;

    for (let i = 0, len = chartFiles.length; i < len; i++) {
        const chartPath = chartFiles[i];
        const rel_path = chartPath.startsWith(process.cwd())
            ? chartPath.slice(process.cwd().length + 1)
            : chartPath;

        if (!options.stdout) {
            console.log(`Processing: ${rel_path}`);
        }

        for (let j = 0, jlen = formats.length; j < jlen; j++) {
            const format = formats[j];

            const result = renderChart(chartPath, {
                format,
                outputDir,
                adapter,
                overwrite: options.overwrite,
                stdout: options.stdout,
                verbose: options.verbose,
                validate: options.validate,
                renderOptions
            });

            if (result.success) {
                successCount++;
                if (!options.stdout && !options.validate) {
                    const outRel = result.outputPath?.startsWith(process.cwd())
                        ? result.outputPath.slice(process.cwd().length + 1)
                        : result.outputPath;
                    console.log(`  [${format.toUpperCase()}] ${outRel}`);
                } else if (options.validate) {
                    console.log(`  Valid`);
                }
            } else {
                failCount++;
                console.error(
                    `  [${format.toUpperCase()}] Error: ${result.error}${
                        result.stack ? "\n" + String(result.stack) : ""
                    }`
                );
            }
        }
    }

    // Summary
    if (!options.stdout) {
        console.log(
            `\nComplete: ${successCount} succeeded, ${failCount} failed`
        );
    }

    if (failCount > 0) {
        process.exit(1);
    }
}

try {
    main();
} catch (err) {
    console.error(err);
    process.exit(1);
}
