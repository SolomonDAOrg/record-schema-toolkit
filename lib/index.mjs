/**
 * record-schema-toolkit
 *
 * A toolkit for managing record schemas, formatting, linting, and validation.
 *
 * @module record-schema-toolkit
 */

// Constants
export {
    DOCUMENT_METADATA_BEGIN,
    DOCUMENT_METADATA_END
} from "./record-schema/constants/constants.mjs";

// General utilities
export { toPosixPath, relPosix } from "./util/files.mjs";

export { globToRegExp, matchGlob } from "./util/glob.mjs";

// Markdown
export {
    groupListItems,
    parseInlineContent,
    parseCodeBlock,
    parseParagraph,
    extractKeyAndSummary,
    findStarPattern,
    parseHeading,
    parseListItem,
    parseMarkdownDoc,
    buildAnchorIndex,
    buildSummaryForKey,
    getAnchorIdForNode,
    getEntryByKey,
    extractTextContent,
    walkNodes,
    findNodesByType,
    isTableLine,
    containsUrl,
    isHashLike,
    findLongLinesMarkdown,
    isHeading,
    isBlockquote,
    isHorizontalRule,
    isListItem,
    isCodeFenceStart,
    isPageBreakCommentLine,
    wrapText,
    reflowMarkdown
} from "./parsing/markdown.mjs";

// Linting
export {
    normalizeBaseline,
    normalizeCanonicalAscii,
    normalizeEol,
    normalizeTrailingWhitespace,
    ensureFinalNewline,
    findNonAscii,
    trimBom
} from "./record-schema/util/normalization.mjs";

// yaml
export {
    parseYaml,
    parseYamlAll,
    stringifyYaml,
    readYaml,
    readYamlAll,
    writeYaml,
    writeYamlAll,
    YamlError
} from "./parsing/yaml.mjs";

// record-schema library
export { Chart } from "./record-schema/Chart.mjs";

export { Document } from "./record-schema/Document.mjs";

export { DocumentMetadata } from "./record-schema/DocumentMetadata.mjs";

export { FilingPacketGenerator } from "./record-schema/generators/FilingPacketGenerator.mjs";

export { FormattingPack } from "./record-schema/FormattingPack.mjs";

export { IndManager } from "./record-schema/IndManager.mjs";

export { Metafile } from "./record-schema/Metafile.mjs";

export {
    getEntryPath,
    getEntryPrecedence,
    rulesetMatchesFile
} from "./record-schema/PackUtils.mjs";

export { Profile } from "./record-schema/Profile.mjs";

export { Registry } from "./record-schema/Registry.mjs";

export { RenderPack } from "./record-schema/RenderPack.mjs";

export { Repository } from "./record-schema/Repository.mjs";

export { Schema } from "./record-schema/Schema.mjs";
