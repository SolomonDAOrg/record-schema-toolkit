import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolvePageConfiguration } from "../../lib/ast/adapters/RenderPackAdapter.mjs";
import { RenderPackAdapter } from "../../lib/ast/adapters/RenderPackAdapter.mjs";
import { createTwoPassPdfRenderer } from "../../lib/ast/renderers/TwoPassPdfRenderer.mjs";
import { parseYaml } from "../../lib/parsing/yaml.mjs";
import { PdfContentStreamBuilder } from "../../lib/pdf/content-stream.mjs";
import { extractText } from "../../lib/pdf/extract-text.mjs";
import { FilingPacketGenerator } from "../../lib/record-schema/generators/FilingPacketGenerator.mjs";
import { IndManager } from "../../lib/record-schema/IndManager.mjs";
import { Metafile } from "../../lib/record-schema/Metafile.mjs";
import { RenderPack } from "../../lib/record-schema/RenderPack.mjs";
import { Repository } from "../../lib/record-schema/Repository.mjs";

const pack = new RenderPack({
    schema: "record-schema-render-pack",
    schema_version: 1,
    pack_id: "generic-test",
    document_policies: {
        targets: {
            pdf: {
                format: "pdf",
                base_font_size: 10,
                page_size: "a4",
                page_tracking: { enabled: true }
            }
        },
        render_profiles: {
            standard: { target: "pdf" },
            compact: { extends: "standard", overrides: { base_font_size: 8, orientation: "landscape" } }
        },
        rulesets: [
            {
                id: "markdown",
                selectors: { extensions: ["md"] },
                render: { profile: "standard" }
            }
        ]
    }
});

test("one pack renders metadata-driven tracking for unrelated series", () => {
    for (const id of ["AGR-00127", "SOP-00831"]) {
        const meta = new Metafile(
            parseYaml(
                [
                    `id: ${id}`,
                    'version: "2.4"',
                    "documents:",
                    "  primary:",
                    `    - path: ${id}_DOC-notice.md`,
                    "      doc_type: DOC",
                    '      version: "3.1"',
                    "      render_profile_id: compact"
                ].join("\n")
            )
        );
        const resolved = meta.resolveRenderMetadata({
            path: `${id}_DOC-notice.md`,
            doc_type: "DOC"
        });
        assert.equal(resolved.document_id, `${id}_DOC-notice/3.1`);
        assert.equal(meta.resolveRenderMetadata().document_id, `${id}/2.4`);
        const config = pack.resolveForFile({
            rel_path: "arbitrary/notice.md",
            doc_type: "DOC",
            ext: "md",
            render_profile_id: resolved.render_profile_id
        });
        assert.equal(config.base_font_size, 8);
        const renderer = createTwoPassPdfRenderer({
            pageConfig: {
                size: "a4",
                margins: { top: 54, bottom: 54, left: 58, right: 64 }
            },
            pageTracking: { enabled: true },
            variables: { documentId: resolved.document_id }
        });
        const state = renderer.initializeState();
        state.pages = [
            {
                pageNumber: 1,
                sectionId: "notice",
                sectionPageNumber: 1,
                sectionTotalPages: 1,
                contentBuilder: new PdfContentStreamBuilder(),
                headerFooterBuilder: new PdfContentStreamBuilder(),
                linkAnnotations: []
            }
        ];
        assert.ok(
            extractText(renderer.buildPdf(state)).text.includes(
                `${id}_DOC-notice/3.1|1/1`
            )
        );
    }
});

test("assembly overrides document references and record defaults", () => {
    const meta = new Metafile({
        id: "DOC-00017",
        version: "1",
        extensions: { rendering: { default_profile: "standard" } },
        documents: {
            primary: [
                {
                    path: "DOC-00017_DOC-main.md",
                    document_id: "reference",
                    version: "2"
                }
            ]
        },
        assembly: {
            pack: [
                {
                    path: "DOC-00017_DOC-main.md",
                    document_id: "declared",
                    version: "3",
                    render_profile_id: "compact",
                    doc_type: "MEM"
                }
            ],
            packet: { path: "packet.pdf", document_id: "packet", version: "4" }
        }
    });
    assert.deepEqual(
        meta.resolveRenderMetadata({
            path: "./DOC-00017_DOC-main.md",
            doc_type: "DOC"
        }),
        {
            path: "DOC-00017_DOC-main.md",
            record_id: "DOC-00017",
            document_id: "declared/3",
            version: "3",
            doc_type: "MEM",
            render_profile_id: "compact"
        }
    );
    assert.equal(meta.resolveRenderMetadata().document_id, "packet/4");
});

test("META identity replaces a stale filename record prefix", () => {
    const meta = new Metafile({ id: "AGR-00777" });
    assert.equal(
        meta.resolveRenderMetadata({
            path: "OLD-00001_DOC-notice.md",
            doc_type: "DOC"
        }).document_id,
        "AGR-00777_DOC-notice"
    );
});

test("invalid profile inheritance and explicit selections fail clearly", () => {
    const cyclic = new RenderPack({
        schema: "record-schema-render-pack",
        schema_version: 1,
        pack_id: "cycle-test",
        document_policies: {
            render_profiles: {
                a: { extends: "b" },
                b: { extends: "a" },
                orphan: { extends: "missing" }
            }
        }
    });
    assert.throws(() => cyclic.resolveRenderProfile("a"), /inheritance cycle/);
    assert.throws(
        () => cyclic.resolveRenderProfile("orphan"),
        /Unknown parent/
    );
    assert.throws(
        () =>
            pack.resolveForFile({
                rel_path: "file.md",
                doc_type: "DOC",
                ext: "md",
                render_profile_id: "missing"
            }),
        /Unknown render profile/
    );
});

test("packet ties use path order and preserve declared profiles", () => {
    const entries = pack.resolvePackEntries({
        assembly: {
            pack: [
                { path: "z.md", precedence: 10 },
                { path: "a.md", precedence: 10, render_profile_id: "compact" },
                { path: "skip.md", include: false }
            ]
        }
    });
    assert.ok(Array.isArray(entries));
    assert.deepEqual(
        entries.map((entry) => entry.path),
        ["a.md", "z.md"]
    );
    assert.equal(entries[0].render_profile_id, "compact");
});

test("page configuration validates dimensions and the restored adapter resolves styles", () => {
    assert.deepEqual(
        resolvePageConfiguration({ pageSize: "A4", orientation: "LANDSCAPE" }),
        { size: "a4", orientation: "landscape" }
    );
    assert.throws(
        () => resolvePageConfiguration({ pageSize: "unknown" }),
        RangeError
    );
    assert.throws(
        () => resolvePageConfiguration({ orientation: "sideways" }),
        RangeError
    );
    const adapter = new RenderPackAdapter(pack.data);
    const config = adapter.resolveForFile({
        rel_path: "notice.md",
        doc_type: "DOC",
        ext: "md"
    });
    assert.equal(adapter.getBaseTextStyle(config).fontSize, 10);
});

test("packet generation uses META identity and rejects a missing declared source", (t) => {
    const root = mkdtempSync(join(tmpdir(), "render-packet-meta-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(
        join(root, "AGR-00127_DOC-main.md"),
        "# Notice\n\nA short notice.\n"
    );
    const metafile = new Metafile({
        id: "AGR-00127",
        title: "Notice",
        version: "2.4",
        documents: {
            primary: [{ path: "AGR-00127_DOC-main.md", doc_type: "DOC" }]
        },
        assembly: {
            packet: {
                path: "packet.pdf",
                document_id: "AGR-00127-bundle",
                version: "3.0",
                render_profile_id: "compact"
            }
        }
    });
    const packetPack = new RenderPack({
        ...pack.data,
        document_policies: {
            ...pack.data.document_policies,
            rulesets: [
                {
                    id: "packet",
                    selectors: { doc_types: ["PACKET"] },
                    render: { profile: "standard" }
                }
            ]
        },
        packet_config: {
            packet_variants: {
                test: {
                    include_cover: false,
                    include_toc: false,
                    signing_page: false
                }
            }
        }
    });
    const generator = new FilingPacketGenerator(
        new Repository(root),
        new IndManager(null),
        packetPack,
        false,
        true
    );
    const record = {
        record_id: "AGR-00127",
        dir_name: "AGR-00127",
        abs_path: root,
        rel_path: "AGR-00127",
        bucket: null,
        metafile
    };
    const result = generator.generate(record, { packet_variant: "test" });
    assert.equal(result.success, true, JSON.stringify(result));
    assert.ok(
        extractText(readFileSync(join(root, "packet.pdf"))).text.includes(
            "AGR-00127-bundle/3.0|1/1"
        )
    );
    const pdf = readFileSync(join(root, "packet.pdf"));
    const mediaBox = /\/MediaBox\s*\[([^\]]+)\]/.exec(pdf.toString("latin1"));
    assert.ok(mediaBox, "packet has page dimensions");
    const dimensions = mediaBox[1].trim().split(/\s+/).map(Number);
    assert.ok(dimensions[2] > dimensions[3], "packet uses the landscape profile selected in META");
    metafile.data.documents.primary.push({
        path: "AGR-00127_DOC-missing.md"
    });
    assert.throws(
        () =>
            generator.generate(record, {
                packet_variant: "test",
                overwrite: true
            }),
        /Packet source does not exist/
    );
});


test("resolved source metadata retains labels across document categories and assembly overrides", () => {
    for (const tier of ["primary", "secondary", "tertiary", "supplemental", "log", "index"]) {
        const reference = { path: "sub/notice.md", label: "Notice", short_label: "Short notice", doc_type: "DOC" };
        const entry = ["log", "index"].includes(tier) ? reference : [reference];
        const meta = new Metafile({ id: "AGR-00412", documents: { [tier]: entry } });
        const resolved = meta.resolveRenderMetadata({ path: "sub\\notice.md" });
        assert.equal(resolved.path, "sub/notice.md");
        assert.equal(resolved.label, "Notice");
        assert.equal(resolved.short_label, "Short notice");
        assert.equal(resolved.doc_type, "DOC");
        meta.data.assembly = { pack: [{ path: "./sub/notice.md", label: "Assembly notice" }] };
        const assembly = meta.resolveRenderMetadata({ path: "sub/notice.md" });
        assert.equal(assembly.path, "sub/notice.md");
        assert.equal(assembly.label, "Assembly notice");
        assert.equal(assembly.short_label, "Short notice");
    }
});
