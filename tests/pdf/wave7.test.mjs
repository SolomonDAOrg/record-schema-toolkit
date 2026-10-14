/**
 * Wave 6 validation: PDF digital signatures (detached CMS). node internals only.
 * A throwaway self-signed cert is generated via openssl at test time; if openssl
 * is unavailable the signing tests skip.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
    createHash,
    verify as cryptoVerify,
    X509Certificate
} from "node:crypto";

import DocMod from "../../lib/pdf/document.mjs";
import { signPdf } from "../../lib/pdf/sign.mjs";
import { parseTLV, tlv } from "../../lib/pdf/asn1.mjs";

const { PdfDocumentBuilder } = DocMod;
const dec = new TextDecoder("latin1");

let KEY = null;
let CERT = null;
let HAS_OPENSSL = true;
try {
    execSync(
        "openssl req -x509 -newkey rsa:2048 -keyout /tmp/wt_key.pem -out /tmp/wt_cert.pem -days 30 -nodes -subj '/CN=Sig Test/O=Solomon Labs/C=AE'",
        { stdio: "ignore" }
    );
    KEY = readFileSync("/tmp/wt_key.pem");
    CERT = readFileSync("/tmp/wt_cert.pem");
} catch {
    HAS_OPENSSL = false;
}

/** @param {Uint8Array} b @returns {string} */
function toLatin1(b) {
    return dec.decode(b);
}

function buildDoc() {
    const d = new PdfDocumentBuilder({ title: "Agreement" });
    d.addPageFromString(
        "BT /F1 16 Tf 72 700 Td (Executed and signed.) Tj ET\n"
    );
    d.addPageFromString("BT /F1 16 Tf 72 700 Td (Schedule A.) Tj ET\n");
    return d.build();
}

/** Read /ByteRange [a b c d] from a signed PDF. */
function readByteRange(s) {
    const m = /\/ByteRange \[(\d+) (\d+) (\d+) (\d+)\]/.exec(s);
    return m ? m.slice(1, 5).map((x) => parseInt(x, 10)) : null;
}

/** Read the /Contents hex string. */
function readContentsHex(s) {
    const m = /\/Contents <([0-9a-fA-F]*)>/.exec(s);
    return m ? m[1] : null;
}

/** @param {string} hex @returns {Uint8Array} (trailing zero padding trimmed) */
function hexToBytes(hex) {
    let end = hex.length;
    while (end >= 2 && hex.slice(end - 2, end) === "00") {
        end -= 2;
    }
    const h = hex.slice(0, end);
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(h.substr(i * 2, 2), 16);
    }
    return out;
}

/** Walk the CMS to the signed attributes and the signature. */
function walkCMS(cms) {
    const ci = parseTLV(cms, 0);
    let p = ci.contentStart;
    p = parseTLV(cms, p).tlvEnd; // contentType OID
    const exp0 = parseTLV(cms, p); // [0] EXPLICIT
    const sd = parseTLV(cms, exp0.contentStart); // SignedData
    let q = sd.contentStart;
    q = parseTLV(cms, q).tlvEnd; // version
    q = parseTLV(cms, q).tlvEnd; // digestAlgorithms
    q = parseTLV(cms, q).tlvEnd; // encapContentInfo
    let el = parseTLV(cms, q);
    if (el.tag === 0xa0) {
        q = el.tlvEnd;
        el = parseTLV(cms, q); // certificates [0] -> skip
    }
    const si = parseTLV(cms, el.contentStart); // SignerInfo
    let r = si.contentStart;
    r = parseTLV(cms, r).tlvEnd; // version
    r = parseTLV(cms, r).tlvEnd; // sid
    r = parseTLV(cms, r).tlvEnd; // digestAlgorithm
    const signedAttrs = parseTLV(cms, r);
    r = signedAttrs.tlvEnd;
    r = parseTLV(cms, r).tlvEnd; // signatureAlgorithm
    const sigOctet = parseTLV(cms, r); // signature OCTET STRING
    return {
        attrsContent: cms.slice(
            signedAttrs.contentStart,
            signedAttrs.contentEnd
        ),
        signature: cms.slice(sigOctet.contentStart, sigOctet.contentEnd)
    };
}

const MESSAGE_DIGEST_OID = Uint8Array.of(
    0x2a,
    0x86,
    0x48,
    0x86,
    0xf7,
    0x0d,
    0x01,
    0x09,
    0x04
);

/** Pull the messageDigest attribute value out of the signed attributes. */
function extractMessageDigest(attrsContent) {
    let p = 0;
    while (p < attrsContent.length) {
        const attr = parseTLV(attrsContent, p);
        const oidTlv = parseTLV(attrsContent, attr.contentStart);
        const oidBytes = attrsContent.slice(
            oidTlv.contentStart,
            oidTlv.contentEnd
        );
        if (
            oidBytes.length === MESSAGE_DIGEST_OID.length &&
            oidBytes.every((b, i) => b === MESSAGE_DIGEST_OID[i])
        ) {
            const setTlv = parseTLV(attrsContent, oidTlv.tlvEnd);
            const octet = parseTLV(attrsContent, setTlv.contentStart);
            return attrsContent.slice(octet.contentStart, octet.contentEnd);
        }
        p = attr.tlvEnd;
    }
    return null;
}

test(
    "signed PDF has the signature dict, real ByteRange, and AcroForm",
    { skip: !HAS_OPENSSL },
    () => {
        const signed = signPdf(buildDoc(), {
            privateKey: KEY,
            certificate: CERT,
            name: "Solomon Labs",
            reason: "Execution",
            signingTime: new Date()
        });
        const s = toLatin1(signed);

        assert.ok(s.includes("/Type /Sig"), "signature value dict");
        assert.ok(
            s.includes("/SubFilter /adbe.pkcs7.detached"),
            "detached CMS"
        );
        assert.ok(s.includes("/FT /Sig"), "signature field");
        assert.ok(s.includes("/SigFlags 3"), "AcroForm SigFlags");
        assert.ok(/\/Prev \d+/.test(s), "incremental update");

        const br = readByteRange(s);
        assert.ok(br, "ByteRange present");
        assert.notEqual(br[1], 0, "ByteRange filled (not placeholder)");
        assert.equal(br[0], 0, "first range starts at 0");
        // ranges cover the whole file except the Contents gap
        assert.equal(br[2] + br[3], signed.length, "second range reaches EOF");

        const hex = readContentsHex(s);
        assert.ok(
            hex && /[1-9a-f]/.test(hex),
            "Contents is a real signature, not zeros"
        );
    }
);

test(
    "CMS signature verifies against the signer certificate",
    { skip: !HAS_OPENSSL },
    () => {
        const signed = signPdf(buildDoc(), {
            privateKey: KEY,
            certificate: CERT,
            signingTime: new Date()
        });
        const s = toLatin1(signed);
        const cms = hexToBytes(readContentsHex(s));
        const { attrsContent, signature } = walkCMS(cms);

        // Verify RSA signature over the SET-tagged signed attributes.
        const setTagged = tlv(0x31, attrsContent);
        const pub = new X509Certificate(CERT).publicKey;
        assert.ok(
            cryptoVerify("sha256", setTagged, pub, signature),
            "signature over signed attributes is valid"
        );
    }
);

test(
    "messageDigest matches the ByteRange bytes, and tampering breaks it",
    { skip: !HAS_OPENSSL },
    () => {
        const signed = signPdf(buildDoc(), {
            privateKey: KEY,
            certificate: CERT
        });
        const s = toLatin1(signed);
        const br = readByteRange(s);
        const cms = hexToBytes(readContentsHex(s));
        const { attrsContent } = walkCMS(cms);
        const md = extractMessageDigest(attrsContent);
        assert.ok(md, "messageDigest attribute present");

        // Recompute the digest over the two signed ranges.
        const part1 = signed.slice(br[0], br[0] + br[1]);
        const part2 = signed.slice(br[2], br[2] + br[3]);
        const combined = new Uint8Array(part1.length + part2.length);
        combined.set(part1, 0);
        combined.set(part2, part1.length);
        const digest = new Uint8Array(
            createHash("sha256").update(combined).digest()
        );

        assert.deepEqual(
            [...digest],
            [...md],
            "signed digest matches document"
        );

        // Tamper with a byte in the first signed range -> digest no longer matches.
        combined[50] = combined[50] ^ 0xff;
        const tampered = new Uint8Array(
            createHash("sha256").update(combined).digest()
        );
        assert.notDeepEqual([...tampered], [...md], "tampering is detectable");
    }
);
