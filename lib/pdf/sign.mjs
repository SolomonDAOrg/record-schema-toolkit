/**
 * PDF digital signatures — detached CMS (PKCS#7) over an incremental update.
 *
 * Produces an adbe.pkcs7.detached signature: a SHA-256 CMS SignedData with
 * signed attributes (contentType, messageDigest, optional signingTime), signed
 * with the caller's RSA private key (via node:crypto) and the signer certificate
 * embedded. The byte-range/placeholder mechanics live in reader.mjs; this module
 * builds the CMS and drives the signing. No third-party dependencies.
 * @module Sign
 */

import {
    createHash,
    sign as cryptoSign,
    createPrivateKey,
    X509Certificate
} from "node:crypto";
import { concatBytes } from "./primitives.mjs";
import { loadPdf } from "./reader.mjs";
import {
    seq,
    set,
    oid,
    integer,
    octetString,
    nullValue,
    contextConstructed,
    utcTime,
    derSort,
    extractIssuerAndSerial
} from "./asn1.mjs";

const OID = {
    signedData: "1.2.840.113549.1.7.2",
    data: "1.2.840.113549.1.7.1",
    sha256: "2.16.840.1.101.3.4.2.1",
    rsaEncryption: "1.2.840.113549.1.1.1",
    ecdsaWithSHA256: "1.2.840.10045.4.3.2",
    ed25519: "1.3.101.112",
    sha512: "2.16.840.1.101.3.4.2.3",
    contentTypeAttr: "1.2.840.113549.1.9.3",
    messageDigestAttr: "1.2.840.113549.1.9.4",
    signingTimeAttr: "1.2.840.113549.1.9.5"
};

/**
 * Build a detached CMS SignedData (DER) over the given signed bytes.
 * @param {Uint8Array} signedBytes - the bytes covered by /ByteRange
 * @param {string | Buffer} privateKey - RSA private key (PEM or KeyObject-compatible)
 * @param {Uint8Array} certDer - signer certificate, DER
 * @param {{ signingTime?: Date }} opts
 * @returns {Uint8Array}
 */
export function buildCMS(signedBytes, privateKey, certDer, opts) {
    const keyObj = createPrivateKey(privateKey);
    const keyType = keyObj.asymmetricKeyType;
    const isEd = keyType === "ed25519";
    const isEc = keyType === "ec";
    // RFC 8419: Ed25519 uses SHA-512 for the content digest; RSA/ECDSA use SHA-256.
    const digestName = isEd ? "sha512" : "sha256";
    const digestOid = isEd ? OID.sha512 : OID.sha256;

    const digest = new Uint8Array(
        createHash(digestName).update(signedBytes).digest()
    );
    const { issuerTlv, serialTlv } = extractIssuerAndSerial(certDer);

    // Signed attributes (DER-sorted, as required for SET OF).
    const attrs = [
        seq(oid(OID.contentTypeAttr), set(oid(OID.data))),
        seq(oid(OID.messageDigestAttr), set(octetString(digest)))
    ];
    if (opts.signingTime) {
        attrs.push(
            seq(oid(OID.signingTimeAttr), set(utcTime(opts.signingTime)))
        );
    }
    const sorted = derSort(attrs);
    const attrsContent = concatBytes(sorted);

    // The signature is over the SET-tagged (0x31) encoding of the attributes,
    // even though they are stored [0] IMPLICIT (0xA0) inside SignerInfo.
    const attrsForSigning = set(...sorted);

    // signatureAlgorithm: Ed25519 -> id-Ed25519; ECDSA -> ecdsa-with-SHA256;
    // RSA -> rsaEncryption + NULL. Ed25519 signs the attrs directly (pure, no
    // prehash); RSA/ECDSA sign SHA-256 of the attrs (ECDSA returns DER r/s).
    let sigAlgId;
    if (isEd) {
        sigAlgId = seq(oid(OID.ed25519));
    } else if (isEc) {
        sigAlgId = seq(oid(OID.ecdsaWithSHA256));
    } else {
        sigAlgId = seq(oid(OID.rsaEncryption), nullValue());
    }
    const signature = new Uint8Array(
        isEd
            ? cryptoSign(null, attrsForSigning, keyObj)
            : cryptoSign("sha256", attrsForSigning, keyObj)
    );

    const signerInfo = seq(
        integer(1),
        seq(issuerTlv, serialTlv), // issuerAndSerialNumber
        seq(oid(digestOid)), // digestAlgorithm
        contextConstructed(0, attrsContent), // signedAttrs [0] IMPLICIT
        sigAlgId, // signatureAlgorithm
        octetString(signature)
    );

    const signedData = seq(
        integer(1),
        set(seq(oid(digestOid))), // digestAlgorithms
        seq(oid(OID.data)), // encapContentInfo (detached: no eContent)
        contextConstructed(0, certDer), // certificates [0] IMPLICIT SET OF
        set(signerInfo) // signerInfos
    );

    return seq(
        oid(OID.signedData),
        contextConstructed(0, signedData) // content [0] EXPLICIT
    );
}

/**
 * @typedef {Object} SignOptions
 * @property {string | Buffer} privateKey - signer private key, PEM (RSA, EC, or Ed25519)
 * @property {string | Buffer} certificate - signer certificate, PEM
 * @property {string} [fieldName] - signature field name (default "Signature1")
 * @property {string} [name] - signer name shown in /Name
 * @property {string} [reason]
 * @property {string} [location]
 * @property {Date} [signingTime] - included as a signed attribute and /M
 * @property {number} [reservedBytes] - reserved /Contents capacity (default 8192)
 */

/**
 * Digitally sign a PDF, returning a new signed PDF (incremental update).
 * The input must be an unencrypted, classic-xref PDF.
 * @param {Uint8Array} bytes
 * @param {SignOptions} options
 * @returns {Uint8Array}
 */
export function signPdf(bytes, options) {
    const cert = new X509Certificate(options.certificate);
    const certDer = new Uint8Array(cert.raw);

    const ed = loadPdf(bytes);
    ed.addSignatureField({
        fieldName: options.fieldName,
        name: options.name,
        reason: options.reason,
        location: options.location,
        signingTime: options.signingTime,
        reservedBytes: options.reservedBytes
    });
    return ed.saveSigned((signed) =>
        buildCMS(signed, options.privateKey, certDer, {
            signingTime: options.signingTime
        })
    );
}

export default { signPdf, buildCMS };
