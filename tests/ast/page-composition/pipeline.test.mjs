import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMarkdownDoc} from '../../../lib/parsing/markdown.mjs';
import {convertMarkdownToDocument} from '../../../lib/ast/converters/MarkdownToAstConverter.mjs';
import {createDocumentPipeline,createLegalKeepTogetherRule,createArticlePageBreakRule} from '../../../lib/ast/pipelines/DocumentPipeline.mjs';
import {createTwoPassPdfRenderer} from '../../../lib/ast/renderers/TwoPassPdfRenderer.mjs';
import {extractText} from '../../../lib/pdf/extract-text.mjs';
import {loadPdf,getRaw} from '../../../lib/pdf/reader.mjs';
import {Document} from '../../../lib/record-schema/Document.mjs';
import {RenderPack} from '../../../lib/record-schema/RenderPack.mjs';
import {toCamelCase} from '../../../lib/ast/adapters/RenderPackAdapter.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

/** @typedef {import("../../../lib/ast/types/core.mjs").PageComposition} PageComposition */
/** @typedef {import('../../../lib/ast/types/core.mjs').ResolvedRenderConfig} ResolvedRenderConfig */

test('composes structural nodes produced by the native formatting pipeline',()=>{
    const renderer=createTwoPassPdfRenderer({pageConfig:{size:'a4'},pageComposition:{mode:'fixed',placeholderMode:'literal',regions:[{sourceHeading:'Issuer',x:40,top:40,width:475,height:90,fontSize:12}]}});
    const pipeline=createDocumentPipeline().addFormattingRules([createLegalKeepTogetherRule(),createArticlePageBreakRule()]).setRenderer(renderer);
    const document=convertMarkdownToDocument(parseMarkdownDoc('# Issuer\n\n**Example company**  \nUEN [registration]'));
    const result=pipeline.processSingle({id:'Example',name:'Example',root:document.root});
    assert.equal(result.success,true,result.errors.join('; '));
    assert.equal(result.renderResult.pageCount,1);
    assert.match(extractText(result.renderResult.output).text,/Example\s+company/);
    assert.match(extractText(result.renderResult.output).text,/UEN\s+\[registration\]/);
});


test('a composed first page shares native pagination with flowing records and a final signing page',(t)=>{
    const directory=mkdtempSync(join(tmpdir(),'composed-records-'));
    t.after(()=>rmSync(directory,{recursive:true,force:true}));
    /** @type {PageComposition} */
    const composition={mode:'first-page',continuationHeading:'Records',placeholderMode:'literal',decorations:[{x:40,top:40,width:475,height:50,fill:'#213C51'}],regions:[{sourceHeading:'Issuer',x:45,top:45,width:460,height:40,fontSize:12,color:'#FFFFFF'}]};
    const source='# Issuer\n\n**[Company legal name]**\n\n# Records\n\n:::data-table records.tsv\ncolumns:\n  - { header: Reference, type: text, align: left, width: max-content-padded }\n  - { header: Amount, type: decimal, decimal_places: 2, rounding: half-up, align: right, width: auto }\n:::\n\n:::signing-page\n## Execution\n\n:::signature-block Company\nSignature:\nName:\n:::\n\n:::form-fields\n**Email:** [Email]\n:::\n:::';
    const records='Reference\tAmount\n'+Array.from({length:90},(_,index)=>'Entry-'+String(index+1).padStart(3,'0')+'\t1000.005\n').join('');
    const renderer=createTwoPassPdfRenderer({pageConfig:{size:'a4'},pageComposition:composition,pageTracking:{enabled:true,identifier:'CON-00002/0.4'},table:{minimumBodyRows:3},defaultHeaders:[{pages:'all',location:'header',columns:{left:{content:'FLOW HEADER'}}}],defaultFooters:[{pages:'all',location:'footer',columns:{left:{content:'FLOW FOOTER'}}}]});
    writeFileSync(join(directory,'records.tsv'),records);
    const sourceDocument=Document.fromText(source,join(directory,'document.md'));
    const ast=convertMarkdownToDocument(parseMarkdownDoc(source),{sourceDocument});
    const result=createDocumentPipeline().addFormattingRules([createLegalKeepTogetherRule()]).setRenderer(renderer).processSingle({id:'Income',name:'Income',root:ast.root});
    assert.equal(result.success,true,result.errors.join('; '));
    const pages=extractText(result.renderResult.output).pages;
    assert.ok(pages.length>=4);
    assert.match(pages[0],/\[Company\s+legal\s+name\]/);
    assert.doesNotMatch(pages[0],/FLOW|Entry-|Records/);
    assert.match(pages[0],new RegExp('CON-00002/0.4\\|1/'+pages.length));
    for(const page of pages.slice(1,-1)) {
        assert.match(page,/Reference/);
        assert.match(page,/FLOW HEADER/);
        assert.match(page,/FLOW FOOTER/);
        assert.doesNotMatch(page,/Company\s+legal\s+name/);
    }
    for(let index=1;index<=90;index++) assert.equal((pages.join(' ').match(new RegExp('Entry-'+String(index).padStart(3,'0'),'g'))??[]).length,1);
    assert.doesNotMatch(pages.at(-1),/CON-00002\/0.4\||FLOW/);
    const pdf=loadPdf(result.renderResult.output);
    const references=raw=>Array.from((raw??'').matchAll(/(\d+) 0 R/g),match=>Number(match[1]));
    const firstPage=pdf.getDict(pdf.getPageTree().leafIds[0]);
    assert.equal(references(getRaw(firstPage.entries,'Annots')).length,0);
    const lastPage=pdf.getDict(pdf.getPageTree().leafIds.at(-1));
    const fields=references(getRaw(lastPage.entries,'Annots'));
    assert.equal(fields.length,3);
    assert.equal(fields.filter(id=>getRaw(pdf.getDict(id).entries,'FT')==='/Sig').length,1);
    assert.equal(fields.filter(id=>getRaw(pdf.getDict(id).entries,'FT')==='/Tx').length,2);
});

test('first-page composition rejects missing or repeated boundaries and unplaced front content',()=>{
    /** @type {PageComposition} */
    const composition={mode:'first-page',continuationHeading:'Records',regions:[{sourceHeading:'Issuer',x:40,top:40,width:475,height:70,fontSize:12}]};
    /** @type {[string, RegExp][]} */
    const cases = [
        ['# Issuer\n\nCompany',/exactly one continuation/],
        ['# Issuer\n\nCompany\n\n# Records\n\nOne\n\n# Records\n\nTwo',/exactly one continuation/],
        ['# Issuer\n\nCompany\n\n# Omitted\n\nUnplaced\n\n# Records\n\nDetails',/Unplaced source heading/],
        ['# Issuer\n\nCompany\n\n# Records',/both region content/]
    ];
    for(const [source,error] of cases) {
        const renderer=createTwoPassPdfRenderer({pageConfig:{size:'a4'},pageComposition:composition});
        const document=convertMarkdownToDocument(parseMarkdownDoc(source));
        const result=createDocumentPipeline().setRenderer(renderer).processSingle({id:'Income',name:'Income',root:document.root});
        assert.equal(result.success,false);
        assert.match(result.errors.join('; '),error);
    }
});


test('record documents retain line breaks in composed certificate regions',()=>{
    const pack=new RenderPack({schema:'record-schema-render-pack',schema_version:1,pack_id:'example-pack',document_policies:{targets:{pdf:{format:'pdf',page_composition:{mode:'first-page',continuation_heading:'Records',placeholder_mode:'literal',regions:[{source_heading:'Title',x:40,top:40,width:475,height:70,font_size:12}]}}},render_profiles:{income:{target:'pdf'}}}});
    const document=Document.fromText('# Title\n\nCertificate title  \n& income record\n\n# Records\n\nContinuation.', 'CON-00002_DOC-income.md');
    const source=document.toRenderSource(pack,{path:'CON-00002_DOC-income.md',doc_type:'DOC',render_profile_id:'income',precedence:0,label:'Income'},'CON-00002');
    const configuration=/** @type {ResolvedRenderConfig} */ (toCamelCase(pack.getEffectiveTargetConfig('income').target));
    const renderer=createTwoPassPdfRenderer({pageConfig:{size:'a4'},pageComposition:configuration.pageComposition});
    let stream='';
    const build=renderer.buildPdf.bind(renderer);
    renderer.buildPdf=state=>{stream=state.pages[0].contentBuilder.build();return build(state);};
    const result=createDocumentPipeline().setRenderer(renderer).processSingle({id:'Income',name:'Income',root:source.root});
    assert.equal(result.success,true,result.errors.join('; '));
    const positions=Array.from(stream.matchAll(/1 0 0 1 [\d.]+ ([\d.]+) Tm\n\((Certificate|&)\) Tj/g));
    assert.equal(positions.length,2);
    assert.ok(Number(positions[0][1])-Number(positions[1][1])>15);
});

test('composed tables and the final signing page share an opt-in document total',()=>{
    const source='# Sources\n\n| Source | Amount |\n|---|---:|\n| First | 100.00 |\n| Second | 20.00 |\n\n# Records\n\nOrdinary records.\n\n:::signing-page\n# Declaration\n\n:::signature-block single Company\nSignature:\nName: [Full name]\n:::\n:::';
    /** @type {PageComposition} */
    const composition={mode:'first-page',continuationHeading:'Records',pagination:{x:420,top:800,width:125,fontSize:8},regions:[{sourceHeading:'Sources',x:42,top:100,width:503,height:150,fontSize:10}]};
    const renderer=createTwoPassPdfRenderer({pageConfig:{size:'a4'},pageComposition:composition,pageNumbering:{includeSigningPage:true},pageTracking:{enabled:true},variables:{documentId:'EXAMPLE-001'},defaultHeaders:[{pages:'all',location:'header',columns:{left:{content:'BODY HEADER'}}}],defaultFooters:[{pages:'all',location:'footer',columns:{right:{content:['Page ',{type:'variable',name:'page'},' of ',{type:'variable',name:'totalPages'}]}}}]});
    const ast=convertMarkdownToDocument(parseMarkdownDoc(source));
    const result=createDocumentPipeline().setRenderer(renderer).processSingle({id:'Example',name:'Example',root:ast.root});
    assert.equal(result.success,true,result.errors.join('; '));
    const pages=extractText(result.renderResult.output).pages;
    assert.equal(pages.length,3);
    pages.forEach((page,index)=>assert.match(page,new RegExp('Page '+(index+1)+' of 3')));
    assert.match(pages[0],/100.00/);assert.match(pages[0],/20.00/);
    assert.match(pages[0],/EXAMPLE-001\|1\/3/);assert.match(pages[1],/EXAMPLE-001\|2\/3/);
    assert.doesNotMatch(pages[2],/EXAMPLE-001\||BODY HEADER/);
    const tooSmall=structuredClone(composition);tooSmall.regions[0].height=8;
    const overflow=createDocumentPipeline().setRenderer(createTwoPassPdfRenderer({pageConfig:{size:'a4'},pageComposition:tooSmall})).processSingle({id:'Example',name:'Example',root:ast.root});
    assert.equal(overflow.success,false);assert.match(overflow.errors.join('; '),/overflow|table row/i);
});


test('first-page logo and signing stay on the certificate, with ordinary numbered records after it',context=>{
    const directory=mkdtempSync(join(tmpdir(),'certificate-logo-'));
    context.after(()=>rmSync(directory,{recursive:true,force:true}));
    const artwork=join(directory,'company.svg');
    writeFileSync(artwork,'<svg viewBox="0 0 100 100"><path fill-rule="evenodd" d="M0 0 C0 100 100 0 100 100 Z"/></svg>');
    /** @type {PageComposition} */
    const composition={mode:'first-page',continuationHeading:'Records',placeholderMode:'literal',pagination:{x:420,top:805,width:125,fontSize:8},regions:[{sourceHeading:'Issuer',x:42,top:40,width:400,height:50,fontSize:12},{sourceHeading:'Execution',x:42,top:600,width:230,height:180,fontSize:10}]};
    composition.letterheadLogo={path:artwork,x:42,top:40,width:40,height:40,gap:12,shiftSourceHeadings:['Issuer']};
    const source='# Issuer\n\nExample company\n\n# Execution\n\n:::signature-block single For and on behalf of the Company\nSignature:\nName and capacity: [Name and capacity]\nSigning date: [date]\n:::\n\n# Records\n\n| Reference | Amount |\n|---|---|\n'+Array.from({length:20},(_,i)=>'| Entry-'+String(i+1).padStart(2,'0')+' | 1000.00 |').join('\n');
    const renderer=createTwoPassPdfRenderer({pageConfig:{size:'a4'},pageComposition:composition,headingStyles:{h1:{bold:false,align:'left'}},defaultFooters:[{pages:'all',location:'footer',columns:{right:{content:['Page ',{type:'variable',name:'page'},' of ',{type:'variable',name:'totalPages'}]}}}]});
    let streams=[];
    const build=renderer.buildPdf.bind(renderer);
    renderer.buildPdf=state=>{streams=state.pages.map(page=>page.contentBuilder.build());return build(state);};
    const ast=convertMarkdownToDocument(parseMarkdownDoc(source));
    const result=createDocumentPipeline().setRenderer(renderer).processSingle({id:'Income',name:'Income',root:ast.root});
    assert.equal(result.success,true,result.errors.join('; '));
    const pdf=loadPdf(result.renderResult.output),pages=extractText(result.renderResult.output).pages;
    assert.equal(pages.length,2);
    assert.match(streams[0],/\sc\nh\nf\*/);assert.doesNotMatch(streams[1],/\sc\nh\nf\*/);
    assert.match(pages[0],/Page 1 of 2/);assert.match(pages[1],/Page 2 of 2/);
    assert.doesNotMatch(pages[0],/Entry-/);assert.doesNotMatch(pages[1],/For and on behalf/);
    assert.equal((pages[1].match(/Entry-/g)??[]).length,20);
    const references=raw=>Array.from((raw??'').matchAll(/(\d+) 0 R/g),match=>Number(match[1]));
    const first=pdf.getDict(pdf.getPageTree().leafIds[0]);
    const fields=references(getRaw(first.entries,'Annots'));
    assert.equal(fields.length,3);assert.equal(references(getRaw(pdf.getDict(pdf.getPageTree().leafIds[1]).entries,'Annots')).length,0);
    const signature=fields.find(id=>getRaw(pdf.getDict(id).entries,'FT')==='/Sig');
    const rect=getRaw(pdf.getDict(signature).entries,'Rect').match(/-?[\d.]+/g).map(Number);
    assert.ok(rect[3]-rect[1]>=60);
});


test("document soft-wrap options apply equally to letterhead regions, continuation pages and nested directives", () => {
    const pack = new RenderPack({
        schema: "record-schema-render-pack",
        schema_version: 1,
        pack_id: "wrap-test",
        document_policies: {
            targets: {
                pdf: {
                    format: "pdf",
                    page_composition: {
                        mode: "first-page",
                        continuation_heading: "Continuation",
                        regions: [
                            {
                                source_heading: "Letterhead",
                                x: 40,
                                top: 40,
                                width: 475,
                                height: 160,
                                font_size: 12
                            }
                        ]
                    }
                }
            },
            render_profiles: { standard: { target: "pdf" } }
        }
    });
    const document = Document.fromText(
        "# Letterhead\n\nAlpha\nBravo  \nCharlie\n\n# Continuation\n\nDelta\nEcho  \nFoxtrot\n\n:::notice\nGolf\nHotel  \nIndia\n:::",
        "DOC-00017_DOC-letter.md"
    );
    for (const disable_soft_wrap of [false, true]) {
        const source = document.toRenderSource(
            pack,
            {
                path: "DOC-00017_DOC-letter.md",
                doc_type: "DOC",
                render_profile_id: "standard"
            },
            "DOC-00017",
            { disable_soft_wrap }
        );
        const configuration = /** @type {ResolvedRenderConfig} */ (
            toCamelCase(pack.resolveForFile({rel_path: "DOC-00017/DOC-00017_DOC-letter.md", doc_type: "DOC", ext: "md", render_profile_id: "standard"}))
        );
        const renderer = createTwoPassPdfRenderer({
            pageConfig: { size: "a4" },
            pageComposition: configuration.pageComposition
        });
        /** @type {string[]} */
        let streams = [];
        const build = renderer.buildPdf.bind(renderer);
        renderer.buildPdf = (state) => {
            streams = state.pages.map((page) => page.contentBuilder.build());
            return build(state);
        };
        const result = createDocumentPipeline()
            .setRenderer(renderer)
            .processSingle({
                id: source.id,
                name: source.name,
                root: source.root
            });
        assert.equal(result.success, true, result.errors.join("; "));
        assert.equal(streams.length, 2);
        const baseline = (page, word) => {
            const match = Array.from(
                streams[page].matchAll(
                    /1 0 0 1 [\d.-]+ ([\d.-]+) Tm\n\(([^\n]*)\) Tj/g
                )
            ).find((item) => item[2] === word);
            assert.ok(match, word);
            return Number(match[1]);
        };
        for (const [page, first, second, third] of [
            [0, "Alpha", "Bravo", "Charlie"],
            [1, "Delta", "Echo", "Foxtrot"],
            [1, "Golf", "Hotel", "India"]
        ]) {
            const firstY = baseline(page, first),
                secondY = baseline(page, second),
                thirdY = baseline(page, third);
            if (disable_soft_wrap)
                assert.ok(
                    firstY > secondY,
                    first + " must retain its source break"
                );
            else assert.equal(firstY, secondY, first + " must soft-wrap");
            assert.ok(
                secondY > thirdY,
                second + " must retain its explicit hard break"
            );
        }
    }
});
