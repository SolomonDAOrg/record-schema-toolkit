/**
 * JPEG and PNG Image Embedding for PDF
 * Uses node:zlib (built-in module) for PNG inflate/deflate. No external dependencies.
 * @module ImageEmbed
 */

import { inflateSync, deflateSync } from "node:zlib";
import { formatDictionary, formatRef } from "./primitives.mjs";

// ============================================================================
// JPEG Parser
// ============================================================================

/**
 * @typedef {Object} ParsedJpeg
 * @property {"jpeg"} type
 * @property {number} width
 * @property {number} height
 * @property {"DeviceGray" | "DeviceRGB" | "DeviceCMYK"} colorSpace
 * @property {number} bitsPerComponent
 * @property {Uint8Array} streamData - raw JPEG bytes, embedded verbatim with DCTDecode
 */

/**
 * Parse JPEG for PDF embedding.
 * Walks JFIF/Exif markers to find a SOF frame header.
 * @param {Uint8Array} bytes
 * @returns {ParsedJpeg}
 */
export function parseJpeg(bytes) {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
        throw new Error("JPEG: missing SOI marker");
    }

    let i = 2;
    while (i < bytes.length - 1) {
        if (bytes[i] !== 0xff) {
            throw new Error("JPEG: invalid marker at offset " + i);
        }
        const marker = bytes[i + 1];
        i += 2;

        // Markers with no payload
        if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) {
            continue;
        }
        // RST markers
        if (marker >= 0xd0 && marker <= 0xd7) {
            continue;
        }

        const segLen = (bytes[i] << 8) | bytes[i + 1];

        // SOF markers: SOF0-SOF3, SOF9-SOF11 (Baseline/Progressive/Lossless DCT)
        if (
            (marker >= 0xc0 && marker <= 0xc3) ||
            (marker >= 0xc9 && marker <= 0xcb)
        ) {
            const precision = bytes[i + 2];
            const height = (bytes[i + 3] << 8) | bytes[i + 4];
            const width = (bytes[i + 5] << 8) | bytes[i + 6];
            const components = bytes[i + 7];

            /** @type {"DeviceGray" | "DeviceRGB" | "DeviceCMYK"} */
            let colorSpace = "DeviceRGB";
            if (components === 1) {
                colorSpace = "DeviceGray";
            } else if (components === 4) {
                colorSpace = "DeviceCMYK";
            }

            return {
                type: "jpeg",
                width,
                height,
                colorSpace,
                bitsPerComponent: precision,
                streamData: bytes
            };
        }

        i += segLen;
    }
    throw new Error("JPEG: SOF marker not found");
}

// ============================================================================
// PNG Parser
// ============================================================================

/**
 * @typedef {Object} ParsedPng
 * @property {"png"} type
 * @property {number} width
 * @property {number} height
 * @property {"DeviceGray" | "DeviceRGB"} colorSpace
 * @property {number} bitsPerComponent
 * @property {Uint8Array} streamData  - FlateDecode-compressed raw pixel data (no filter bytes)
 * @property {Uint8Array} [smaskData] - FlateDecode-compressed alpha channel (grayscale 8bpc), if present
 */

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** @param {number} a @param {number} b @param {number} c @returns {number} */
function paethPredictor(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) {
        return a;
    }
    if (pb <= pc) {
        return b;
    }
    return c;
}

/**
 * Apply PNG reverse-filter to a single row, in-place.
 * @param {number} filterType
 * @param {Uint8Array} row - raw scanline bytes (without leading filter byte), modified in-place
 * @param {Uint8Array | null} prev - previous reconstructed row, or null for first row
 * @param {number} bpp - bytes per pixel (rounded up)
 */
function unfilterRow(filterType, row, prev, bpp) {
    const len = row.length;
    if (filterType === 0) {
        return;
    }
    if (filterType === 1) {
        for (let x = bpp; x < len; x++) {
            row[x] = (row[x] + row[x - bpp]) & 0xff;
        }
        return;
    }
    if (filterType === 2) {
        if (prev) {
            for (let x = 0; x < len; x++) {
                row[x] = (row[x] + prev[x]) & 0xff;
            }
        }
        return;
    }
    if (filterType === 3) {
        for (let x = 0; x < len; x++) {
            const a = x >= bpp ? row[x - bpp] : 0;
            const b = prev ? prev[x] : 0;
            row[x] = (row[x] + Math.floor((a + b) / 2)) & 0xff;
        }
        return;
    }
    if (filterType === 4) {
        for (let x = 0; x < len; x++) {
            const a = x >= bpp ? row[x - bpp] : 0;
            const b = prev ? prev[x] : 0;
            const c = prev && x >= bpp ? prev[x - bpp] : 0;
            row[x] = (row[x] + paethPredictor(a, b, c)) & 0xff;
        }
        return;
    }
    throw new Error("PNG: unknown filter type " + filterType);
}

/**
 * Parse and decompose a PNG file into raw pixel + optional alpha data suitable for PDF embedding.
 * @param {Uint8Array} bytes
 * @returns {ParsedPng}
 */
export function parsePng(bytes) {
    for (let i = 0; i < 8; i++) {
        if (bytes[i] !== PNG_SIG[i]) {
            throw new Error("PNG: invalid signature");
        }
    }

    let width = 0,
        height = 0,
        bitDepth = 8,
        colorType = 2;
    /** @type {Uint8Array[]} */
    const idatChunks = [];
    /** @type {Uint8Array | null} */
    let palette = null;

    let offset = 8;
    while (offset < bytes.length) {
        const chunkLen =
            ((bytes[offset] << 24) |
                (bytes[offset + 1] << 16) |
                (bytes[offset + 2] << 8) |
                bytes[offset + 3]) >>>
            0;
        const tag = String.fromCharCode(
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7]
        );
        const d = offset + 8;

        if (tag === "IHDR") {
            width =
                ((bytes[d] << 24) |
                    (bytes[d + 1] << 16) |
                    (bytes[d + 2] << 8) |
                    bytes[d + 3]) >>>
                0;
            height =
                ((bytes[d + 4] << 24) |
                    (bytes[d + 5] << 16) |
                    (bytes[d + 6] << 8) |
                    bytes[d + 7]) >>>
                0;
            bitDepth = bytes[d + 8];
            colorType = bytes[d + 9];
        } else if (tag === "PLTE") {
            palette = bytes.slice(d, d + chunkLen);
        } else if (tag === "IDAT") {
            idatChunks.push(bytes.slice(d, d + chunkLen));
        } else if (tag === "IEND") {
            break;
        }
        offset = d + chunkLen + 4; // skip CRC
    }

    // Channels per pixel (source)
    const chanMap = [1, 0, 3, 1, 2, 0, 4];
    const srcChannels = chanMap[colorType] ?? 3;
    const bpp = Math.max(1, Math.ceil((srcChannels * bitDepth) / 8));

    // Concatenate + decompress all IDAT chunks
    let totalLen = 0;
    for (let i = 0; i < idatChunks.length; i++) {
        totalLen += idatChunks[i].length;
    }
    const idat = new Uint8Array(totalLen);
    let pos = 0;
    for (let i = 0; i < idatChunks.length; i++) {
        idat.set(idatChunks[i], pos);
        pos += idatChunks[i].length;
    }
    const rawData = inflateSync(idat);

    // Output layout
    const hasAlpha = colorType === 4 || colorType === 6;
    const isIndexed = colorType === 3;
    /** @type {"DeviceGray" | "DeviceRGB"} */
    const colorSpace =
        colorType === 0 || colorType === 4 ? "DeviceGray" : "DeviceRGB";
    const outChannels = colorSpace === "DeviceGray" ? 1 : 3;

    const pixelData = new Uint8Array(width * height * outChannels);
    const alphaData = hasAlpha ? new Uint8Array(width * height) : null;

    const rowStride = 1 + Math.ceil((width * srcChannels * bitDepth) / 8);
    /** @type {Uint8Array | null} */
    let prevRow = null;

    for (let y = 0; y < height; y++) {
        const filterType = rawData[y * rowStride];
        const row = rawData.slice(y * rowStride + 1, (y + 1) * rowStride);
        unfilterRow(filterType, row, prevRow, bpp);

        const is16 = bitDepth === 16;

        if (isIndexed) {
            if (!palette) {
                throw new Error("PNG: missing PLTE for indexed image");
            }
            for (let x = 0; x < width; x++) {
                const idx = row[x];
                const dst = (y * width + x) * 3;
                pixelData[dst] = palette[idx * 3];
                pixelData[dst + 1] = palette[idx * 3 + 1];
                pixelData[dst + 2] = palette[idx * 3 + 2];
            }
        } else if (colorType === 0) {
            // Grayscale
            for (let x = 0; x < width; x++) {
                pixelData[y * width + x] = is16 ? row[x * 2] : row[x];
            }
        } else if (colorType === 2) {
            // RGB
            for (let x = 0; x < width; x++) {
                const s = is16 ? x * 6 : x * 3;
                const ds = is16 ? 2 : 1;
                const dst = (y * width + x) * 3;
                pixelData[dst] = row[s];
                pixelData[dst + 1] = row[s + ds];
                pixelData[dst + 2] = row[s + ds * 2];
            }
        } else if (colorType === 4) {
            // Grayscale + Alpha
            for (let x = 0; x < width; x++) {
                const s = is16 ? x * 4 : x * 2;
                const as_ = is16 ? 2 : 1;
                pixelData[y * width + x] = row[s];
                if (alphaData) {
                    alphaData[y * width + x] = row[s + as_];
                }
            }
        } else {
            // RGBA (6)
            for (let x = 0; x < width; x++) {
                const s = is16 ? x * 8 : x * 4;
                const ds = is16 ? 2 : 1;
                const dst = (y * width + x) * 3;
                pixelData[dst] = row[s];
                pixelData[dst + 1] = row[s + ds];
                pixelData[dst + 2] = row[s + ds * 2];
                if (alphaData) {
                    alphaData[y * width + x] = row[s + ds * 3];
                }
            }
        }

        prevRow = row;
    }

    return {
        type: "png",
        width,
        height,
        colorSpace,
        bitsPerComponent: Math.min(bitDepth, 8),
        streamData: new Uint8Array(deflateSync(pixelData)),
        smaskData: alphaData
            ? new Uint8Array(deflateSync(alphaData))
            : undefined
    };
}

// ============================================================================
// PDF XObject Dictionary Builders
// ============================================================================

/**
 * Build Image XObject dictionary for a JPEG (DCTDecode, pass-through).
 * @param {ParsedJpeg} parsed
 * @returns {Record<string, string>}
 */
export function buildJpegXObjectDict(parsed) {
    return {
        Type: "/XObject",
        Subtype: "/Image",
        Width: String(parsed.width),
        Height: String(parsed.height),
        ColorSpace: "/" + parsed.colorSpace,
        BitsPerComponent: String(parsed.bitsPerComponent),
        Filter: "/DCTDecode",
        Length: String(parsed.streamData.length)
    };
}

/**
 * Build Image XObject dictionary for a PNG (FlateDecode raw pixels).
 * @param {ParsedPng} parsed
 * @param {number} [smaskId] - object ID of alpha SMask XObject, if present
 * @returns {Record<string, string>}
 */
export function buildPngXObjectDict(parsed, smaskId) {
    /** @type {Record<string, string>} */
    const dict = {
        Type: "/XObject",
        Subtype: "/Image",
        Width: String(parsed.width),
        Height: String(parsed.height),
        ColorSpace: "/" + parsed.colorSpace,
        BitsPerComponent: String(parsed.bitsPerComponent),
        Filter: "/FlateDecode",
        Length: String(parsed.streamData.length)
    };
    if (smaskId !== undefined) {
        dict.SMask = formatRef(smaskId);
    }
    return dict;
}

/**
 * Build SMask (alpha channel) Image XObject dictionary.
 * @param {number} width
 * @param {number} height
 * @param {number} dataLength - byte length of the compressed smaskData stream
 * @returns {Record<string, string>}
 */
export function buildSmaskXObjectDict(width, height, dataLength) {
    return {
        Type: "/XObject",
        Subtype: "/Image",
        Width: String(width),
        Height: String(height),
        ColorSpace: "/DeviceGray",
        BitsPerComponent: "8",
        Filter: "/FlateDecode",
        Length: String(dataLength)
    };
}

export default {
    parseJpeg,
    parsePng,
    buildJpegXObjectDict,
    buildPngXObjectDict,
    buildSmaskXObjectDict
};
