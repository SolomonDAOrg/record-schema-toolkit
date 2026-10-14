import assert from "node:assert/strict";
import test from "node:test";

import {
    createRenderPackAdapter,
    RenderPackAdapter,
    toCamelCase
} from "../../../lib/ast/adapters/RenderPackAdapter.mjs";
import { BaseDocument } from "../../../lib/ast/documents/BaseDocument.mjs";
import { BaseNode } from "../../../lib/ast/nodes/BaseNode.mjs";
import { createPipelineForFile } from "../../../lib/ast/pipelines/Pipeline.mjs";

/** @typedef {import("../../../lib/ast/types/core.mjs").ResolvedRenderConfig} ResolvedRenderConfig */

/** @type {import("../../../lib/record-schema/types/general.mjs").RenderPackData} */
const pack = {
    schema: "record-schema-render-pack",
    schema_version: 1,
    pack_id: "adapter-test",
    packet_config: { header_text: "CONFIDENTIAL" },
    document_policies: {
        targets: {
            pdf: {
                format: "pdf",
                base_font_size: 10,
                title_font_size: 18,
                line_spacing: 1.4,
                heading_scales: { h2: 1.2 },
                fonts: {
                    regular: "Helvetica",
                    bold: "Helvetica-Bold",
                    monospace: "Courier"
                },
                margins: { top: 30, right: 40, bottom: 50, left: 60 },
                horizontal_rule: { behavior: "rule" }
            }
        },
        render_profiles: {
            standard: {
                target: "pdf",
                overrides: {
                    spacing_policy: {
                        before_rules: [
                            { prev: "heading", next: "paragraph", em: 1 }
                        ]
                    }
                }
            },
            compact: { extends: "standard", overrides: { base_font_size: 8 } }
        },
        rulesets: [
            {
                id: "base",
                selectors: {
                    paths_glob: ["**/*.md"],
                    extensions: ["md"],
                    doc_types: ["DOC"]
                },
                render: { profile: "standard", line_spacing: 1.6 }
            },
            {
                id: "later",
                selectors: { paths_glob: ["**/*notice.md"] },
                render: { base_font_size: 11 }
            }
        ]
    }
};

test("the restored adapter accepts raw pack data and retains its typography helpers", () => {
    const adapter = createRenderPackAdapter(pack);
    const configuration = adapter.resolveProfile("standard");
    assert.ok(configuration);
    assert.deepEqual(adapter.getBaseTextStyle(configuration), {
        fontFamily: "Helvetica",
        fontSize: 10,
        lineHeight: 1.4
    });
    assert.deepEqual(adapter.getHeadingStyle(configuration, 1), {
        fontFamily: "Helvetica-Bold",
        bold: true,
        fontSize: 18
    });
    assert.deepEqual(adapter.getHeadingStyle(configuration, 2), {
        fontFamily: "Helvetica-Bold",
        bold: true,
        fontSize: 12
    });
    assert.deepEqual(adapter.getCodeStyle(configuration), {
        fontFamily: "Courier",
        fontSize: 9
    });
    assert.deepEqual(adapter.getMargins(configuration), {
        top: 30,
        right: 40,
        bottom: 50,
        left: 60
    });
    assert.deepEqual(adapter.getHorizontalRuleConfig(configuration), {
        behavior: "rule"
    });
    assert.equal(adapter.getFonts(configuration).bold, "Helvetica-Bold");
    assert.equal(adapter.getSpacingPolicy(configuration).before_rules[0].em, 1);
    assert.equal(adapter.getPacketConfig().header_text, "CONFIDENTIAL");
    assert.equal(adapter.resolveTarget("missing"), null);
});

test("snake_case descriptors retain ordered overrides and inherited profiles", () => {
    const adapter = new RenderPackAdapter(pack);
    const file = { rel_path: "notice.md", doc_type: "DOC", ext: "MD" };
    assert.equal(adapter.getMatchingRuleset(file).id, "base");
    const configuration = adapter.resolveForFile(file);
    assert.equal(configuration.base_font_size, 11);
    assert.equal(configuration.line_spacing, 1.6);
    assert.equal(adapter.resolveProfile("compact").base_font_size, 8);
    assert.equal(
        adapter.resolveForFile({ ...file, render_profile_id: "compact" })
            .base_font_size,
        8
    );
});

test("legacy camelCase pack data preserves named target and profile keys", () => {
    const adapter = createRenderPackAdapter({
        schema: "record-schema-render-pack",
        schemaVersion: 1,
        packId: "legacy-test",
        documentPolicies: {
            targets: { PdfPrimary: { format: "pdf", baseFontSize: 13 } },
            renderProfiles: { LetterStyle: { target: "PdfPrimary" } }
        }
    });
    assert.equal(adapter.pack.pack_id, "legacy-test");
    assert.equal(adapter.getTarget("PdfPrimary").base_font_size, 13);
    assert.equal(adapter.resolveProfile("LetterStyle").base_font_size, 13);
});

test("renderer conversions retain cover, signing, TOC and array cardinality", () => {
    const adapter = new RenderPackAdapter(pack);
    assert.deepEqual(
        adapter.normalizeTocLevelStyles({
            1: { font_size_scale: 1.2, show_page_number: false }
        }),
        { 1: { fontSizeScale: 1.2, showPageNumber: false } }
    );
    const cover = adapter.coverConfigForRenderer({
        suppress_header: true,
        suppress_footer: true,
        suppress_page_numbering: false,
        reserve_header_footer_space: false,
        watermark: {
            enabled: true,
            text: "DRAFT",
            gray: 0.8,
            angle_deg: 45,
            font_size: 72
        }
    });
    assert.equal(cover.suppressHeader, true);
    assert.equal(cover.watermark.angleDeg, 45);
    const page = adapter.coverPageForRenderer({
        elements: [],
        counts_in_page_numbers: false,
        background_color: "#ffffff",
        page_config: { size: "a4" }
    });
    assert.equal(page.countsInPageNumbers, false);
    assert.equal(page.pageConfig.size, "a4");
    const signing = adapter.signingConfigForRenderer({
        enabled: true,
        parties: [],
        witness_clause: "Witness",
        execution_note: "Execution",
        acknowledgment_title: "Acknowledgment",
        acknowledgment_text: "Confirmed"
    });
    assert.equal(signing.witnessClause, "Witness");
    assert.equal(signing.acknowledgmentTitle, "Acknowledgment");
    assert.deepEqual(toCamelCase([{ font_size: 10 }, { font_size: 10 }]), [
        { fontSize: 10 },
        { fontSize: 10 }
    ]);
});

test("the AST pipeline maps its file descriptor to the restored adapter contract", () => {
    const pipeline = createPipelineForFile({
        renderAdapter: new RenderPackAdapter(pack),
        file: { relPath: "notice.md", docType: "DOC", ext: "md" }
    });
    const document = new BaseDocument().append(new BaseNode("paragraph"));
    const transformed = pipeline.transform(document);
    assert.equal(transformed.root.children[0].textStyle.fontSize, 11);
    assert.equal(transformed.root.children[0].textStyle.lineHeight, 1.6);
    assert.equal(document.root.children[0].textStyle, undefined);
});


test("metadata styling inherits through profiles and converts at the renderer boundary", () => {
    const configured = structuredClone(pack);
    configured.document_policies.targets.pdf.markdown_envelope_style = {
        font_size: 9.2, label_font_size: 8.3, label_gap: 14,
        padding: { top: 10, bottom: 10 }, top_rule: { width: 0.6, color: "#213C51" }
    };
    configured.document_policies.render_profiles.compact.overrides.markdown_envelope_style = { row_gap: 2 };
    const resolved = /** @type {ResolvedRenderConfig} */ (toCamelCase(createRenderPackAdapter(configured).resolveProfile("compact")));
    assert.deepEqual(resolved.markdownEnvelopeStyle, {
        fontSize: 9.2, labelFontSize: 8.3, labelGap: 14,
        padding: { top: 10, bottom: 10 }, topRule: { width: 0.6, color: "#213C51" }, rowGap: 2
    });
});
