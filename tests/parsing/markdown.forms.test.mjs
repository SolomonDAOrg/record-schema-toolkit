import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdownDoc } from "../../lib/parsing/markdown.mjs";
import { convertMarkdownToDocument } from "../../lib/ast/converters/MarkdownToAstConverter.mjs";
import { createDocumentPipeline } from "../../lib/ast/pipelines/DocumentPipeline.mjs";
import { createTwoPassPdfRenderer } from "../../lib/ast/renderers/TwoPassPdfRenderer.mjs";
import { loadPdf, getRaw } from "../../lib/pdf/reader.mjs";
import { extractText } from "../../lib/pdf/extract-text.mjs";

const refs = raw => Array.from((raw ?? "").matchAll(/(\d+) 0 R/g), match => Number(match[1]));

function render(source, config = {}, composition = undefined) {
    const ast = convertMarkdownToDocument(parseMarkdownDoc(source, { softWrap: true }));
    const renderer = createTwoPassPdfRenderer({ pageConfig: { size: "a4" }, ...config });
    /** @type {import("../../lib/ast/renderers/TwoPassPdfRenderer.mjs").PdfPage[]} */
    let pages = [];
    const build = renderer.buildPdf.bind(renderer);
    renderer.buildPdf = state => { pages = state.pages; return build(state); };
    const pipeline = createDocumentPipeline().setRenderer(renderer);
    if (composition) pipeline.setCompositionConfig(composition);
    const result = pipeline.processSingle({ id: "CON-00777", name: "Agreement", root: ast.root });
    return { result, pages };
}

test("nested signature blocks are retained on one final signing page", () => {
    const source = "# Agreement\n\nTerms.\n\n:::signing-page\n## Execution\n\n:::signature-block Company\nSignature:\nName:\nDate:\n:::\n\n:::signature-block Licensee\nSignature:\nName:\nDate:\n:::\n:::\n\nFinal body provision.";
    const { result, pages } = render(source, { pageTracking: { enabled: true }, variables: { documentId: "CON-00777" } });
    assert.equal(result.success, true, result.errors.join("; "));
    assert.equal(pages.length, 2);
    assert.equal(pages.at(-1).sectionId, "signing");
    const text = extractText(result.renderResult.output);
    assert.match(text.pages[0].replace(/\s+/g, " "), /Final body provision/);
    assert.doesNotMatch(text.pages[1], /CON-00777\|/);
    const pdf = loadPdf(result.renderResult.output);
    const catalog = pdf.getDict(pdf.rootId);
    const form = pdf.getDict(refs(getRaw(catalog.entries, "AcroForm"))[0]);
    const fields = refs(getRaw(form.entries, "Fields"));
    assert.equal(fields.length, 6);
    const lastPageId = pdf.getPageTree().leafIds.at(-1);
    assert.deepEqual(refs(getRaw(pdf.getDict(lastPageId).entries, "Annots")), fields);
    assert.equal(fields.filter(id => getRaw(pdf.getDict(id).entries, "FT") === "/Sig").length, 2);
    for (const id of fields) {
        const field = pdf.getDict(id);
        assert.equal(refs(getRaw(field.entries, "P"))[0], lastPageId);
        assert.equal(refs(getRaw(field.entries, "AP")).length, 1);
    }
});

test("declaration text areas have multiline flags, stable names, and visible boxes", () => {
    const { result, pages } = render("# Declaration\n\n:::text-area declaration.intended_use\nDescribe the intended use in your own words.\n:::\n\nAfter the declaration.");
    assert.equal(result.success, true, result.errors.join("; "));
    const pdf = loadPdf(result.renderResult.output);
    const annotations = refs(getRaw(pdf.getDict(pdf.getPageTree().leafIds[0]).entries, "Annots"));
    assert.equal(annotations.length, 1);
    const field = pdf.getDict(annotations[0]);
    assert.equal(getRaw(field.entries, "FT"), "/Tx");
    assert.equal(getRaw(field.entries, "Ff"), "4096");
    assert.equal(getRaw(field.entries, "T"), "(declaration.intended_use)");
    assert.equal(getRaw(field.entries, "V"), "()");
    assert.match(pages[0].contentBuilder.build(), /re\s+S/);
    assert.match(extractText(result.renderResult.output).text.replace(/\s+/g, " "), /After the declaration/);
});

test("signing page overflow and duplicate signing sources fail explicitly", () => {
    const oversized = ":::signing-page\n" + Array.from({ length: 100 }, () => "A signing provision.\n\n").join("") + ":::\n";
    const overflow = render(oversized).result;
    assert.equal(overflow.success, false);
    assert.match(overflow.errors.join(" "), /one final page/);
    const duplicate = render(":::signing-page\nFirst.\n:::\n\n:::signing-page\nSecond.\n:::").result;
    assert.equal(duplicate.success, false);
    assert.match(duplicate.errors.join(" "), /one signing page source/);
});

test("a signing-only document has no leading blank page and permits explicit tracking", () => {
    const { result, pages } = render(":::signing-page\n:::signature-block Signatory\nSignature:\nName:\n:::\n:::", { pageTracking: { enabled: true, suppressSigning: false }, variables: { documentId: "CON-00777" } });
    assert.equal(result.success, true, result.errors.join("; "));
    assert.equal(pages.length, 1);
    assert.match(extractText(result.renderResult.output).text, /CON-00777\|1\/1/);
});

test("directive fences inside code blocks do not close the containing directive", () => {
    const parsed = parseMarkdownDoc(":::notice Example\n```text\n:::signature-block Literal\n:::\n```\n\nAfter the example.\n:::\n\nOutside.");
    assert.equal(parsed.nodes.length, 2);
    assert.match(parsed.nodes[0].content, /After the example/);
    assert.equal(parsed.nodes[1].content, "Outside.");
});

test("envelope values and wrapped continuations share a label column", () => {
    const { result, pages } = render("# Agreement\n\n**Status:** Draft\n**Owner:** Company\n**Applies to:** " + "Licensee obligations ".repeat(20) + "\n**Related:** Framework\n\n---\n\nBody.");
    assert.equal(result.success, true, result.errors.join("; "));
    const stream = pages[0].contentBuilder.build();
    const positions = Array.from(stream.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm\n\((Draft|Company|Framework|Licensee|obligations)\) Tj/g));
    assert.ok(positions.length >= 4);
    const lineStarts = new Map();
    for (const match of positions) lineStarts.set(match[2], Math.min(lineStarts.get(match[2]) ?? Infinity, Number(match[1])));
    assert.equal(new Set(lineStarts.values()).size, 1);
});

test("table frames and repeated header grids retain independent colors", () => {
    const source = "| ASSET | OWNER |\n|---|---|\n" + Array.from({ length: 80 }, (_, i) => `| Asset ${i} | Company |`).join("\n");
    const { result, pages } = render(source, { table: { borderColor: "#CCCCCC", outerBorderColor: "#112233", header: { borderColor: "#445566", backgroundColor: "#223344" } } });
    assert.equal(result.success, true, result.errors.join("; "));
    assert.ok(pages.length > 1);
    for (const page of pages) {
        const stream = page.contentBuilder.build();
        assert.match(stream, /0\.0667 0\.1333 0\.2 RG/);
        assert.match(stream, /0\.2667 0\.3333 0\.4 RG/);
        assert.match(stream, /0\.8 0\.8 0\.8 RG/);
    }
});

test("optical baseline shift applies to uppercase rows and leaves mixed case rows unchanged", () => {
    const source = "| ASSET | OWNER |\n|---|---|\n| Asset | Company |";
    const a = render(source, { table: { uppercaseBaselineShift: 0 } }).pages[0].contentBuilder.build();
    const b = render(source, { table: { uppercaseBaselineShift: 0.1 } }).pages[0].contentBuilder.build();
    const baseline = (stream, text) => Number(stream.match(new RegExp("1 0 0 1 [\\d.]+ ([\\d.]+) Tm\\n\\(" + text + "\\) Tj"))[1]);
    assert.equal(baseline(a, "ASSET") - baseline(b, "ASSET"), 1);
    assert.equal(baseline(a, "Asset"), baseline(b, "Asset"));
});

test("an omitted outside frame leaves only the internal table grid", () => {
    const source = "| ASSET | OWNER |\n|---|---|\n| Asset | Company |";
    const { pages } = render(source, { table: { outerBorderColor: "none", header: { backgroundColor: "none" } } });
    const stream = pages[0].contentBuilder.build();
    assert.doesNotMatch(stream, /re\s+S/);
    assert.match(stream, /m\n[^\n]+ l\nS/);
    const borderless = render(source, { table: { borderWidth: 0, header: { backgroundColor: "none" } } }).pages[0].contentBuilder.build();
    assert.doesNotMatch(borderless, /\nS\n/);
});


test("content-sized particulars retain labels and release width for long values", () => {
    const table = "| PARTICULAR | DETAIL |\n|---|---|\n| Legal name | A complete value that needs more than half the table width |\n| Notice address | Postal address |";
    const ordinary = render(table).pages[0].contentBuilder.build();
    const fitted = render(":::table max-content auto\n" + table + "\n:::").pages[0].contentBuilder.build();
    const position = (stream, text) => {
        const match = stream.match(new RegExp("1 0 0 1 ([\\d.]+) ([\\d.]+) Tm\n\\(" + text + "\\) Tj"));
        assert.ok(match, text);
        return { x: Number(match[1]), y: Number(match[2]) };
    };
    const value = "A complete value that needs more than half the table width";
    assert.doesNotMatch(ordinary, new RegExp("\\(" + value + "\\) Tj"));
    assert.equal(position(fitted, value).y, position(fitted, "Legal name").y);
    assert.ok(position(fitted, "DETAIL").x < position(ordinary, "DETAIL").x);
    assert.ok(position(fitted, "Notice address").y > position(ordinary, "Notice address").y);
    const header = render(":::table max-content auto\n| A MUCH LONGER HEADER | DETAIL |\n|---|---|\n| Name | Value |\n:::").pages[0].contentBuilder.build();
    assert.ok(position(header, "DETAIL").x > position(fitted, "DETAIL").x);
});

test("table directives reject invalid layouts and leave following content intact", () => {
    const table = "| KEY | VALUE |\n|---|---|\n| Name | Company |";
    for (const source of [
        ":::table max-content max-content\n" + table + "\n:::",
        ":::table auto\n" + table + "\n:::",
        ":::table small auto\n" + table + "\n:::",
        ":::table max-content auto\nNot a table.\n:::"
    ]) {
        assert.throws(() => convertMarkdownToDocument(parseMarkdownDoc(source)), /table directive/);
    }
    const { result } = render(":::table max-content auto\n" + table + "\n:::\n\nFollowing provision.");
    assert.equal(result.success, true, result.errors.join("; "));
    assert.match(extractText(result.renderResult.output).text.replace(/\s+/g, " "), /Following provision/);
});

test("body table text distributes added leading above and below its baseline", () => {
    const source = "| HEADER | VALUE |\n|---|---|\n| Body | Detail |";
    const compact = render(source, { table: { lineHeight: 1 } }).pages[0].contentBuilder.build();
    const spacious = render(source, { table: { lineHeight: 1.6 } }).pages[0].contentBuilder.build();
    const baseline = (stream, text) => Number(stream.match(new RegExp("1 0 0 1 [\\d.]+ ([\\d.]+) Tm\n\\(" + text + "\\) Tj"))[1]);
    assert.equal(baseline(compact, "HEADER"), baseline(spacious, "HEADER"));
    // Six points enlarge the preceding header; three balance the body's added leading.
    assert.equal(baseline(compact, "Body") - baseline(spacious, "Body"), 9);
});

test("signature title ink is centered in its band above the interactive fields", () => {
    const source = ":::signature-block For and on behalf of SOLOMON DAO LLC\nSignature:\nName:\n:::";
    const { result, pages } = render(source, { directiveStyles: { "signature-block": { headerBackgroundColor: "#F1F5F7", padding: 10, headerGap: 12 } } });
    assert.equal(result.success, true, result.errors.join("; "));
    const stream = pages[0].contentBuilder.build();
    const band = stream.match(/0\.9451 0\.9608 0\.9686 rg\n([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re/);
    const title = stream.match(/1 0 0 1 [\d.]+ ([\d.]+) Tm\n\(For and on behalf of SOLOMON DAO LLC\) Tj/);
    assert.ok(band);
    assert.ok(title);
    const bandCenter = Number(band[2]) + Number(band[4]) / 2;
    const titleInkCenter = Number(title[1]) + 10.2 * 0.7 / 2;
    assert.ok(Math.abs(titleInkCenter - bandCenter) < 0.01);
    const pdf = loadPdf(result.renderResult.output);
    const fieldIds = refs(getRaw(pdf.getDict(pdf.getPageTree().leafIds[0]).entries, "Annots"));
    assert.equal(fieldIds.length, 2);
    for (const id of fieldIds) {
        const rectangle = getRaw(pdf.getDict(id).entries, "Rect").match(/[\d.]+/g).map(Number);
        assert.ok(rectangle[3] <= Number(band[2]) + 0.01);
    }
});


test("content-sized labels tolerate fractional font widths and padding", () => {
    const source = ":::table max-content auto\n| LABEL | DETAIL |\n|---|---|\n| Designation reference / revision | Reference |\n| Name | Value |\n:::";
    const { result, pages } = render(source, { table: { fontSize: 8.5, cellPadding: { x: 6, y: 3.5 }, borderWidth: 0.4, lineHeight: 1.15 } });
    assert.equal(result.success, true, result.errors.join("; "));
    const stream = pages[0].contentBuilder.build();
    const baseline = text => Number(stream.match(new RegExp("1 0 0 1 [\\d.]+ ([\\d.]+) Tm\n\\(" + text + "\\) Tj"))[1]);
    const rowHeight = baseline("Reference") - baseline("Value");
    assert.ok(Math.abs(rowHeight - (8.5 * 1.15 + 7)) < 0.01);
});

test("long signature field labels retain their interactive field and value", () => {
    const label = "Company approval and conflict-disclosure reference";
    const { result } = render(":::signature-block Company\nSignature:\n" + label + ": [approval reference]\n:::", {
        directiveStyles: { "signature-block": { fieldLabelWidth: 240 } }
    });
    assert.equal(result.success, true, result.errors.join("; "));
    const pdf = loadPdf(result.renderResult.output);
    const fields = refs(getRaw(pdf.getDict(pdf.getPageTree().leafIds[0]).entries, "Annots"));
    assert.equal(fields.length, 2);
    assert.match(extractText(result.renderResult.output).text.replace(/\s+/g, " "), /Company approval and conflict-disclosure reference/);
    assert.equal(getRaw(pdf.getDict(fields[1]).entries, "V"), "([approval reference])");
});

test("table headings and the first wrapped data row move together at a page boundary", () => {
    const ast = convertMarkdownToDocument(parseMarkdownDoc("Opening text.\n\n## Records\n\n| DATE | DETAIL |\n|---|---|\n| 2026-09-08 | " + "A long wrapped detail. ".repeat(6) + " |"));
    const renderer = createTwoPassPdfRenderer({ pageConfig: { size: "a4" } });
    const renderParagraph = renderer.renderParagraph.bind(renderer);
    renderer.renderParagraph = (node, state, section, layout) => {
        renderParagraph(node, state, section, layout);
        if (renderer.extractText(node) === "Opening text.") state.currentY = state.margins.bottom + 70;
    };
    const result = createDocumentPipeline().setRenderer(renderer).processSingle({ id: "CON-00002", name: "Records", root: ast.root });
    assert.equal(result.success, true, result.errors.join("; "));
    const pages = extractText(result.renderResult.output).pages;
    assert.equal(pages.length, 2);
    assert.doesNotMatch(pages[0], /Records|DATE/);
    assert.match(pages[1], /Records/);
    assert.match(pages[1], /2026-09-08/);
});


test('single and split signature variants use open lines, aligned columns and full-height widgets',()=>{
    const single=label=>':::signature-block single '+label+'\nSignature:\nName and capacity: [Name and capacity]\nSigning date: [date]\n:::';
    /** @type {[string, number][]} */
    const variants=[[single('Company'),1],[':::signature-block split\n'+single('Company')+'\n'+single('Counterparty')+'\n:::',2]];
    for(const [source,count] of variants) {
        const {result,pages}=render(source);
        assert.equal(result.success,true,result.errors.join('; '));assert.equal(pages.length,1);
        const pdf=loadPdf(result.renderResult.output);
        const fieldIds=refs(getRaw(pdf.getDict(pdf.getPageTree().leafIds[0]).entries,'Annots'));
        assert.equal(fieldIds.length,count*3);
        const signatures=fieldIds.filter(id=>getRaw(pdf.getDict(id).entries,'FT')==='/Sig');
        assert.equal(signatures.length,count);
        const rectangles=signatures.map(id=>getRaw(pdf.getDict(id).entries,'Rect').match(/-?[\d.]+/g).map(Number));
        for(const rect of rectangles)assert.ok(rect[3]-rect[1]>=60);
        if(count===2){assert.equal(rectangles[0][1],rectangles[1][1]);assert.ok(rectangles[0][2]<rectangles[1][0]);}
        assert.doesNotMatch(pages[0].contentBuilder.build(),/re\s+S/);
    }
});

test('split signatures move together and reject malformed nested blocks',()=>{
    const single=':::signature-block single Company\nSignature:\nName:\n:::';
    const source='Opening.\n\n:::signature-block split\n'+single+'\n'+single+'\n:::';
    const renderer=createTwoPassPdfRenderer({pageConfig:{size:'a4'}}),paragraph=renderer.renderParagraph.bind(renderer);
    renderer.renderParagraph=(node,state,id,layout)=>{paragraph(node,state,id,layout);state.currentY=state.margins.bottom+30;};
    const root=convertMarkdownToDocument(parseMarkdownDoc(source)).root;
    const result=createDocumentPipeline().setRenderer(renderer).processSingle({id:'Test',name:'Test',root});
    assert.equal(result.success,true,result.errors.join('; '));
    const pdf=loadPdf(result.renderResult.output),ids=pdf.getPageTree().leafIds;
    assert.equal(ids.length,2);assert.equal(refs(getRaw(pdf.getDict(ids[0]).entries,'Annots')).length,0);assert.equal(refs(getRaw(pdf.getDict(ids[1]).entries,'Annots')).length,4);
    assert.throws(()=>convertMarkdownToDocument(parseMarkdownDoc(':::signature-block split\n'+single+'\n:::')),/exactly two/);
});


test('editable signature text uses its registered font in appearance and AcroForm resources',()=>{
    const {result}=render(':::signature-block single Company\nSignature:\nName and capacity: [Name and capacity]\n:::',{fonts:{regular:'Times-Roman',bold:'Times-Bold'}});
    assert.equal(result.success,true,result.errors.join('; '));
    const pdf=loadPdf(result.renderResult.output),page=pdf.getDict(pdf.getPageTree().leafIds[0]);
    const field=refs(getRaw(page.entries,'Annots')).map(id=>pdf.getDict(id)).find(dict=>getRaw(dict.entries,'FT')==='/Tx');
    const resource=getRaw(field.entries,'DA').match(/\/(F\d+)/)[1];
    const form=pdf.getDict(refs(getRaw(pdf.getDict(pdf.rootId).entries,'AcroForm'))[0]);
    const resourceId=Number(getRaw(form.entries,'DR').match(new RegExp('/'+resource+' (\\d+) 0 R'))[1]);
    assert.equal(getRaw(pdf.getDict(resourceId).entries,'BaseFont'),'/Times-Bold');
    const appearanceId=refs(getRaw(field.entries,'AP'))[0],appearance=pdf.getDict(appearanceId),object=pdf.getObjectRaw(appearanceId);
    assert.match(getRaw(appearance.entries,'Resources'),new RegExp('/'+resource+' '+resourceId+' 0 R'));
    assert.match(Buffer.from(pdf.decodeStreamBytes(appearance.entries,object.streamBytes)).toString('latin1'),new RegExp('/'+resource+' 10 Tf'));
    assert.equal(getRaw(field.entries,'Ff'),'0');
});


test("open signature labels and widget appearances share baselines and value columns", () => {
    const party = ":::signature-block single Company\nSignature:\nName: [Full name]\nCapacity: Director\nDate: [Signing date]\n:::\n";
    for (const rowHeight of [12,20]) {
        const { result, pages } = render(":::signature-block split\n" + party + party + ":::", { directiveStyles: { single: { fontSize:8, rowHeight, signatureRowHeight:76 } } });
        assert.equal(result.success,true,result.errors.join("; "));
        const pdf = loadPdf(result.renderResult.output);
        const annotations = refs(getRaw(pdf.getDict(pdf.getPageTree().leafIds[0]).entries,"Annots"));
        const labels = Array.from(pages[0].contentBuilder.build().matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm\n\((Capacity:|Date:)\) Tj/g), match => ({x:Number(match[1]),y:Number(match[2]),text:match[3]}));
        const fields = annotations.map(identifier => {
            const dictionary = pdf.getDict(identifier);
            const rectangle = getRaw(dictionary.entries,"Rect").match(/-?[\d.]+/g).map(Number);
            const appearanceIdentifier = refs(getRaw(dictionary.entries,"AP"))[0];
            const appearance = pdf.getObjectRaw(appearanceIdentifier);
            const stream = Buffer.from(pdf.decodeStreamBytes(pdf.getDict(appearanceIdentifier).entries,appearance.streamBytes)).toString("latin1");
            const position = stream.match(/([\d.]+) ([\d.]+) Td/);
            return {name:getRaw(dictionary.entries,"T"),rectangle,x:position ? rectangle[0]+Number(position[1]) : null,y:position ? rectangle[1]+Number(position[2]) : null};
        });
        for (const [index,signature] of fields.filter(field => field.name.endsWith(".signature)")).entries()) {
            const group = fields.slice(index*4,index*4+4);
            const name = group.find(field => field.name.endsWith(".name)"));
            const capacity = group.find(field => field.name.endsWith(".capacity)"));
            const date = group.find(field => field.name.endsWith(".date)"));
            assert.equal(name.x,signature.rectangle[0]);
            assert.equal(capacity.x,date.x);
            for (const {field,label} of [{field:capacity,label:"Capacity:"},{field:date,label:"Date:"}]) {
                const printed = labels.find(position => position.x === signature.rectangle[0] && position.text === label);
                assert.ok(printed,label);
                assert.ok(Math.abs(printed.y-field.y)<0.001,label+" baseline must match its rendered appearance");
            }
            assert.ok(signature.rectangle[3]-signature.rectangle[1]>=70);
        }
    }
});


test("configured metadata labels share a value column and wrapped row spacing", () => {
    const source = "# Statement\n\n**Document reference:** DOC-001\n\n**Period covered:** " + "Covered interval ".repeat(30) + "\n\n**Reference / case:** CASE-001\n\nBody.";
    const {result,pages} = render(source,{markdownEnvelopeStyle:{labels:["Document reference","Period covered","Reference / case"],fontSize:9.2,labelFontSize:9.2}});
    assert.equal(result.success,true,result.errors.join("; "));
    const positions = Array.from(pages[0].contentBuilder.build().matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm\n\(([^()]*)\) Tj/g),match => ({x:Number(match[1]),y:Number(match[2]),text:match[3]}));
    const reference = positions.find(position => position.text === "DOC-001");
    const caseReference = positions.find(position => position.text === "CASE-001");
    const wrappedLines = positions.filter(position => position.text === "Covered" && position.x === reference.x);
    assert.ok(wrappedLines.length>1);
    assert.equal(reference.x,caseReference.x);
    assert.ok(caseReference.y<wrappedLines.at(-1).y);
    for(const {label,value} of [{label:"Document reference:",value:reference},{label:"Period covered:",value:wrappedLines[0]},{label:"Reference / case:",value:caseReference}]) {
        assert.equal(positions.find(position=>position.text===label).y,value.y);
    }
});

test("trailing paragraph spacing at the foot of a page does not create an empty page", () => {
    const renderer = createTwoPassPdfRenderer({pageConfig:{size:"a4"}});
    const state = renderer.initializeState();
    renderer.newPage(state,"records");
    const baseline = state.margins.bottom + 25;
    const next = renderer.renderInlineRunsWrapped([{text:"Final record.",bold:false,italic:false,underline:false,monospace:false}],state,"records",state.margins.left,baseline,state.contentWidth,10,1.5);
    assert.equal(state.pages.length,1);
    assert.equal(next,baseline-15);
    assert.match(state.pages[0].contentBuilder.build(),/Final/);
    renderer.newPage(state,"signing");
    assert.equal(state.pages.length,2);
    assert.equal(state.pages[1].sectionId,"signing");
});

test("middle-aligned body cells center their visible text while retaining row heights", () => {
    const source = "| ITEM | AMOUNT |\n|---|---|\n| Asset | 100.00 |\n| Payment | 200.00 |";
    const settings = {fontSize:10,lineHeight:1.5,cellPadding:4};
    const regular = render(source,{table:settings});
    const centered = render(source,{table:{...settings,cellVAlign:"middle"}});
    assert.equal(centered.result.success,true,centered.result.errors.join("; "));
    const state = centered.pages[0].contentBuilder.build();
    const baseline = (stream,text) => Number(stream.match(new RegExp("1 0 0 1 [\\d.]+ ([\\d.]+) Tm\n\\("+text+"\\) Tj"))[1]);
    const headerRectangle = state.match(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re/);
    assert.ok(headerRectangle);
    assert.equal(Number(headerRectangle[4]),23);
    const rowTop = Number(headerRectangle[2]);
    assert.ok(Math.abs(baseline(state,"Asset")+3.5-(rowTop-11.5))<0.001);
    assert.ok(Math.abs(baseline(state,"Payment")+2.5-(rowTop-23-11.5))<0.001);
    assert.equal(headerRectangle[4],regular.pages[0].contentBuilder.build().match(/([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re/)[4]);
    assert.equal(baseline(state,"100.00")-baseline(state,"200.00"),23);
});
