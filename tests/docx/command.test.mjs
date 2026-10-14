import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
    mkdtempSync,
    mkdirSync,
    writeFileSync,
    readFileSync,
    rmSync,
    existsSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Metafile } from "../../lib/record-schema/Metafile.mjs";
import { readPackage, readXmlPart } from "./package-support.mjs";

const command = fileURLToPath(new URL("../../bin/render.mjs", import.meta.url));

test("CLI renders identical selected source content to individual DOCX and packets without overwriting PDF", (t) => {
    const directory = mkdtempSync(join(tmpdir(), "docx-command-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const record = join(directory, "DOC-00018-letter");
    mkdirSync(record);
    writeFileSync(
        join(directory, "SCHEMA_UPSTREAM.yaml"),
        "render_packs: [render.pack.json]\n"
    );
    writeFileSync(
        join(directory, "render.pack.json"),
        JSON.stringify({
            schema: "record-schema-render-pack",
            schema_version: 1,
            pack_id: "docx",
            document_policies: {
                defaults: { render_profile_id: "standard" },
                targets: {
                    pdf: {
                        format: "pdf",
                        page_size: "letter",
                        orientation: "landscape",
                        base_font_size: 11,
                        margins: {
                            top: 72,
                            bottom: 72,
                            left: 72,
                            right: 72,
                            unit: "pt"
                        },
                        text_variables: ["documentId"],
                        page_tracking: { enabled: true },
                        default_headers: [
                            {
                                location: "header",
                                pages: "all",
                                columns: {
                                    left: { content: "DOCUMENT HEADER" }
                                }
                            }
                        ]
                    }
                },
                render_profiles: { standard: { target: "pdf" } }
            }
        })
    );
    const entry = {
        path: "DOC-00018_DOC-letter.md",
        doc_type: "DOC",
        label: "Letter",
        render_profile_id: "standard"
    };
    new Metafile(
        {
            id: "DOC-00018",
            title: "Letter",
            documents: { primary: [entry] },
            assembly: {
                pack: [entry],
                packet: { path: "delivery/retained.pdf" }
            }
        },
        join(record, "DOC-00018_META.yaml")
    ).save();
    writeFileSync(
        join(record, entry.path),
        "# Letter\n\nSource body with & and Unicode 日本.\n\n:::data-table records.tsv\ncolumns:\n  - {header: Reference, type: text, align: left, width: auto}\n  - {header: Amount, type: decimal, decimal_places: 2, rounding: half-up, align: right, width: auto}\n:::\n"
    );
    writeFileSync(
        join(record, "records.tsv"),
        "Reference\tAmount\nENTRY-001\t1000.005\nENTRY-002\t12.5\n"
    );
    mkdirSync(join(record, "delivery"));
    writeFileSync(join(record, "delivery/retained.pdf"), "PDF sentinel");
    const run = (...arguments_) =>
        spawnSync(
            process.execPath,
            [command, "--root", record, "--format", "docx", ...arguments_],
            { encoding: "utf8" }
        );
    let result = run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const individual = join(record, "docx/DOC-00018_DOC-letter.docx");
    assert.ok(existsSync(individual));
    const individualArchive = readPackage(readFileSync(individual));
    const xml = readXmlPart(individualArchive, "word/document.xml");
    assert.match(xml, /Source body with &amp; and Unicode 日本/);
    assert.match(xml, /1,000.01|1000.01/);
    assert.match(xml, /12.50/);
    assert.match(xml, /w:w="15840" w:h="12240" w:orient="landscape"/);
    assert.match(
        xml,
        /<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/
    );
    result = run("--packet", "--update-meta");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const packet = join(record, "delivery/retained.docx");
    const packetArchive = readPackage(readFileSync(packet));
    assert.match(readXmlPart(packetArchive, "word/document.xml"), /ENTRY-001/);
    assert.match(
        readXmlPart(packetArchive, "word/document.xml"),
        /<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/
    );
    assert.equal(
        readFileSync(join(record, "delivery/retained.pdf"), "utf8"),
        "PDF sentinel"
    );
    assert.match(
        readFileSync(join(record, "DOC-00018_META.yaml"), "utf8"),
        /delivery\/retained.docx/
    );
    const retained = readFileSync(packet);
    result = run("--packet");
    assert.equal(result.status, 1);
    assert.deepEqual(readFileSync(packet), retained);
    result = run("--packet", "--packet-name", "wrong.pdf");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must end in .docx/);
    assert.equal(existsSync(join(record, "wrong.pdf")), false);
});

test("CLI rejects unsupported output formats before writing files", () => {
    const result = spawnSync(process.execPath, [command, "--format", "html"], {
        encoding: "utf8"
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported output format: html/);
});
