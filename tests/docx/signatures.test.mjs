import assert from "node:assert/strict";
import test from "node:test";
import { createDocxRenderer } from "../../lib/ast/renderers/DocxRenderer.mjs";
import { convertMarkdownToDocument } from "../../lib/ast/converters/MarkdownToAstConverter.mjs";
import { parseMarkdownDoc } from "../../lib/parsing/markdown.mjs";
import { readPackage, readXmlPart } from "./package-support.mjs";

function render(source, configuration = {}) {
    const document = convertMarkdownToDocument(parseMarkdownDoc(source));
    const result = createDocxRenderer({
        pageConfig: { size: "letter", margins: { left: 72, right: 72 } },
        ...configuration
    }).render([
        { id: "body", config: { id: "body" }, content: document.root.children }
    ]);
    assert.equal(result.success, true, result.errors.join("; "));
    return readXmlPart(readPackage(result.output), "word/document.xml");
}

const single = (party) =>
    ":::signature-block single " +
    party +
    "\nSignature:\nName and capacity: [Name and capacity]\nSigning date: [Signing date]\n:::";

test("single signature blocks retain open lines, writing height and editable named fields", () => {
    const xml = render(single("Company"), {
        directiveStyles: {
            single: {
                fontSize: 8,
                signatureRowHeight: 76,
                borderColor: "#123456"
            }
        }
    });
    assert.match(xml, /Company/);
    assert.match(xml, /<w:trHeight w:val="1520" w:hRule="atLeast"\/>/);
    assert.match(
        xml,
        /<w:bottom w:val="single" w:sz="4" w:space="0" w:color="123456"/
    );
    assert.match(xml, /\[Name and capacity\]/);
    assert.equal((xml.match(/<w:sdt>/g) ?? []).length, 3);
    assert.doesNotMatch(xml, /_{4}/);
    const borders = /<w:tblBorders>(.*?)<\/w:tblBorders>/.exec(xml)[1];
    assert.doesNotMatch(borders, /w:val="single"/);
});

test("split signatures keep both parties in separate columns with their own controls", () => {
    const xml = render(
        ":::signature-block split\n" +
            single("Company") +
            "\n" +
            single("Counterparty") +
            "\n:::"
    );
    assert.ok(xml.indexOf("Company") < xml.indexOf("Counterparty"));
    assert.equal((xml.match(/<w:tbl>/g) ?? []).length, 3);
    assert.equal((xml.match(/<w:sdt>/g) ?? []).length, 6);
    assert.equal(
        (xml.match(/<w:trHeight w:val="1280" w:hRule="atLeast"\/>/g) ?? [])
            .length,
        2
    );
    assert.match(xml, /<w:insideV w:val="single" w:sz="5" w:color="D3DCE2"/);
    assert.match(xml, /<w:tblW w:w="4280" w:type="dxa"/);
    const names = [...xml.matchAll(/<w:tag w:val="([^"]+)"/g)].map(
        (match) => match[1]
    );
    assert.equal(new Set(names).size, 6);
});

test("signature panels retain the title band, border, values and ordered fields", () => {
    const xml = render(
        ":::signature-block For and on behalf of Company\nSignature:\nName: Ada\nTitle: Director\nDate: [Signing date]\n:::",
        {
            directiveStyles: {
                "signature-block": {
                    headerBackgroundColor: "#F1F5F7",
                    borderColor: "#213C51",
                    padding: 10,
                    signatureRowHeight: 70
                }
            }
        }
    );
    assert.match(xml, /<w:shd w:val="clear" w:fill="F1F5F7"/);
    assert.match(xml, /<w:top w:val="single" w:sz="8" w:color="213C51"/);
    assert.match(xml, /<w:trHeight w:val="1400" w:hRule="atLeast"/);
    assert.equal((xml.match(/<w:sdt>/g) ?? []).length, 4);
    assert.equal(
        (xml.match(/<w:lock w:val="sdtContentLocked"/g) ?? []).length,
        2
    );
    assert.ok(xml.indexOf("Signature:") < xml.indexOf("Name:"));
    assert.ok(xml.indexOf("Ada") < xml.indexOf("Director"));
    assert.match(xml, /\[Signing date\]/);
});
