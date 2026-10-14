/**
 * Wave 22 validation: Ed25519 digital signatures (RFC 8419 — SHA-512 digest,
 * id-Ed25519, pure/no-prehash signing). An Ed25519 cert is generated via openssl
 * at test time; skips if openssl is unavailable. node internals only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { verify as cryptoVerify, X509Certificate } from "node:crypto";

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
        "openssl req -x509 -newkey ed25519 -keyout /tmp/wt22_ed.pem -out /tmp/wt22_ed_cert.pem -days 30 -nodes -subj '/CN=Ed Test/O=Solomon Labs'",
        { stdio: "ignore" }
    );
    KEY = readFileSync("/tmp/wt22_ed.pem");
    CERT = readFileSync("/tmp/wt22_ed_cert.pem");
} catch {
    HAS_OPENSSL = false;
}

function buildSigned() {
    const d = new PdfDocumentBuilder({ title: "Ed" });
    d.addPageFromString("BT /F1 16 Tf 72 700 Td (Ed25519 signed) Tj ET\n");
    return dec.decode(
        signPdf(d.build(), {
            privateKey: KEY,
            certificate: CERT,
            signingTime: new Date()
        })
    );
}
function contentsCms(s) {
    const hex = /\/Contents <([0-9a-fA-F]*)>/.exec(s)[1];
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return out.slice(0, parseTLV(out, 0).tlvEnd);
}
function walkCMS(cms) {
    const ci = parseTLV(cms, 0);
    let p = parseTLV(cms, ci.contentStart).tlvEnd;
    const sd = parseTLV(cms, parseTLV(cms, p).contentStart);
    let q = sd.contentStart;
    q = parseTLV(cms, q).tlvEnd;
    q = parseTLV(cms, q).tlvEnd;
    q = parseTLV(cms, q).tlvEnd;
    let el = parseTLV(cms, q);
    if (el.tag === 0xa0) {
        el = parseTLV(cms, el.tlvEnd);
    }
    const si = parseTLV(cms, el.contentStart);
    let r = si.contentStart;
    r = parseTLV(cms, r).tlvEnd; // version
    r = parseTLV(cms, r).tlvEnd; // issuerAndSerialNumber
    const digAlg = parseTLV(cms, r);
    r = digAlg.tlvEnd; // past digestAlgorithm
    const signedAttrs = parseTLV(cms, r);
    r = signedAttrs.tlvEnd;
    const sigAlg = parseTLV(cms, r);
    r = sigAlg.tlvEnd;
    const sig = parseTLV(cms, r);
    return {
        digAlg: cms.slice(digAlg.tlvStart, digAlg.tlvEnd),
        attrs: cms.slice(signedAttrs.contentStart, signedAttrs.contentEnd),
        sigAlg: cms.slice(sigAlg.contentStart, sigAlg.contentEnd),
        signature: cms.slice(sig.contentStart, sig.contentEnd)
    };
}
function hasBytes(hay, needleHex) {
    const h = Buffer.from(hay).toString("hex");
    return h.includes(needleHex);
}

test(
    "Ed25519-signed PDF has a detached CMS and real ByteRange",
    { skip: !HAS_OPENSSL },
    () => {
        const s = buildSigned();
        assert.ok(
            s.includes("/SubFilter /adbe.pkcs7.detached"),
            "detached CMS"
        );
        const br = /\/ByteRange \[(\d+) (\d+) (\d+) (\d+)\]/.exec(s);
        assert.ok(br && parseInt(br[2], 10) !== 0, "ByteRange filled");
    }
);

test(
    "CMS uses id-Ed25519 and a SHA-512 digest (RFC 8419)",
    { skip: !HAS_OPENSSL },
    () => {
        const { digAlg, sigAlg } = walkCMS(contentsCms(buildSigned()));
        // id-Ed25519 = 1.3.101.112 -> OID bytes 2b6570
        assert.ok(hasBytes(sigAlg, "2b6570"), "id-Ed25519 signatureAlgorithm");
        // SHA-512 = 2.16.840.1.101.3.4.2.3 -> 608648016503040203
        assert.ok(
            hasBytes(digAlg, "608648016503040203"),
            "SHA-512 digestAlgorithm"
        );
    }
);

test(
    "the 64-byte Ed25519 signature verifies against the certificate",
    { skip: !HAS_OPENSSL },
    () => {
        const { attrs, signature } = walkCMS(contentsCms(buildSigned()));
        assert.equal(signature.length, 64, "Ed25519 signatures are 64 bytes");
        const setTagged = tlv(0x31, attrs);
        const pub = new X509Certificate(CERT).publicKey;
        // pure Ed25519 verify (no prehash)
        assert.ok(
            cryptoVerify(
                null,
                Buffer.from(setTagged),
                pub,
                Buffer.from(signature)
            ),
            "Ed25519 signature is valid"
        );
    }
);

test("CMS extraction preserves a terminal zero byte within the DER length", () => {
    assert.deepEqual(Array.from(contentsCms("/Contents <3003040100000000>")), [0x30, 0x03, 0x04, 0x01, 0x00]);
});
