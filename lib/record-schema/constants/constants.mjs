/**
 * Consolidated constants extracted from record-schema module files.
 *
 * Sources: Document, DocumentMetadata, FormattingPack, RenderPack, Repository
 *
 * @module record-schema/constants
 */

// =============================================================================
// Document
// =============================================================================

/**
 * Unicode replacement pairs for canonical ASCII normalization.
 * Each entry is [unicodeChar, asciiReplacement].
 * @type {[string, string][]}
 */
const UNICODE_REPLACEMENTS = [
    ["\u2018", "'"],
    ["\u2019", "'"],
    ["\u201C", '"'],
    ["\u201D", '"'],
    ["\u2013", "-"],
    ["\u2014", "--"],
    ["\u2026", "..."],
    ["\u00A0", " "],
    ["\u2009", " "],
    ["\u200A", " "],
    ["\u200B", ""],
    ["\uFEFF", ""],
    ["\u2011", "-"], // non-breaking hyphen → regular hyphen
    ["\u2022", "[REPLACE]"] // bullet → overt placeholder
];

// =============================================================================
// DocumentMetadata
// =============================================================================

/** @type {string} */
const DOCUMENT_METADATA_BEGIN =
    "----------------------------BEGIN DOCUMENT METADATA-----------------------------";

/** @type {string} */
const DOCUMENT_METADATA_END =
    "-----------------------------END DOCUMENT METADATA------------------------------";

// =============================================================================
// FormattingPack
// =============================================================================

/** @type {string} */
const FORMATTING_PACK_SCHEMA_NAME = "record-schema-formatting-pack";

/** @type {number} */
const FORMATTING_PACK_SCHEMA_VERSION = 1;

// =============================================================================
// RenderPack
// =============================================================================

/** @type {string} */
const RENDER_PACK_SCHEMA_NAME = "record-schema-render-pack";

/** @type {number} */
const RENDER_PACK_SCHEMA_VERSION = 1;

// =============================================================================
// Shared (FormattingPack + RenderPack)
// =============================================================================

/** Validates pack_id format: lowercase alpha start, then alphanumeric/hyphens, min 3 chars
 * @type {RegExp}
 */
const PACK_ID_PATTERN = /^[a-z][a-z0-9-]{2,}$/;

/** Validates doc type codes: 2-5 uppercase alpha characters
 * @type {RegExp}
 */
const DOC_TYPE_PATTERN = /^[A-Z]{2,5}$/;

// =============================================================================
// Repository
// =============================================================================

/**
 * Well-known upstream schema file names to search for
 * @type {string[]}
 */
const UPSTREAM_FILENAMES = [
    "SCHEMA_UPSTREAM.yaml",
    "SCHEMA_UPSTREAM.yml",
    "schema_upstream.yaml",
    "schema_upstream.yml"
];

/**
 * Profile file suffix patterns
 * @type {string[]}
 */
const PROFILE_SUFFIX_PATTERNS = [".profile.yaml", ".profile.yml"];

/**
 * Well-known registry file names
 * @type {string[]}
 */
const REGISTRY_FILENAMES = [
    "registry.yaml",
    "registry.yml",
    "core-series.yaml",
    "doc-types.yaml"
];

export {
    UNICODE_REPLACEMENTS,
    DOCUMENT_METADATA_BEGIN,
    DOCUMENT_METADATA_END,
    FORMATTING_PACK_SCHEMA_NAME,
    FORMATTING_PACK_SCHEMA_VERSION,
    RENDER_PACK_SCHEMA_NAME,
    RENDER_PACK_SCHEMA_VERSION,
    PACK_ID_PATTERN,
    DOC_TYPE_PATTERN,
    UPSTREAM_FILENAMES,
    PROFILE_SUFFIX_PATTERNS,
    REGISTRY_FILENAMES
};
