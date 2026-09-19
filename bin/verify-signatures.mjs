#!/usr/bin/env node
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {CLI} from "../lib/cli/cli.mjs";
import {verifyPdfSignatures} from "../lib/pdf/verify-signatures.mjs";
const options = CLI.handleCLI({
    scriptName: "verify-signatures",
    description: "Check toolkit CMS signatures and revision coverage; does not establish certificate trust",
    schema: {flags: {}, values: {input: {description: "PDF path", default: null, type: "string"}}}
});
try {
    if (!options.input) throw new Error("Missing --input");
    console.log(JSON.stringify({scope: "cryptographic_integrity", certificate_trust: "not_checked", fields: verifyPdfSignatures(readFileSync(resolve(options.input)))}, null, 2));
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
