/**
 * Configurable lexer for embedded declaration languages.
 *
 * It recognises tokens and structural defects without evaluating the language.
 * The rule pack owns the operator vocabulary, keywords, and adjacency policy;
 * the toolkit owns only deterministic tokenisation and balanced delimiters.
 */

/**
 * @typedef {object} EmbeddedToken
 * @property {"identifier" | "number" | "string" | "operator" | "punctuation" | "keyword"} kind
 * @property {string} text
 * @property {number} start
 * @property {number} end
 * @property {string | null} role
 */

const DEFAULT_MULTI_OPERATORS = [
    "===",
    "!==",
    "<<=",
    ">>=",
    "**=",
    "==",
    "!=",
    "<=",
    ">=",
    "&&",
    "||",
    "**",
    "->",
    "=>",
    "..",
    "::",
    "<<",
    ">>"
];

const DEFAULT_SINGLE_OPERATORS = "+-*/%<>!&|^~?:.=,;";
const DEFAULT_PUNCTUATION = "()[]{}";

/**
 * @param {string} source
 * @param {Record<string, unknown>} [configuration]
 * @returns {{ tokens: EmbeddedToken[], errors: { index: number, message: string }[] }}
 */
export function lexEmbeddedLanguage(source, configuration = {}) {
    const identifierPattern = anchoredPattern(
        configuration.identifier_pattern,
        "[A-Za-z_][A-Za-z0-9_]*"
    );
    const numberPattern = anchoredPattern(
        configuration.number_pattern,
        "(?:0[xX][0-9a-fA-F_]+|[0-9][0-9_]*(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)"
    );
    const keywords = new Set(arrayOfStrings(configuration.keywords));
    const multiOperators = arrayOfStrings(
        configuration.multi_operators ?? DEFAULT_MULTI_OPERATORS
    ).sort((left, right) => right.length - left.length);
    const singleOperators = String(
        configuration.single_operators ?? DEFAULT_SINGLE_OPERATORS
    );
    const punctuation = String(
        configuration.punctuation ?? DEFAULT_PUNCTUATION
    );
    const lineComments = arrayOfStrings(configuration.line_comments ?? ["//"]);
    const blockComments = normalisePairs(
        configuration.block_comments ?? [["/*", "*/"]]
    );
    const stringQuotes = String(configuration.string_quotes ?? "\"'");

    /** @type {EmbeddedToken[]} */
    const tokens = [];
    /** @type {{ index: number, message: string }[]} */
    const errors = [];
    let index = 0;

    while (index < source.length) {
        const character = source[index];
        if (/\s/.test(character)) {
            index += 1;
            continue;
        }

        const lineComment = lineComments.find((prefix) =>
            source.startsWith(prefix, index)
        );
        if (lineComment !== undefined) {
            const newline = source.indexOf("\n", index + lineComment.length);
            index = newline === -1 ? source.length : newline + 1;
            continue;
        }

        const blockComment = blockComments.find(([open]) =>
            source.startsWith(open, index)
        );
        if (blockComment !== undefined) {
            const close = source.indexOf(
                blockComment[1],
                index + blockComment[0].length
            );
            if (close === -1) {
                errors.push({ index, message: "unterminated block comment" });
                break;
            }
            index = close + blockComment[1].length;
            continue;
        }

        if (stringQuotes.includes(character)) {
            const start = index;
            index += 1;
            let escaped = false;
            let terminated = false;
            while (index < source.length) {
                const current = source[index];
                if (escaped) {
                    escaped = false;
                    index += 1;
                    continue;
                }
                if (current === "\\") {
                    escaped = true;
                    index += 1;
                    continue;
                }
                if (current === character) {
                    index += 1;
                    terminated = true;
                    break;
                }
                index += 1;
            }
            if (!terminated) {
                errors.push({ index: start, message: "unterminated string" });
                break;
            }
            tokens.push({
                kind: "string",
                text: source.slice(start, index),
                start,
                end: index,
                role: null
            });
            continue;
        }

        const rest = source.slice(index);
        const number = numberPattern.exec(rest);
        if (number !== null) {
            tokens.push({
                kind: "number",
                text: number[0],
                start: index,
                end: index + number[0].length,
                role: null
            });
            index += number[0].length;
            continue;
        }

        const identifier = identifierPattern.exec(rest);
        if (identifier !== null) {
            const text = identifier[0];
            tokens.push({
                kind: keywords.has(text) ? "keyword" : "identifier",
                text,
                start: index,
                end: index + text.length,
                role: null
            });
            index += text.length;
            continue;
        }

        const operator = multiOperators.find((candidate) =>
            source.startsWith(candidate, index)
        );
        if (operator !== undefined) {
            tokens.push({
                kind: "operator",
                text: operator,
                start: index,
                end: index + operator.length,
                role: null
            });
            index += operator.length;
            continue;
        }

        if (singleOperators.includes(character)) {
            tokens.push({
                kind: "operator",
                text: character,
                start: index,
                end: index + 1,
                role: null
            });
            index += 1;
            continue;
        }

        if (punctuation.includes(character)) {
            tokens.push({
                kind: "punctuation",
                text: character,
                start: index,
                end: index + 1,
                role: null
            });
            index += 1;
            continue;
        }

        errors.push({
            index,
            message: `illegal character '${character}'`
        });
        index += 1;
    }

    classifyIdentifiers(tokens, configuration);
    checkBalanced(tokens, configuration, errors);
    checkAdjacency(tokens, configuration, errors);

    if (tokens.length === 0 && configuration.allow_empty !== true) {
        errors.push({ index: 0, message: "empty expression" });
    }

    return { tokens, errors };
}

/**
 * @param {EmbeddedToken[]} tokens
 * @param {Record<string, unknown>} configuration
 * @returns {void}
 */
function classifyIdentifiers(tokens, configuration) {
    const callOpen = String(configuration.call_open ?? "(");
    const memberOperators = new Set(
        arrayOfStrings(configuration.member_operators ?? [".", "::"])
    );

    for (let i = 0, len = tokens.length; i < len; i++) {
        const token = tokens[i];
        if (token.kind !== "identifier") continue;
        const previous = i === 0 ? null : tokens[i - 1];
        const next = i + 1 >= len ? null : tokens[i + 1];
        if (previous !== null && memberOperators.has(previous.text)) {
            token.role = "member";
        } else if (next !== null && next.text === callOpen) {
            token.role = "function";
        } else {
            token.role = "reference";
        }
    }
}

/**
 * @param {EmbeddedToken[]} tokens
 * @param {Record<string, unknown>} configuration
 * @param {{ index: number, message: string }[]} errors
 * @returns {void}
 */
function checkBalanced(tokens, configuration, errors) {
    const pairs = normalisePairs(
        configuration.balanced_pairs ?? [
            ["(", ")"],
            ["[", "]"],
            ["{", "}"]
        ]
    );
    /** @type {Map<string, string>} */
    const openings = new Map(pairs);
    /** @type {Map<string, string>} */
    const closings = new Map(pairs.map(([open, close]) => [close, open]));
    /** @type {EmbeddedToken[]} */
    const stack = [];

    for (let i = 0, len = tokens.length; i < len; i++) {
        const token = tokens[i];
        if (openings.has(token.text)) {
            stack.push(token);
            continue;
        }
        const expectedOpen = closings.get(token.text);
        if (expectedOpen === undefined) continue;
        const actual = stack.pop();
        if (actual === undefined || actual.text !== expectedOpen) {
            errors.push({
                index: token.start,
                message: `unmatched '${token.text}'`
            });
        }
    }

    for (let i = 0, len = stack.length; i < len; i++) {
        errors.push({
            index: stack[i].start,
            message: `unclosed '${stack[i].text}'`
        });
    }
}

/**
 * @param {EmbeddedToken[]} tokens
 * @param {Record<string, unknown>} configuration
 * @param {{ index: number, message: string }[]} errors
 * @returns {void}
 */
function checkAdjacency(tokens, configuration, errors) {
    const pairs = normalisePairs(
        configuration.forbid_adjacent ?? [
            ["identifier", "identifier"],
            ["identifier", "number"],
            ["identifier", "string"]
        ]
    );
    const forbidden = new Set(pairs.map(([left, right]) => `${left}\u0000${right}`));

    for (let i = 1, len = tokens.length; i < len; i++) {
        const previous = tokens[i - 1];
        const current = tokens[i];
        if (!forbidden.has(`${previous.kind}\u0000${current.kind}`)) continue;
        errors.push({
            index: current.start,
            message: `adjacent ${previous.kind} and ${current.kind} tokens '${previous.text} ${current.text}'`
        });
    }
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {RegExp}
 */
function anchoredPattern(value, fallback) {
    const source = typeof value === "string" ? value : fallback;
    return new RegExp(`^(?:${source})`);
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function arrayOfStrings(value) {
    if (value === null || value === undefined) return [];
    return Array.isArray(value) ? value.map(String) : [String(value)];
}

/**
 * @param {unknown} value
 * @returns {[string, string][]}
 */
function normalisePairs(value) {
    if (!Array.isArray(value)) return [];
    /** @type {[string, string][]} */
    const out = [];
    for (let i = 0, len = value.length; i < len; i++) {
        const pair = value[i];
        if (!Array.isArray(pair) || pair.length < 2) continue;
        out.push([String(pair[0]), String(pair[1])]);
    }
    return out;
}
