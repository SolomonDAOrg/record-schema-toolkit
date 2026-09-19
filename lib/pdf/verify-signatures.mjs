import { createHash, verify as verifySignature, X509Certificate } from "node:crypto";
import { loadPdf } from "./reader.mjs";
import { parseTLV, oid, tlv, extractIssuerAndSerial } from "./asn1.mjs";

/** @typedef {ReturnType<typeof parseTLV>} DerElement */
/** @param {Uint8Array} bytes @param {DerElement} parent @returns {DerElement[]} */
function children(bytes, parent) {
    const result = [];
    for (let offset = parent.contentStart; offset < parent.contentEnd;) {
        const child = parseTLV(bytes, offset);
        if (child.tlvEnd > parent.contentEnd) throw new Error("DER child exceeds parent.");
        result.push(child);
        offset = child.tlvEnd;
    }
    return result;
}
/** @param {Uint8Array} bytes @param {DerElement} element */
function encoded(bytes, element) { return Buffer.from(bytes.subarray(element.tlvStart, element.tlvEnd)); }
/** @param {Uint8Array} bytes @param {DerElement} element @param {string} expected */
function isOid(bytes, element, expected) { return encoded(bytes, element).equals(oid(expected)); }

/** Verify the detached CMS profile emitted by signPdf. This does not establish certificate trust.
 * @param {Uint8Array} signedBytes
 * @param {Uint8Array} cms
 */
export function verifyCMS(signedBytes, cms) {
    const outer = parseTLV(cms, 0);
    const contentInfo = children(cms, outer);
    if (outer.tag !== 0x30 || contentInfo.length !== 2 || !isOid(cms, contentInfo[0], "1.2.840.113549.1.7.2") || contentInfo[1].tag !== 0xa0)
        throw new Error("Expected CMS SignedData.");
    const wrapped = children(cms, contentInfo[1]);
    if (wrapped.length !== 1) throw new Error("Invalid SignedData wrapper.");
    const data = children(cms, wrapped[0]);
    if (data.length !== 5 || data[3].tag !== 0xa0 || data[4].tag !== 0x31)
        throw new Error("Unsupported CMS structure.");
    const content = children(cms, data[2]);
    if (content.length !== 1 || !isOid(cms, content[0], "1.2.840.113549.1.7.1")) throw new Error("CMS must have detached data content.");
    const signers = children(cms, data[4]);
    if (signers.length !== 1) throw new Error("Expected one signer per PDF signature.");
    const signer = children(cms, signers[0]);
    if (signer.length !== 6 || signer[3].tag !== 0xa0 || signer[5].tag !== 0x04)
        throw new Error("Unsupported CMS SignerInfo.");
    const certificates = children(cms, data[3]).map(item => new X509Certificate(encoded(cms, item)));
    const identity = children(cms, signer[1]);
    if (identity.length !== 2) throw new Error("Invalid CMS signer identifier.");
    const matches = certificates.filter(cert => {
        const parts = extractIssuerAndSerial(cert.raw);
        return encoded(cms, identity[0]).equals(parts.issuerTlv) && encoded(cms, identity[1]).equals(parts.serialTlv);
    });
    if (matches.length !== 1) throw new Error("CMS signer certificate is missing or ambiguous.");
    const certificate = matches[0];
    const type = certificate.publicKey.asymmetricKeyType;
    const digest = type === "ed25519" ? "sha512" : "sha256";
    const digestOid = type === "ed25519" ? "2.16.840.1.101.3.4.2.3" : "2.16.840.1.101.3.4.2.1";
    const algorithm = children(cms, signer[4]);
    const signatureOid = {rsa: "1.2.840.113549.1.1.1", ec: "1.2.840.10045.4.3.2", ed25519: "1.3.101.112"}[type];
    if (!signatureOid || !isOid(cms, algorithm[0], signatureOid)) throw new Error("Unsupported CMS signature algorithm.");
    const digestAlgorithms = children(cms, data[1]);
    if (digestAlgorithms.length !== 1 ||
        !isOid(cms, children(cms, digestAlgorithms[0])[0], digestOid) ||
        !isOid(cms, children(cms, signer[2])[0], digestOid))
        throw new Error("CMS digest algorithms disagree.");
    const attrs = children(cms, signer[3]);
    const values = new Map();
    for (const attribute of attrs) {
        const parts = children(cms, attribute);
        if (parts.length !== 2 || parts[1].tag !== 0x31) throw new Error("Malformed CMS signed attribute.");
        const key = encoded(cms, parts[0]).toString("hex");
        if (values.has(key)) throw new Error("Duplicate CMS signed attribute.");
        values.set(key, children(cms, parts[1]));
    }
    const contentType = values.get(Buffer.from(oid("1.2.840.113549.1.9.3")).toString("hex"));
    const messageDigest = values.get(Buffer.from(oid("1.2.840.113549.1.9.4")).toString("hex"));
    if (contentType?.length !== 1 || !isOid(cms, contentType[0], "1.2.840.113549.1.7.1") ||
        messageDigest?.length !== 1 || messageDigest[0].tag !== 0x04)
        throw new Error("Required CMS signed attributes are missing.");
    const expected = createHash(digest).update(signedBytes).digest();
    if (!expected.equals(cms.subarray(messageDigest[0].contentStart, messageDigest[0].contentEnd)))
        throw new Error("Signed document digest does not match.");
    const signedAttributes = tlv(0x31, cms.subarray(signer[3].contentStart, signer[3].contentEnd));
    if (!verifySignature(type === "ed25519" ? null : "sha256", signedAttributes, certificate.publicKey, cms.subarray(signer[5].contentStart, signer[5].contentEnd)))
        throw new Error("CMS signature verification failed.");
    return {certificateSubject: certificate.subject, certificateFingerprint256: certificate.fingerprint256, trust: "not_checked"};
}

/** Mathematical integrity and revision coverage only; certificate trust/revocation and DocMDP are not evaluated.
 * @param {Uint8Array} bytes
 */
export function verifyPdfSignatures(bytes) {
    const editor = loadPdf(bytes);
    return editor.getSignatureFields().map(field => {
        if (field.valueId === null) return {fieldName: field.fieldName, signed: false};
        if (field.subFilter !== "/adbe.pkcs7.detached") throw new Error("Unsupported PDF signature subfilter.");
        const match = /^\[0\s+(\d+)\s+(\d+)\s+(\d+)\]$/.exec(field.byteRange || "");
        if (!match) throw new Error("Invalid PDF signature byte range.");
        const [, firstText, secondText, lengthText] = match;
        const first = Number(firstText), second = Number(secondText), length = Number(lengthText);
        const signedLength = second + length;
        if (![first, second, length, signedLength].every(Number.isSafeInteger) || first <= 0 || second <= first || length <= 0 || signedLength > bytes.length)
            throw new Error("PDF signature byte range exceeds the document.");
        if (!/^<[0-9a-fA-F]+>$/.test(field.contents || "") || field.contents.length % 2 !== 0)
            throw new Error("Invalid PDF signature contents.");
        const offset = editor.offsets.get(field.valueId);
        const dictionary = editor.getObjectRaw(field.valueId).dictPart;
        const dictionaryStart = editor.s.indexOf(dictionary, offset);
        const expectedGap = dictionaryStart + dictionary.indexOf(field.contents);
        if (offset === undefined || dictionaryStart < offset || expectedGap !== first || second - first !== field.contents.length ||
            Buffer.from(bytes.subarray(first, second)).toString("ascii") !== field.contents)
            throw new Error("Signature gap does not identify this signature dictionary.");
        if (!Buffer.from(bytes.subarray(signedLength - 6, signedLength)).equals(Buffer.from("%%EOF\n")))
            throw new Error("Signature does not cover a complete PDF revision.");
        const revision = loadPdf(bytes.subarray(0, signedLength)).getSignatureFields().find(item => item.fieldName === field.fieldName);
        if (revision?.valueId !== field.valueId) throw new Error("Signature field was changed after its signed revision.");
        const padded = Buffer.from(field.contents.slice(1, -1), "hex");
        const cmsEnd = parseTLV(padded, 0).tlvEnd;
        if (padded.subarray(cmsEnd).some(value => value !== 0)) throw new Error("Unexpected data in PDF signature padding.");
        const cms = verifyCMS(Buffer.concat([bytes.subarray(0, first), bytes.subarray(second, signedLength)]), padded.subarray(0, cmsEnd));
        return {fieldName: field.fieldName, signed: true, integrity: "valid", signedLength, coversCurrentRevision: signedLength === bytes.length, ...cms};
    });
}
