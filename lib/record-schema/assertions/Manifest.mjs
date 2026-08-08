/**
 * Deterministic file inventories and domain-separated corpus commitments.
 *
 * The checker and writer share this module. A manifest generator that computes
 * a different root from the validator is worse than no generator because a
 * freshly written manifest can immediately validate under the wrong contract.
 */

import { createHash } from "node:crypto";

/** @typedef {import("./types/general.mjs").CorpusUnit} CorpusUnit */

/**
 * @typedef {object} DigestEntry
 * @property {string} path
 * @property {string} digest
 * @property {Uint8Array} digest_bytes
 */

/**
 * @typedef {object} CommitmentConfiguration
 * @property {number | number[] | string} [domain]
 * @property {"none" | "u16le" | "u16be" | "u32le" | "u32be" | "varuint"} [path_length]
 * @property {boolean} [include_path]
 * @property {boolean} [include_digest]
 * @property {string} [algorithm]
 */

/**
 * Hash tracked units in deterministic path order.
 *
 * @param {CorpusUnit[]} units
 * @param {string} [algorithm]
 * @returns {DigestEntry[]}
 */
export function buildDigestEntries(units, algorithm = "sha256") {
    const sorted = units.slice().sort((left, right) =>
        left.file < right.file ? -1 : left.file > right.file ? 1 : 0
    );
    /** @type {DigestEntry[]} */
    const entries = [];
    for (let i = 0, len = sorted.length; i < len; i++) {
        const digest = createHash(algorithm).update(sorted[i].bytes).digest();
        const digestBytes = new Uint8Array(
            digest.buffer,
            digest.byteOffset,
            digest.byteLength
        );
        entries.push({
            path: sorted[i].file,
            digest: bytesToHex(digestBytes),
            digest_bytes: digestBytes
        });
    }
    return entries;
}

/**
 * Compute the manifest root over path/digest entries.
 *
 * @param {DigestEntry[]} entries
 * @param {CommitmentConfiguration} [configuration]
 * @returns {string}
 */
export function computeDigestCommitment(entries, configuration = {}) {
    const algorithm = String(configuration.algorithm ?? "sha256");
    const hash = createHash(algorithm);
    const domain = encodeDomain(configuration.domain);
    if (domain.length > 0) hash.update(domain);

    const includePath = configuration.include_path !== false;
    const includeDigest = configuration.include_digest !== false;
    const lengthEncoding = String(configuration.path_length ?? "u16le");
    const encoder = new TextEncoder();

    const sorted = entries.slice().sort((left, right) =>
        left.path < right.path ? -1 : left.path > right.path ? 1 : 0
    );
    for (let i = 0, len = sorted.length; i < len; i++) {
        const entry = sorted[i];
        const pathBytes = encoder.encode(entry.path);
        if (includePath) {
            const lengthBytes = encodeLength(pathBytes.length, lengthEncoding);
            if (lengthBytes.length > 0) hash.update(lengthBytes);
            hash.update(pathBytes);
        }
        if (includeDigest) hash.update(entry.digest_bytes);
    }
    return hash.digest("hex");
}

/**
 * Convert a hexadecimal digest to bytes.
 *
 * @param {string} value
 * @returns {Uint8Array | null}
 */
export function hexToBytes(value) {
    if (!/^[0-9a-fA-F]*$/.test(value) || value.length % 2 !== 0) return null;
    const out = new Uint8Array(value.length / 2);
    for (let i = 0, len = out.length; i < len; i++) {
        out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

/**
 * @param {Uint8Array} value
 * @returns {string}
 */
export function bytesToHex(value) {
    let out = "";
    for (let i = 0, len = value.length; i < len; i++) {
        out += value[i].toString(16).padStart(2, "0");
    }
    return out;
}

/**
 * @param {number | number[] | string | undefined} value
 * @returns {Uint8Array}
 */
function encodeDomain(value) {
    if (value === undefined || value === null || value === "") {
        return new Uint8Array(0);
    }
    if (typeof value === "number") {
        if (!Number.isInteger(value) || value < 0 || value > 255) {
            throw new Error("commitment domain number must be one byte");
        }
        return Uint8Array.of(value);
    }
    if (Array.isArray(value)) {
        const out = new Uint8Array(value.length);
        for (let i = 0, len = value.length; i < len; i++) {
            const item = Number(value[i]);
            if (!Number.isInteger(item) || item < 0 || item > 255) {
                throw new Error("commitment domain byte array contains an invalid byte");
            }
            out[i] = item;
        }
        return out;
    }
    return new TextEncoder().encode(String(value));
}

/**
 * @param {number} length
 * @param {string} encoding
 * @returns {Uint8Array}
 */
function encodeLength(length, encoding) {
    if (!Number.isSafeInteger(length) || length < 0) {
        throw new Error("path length is not a non-negative safe integer");
    }
    if (encoding === "none") return new Uint8Array(0);
    if (encoding === "varuint") return encodeVaruint(length);

    const width = encoding.startsWith("u16") ? 2 : encoding.startsWith("u32") ? 4 : 0;
    if (width === 0) throw new Error(`unsupported path length encoding '${encoding}'`);
    const maximum = width === 2 ? 0xffff : 0xffffffff;
    if (length > maximum) {
        throw new Error(`path length ${length} exceeds ${encoding}`);
    }
    const out = new Uint8Array(width);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const little = encoding.endsWith("le");
    if (width === 2) view.setUint16(0, length, little);
    else view.setUint32(0, length, little);
    return out;
}

/**
 * @param {number} value
 * @returns {Uint8Array}
 */
function encodeVaruint(value) {
    /** @type {number[]} */
    const bytes = [];
    let remaining = value;
    do {
        let byte = remaining % 128;
        remaining = Math.floor(remaining / 128);
        if (remaining > 0) byte |= 0x80;
        bytes.push(byte);
    } while (remaining > 0);
    return Uint8Array.from(bytes);
}
