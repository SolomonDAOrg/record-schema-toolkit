import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadPdf, getRaw, scanDict } from "../../lib/pdf/reader.mjs";
import { extractText } from "../../lib/pdf/extract-text.mjs";
import { Metafile } from "../../lib/record-schema/Metafile.mjs";

test("render command applies declared headers and footers to referenced table pages", (t) => {
    const directory = mkdtempSync(join(tmpdir(), "render-document-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const recordDirectory = join(directory, "DOC-00017-register");
    mkdirSync(recordDirectory);
    writeFileSync(
        join(directory, "SCHEMA_UPSTREAM.yaml"),
        "render_packs: [render.pack.json]\n"
    );
    const configuration = {
        schema: "record-schema-render-pack",
        schema_version: 1,
        pack_id: "document-test",
        document_policies: {
            targets: {
                pdf: {
                    format: "pdf",
                    page_size: "a4",
                    base_font_size: 10,
                    page_tracking: { enabled: true },
                    default_headers: [
                        {
                            location: "header",
                            pages: "all",
                            columns: {
                                left: {
                                    content: {
                                        type: "variable",
                                        name: "documentTitle"
                                    }
                                },
                                right: {
                                    content: {
                                        type: "variable",
                                        name: "documentId"
                                    }
                                }
                            }
                        }
                    ],
                    default_footers: [
                        {
                            location: "footer",
                            pages: "all",
                            columns: {
                                right: {
                                    content: [
                                        "Page ",
                                        { type: "variable", name: "page" },
                                        " of ",
                                        {
                                            type: "variable",
                                            name: "totalPages"
                                        }
                                    ]
                                }
                            },
                            border: { width: 0.6, color: "#D3DCE2" }
                        }
                    ]
                }
            },
            render_profiles: { standard: { target: "pdf" } }
        }
    };
    writeFileSync(
        join(directory, "render.pack.json"),
        JSON.stringify(configuration)
    );
    new Metafile(
        {
            id: "DOC-00017",
            title: "Register",
            documents: {
                primary: [
                    {
                        path: "DOC-00017_DOC-register.md",
                        doc_type: "DOC",
                        label: "Control document",
                        document_id: "DOCUMENT-TEST-IDENTITY",
                        render_profile_id: "standard"
                    }
                ]
            }
        },
        join(recordDirectory, "DOC-00017_META.yaml")
    ).save();
    writeFileSync(
        join(recordDirectory, "DOC-00017_DOC-register.md"),
        [
            "# Register",
            "",
            ":::data-table entries.tsv",
            "columns:",
            "  - {header: Entry, type: text, align: left, width: auto}",
            "  - {header: Value, type: decimal, align: right, width: max-content-padded, decimal_places: 2, rounding: reject}",
            ":::",
            "",
            "End of register.",
            ""
        ].join("\n")
    );
    const entries = Array.from(
        { length: 70 },
        (_, index) => `ENTRY-${String(index).padStart(4, "0")}`
    );
    writeFileSync(
        join(recordDirectory, "entries.tsv"),
        `Entry\tValue\n${entries
            .map((entry) => `${entry}\t12.50`)
            .join("\n")}\n`
    );
    const result = spawnSync(
        process.execPath,
        [
            fileURLToPath(new URL("../../bin/render.mjs", import.meta.url)),
            "--root",
            recordDirectory,
            "--overwrite"
        ],
        { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const pages = extractText(
        readFileSync(
            join(recordDirectory, "pdf/DOC-00017_DOC-register.pdf")
        )
    ).pages.map((page) => page.replace(/\s+/g, " "));
    assert.ok(pages.length > 1);
    for (const [index, page] of pages.entries()) {
        assert.ok(page.includes("Control document"));
        assert.ok(page.includes("DOCUMENT-TEST-IDENTITY"));
        assert.ok(page.includes(`Page ${index + 1} of ${pages.length}`));
        assert.ok(
            page.includes(
                `DOCUMENT-TEST-IDENTITY|${index + 1}/${pages.length}`
            )
        );
    }
    const text = pages.join(" ");
    for (const entry of entries)
        assert.equal(text.split(entry).length, 2, entry);
    assert.equal(text.split("12.50").length, entries.length + 1);
    assert.ok(pages.at(-1).includes("End of register."));
});

test("the soft-wrap CLI flag reaches individual and packet rendering", (t) => {
    const directory = mkdtempSync(join(tmpdir(), "render-wrap-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const recordDirectory = join(directory, "DOC-00018-letter");
    mkdirSync(recordDirectory);
    writeFileSync(
        join(directory, "SCHEMA_UPSTREAM.yaml"),
        "render_packs: [render.pack.json]\n"
    );
    writeFileSync(
        join(directory, "render.pack.json"),
        JSON.stringify({
            schema: "record-schema-render-pack",
            schema_version: 1,
            pack_id: "wrap-test",
            document_policies: {
                defaults: { render_profile_id: "standard" },
                targets: { pdf: { format: "pdf" } },
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
            assembly: { pack: [entry] }
        },
        join(recordDirectory, "DOC-00018_META.yaml")
    ).save();
    writeFileSync(
        join(recordDirectory, entry.path),
        "# Letter\n\nAlpha\nBravo  \nCharlie\n"
    );
    for (const packet of [false, true]) {
        for (const disableSoftWrap of [false, true]) {
            const outputPath = join(
                recordDirectory,
                packet
                    ? "DOC-00018_PKT-filing.pdf"
                    : "pdf/DOC-00018_DOC-letter.pdf"
            );
            const result = spawnSync(
                process.execPath,
                [
                    fileURLToPath(
                        new URL("../../bin/render.mjs", import.meta.url)
                    ),
                    "--root",
                    recordDirectory,
                    "--overwrite",
                    ...(packet
                        ? [
                              "--packet",
                              "--packet-name",
                              "DOC-00018_PKT-filing.pdf"
                          ]
                        : []),
                    ...(disableSoftWrap ? ["--disable-soft-wrap"] : [])
                ],
                { encoding: "utf8" }
            );
            assert.equal(result.status, 0, result.stdout + result.stderr);
            const pdf = loadPdf(readFileSync(outputPath));
            const streams = pdf.getPageTree().leafIds.map((id) => {
                const references =
                    getRaw(pdf.getDict(id).entries, "Contents") ?? "";
                return Array.from(
                    references.matchAll(/(\d+) \d+ R/g),
                    (match) => {
                        const raw = pdf.getObjectRaw(Number(match[1]));
                        return new TextDecoder("latin1").decode(
                            pdf.decodeStreamBytes(
                                scanDict(raw.dictPart, 0).entries,
                                raw.streamBytes
                            )
                        );
                    }
                ).join("\n");
            });
            const page = streams.find((stream) =>
                stream.includes("(Alpha) Tj")
            );
            assert.ok(page, result.stdout);
            const positions = new Map(
                Array.from(
                    page.matchAll(
                        /1 0 0 1 [\d.-]+ ([\d.-]+) Tm\n\((Alpha|Bravo|Charlie)\) Tj/g
                    ),
                    (match) => [match[2], Number(match[1])]
                )
            );
            assert.equal(positions.size, 3);
            if (disableSoftWrap)
                assert.ok(positions.get("Alpha") > positions.get("Bravo"));
            else
                assert.equal(
                    positions.get("Alpha"),
                    positions.get("Bravo")
                );
            assert.ok(positions.get("Bravo") > positions.get("Charlie"));
        }
    }
});
