import { createHash } from "node:crypto";

/**
 * Compute SHA-256 of data.
 * @param {Uint8Array} data
 * @returns {string}
 */
function sha256Hex(data) {
    const hash = createHash("sha256");
    hash.update(data);
    return hash.digest("hex");
}

export { sha256Hex };
