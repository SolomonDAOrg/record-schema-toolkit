/**
 * Minimal ASN.1 DER encoder + reader, just enough for CMS SignedData and for
 * pulling the issuer/serial out of an X.509 certificate. No dependencies.
 * @module Asn1
 */

/** @param {Uint8Array[]} parts @returns {Uint8Array} */
function concat(parts) {
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

/** @param {number} n @returns {Uint8Array} DER length octets */
function encodeLen(n) {
    if (n < 0x80) {
        return Uint8Array.of(n);
    }
    /** @type {number[]} */
    const bytes = [];
    let x = n;
    while (x > 0) {
        bytes.unshift(x & 0xff);
        x = Math.floor(x / 256);
    }
    return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

/** @param {number} tag @param {Uint8Array} content @returns {Uint8Array} */
export function tlv(tag, content) {
    return concat([Uint8Array.of(tag), encodeLen(content.length), content]);
}

/** @param {...Uint8Array} children @returns {Uint8Array} */
export function seq(...children) {
    return tlv(0x30, concat(children));
}

/** @param {...Uint8Array} children @returns {Uint8Array} */
export function set(...children) {
    return tlv(0x31, concat(children));
}

/** @param {Uint8Array} bytes @returns {Uint8Array} */
export function octetString(bytes) {
    return tlv(0x04, bytes);
}

/** @returns {Uint8Array} */
export function nullValue() {
    return Uint8Array.of(0x05, 0x00);
}

/**
 * Encode an OID from dotted string.
 * @param {string} dotted
 * @returns {Uint8Array}
 */
export function oid(dotted) {
    const parts = dotted.split(".").map((x) => parseInt(x, 10));
    /** @type {number[]} */
    const out = [40 * parts[0] + parts[1]];
    for (let i = 2, len = parts.length; i < len; i++) {
        let v = parts[i];
        /** @type {number[]} */
        const stack = [v & 0x7f];
        v = Math.floor(v / 128);
        while (v > 0) {
            stack.unshift((v & 0x7f) | 0x80);
            v = Math.floor(v / 128);
        }
        for (let k = 0, klen = stack.length; k < klen; k++) {
            out.push(stack[k]);
        }
    }
    return tlv(0x06, Uint8Array.from(out));
}

/**
 * Encode a small non-negative INTEGER from a JS number.
 * @param {number} n
 * @returns {Uint8Array}
 */
export function integer(n) {
    /** @type {number[]} */
    const bytes = [];
    let x = n;
    if (x === 0) {
        bytes.push(0);
    }
    while (x > 0) {
        bytes.unshift(x & 0xff);
        x = Math.floor(x / 256);
    }
    if ((bytes[0] & 0x80) !== 0) {
        bytes.unshift(0);
    }
    return tlv(0x02, Uint8Array.from(bytes));
}

/**
 * A context-tagged [n] constructed wrapper (used for EXPLICIT and IMPLICIT SET/SEQ).
 * @param {number} tagNum
 * @param {Uint8Array} content
 * @returns {Uint8Array}
 */
export function contextConstructed(tagNum, content) {
    return tlv(0xa0 | tagNum, content);
}

/**
 * UTCTime (YYMMDDHHMMSSZ).
 * @param {Date} date
 * @returns {Uint8Array}
 */
export function utcTime(date) {
    const p = (v) => String(v).padStart(2, "0");
    const yy = p(date.getUTCFullYear() % 100);
    const s =
        yy +
        p(date.getUTCMonth() + 1) +
        p(date.getUTCDate()) +
        p(date.getUTCHours()) +
        p(date.getUTCMinutes()) +
        p(date.getUTCSeconds()) +
        "Z";
    const bytes = new Uint8Array(s.length);
    for (let i = 0, len = s.length; i < len; i++) {
        bytes[i] = s.charCodeAt(i);
    }
    return tlv(0x17, bytes);
}

/**
 * DER-sort a list of already-encoded TLVs (required for SET OF).
 * @param {Uint8Array[]} items
 * @returns {Uint8Array[]}
 */
export function derSort(items) {
    return items.slice().sort((a, b) => {
        const n = Math.min(a.length, b.length);
        for (let i = 0; i < n; i++) {
            if (a[i] !== b[i]) {
                return a[i] - b[i];
            }
        }
        return a.length - b.length;
    });
}

// ---------------------------------------------------------------------------
// Reader (only what's needed to extract issuer + serial from a certificate)
// ---------------------------------------------------------------------------

/**
 * @param {Uint8Array} bytes
 * @param {number} pos
 * @returns {{ tag: number, contentStart: number, contentEnd: number, tlvStart: number, tlvEnd: number }}
 */
export function parseTLV(bytes, pos) {
    const tlvStart = pos;
    const tag = bytes[pos];
    pos = pos + 1;
    let len = bytes[pos];
    pos = pos + 1;
    if (len >= 0x80) {
        const num = len & 0x7f;
        len = 0;
        for (let i = 0; i < num; i++) {
            len = len * 256 + bytes[pos];
            pos = pos + 1;
        }
    }
    return {
        tag,
        contentStart: pos,
        contentEnd: pos + len,
        tlvStart,
        tlvEnd: pos + len
    };
}

/**
 * Extract the issuer Name and serialNumber TLVs (verbatim DER) from a cert.
 * @param {Uint8Array} certDer
 * @returns {{ issuerTlv: Uint8Array, serialTlv: Uint8Array }}
 */
export function extractIssuerAndSerial(certDer) {
    const outer = parseTLV(certDer, 0); // Certificate SEQUENCE
    const tbs = parseTLV(certDer, outer.contentStart); // tbsCertificate SEQUENCE
    let p = tbs.contentStart;
    let el = parseTLV(certDer, p);
    if (el.tag === 0xa0) {
        // [0] EXPLICIT version — skip
        p = el.tlvEnd;
        el = parseTLV(certDer, p);
    }
    // serialNumber INTEGER
    const serialTlv = certDer.slice(el.tlvStart, el.tlvEnd);
    p = el.tlvEnd;
    el = parseTLV(certDer, p); // signature AlgorithmIdentifier SEQUENCE
    p = el.tlvEnd;
    el = parseTLV(certDer, p); // issuer Name SEQUENCE
    const issuerTlv = certDer.slice(el.tlvStart, el.tlvEnd);
    return { issuerTlv, serialTlv };
}

export default {
    tlv,
    seq,
    set,
    octetString,
    nullValue,
    oid,
    integer,
    contextConstructed,
    utcTime,
    derSort,
    parseTLV,
    extractIssuerAndSerial
};
