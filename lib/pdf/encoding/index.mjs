/**
 * Character and text-string codecs shared by the PDF reader and writer.
 * @module Encoding
 */

export {
    decodeTextStringBytes,
    encodeTextString,
    decodeName
} from "./text-string.mjs";
export {
    winAnsiByteForCodePoint,
    encodeWinAnsi,
    isWinAnsiRepresentable
} from "./win-ansi.mjs";
