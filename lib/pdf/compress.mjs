/**
 * Stream compression helpers.
 * Wraps node:zlib deflate so raw content/font streams can be embedded as
 * PDF /FlateDecode. No external dependencies.
 * @module Compress
 */

import { deflateSync } from "node:zlib";

/**
 * Deflate (zlib) a byte buffer for use as a /FlateDecode stream.
 * Returns a plain Uint8Array (not a Node Buffer) to match the rest of the library.
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
export function deflateBytes(data) {
    return new Uint8Array(deflateSync(data));
}

export default { deflateBytes };
