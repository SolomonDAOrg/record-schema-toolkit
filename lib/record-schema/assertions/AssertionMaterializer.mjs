/**
 * Deterministic materialisation for assertion rules.
 */

import {
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { parseYaml, stringifyYaml } from "../../parsing/yaml.mjs";
import { AssertionPack } from "./AssertionPack.mjs";
import { CorpusIndex } from "./CorpusIndex.mjs";
import { AssertionEngine } from "./AssertionEngine.mjs";
import { evaluateExpression } from "./Expression.mjs";
import {
    buildDigestEntries,
    computeDigestCommitment
} from "./Manifest.mjs";
import { isPlainObject } from "./Path.mjs";
import { renderKey } from "./Template.mjs";
import { analyzeYamlFlowMappingSpacing } from "./YamlFormatting.mjs";

/**
 * @typedef {object} MaterializationResult
 * @property {string[]} packs
 * @property {{ rule: string, file: string, changed: boolean, content: string }[]} outputs
 * @property {string[]} errors
 */

/**
 * @param {string} rootDirectory
 * @param {{ packs: string[], only?: string[], write?: boolean }} options
 * @returns {MaterializationResult}
 */
export function materializeAssertions(rootDirectory, options) {
    const loaded = AssertionPack.load(rootDirectory, options.packs);
    if (loaded.errors.length > 0) {
        return {
            packs: loaded.pack.getPackIds(),
            outputs: [],
            errors: loaded.errors
        };
    }

    const index = new CorpusIndex(rootDirectory);
    const engine = new AssertionEngine(index, loaded.pack.resolved);
    return materializeAssertionsWithContext(
        rootDirectory,
        loaded.pack,
        index,
        engine,
        options
    );
}

/**
 * @param {string} rootDirectory
 * @param {AssertionPack} pack
 * @param {CorpusIndex} index
 * @param {AssertionEngine} engine
 * @param {{ only?: string[], write?: boolean }} [options]
 * @returns {MaterializationResult}
 */
export function materializeAssertionsWithContext(
    rootDirectory,
    pack,
    index,
    engine,
    options = {}
) {
    const only = options.only === undefined ? null : new Set(options.only);
    /** @type {MaterializationResult["outputs"]} */
    const outputs = [];
    /** @type {string[]} */
    const errors = [];
    /** @type {Map<string, string | null>} */
    const initialContents = new Map();
    /** @type {Map<string, string>} */
    const stagedContents = new Map();

    /**
     * @param {string} file
     * @returns {string}
     */
    const currentContent = (file) => {
        const staged = stagedContents.get(file);
        if (staged !== undefined) {
            return staged;
        }
        const absolute = containedOutputPath(rootDirectory, file);
        const content = existsSync(absolute)
            ? readFileSync(absolute, "utf8")
            : null;
        initialContents.set(file, content);
        return content ?? "";
    };

    /**
     * @param {string} ruleId
     * @param {string} file
     * @param {string} content
     * @returns {void}
     */
    const stage = (ruleId, file, content) => {
        const before = currentContent(file);
        stagedContents.set(file, content);
        outputs.push({
            rule: ruleId,
            file,
            changed: before !== content,
            content
        });
    };

    const rules = pack.getRules();
    const rulesById = new Map(rules.map((rule) => [rule.id, rule]));

    for (let i = 0, len = rules.length; i < len; i++) {
        const rule = rules[i];
        if (only !== null && !only.has(rule.id)) {
            continue;
        }
        if (rule.materialize === undefined) {
            continue;
        }

        try {
            if (rule.kind === "digest") {
                const output = materializeDigestRule(
                    rootDirectory,
                    index,
                    pack.resolved,
                    rule
                );
                stage(rule.id, output.file, output.content);
                continue;
            }
            if (rule.kind === "derive") {
                materializeDeriveRule(
                    rule,
                    engine,
                    currentContent,
                    stage
                );
                continue;
            }
            if (rule.kind === "format") {
                materializeFormatRule(
                    rule,
                    index,
                    pack.resolved,
                    currentContent,
                    stage
                );
                continue;
            }
            if (rule.kind === "reach") {
                materializeReachRule(
                    rule,
                    rulesById,
                    engine,
                    currentContent,
                    stage
                );
                continue;
            }
            throw new Error(
                `materialization is not implemented for kind '${rule.kind}'`
            );
        } catch (error) {
            errors.push(
                `${rule.source_pack ?? "?"} (${rule.id}): ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    if (options.write === true && errors.length === 0) {
        for (const [file, content] of stagedContents) {
            const initial = initialContents.has(file)
                ? initialContents.get(file)
                : existsSync(containedOutputPath(rootDirectory, file))
                ? readFileSync(containedOutputPath(rootDirectory, file), "utf8")
                : null;
            if (initial === content) {
                continue;
            }
            const absolute = containedOutputPath(rootDirectory, file);
            mkdirSync(dirname(absolute), { recursive: true });
            writeFileSync(absolute, content, "utf8");
        }
    }

    return {
        packs: pack.getPackIds(),
        outputs,
        errors
    };
}

/**
 * @param {import("./types/general.mjs").AssertionRule} rule
 * @param {AssertionEngine} engine
 * @param {(file: string) => string} currentContent
 * @param {(ruleId: string, file: string, content: string) => void} stage
 * @returns {void}
 */
function materializeDeriveRule(rule, engine, currentContent, stage) {
    if (!isPlainObject(rule.materialize)) {
        throw new Error("materialize must be a mapping");
    }
    const specification = /** @type {Record<string, unknown>} */ (
        rule.materialize
    );
    if (String(specification.operation ?? "") !== "yaml_inline_mapping_field") {
        throw new Error(
            `unknown derive materialization operation '${String(
                specification.operation ?? ""
            )}'`
        );
    }

    const mappingKey = requiredString(
        specification.mapping_key,
        "derive materialization needs mapping_key"
    );
    const field = requiredString(
        specification.field,
        "derive materialization needs field"
    );
    const projections = engine.evaluateProjection({
        select: rule.scope ?? rule.select,
        bind: rule.bind,
        with_tables: rule.with_tables
    });
    /** @type {Set<string>} */
    const stagedFiles = new Set();

    for (let i = 0, len = projections.length; i < len; i++) {
        const projection = projections[i];
        if (
            typeof rule.when === "string" &&
            evaluateExpression(rule.when, projection.bindings) !== true
        ) {
            continue;
        }
        const value = engine.evaluateProjectionValue(
            specification.value,
            projection
        );
        if (value === undefined) {
            throw new Error(
                `${projection.row.unit.file}: materialized value is undefined`
            );
        }
        const file = projection.row.unit.file;
        const content = rewriteYamlInlineMappingField(
            currentContent(file),
            mappingKey,
            field,
            value,
            file
        );
        stage(rule.id, file, content);
        stagedFiles.add(file);
    }

    if (projections.length > 0 && stagedFiles.size === 0) {
        return;
    }
}

/**
 * @param {import("./types/general.mjs").AssertionRule} rule
 * @param {CorpusIndex} index
 * @param {import("./types/general.mjs").ResolvedPack} pack
 * @param {(file: string) => string} currentContent
 * @param {(ruleId: string, file: string, content: string) => void} stage
 * @returns {void}
 */
function materializeFormatRule(
    rule,
    index,
    pack,
    currentContent,
    stage
) {
    if (!isPlainObject(rule.materialize)) {
        throw new Error("materialize must be a mapping");
    }
    const specification = /** @type {Record<string, unknown>} */ (
        rule.materialize
    );
    if (String(specification.operation ?? "") !== "rewrite") {
        throw new Error(
            `unknown format materialization operation '${String(
                specification.operation ?? ""
            )}'`
        );
    }
    const formatter = String(rule.formatter ?? "");
    if (formatter !== "yaml_flow_mapping_spacing") {
        throw new Error(`unknown formatter '${formatter}'`);
    }

    const units = index.resolveSource(sourceDefinition(pack, rule.source));
    for (let i = 0, len = units.length; i < len; i++) {
        const unit = units[i];
        const analysis = analyzeYamlFlowMappingSpacing(
            currentContent(unit.file),
            {
                lineBudget: Number(rule.line_budget ?? 200),
                filename: unit.file
            }
        );
        stage(rule.id, unit.file, analysis.content);
    }
}

/**
 * @param {import("./types/general.mjs").AssertionRule} ownerRule
 * @param {Map<string, import("./types/general.mjs").AssertionRule>} rulesById
 * @param {AssertionEngine} engine
 * @param {(file: string) => string} currentContent
 * @param {(ruleId: string, file: string, content: string) => void} stage
 * @returns {void}
 */
function materializeReachRule(
    ownerRule,
    rulesById,
    engine,
    currentContent,
    stage
) {
    if (!isPlainObject(ownerRule.materialize)) {
        throw new Error("materialize must be a mapping");
    }
    const materialize = /** @type {Record<string, unknown>} */ (
        ownerRule.materialize
    );
    if (String(materialize.operation ?? "") !== "reach_baseline") {
        throw new Error(
            `unknown reach materialization operation '${String(
                materialize.operation ?? ""
            )}'`
        );
    }
    const file = requiredString(
        materialize.file,
        "reach baseline materialization needs file"
    );
    const sections = Array.isArray(materialize.sections)
        ? materialize.sections
        : [];
    let content = currentContent(file);
    let document = parseYaml(content, { filename: file });
    if (!isPlainObject(document)) {
        throw new Error(`${file}: baseline document is not a mapping`);
    }

    for (let i = 0, len = sections.length; i < len; i++) {
        const rawSection = sections[i];
        if (!isPlainObject(rawSection)) {
            throw new Error(`materialize.sections[${i}] is not a mapping`);
        }
        const section = /** @type {Record<string, unknown>} */ (rawSection);
        const ruleId = requiredString(
            section.rule,
            `materialize.sections[${i}] needs rule`
        );
        const rule = rulesById.get(ruleId);
        if (rule === undefined || rule.kind !== "reach") {
            throw new Error(
                `materialize.sections[${i}] names unknown reach rule '${ruleId}'`
            );
        }
        const field = requiredString(
            section.field,
            `materialize.sections[${i}] needs field`
        );
        if (!isPlainObject(section.entry)) {
            throw new Error(
                `materialize.sections[${i}] needs an entry mapping`
            );
        }
        const entrySpecification = /** @type {Record<string, unknown>} */ (
            section.entry
        );
        const categoryField = String(section.category_field ?? "category");
        const existingEntries = Array.isArray(
            /** @type {Record<string, unknown>} */ (document)[field]
        )
            ? /** @type {unknown[]} */ (
                  /** @type {Record<string, unknown>} */ (document)[field]
              )
            : [];
        const existingByKey = indexReachEntries(rule, existingEntries);
        const analysis = engine.analyzeReach(rule);
        /** @type {Record<string, unknown>[]} */
        const entries = [];

        for (let j = 0, count = analysis.rows.length; j < count; j++) {
            const subject = analysis.rows[j];
            if (subject.reached) {
                continue;
            }
            const bindings = Object.assign({}, subject.node.row.bindings, {
                "#subject_key": subject.key,
                "#tier": subject.tier
            });
            const projection = {
                row: subject.node.row,
                bindings
            };
            /** @type {Record<string, unknown>} */
            const entry = {};
            const names = Object.keys(entrySpecification);
            for (let k = 0, nameCount = names.length; k < nameCount; k++) {
                const name = names[k];
                entry[name] = engine.evaluateProjectionValue(
                    entrySpecification[name],
                    projection
                );
            }
            const existing = existingByKey.get(subject.key);
            const generatedCategory = engine.evaluateProjectionValue(
                section.default_category,
                projection
            );
            entry[categoryField] =
                existing?.[categoryField] ?? generatedCategory ?? "uncategorised";
            if (existing !== undefined) {
                const existingNames = Object.keys(existing);
                for (
                    let k = 0, nameCount = existingNames.length;
                    k < nameCount;
                    k++
                ) {
                    const name = existingNames[k];
                    if (!Object.prototype.hasOwnProperty.call(entry, name)) {
                        entry[name] = existing[name];
                    }
                }
            }
            entries.push(entry);
        }

        sortEntries(entries, section.sort_by);
        content = rewriteYamlTopLevelSequence(content, field, entries, file);
        document = parseYaml(content, { filename: file });
        if (!isPlainObject(document)) {
            throw new Error(`${file}: materialized baseline is not a mapping`);
        }
    }

    stage(ownerRule.id, file, content);
}

/**
 * @param {import("./types/general.mjs").AssertionRule} rule
 * @param {unknown[]} entries
 * @returns {Map<string, Record<string, unknown>>}
 */
function indexReachEntries(rule, entries) {
    const keyTemplate = String(rule.baseline_key ?? "{$.name}");
    /** @type {Map<string, Record<string, unknown>>} */
    const indexed = new Map();
    for (let i = 0, len = entries.length; i < len; i++) {
        if (!isPlainObject(entries[i])) {
            continue;
        }
        const entry = /** @type {Record<string, unknown>} */ (entries[i]);
        const key = renderKey(keyTemplate, entry, {});
        if (key !== null) {
            indexed.set(key, entry);
        }
    }
    return indexed;
}

/**
 * @param {Record<string, unknown>[]} entries
 * @param {unknown} sortSpecification
 * @returns {void}
 */
function sortEntries(entries, sortSpecification) {
    const names = Array.isArray(sortSpecification)
        ? sortSpecification.map(String)
        : sortSpecification === undefined
        ? []
        : [String(sortSpecification)];
    if (names.length === 0) {
        return;
    }
    entries.sort((left, right) => {
        for (let i = 0, len = names.length; i < len; i++) {
            const compared = String(left[names[i]] ?? "").localeCompare(
                String(right[names[i]] ?? "")
            );
            if (compared !== 0) {
                return compared;
            }
        }
        return 0;
    });
}

/**
 * @param {string} text
 * @param {string} mappingKey
 * @param {string} field
 * @param {unknown} value
 * @param {string} filename
 * @returns {string}
 */
function rewriteYamlInlineMappingField(
    text,
    mappingKey,
    field,
    value,
    filename
) {
    const keyPattern = escapeRegularExpression(mappingKey);
    const expression = new RegExp(
        `^([ \\t]*)${keyPattern}[ \\t]*:[ \\t]*\\{`,
        "m"
    );
    const match = expression.exec(text);
    if (match === null) {
        throw new Error(
            `${filename}: inline mapping '${mappingKey}' was not found`
        );
    }
    const open = text.indexOf("{", match.index + match[0].length - 1);
    const close = findMatchingFlowBrace(text, open);
    if (close === -1) {
        throw new Error(
            `${filename}: inline mapping '${mappingKey}' is not closed`
        );
    }

    const inside = text.slice(open + 1, close);
    const segments = splitFlowMappingSegments(inside);
    const serialized = serializeYamlScalar(value);
    let rewrittenInside = inside;
    let replaced = false;

    for (let i = 0, len = segments.length; i < len; i++) {
        const segment = segments[i];
        const colon = findTopLevelColon(
            inside,
            segment.start,
            segment.end
        );
        if (colon === -1) {
            continue;
        }
        const key = unquoteYamlKey(
            inside.slice(segment.start, colon).trim()
        );
        if (key !== field) {
            continue;
        }
        let valueStart = colon + 1;
        while (/\s/.test(inside[valueStart] ?? "")) {
            valueStart += 1;
        }
        let valueEnd = segment.end;
        while (valueEnd > valueStart && /\s/.test(inside[valueEnd - 1])) {
            valueEnd -= 1;
        }
        rewrittenInside =
            inside.slice(0, valueStart) +
            serialized +
            inside.slice(valueEnd);
        replaced = true;
        break;
    }

    if (!replaced) {
        const trailing = /\s*$/.exec(inside)?.[0] ?? "";
        const bodyEnd = inside.length - trailing.length;
        const body = inside.slice(0, bodyEnd);
        const prefix = body.trim().length === 0 ? "" : ",";
        const leading = body.trim().length === 0 && inside.length > 0
            ? inside.slice(0, inside.length - inside.trimStart().length)
            : "";
        if (body.trim().length === 0) {
            rewrittenInside = `${leading} ${field}: ${serialized}${trailing || " "}`;
        } else {
            rewrittenInside = `${body}${prefix} ${field}: ${serialized}${trailing}`;
        }
    }

    const content =
        text.slice(0, open + 1) +
        rewrittenInside +
        text.slice(close);
    parseYaml(content, { filename });
    return content;
}

/**
 * @param {string} text
 * @param {number} open
 * @returns {number}
 */
function findMatchingFlowBrace(text, open) {
    let depth = 0;
    let quote = "";
    let escaped = false;
    for (let i = open, len = text.length; i < len; i++) {
        const character = text[i];
        if (quote.length > 0) {
            if (quote === '"' && character === "\\" && !escaped) {
                escaped = true;
                continue;
            }
            if (character === quote && !escaped) {
                quote = "";
            }
            escaped = false;
            continue;
        }
        if (character === '"' || character === "'") {
            quote = character;
            continue;
        }
        if (character === "{") {
            depth += 1;
            continue;
        }
        if (character === "}") {
            depth -= 1;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
}

/**
 * @param {string} text
 * @returns {{ start: number, end: number }[]}
 */
function splitFlowMappingSegments(text) {
    /** @type {{ start: number, end: number }[]} */
    const segments = [];
    let start = 0;
    let braceDepth = 0;
    let bracketDepth = 0;
    let quote = "";
    let escaped = false;

    for (let i = 0, len = text.length; i < len; i++) {
        const character = text[i];
        if (quote.length > 0) {
            if (quote === '"' && character === "\\" && !escaped) {
                escaped = true;
                continue;
            }
            if (character === quote && !escaped) {
                quote = "";
            }
            escaped = false;
            continue;
        }
        if (character === '"' || character === "'") {
            quote = character;
            continue;
        }
        if (character === "{") braceDepth += 1;
        else if (character === "}") braceDepth -= 1;
        else if (character === "[") bracketDepth += 1;
        else if (character === "]") bracketDepth -= 1;
        else if (
            character === "," &&
            braceDepth === 0 &&
            bracketDepth === 0
        ) {
            segments.push({ start, end: i });
            start = i + 1;
        }
    }
    segments.push({ start, end: text.length });
    return segments;
}

/**
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @returns {number}
 */
function findTopLevelColon(text, start, end) {
    let braceDepth = 0;
    let bracketDepth = 0;
    let quote = "";
    let escaped = false;
    for (let i = start; i < end; i++) {
        const character = text[i];
        if (quote.length > 0) {
            if (quote === '"' && character === "\\" && !escaped) {
                escaped = true;
                continue;
            }
            if (character === quote && !escaped) quote = "";
            escaped = false;
            continue;
        }
        if (character === '"' || character === "'") {
            quote = character;
            continue;
        }
        if (character === "{") braceDepth += 1;
        else if (character === "}") braceDepth -= 1;
        else if (character === "[") bracketDepth += 1;
        else if (character === "]") bracketDepth -= 1;
        else if (
            character === ":" &&
            braceDepth === 0 &&
            bracketDepth === 0
        ) {
            return i;
        }
    }
    return -1;
}

/**
 * @param {string} text
 * @param {string} field
 * @param {Record<string, unknown>[]} entries
 * @param {string} filename
 * @returns {string}
 */
function rewriteYamlTopLevelSequence(text, field, entries, filename) {
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const hadFinalEol = text.endsWith("\n");
    const lines = text.split(/\r?\n/);
    if (hadFinalEol) {
        lines.pop();
    }
    const fieldPattern = new RegExp(
        `^${escapeRegularExpression(field)}[ \\t]*:`
    );
    let start = -1;
    for (let i = 0, len = lines.length; i < len; i++) {
        if (fieldPattern.test(lines[i])) {
            start = i;
            break;
        }
    }

    const rendered = renderYamlInlineSequence(field, entries);
    if (start === -1) {
        if (lines.length > 0 && lines[lines.length - 1].length > 0) {
            lines.push("");
        }
        lines.push(...rendered);
    } else {
        let end = start + 1;
        while (end < lines.length) {
            const line = lines[end];
            if (/^[^ \\t#][^:]*:/.test(line)) {
                break;
            }
            if (/^#/.test(line)) {
                break;
            }
            end += 1;
        }
        while (end > start + 1 && lines[end - 1].trim().length === 0) {
            end -= 1;
        }
        lines.splice(start, end - start, ...rendered);
    }

    const content = lines.join(eol) + (hadFinalEol ? eol : "");
    parseYaml(content, { filename });
    return content;
}

/**
 * @param {string} field
 * @param {Record<string, unknown>[]} entries
 * @returns {string[]}
 */
function renderYamlInlineSequence(field, entries) {
    if (entries.length === 0) {
        return [`${field}: []`];
    }
    const lines = [`${field}:`];
    for (let i = 0, len = entries.length; i < len; i++) {
        const entry = entries[i];
        const names = Object.keys(entry);
        const fields = [];
        for (let j = 0, count = names.length; j < count; j++) {
            fields.push(
                `${names[j]}: ${serializeYamlScalar(entry[names[j]])}`
            );
        }
        lines.push(`  - { ${fields.join(", ")} }`);
    }
    return lines;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function serializeYamlScalar(value) {
    if (value === null || value === undefined) return "null";
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new Error("materialized numeric value must be finite");
        }
        return String(value);
    }
    if (typeof value === "bigint") return value.toString();
    if (typeof value !== "string") {
        throw new Error("materialized inline value must be scalar");
    }
    if (
        /^[A-Za-z_][A-Za-z0-9_.\/-]*$/.test(value) &&
        !/^(?:null|true|false|yes|no|on|off)$/i.test(value)
    ) {
        return value;
    }
    return JSON.stringify(value);
}

/**
 * @param {string} key
 * @returns {string}
 */
function unquoteYamlKey(key) {
    if (
        key.length >= 2 &&
        ((key.startsWith('"') && key.endsWith('"')) ||
            (key.startsWith("'") && key.endsWith("'")))
    ) {
        return key.slice(1, -1);
    }
    return key;
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegularExpression(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string} rootDirectory
 * @param {CorpusIndex} index
 * @param {import("./types/general.mjs").ResolvedPack} pack
 * @param {import("./types/general.mjs").AssertionRule} rule
 * @returns {{ file: string, content: string }}
 */
function materializeDigestRule(rootDirectory, index, pack, rule) {
    if (!isPlainObject(rule.materialize)) {
        throw new Error("materialize must be a mapping");
    }
    const specification = /** @type {Record<string, unknown>} */ (
        rule.materialize
    );
    const file = resolveMaterializedFile(index, pack, rule, specification);
    const tracks = sourceDefinition(pack, rule.tracks);
    const algorithm = String(rule.algorithm ?? "sha256");
    const entries = buildDigestEntries(index.resolveSource(tracks), algorithm);
    const commitment = isPlainObject(rule.commitment)
        ? Object.assign({}, rule.commitment, {
              algorithm: String(
                  /** @type {Record<string, unknown>} */ (rule.commitment)
                      .algorithm ?? algorithm
              )
          })
        : { algorithm };
    const root = computeDigestCommitment(entries, commitment);

    const pathField = String(specification.path_field ?? "path");
    const digestField = String(specification.digest_field ?? algorithm);
    const entriesField = String(specification.entries_field ?? "files");
    const rootField = String(specification.root_field ?? "corpus_root");
    const countField = String(specification.count_field ?? "file_count");

    /** @type {Record<string, unknown>} */
    const document = isPlainObject(specification.document)
        ? structuredClone(
              /** @type {Record<string, unknown>} */ (specification.document)
          )
        : {};
    document[rootField] = root;
    document[countField] = entries.length;
    document[entriesField] = entries.map((entry) => ({
        [pathField]: entry.path,
        [digestField]: entry.digest
    }));

    return {
        file,
        content: stringifyYaml(document, {
            indent: Number(specification.indent ?? 2),
            lineWidth: Number(specification.line_width ?? 120),
            sortKeys: false
        })
    };
}

/**
 * @param {CorpusIndex} index
 * @param {import("./types/general.mjs").ResolvedPack} pack
 * @param {import("./types/general.mjs").AssertionRule} rule
 * @param {Record<string, unknown>} specification
 * @returns {string}
 */
function resolveMaterializedFile(index, pack, rule, specification) {
    if (typeof specification.file === "string") {
        return specification.file;
    }
    const units = index.resolveSource(sourceDefinition(pack, rule.manifest));
    if (units.length !== 1) {
        throw new Error(
            `materialize.file is absent and manifest source resolves ${units.length} files`
        );
    }
    return units[0].file;
}

/**
 * @param {import("./types/general.mjs").ResolvedPack} pack
 * @param {unknown} source
 * @returns {import("./types/general.mjs").SourceDefinition}
 */
function sourceDefinition(pack, source) {
    if (typeof source === "string") {
        const named = pack.sources[source];
        if (named === undefined) {
            throw new Error(`unknown source '${source}'`);
        }
        return named;
    }
    if (isPlainObject(source)) {
        return /** @type {import("./types/general.mjs").SourceDefinition} */ (
            source
        );
    }
    throw new Error("materialized rule carries no source");
}

/**
 * @param {unknown} value
 * @param {string} message
 * @returns {string}
 */
function requiredString(value, message) {
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(message);
    }
    return value;
}

/**
 * @param {string} rootDirectory
 * @param {string} file
 * @returns {string}
 */
function containedOutputPath(rootDirectory, file) {
    const root = resolve(rootDirectory);
    const absolute = resolve(root, file);
    const rel = relative(root, absolute);
    if (rel === "" || rel.startsWith(`..${sep}`) || rel === "..") {
        throw new Error(`output '${file}' escapes the repository`);
    }
    return absolute;
}
