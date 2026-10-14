/**
 * Wave 19 validation: reading/editing encrypted PDFs (decryption). Round-trips
 * the library's own encryption for the core cases and cross-checks against qpdf
 * (skipped if qpdf is absent). node internals only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

import DocMod from "../../lib/pdf/document.mjs";
import { loadPdf } from "../../lib/pdf/reader.mjs";
import { extractPages } from "../../lib/pdf/merge.mjs";

const { PdfDocumentBuilder } = DocMod;
const dec = new TextDecoder("latin1");

let HAS_QPDF = true;
try {
    execSync("qpdf --version", { stdio: "ignore" });
} catch {
    HAS_QPDF = false;
}

/** Encrypted 2-page doc where page i shows "SECRET{i}". */
function encDoc(encryption) {
    const d = new PdfDocumentBuilder({ title: "Enc", encryption });
    for (let i = 1; i <= 2; i++) {
        d.addPageFromString(`BT /F1 16 Tf 72 700 Td (SECRET${i}) Tj ET\n`);
    }
    return d.build();
}

/** Decrypt + decompress page 1's content. */
function page1(bytes, password) {
    const ed = loadPdf(bytes, { password });
    const pid = ed.getPageTree().leafIds[0];
    const cid = parseInt(
        /\/Contents (\d+) 0 R/.exec(ed.getObjectRaw(pid).dictPart)[1],
        10
    );
    const c = ed.getObjectRaw(cid);
    return dec.decode(new Uint8Array(inflateSync(Buffer.from(c.streamBytes))));
}

test("AES-128 with an empty user password decrypts", () => {
    assert.ok(
        page1(encDoc({ algorithm: "aes-128" }), "").includes("(SECRET1)")
    );
});

test("AES-128 with a user password decrypts", () => {
    const enc = encDoc({ algorithm: "aes-128", userPassword: "open123" });
    assert.ok(page1(enc, "open123").includes("(SECRET1)"));
});

test("AES-128 opens with the owner password too", () => {
    const enc = encDoc({
        algorithm: "aes-128",
        userPassword: "u",
        ownerPassword: "owner"
    });
    assert.ok(
        page1(enc, "owner").includes("(SECRET1)"),
        "owner password works"
    );
});

test("AES-256 (V5/R6) decrypts with user and owner passwords", () => {
    const enc = encDoc({
        algorithm: "aes-256",
        userPassword: "user",
        ownerPassword: "boss"
    });
    assert.ok(page1(enc, "user").includes("(SECRET1)"), "user");
    assert.ok(page1(enc, "boss").includes("(SECRET1)"), "owner");
});

test("an incorrect password is rejected", () => {
    const enc = encDoc({ algorithm: "aes-128", userPassword: "right" });
    assert.throws(() => page1(enc, "wrong"), /password/);
});

test("string values are decrypted, not just streams", () => {
    const enc = encDoc({ algorithm: "aes-256", userPassword: "p" });
    const ed = loadPdf(enc, { password: "p" });
    let titleOk = false;
    for (const id of ed.allObjectIds()) {
        try {
            const raw = ed.getObjectRaw(id);
            if (/\/Title/.test(raw.dictPart)) {
                // Info dict encodes "Enc" as UTF-16BE hex <FEFF0045006E0063>
                titleOk = raw.dictPart
                    .toUpperCase()
                    .replace(/\s/g, "")
                    .includes("FEFF0045006E0063");
            }
        } catch {
            /* ignore */
        }
    }
    assert.ok(titleOk, "Title string decrypted to 'Enc'");
});

test("extractPages works on an empty-password encrypted PDF (plaintext out)", () => {
    const enc = encDoc({ algorithm: "aes-128" });
    const out = extractPages(enc, [2]);
    const s = dec.decode(out);
    assert.ok(!s.includes("/Encrypt"), "output is not encrypted");
    assert.equal(loadPdf(out).pageCount(), 1);
});

test("extractPages accepts a password for protected input", () => {
    const enc = encDoc({ algorithm: "aes-256", userPassword: "secret" });
    const out = extractPages(enc, [1], { password: "secret" });
    assert.equal(loadPdf(out).pageCount(), 1);
    assert.ok(
        page1(out, "").includes("(SECRET1)"),
        "plaintext content correct"
    );
});

test("decrypts a qpdf-encrypted AES-256 file", { skip: !HAS_QPDF }, () => {
    const d = new PdfDocumentBuilder({ title: "P" });
    d.addPageFromString("BT /F1 16 Tf 72 700 Td (QPDFSECRET) Tj ET\n");
    writeFileSync("/tmp/wt19_plain.pdf", d.build());
    execSync(
        'qpdf --encrypt "" "" 256 -- /tmp/wt19_plain.pdf /tmp/wt19_enc.pdf',
        { stdio: "ignore" }
    );
    const ed = loadPdf(new Uint8Array(readFileSync("/tmp/wt19_enc.pdf")), {
        password: ""
    });
    const pid = ed.getPageTree().leafIds[0];
    const cid = parseInt(
        /\/Contents (\d+) 0 R/.exec(ed.getObjectRaw(pid).dictPart)[1],
        10
    );
    const c = ed.getObjectRaw(cid);
    let txt;
    try {
        txt = dec.decode(
            new Uint8Array(inflateSync(Buffer.from(c.streamBytes)))
        );
    } catch {
        txt = dec.decode(c.streamBytes);
    }
    assert.ok(txt.includes("QPDFSECRET"), "qpdf-encrypted content decrypted");
});

test(
    "decrypts a qpdf-encrypted RC4 (128-bit) file",
    { skip: !HAS_QPDF },
    () => {
        const d = new PdfDocumentBuilder({ title: "R" });
        d.addPageFromString("BT /F1 16 Tf 72 700 Td (RC4SECRET) Tj ET\n");
        writeFileSync("/tmp/wt19_rc4p.pdf", d.build());
        execSync(
            'qpdf --allow-weak-crypto --encrypt "" "" 128 --use-aes=n -- /tmp/wt19_rc4p.pdf /tmp/wt19_rc4.pdf',
            { stdio: "ignore" }
        );
        const ed = loadPdf(new Uint8Array(readFileSync("/tmp/wt19_rc4.pdf")), {
            password: ""
        });
        const pid = ed.getPageTree().leafIds[0];
        const cid = parseInt(
            /\/Contents (\d+) 0 R/.exec(ed.getObjectRaw(pid).dictPart)[1],
            10
        );
        const c = ed.getObjectRaw(cid);
        let txt;
        try {
            txt = dec.decode(
                new Uint8Array(inflateSync(Buffer.from(c.streamBytes)))
            );
        } catch {
            txt = dec.decode(c.streamBytes);
        }
        assert.ok(txt.includes("RC4SECRET"), "RC4-encrypted content decrypted");
    }
);
