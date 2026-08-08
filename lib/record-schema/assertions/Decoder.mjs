/**
 * Golden decoding for corpus assertions.
 *
 * Every other rule kind compares a declaration against a declaration. This one
 * reads bytes: it takes a hex test vector, the packed layout the corpus says
 * those bytes carry, and the symbolic values the vector claims decoding will
 * produce, and it checks that the three agree. A layout can be internally
 * consistent, echo the same width everywhere, and still describe bytes nobody
 * ever wrote; that is the defect this kind exists for.
 *
 * The decoder is deliberately dumb about semantics. It knows offsets, widths,
 * and endianness. It does not know what a field means, and a corpus wanting a
 * codec beyond fixed-width integers should declare the decoded bytes and assert
 * over them rather than teach this file a format.
 *
 * @module record-schema/assertions/Decoder
 */

import { evaluatePath, evaluatePathFirst } from "./Path.mjs";
import { coerceNumber } from "./Predicate.mjs";

/**
 * @typedef {object} DecodeRequest
 * @property {string} hex
 * @property {unknown} layout
 * @property {string} fieldsPath
 * @property {string} fieldName
 * @property {string} fieldOffset
 * @property {string} fieldWidth
 * @property {string} fieldEncoding
 * @property {string} [fieldConst]
 */

/**
 * @typedef {object} DecodeResult
 * @property {Record<string, unknown>} fields
 * @property {Record<string, unknown>} constants
 * @property {number} byte_length
 * @property {string | null} error
 */

/**
 * Decode a hex string against a declared layout.
 *
 * @param {DecodeRequest} request
 * @returns {DecodeResult}
 */
export function decodeLayout(request) {
    const bytes = parseHex(request.hex);
    if (bytes === null) {
        return {
            fields: {},
            constants: {},
            byte_length: 0,
            error: `"${truncate(request.hex)}" is not a hex byte string`
        };
    }

    const fieldMatches = evaluatePath(request.layout, request.fieldsPath);

    /** @type {Record<string, unknown>} */
    const fields = {};

    // A member declaring a fixed value states the same physical fact twice:
    // once in the layout and once in every fixture's bytes. Collecting the
    // declared values here is what lets the caller check the two against each
    // other - the QRY-00001 contradiction was exactly this, a constant saying 2
    // beside header bytes saying 1.
    /** @type {Record<string, unknown>} */
    const constants = {};
    let cursor = 0;

    for (let i = 0, len = fieldMatches.length; i < len; i++) {
        const field = fieldMatches[i].value;

        const name = evaluatePathFirst(field, request.fieldName);
        if (typeof name !== "string") {
            continue;
        }

        const widthValue = coerceNumber(
            evaluatePathFirst(field, request.fieldWidth)
        );
        if (widthValue === null) {
            return {
                fields,
                constants,
                byte_length: bytes.length,
                error: `field "${name}" declares no decodable width`
            };
        }

        const declaredOffset = coerceNumber(
            evaluatePathFirst(field, request.fieldOffset)
        );
        const offset = declaredOffset === null ? cursor : declaredOffset;

        if (offset + widthValue > bytes.length) {
            return {
                fields,
                constants,
                byte_length: bytes.length,
                error: `field "${name}" spans bytes ${offset}..${
                    offset + widthValue
                } of a ${bytes.length}-byte vector`
            };
        }

        const encoding = evaluatePathFirst(field, request.fieldEncoding);
        fields[name] = decodeField(
            bytes,
            offset,
            widthValue,
            typeof encoding === "string" ? encoding : null
        );

        if (request.fieldConst !== undefined) {
            const declared = evaluatePathFirst(field, request.fieldConst);
            if (declared !== undefined && declared !== null) {
                constants[name] = declared;
            }
        }

        cursor = offset + widthValue;
    }

    return { fields, constants, byte_length: bytes.length, error: null };
}

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @param {number} width
 * @param {string | null} encoding
 * @returns {unknown}
 */
function decodeField(bytes, offset, width, encoding) {
    const slice = bytes.subarray(offset, offset + width);
    const form = normaliseEncoding(encoding, width);

    if (form === "hex") {
        return toHex(slice);
    }
    if (form === "ascii") {
        return trimNull(Buffer.from(slice).toString("latin1"));
    }
    if (form === "utf8") {
        return trimNull(Buffer.from(slice).toString("utf8"));
    }
    if (form === "bool") {
        return slice.some((byte) => byte !== 0);
    }

    const bigEndian = form.endsWith("be");
    const signed = form.startsWith("i");

    if (width > 8) {
        return toHex(slice);
    }

    let value = 0n;
    for (let i = 0; i < width; i++) {
        const byte = bigEndian ? slice[i] : slice[width - 1 - i];
        value = (value << 8n) | BigInt(byte);
    }

    if (signed && width > 0) {
        const bits = BigInt(width * 8);
        const limit = 1n << (bits - 1n);
        if (value >= limit) {
            value -= 1n << bits;
        }
    }

    return value <= BigInt(Number.MAX_SAFE_INTEGER) &&
        value >= BigInt(Number.MIN_SAFE_INTEGER)
        ? Number(value)
        : value.toString();
}

/**
 * @param {string | null} encoding
 * @param {number} width
 * @returns {string}
 */
function normaliseEncoding(encoding, width) {
    if (encoding === null) {
        return width > 8 ? "hex" : "ule";
    }

    const text = encoding.trim().toLowerCase();

    if (text === "hex" || text === "bytes" || text === "opaque") {
        return "hex";
    }
    if (text === "ascii" || text === "char") {
        return "ascii";
    }
    if (text === "utf8" || text === "utf-8" || text === "string") {
        return "utf8";
    }
    if (text === "bool" || text === "boolean" || text === "flag") {
        return "bool";
    }
    if (/^u(?:int)?\d*_?be$/.test(text) || text === "be") {
        return "ube";
    }
    if (/^i(?:nt)?\d*_?be$/.test(text) || text === "i_be") {
        return "ibe";
    }
    if (/^i(?:nt)?\d*(?:_?le)?$/.test(text)) {
        return "ile";
    }
    return "ule";
}

/**
 * @param {string} text
 * @returns {Uint8Array | null}
 */
export function parseHex(text) {
    const cleaned = text
        .trim()
        .replace(/^0[xX]/, "")
        .replace(/[\s_:,-]/g, "");

    if (cleaned.length === 0 || cleaned.length % 2 !== 0) {
        return null;
    }
    if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
        return null;
    }

    const bytes = new Uint8Array(cleaned.length / 2);
    for (let i = 0, len = bytes.length; i < len; i++) {
        bytes[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function toHex(bytes) {
    let out = "";
    for (let i = 0, len = bytes.length; i < len; i++) {
        out += bytes[i].toString(16).padStart(2, "0");
    }
    return out;
}

/**
 * @param {string} text
 * @returns {string}
 */
function trimNull(text) {
    const end = text.indexOf("\u0000");
    return end === -1 ? text : text.slice(0, end);
}

/**
 * @param {string} text
 * @returns {string}
 */
function truncate(text) {
    return text.length > 32 ? `${text.slice(0, 32)}…` : text;
}
