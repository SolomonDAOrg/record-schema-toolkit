import { deepSnakeToCamel } from "../../lib/util/objects.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { TextNode } from "../../lib/ast/nodes/BaseNode.mjs";
import { createTextVariableRule } from "../../lib/ast/formatting/text-variables.mjs";
import { HeadingNode } from "../../lib/ast/nodes/ProseNode.mjs";
import { createHeadingPageBreakRule } from "../../lib/ast/formatting/heading-page-breaks.mjs";
import { CompositionPhase } from "../../lib/ast/pipelines/DocumentPipeline.mjs";
import { Metafile } from "../../lib/record-schema/Metafile.mjs";
import { resolvePacketVariables } from "../../lib/record-schema/render/packet-variables.mjs";
import { Repository } from "../../lib/record-schema/Repository.mjs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("heading page breaks use configured levels and exact exclusions", () => {
    const rule = createHeadingPageBreakRule({
        levels: [2],
        excludeText: ["Introduction"]
    });
    const heading = new HeadingNode(2, "Terms");
    assert.equal(rule.match(heading), true);
    assert.equal(rule.match(new HeadingNode(2, "Introduction")), false);
    assert.equal(rule.match(new HeadingNode(3, "Terms")), false);
    assert.equal(
        rule.transform(heading, { variables: {}, metadata: {} }).keepRules
            .pageBreakBefore,
        true
    );
    assert.equal(heading.keepRules, undefined);
});

test("packet cover identity is derived independently from record identity", () => {
    const metafile = new Metafile({
        schema: "record-schema",
        schema_version: 1,
        id: "TPL-00099",
        title: "Example",
        document: { version: "2" },
        assembly: {
            packet: {
                path: "packet.pdf",
                document_id: "COPY-017",
                version: "5"
            }
        }
    });
    const variables = resolvePacketVariables(metafile, {
        title: "Agreement",
        party_1: "Party A",
        party_2: "Party B"
    });
    assert.equal(variables.recordId, "TPL-00099");
    assert.equal(variables.recordVersion, "2");
    assert.equal(variables.documentId, "COPY-017/5");
    assert.equal(variables.packetDocumentId, "COPY-017");
    assert.equal(variables.documentVersion, "5");
    const composition = new CompositionPhase().compose([], {
        sections: [],
        variables,
        coverPage: {
            elements: [
                {
                    type: "text",
                    content: { type: "variable", name: "coverTitle" }
                },
                {
                    type: "kv-block",
                    rows: [
                        {
                            label: "Party",
                            value: { type: "variable", name: "coverParty1" }
                        }
                    ]
                }
            ]
        }
    });
    const [title, parties] = composition.coverPage.elements;
    assert.equal(title.type, "text");
    assert.equal(parties.type, "kv-block");
    assert.equal(title.content, "Agreement");
    assert.equal(parties.rows[0].value, "Party A");
});

test("repository discovery accepts plural and legacy upstream filenames", () => {
    const directory = mkdtempSync(join(tmpdir(), "upstream-config-"));
    try {
        const declaration =
            "schema: record-schema-upstream\nschema_version: 1\nrecord_schema: {}\n";
        writeFileSync(join(directory, "SCHEMA_UPSTREAMS.yaml"), declaration);
        assert.equal(
            Repository.discoverRepository(directory).upstream_path,
            join(directory, "SCHEMA_UPSTREAMS.yaml")
        );
        rmSync(join(directory, "SCHEMA_UPSTREAMS.yaml"));
        writeFileSync(join(directory, "SCHEMA_UPSTREAM.yaml"), declaration);
        assert.equal(
            Repository.discoverRepository(directory).upstream_path,
            join(directory, "SCHEMA_UPSTREAM.yaml")
        );
    } finally {
        rmSync(directory, { recursive: true });
    }
});

test("text bindings are opt-in and reject missing metadata", () => {
    const rule = createTextVariableRule(["documentId"], {
        documentId: "COPY-017/5"
    });
    const node = new TextNode(" {{documentId}}");
    const result = rule.transform(node, { variables: {}, metadata: {} });
    assert.equal(result.getTextContent(), " COPY-017/5");
    assert.equal(node.getTextContent(), " {{documentId}}");
    assert.equal(rule.match(new TextNode("{{unselected}}")), false);
    assert.throws(
        () => createTextVariableRule(["documentId"], {}),
        /Unbound text variable/
    );
});

test("configuration key conversion preserves repeated ordered elements", () => {
    const configuration = {
        cover_elements: [
            { type: "spacer", after_spacer: 8 },
            { type: "rule", start_frac: 0.1 },
            { type: "spacer", after_spacer: 8 },
            { type: "rule", start_frac: 0.1 }
        ]
    };
    assert.deepEqual(deepSnakeToCamel(configuration), {
        coverElements: [
            { type: "spacer", afterSpacer: 8 },
            { type: "rule", startFrac: 0.1 },
            { type: "spacer", afterSpacer: 8 },
            { type: "rule", startFrac: 0.1 }
        ]
    });
    assert.equal(configuration.cover_elements.length, 4);
});
