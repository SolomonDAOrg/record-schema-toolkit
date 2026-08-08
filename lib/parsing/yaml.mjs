import { readFileSync, writeFileSync } from "node:fs";

// ---- Character codes ----
const CH_TAB = 0x09;
const CH_LF = 0x0a;
const CH_CR = 0x0d;
const CH_SPACE = 0x20;
const CH_QUOTE_DBL = 0x22;
const CH_HASH = 0x23;
const CH_QUOTE_SGL = 0x27;
const CH_STAR = 0x2a;
const CH_COMMA = 0x2c;
const CH_DASH = 0x2d;
// const CH_DOT = 0x2e;
const CH_COLON = 0x3a;
const CH_QUESTION = 0x3f;
// const CH_AT = 0x40;
const CH_LBRACKET = 0x5b;
const CH_BACKSLASH = 0x5c;
const CH_RBRACKET = 0x5d;
// const CH_BACKTICK = 0x60;
const CH_LBRACE = 0x7b;
const CH_PIPE = 0x7c;
const CH_RBRACE = 0x7d;
const CH_GT = 0x3e;
const CH_AMP = 0x26;
// const CH_PERCENT = 0x25;
const CH_EXCLAIM = 0x21;

// ---- Types ----

/**
 * @typedef {Object} YamlParseOptions
 * @property {boolean} [strict=false] - Throw on unknown tags/anchors
 * @property {boolean} [allowDuplicateKeys=false] - Permit duplicate mapping keys
 * @property {string} [filename] - Filename for error messages
 */

/**
 * @typedef {Object} YamlWriteOptions
 * @property {number} [indent=2] - Indentation spaces
 * @property {number} [flowLevel=-1] - Depth at which to use flow style (-1 = never)
 * @property {number} [lineWidth=80] - Max line width for scalars
 * @property {boolean} [noRefs=true] - Don't use anchors/aliases
 * @property {boolean} [sortKeys=false] - Sort object keys alphabetically
 * @property {string} [eol="\n"] - Line ending
 */

/**
 * @typedef {Object} ParseContext
 * @property {string} src
 * @property {number} pos
 * @property {number} len
 * @property {number} line
 * @property {number} col
 * @property {string} [filename]
 * @property {boolean} strict
 * @property {boolean} allowDuplicateKeys
 * @property {Map<string, *>} anchors
 */

// ---- Error class ----

class YamlError extends Error {
    /**
     * @param {string} message
     * @param {number} line
     * @param {number} col
     * @param {string} [filename]
     */
    constructor(message, line, col, filename) {
        const loc = filename ? `${filename}:${line}:${col}` : `${line}:${col}`;
        super(`YAML Error at ${loc}: ${message}`);
        this.name = "YamlError";
        this.line = line;
        this.col = col;
        this.filename = filename;
    }
}

// ---- Parsing ----

/**
 * Parse YAML string to JavaScript value.
 * @param {string} src - YAML source string
 * @param {YamlParseOptions} [options] - Parse options
 * @returns {*} Parsed value
 */
function parseYaml(src, options = {}) {
    const ctx = createContext(src, options);
    skipBom(ctx);
    skipWhitespaceAndComments(ctx);

    // Handle document start markers
    if (peekChars(ctx, 3) === "---") {
        ctx.pos += 3;
        skipWhitespaceAndComments(ctx);
    }

    if (ctx.pos >= ctx.len) {
        return null;
    }

    const result = parseValue(ctx, 0);
    skipWhitespaceAndComments(ctx);

    // Handle document end marker
    if (peekChars(ctx, 3) === "...") {
        ctx.pos += 3;
    }

    return result;
}

/**
 * Parse all YAML documents from a string.
 * @param {string} src - YAML source string
 * @param {YamlParseOptions} [options] - Parse options
 * @returns {Array<*>} Array of parsed documents
 */
function parseYamlAll(src, options = {}) {
    const docs = [];
    const ctx = createContext(src, options);
    skipBom(ctx);

    while (ctx.pos < ctx.len) {
        skipWhitespaceAndComments(ctx);
        if (ctx.pos >= ctx.len) {
            break;
        }

        // Handle document start markers
        if (peekChars(ctx, 3) === "---") {
            ctx.pos += 3;
            skipWhitespaceAndComments(ctx);
        }

        if (ctx.pos >= ctx.len) {
            docs.push(null);
            break;
        }

        // Check for empty document before end marker
        if (peekChars(ctx, 3) === "...") {
            docs.push(null);
            ctx.pos += 3;
            continue;
        }

        const doc = parseValue(ctx, 0);
        docs.push(doc);

        skipWhitespaceAndComments(ctx);

        // Handle document end marker
        if (peekChars(ctx, 3) === "...") {
            ctx.pos += 3;
        }
    }

    return docs;
}

/**
 * @param {string} src
 * @param {YamlParseOptions} options
 * @returns {ParseContext}
 */
function createContext(src, options) {
    return {
        src,
        pos: 0,
        len: src.length,
        line: 1,
        col: 1,
        filename: options.filename,
        strict: options.strict || false,
        allowDuplicateKeys: options.allowDuplicateKeys === true,
        anchors: new Map()
    };
}

/**
 * @param {ParseContext} ctx
 */
function skipBom(ctx) {
    if (ctx.src.charCodeAt(0) === 0xfeff) {
        ctx.pos = 1;
        ctx.col = 2;
    }
}

/**
 * @param {ParseContext} ctx
 * @param {number} n
 * @returns {string}
 */
function peekChars(ctx, n) {
    return ctx.src.slice(ctx.pos, ctx.pos + n);
}

/**
 * @param {ParseContext} ctx
 * @returns {number}
 */
function peekCode(ctx) {
    return ctx.src.charCodeAt(ctx.pos);
}

/**
 * @param {ParseContext} ctx
 */
function advance(ctx) {
    const ch = ctx.src.charCodeAt(ctx.pos);
    ctx.pos++;
    if (ch === CH_LF) {
        ctx.line++;
        ctx.col = 1;
    } else if (ch === CH_CR) {
        if (ctx.src.charCodeAt(ctx.pos) === CH_LF) {
            ctx.pos++;
        }
        ctx.line++;
        ctx.col = 1;
    } else {
        ctx.col++;
    }
}

/**
 * @param {ParseContext} ctx
 * @param {number} n
 */
function advanceN(ctx, n) {
    for (let i = 0; i < n; i++) {
        advance(ctx);
    }
}

/**
 * @param {ParseContext} ctx
 */
function skipWhitespaceAndComments(ctx) {
    while (ctx.pos < ctx.len) {
        const ch = peekCode(ctx);
        if (ch === CH_SPACE || ch === CH_TAB) {
            advance(ctx);
            continue;
        }
        if (ch === CH_LF || ch === CH_CR) {
            advance(ctx);
            continue;
        }
        if (ch === CH_HASH) {
            // Skip comment to end of line
            while (ctx.pos < ctx.len) {
                const c = peekCode(ctx);
                if (c === CH_LF || c === CH_CR) {
                    break;
                }
                advance(ctx);
            }
            continue;
        }
        break;
    }
}

/**
 * @param {ParseContext} ctx
 */
function skipInlineWhitespace(ctx) {
    while (ctx.pos < ctx.len) {
        const ch = peekCode(ctx);
        if (ch === CH_SPACE || ch === CH_TAB) {
            advance(ctx);
            continue;
        }
        break;
    }
}

/**
 * Skip blank lines and comment-only lines without consuming indentation before content.
 * @param {ParseContext} ctx
 */
function skipEmptyLinesAndComments(ctx) {
    while (ctx.pos < ctx.len) {
        const start = ctx.pos;
        skipInlineWhitespace(ctx);
        if (ctx.pos >= ctx.len) {
            return;
        }
        const ch = peekCode(ctx);
        if (ch === CH_HASH) {
            while (ctx.pos < ctx.len) {
                const c = peekCode(ctx);
                if (c === CH_LF || c === CH_CR) {
                    break;
                }
                advance(ctx);
            }
            if (ctx.pos < ctx.len) {
                advance(ctx);
            }
            continue;
        }
        if (ch === CH_LF || ch === CH_CR) {
            advance(ctx);
            continue;
        }
        ctx.pos = start;
        return;
    }
}

/**
 * @param {ParseContext} ctx
 * @returns {boolean}
 */
function startsBlockSequenceAtCurrentLine(ctx) {
    const start = ctx.pos;
    skipInlineWhitespace(ctx);
    const ok = peekCode(ctx) === CH_DASH;
    ctx.pos = start;
    return ok;
}

/**
 * @param {ParseContext} ctx
 * @returns {number}
 */
function currentIndent(ctx) {
    // Find the start of current line
    let i = ctx.pos;
    while (
        i > 0 &&
        ctx.src.charCodeAt(i - 1) !== CH_LF &&
        ctx.src.charCodeAt(i - 1) !== CH_CR
    ) {
        i--;
    }
    // Count leading spaces
    let indent = 0;
    while (i < ctx.len) {
        const ch = ctx.src.charCodeAt(i);
        if (ch === CH_SPACE) {
            indent++;
            i++;
        } else if (ch === CH_TAB) {
            indent += 2; // Treat tab as 2 spaces
            i++;
        } else {
            break;
        }
    }
    return indent;
}

/**
 * @param {ParseContext} ctx
 * @param {number} minIndent
 * @param {number} [plainMinIndent] - Continuation bound for plain scalars
 * @returns {*}
 */
function parseValue(ctx, minIndent, plainMinIndent) {
    skipInlineWhitespace(ctx);

    if (ctx.pos >= ctx.len) {
        return null;
    }

    const ch = peekCode(ctx);

    // Check for anchor definition &name
    if (ch === CH_AMP) {
        return parseAnchorDefinition(ctx, minIndent);
    }

    // Check for alias *name
    if (ch === CH_STAR) {
        return parseAlias(ctx);
    }

    // Check for tag !tag
    if (ch === CH_EXCLAIM) {
        return parseTaggedValue(ctx, minIndent);
    }

    // Flow sequence
    if (ch === CH_LBRACKET) {
        return parseFlowSequence(ctx);
    }

    // Flow mapping
    if (ch === CH_LBRACE) {
        return parseFlowMapping(ctx);
    }

    // Block sequence
    if (ch === CH_DASH) {
        const next = ctx.src.charCodeAt(ctx.pos + 1);
        if (
            next === CH_SPACE ||
            next === CH_LF ||
            next === CH_CR ||
            ctx.pos + 1 >= ctx.len
        ) {
            return parseBlockSequence(ctx, minIndent);
        }
        // Check for document marker ---
        if (peekChars(ctx, 3) === "---") {
            return null;
        }
    }

    // Literal block scalar |
    if (ch === CH_PIPE) {
        return parseLiteralBlockScalar(ctx, minIndent);
    }

    // Folded block scalar >
    if (ch === CH_GT) {
        return parseFoldedBlockScalar(ctx, minIndent);
    }

    // Try to detect if this is a mapping (check first - handles quoted keys too)
    const mappingKey = tryParseMappingKey(ctx);
    if (mappingKey !== null) {
        return parseBlockMapping(ctx, minIndent, mappingKey);
    }

    // Quoted strings (only if not a mapping key)
    if (ch === CH_QUOTE_DBL) {
        return parseDoubleQuotedString(ctx);
    }
    if (ch === CH_QUOTE_SGL) {
        return parseSingleQuotedString(ctx);
    }

    // Plain scalar
    return parsePlainScalar(
        ctx,
        plainMinIndent === undefined ? minIndent : plainMinIndent
    );
}

/**
 * @param {ParseContext} ctx
 * @param {number} minIndent
 * @returns {*}
 */
function parseAnchorDefinition(ctx, minIndent) {
    advance(ctx); // skip &
    const anchorIndent = currentIndent(ctx);
    const name = parseAnchorName(ctx);
    skipInlineWhitespace(ctx);
    let value;
    const ch = peekCode(ctx);
    if (ch === CH_LF || ch === CH_CR || ch === CH_HASH || ctx.pos >= ctx.len) {
        // Value on next line
        skipEmptyLinesAndComments(ctx);
        const valueIndent = currentIndent(ctx);
        if (valueIndent > anchorIndent) {
            value = parseValue(ctx, valueIndent);
        } else {
            value = null;
        }
    } else {
        value = parseValue(ctx, minIndent);
    }

    ctx.anchors.set(name, value);
    return value;
}

/**
 * @param {ParseContext} ctx
 * @returns {*}
 */
function parseAlias(ctx) {
    advance(ctx); // skip *
    const name = parseAnchorName(ctx);
    if (!ctx.anchors.has(name)) {
        if (ctx.strict) {
            throw new YamlError(
                `Unknown anchor: ${name}`,
                ctx.line,
                ctx.col,
                ctx.filename
            );
        }
        return null;
    }
    return ctx.anchors.get(name);
}

/**
 * @param {ParseContext} ctx
 * @returns {string}
 */
function parseAnchorName(ctx) {
    let name = "";
    while (ctx.pos < ctx.len) {
        const ch = peekCode(ctx);
        if (isAnchorChar(ch)) {
            name += ctx.src[ctx.pos];
            advance(ctx);
        } else {
            break;
        }
    }
    return name;
}

/**
 * @param {number} ch
 * @returns {boolean}
 */
function isAnchorChar(ch) {
    // Alphanumeric and _ -
    return (
        (ch >= 0x30 && ch <= 0x39) || // 0-9
        (ch >= 0x41 && ch <= 0x5a) || // A-Z
        (ch >= 0x61 && ch <= 0x7a) || // a-z
        ch === 0x5f ||
        ch === 0x2d
    ); // _ -
}

/**
 * @param {ParseContext} ctx
 * @param {number} minIndent
 * @returns {*}
 */
function parseTaggedValue(ctx, minIndent) {
    advance(ctx); // skip !
    let tag = "";

    // Check for !! (secondary tag handle)
    if (peekCode(ctx) === CH_EXCLAIM) {
        advance(ctx);
        tag = "!!";
    } else {
        tag = "!";
    }

    // Read tag name
    while (ctx.pos < ctx.len) {
        const ch = peekCode(ctx);
        if (ch === CH_SPACE || ch === CH_TAB || ch === CH_LF || ch === CH_CR) {
            break;
        }
        tag += ctx.src[ctx.pos];
        advance(ctx);
    }

    skipInlineWhitespace(ctx);

    // Parse the value
    const value = parseValue(ctx, minIndent);

    // Handle known tags
    switch (tag) {
        case "!!null":
            return null;
        case "!!bool":
            return parseBoolean(String(value));
        case "!!int":
            return parseInt(String(value), 10);
        case "!!float":
            return parseFloat(String(value));
        case "!!str":
            return String(value);
        case "!!binary":
            return decodeBase64(String(value));
        case "!!timestamp":
            return new Date(String(value));
        case "!!set":
            if (typeof value === "object" && value !== null) {
                return new Set(Object.keys(value));
            }
            return new Set();
        case "!!omap":
            // Return as array of key-value pairs
            return value;
        default:
            // Return value as-is for unknown tags
            return value;
    }
}

/**
 * @param {ParseContext} ctx
 * @returns {Array<*>}
 */
function parseFlowSequence(ctx) {
    advance(ctx); // skip [
    const result = [];

    while (ctx.pos < ctx.len) {
        skipWhitespaceAndComments(ctx);

        if (peekCode(ctx) === CH_RBRACKET) {
            advance(ctx);
            break;
        }

        const value = parseFlowValue(ctx, true);

        skipWhitespaceAndComments(ctx);

        // Implicit single-pair mapping entry: [ key: value, key: value ]
        if (isFlowPairColon(ctx)) {
            advance(ctx);
            skipWhitespaceAndComments(ctx);
            const pairValue = parseFlowValue(ctx);
            result.push({ [String(value)]: pairValue });
            skipWhitespaceAndComments(ctx);
        } else {
            result.push(value);
        }

        const ch = peekCode(ctx);
        if (ch === CH_COMMA) {
            advance(ctx);
            continue;
        }
        if (ch === CH_RBRACKET) {
            advance(ctx);
            break;
        }

        throw new YamlError(
            "Expected ',' or ']' in flow sequence",
            ctx.line,
            ctx.col,
            ctx.filename
        );
    }

    return result;
}

/**
 * @param {ParseContext} ctx
 * @returns {Object}
 */
function parseFlowMapping(ctx) {
    advance(ctx); // skip {
    const result = {};
    const declaredKeys = new Set();

    while (ctx.pos < ctx.len) {
        skipWhitespaceAndComments(ctx);

        if (peekCode(ctx) === CH_RBRACE) {
            advance(ctx);
            break;
        }

        // Parse key
        const keyLine = ctx.line;
        const keyColumn = ctx.col;
        const key = parseFlowKey(ctx);
        if (!ctx.allowDuplicateKeys && declaredKeys.has(key)) {
            throw new YamlError(
                `Duplicate mapping key: ${key}`,
                keyLine,
                keyColumn,
                ctx.filename
            );
        }
        declaredKeys.add(key);

        skipWhitespaceAndComments(ctx);

        // Expect colon
        if (peekCode(ctx) !== CH_COLON) {
            throw new YamlError(
                "Expected ':' in flow mapping",
                ctx.line,
                ctx.col,
                ctx.filename
            );
        }
        advance(ctx);

        skipWhitespaceAndComments(ctx);

        // Parse value
        const value = parseFlowValue(ctx);
        result[key] = value;

        skipWhitespaceAndComments(ctx);

        const ch = peekCode(ctx);
        if (ch === CH_COMMA) {
            advance(ctx);
            continue;
        }
        if (ch === CH_RBRACE) {
            advance(ctx);
            break;
        }

        throw new YamlError(
            "Expected ',' or '}' in flow mapping",
            ctx.line,
            ctx.col,
            ctx.filename
        );
    }

    return result;
}

/**
 * @param {ParseContext} ctx
 * @param {boolean} [allowPairKey=false] - Position may hold an implicit pair key
 * @returns {*}
 */
function parseFlowValue(ctx, allowPairKey = false) {
    skipWhitespaceAndComments(ctx);
    const ch = peekCode(ctx);

    if (ch === CH_LBRACKET) {
        return parseFlowSequence(ctx);
    }
    if (ch === CH_LBRACE) {
        return parseFlowMapping(ctx);
    }
    if (ch === CH_QUOTE_DBL) {
        return parseDoubleQuotedString(ctx);
    }
    if (ch === CH_QUOTE_SGL) {
        return parseSingleQuotedString(ctx);
    }

    // Plain scalar in flow context
    return parseFlowPlainScalar(ctx, allowPairKey);
}

/**
 * @param {ParseContext} ctx
 * @returns {string}
 */
function parseFlowKey(ctx) {
    const ch = peekCode(ctx);

    if (ch === CH_QUOTE_DBL) {
        return parseDoubleQuotedString(ctx);
    }
    if (ch === CH_QUOTE_SGL) {
        return parseSingleQuotedString(ctx);
    }

    // Plain key
    let key = "";
    while (ctx.pos < ctx.len) {
        const c = peekCode(ctx);
        if (
            c === CH_COLON ||
            c === CH_COMMA ||
            c === CH_RBRACE ||
            c === CH_RBRACKET ||
            c === CH_LF ||
            c === CH_CR
        ) {
            break;
        }
        key += ctx.src[ctx.pos];
        advance(ctx);
    }
    return key.trim();
}

/**
 * @param {ParseContext} ctx
 * @param {boolean} [stopAtPairColon=false] - Terminate at a `: ` opening a pair
 * @returns {*}
 */
function parseFlowPlainScalar(ctx, stopAtPairColon = false) {
    let value = "";
    let pendingBreaks = 0;

    while (ctx.pos < ctx.len) {
        const ch = peekCode(ctx);
        if (ch === CH_COMMA || ch === CH_RBRACKET || ch === CH_RBRACE) {
            break;
        }
        if (stopAtPairColon && isFlowPairColon(ctx)) {
            break;
        }
        if (ch === CH_LF || ch === CH_CR) {
            // Plain scalars fold across lines inside a flow collection.
            const mark = markPosition(ctx);
            const breaks = skipFlowLineBreaks(ctx);
            if (breaks === 0 || !isFlowScalarContinuation(ctx)) {
                resetPosition(ctx, mark);
                break;
            }
            pendingBreaks += breaks;
            continue;
        }
        // Check for inline comment
        if (
            ch === CH_HASH &&
            value.length > 0 &&
            ctx.src.charCodeAt(ctx.pos - 1) === CH_SPACE
        ) {
            break;
        }
        if (pendingBreaks > 0) {
            value = trimTrailingInlineWhitespace(value);
            value += pendingBreaks === 1 ? " " : "\n".repeat(pendingBreaks - 1);
            pendingBreaks = 0;
        }
        value += ctx.src[ctx.pos];
        advance(ctx);
    }

    return resolveScalar(value.trim());
}

/**
 * @param {ParseContext} ctx
 * @returns {{ pos: number, line: number, col: number }}
 */
function markPosition(ctx) {
    return { pos: ctx.pos, line: ctx.line, col: ctx.col };
}

/**
 * @param {ParseContext} ctx
 * @param {{ pos: number, line: number, col: number }} mark
 */
function resetPosition(ctx, mark) {
    ctx.pos = mark.pos;
    ctx.line = mark.line;
    ctx.col = mark.col;
}

/**
 * @param {string} value
 * @returns {string}
 */
function trimTrailingInlineWhitespace(value) {
    let end = value.length;
    while (end > 0) {
        const ch = value.charCodeAt(end - 1);
        if (ch !== CH_SPACE && ch !== CH_TAB) {
            break;
        }
        end--;
    }
    return value.slice(0, end);
}

/**
 * Consume line breaks, indentation, and comment-only lines inside a flow
 * collection. Returns the number of line breaks crossed.
 * @param {ParseContext} ctx
 * @returns {number}
 */
function skipFlowLineBreaks(ctx) {
    let breaks = 0;
    while (ctx.pos < ctx.len) {
        const ch = peekCode(ctx);
        if (ch === CH_LF || ch === CH_CR) {
            advance(ctx);
            breaks++;
            continue;
        }
        if (ch === CH_SPACE || ch === CH_TAB) {
            advance(ctx);
            continue;
        }
        if (ch === CH_HASH) {
            while (ctx.pos < ctx.len) {
                const c = peekCode(ctx);
                if (c === CH_LF || c === CH_CR) {
                    break;
                }
                advance(ctx);
            }
            continue;
        }
        break;
    }
    return breaks;
}

/**
 * @param {ParseContext} ctx
 * @returns {boolean}
 */
function isFlowScalarContinuation(ctx) {
    if (ctx.pos >= ctx.len) {
        return false;
    }
    const ch = peekCode(ctx);
    if (
        ch === CH_COMMA ||
        ch === CH_RBRACKET ||
        ch === CH_RBRACE ||
        ch === CH_COLON ||
        ch === CH_HASH
    ) {
        return false;
    }
    const marker = peekChars(ctx, 3);
    if (marker === "---" || marker === "...") {
        return false;
    }
    return true;
}

/**
 * True when the parser sits on a `:` that opens an implicit flow pair.
 * @param {ParseContext} ctx
 * @returns {boolean}
 */
function isFlowPairColon(ctx) {
    if (peekCode(ctx) !== CH_COLON) {
        return false;
    }
    if (ctx.pos + 1 >= ctx.len) {
        return true;
    }
    const next = ctx.src.charCodeAt(ctx.pos + 1);
    return (
        next === CH_SPACE ||
        next === CH_TAB ||
        next === CH_LF ||
        next === CH_CR ||
        next === CH_COMMA ||
        next === CH_LBRACKET ||
        next === CH_RBRACKET ||
        next === CH_LBRACE ||
        next === CH_RBRACE
    );
}

/**
 * @param {ParseContext} ctx
 * @param {number} minIndent
 * @returns {Array<*>}
 */
function parseBlockSequence(ctx, minIndent) {
    const result = [];
    const seqIndent = currentIndent(ctx);

    while (ctx.pos < ctx.len) {
        const lineIndent = currentIndent(ctx);

        if (lineIndent < seqIndent && result.length > 0) {
            break;
        }

        skipInlineWhitespace(ctx);

        if (ctx.pos >= ctx.len) {
            break;
        }

        const ch = peekCode(ctx);

        // Check for document markers
        if (peekChars(ctx, 3) === "---" || peekChars(ctx, 3) === "...") {
            break;
        }

        if (ch === CH_DASH) {
            const next = ctx.src.charCodeAt(ctx.pos + 1);
            if (
                next === CH_SPACE ||
                next === CH_LF ||
                next === CH_CR ||
                ctx.pos + 1 >= ctx.len
            ) {
                advance(ctx); // skip -
                skipInlineWhitespace(ctx);

                // Check for empty item
                const c = peekCode(ctx);
                if (c === CH_LF || c === CH_CR || c === CH_HASH) {
                    // Empty item, check for nested content
                    skipEmptyLinesAndComments(ctx);
                    const nextIndent = currentIndent(ctx);
                    if (nextIndent > lineIndent) {
                        result.push(parseValue(ctx, nextIndent));
                    } else {
                        result.push(null);
                    }
                } else {
                    // Nested collections must out-indent the entry content
                    // column, but a plain scalar entry only has to out-indent
                    // the `-` indicator itself.
                    result.push(parseValue(ctx, lineIndent + 2, lineIndent));
                }

                skipWhitespaceAndComments(ctx);
                continue;
            }
        }

        // Not a sequence item
        if (result.length === 0) {
            throw new YamlError(
                "Expected sequence item",
                ctx.line,
                ctx.col,
                ctx.filename
            );
        }
        break;
    }

    return result;
}

/**
 * Try to detect if the current position starts a mapping key.
 * Returns the key if found, null otherwise.
 * @param {ParseContext} ctx
 * @returns {string|null}
 */
function tryParseMappingKey(ctx) {
    const startPos = ctx.pos;
    const startLine = ctx.line;
    const startCol = ctx.col;

    const ch = peekCode(ctx);

    // Explicit key indicator
    if (
        ch === CH_QUESTION &&
        (ctx.src.charCodeAt(ctx.pos + 1) === CH_SPACE ||
            ctx.src.charCodeAt(ctx.pos + 1) === CH_LF ||
            ctx.src.charCodeAt(ctx.pos + 1) === CH_CR)
    ) {
        advance(ctx); // skip ?
        skipInlineWhitespace(ctx);
        const key = parseValue(ctx, currentIndent(ctx));
        skipWhitespaceAndComments(ctx);
        skipInlineWhitespace(ctx);
        if (peekCode(ctx) === CH_COLON) {
            advance(ctx);
            return String(key);
        }
        // Restore position
        ctx.pos = startPos;
        ctx.line = startLine;
        ctx.col = startCol;
        return null;
    }

    // Quoted key
    if (ch === CH_QUOTE_DBL || ch === CH_QUOTE_SGL) {
        const key =
            ch === CH_QUOTE_DBL
                ? parseDoubleQuotedString(ctx)
                : parseSingleQuotedString(ctx);
        skipInlineWhitespace(ctx);
        if (peekCode(ctx) === CH_COLON) {
            const afterColon = ctx.src.charCodeAt(ctx.pos + 1);
            if (
                afterColon === CH_SPACE ||
                afterColon === CH_LF ||
                afterColon === CH_CR ||
                ctx.pos + 1 >= ctx.len
            ) {
                advance(ctx); // skip :
                return key;
            }
        }
        // Restore position
        ctx.pos = startPos;
        ctx.line = startLine;
        ctx.col = startCol;
        return null;
    }

    // Plain key - scan until we find : followed by space/newline
    let key = "";
    let colonFound = false;

    while (ctx.pos < ctx.len) {
        const c = peekCode(ctx);

        if (c === CH_LF || c === CH_CR) {
            break;
        }

        if (c === CH_COLON) {
            const afterColon = ctx.src.charCodeAt(ctx.pos + 1);
            if (
                afterColon === CH_SPACE ||
                afterColon === CH_LF ||
                afterColon === CH_CR ||
                ctx.pos + 1 >= ctx.len
            ) {
                colonFound = true;
                advance(ctx); // skip :
                break;
            }
        }

        if (
            c === CH_HASH &&
            key.length > 0 &&
            ctx.src.charCodeAt(ctx.pos - 1) === CH_SPACE
        ) {
            break;
        }

        key += ctx.src[ctx.pos];
        advance(ctx);
    }

    if (colonFound && key.trim().length > 0) {
        return key.trim();
    }

    // Restore position
    ctx.pos = startPos;
    ctx.line = startLine;
    ctx.col = startCol;
    return null;
}

/**
 * @param {ParseContext} ctx
 * @param {number} minIndent
 * @param {string} firstKey
 * @returns {Object}
 */
function parseBlockMapping(ctx, minIndent, firstKey) {
    const result = {};
    const declaredKeys = new Set();
    const mapIndent = Math.max(currentIndent(ctx), minIndent);

    // Handle first key-value pair
    skipInlineWhitespace(ctx);

    let c = peekCode(ctx);
    let firstValue;
    if (c === CH_LF || c === CH_CR || c === CH_HASH) {
        // Value on next line
        skipEmptyLinesAndComments(ctx);
        const valueIndent = currentIndent(ctx);
        if (valueIndent > mapIndent || startsBlockSequenceAtCurrentLine(ctx)) {
            firstValue = parseValue(ctx, valueIndent);
        } else {
            firstValue = null;
        }
    } else {
        firstValue = parseValue(ctx, mapIndent + 1);
    }

    // Handle merge key
    if (firstKey === "<<") {
        if (
            typeof firstValue === "object" &&
            firstValue !== null &&
            !Array.isArray(firstValue)
        ) {
            Object.assign(result, firstValue);
        } else if (Array.isArray(firstValue)) {
            for (let i = 0, len = firstValue.length; i < len; i++) {
                if (
                    typeof firstValue[i] === "object" &&
                    firstValue[i] !== null
                ) {
                    Object.assign(result, firstValue[i]);
                }
            }
        }
    } else {
        declaredKeys.add(firstKey);
        result[firstKey] = firstValue;
    }

    skipWhitespaceAndComments(ctx);

    // Parse remaining key-value pairs
    while (ctx.pos < ctx.len) {
        const lineIndent = currentIndent(ctx);

        if (lineIndent < mapIndent) {
            break;
        }
        if (lineIndent > mapIndent) {
            // This shouldn't happen in well-formed YAML, but skip it
            skipToEndOfLine(ctx);
            skipWhitespaceAndComments(ctx);
            continue;
        }

        // Check for document markers
        if (peekChars(ctx, 3) === "---" || peekChars(ctx, 3) === "...") {
            break;
        }

        skipInlineWhitespace(ctx);

        const keyLine = ctx.line;
        const keyColumn = ctx.col;
        const key = tryParseMappingKey(ctx);
        if (key === null) {
            break;
        }
        if (key !== "<<" && !ctx.allowDuplicateKeys && declaredKeys.has(key)) {
            throw new YamlError(
                `Duplicate mapping key: ${key}`,
                keyLine,
                keyColumn,
                ctx.filename
            );
        }
        if (key !== "<<") {
            declaredKeys.add(key);
        }

        skipInlineWhitespace(ctx);

        let value;
        c = peekCode(ctx);
        if (c === CH_LF || c === CH_CR || c === CH_HASH || ctx.pos >= ctx.len) {
            // Value on next line or null
            skipEmptyLinesAndComments(ctx);
            const valueIndent = currentIndent(ctx);
            if (
                valueIndent > mapIndent ||
                startsBlockSequenceAtCurrentLine(ctx)
            ) {
                value = parseValue(ctx, valueIndent);
            } else {
                value = null;
            }
        } else {
            value = parseValue(ctx, mapIndent + 1);
        }

        // Handle merge key
        if (key === "<<") {
            if (
                typeof value === "object" &&
                value !== null &&
                !Array.isArray(value)
            ) {
                Object.assign(result, value);
            } else if (Array.isArray(value)) {
                for (let j = 0, jlen = value.length; j < jlen; j++) {
                    if (typeof value[j] === "object" && value[j] !== null) {
                        Object.assign(result, value[j]);
                    }
                }
            }
        } else {
            result[key] = value;
        }

        skipWhitespaceAndComments(ctx);
    }

    return result;
}

/**
 * @param {ParseContext} ctx
 * @returns {string}
 */
function parseDoubleQuotedString(ctx) {
    advance(ctx); // skip opening "
    let result = "";
    let escaped = false;

    while (ctx.pos < ctx.len) {
        const ch = peekCode(ctx);

        if (escaped) {
            escaped = false;
            switch (ch) {
                case 0x30:
                    result += "\0";
                    break; // \0
                case 0x61:
                    result += "\x07";
                    break; // \a
                case 0x62:
                    result += "\b";
                    break; // \b
                case 0x74:
                    result += "\t";
                    break; // \t
                case 0x09:
                    result += "\t";
                    break; // \<tab>
                case 0x6e:
                    result += "\n";
                    break; // \n
                case 0x76:
                    result += "\v";
                    break; // \v
                case 0x66:
                    result += "\f";
                    break; // \f
                case 0x72:
                    result += "\r";
                    break; // \r
                case 0x65:
                    result += "\x1b";
                    break; // \e
                case 0x20:
                    result += " ";
                    break; // \<space>
                case CH_QUOTE_DBL:
                    result += '"';
                    break;
                case CH_BACKSLASH:
                    result += "\\";
                    break;
                case 0x4e:
                    result += "\x85";
                    break; // \N (NEL)
                case 0x5f:
                    result += "\xa0";
                    break; // \_ (NBSP)
                case 0x4c:
                    result += "\u2028";
                    break; // \L (LS)
                case 0x50:
                    result += "\u2029";
                    break; // \P (PS)
                case 0x78: {
                    // \xNN
                    advance(ctx);
                    const hex = ctx.src.slice(ctx.pos, ctx.pos + 2);
                    result += String.fromCharCode(parseInt(hex, 16));
                    advanceN(ctx, 2);
                    continue;
                }
                case 0x75: {
                    // \uNNNN
                    advance(ctx);
                    const hex = ctx.src.slice(ctx.pos, ctx.pos + 4);
                    result += String.fromCharCode(parseInt(hex, 16));
                    advanceN(ctx, 4);
                    continue;
                }
                case 0x55: {
                    // \UNNNNNNNN
                    advance(ctx);
                    const hex = ctx.src.slice(ctx.pos, ctx.pos + 8);
                    result += String.fromCodePoint(parseInt(hex, 16));
                    advanceN(ctx, 8);
                    continue;
                }
                case CH_LF:
                case CH_CR: {
                    // Line continuation
                    advance(ctx);
                    if (ch === CH_CR && peekCode(ctx) === CH_LF) {
                        advance(ctx);
                    }
                    // Skip leading whitespace on next line
                    while (ctx.pos < ctx.len) {
                        const c = peekCode(ctx);
                        if (c !== CH_SPACE && c !== CH_TAB) {
                            break;
                        }
                        advance(ctx);
                    }
                    continue;
                }
                default:
                    result += ctx.src[ctx.pos];
            }
            advance(ctx);
            continue;
        }

        if (ch === CH_BACKSLASH) {
            escaped = true;
            advance(ctx);
            continue;
        }

        if (ch === CH_QUOTE_DBL) {
            advance(ctx);
            break;
        }

        if (ch === CH_LF || ch === CH_CR) {
            result = foldQuotedLineBreak(ctx, result);
            continue;
        }

        result += ctx.src[ctx.pos];
        advance(ctx);
    }

    return result;
}

/**
 * Fold a run of line breaks inside a quoted scalar: trailing and leading
 * inline whitespace is dropped, one break becomes a space, and N breaks
 * become N-1 line breaks.
 * @param {ParseContext} ctx
 * @param {string} result
 * @returns {string}
 */
function foldQuotedLineBreak(ctx, result) {
    let breaks = 0;

    while (ctx.pos < ctx.len) {
        const ch = peekCode(ctx);
        if (ch === CH_LF || ch === CH_CR) {
            advance(ctx);
            breaks++;
            continue;
        }
        if (ch === CH_SPACE || ch === CH_TAB) {
            advance(ctx);
            continue;
        }
        break;
    }

    const folded = trimTrailingInlineWhitespace(result);
    return folded + (breaks === 1 ? " " : "\n".repeat(breaks - 1));
}

/**
 * @param {ParseContext} ctx
 * @returns {string}
 */
function parseSingleQuotedString(ctx) {
    advance(ctx); // skip opening '
    let result = "";

    while (ctx.pos < ctx.len) {
        const ch = peekCode(ctx);

        if (ch === CH_QUOTE_SGL) {
            // Check for escaped quote ''
            if (ctx.src.charCodeAt(ctx.pos + 1) === CH_QUOTE_SGL) {
                result += "'";
                advanceN(ctx, 2);
                continue;
            }
            advance(ctx);
            break;
        }

        if (ch === CH_LF || ch === CH_CR) {
            result = foldQuotedLineBreak(ctx, result);
            continue;
        }

        result += ctx.src[ctx.pos];
        advance(ctx);
    }

    return result;
}

/**
 * @param {ParseContext} ctx
 * @param {number} minIndent
 * @returns {string}
 */
function parseLiteralBlockScalar(ctx, minIndent) {
    advance(ctx); // skip |

    const { chomping, explicitIndent } = parseBlockScalarIndicators(ctx);

    // Skip to end of line
    skipToEndOfLine(ctx);
    if (ctx.pos < ctx.len) {
        advance(ctx); // skip newline
    }

    return parseBlockScalarContent(
        ctx,
        minIndent,
        explicitIndent,
        chomping,
        false
    );
}

/**
 * @param {ParseContext} ctx
 * @param {number} minIndent
 * @returns {string}
 */
function parseFoldedBlockScalar(ctx, minIndent) {
    advance(ctx); // skip >

    const { chomping, explicitIndent } = parseBlockScalarIndicators(ctx);

    // Skip to end of line
    skipToEndOfLine(ctx);
    if (ctx.pos < ctx.len) {
        advance(ctx); // skip newline
    }

    return parseBlockScalarContent(
        ctx,
        minIndent,
        explicitIndent,
        chomping,
        true
    );
}

/**
 * @param {ParseContext} ctx
 * @returns {{chomping: string, explicitIndent: number}}
 */
function parseBlockScalarIndicators(ctx) {
    let chomping = "clip"; // default
    let explicitIndent = 0;

    while (ctx.pos < ctx.len) {
        const ch = peekCode(ctx);

        if (ch === CH_DASH) {
            chomping = "strip";
            advance(ctx);
            continue;
        }

        if (ch === 0x2b) {
            // +
            chomping = "keep";
            advance(ctx);
            continue;
        }

        if (ch >= 0x31 && ch <= 0x39) {
            // 1-9
            explicitIndent = ch - 0x30;
            advance(ctx);
            continue;
        }

        if (ch === CH_SPACE || ch === CH_TAB) {
            advance(ctx);
            continue;
        }

        break;
    }

    return { chomping, explicitIndent };
}

/**
 * @param {ParseContext} ctx
 */
function skipToEndOfLine(ctx) {
    while (ctx.pos < ctx.len) {
        const ch = peekCode(ctx);
        if (ch === CH_LF || ch === CH_CR) {
            break;
        }
        advance(ctx);
    }
}

/**
 * @param {ParseContext} ctx
 * @param {number} minIndent
 * @param {number} explicitIndent
 * @param {string} chomping
 * @param {boolean} folded
 * @returns {string}
 */
function parseBlockScalarContent(
    ctx,
    minIndent,
    explicitIndent,
    chomping,
    folded
) {
    const lines = [];
    let contentIndent = 0;

    // Determine content indent from first non-empty line
    while (ctx.pos < ctx.len) {
        const lineStart = ctx.pos;
        let lineIndent = 0;

        // Count indentation
        while (ctx.pos < ctx.len) {
            const ch = peekCode(ctx);
            if (ch === CH_SPACE) {
                lineIndent++;
                advance(ctx);
            } else if (ch === CH_TAB) {
                lineIndent += 2;
                advance(ctx);
            } else {
                break;
            }
        }

        const ch = peekCode(ctx);

        // Empty line
        if (ch === CH_LF || ch === CH_CR || ctx.pos >= ctx.len) {
            lines.push("");
            if (ctx.pos < ctx.len) {
                advance(ctx);
            }
            continue;
        }

        // Check for document markers at column 0
        if (
            lineIndent === 0 &&
            (peekChars(ctx, 3) === "---" || peekChars(ctx, 3) === "...")
        ) {
            ctx.pos = lineStart;
            break;
        }

        // First content line determines indent
        if (contentIndent === 0) {
            contentIndent =
                explicitIndent > 0 ? minIndent + explicitIndent : lineIndent;
        }

        // Check if this line is part of the block scalar
        if (lineIndent < contentIndent) {
            ctx.pos = lineStart;
            break;
        }

        // Read line content
        let lineContent = "";
        const extraIndent = lineIndent - contentIndent;
        if (extraIndent > 0) {
            lineContent = " ".repeat(extraIndent);
        }

        while (ctx.pos < ctx.len) {
            const c = peekCode(ctx);
            if (c === CH_LF || c === CH_CR) {
                break;
            }
            lineContent += ctx.src[ctx.pos];
            advance(ctx);
        }

        lines.push(lineContent);

        if (ctx.pos < ctx.len) {
            advance(ctx); // skip newline
        }
    }

    // Process according to folded/literal and chomping
    let result;

    if (folded) {
        // Folded: replace single newlines with spaces, keep double newlines
        result = foldLines(lines);
    } else {
        // Literal: keep all newlines
        result = lines.join("\n");
    }

    // Apply chomping
    if (chomping === "strip") {
        result = result.replace(/\n+$/, "");
    } else if (chomping === "clip") {
        result = result.replace(/\n+$/, "") + "\n";
    } else if (chomping === "keep") {
        result = result + "\n";
    }

    // Handle empty content
    if (result === "\n" && lines.length === 0) {
        result = chomping === "strip" ? "" : "";
    }

    return result;
}

/**
 * Fold block scalar lines per YAML folding rules: adjacent text lines join with
 * a single space, a run of N blank lines yields N line breaks, and
 * more-indented lines are preserved literally with unfolded breaks.
 * @param {string[]} lines
 * @returns {string}
 */
function foldLines(lines) {
    let result = "";
    let pendingBreaks = 0;
    let hasContent = false;
    let prevLiteral = false;

    for (let i = 0, len = lines.length; i < len; i++) {
        const line = lines[i];

        if (line === "") {
            pendingBreaks++;
            continue;
        }

        const isLiteral = line.startsWith(" ");

        if (!hasContent) {
            result = line;
            hasContent = true;
            prevLiteral = isLiteral;
            pendingBreaks = 0;
            continue;
        }

        if (isLiteral || prevLiteral) {
            // Breaks adjacent to a more-indented line are never folded.
            result += "\n".repeat(pendingBreaks + 1);
        } else if (pendingBreaks > 0) {
            result += "\n".repeat(pendingBreaks);
        } else {
            result += " ";
        }

        result += line;
        prevLiteral = isLiteral;
        pendingBreaks = 0;
    }

    if (pendingBreaks > 0) {
        result += "\n".repeat(pendingBreaks);
    }

    return result;
}

/**
 * @param {ParseContext} ctx
 * @param {number} minIndent
 * @returns {*}
 */
function parsePlainScalar(ctx, minIndent) {
    let value = "";
    let lineCount = 0;
    const startIndent = currentIndent(ctx);

    while (ctx.pos < ctx.len) {
        const lineIndent = currentIndent(ctx);

        // Check if we've dedented
        if (lineCount > 0 && lineIndent < startIndent) {
            break;
        }

        skipInlineWhitespace(ctx);

        if (ctx.pos >= ctx.len) {
            break;
        }

        const ch = peekCode(ctx);

        // Check for document markers
        if (peekChars(ctx, 3) === "---" || peekChars(ctx, 3) === "...") {
            break;
        }

        // Check for indicators that end a plain scalar
        if (ch === CH_COLON) {
            const next = ctx.src.charCodeAt(ctx.pos + 1);
            if (
                next === CH_SPACE ||
                next === CH_LF ||
                next === CH_CR ||
                ctx.pos + 1 >= ctx.len
            ) {
                break;
            }
        }

        if (ch === CH_DASH && lineIndent === startIndent) {
            const next = ctx.src.charCodeAt(ctx.pos + 1);
            if (next === CH_SPACE || next === CH_LF || next === CH_CR) {
                break;
            }
        }

        // Read line content
        let lineContent = "";
        while (ctx.pos < ctx.len) {
            const c = peekCode(ctx);

            if (c === CH_LF || c === CH_CR) {
                break;
            }

            // Check for colon followed by space (end of key)
            if (c === CH_COLON) {
                const nextC = ctx.src.charCodeAt(ctx.pos + 1);
                if (
                    nextC === CH_SPACE ||
                    nextC === CH_LF ||
                    nextC === CH_CR ||
                    ctx.pos + 1 >= ctx.len
                ) {
                    break;
                }
            }

            // Check for comment
            if (
                c === CH_HASH &&
                lineContent.length > 0 &&
                ctx.src.charCodeAt(ctx.pos - 1) === CH_SPACE
            ) {
                break;
            }

            lineContent += ctx.src[ctx.pos];
            advance(ctx);
        }

        if (lineCount > 0) {
            value += " ";
        }
        value += lineContent.trim();
        lineCount++;

        // Check for end of line
        const eol = peekCode(ctx);
        if (eol === CH_LF || eol === CH_CR) {
            advance(ctx);

            // Look ahead to see if next line continues the scalar
            const savedPos = ctx.pos;
            const savedLine = ctx.line;
            const savedCol = ctx.col;

            skipWhitespaceAndComments(ctx);

            if (ctx.pos >= ctx.len) {
                break;
            }

            const nextIndent = currentIndent(ctx);
            const nextCh = peekCode(ctx);

            // Check if next line is part of scalar
            if (nextIndent <= minIndent) {
                ctx.pos = savedPos;
                ctx.line = savedLine;
                ctx.col = savedCol;
                break;
            }

            // Check for indicators
            if (
                nextCh === CH_DASH ||
                nextCh === CH_COLON ||
                nextCh === CH_LBRACKET ||
                nextCh === CH_LBRACE ||
                nextCh === CH_QUOTE_DBL ||
                nextCh === CH_QUOTE_SGL
            ) {
                ctx.pos = savedPos;
                ctx.line = savedLine;
                ctx.col = savedCol;
                break;
            }

            // Restore to continue
            ctx.pos = savedPos;
            ctx.line = savedLine;
            ctx.col = savedCol;
            advance(ctx); // skip the newline we peeked past
        } else {
            break;
        }
    }

    return resolveScalar(value.trim());
}

/**
 * @param {string} value
 * @returns {*}
 */
function resolveScalar(value) {
    if (value === "") {
        return "";
    }

    // Null
    if (
        value === "null" ||
        value === "Null" ||
        value === "NULL" ||
        value === "~"
    ) {
        return null;
    }

    // Boolean
    const bool = parseBoolean(value);
    if (bool !== undefined) {
        return bool;
    }

    // Integer
    if (/^[-+]?[0-9]+$/.test(value)) {
        return parseInt(value, 10);
    }

    // Octal
    if (/^0o[0-7]+$/.test(value)) {
        return parseInt(value.slice(2), 8);
    }

    // Hex
    if (/^0x[0-9a-fA-F]+$/.test(value)) {
        return parseInt(value.slice(2), 16);
    }

    // Float
    if (/^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/.test(value)) {
        return parseFloat(value);
    }

    // Infinity
    if (
        value === ".inf" ||
        value === ".Inf" ||
        value === ".INF" ||
        value === "+.inf" ||
        value === "+.Inf" ||
        value === "+.INF"
    ) {
        return Infinity;
    }
    if (value === "-.inf" || value === "-.Inf" || value === "-.INF") {
        return -Infinity;
    }

    // NaN
    if (value === ".nan" || value === ".NaN" || value === ".NAN") {
        return NaN;
    }

    // Return as string
    return value;
}

/**
 * @param {string} value
 * @returns {boolean|undefined}
 */
function parseBoolean(value) {
    if (value === "true" || value === "True" || value === "TRUE") {
        return true;
    }
    if (value === "false" || value === "False" || value === "FALSE") {
        return false;
    }
    return undefined;
}

/**
 * @param {string} str
 * @returns {Uint8Array}
 */
function decodeBase64(str) {
    const clean = str.replace(/\s/g, "");
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0, len = binary.length; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

// ---- Writing ----

/**
 * Serialize a JavaScript value to YAML string.
 * @param {*} value - Value to serialize
 * @param {YamlWriteOptions} [options] - Write options
 * @returns {string} YAML string
 */
function stringifyYaml(value, options = {}) {
    const opts = {
        indent: options.indent || 2,
        flowLevel: options.flowLevel !== undefined ? options.flowLevel : -1,
        lineWidth: options.lineWidth || 80,
        noRefs: options.noRefs !== false,
        sortKeys: options.sortKeys || false,
        eol: options.eol || "\n"
    };

    const result = writeValue(value, 0, opts);
    return result + opts.eol;
}

/**
 * @param {*} value
 * @param {number} level
 * @param {YamlWriteOptions} opts
 * @returns {string}
 */
function writeValue(value, level, opts) {
    if (value === null || value === undefined) {
        return "null";
    }

    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }

    if (typeof value === "number") {
        if (Number.isNaN(value)) {
            return ".nan";
        }
        if (!Number.isFinite(value)) {
            return value > 0 ? ".inf" : "-.inf";
        }
        return String(value);
    }

    if (typeof value === "string") {
        return writeString(value, level, opts);
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (value instanceof Uint8Array) {
        return writeBase64(value);
    }

    if (value instanceof Set) {
        return writeSet(value, level, opts);
    }

    if (Array.isArray(value)) {
        return writeArray(value, level, opts);
    }

    if (typeof value === "object") {
        return writeObject(value, level, opts);
    }

    return String(value);
}

/**
 * @param {string} str
 * @param {number} level
 * @param {YamlWriteOptions} opts
 * @returns {string}
 */
function writeString(str, level, opts) {
    // Check if string needs quoting
    if (str === "") {
        return '""';
    }

    // Check for special values that would be parsed as non-strings
    const lower = str.toLowerCase();
    if (
        lower === "null" ||
        lower === "true" ||
        lower === "false" ||
        lower === "~" ||
        lower === ".nan" ||
        lower === ".inf" ||
        lower === "-.inf" ||
        lower === "+.inf"
    ) {
        return quoteString(str);
    }

    // Check if it looks like a number
    if (/^[-+]?[0-9]/.test(str) || /^\./.test(str)) {
        const num = parseFloat(str);
        if (!Number.isNaN(num) || str === ".nan") {
            return quoteString(str);
        }
    }

    // Check for characters that require quoting
    const needsQuote =
        /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(str) ||
        str.startsWith(" ") ||
        str.endsWith(" ") ||
        str.includes(": ") ||
        str.includes(" #") ||
        str.startsWith("@") ||
        str.startsWith("`") ||
        str.startsWith("&") ||
        str.startsWith("*") ||
        str.startsWith("!") ||
        str.startsWith("|") ||
        str.startsWith(">") ||
        str.startsWith("?") ||
        str.startsWith("-") ||
        str.startsWith("{") ||
        str.startsWith("[") ||
        str.startsWith(",") ||
        str.includes('"') ||
        str.includes("'");

    // Check for multiline
    if (str.includes("\n")) {
        return writeLiteralBlock(str, level, opts);
    }

    if (needsQuote) {
        return quoteString(str);
    }

    // Check if string is too long
    if (str.length > opts.lineWidth) {
        return writeFoldedBlock(str, level, opts);
    }

    return str;
}

/**
 * @param {string} str
 * @returns {string}
 */
function quoteString(str) {
    let result = '"';
    for (let i = 0, len = str.length; i < len; i++) {
        const ch = str.charCodeAt(i);
        switch (ch) {
            case 0x00:
                result += "\\0";
                break;
            case 0x07:
                result += "\\a";
                break;
            case 0x08:
                result += "\\b";
                break;
            case 0x09:
                result += "\\t";
                break;
            case 0x0a:
                result += "\\n";
                break;
            case 0x0b:
                result += "\\v";
                break;
            case 0x0c:
                result += "\\f";
                break;
            case 0x0d:
                result += "\\r";
                break;
            case 0x1b:
                result += "\\e";
                break;
            case 0x22:
                result += '\\"';
                break;
            case 0x5c:
                result += "\\\\";
                break;
            default:
                if (ch < 0x20 || (ch >= 0x7f && ch <= 0x9f)) {
                    result += "\\x" + ch.toString(16).padStart(2, "0");
                } else {
                    result += str[i];
                }
        }
    }
    result += '"';
    return result;
}

/**
 * @param {string} str
 * @param {number} level
 * @param {YamlWriteOptions} opts
 * @returns {string}
 */
function writeLiteralBlock(str, level, opts) {
    const indent = " ".repeat((level + 1) * opts.indent);
    const lines = str.split("\n");

    // Determine chomping indicator
    let chomping = "";
    if (str.endsWith("\n\n")) {
        chomping = "+";
    } else if (!str.endsWith("\n")) {
        chomping = "-";
    }

    let result = "|" + chomping + opts.eol;

    for (let i = 0, len = lines.length; i < len; i++) {
        const line = lines[i];
        if (line === "" && i === len - 1 && !chomping) {
            continue;
        }
        result += indent + line;
        if (i < len - 1) {
            result += opts.eol;
        }
    }

    return result;
}

/**
 * @param {string} str
 * @param {number} level
 * @param {YamlWriteOptions} opts
 * @returns {string}
 */
function writeFoldedBlock(str, level, opts) {
    const indent = " ".repeat((level + 1) * opts.indent);
    const maxWidth = opts.lineWidth - indent.length;

    const words = str.split(/\s+/);
    const lines = [];
    let currentLine = "";

    for (let i = 0, len = words.length; i < len; i++) {
        const word = words[i];
        if (currentLine.length === 0) {
            currentLine = word;
        } else if (currentLine.length + 1 + word.length <= maxWidth) {
            currentLine += " " + word;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    if (currentLine.length > 0) {
        lines.push(currentLine);
    }

    let result = ">" + opts.eol;
    for (let i = 0, len = lines.length; i < len; i++) {
        result += indent + lines[i];
        if (i < len - 1) {
            result += opts.eol;
        }
    }

    return result;
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function writeBase64(bytes) {
    let binary = "";
    for (let i = 0, len = bytes.length; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return "!!binary " + btoa(binary);
}

/**
 * @param {Set<*>} set
 * @param {number} level
 * @param {YamlWriteOptions} opts
 * @returns {string}
 */
function writeSet(set, level, opts) {
    const indent = " ".repeat(level * opts.indent);
    const childIndent = " ".repeat((level + 1) * opts.indent);
    let result = "!!set" + opts.eol;

    const values = Array.from(set);
    if (opts.sortKeys) {
        values.sort();
    }

    for (let i = 0, len = values.length; i < len; i++) {
        const val = values[i];
        result += childIndent + writeValue(val, level + 1, opts) + ": null";
        if (i < len - 1) {
            result += opts.eol;
        }
    }

    return result;
}

/**
 * @param {Array<*>} arr
 * @param {number} level
 * @param {YamlWriteOptions} opts
 * @returns {string}
 */
function writeArray(arr, level, opts) {
    if (arr.length === 0) {
        return "[]";
    }

    // Use flow style if at or beyond flow level
    if (opts.flowLevel >= 0 && level >= opts.flowLevel) {
        return writeFlowArray(arr, opts);
    }

    const indent = " ".repeat(level * opts.indent);
    const childIndent = " ".repeat((level + 1) * opts.indent);
    const lines = [];

    for (let i = 0, len = arr.length; i < len; i++) {
        const item = arr[i];
        const itemStr = writeValue(item, level + 1, opts);

        if (
            typeof item === "object" &&
            item !== null &&
            !Array.isArray(item) &&
            !(item instanceof Date) &&
            !(item instanceof Uint8Array) &&
            !(item instanceof Set)
        ) {
            // Object value - put on same line if simple, otherwise new line
            const keys = Object.keys(item);
            if (keys.length <= 2 && !itemStr.includes("\n")) {
                lines.push(indent + "- " + itemStr);
            } else {
                lines.push(
                    indent +
                        "-" +
                        opts.eol +
                        childIndent +
                        itemStr.replace(/\n/g, opts.eol + childIndent)
                );
            }
        } else if (Array.isArray(item) && item.length > 0) {
            lines.push(
                indent +
                    "-" +
                    opts.eol +
                    childIndent +
                    itemStr.replace(/\n/g, opts.eol + childIndent)
            );
        } else if (itemStr.includes("\n")) {
            lines.push(
                indent +
                    "-" +
                    opts.eol +
                    childIndent +
                    itemStr.replace(/\n/g, opts.eol + childIndent)
            );
        } else {
            lines.push(indent + "- " + itemStr);
        }
    }

    // Remove leading indent from first line (caller handles it)
    if (level === 0) {
        return lines.join(opts.eol);
    }

    // For nested arrays, we want to return without the leading indent
    return lines.map((line) => line.slice(indent.length)).join(opts.eol);
}

/**
 * @param {Array<*>} arr
 * @param {YamlWriteOptions} opts
 * @returns {string}
 */
function writeFlowArray(arr, opts) {
    const items = [];
    for (let i = 0, len = arr.length; i < len; i++) {
        items.push(writeFlowValue(arr[i], opts));
    }
    return "[" + items.join(", ") + "]";
}

/**
 * @param {*} value
 * @param {YamlWriteOptions} opts
 * @returns {string}
 */
function writeFlowValue(value, opts) {
    if (value === null || value === undefined) {
        return "null";
    }
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    if (typeof value === "number") {
        if (Number.isNaN(value)) {
            return ".nan";
        }
        if (!Number.isFinite(value)) {
            return value > 0 ? ".inf" : "-.inf";
        }
        return String(value);
    }
    if (typeof value === "string") {
        if (
            value === "" ||
            /[\x00-\x1f\x7f-\x9f:,\[\]{}#&*!|>'"%@`]/.test(value) ||
            value.includes("\n") ||
            value.startsWith(" ") ||
            value.endsWith(" ")
        ) {
            return quoteString(value);
        }
        const lower = value.toLowerCase();
        if (lower === "null" || lower === "true" || lower === "false") {
            return quoteString(value);
        }
        if (/^[-+]?[0-9]/.test(value) || /^\./.test(value)) {
            return quoteString(value);
        }
        return value;
    }
    if (Array.isArray(value)) {
        return writeFlowArray(value, opts);
    }
    if (typeof value === "object") {
        return writeFlowObject(value, opts);
    }
    return String(value);
}

/**
 * @param {Object} obj
 * @param {number} level
 * @param {YamlWriteOptions} opts
 * @returns {string}
 */
function writeObject(obj, level, opts) {
    let keys = Object.keys(obj);

    if (keys.length === 0) {
        return "{}";
    }

    if (opts.sortKeys) {
        keys.sort();
    }

    // Use flow style if at or beyond flow level
    if (opts.flowLevel >= 0 && level >= opts.flowLevel) {
        return writeFlowObject(obj, opts);
    }

    const indent = " ".repeat(level * opts.indent);
    const childIndent = " ".repeat((level + 1) * opts.indent);
    const lines = [];

    for (let i = 0, len = keys.length; i < len; i++) {
        const key = keys[i];
        const value = obj[key];
        const keyStr = writeKey(key);
        const valueStr = writeValue(value, level + 1, opts);

        if (
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value) &&
            !(value instanceof Date) &&
            !(value instanceof Uint8Array) &&
            !(value instanceof Set)
        ) {
            // Nested object
            const nestedKeys = Object.keys(value);
            if (nestedKeys.length === 0) {
                lines.push(indent + keyStr + ": {}");
            } else {
                lines.push(
                    indent +
                        keyStr +
                        ":" +
                        opts.eol +
                        childIndent +
                        valueStr.replace(/\n/g, opts.eol + childIndent)
                );
            }
        } else if (Array.isArray(value) && value.length > 0) {
            lines.push(
                indent +
                    keyStr +
                    ":" +
                    opts.eol +
                    childIndent +
                    valueStr.replace(/\n/g, opts.eol + childIndent)
            );
        } else if (valueStr.includes("\n")) {
            lines.push(
                indent +
                    keyStr +
                    ":" +
                    opts.eol +
                    childIndent +
                    valueStr.replace(/\n/g, opts.eol + childIndent)
            );
        } else {
            lines.push(indent + keyStr + ": " + valueStr);
        }
    }

    // Remove leading indent from first line for nested objects
    if (level === 0) {
        return lines.join(opts.eol);
    }

    return lines.map((line) => line.slice(indent.length)).join(opts.eol);
}

/**
 * @param {Object} obj
 * @param {YamlWriteOptions} opts
 * @returns {string}
 */
function writeFlowObject(obj, opts) {
    let keys = Object.keys(obj);

    if (opts.sortKeys) {
        keys.sort();
    }

    const pairs = [];
    for (let i = 0, len = keys.length; i < len; i++) {
        const key = keys[i];
        const keyStr = writeKey(key);
        const valueStr = writeFlowValue(obj[key], opts);
        pairs.push(keyStr + ": " + valueStr);
    }

    return "{" + pairs.join(", ") + "}";
}

/**
 * @param {string} key
 * @returns {string}
 */
function writeKey(key) {
    // Check if key needs quoting
    if (key === "") {
        return '""';
    }

    // Reserved words
    const lower = key.toLowerCase();
    if (
        lower === "null" ||
        lower === "true" ||
        lower === "false" ||
        lower === "~" ||
        lower === ".nan" ||
        lower === ".inf"
    ) {
        return quoteString(key);
    }

    // Check for special characters
    if (
        /[\x00-\x1f\x7f-\x9f:,\[\]{}#&*!|>'"%@`\n\r\t]/.test(key) ||
        key.startsWith(" ") ||
        key.endsWith(" ") ||
        key.startsWith("-") ||
        key.startsWith("?")
    ) {
        return quoteString(key);
    }

    // Check if it looks like a number
    if (/^[-+]?[0-9]/.test(key) || /^\./.test(key)) {
        return quoteString(key);
    }

    return key;
}

// ---- File I/O ----

/**
 * Read and parse a YAML file with fallback on error.
 * @param {string} path - Path to the YAML file
 * @param {*} [fallback={}] - Value to return if file cannot be read or parsed
 * @returns {*} Parsed YAML value or fallback value
 */
function readYaml(path, fallback = {}) {
    try {
        const content = readFileSync(path, "utf8");
        return parseYaml(content, { filename: path });
    } catch {
        return fallback;
    }
}

/**
 * Read and parse all YAML documents from a file.
 * @param {string} path - Path to the YAML file
 * @param {*} [fallback=[]] - Value to return if file cannot be read or parsed
 * @returns {Array<*>} Array of parsed documents or fallback value
 */
function readYamlAll(path, fallback = []) {
    try {
        const content = readFileSync(path, "utf8");
        return parseYamlAll(content, { filename: path });
    } catch {
        return fallback;
    }
}

/**
 * Write value to a YAML file.
 * @param {string} path - Path where the YAML file should be written
 * @param {*} value - Value to serialize and write
 * @param {YamlWriteOptions} [options] - Write options
 * @returns {void}
 */
function writeYaml(path, value, options = {}) {
    const content = stringifyYaml(value, options);
    writeFileSync(path, content);
}

/**
 * Write multiple documents to a YAML file.
 * @param {string} path - Path where the YAML file should be written
 * @param {Array<*>} documents - Array of values to serialize
 * @param {YamlWriteOptions} [options] - Write options
 * @returns {void}
 */
function writeYamlAll(path, documents, options = {}) {
    const opts = { ...options };
    const eol = opts.eol || "\n";
    const parts = [];

    for (let i = 0, len = documents.length; i < len; i++) {
        if (i > 0) {
            parts.push("---");
        }
        parts.push(stringifyYaml(documents[i], opts).slice(0, -1)); // Remove trailing newline
    }

    writeFileSync(path, parts.join(eol) + eol);
}

/**
 * Remove YAML frontmatter if present.
 * This is only used for packet concatenation compatibility; do not rely on this
 * for extracting record-schema metadata blocks.
 * @param {string} markdown
 * @returns {string}
 */
function stripYamlFrontmatter(markdown) {
    return markdown.replace(/^---[\s\S]*?\n---\n?/, "");
}

export {
    YamlError,
    parseYaml,
    parseYamlAll,
    stringifyYaml,
    readYaml,
    readYamlAll,
    stripYamlFrontmatter,
    writeYaml,
    writeYamlAll
};
