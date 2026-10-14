import assert from "node:assert/strict";
import test from "node:test";
import { createDocxRenderer } from "../../lib/ast/renderers/DocxRenderer.mjs";
import { createParagraph } from "../../lib/ast/nodes/ProseNode.mjs";
import { readPackage } from "./package-support.mjs";

test("header tabs align only populated columns within the section margins", () => {
    const columns = {
        left: {
            content: "Sole Tech Business Ltd.",
            style: { fontSize: 9, bold: true }
        },
        center: { content: "CENTER", style: { fontSize: 9 } },
        right: {
            content: "MINTING MASTER AGREEMENT - MINTING MASTER AGREEMENT",
            style: { fontSize: 9, bold: false }
        }
    };
    for (const names of [
        ["left", "right"],
        ["right"],
        ["center"],
        ["left", "center", "right"]
    ]) {
        const result = createDocxRenderer({
            pageConfig: { size: "a4" },
            fonts: { regular: "Helvetica", bold: "Helvetica-Bold" }
        }).render([
            {
                id: "body",
                config: {
                    id: "body",
                    pageConfig: {
                        size: "letter",
                        margins: { left: 72, right: 72 }
                    },
                    headers: [
                        {
                            location: "header",
                            pages: "all",
                            columns: Object.fromEntries(
                                names.map((name) => [name, columns[name]])
                            ),
                            border: { width: 0.5 }
                        }
                    ]
                },
                content: [createParagraph("Body")]
            }
        ]);
        assert.equal(result.success, true, result.errors.join("; "));
        const archive = readPackage(result.output);
        const header = [...archive].find(([name]) =>
            name.startsWith("word/header")
        )[1];
        assert.ok(typeof header === "string");
        const tabs = [
            ...header.matchAll(/<w:tab w:val="([^"]+)" w:pos="(\d+)"\/>/g)
        ].map((match) => [match[1], Number(match[2])]);
        const expected = names
            .filter((name) => name !== "left")
            .map((name) => [name, name === "center" ? 4680 : 9360]);
        assert.deepEqual(tabs, expected, names.join("/"));
        assert.equal(
            (header.match(/<w:tab\/>/g) ?? []).length,
            expected.length
        );
        for (const name of names)
            assert.ok(header.includes(columns[name].content));
        for (const run of header.matchAll(/<w:r>([\s\S]*?)<\/w:r>/g))
            assert.match(run[1], /w:rFonts w:ascii="Arial"/);
        assert.match(header, /<w:bottom w:val="single" w:sz="4" w:space="12"/);
    }
});
