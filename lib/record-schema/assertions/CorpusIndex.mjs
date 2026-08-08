/**
 * Corpus index for assertions.
 *
 * A source is a named set of files, and a unit is one file with the bindings a
 * rule can join on: the repository-relative path, the record and series the
 * path places it in, the document type its name declares, the schema id its
 * body declares, and the parsed body itself. Rules never touch the filesystem;
 * they see units.
 *
 * Parsing happens once per file no matter how many sources select it, because
 * a corpus of five hundred documents is read by a hundred rules and re-reading
 * it per rule turns a linear gate into a quadratic one.
 *
 * @module record-schema/assertions/CorpusIndex
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parseYaml } from "../../parsing/yaml.mjs";
import { parseMarkdownForAssertions } from "./MarkdownCorpusParser.mjs";
import { matchGlob } from "../../util/glob.mjs";
import { isPlainObject } from "./Path.mjs";

/** @typedef {import("./types/general.mjs").CorpusUnit} CorpusUnit */
/** @typedef {import("./types/general.mjs").SourceDefinition} SourceDefinition */

const RECORD_ID = /([A-Z]{2,5}-\d{5})/;
const DOC_TYPE_PREFIXED = /^[A-Z]{2,5}-\d{5}_([A-Z]{2,5})(?:[-_]|$)/;
const DOC_TYPE_UNPREFIXED = /^([A-Z]{2,5})(?:[-_])/;

/**
 * A lazily parsed, repeatedly queried view of one repository tree.
 */
export class CorpusIndex {
    /**
     * @param {string} rootDirectory
     */
    constructor(rootDirectory) {
        /** @type {string} */
        this.root = rootDirectory;

        /** @type {string[] | null} */
        this._files = null;

        /** @type {Map<string, CorpusUnit>} */
        this._units = new Map();

        /** @type {Map<string, CorpusUnit[]>} */
        this._sources = new Map();

        /** @type {{ file: string, message: string }[]} */
        this.parseErrors = [];
    }

    /**
     * Every repository-relative file path, in sorted order.
     *
     * @returns {string[]}
     */
    listFiles() {
        if (this._files !== null) {
            return this._files;
        }

        /** @type {string[]} */
        const found = [];
        collectFiles(this.root, this.root, found);
        found.sort();
        this._files = found;
        return found;
    }

    /**
     * Resolve a named source definition to its units.
     *
     * @param {SourceDefinition} definition
     * @returns {CorpusUnit[]}
     */
    resolveSource(definition) {
        const cacheKey = JSON.stringify(definition);
        const cached = this._sources.get(cacheKey);
        if (cached !== undefined) {
            return cached;
        }

        const include = arrayOf(definition.include);
        const exclude = arrayOf(definition.exclude);
        const parseMode = definition.parse ?? "auto";
        const files = this.listFiles();

        /** @type {CorpusUnit[]} */
        const units = [];

        for (let i = 0, len = files.length; i < len; i++) {
            const file = files[i];

            if (include.length > 0 && !matchesAny(file, include)) {
                continue;
            }
            if (exclude.length > 0 && matchesAny(file, exclude)) {
                continue;
            }

            const unit = this.getUnit(file, parseMode);
            if (unit === null) {
                continue;
            }
            if (
                definition.doc_types !== undefined &&
                (unit.doc_type === null ||
                    !arrayOf(definition.doc_types).includes(unit.doc_type))
            ) {
                continue;
            }
            if (
                definition.schema_ids !== undefined &&
                (unit.schema_id === null ||
                    !arrayOf(definition.schema_ids).includes(unit.schema_id))
            ) {
                continue;
            }
            if (
                definition.series !== undefined &&
                (unit.series === null ||
                    !arrayOf(definition.series).includes(unit.series))
            ) {
                continue;
            }

            units.push(unit);
        }

        this._sources.set(cacheKey, units);
        return units;
    }

    /**
     * Load and parse one file into a unit.
     *
     * @param {string} file repository-relative posix path
     * @param {"auto" | "yaml" | "json" | "markdown" | "text" | "none"} [parseMode]
     * @returns {CorpusUnit | null}
     */
    getUnit(file, parseMode = "auto") {
        const cacheKey = `${parseMode}\u0000${file}`;
        const cached = this._units.get(cacheKey);
        if (cached !== undefined) {
            return cached;
        }

        /** @type {Uint8Array} */
        let bytes;
        let text = "";
        try {
            const raw = readFileSync(join(this.root, file));
            bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
            text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        } catch {
            return null;
        }

        const baseName = file.slice(file.lastIndexOf("/") + 1);
        const dot = baseName.lastIndexOf(".");
        const extension =
            dot === -1 ? "" : baseName.slice(dot + 1).toLowerCase();
        const stem = dot === -1 ? baseName : baseName.slice(0, dot);

        const effectiveMode =
            parseMode === "auto" ? modeForExtension(extension) : parseMode;

        /** @type {unknown} */
        let data = null;

        if (effectiveMode === "yaml") {
            try {
                data = parseYaml(text, { filename: file });
            } catch (error) {
                this.parseErrors.push({
                    file,
                    message:
                        error instanceof Error ? error.message : String(error)
                });
                data = null;
            }
        } else if (effectiveMode === "json") {
            try {
                data = JSON.parse(text);
            } catch (error) {
                this.parseErrors.push({
                    file,
                    message:
                        error instanceof Error ? error.message : String(error)
                });
                data = null;
            }
        } else if (effectiveMode === "markdown") {
            data = parseMarkdownForAssertions(text);
        } else if (effectiveMode === "text") {
            data = { text, lines: text.split("\n") };
        }

        const recordMatch = RECORD_ID.exec(file);
        const docTypeMatch =
            DOC_TYPE_PREFIXED.exec(stem) ?? DOC_TYPE_UNPREFIXED.exec(stem);

        /** @type {CorpusUnit} */
        const unit = {
            file,
            base_name: baseName,
            stem,
            extension,
            record: recordMatch === null ? null : recordMatch[1],
            series: recordMatch === null ? null : recordMatch[1].split("-")[0],
            doc_type: docTypeMatch === null ? null : docTypeMatch[1],
            schema_id: schemaIdOf(data),
            data,
            bytes,
            text,
            lines: text.split("\n")
        };

        this._units.set(cacheKey, unit);
        return unit;
    }

    /**
     * Built-in template and predicate bindings for a unit.
     *
     * @param {CorpusUnit} unit
     * @returns {Record<string, unknown>}
     */
    static bindingsFor(unit) {
        return {
            "#file": unit.file,
            "#directory": unit.file.includes("/")
                ? unit.file.slice(0, unit.file.lastIndexOf("/"))
                : "",
            "#base_name": unit.base_name,
            "#stem": unit.stem,
            "#extension": unit.extension,
            "#record": unit.record ?? "",
            "#series": unit.series ?? "",
            "#doc_type": unit.doc_type ?? "",
            "#schema": unit.schema_id ?? "",
            "#raw": unit.text,
            "#bytes": unit.bytes,
            "#lines": unit.lines
        };
    }
}

/**
 * @param {unknown} data
 * @returns {string | null}
 */
function schemaIdOf(data) {
    if (!isPlainObject(data)) {
        return null;
    }
    const value = /** @type {Record<string, unknown>} */ (data).schema;
    return typeof value === "string" ? value : null;
}

/**
 * @param {string} extension
 * @returns {"yaml" | "json" | "markdown" | "text" | "none"}
 */
function modeForExtension(extension) {
    if (extension === "yaml" || extension === "yml") {
        return "yaml";
    }
    if (extension === "json") {
        return "json";
    }
    if (extension === "md" || extension === "markdown") {
        return "markdown";
    }
    if (extension === "txt") {
        return "text";
    }
    return "none";
}

/**
 * @param {string} directory
 * @param {string} root
 * @param {string[]} out
 * @returns {void}
 */
function collectFiles(directory, root, out) {
    /** @type {import("node:fs").Dirent[]} */
    let entries;
    try {
        entries = readdirSync(directory, { withFileTypes: true });
    } catch {
        return;
    }

    entries.sort((left, right) => (left.name < right.name ? -1 : 1));

    for (let i = 0, len = entries.length; i < len; i++) {
        const entry = entries[i];
        const name = entry.name;

        if (name === ".git" || name === "node_modules" || name === ".yarn") {
            continue;
        }

        const absolute = join(directory, name);

        if (entry.isSymbolicLink()) {
            let stats;
            try {
                stats = statSync(absolute);
            } catch {
                continue;
            }
            if (stats.isDirectory()) {
                continue;
            }
        }

        if (entry.isDirectory()) {
            collectFiles(absolute, root, out);
            continue;
        }
        if (!entry.isFile() && !entry.isSymbolicLink()) {
            continue;
        }

        out.push(relative(root, absolute).split(sep).join("/"));
    }
}

/**
 * @param {string} file
 * @param {string[]} patterns
 * @returns {boolean}
 */
function matchesAny(file, patterns) {
    for (let i = 0, len = patterns.length; i < len; i++) {
        if (matchGlob(file, patterns[i])) {
            return true;
        }
    }
    return false;
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function arrayOf(value) {
    if (value === undefined || value === null) {
        return [];
    }
    return Array.isArray(value) ? value.map(String) : [String(value)];
}
