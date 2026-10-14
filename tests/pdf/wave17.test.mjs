/**
 * Wave 16 validation: ECDSA (elliptic-curve) digital signatures, extending the
 * detached-CMS signing to EC keys. An EC cert is generated via openssl at test
 * time; skips if openssl is unavailable. node internals only.
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
        "openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout /tmp/wt16_ec.pem -out /tmp/wt16_ec_cert.pem -days 30 -nodes -subj '/CN=EC Test/O=Solomon Labs'",
        { stdio: "ignore" }
    );
    KEY = readFileSync("/tmp/wt16_ec.pem");
    CERT = readFileSync("/tmp/wt16_ec_cert.pem");
} catch {
    HAS_OPENSSL = false;
}

function buildDoc() {
    const d = new PdfDocumentBuilder({ title: "EC" });
    d.addPageFromString("BT /F1 16 Tf 72 700 Td (EC signed) Tj ET\n");
    return d.build();
}

function readContentsHex(s) {
    const m = /\/Contents <([0-9a-fA-F]*)>/.exec(s);
    return m ? m[1] : null;
}
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
function walkCMS(cms) {
    const ci = parseTLV(cms, 0);
    let p = ci.contentStart;
    p = parseTLV(cms, p).tlvEnd;
    const exp0 = parseTLV(cms, p);
    const sd = parseTLV(cms, exp0.contentStart);
    let q = sd.contentStart;
    q = parseTLV(cms, q).tlvEnd;
    q = parseTLV(cms, q).tlvEnd;
    q = parseTLV(cms, q).tlvEnd;
    let el = parseTLV(cms, q);
    if (el.tag === 0xa0) {
        q = el.tlvEnd;
        el = parseTLV(cms, q);
    }
    const si = parseTLV(cms, el.contentStart);
    let r = si.contentStart;
    r = parseTLV(cms, r).tlvEnd;
    r = parseTLV(cms, r).tlvEnd;
    r = parseTLV(cms, r).tlvEnd;
    const signedAttrs = parseTLV(cms, r);
    r = signedAttrs.tlvEnd;
    const sigAlg = parseTLV(cms, r);
    r = sigAlg.tlvEnd;
    const sigOctet = parseTLV(cms, r);
    return {
        attrsContent: cms.slice(
            signedAttrs.contentStart,
            signedAttrs.contentEnd
        ),
        sigAlg: cms.slice(sigAlg.tlvStart, sigAlg.tlvEnd),
        signature: cms.slice(sigOctet.contentStart, sigOctet.contentEnd)
    };
}

// ecdsa-with-SHA256 OID bytes (1.2.840.10045.4.3.2)
const ECDSA_SHA256_OID = Uint8Array.of(
    0x2a,
    0x86,
    0x48,
    0xce,
    0x3d,
    0x04,
    0x03,
    0x02
);

test(
    "EC-signed PDF has a detached signature and real ByteRange",
    { skip: !HAS_OPENSSL },
    () => {
        const s = dec.decode(
            signPdf(buildDoc(), {
                privateKey: KEY,
                certificate: CERT,
                signingTime: new Date()
            })
        );
        assert.ok(
            s.includes("/SubFilter /adbe.pkcs7.detached"),
            "detached CMS"
        );
        const br = /\/ByteRange \[(\d+) (\d+) (\d+) (\d+)\]/.exec(s);
        assert.ok(br, "ByteRange present");
        assert.notEqual(parseInt(br[2], 10), 0, "ByteRange filled");
    }
);

test(
    "CMS uses the ecdsa-with-SHA256 signature algorithm",
    { skip: !HAS_OPENSSL },
    () => {
        const s = dec.decode(
            signPdf(buildDoc(), { privateKey: KEY, certificate: CERT })
        );
        const cms = hexToBytes(readContentsHex(s));
        const { sigAlg } = walkCMS(cms);
        // the sigAlg AlgorithmIdentifier SEQUENCE must contain the ECDSA OID bytes
        let found = false;
        for (let i = 0; i + ECDSA_SHA256_OID.length <= sigAlg.length; i++) {
            let ok = true;
            for (let j = 0; j < ECDSA_SHA256_OID.length; j++) {
                if (sigAlg[i + j] !== ECDSA_SHA256_OID[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) {
                found = true;
                break;
            }
        }
        assert.ok(found, "ecdsa-with-SHA256 OID present in signatureAlgorithm");
    }
);

test(
    "the ECDSA signature verifies against the signer certificate",
    { skip: !HAS_OPENSSL },
    () => {
        const s = dec.decode(
            signPdf(buildDoc(), { privateKey: KEY, certificate: CERT })
        );
        const cms = hexToBytes(readContentsHex(s));
        const { attrsContent, signature } = walkCMS(cms);
        const setTagged = tlv(0x31, attrsContent);
        const pub = new X509Certificate(CERT).publicKey;
        // node verifies the DER-encoded ECDSA signature over the SHA-256 of the attrs
        assert.ok(
            cryptoVerify("sha256", setTagged, pub, signature),
            "ECDSA signature is valid"
        );
    }
);
