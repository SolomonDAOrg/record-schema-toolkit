#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createHash, createPrivateKey } from "node:crypto";
import { CLI } from "../lib/cli/cli.mjs";
import { Repository } from "../lib/record-schema/Repository.mjs";
import { DocumentInstance } from "../lib/record-schema/templates/DocumentInstance.mjs";
import { signPdf } from "../lib/pdf/sign.mjs";
import { loadPdf } from "../lib/pdf/reader.mjs";
import { verifyPdfSignatures } from "../lib/pdf/verify-signatures.mjs";

const value = (description, fallback = null) => ({
    description,
    default: fallback,
    type: "string"
});
const options = CLI.handleCLI({
    scriptName: "sign",
    description:
        "Sign one declared visible field on an existing for-execution PDF",
    schema: {
        flags: {},
        values: {
            root: value("Series record directory", "."),
            instance: value("Named instance from series META"),
            input: value(
                "Existing PDF, including previous signatures; default: declared execution output"
            ),
            output: value("New signed PDF path; must not exist"),
            field: value("Exact signature slot ID from series META"),
            key: value("Local PEM private key path"),
            certificate: value("Local PEM signing certificate path"),
            "passphrase-env": value(
                "Environment variable holding an encrypted PEM key passphrase"
            ),
            "expected-sha256": value("Reviewed input PDF SHA-256; required")
        }
    }
});
try {
    for (const name of [
        "output",
        "field",
        "key",
        "certificate",
        "expected-sha256"
    ])
        if (!options[name]) throw new Error("Missing --" + name);
    if (!/^[a-f0-9]{64}$/.test(options["expected-sha256"]))
        throw new Error("Invalid expected SHA-256.");
    const repository = Repository.openWithDiscovery(resolve(options.root));
    const record = repository.getTargetRecord();
    if (!record?.metafile)
        throw new Error("--root must identify one series record.");
    const instance = DocumentInstance.load(repository, record, {
        instance: options.instance,
        stage: "for_execution"
    });
    if (
        !instance ||
        !Object.hasOwn(instance.contract.signatures, options.field)
    )
        throw new Error("Signature slot is not declared in this series.");
    const input = options.input
        ? resolve(options.input)
        : resolve(record.abs_path, instance.metafile.data.assembly.packet.path);
    const output = resolve(options.output);
    if (input === output)
        throw new Error("Signing requires a new output path.");
    const bytes = readFileSync(input);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== options["expected-sha256"])
        throw new Error("Reviewed PDF hash does not match the input.");
    const editor = loadPdf(bytes);
    const subject =
        "record-schema-instance:" +
        instance.bindingHash +
        ";" +
        instance.documentId +
        ";for_execution";
    if (editor.getInfoText("Subject") !== subject)
        throw new Error("PDF does not match this for-execution instance.");
    const before = verifyPdfSignatures(bytes);
    const signed = before.filter((field) => field.signed);
    if (
        signed.length &&
        !signed.some(
            (field) =>
                "coversCurrentRevision" in field && field.coversCurrentRevision
        )
    )
        throw new Error("Unsigned changes follow the last signature.");
    const target = before.filter((field) => field.fieldName === options.field);
    if (target.length !== 1 || target[0].signed)
        throw new Error(
            "Expected one unsigned visible field for the selected slot."
        );
    let passphrase;
    if (options["passphrase-env"]) {
        passphrase = process.env[options["passphrase-env"]];
        if (passphrase === undefined)
            throw new Error(
                "The key passphrase environment variable is not set."
            );
    }
    const key = createPrivateKey({
        key: readFileSync(resolve(options.key)),
        format: "pem",
        passphrase
    });
    const result = signPdf(bytes, {
        existingField: true,
        fieldName: options.field,
        privateKey: key,
        certificate: readFileSync(resolve(options.certificate)),
        signingTime: new Date()
    });
    const after = verifyPdfSignatures(result);
    if (
        after.filter((field) => field.signed).length !== signed.length + 1 ||
        !after.some(
            (field) =>
                field.fieldName === options.field &&
                "coversCurrentRevision" in field &&
                field.coversCurrentRevision
        )
    )
        throw new Error("Signed output verification failed.");
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, result, { flag: "wx" });
    console.log("Signed field: " + options.field);
    console.log("Output: " + output);
    console.log(
        "SHA-256: " + createHash("sha256").update(result).digest("hex")
    );
    console.log(
        "Certificate trust, revocation and trusted timestamps are not checked by this local signing profile."
    );
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
