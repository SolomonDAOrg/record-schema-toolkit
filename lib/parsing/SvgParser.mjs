// =============================================================================
// Minimal hand-rolled XML tokenizer + tree builder
// =============================================================================

// =============================================================================
// Type definitions
// =============================================================================

/**
 * @typedef {Object} SvgElement
 * @property {string} tag
 * @property {Record<string, string>} attrs
 * @property {SvgElement[]} children
 * @property {string} text - Concatenated direct text content.
 */

/**
 * @typedef {"open" | "close" | "self"} XmlTokenType
 */

/**
 * @typedef {Object} XmlToken
 * @property {XmlTokenType} type
 * @property {string} tag
 * @property {Record<string, string>} attrs
 */

/**
 * @typedef {Object} XmlTag
 * @property {"text"} type
 * @property {string} text
 */

/**
 * @typedef {XmlToken | XmlTag} XmlTokenOrTag
 */

/**
 * @typedef {{command: 'M' | 'L'; x: number; y: number} | {command: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number} | {command: 'Z'}} SvgPathSegment
 */

const RE_ATTR = /([a-zA-Z_][\w:.-]*)=(?:"([^"]*)"|'([^']*)')/g;

export class SvgParser {
    /**
     * @param {string} s
     * @returns {string}
     */
    static decodeXml(s) {
        return s
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'");
    }

    /**
     * Parse an attribute string into a flat record.
     * @param {string} attrStr
     * @returns {Record<string, string>}
     */
    static parseAttributes(attrStr) {
        /** @type {Record<string, string>} */
        const out = {};
        let m;
        RE_ATTR.lastIndex = 0;
        while ((m = RE_ATTR.exec(attrStr)) !== null) {
            out[m[1]] = SvgParser.decodeXml(m[2] !== undefined ? m[2] : m[3]);
        }
        return out;
    }

    /**
     * Find the closing `>` of a tag, skipping `>` inside quoted attribute values.
     * @param {string} xml
     * @param {number} start  - position just after `<`
     * @returns {number}
     */
    static findTagEnd(xml, start) {
        let inS = false,
            inD = false;
        for (let i = start, len = xml.length; i < len; i++) {
            const c = xml[i];
            if (c === "'" && !inD) {
                inS = !inS;
            } else if (c === '"' && !inS) {
                inD = !inD;
            } else if (c === ">" && !inS && !inD) {
                return i;
            }
        }
        return xml.length;
    }

    /**
     * Tokenize an XML/SVG string.
     * Comments, CDATA, processing instructions, and DTD nodes are skipped.
     *
     * @param {string} xml
     * @returns {XmlTokenOrTag[]}
     */
    static tokenize(xml) {
        /** @type {XmlTokenOrTag[]} */
        const tokens = [];
        let i = 0;
        const len = xml.length;

        while (i < len) {
            if (xml[i] !== "<") {
                const end = xml.indexOf("<", i);
                const raw = xml.slice(i, end === -1 ? len : end);
                const text = SvgParser.decodeXml(raw);
                if (text.trim().length > 0) {
                    tokens.push({ type: "text", text });
                }
                i = end === -1 ? len : end;
                continue;
            }

            if (xml.startsWith("<!--", i)) {
                const end = xml.indexOf("-->", i + 4);
                i = end === -1 ? len : end + 3;
                continue;
            }
            if (xml.startsWith("<![CDATA[", i)) {
                const end = xml.indexOf("]]>", i + 9);
                i = end === -1 ? len : end + 3;
                continue;
            }
            if (xml[i + 1] === "!" || xml[i + 1] === "?") {
                const end = SvgParser.findTagEnd(xml, i + 2);
                i = end + 1;
                continue;
            }

            const tagEnd = SvgParser.findTagEnd(xml, i + 1);
            const raw = xml.slice(i + 1, tagEnd).trim();
            const isSelf = raw.endsWith("/");
            const isClose = raw.startsWith("/");
            const body = (
                isSelf ? raw.slice(0, -1) : isClose ? raw.slice(1) : raw
            ).trim();

            const spIdx = body.search(/[\s/]/);
            const tagName = (
                spIdx === -1 ? body : body.slice(0, spIdx)
            ).toLowerCase();
            const attrStr = spIdx === -1 ? "" : body.slice(spIdx);

            if (isClose) {
                tokens.push({ type: "close", tag: tagName, attrs: {} });
            } else if (isSelf) {
                tokens.push({
                    type: "self",
                    tag: tagName,
                    attrs: SvgParser.parseAttributes(attrStr)
                });
            } else {
                tokens.push({
                    type: "open",
                    tag: tagName,
                    attrs: SvgParser.parseAttributes(attrStr)
                });
            }

            i = tagEnd + 1;
        }

        return tokens;
    }

    /**
     * Build an element tree from a flat token stream.
     * @param {XmlTokenOrTag[]} tokens
     * @returns {SvgElement}
     */
    static buildTree(tokens) {
        /** @type {SvgElement} */
        const root = { tag: "#root", attrs: {}, children: [], text: "" };
        const stack = [root];

        for (let i = 0, len = tokens.length; i < len; i++) {
            const tok = tokens[i];
            const parent = stack[stack.length - 1];

            if (tok.type === "text") {
                parent.text += tok.text;
            } else if (tok.type === "self") {
                parent.children.push({
                    tag: tok.tag,
                    attrs: tok.attrs,
                    children: [],
                    text: ""
                });
            } else if (tok.type === "open") {
                /** @type {SvgElement} */
                const el = {
                    tag: tok.tag,
                    attrs: tok.attrs,
                    children: [],
                    text: ""
                };
                parent.children.push(el);
                stack.push(el);
            } else if (tok.type === "close" && stack.length > 1) {
                stack.pop();
            }
        }

        return root;
    }

    /**
     * Parse an SVG/XML string into an element tree.
     * @param {string} svgContent
     * @returns {SvgElement}
     */
    static parse(svgContent) {
        return SvgParser.buildTree(SvgParser.tokenize(svgContent));
    }

    /**
     * Normalize SVG line, cubic and quadratic commands to absolute PDF-compatible paths.
     * Unsupported commands and malformed coordinates fail before any path is painted.
     * @param {string} source
     * @returns {SvgPathSegment[]}
     */
    static parseSvgPath(source) {
        const tokens = [];
        const tokenPattern =
            /[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
        let end = 0;
        for (const match of source.matchAll(tokenPattern)) {
            if (!/^[\s,]*$/.test(source.slice(end, match.index)))
                throw new Error("Invalid SVG path token");
            tokens.push(match[0]);
            end = match.index + match[0].length;
        }
        if (!/^[\s,]*$/.test(source.slice(end)))
            throw new Error("Invalid SVG path token");
        /** @type {SvgPathSegment[]} */
        const segments = [];
        /** @type {Record<string, number>} */
        const argumentCounts = {
            M: 2,
            L: 2,
            H: 1,
            V: 1,
            C: 6,
            S: 4,
            Q: 4,
            T: 2
        };
        let index = 0,
            command = "",
            previous = "";
        let x = 0,
            y = 0,
            startX = 0,
            startY = 0;
        let controlX = 0,
            controlY = 0;
        while (index < tokens.length) {
            if (/^[a-zA-Z]$/.test(tokens[index])) command = tokens[index++];
            const upper = command.toUpperCase();
            const relative = command !== upper;
            if (segments.length === 0 && upper !== "M")
                throw new Error("SVG path must start with moveto");
            if (upper === "Z") {
                segments.push({ command: "Z" });
                x = startX;
                y = startY;
                previous = upper;
                command = "";
                continue;
            }
            const count = argumentCounts[upper];
            if (!count)
                throw new Error(
                    `Unsupported SVG path command: ${command || "(missing)"}`
                );
            const arguments_ = tokens.slice(index, index + count);
            if (
                arguments_.length !== count ||
                arguments_.some(
                    (value) =>
                        /^[a-zA-Z]$/.test(value) ||
                        !Number.isFinite(Number(value))
                )
            ) {
                throw new Error(`Invalid SVG path coordinates for ${command}`);
            }
            index += count;
            const values = arguments_.map(Number);
            const offsetX = relative ? x : 0,
                offsetY = relative ? y : 0;
            if (upper === "M" || upper === "L") {
                x = values[0] + offsetX;
                y = values[1] + offsetY;
                segments.push({ command: upper, x, y });
                if (upper === "M") {
                    startX = x;
                    startY = y;
                    command = relative ? "l" : "L";
                }
            } else if (upper === "H" || upper === "V") {
                if (upper === "H") x = values[0] + offsetX;
                else y = values[0] + offsetY;
                segments.push({ command: "L", x, y });
            } else if (upper === "C" || upper === "S") {
                const smooth = upper === "S";
                const reflect =
                    smooth && (previous === "C" || previous === "S");
                const x1 = smooth
                    ? reflect
                        ? 2 * x - controlX
                        : x
                    : values[0] + offsetX;
                const y1 = smooth
                    ? reflect
                        ? 2 * y - controlY
                        : y
                    : values[1] + offsetY;
                const position = smooth ? 0 : 2;
                controlX = values[position] + offsetX;
                controlY = values[position + 1] + offsetY;
                x = values[position + 2] + offsetX;
                y = values[position + 3] + offsetY;
                segments.push({
                    command: "C",
                    x1,
                    y1,
                    x2: controlX,
                    y2: controlY,
                    x,
                    y
                });
            } else {
                const smooth = upper === "T";
                const reflect =
                    smooth && (previous === "Q" || previous === "T");
                controlX = smooth
                    ? reflect
                        ? 2 * x - controlX
                        : x
                    : values[0] + offsetX;
                controlY = smooth
                    ? reflect
                        ? 2 * y - controlY
                        : y
                    : values[1] + offsetY;
                const position = smooth ? 0 : 2;
                const nextX = values[position] + offsetX,
                    nextY = values[position + 1] + offsetY;
                segments.push({
                    command: "C",
                    x1: x + ((controlX - x) * 2) / 3,
                    y1: y + ((controlY - y) * 2) / 3,
                    x2: nextX + ((controlX - nextX) * 2) / 3,
                    y2: nextY + ((controlY - nextY) * 2) / 3,
                    x: nextX,
                    y: nextY
                });
                x = nextX;
                y = nextY;
            }
            previous = upper;
        }
        return segments;
    }
}
