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

const RE_ATTR = /([a-zA-Z_][\w:.-]*)=(?:"([^"]*)"|'([^']*)')/g;

/**
 * @param {string} s
 * @returns {string}
 */
function _xmlDecode(s) {
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
function _parseAttrs(attrStr) {
    /** @type {Record<string, string>} */
    const out = {};
    let m;
    RE_ATTR.lastIndex = 0;
    while ((m = RE_ATTR.exec(attrStr)) !== null) {
        out[m[1]] = _xmlDecode(m[2] !== undefined ? m[2] : m[3]);
    }
    return out;
}

/**
 * Find the closing `>` of a tag, skipping `>` inside quoted attribute values.
 * @param {string} xml
 * @param {number} start  - position just after `<`
 * @returns {number}
 */
function _findTagEnd(xml, start) {
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
function _tokenize(xml) {
    /** @type {XmlTokenOrTag[]} */
    const tokens = [];
    let i = 0;
    const len = xml.length;

    while (i < len) {
        if (xml[i] !== "<") {
            const end = xml.indexOf("<", i);
            const raw = xml.slice(i, end === -1 ? len : end);
            const text = _xmlDecode(raw);
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
            const end = _findTagEnd(xml, i + 2);
            i = end + 1;
            continue;
        }

        const tagEnd = _findTagEnd(xml, i + 1);
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
                attrs: _parseAttrs(attrStr)
            });
        } else {
            tokens.push({
                type: "open",
                tag: tagName,
                attrs: _parseAttrs(attrStr)
            });
        }

        i = tagEnd + 1;
    }

    return tokens;
}

/**
 * Build an element tree from a flat token stream.
 * @param {ReturnType<typeof _tokenize>} tokens
 * @returns {SvgElement}
 */
function _buildTree(tokens) {
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
function parseSvg(svgContent) {
    return _buildTree(_tokenize(svgContent));
}

export { parseSvg };
