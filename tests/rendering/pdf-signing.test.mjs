import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, X509Certificate } from "node:crypto";
import {
    seq,
    set,
    oid,
    integer,
    nullValue,
    tlv,
    utcTime
} from "../../lib/pdf/asn1.mjs";
import { PdfDocumentBuilder } from "../../lib/pdf/document.mjs";
import { signPdf } from "../../lib/pdf/sign.mjs";
import { verifyPdfSignatures } from "../../lib/pdf/verify-signatures.mjs";
import { loadPdf } from "../../lib/pdf/reader.mjs";

/** @param {"rsa" | "ec" | "ed25519"} [type] */
function credential(type = "rsa") {
    const { privateKey, publicKey } =
        type === "rsa"
            ? generateKeyPairSync("rsa", { modulusLength: 2048 })
            : type === "ec"
            ? generateKeyPairSync("ec", { namedCurve: "prime256v1" })
            : generateKeyPairSync("ed25519");
    const algorithm =
        type === "rsa"
            ? seq(oid("1.2.840.113549.1.1.11"), nullValue())
            : seq(oid(type === "ec" ? "1.2.840.10045.4.3.2" : "1.3.101.112"));
    const name = seq(
        set(
            seq(
                oid("2.5.4.3"),
                tlv(0x0c, Buffer.from("TEST ONLY - NOT AN EXECUTED AGREEMENT"))
            )
        )
    );
    const tbs = seq(
        integer(1),
        algorithm,
        name,
        seq(utcTime(new Date("2020-01-01Z")), utcTime(new Date("2040-01-01Z"))),
        name,
        publicKey.export({ type: "spki", format: "der" })
    );
    const raw = seq(
        tbs,
        algorithm,
        tlv(
            0x03,
            Buffer.concat([
                Buffer.from([0]),
                sign(type === "ed25519" ? null : "sha256", tbs, privateKey)
            ])
        )
    );
    return {
        privateKey,
        certificate: new X509Certificate(raw).toString(),
        signingTime: new Date("2030-01-01T00:00:00Z")
    };
}
function pdf() {
    const doc = new PdfDocumentBuilder({
        includeDates: false,
        subject: "test subject"
    });
    doc.addPageFromString(
        "BT /F1 12 Tf 40 700 Td (Test agreement) Tj ET",
        ["operator", "counterparty"].map((name, index) => ({
            type: "form",
            fieldType: "signature",
            name,
            x: 40 + index * 230,
            y: 600,
            width: 200,
            height: 60
        }))
    );
    return doc.build();
}
test("two visible CMS signatures preserve original bytes and earlier signatures", () => {
    const key = credential(),
        original = pdf();
    const first = signPdf(original, {
        ...key,
        existingField: true,
        fieldName: "operator"
    });
    assert.deepEqual(first.subarray(0, original.length), original);
    const second = signPdf(first, {
        ...key,
        existingField: true,
        fieldName: "counterparty"
    });
    assert.deepEqual(second.subarray(0, first.length), first);
    const verified = verifyPdfSignatures(second);
    assert.deepEqual(
        verified.map((field) => {
            assert.equal(field.signed, true);
            return [field.fieldName, field.signed, field.coversCurrentRevision];
        }),
        [
            ["operator", true, false],
            ["counterparty", true, true]
        ]
    );
    assert.equal(loadPdf(second).getInfoText("Subject"), "test subject");
    assert.match(Buffer.from(second).toString("latin1"), /Digitally signed/);
    const tampered = Buffer.from(second);
    const position = tampered.indexOf(Buffer.from("/MediaBox [0 0 612"));
    assert.ok(position >= 0);
    tampered[position + "/MediaBox [0 0 ".length] = 53;
    assert.throws(() => verifyPdfSignatures(tampered), /digest does not match/);
});
test("signing refuses wrong credentials, missing slots and repeated signatures", () => {
    const key = credential(),
        wrong = credential(),
        original = pdf();
    assert.throws(
        () =>
            signPdf(original, {
                ...key,
                certificate: wrong.certificate,
                existingField: true,
                fieldName: "operator"
            }),
        /does not match/
    );
    assert.throws(
        () =>
            signPdf(original, {
                ...key,
                existingField: true,
                fieldName: "absent"
            }),
        /exactly one/
    );
    assert.throws(
        () =>
            signPdf(original, { ...key, signingTime: new Date("2050-01-01Z") }),
        /not valid/
    );
    const first = signPdf(original, {
        ...key,
        existingField: true,
        fieldName: "operator"
    });
    assert.throws(
        () =>
            signPdf(first, {
                ...key,
                existingField: true,
                fieldName: "operator"
            }),
        /already signed/
    );
});

for (const type of /** @type {const} */ (["ec", "ed25519"]))
    test(type + " CMS digest and signature algorithms verify", () => {
        const result = signPdf(pdf(), {
            ...credential(type),
            existingField: true,
            fieldName: "operator"
        });
        const fields = verifyPdfSignatures(result);
        assert.equal(fields[0].signed, true);
        assert.equal(fields[0].integrity, "valid");
        assert.equal(fields[0].coversCurrentRevision, true);
        assert.equal(fields[0].trust, "not_checked");
    });
