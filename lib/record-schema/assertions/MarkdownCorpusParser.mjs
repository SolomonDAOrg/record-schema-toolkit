/**
 * Assertion-oriented Markdown projection.
 *
 * Rendering needs a rich AST. Corpus checks need stable source coordinates and
 * simple relational shapes: headings, sections, tables, code blocks, list
 * items, paragraphs, inline code, and links. This parser deliberately keeps
 * those concerns separate from the renderer parser.
 */

/**
 * @typedef {object} MarkdownLine
 * @property {number} number
 * @property {string} text
 * @property {string} trimmed
 * @property {string | null} heading
 * @property {number | null} heading_level
 */

/**
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
export function parseMarkdownForAssertions(text) {
    const sourceLines = text.split("\n");
    /** @type {MarkdownLine[]} */
    const lineRecords = [];
    /** @type {Record<string, unknown>[]} */
    const headings = [];
    /** @type {Record<string, unknown>[]} */
    const codeBlocks = [];
    /** @type {Record<string, unknown>[]} */
    const listItems = [];
    /** @type {Record<string, unknown>[]} */
    const paragraphs = [];
    /** @type {Record<string, unknown>[]} */
    const blocks = [];
    /** @type {Record<string, unknown>[]} */
    const inlineCode = [];
    /** @type {Record<string, unknown>[]} */
    const links = [];
    /** @type {Record<string, unknown>[]} */
    const tables = [];

    /** @type {{ text: string, level: number, line: number }[]} */
    const headingStack = [];
    let activeHeading = null;
    let activeHeadingLevel = null;
    let inFence = false;
    let fenceMarker = "";
    let fenceLanguage = "";
    let fenceStart = 0;
    /** @type {string[]} */
    let fenceLines = [];

    for (let i = 0, len = sourceLines.length; i < len; i++) {
        const raw = sourceLines[i];
        const trimmed = raw.trim();
        const lineNumber = i + 1;

        if (inFence) {
            if (trimmed.startsWith(fenceMarker)) {
                codeBlocks.push({
                    line: fenceStart,
                    end_line: lineNumber,
                    language: fenceLanguage,
                    text: fenceLines.join("\n"),
                    heading: activeHeading,
                    heading_level: activeHeadingLevel
                });
                inFence = false;
                fenceMarker = "";
                fenceLanguage = "";
                fenceLines = [];
            } else {
                fenceLines.push(raw);
            }
            lineRecords.push({
                number: lineNumber,
                text: raw,
                trimmed,
                heading: activeHeading,
                heading_level: activeHeadingLevel
            });
            continue;
        }

        const fence = /^(?<marker>`{3,}|~{3,})\s*(?<language>[^\s`]*)/.exec(
            trimmed
        );
        if (fence !== null && fence.groups !== undefined) {
            inFence = true;
            fenceMarker = fence.groups.marker[0];
            fenceLanguage = fence.groups.language ?? "";
            fenceStart = lineNumber;
            fenceLines = [];
            lineRecords.push({
                number: lineNumber,
                text: raw,
                trimmed,
                heading: activeHeading,
                heading_level: activeHeadingLevel
            });
            continue;
        }

        const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(trimmed);
        if (heading !== null) {
            const level = heading[1].length;
            const headingText = heading[2].trim();
            while (
                headingStack.length > 0 &&
                headingStack[headingStack.length - 1].level >= level
            ) {
                headingStack.pop();
            }
            headingStack.push({ text: headingText, level, line: lineNumber });
            activeHeading = headingText;
            activeHeadingLevel = level;
            headings.push({
                line: lineNumber,
                level,
                text: headingText,
                slug: slugify(headingText),
                ancestors: headingStack
                    .slice(0, -1)
                    .map((entry) => entry.text)
            });
        }

        lineRecords.push({
            number: lineNumber,
            text: raw,
            trimmed,
            heading: activeHeading,
            heading_level: activeHeadingLevel
        });

        const list = /^(\s*)(?:([-+*])|(\d+)[.)])\s+(.+)$/.exec(raw);
        if (list !== null) {
            listItems.push({
                line: lineNumber,
                depth: indentationWidth(list[1]),
                ordered: list[3] !== undefined,
                ordinal:
                    list[3] === undefined ? null : Number.parseInt(list[3], 10),
                marker: list[2] ?? `${list[3]}.`,
                text: list[4],
                heading: activeHeading,
                heading_level: activeHeadingLevel
            });
        }

        collectInline(raw, lineNumber, activeHeading, inlineCode, links);
    }

    if (inFence) {
        codeBlocks.push({
            line: fenceStart,
            end_line: sourceLines.length,
            language: fenceLanguage,
            text: fenceLines.join("\n"),
            heading: activeHeading,
            heading_level: activeHeadingLevel,
            unterminated: true
        });
    }

    collectParagraphs(lineRecords, paragraphs);
    collectBlocks(lineRecords, blocks);
    collectTables(lineRecords, tables);
    const sections = collectSections(headings, sourceLines);

    return {
        text,
        lines: sourceLines,
        line_records: lineRecords,
        headings,
        sections,
        tables,
        code_blocks: codeBlocks,
        list_items: listItems,
        blocks,
        paragraphs,
        inline_code: inlineCode,
        links
    };
}

/**
 * @param {MarkdownLine[]} lines
 * @param {Record<string, unknown>[]} blocks
 * @returns {void}
 */
function collectBlocks(lines, blocks) {
    let start = -1;
    /** @type {string[]} */
    let content = [];
    let heading = null;
    let headingLevel = null;

    const flush = (endLine) => {
        if (start === -1) return;
        blocks.push({
            line: start,
            end_line: endLine,
            text: content.join("\n"),
            heading,
            heading_level: headingLevel
        });
        start = -1;
        content = [];
        heading = null;
        headingLevel = null;
    };

    for (let i = 0, len = lines.length; i < len; i++) {
        const row = lines[i];
        if (row.trimmed.length === 0) {
            flush(row.number - 1);
            continue;
        }
        if (start === -1) {
            start = row.number;
            heading = row.heading;
            headingLevel = row.heading_level;
        }
        content.push(row.text);
    }
    flush(lines.length);
}

/**
 * @param {string} raw
 * @param {number} line
 * @param {string | null} heading
 * @param {Record<string, unknown>[]} inlineCode
 * @param {Record<string, unknown>[]} links
 * @returns {void}
 */
function collectInline(raw, line, heading, inlineCode, links) {
    const codeExpression = /`([^`\n]+)`/g;
    for (;;) {
        const match = codeExpression.exec(raw);
        if (match === null) break;
        inlineCode.push({
            line,
            column: match.index + 1,
            text: match[1],
            heading
        });
        if (match[0].length === 0) codeExpression.lastIndex += 1;
    }

    const linkExpression = /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    for (;;) {
        const match = linkExpression.exec(raw);
        if (match === null) break;
        links.push({
            line,
            column: match.index + 1,
            label: match[1],
            target: match[2],
            heading
        });
        if (match[0].length === 0) linkExpression.lastIndex += 1;
    }
}

/**
 * @param {MarkdownLine[]} lines
 * @param {Record<string, unknown>[]} paragraphs
 * @returns {void}
 */
function collectParagraphs(lines, paragraphs) {
    let start = -1;
    /** @type {string[]} */
    let content = [];
    let heading = null;
    let headingLevel = null;

    const flush = (endLine) => {
        if (start === -1) return;
        paragraphs.push({
            line: start,
            end_line: endLine,
            text: content.join("\n"),
            heading,
            heading_level: headingLevel
        });
        start = -1;
        content = [];
        heading = null;
        headingLevel = null;
    };

    let inFence = false;
    let fenceCharacter = "";
    for (let i = 0, len = lines.length; i < len; i++) {
        const row = lines[i];
        const fence = /^(`{3,}|~{3,})/.exec(row.trimmed);
        if (fence !== null) {
            flush(row.number - 1);
            if (!inFence) {
                inFence = true;
                fenceCharacter = fence[1][0];
            } else if (fence[1][0] === fenceCharacter) {
                inFence = false;
                fenceCharacter = "";
            }
            continue;
        }
        if (inFence) continue;

        if (
            row.trimmed.length === 0 ||
            /^#{1,6}\s+/.test(row.trimmed) ||
            /^(?:\s*)(?:[-+*]|\d+[.)])\s+/.test(row.text) ||
            isTableCandidate(row.text) ||
            /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(row.text)
        ) {
            flush(row.number - 1);
            continue;
        }

        if (start === -1) {
            start = row.number;
            heading = row.heading;
            headingLevel = row.heading_level;
        }
        content.push(row.text);
    }
    flush(lines.length);
}

/**
 * @param {MarkdownLine[]} lines
 * @param {Record<string, unknown>[]} tables
 * @returns {void}
 */
function collectTables(lines, tables) {
    for (let i = 0, len = lines.length - 1; i < len; i++) {
        if (!isTableCandidate(lines[i].text)) continue;
        const headerCells = splitTableRow(lines[i].text);
        const delimiterCells = splitTableRow(lines[i + 1].text);
        if (
            headerCells.length === 0 ||
            headerCells.length !== delimiterCells.length ||
            !delimiterCells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
        ) {
            continue;
        }

        /** @type {Record<string, unknown>[]} */
        const rows = [];
        let cursor = i + 2;
        while (cursor < lines.length && isTableCandidate(lines[cursor].text)) {
            const cells = splitTableRow(lines[cursor].text);
            if (cells.length !== headerCells.length) break;
            /** @type {Record<string, string>} */
            const values = {};
            for (let j = 0, count = headerCells.length; j < count; j++) {
                values[headerCells[j].trim()] = cells[j].trim();
            }
            rows.push({
                line: lines[cursor].number,
                cells: cells.map((cell) => cell.trim()),
                values
            });
            cursor += 1;
        }

        tables.push({
            line: lines[i].number,
            end_line: cursor,
            heading: lines[i].heading,
            heading_level: lines[i].heading_level,
            headers: headerCells.map((cell) => cell.trim()),
            rows
        });
        i = cursor - 1;
    }
}

/**
 * @param {Record<string, unknown>[]} headings
 * @param {string[]} lines
 * @returns {Record<string, unknown>[]}
 */
function collectSections(headings, lines) {
    /** @type {Record<string, unknown>[]} */
    const sections = [];
    for (let i = 0, len = headings.length; i < len; i++) {
        const heading = headings[i];
        const level = Number(heading.level);
        const start = Number(heading.line);
        let end = lines.length;
        for (let j = i + 1; j < len; j++) {
            if (Number(headings[j].level) <= level) {
                end = Number(headings[j].line) - 1;
                break;
            }
        }
        sections.push({
            line: start,
            end_line: end,
            level,
            heading: heading.text,
            slug: heading.slug,
            text: lines.slice(start, end).join("\n"),
            lines: lines.slice(start, end)
        });
    }
    return sections;
}

/**
 * @param {string} line
 * @returns {boolean}
 */
function isTableCandidate(line) {
    const trimmed = line.trim();
    return trimmed.includes("|") && !/^```|^~~~/.test(trimmed);
}

/**
 * @param {string} line
 * @returns {string[]}
 */
function splitTableRow(line) {
    let text = line.trim();
    if (text.startsWith("|")) text = text.slice(1);
    if (text.endsWith("|")) text = text.slice(0, -1);

    /** @type {string[]} */
    const cells = [];
    let current = "";
    let escaped = false;
    let code = false;
    for (let i = 0, len = text.length; i < len; i++) {
        const character = text[i];
        if (escaped) {
            current += character;
            escaped = false;
            continue;
        }
        if (character === "\\") {
            current += character;
            escaped = true;
            continue;
        }
        if (character === "`") {
            code = !code;
            current += character;
            continue;
        }
        if (character === "|" && !code) {
            cells.push(current);
            current = "";
            continue;
        }
        current += character;
    }
    cells.push(current);
    return cells;
}

/**
 * @param {string} text
 * @returns {number}
 */
function indentationWidth(text) {
    let width = 0;
    for (let i = 0, len = text.length; i < len; i++) {
        width += text[i] === "\t" ? 4 : 1;
    }
    return width;
}

/**
 * @param {string} text
 * @returns {string}
 */
function slugify(text) {
    return text
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
}
