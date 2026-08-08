/**
 * Semantics-preserving YAML source formatting used by assertion and
 * materialisation paths.
 *
 * A formatter is accepted only when reparsing produces the same JavaScript
 * structure. Candidate lines are tested independently when a whole-file rewrite
 * would alter a prose scalar, so one non-structural brace does not exempt real
 * flow mappings elsewhere in the document.
 */

import { parseYaml } from "../../parsing/yaml.mjs";

/**
 * @typedef {object} YamlFlowSpacingAnalysis
 * @property {number[]} candidates zero-based candidate line numbers
 * @property {number[]} accepted zero-based semantically safe line numbers
 * @property {boolean} truncated
 * @property {string} content
 */

/**
 * Normalize one line to `{ key: value }` flow-mapping spacing without changing
 * quoted scalars or comments.
 *
 * @param {string} line
 * @returns {string}
 */
export function normalizeYamlFlowMappingSpacingLine(line) {
    if (/^\s*#/.test(line)) return line;
    if (((line.match(/"/g) ?? []).length) % 2 !== 0) return line;

    let out = "";
    let inQuote = false;
    let quoteCharacter = "";

    for (let i = 0, len = line.length; i < len; i++) {
        const character = line[i];
        if (inQuote) {
            out += character;
            if (character === quoteCharacter && line[i - 1] !== "\\") {
                inQuote = false;
            }
            continue;
        }
        if (character === '"' || character === "'") {
            inQuote = true;
            quoteCharacter = character;
            out += character;
            continue;
        }
        if (character === "#") return out + line.slice(i);
        if (
            character === "{" &&
            /[A-Za-z_]/.test(line[i + 1] ?? "")
        ) {
            out += "{ ";
            continue;
        }
        if (
            character === "}" &&
            /[A-Za-z0-9_\]"']/.test(out[out.length - 1] ?? "")
        ) {
            out += " }";
            continue;
        }
        out += character;
    }

    return out;
}

/**
 * Analyze and produce the safe rewrite for one YAML document.
 *
 * @param {string} text
 * @param {{ lineBudget?: number, filename?: string }} [options]
 * @returns {YamlFlowSpacingAnalysis}
 */
export function analyzeYamlFlowMappingSpacing(text, options = {}) {
    const before = parseYaml(text, { filename: options.filename });
    const lines = text.split("\n");
    const candidates = [];

    for (let i = 0, len = lines.length; i < len; i++) {
        if (normalizeYamlFlowMappingSpacingLine(lines[i]) !== lines[i]) {
            candidates.push(i);
        }
    }

    if (candidates.length === 0) {
        return { candidates, accepted: [], truncated: false, content: text };
    }

    const roundTrips = (candidate) => {
        let after;
        try {
            after = parseYaml(candidate, { filename: options.filename });
        } catch {
            return false;
        }
        return JSON.stringify(before) === JSON.stringify(after);
    };

    const whole = lines.map(normalizeYamlFlowMappingSpacingLine).join("\n");
    if (roundTrips(whole)) {
        return {
            candidates,
            accepted: candidates,
            truncated: false,
            content: whole
        };
    }

    const lineBudget = Math.max(
        0,
        Math.floor(Number(options.lineBudget ?? 200))
    );
    const budget = Math.min(candidates.length, lineBudget);
    const accepted = [];

    for (let i = 0; i < budget; i++) {
        const lineNumber = candidates[i];
        const trial = lines.slice();
        trial[lineNumber] = normalizeYamlFlowMappingSpacingLine(
            trial[lineNumber]
        );
        if (roundTrips(trial.join("\n"))) accepted.push(lineNumber);
    }

    const output = lines.slice();
    for (let i = 0, len = accepted.length; i < len; i++) {
        const lineNumber = accepted[i];
        output[lineNumber] = normalizeYamlFlowMappingSpacingLine(
            output[lineNumber]
        );
    }

    return {
        candidates,
        accepted,
        truncated: candidates.length > lineBudget,
        content: output.join("\n")
    };
}
