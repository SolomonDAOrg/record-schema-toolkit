/** @typedef {{number: number, text: string, trimmed: string, heading: string | null, heading_level: number | null}} MarkdownLine */
/** @typedef {{line: number, level: number, text: string, slug: string, ancestors: string[]}} MarkdownHeading */
/** @typedef {{line: number, end_line: number, text: string, heading: string | null, heading_level: number | null}} MarkdownBlock */
/** @typedef {MarkdownBlock & {language: string, unterminated?: boolean}} MarkdownCodeBlock */
/** @typedef {{line: number, depth: number, ordered: boolean, ordinal: number | null, marker: string, text: string, heading: string | null, heading_level: number | null}} MarkdownListItem */
/** @typedef {{line: number, column: number, text: string, heading: string | null}} MarkdownInlineCode */
/** @typedef {{line: number, column: number, label: string, target: string, heading: string | null}} MarkdownLink */
/** @typedef {{line: number, cells: string[], values: Record<string, string>}} MarkdownTableRow */
/** @typedef {{line: number, end_line: number, heading: string | null, heading_level: number | null, headers: string[], rows: MarkdownTableRow[]}} MarkdownTable */
/** @typedef {{line: number, end_line: number, level: number, heading: string, slug: string, text: string, lines: string[]}} MarkdownSection */
/**
 * @typedef {Object} MarkdownAssertionDocument
 * @property {string} text
 * @property {string[]} lines
 * @property {MarkdownLine[]} line_records
 * @property {MarkdownHeading[]} headings
 * @property {MarkdownSection[]} sections
 * @property {MarkdownTable[]} tables
 * @property {MarkdownCodeBlock[]} code_blocks
 * @property {MarkdownListItem[]} list_items
 * @property {MarkdownBlock[]} blocks
 * @property {MarkdownBlock[]} paragraphs
 * @property {MarkdownInlineCode[]} inline_code
 * @property {MarkdownLink[]} links
 */
export {};
