/**
 * A zero-dependency PDF library in plain ES modules.
 *
 * Generates and reads PDFs: text/fonts/images, tables, interactive forms
 * (reading and filling AcroForm fields), attachments,
 * transparency, colour (RGB/CMYK/spot), encryption (RC4/AES-128/AES-256),
 * digital signatures (RSA/ECDSA/Ed25519), PDF/A-2b, tagged PDF, XMP metadata,
 * TrueType subsetting and OpenType-CFF embedding — plus a reader that stamps,
 * merges, splits, decrypts, extracts text, and redacts across classic and
 * cross-reference-stream files.
 *
 * Node built-ins only (node:zlib, node:crypto, node:test). No third-party deps.
 * @module pdf
 */

// Generation
export {
    PdfDocumentBuilder,
    getFontMetrics,
    measureTextWidth
} from "./document.mjs";
export {
    PdfContentStreamBuilder,
    drawHorizontalLine,
    drawFilledRect,
    drawStrokedRect
} from "./content-stream.mjs";
export { layoutTable } from "./table.mjs";

// Reading / editing
export { loadPdf, PdfEditor } from "./reader.mjs";
export { DictionaryEdits } from "./dictionary-edits.mjs";
export {
    parseValue,
    parseArrayItems,
    parseDictionaryEntries,
    dictionaryEntry,
    asName,
    asText,
    asNumber,
    asReference
} from "./object-values.mjs";
export {
    decodeTextStringBytes,
    encodeTextString,
    decodeName,
    encodeWinAnsi,
    isWinAnsiRepresentable
} from "./encoding/index.mjs";

// Interactive forms
export {
    readAcroForm,
    indexFieldsByName,
    fillFormFields,
    readFormValues,
    flattenFormFields,
    parseDefaultAppearance,
    resolveFormFont,
    measureFormText,
    COMMON_FIELD_FLAGS,
    TEXT_FIELD_FLAGS,
    BUTTON_FIELD_FLAGS,
    CHOICE_FIELD_FLAGS,
    ANNOTATION_FLAGS,
    hasFlag,
    buttonKindFromFlags
} from "./forms/index.mjs";

// Document transformation
export { mergePdfs, extractPages, removePages } from "./merge.mjs";
export { extractText } from "./extract-text.mjs";
export { redactRegions } from "./redact.mjs";
export { signPdf, buildCMS } from "./sign.mjs";

// Fonts / images (lower level; usually reached via the builder)
export { parseTtfFont } from "./font-embed.mjs";
export { parseWoff2 } from "./woff2-embed.mjs";
export { parseJpeg, parsePng } from "./image-embed.mjs";

export { verifyPdfSignatures, verifyCMS } from "./verify-signatures.mjs";
