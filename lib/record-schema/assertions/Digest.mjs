import { createHash } from "node:crypto";
import { extname, relative, resolve, sep } from "node:path";

import { parseYaml, stringifyYaml } from "../../parsing/yaml.mjs";

import { containedPath } from "./AssertionPack.mjs";
import { evaluatePathFirst, isPlainObject } from "./Path.mjs";

/** @typedef {import("./types/general.mjs").AssertionRule} AssertionRule */
/** @typedef {import("./types/general.mjs").SourceDefinition} SourceDefinition */

/**
 * Compute a sorted raw-byte inventory and compare its declared manifest.
 * @param {AssertionRule} rule
 * @param {import("./CorpusIndex.mjs").CorpusIndex} index
 * @param {import("./types/general.mjs").ResolvedPack} pack
 * @param {string} [manifestText]
 * @param {ReadonlyMap<string, string>} [contents]
 * @returns {{file: string, count: number, issues: string[], content: string}}
 */
export function evaluateDigest(
    rule,
    index,
    pack,
    manifestText,
    contents = new Map()
) {
    if (rule.algorithm !== undefined && rule.algorithm !== "sha256")
        throw new Error("digest supports only sha256");
    if (typeof rule.manifest !== "string" || !rule.manifest)
        throw new Error("digest manifest must be a repository-relative path");
    const file = relative(index.root, resolve(index.root, rule.manifest))
        .split(sep)
        .join("/");
    if (manifestText === undefined && !containedPath(index.root, file))
        throw new Error(
            `digest manifest must be a contained regular file: ${file}`
        );
    if (!/\.(json|ya?ml)$/.test(file))
        throw new Error("digest manifest must be JSON or YAML");
    const text = manifestText ?? index.getUnit(file)?.text;
    if (text === undefined)
        throw new Error(`digest manifest could not be read: ${file}`);
    const document = text.trim()
        ? extname(file) === ".json"
            ? JSON.parse(text)
            : parseYaml(text)
        : {};
    if (!isPlainObject(document))
        throw new Error("digest manifest must be a mapping");
    const tracks = Array.isArray(rule.tracks) ? rule.tracks : [rule.tracks];
    if (tracks.length === 0)
        throw new Error("digest tracks must select at least one source");
    /** @type {Map<string, Uint8Array>} */
    const inventory = new Map();
    for (const track of tracks) {
        const definition =
            typeof track === "string" ? pack.sources[track] : track;
        if (!isPlainObject(definition))
            throw new Error(`unknown digest source: ${String(track)}`);
        const units = index.resolveSource({ ...definition, parse: "none" });
        for (const unit of units) {
            if (
                !contents.has(unit.file) &&
                !containedPath(index.root, unit.file)
            )
                throw new Error(
                    `digest source must be a contained regular file: ${
                        unit.file
                    }`
                );
            if (unit.file === file)
                throw new Error("digest manifest cannot track itself");
            inventory.set(unit.file, unit.bytes);
        }
    }
    const entries = [...inventory]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([path, bytes]) => ({
            path,
            digest: createHash("sha256").update(bytes).digest("hex")
        }));
    const options = rule.commitment ?? {};
    if (!isPlainObject(options))
        throw new Error("digest commitment must be a mapping");
    if (options.algorithm !== undefined && options.algorithm !== "sha256")
        throw new Error("digest commitment supports only sha256");
    const domain = options.domain ?? 0;
    const lengthEncoding = options.path_length ?? "u32le";
    if (!Number.isInteger(domain) || domain < 0 || domain > 255)
        throw new Error("digest domain must be a byte");
    if (!["u16le", "u32le"].includes(lengthEncoding))
        throw new Error("unsupported digest path length encoding");
    for (const key of ["include_path", "include_digest"])
        if (options[key] !== undefined && typeof options[key] !== "boolean")
            throw new Error(`digest ${key} must be boolean`);
    if (options.include_path === false && options.include_digest === false)
        throw new Error("digest commitment must include paths or digests");
    const hash = createHash("sha256").update(Buffer.from([domain]));
    for (const entry of entries) {
        if (options.include_path !== false) {
            const bytes = Buffer.from(entry.path, "utf8");
            const length = Buffer.alloc(lengthEncoding === "u16le" ? 2 : 4);
            if (length.length === 2) length.writeUInt16LE(bytes.length);
            else length.writeUInt32LE(bytes.length);
            hash.update(length).update(bytes);
        }
        if (options.include_digest !== false)
            hash.update(Buffer.from(entry.digest, "hex"));
    }
    const root = hash.digest("hex");
    const entriesPath = rule.entries ?? "entries";
    const pathField = rule.entry_path ?? "path";
    const digestField = rule.entry_digest ?? "sha256";
    const declared = evaluatePathFirst(document, entriesPath);
    /** @type {string[]} */
    const issues = [];
    if (!Array.isArray(declared))
        issues.push("manifest entries must be an array");
    else {
        const seen = new Set();
        for (let i = 0; i < declared.length; i++) {
            const path = evaluatePathFirst(declared[i], pathField);
            const digest = evaluatePathFirst(declared[i], digestField);
            if (
                typeof path !== "string" ||
                typeof digest !== "string" ||
                !/^[a-f0-9]{64}$/.test(digest)
            )
                issues.push(`invalid manifest entry at index ${i}`);
            if (seen.has(path)) issues.push(`duplicate manifest path: ${path}`);
            seen.add(path);
            if (path !== entries[i]?.path || digest !== entries[i]?.digest)
                issues.push(`inventory mismatch at index ${i}`);
        }
        if (declared.length !== entries.length)
            issues.push("manifest inventory count differs from tracked files");
    }
    if (
        rule.count_path !== undefined &&
        evaluatePathFirst(document, rule.count_path) !== entries.length
    )
        issues.push("manifest count differs from tracked files");
    if (
        rule.root_path !== undefined &&
        evaluatePathFirst(document, rule.root_path) !== root
    )
        issues.push("manifest corpus root differs from tracked files");
    const updated = structuredClone(document);
    const rows = entries.map((entry) => {
        /** @type {Record<string, unknown>} */
        const row = {};
        setField(row, pathField, entry.path);
        setField(row, digestField, entry.digest);
        return row;
    });
    setField(updated, entriesPath, rows);
    if (rule.count_path !== undefined)
        setField(updated, rule.count_path, entries.length);
    if (rule.root_path !== undefined) setField(updated, rule.root_path, root);
    return {
        file,
        count: entries.length,
        issues,
        content:
            extname(file) === ".json"
                ? `${JSON.stringify(updated, null, 2)}\n`
                : stringifyYaml(updated)
    };
}

/**
 * Assign a concrete dotted field path without permitting prototype keys.
 * @param {Record<string, unknown>} document
 * @param {string} path
 * @param {unknown} value
 */
function setField(document, path, value) {
    const fields = String(path)
        .replace(/^\$\.?/, "")
        .split(".");
    if (
        fields.some(
            (field) =>
                !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(field) ||
                ["__proto__", "prototype", "constructor"].includes(field)
        )
    )
        throw new Error("digest fields require concrete dotted paths");
    let cursor = document;
    for (const field of fields.slice(0, -1)) {
        if (cursor[field] === undefined) cursor[field] = {};
        if (!isPlainObject(cursor[field]))
            throw new Error(`digest field parent must be a mapping: ${path}`);
        cursor = /** @type {Record<string, unknown>} */ (cursor[field]);
    }
    cursor[fields.at(-1)] = value;
}
