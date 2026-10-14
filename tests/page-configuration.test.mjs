import assert from "node:assert/strict";
import test from "node:test";

import { createTwoPassPdfRenderer } from "../lib/ast/renderers/TwoPassPdfRenderer.mjs";
import { LayoutEngine } from "../lib/ast/layout/LayoutEngine.mjs";
import { RenderPack } from "../lib/record-schema/RenderPack.mjs";

test("PDF renderer and layout engine honour page size and orientation", () => {
    const portraitRenderer = createTwoPassPdfRenderer({
        pageConfig: { size: "a4", orientation: "portrait" }
    });
    const portraitState = portraitRenderer.initializeState();
    assert.equal(portraitState.pageWidth, 595);
    assert.equal(portraitState.pageHeight, 842);
    assert.equal(portraitRenderer.getPageHeight(), 842);

    const landscapeRenderer = createTwoPassPdfRenderer({
        pageConfig: { size: "a4", orientation: "landscape" }
    });
    const landscapeState = landscapeRenderer.initializeState();
    assert.equal(landscapeState.pageWidth, 842);
    assert.equal(landscapeState.pageHeight, 595);
    assert.equal(landscapeRenderer.getPageHeight(), 595);

    const layoutEngine = new LayoutEngine();
    const context = layoutEngine.buildContext(
        { size: "a4", orientation: "landscape" },
        "test"
    );
    assert.equal(context.pageWidth, 842);
    assert.equal(context.pageHeight, 595);
});

test("packet rules resolve the declared PDF target", () => {
    const pack = new RenderPack({
        schema: "record-schema-render-pack",
        schema_version: 1,
        pack_id: "example-packet-v1",
        document_policies: {
            targets: {
                pdf: {
                    format: "pdf",
                    page_size: "a4",
                    orientation: "portrait",
                    margins: {
                        top: 58,
                        bottom: 58,
                        left: 58,
                        right: 58,
                        unit: "pt"
                    }
                }
            },
            render_profiles: {
                "example-packet-v1": {
                    target: "pdf"
                }
            },
            rulesets: [
                {
                    id: "example-packet-v1",
                    selectors: {
                        doc_types: ["PACKET"],
                        extensions: ["pdf"]
                    },
                    render: {
                        target: "pdf",
                        render_profile_id: "example-packet-v1"
                    }
                }
            ]
        }
    });
    const resolved = pack.resolveForFile({
        rel_path: "records/ABC-00001-example",
        doc_type: "PACKET",
        ext: "pdf"
    });
    assert.equal(resolved.page_size, "a4");
    assert.equal(resolved.orientation, "portrait");
    assert.deepEqual(resolved.margins, {
        top: 58,
        bottom: 58,
        left: 58,
        right: 58,
        unit: "pt"
    });
});
