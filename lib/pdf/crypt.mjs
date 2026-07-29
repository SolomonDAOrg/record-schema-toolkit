/**
 * PDF Standard Security Handler — encryption.
 *
 * Supports two algorithms, selected via options.algorithm:
 *  - "aes-128" (default): V4 / R4 / AESV2. Classic MD5/RC4 password handshake
 *    (Algorithms 2, 3, 5) with a per-object AES-128-CBC key (Algorithm 1 + "sAlT").
 *  - "aes-256": V5 / R6 / AESV3. The PDF 2.0 handler — hardened hash (Algorithm
 *    2.B) over SHA-256/384/512, a single random 32-byte file key encrypted under
 *    the user/owner keys (/UE, /OE), and AES-256-CBC for every string and stream.
 *
 * RC4 is a small pure-JS routine; MD5/SHA/AES come from node:crypto (a Node
 * built-in) — no third-party dependencies. Only generation 0 objects are
 * produced by this library, so the generation number is fixed at 0.
 * @module Crypt
 */

import {
    createHash,
    createCipheriv,
    createDecipheriv,
    randomBytes
} from "node:crypto";

const KEY_LEN = 16; // 128-bit, for V4

// The 32-byte password padding string (V4 / Algorithm 2).
const PAD = new Uint8Array([
    0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56,
    0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
    0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a
]);

/** @param {Uint8Array} bytes @returns {Uint8Array} */
function md5(bytes) {
    return new Uint8Array(createHash("md5").update(bytes).digest());
}

/** @param {string} algo @param {Uint8Array} bytes @returns {Uint8Array} */
function sha(algo, bytes) {
    return new Uint8Array(createHash(algo).update(bytes).digest());
}

/** @param {Uint8Array} u @returns {string} */
function toHex(u) {
    let s = "";
    for (let i = 0, len = u.length; i < len; i++) {
        s = s + u[i].toString(16).padStart(2, "0");
    }
    return s;
}

/** @param {Uint8Array[]} parts @returns {Uint8Array} */
function concatBytes(parts) {
    let total = 0;
    for (let i = 0, len = parts.length; i < len; i++) {
        total = total + parts[i].length;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (let i = 0, len = parts.length; i < len; i++) {
        out.set(parts[i], off);
        off = off + parts[i].length;
    }
    return out;
}

/**
 * RC4 stream cipher (symmetric).
 * @param {Uint8Array} key
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
function rc4(key, data) {
    const s = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
        s[i] = i;
    }
    let j = 0;
    for (let i = 0; i < 256; i++) {
        j = (j + s[i] + key[i % key.length]) & 0xff;
        const t = s[i];
        s[i] = s[j];
        s[j] = t;
    }
    const out = new Uint8Array(data.length);
    let a = 0;
    let b = 0;
    for (let k = 0, len = data.length; k < len; k++) {
        a = (a + 1) & 0xff;
        b = (b + s[a]) & 0xff;
        const t = s[a];
        s[a] = s[b];
        s[b] = t;
        out[k] = data[k] ^ s[(s[a] + s[b]) & 0xff];
    }
    return out;
}

/**
 * Compute the permission-flag value as a signed 32-bit integer.
 * @param {Object} [perms]
 * @returns {number}
 */
function permissionBits(perms) {
    const p = perms || {};
    const allow = (v) => v !== false;
    let bits = 0xffffffff;
    bits = bits & ~0x3;
    if (!allow(p.printing)) {
        bits = bits & ~0x4;
    }
    if (!allow(p.modifying)) {
        bits = bits & ~0x8;
    }
    if (!allow(p.copying)) {
        bits = bits & ~0x10;
    }
    if (!allow(p.annotating)) {
        bits = bits & ~0x20;
    }
    if (!allow(p.fillingForms)) {
        bits = bits & ~0x100;
    }
    if (!allow(p.accessibility)) {
        bits = bits & ~0x200;
    }
    if (!allow(p.assembling)) {
        bits = bits & ~0x400;
    }
    if (!allow(p.highResPrinting)) {
        bits = bits & ~0x800;
    }
    return bits | 0;
}

/** @param {number} p @returns {Uint8Array} */
function pBytesLE(p) {
    return new Uint8Array([
        p & 0xff,
        (p >>> 8) & 0xff,
        (p >>> 16) & 0xff,
        (p >>> 24) & 0xff
    ]);
}

/**
 * Rewrite every literal/hex string in a serialized object body as an encrypted
 * hex string. Dict/array structure, names, numbers, and refs pass through.
 * Shared by both handler versions; `encrypt` receives (objId, bytes).
 * @param {(objId: number, bytes: Uint8Array) => Uint8Array} encrypt
 * @param {number} objId
 * @param {string} str
 * @returns {string}
 */
function encryptStrings(encrypt, objId, str) {
    let out = "";
    let i = 0;
    const n = str.length;
    while (i < n) {
        const ch = str[i];
        if (ch === "<" && str[i + 1] === "<") {
            out = out + "<<";
            i = i + 2;
            continue;
        }
        if (ch === ">" && str[i + 1] === ">") {
            out = out + ">>";
            i = i + 2;
            continue;
        }
        if (ch === "(") {
            let depth = 1;
            let j = i + 1;
            /** @type {number[]} */
            const bytes = [];
            while (j < n && depth > 0) {
                const c = str[j];
                if (c === "\\") {
                    const next = str[j + 1];
                    if (next === "n") {
                        bytes.push(10);
                        j = j + 2;
                    } else if (next === "r") {
                        bytes.push(13);
                        j = j + 2;
                    } else if (next === "t") {
                        bytes.push(9);
                        j = j + 2;
                    } else if (next === "b") {
                        bytes.push(8);
                        j = j + 2;
                    } else if (next === "f") {
                        bytes.push(12);
                        j = j + 2;
                    } else if (next === "(") {
                        bytes.push(40);
                        j = j + 2;
                    } else if (next === ")") {
                        bytes.push(41);
                        j = j + 2;
                    } else if (next === "\\") {
                        bytes.push(92);
                        j = j + 2;
                    } else if (next >= "0" && next <= "7") {
                        let oct = "";
                        let k = j + 1;
                        while (
                            k < n &&
                            oct.length < 3 &&
                            str[k] >= "0" &&
                            str[k] <= "7"
                        ) {
                            oct = oct + str[k];
                            k = k + 1;
                        }
                        bytes.push(parseInt(oct, 8) & 0xff);
                        j = k;
                    } else if (next === "\n") {
                        j = j + 2;
                    } else if (next === "\r") {
                        j = j + (str[j + 2] === "\n" ? 3 : 2);
                    } else {
                        bytes.push(next.charCodeAt(0) & 0xff);
                        j = j + 2;
                    }
                } else if (c === "(") {
                    depth = depth + 1;
                    bytes.push(40);
                    j = j + 1;
                } else if (c === ")") {
                    depth = depth - 1;
                    if (depth > 0) {
                        bytes.push(41);
                    }
                    j = j + 1;
                } else {
                    bytes.push(c.charCodeAt(0) & 0xff);
                    j = j + 1;
                }
            }
            out =
                out + "<" + toHex(encrypt(objId, new Uint8Array(bytes))) + ">";
            i = j;
            continue;
        }
        if (ch === "<") {
            let j = i + 1;
            let hex = "";
            while (j < n && str[j] !== ">") {
                const c = str[j];
                if (c !== " " && c !== "\n" && c !== "\r" && c !== "\t") {
                    hex = hex + c;
                }
                j = j + 1;
            }
            if (hex.length % 2 === 1) {
                hex = hex + "0";
            }
            const bytes = new Uint8Array(hex.length / 2);
            for (let k = 0, len = bytes.length; k < len; k++) {
                bytes[k] = parseInt(hex.substr(k * 2, 2), 16);
            }
            out = out + "<" + toHex(encrypt(objId, bytes)) + ">";
            i = j + 1;
            continue;
        }
        out = out + ch;
        i = i + 1;
    }
    return out;
}

// ============================================================================
// V4 / R4 / AESV2 (AES-128)
// ============================================================================

/** @param {string} pw @returns {Uint8Array} */
function padPassword(pw) {
    const out = new Uint8Array(32);
    let n = 0;
    for (let i = 0, len = pw.length; i < len && n < 32; i++) {
        out[n] = pw.charCodeAt(i) & 0xff;
        n = n + 1;
    }
    out.set(PAD.subarray(0, 32 - n), n);
    return out;
}

/**
 * @param {import("./crypt.mjs").EncryptionOptions} options
 * @param {Uint8Array} fileId
 * @returns {import("./crypt.mjs").EncryptionContext}
 */
function createEncryptionV4(options, fileId) {
    const userPassword = options.userPassword || "";
    const ownerPassword =
        options.ownerPassword !== undefined && options.ownerPassword !== ""
            ? options.ownerPassword
            : userPassword;
    const pValue = permissionBits(options.permissions);

    // Algorithm 3 — /O.
    let ownerDigest = md5(padPassword(ownerPassword));
    for (let i = 0; i < 50; i++) {
        ownerDigest = md5(ownerDigest.subarray(0, KEY_LEN));
    }
    const ownerRc4Key = ownerDigest.subarray(0, KEY_LEN);
    let oEntry = rc4(ownerRc4Key, padPassword(userPassword));
    for (let i = 1; i <= 19; i++) {
        const k = new Uint8Array(KEY_LEN);
        for (let x = 0; x < KEY_LEN; x++) {
            k[x] = ownerRc4Key[x] ^ i;
        }
        oEntry = rc4(k, oEntry);
    }

    // Algorithm 2 — file key (metadata encrypted).
    let keyDigest = md5(
        concatBytes([
            padPassword(userPassword),
            oEntry,
            pBytesLE(pValue),
            fileId
        ])
    );
    for (let i = 0; i < 50; i++) {
        keyDigest = md5(keyDigest.subarray(0, KEY_LEN));
    }
    const fileKey = keyDigest.subarray(0, KEY_LEN);

    // Algorithm 5 — /U.
    let uHash = md5(concatBytes([PAD, fileId]));
    uHash = rc4(fileKey, uHash);
    for (let i = 1; i <= 19; i++) {
        const k = new Uint8Array(KEY_LEN);
        for (let x = 0; x < KEY_LEN; x++) {
            k[x] = fileKey[x] ^ i;
        }
        uHash = rc4(k, uHash);
    }
    const uEntry = new Uint8Array(32);
    uEntry.set(uHash.subarray(0, 16), 0);

    /** @type {Map<number, Uint8Array>} */
    const objKeyCache = new Map();

    /** @param {number} objId @returns {Uint8Array} */
    function objectKey(objId) {
        const cached = objKeyCache.get(objId);
        if (cached) {
            return cached;
        }
        const input = new Uint8Array(KEY_LEN + 5 + 4);
        input.set(fileKey, 0);
        input[KEY_LEN] = objId & 0xff;
        input[KEY_LEN + 1] = (objId >> 8) & 0xff;
        input[KEY_LEN + 2] = (objId >> 16) & 0xff;
        input[KEY_LEN + 3] = 0;
        input[KEY_LEN + 4] = 0;
        input[KEY_LEN + 5] = 0x73;
        input[KEY_LEN + 6] = 0x41;
        input[KEY_LEN + 7] = 0x6c;
        input[KEY_LEN + 8] = 0x54;
        const key = md5(input).subarray(0, Math.min(KEY_LEN + 5, 16));
        objKeyCache.set(objId, key);
        return key;
    }

    /** @param {number} objId @param {Uint8Array} bytes @returns {Uint8Array} */
    function encrypt(objId, bytes) {
        const key = objectKey(objId);
        const iv = randomBytes(16);
        const cipher = createCipheriv("aes-128-cbc", key, iv);
        const ct = Buffer.concat([cipher.update(bytes), cipher.final()]);
        const out = new Uint8Array(16 + ct.length);
        out.set(iv, 0);
        out.set(ct, 16);
        return out;
    }

    function buildEncryptDict() {
        return (
            "<<\n" +
            "  /Filter /Standard\n" +
            "  /V 4\n" +
            "  /R 4\n" +
            "  /Length 128\n" +
            "  /CF << /StdCF << /CFM /AESV2 /AuthEvent /DocOpen /Length 16 >> >>\n" +
            "  /StmF /StdCF\n" +
            "  /StrF /StdCF\n" +
            "  /O <" +
            toHex(oEntry) +
            ">\n" +
            "  /U <" +
            toHex(uEntry) +
            ">\n" +
            "  /P " +
            String(pValue) +
            "\n" +
            ">>"
        );
    }

    return {
        encrypt,
        encryptStringsInObject: (id, s) => encryptStrings(encrypt, id, s),
        buildEncryptDict,
        fileIdHex: toHex(fileId)
    };
}

// ============================================================================
// V5 / R6 / AESV3 (AES-256)
// ============================================================================

/** @param {string} s @returns {Uint8Array} UTF-8 bytes truncated to 127 */
function utf8Trunc(s) {
    const b = new TextEncoder().encode(s);
    return b.length > 127 ? b.subarray(0, 127) : b;
}

/** AES-128-CBC, no padding. @param {Uint8Array} key @param {Uint8Array} iv @param {Uint8Array} data @returns {Uint8Array} */
function aes128cbcNoPad(key, iv, data) {
    const c = createCipheriv("aes-128-cbc", key, iv);
    c.setAutoPadding(false);
    return new Uint8Array(Buffer.concat([c.update(data), c.final()]));
}

/** AES-256-CBC, no padding. @param {Uint8Array} key @param {Uint8Array} iv @param {Uint8Array} data @returns {Uint8Array} */
function aes256cbcNoPad(key, iv, data) {
    const c = createCipheriv("aes-256-cbc", key, iv);
    c.setAutoPadding(false);
    return new Uint8Array(Buffer.concat([c.update(data), c.final()]));
}

/**
 * Algorithm 2.B — the R6 hardened hash.
 * @param {Uint8Array} pwd - UTF-8 password bytes
 * @param {Uint8Array} salt - 8-byte salt
 * @param {Uint8Array} udata - empty for user, the 48-byte /U for owner
 * @returns {Uint8Array} 32 bytes
 */
function hash2B(pwd, salt, udata) {
    let K = sha("sha256", concatBytes([pwd, salt, udata]));
    let round = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const block = concatBytes([pwd, K, udata]);
        const K1 = new Uint8Array(block.length * 64);
        for (let i = 0; i < 64; i++) {
            K1.set(block, i * block.length);
        }
        const E = aes128cbcNoPad(K.subarray(0, 16), K.subarray(16, 32), K1);
        let sum = 0;
        for (let i = 0; i < 16; i++) {
            sum = sum + E[i];
        }
        const mod = sum % 3;
        const algo = mod === 0 ? "sha256" : mod === 1 ? "sha384" : "sha512";
        K = sha(algo, E);
        if (round >= 63 && E[E.length - 1] <= round - 32) {
            break;
        }
        round = round + 1;
    }
    return K.subarray(0, 32);
}

/**
 * Algorithm 10 — /Perms (AES-256-ECB, no padding).
 * @param {number} pValue
 * @param {Uint8Array} fileKey
 * @returns {Uint8Array} 16 bytes
 */
function buildPerms(pValue, fileKey) {
    const block = new Uint8Array(16);
    block[0] = pValue & 0xff;
    block[1] = (pValue >>> 8) & 0xff;
    block[2] = (pValue >>> 16) & 0xff;
    block[3] = (pValue >>> 24) & 0xff;
    block[4] = 0xff;
    block[5] = 0xff;
    block[6] = 0xff;
    block[7] = 0xff;
    block[8] = 0x54; // 'T' — metadata encrypted
    block[9] = 0x61; // 'a'
    block[10] = 0x64; // 'd'
    block[11] = 0x62; // 'b'
    const r = randomBytes(4);
    block[12] = r[0];
    block[13] = r[1];
    block[14] = r[2];
    block[15] = r[3];
    const c = createCipheriv("aes-256-ecb", fileKey, null);
    c.setAutoPadding(false);
    return new Uint8Array(Buffer.concat([c.update(block), c.final()]));
}

/**
 * @param {import("./crypt.mjs").EncryptionOptions} options
 * @param {Uint8Array} fileId
 * @returns {import("./crypt.mjs").EncryptionContext}
 */
function createEncryptionV5(options, fileId) {
    const userPw = utf8Trunc(options.userPassword || "");
    const ownerPwStr =
        options.ownerPassword !== undefined && options.ownerPassword !== ""
            ? options.ownerPassword
            : options.userPassword || "";
    const ownerPw = utf8Trunc(ownerPwStr);
    const pValue = permissionBits(options.permissions);

    const fileKey = new Uint8Array(randomBytes(32));
    const zeroIv = new Uint8Array(16);

    // Algorithm 8 — /U, /UE.
    const uValidationSalt = new Uint8Array(randomBytes(8));
    const uKeySalt = new Uint8Array(randomBytes(8));
    const uHash = hash2B(userPw, uValidationSalt, new Uint8Array(0));
    const uEntry = concatBytes([uHash, uValidationSalt, uKeySalt]); // 48
    const uIntermediate = hash2B(userPw, uKeySalt, new Uint8Array(0));
    const ueEntry = aes256cbcNoPad(uIntermediate, zeroIv, fileKey); // 32

    // Algorithm 9 — /O, /OE (owner hash keyed with the 48-byte /U).
    const oValidationSalt = new Uint8Array(randomBytes(8));
    const oKeySalt = new Uint8Array(randomBytes(8));
    const oHash = hash2B(ownerPw, oValidationSalt, uEntry);
    const oEntry = concatBytes([oHash, oValidationSalt, oKeySalt]); // 48
    const oIntermediate = hash2B(ownerPw, oKeySalt, uEntry);
    const oeEntry = aes256cbcNoPad(oIntermediate, zeroIv, fileKey); // 32

    const permsEntry = buildPerms(pValue, fileKey);

    /** @param {number} _objId @param {Uint8Array} bytes @returns {Uint8Array} */
    function encrypt(_objId, bytes) {
        const iv = randomBytes(16);
        const cipher = createCipheriv("aes-256-cbc", fileKey, iv);
        const ct = Buffer.concat([cipher.update(bytes), cipher.final()]);
        const out = new Uint8Array(16 + ct.length);
        out.set(iv, 0);
        out.set(ct, 16);
        return out;
    }

    function buildEncryptDict() {
        return (
            "<<\n" +
            "  /Filter /Standard\n" +
            "  /V 5\n" +
            "  /R 6\n" +
            "  /Length 256\n" +
            "  /CF << /StdCF << /CFM /AESV3 /AuthEvent /DocOpen /Length 32 >> >>\n" +
            "  /StmF /StdCF\n" +
            "  /StrF /StdCF\n" +
            "  /O <" +
            toHex(oEntry) +
            ">\n" +
            "  /U <" +
            toHex(uEntry) +
            ">\n" +
            "  /OE <" +
            toHex(oeEntry) +
            ">\n" +
            "  /UE <" +
            toHex(ueEntry) +
            ">\n" +
            "  /P " +
            String(pValue) +
            "\n" +
            "  /Perms <" +
            toHex(permsEntry) +
            ">\n" +
            ">>"
        );
    }

    return {
        encrypt,
        encryptStringsInObject: (id, s) => encryptStrings(encrypt, id, s),
        buildEncryptDict,
        fileIdHex: toHex(fileId)
    };
}

// ============================================================================
// Public factory
// ============================================================================

/**
 * @typedef {Object} EncryptionOptions
 * @property {"aes-128" | "aes-256"} [algorithm] - default "aes-128"
 * @property {string} [userPassword] - open password (default "": encrypted but opens without a prompt)
 * @property {string} [ownerPassword] - permissions password (default = userPassword)
 * @property {Object} [permissions] - printing/modifying/copying/annotating/fillingForms/accessibility/assembling/highResPrinting (each default true)
 */

/**
 * @typedef {Object} EncryptionContext
 * @property {(objId: number, bytes: Uint8Array) => Uint8Array} encrypt
 * @property {(objId: number, dictStr: string) => string} encryptStringsInObject
 * @property {() => string} buildEncryptDict
 * @property {string} fileIdHex
 */

/**
 * Build an encryption context for one document.
 * @param {EncryptionOptions} options
 * @param {Uint8Array} fileId - 16-byte document /ID (first element)
 * @returns {EncryptionContext}
 */
export function createEncryption(options, fileId) {
    if (options.algorithm === "aes-256") {
        return createEncryptionV5(options, fileId);
    }
    return createEncryptionV4(options, fileId);
}

/** @returns {Uint8Array} a fresh random 16-byte document ID */
export function randomFileId() {
    return new Uint8Array(randomBytes(16));
}

// ============================================================================
// Decryption (reading encrypted PDFs)
// ============================================================================

/** @param {Uint8Array} a @param {Uint8Array} b @returns {boolean} */
function bytesEqual(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0, len = a.length; i < len; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

/** AES-CBC decrypt with PKCS#7 removal; data = iv(16) || ciphertext. */
function aesCbcDecrypt(algo, key, data) {
    const iv = data.subarray(0, 16);
    const ct = data.subarray(16);
    try {
        const d = createDecipheriv(algo, key, iv);
        return new Uint8Array(Buffer.concat([d.update(ct), d.final()]));
    } catch {
        const d = createDecipheriv(algo, key, iv);
        d.setAutoPadding(false);
        return new Uint8Array(Buffer.concat([d.update(ct), d.final()]));
    }
}

/** AES-256-CBC decrypt, no padding, explicit iv (for /UE, /OE). */
function aes256cbcNoPadDecrypt(key, iv, data) {
    const d = createDecipheriv("aes-256-cbc", key, iv);
    d.setAutoPadding(false);
    return new Uint8Array(Buffer.concat([d.update(data), d.final()]));
}

/**
 * V<=4 file key from already-padded password bytes (Algorithm 2).
 * @returns {Uint8Array}
 */
function deriveKeyV4(paddedPw, o, p, fileId, r, keyLen, encryptMetadata) {
    let input = concatBytes([paddedPw, o, pBytesLE(p), fileId]);
    if (r >= 4 && !encryptMetadata) {
        input = concatBytes([input, new Uint8Array([0xff, 0xff, 0xff, 0xff])]);
    }
    let key = md5(input);
    if (r >= 3) {
        for (let i = 0; i < 50; i++) {
            key = md5(key.subarray(0, keyLen));
        }
    }
    return key.subarray(0, keyLen);
}

/** Compute the /U value from a V<=4 file key (Algorithms 4/5). */
function computeUV4(fileKey, fileId, r) {
    if (r === 2) {
        return rc4(fileKey, PAD);
    }
    let h = md5(concatBytes([PAD, fileId]));
    h = rc4(fileKey, h);
    for (let i = 1; i <= 19; i++) {
        const k = new Uint8Array(fileKey.length);
        for (let x = 0; x < fileKey.length; x++) {
            k[x] = fileKey[x] ^ i;
        }
        h = rc4(k, h);
    }
    return h;
}

/** Derive a V<=4 file key from a password, trying user then owner. */
function fileKeyV4(password, o, u, p, fileId, r, keyLen, encryptMetadata) {
    const check = r === 2 ? u : u.subarray(0, 16);
    // user password
    const fkUser = deriveKeyV4(
        padPassword(password),
        o,
        p,
        fileId,
        r,
        keyLen,
        encryptMetadata
    );
    const uUser = computeUV4(fkUser, fileId, r);
    if (bytesEqual(r === 2 ? uUser : uUser.subarray(0, 16), check)) {
        return fkUser;
    }
    // owner password: decrypt /O to recover the padded user password
    let okey = md5(padPassword(password));
    if (r >= 3) {
        for (let i = 0; i < 50; i++) {
            okey = md5(okey.subarray(0, keyLen));
        }
    }
    okey = okey.subarray(0, keyLen);
    let recovered = o;
    if (r >= 3) {
        for (let i = 19; i >= 0; i--) {
            const k = new Uint8Array(keyLen);
            for (let x = 0; x < keyLen; x++) {
                k[x] = okey[x] ^ i;
            }
            recovered = rc4(k, recovered);
        }
    } else {
        recovered = rc4(okey, o);
    }
    const fkOwner = deriveKeyV4(
        recovered,
        o,
        p,
        fileId,
        r,
        keyLen,
        encryptMetadata
    );
    const uOwner = computeUV4(fkOwner, fileId, r);
    if (bytesEqual(r === 2 ? uOwner : uOwner.subarray(0, 16), check)) {
        return fkOwner;
    }
    throw new Error("crypt: incorrect password");
}

/** Derive a V5 file key (Algorithm 2.A), trying user then owner. */
function fileKeyV5(password, o, u, oe, ue) {
    const pw = utf8Trunc(password);
    const empty = new Uint8Array(0);
    const zeroIv = new Uint8Array(16);
    const uHash = u.subarray(0, 32);
    const uValSalt = u.subarray(32, 40);
    const uKeySalt = u.subarray(40, 48);
    if (bytesEqual(hash2B(pw, uValSalt, empty), uHash)) {
        const ik = hash2B(pw, uKeySalt, empty);
        return aes256cbcNoPadDecrypt(ik, zeroIv, ue);
    }
    const oHash = o.subarray(0, 32);
    const oValSalt = o.subarray(32, 40);
    const oKeySalt = o.subarray(40, 48);
    if (bytesEqual(hash2B(pw, oValSalt, u), oHash)) {
        const ik = hash2B(pw, oKeySalt, u);
        return aes256cbcNoPadDecrypt(ik, zeroIv, oe);
    }
    throw new Error("crypt: incorrect password");
}

/**
 * @typedef {Object} DecryptionParams
 * @property {number} v
 * @property {number} r
 * @property {number} keyLength - bits
 * @property {Uint8Array} o
 * @property {Uint8Array} u
 * @property {Uint8Array} [oe]
 * @property {Uint8Array} [ue]
 * @property {number} p
 * @property {"V2" | "AESV2" | "AESV3"} cfm - RC4, AES-128, or AES-256
 * @property {boolean} encryptMetadata
 * @property {Uint8Array} fileId
 * @property {string} password
 */

/**
 * Build a decryption context from a parsed /Encrypt dictionary. Throws on an
 * incorrect password.
 * @param {DecryptionParams} params
 * @returns {{ decrypt: (objId: number, bytes: Uint8Array) => Uint8Array, decryptStringsInObject: (objId: number, str: string) => string }}
 */
export function createDecryption(params) {
    const keyLen = Math.floor((params.keyLength || 40) / 8);
    const isV5 = params.v === 5;
    const isAES = params.cfm === "AESV2" || params.cfm === "AESV3";

    const fileKey = isV5
        ? fileKeyV5(params.password, params.o, params.u, params.oe, params.ue)
        : fileKeyV4(
              params.password,
              params.o,
              params.u,
              params.p,
              params.fileId,
              params.r,
              keyLen,
              params.encryptMetadata
          );

    /** @param {number} objId @returns {Uint8Array} */
    function objectKeyV4(objId) {
        const extra = isAES ? 9 : 5;
        const input = new Uint8Array(keyLen + extra);
        input.set(fileKey, 0);
        input[keyLen] = objId & 0xff;
        input[keyLen + 1] = (objId >> 8) & 0xff;
        input[keyLen + 2] = (objId >> 16) & 0xff;
        input[keyLen + 3] = 0;
        input[keyLen + 4] = 0;
        if (isAES) {
            input[keyLen + 5] = 0x73;
            input[keyLen + 6] = 0x41;
            input[keyLen + 7] = 0x6c;
            input[keyLen + 8] = 0x54;
        }
        return md5(input).subarray(0, Math.min(keyLen + 5, 16));
    }

    /** @param {number} objId @param {Uint8Array} bytes @returns {Uint8Array} */
    function decrypt(objId, bytes) {
        if (!bytes || bytes.length === 0) {
            return bytes;
        }
        if (isV5) {
            return aesCbcDecrypt("aes-256-cbc", fileKey, bytes);
        }
        const k = objectKeyV4(objId);
        if (isAES) {
            return aesCbcDecrypt("aes-128-cbc", k, bytes);
        }
        return rc4(k, bytes);
    }

    return {
        decrypt,
        decryptStringsInObject: (objId, str) =>
            encryptStrings(decrypt, objId, str)
    };
}

export default { createEncryption, createDecryption, randomFileId };
