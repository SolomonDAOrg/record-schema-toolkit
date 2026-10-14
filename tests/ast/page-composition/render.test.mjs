import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMarkdownDoc} from '../../../lib/parsing/markdown.mjs';
import {convertMarkdownToDocument} from '../../../lib/ast/converters/MarkdownToAstConverter.mjs';
import {createTwoPassPdfRenderer} from '../../../lib/ast/renderers/TwoPassPdfRenderer.mjs';
import {extractText} from '../../../lib/pdf/extract-text.mjs';
import {loadPdf} from '../../../lib/pdf/reader.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
/** @typedef {import("../../../lib/ast/types/core.mjs").PageComposition} PageComposition */

function render(markdown, composition) {
    const renderer=createTwoPassPdfRenderer({pageConfig:{size:'a4'},pageComposition:composition,pageTracking:{enabled:true,identifier:'TEST/1'}});
    const document=convertMarkdownToDocument(parseMarkdownDoc(markdown));
    return renderer.render([{id:'example',config:{id:'example'},content:document.root.children}]);
}
/** @type {PageComposition} */
const composition={mode:'fixed',placeholderMode:'literal',regions:[{sourceHeading:'Details',x:40,top:40,width:470,height:130,fontSize:12,showHeading:true}]};

test('renders native text, formatting and literal placeholders on one tracked page',()=>{
    const result=render('# Details\n\n**Example company**  \nUSD [amount]',composition);
    assert.equal(result.success,true,result.errors.join('; '));
    assert.equal(loadPdf(result.output).pageCount(),1);
    const text=extractText(result.output).text;
    assert.match(text,/Example\s+company/); assert.match(text,/USD\s+\[amount\]/); assert.match(text,/TEST\/1\|1\/1/);
    assert.doesNotMatch(Buffer.from(result.output).toString('latin1'),/\/Subtype \/Widget/);
});
test('aborts rather than clipping overflowing text',()=>{
    const result=render('# Details\n\n'+('Long content '.repeat(800)),composition);
    assert.equal(result.success,false); assert.equal(result.output,null); assert.match(result.errors.join(' '),/overflow/);
});
test('does not affect unconfigured flowing documents',()=>{
    const result=render('# Ordinary heading\n\nOrdinary paragraph.',undefined);
    assert.equal(result.success,true,result.errors.join('; '));
    assert.match(extractText(result.output).text,/Ordinary\s+paragraph/);
});


test('fixed compositions support first-page pagination and reject overlapping pagination boxes',()=>{
    const configured={...composition,pagination:{x:420,top:805,width:125,fontSize:8}};
    const result=render('# Details\n\nCertificate',configured);
    assert.equal(result.success,true,result.errors.join('; '));
    assert.match(extractText(result.output).text,/Page 1 of 1/);
    const invalid=render('# Details\n\nCertificate',{...configured,pagination:{x:40,top:40,width:120,fontSize:8}});
    assert.equal(invalid.success,false);assert.match(invalid.errors.join('; '),/pagination overlaps/);
});

test('oversized first-page signatures fail instead of creating a hidden extra page',()=>{
    const result=render('# Details\n\n:::signature-block single Company\nSignature:\nName:\nDate:\n:::',{...composition,regions:[{...composition.regions[0],height:30}]});
    assert.equal(result.success,false);assert.equal(result.output,null);assert.match(result.errors.join('; '),/overflow/);
});

test('contains SVG artwork, emits vector curves, and restores layout when disabled', context => {
    const directory=mkdtempSync(join(tmpdir(),'letterhead-logo-'));
    context.after(()=>rmSync(directory,{recursive:true,force:true}));
    const path=join(directory,'company.svg');
    writeFileSync(path,'<svg viewBox="10 20 200 100"><path fill="black" stroke="black" fill-rule="evenodd" d="M10 20 C20 30 40 60 210 120 Z"/></svg>');
    const logo={path,x:40,top:40,width:60,height:60,gap:14,shiftSourceHeadings:['Details']};
    const renderLogo = letterheadLogo => {
        const renderer=createTwoPassPdfRenderer({pageConfig:{size:'a4'},pageComposition:{...composition,letterheadLogo}});
        const document=convertMarkdownToDocument(parseMarkdownDoc('# Details\n\nCompany'));
        let stream='';
        const build=renderer.buildPdf.bind(renderer);
        renderer.buildPdf=state=>{stream=state.pages[0].contentBuilder.build();return build(state);};
        const result=renderer.render([{id:'example',config:{id:'example'},content:document.root.children}]);
        return {result,stream};
    };
    const full=renderLogo(logo), small=renderLogo({...logo,scale:0.5});
    for (const value of [full,small]) {
        assert.equal(value.result.success,true,value.result.errors.join('; '));
        assert.equal(loadPdf(value.result.output).pageCount(),1);
        assert.match(value.stream,/\sc\nh\nB\*/);
        assert.match(value.stream,/0 0 0 rg/);
        assert.doesNotMatch(Buffer.from(value.result.output).toString('latin1'),/\/Subtype \/Image/);
    }
    const move=stream=>stream.match(/([\d.]+) ([\d.]+) m/).slice(1).map(Number);
    const fullMove=move(full.stream), smallMove=move(small.stream);
    assert.equal(fullMove[0],40); assert.equal(smallMove[0],40);
    assert.ok(Math.abs(smallMove[1]-fullMove[1]-7.5)<0.01);
    assert.match(full.stream,/1 0 0 1 114 [\d.]+ Tm\n\(Company\) Tj/);
    assert.match(small.stream,/1 0 0 1 84 [\d.]+ Tm\n\(Company\) Tj/);
    const disabled=renderLogo({...logo,path:join(directory,'missing.svg'),enabled:false});
    assert.equal(disabled.result.success,true,disabled.result.errors.join('; '));
    assert.match(disabled.stream,/1 0 0 1 40 [\d.]+ Tm\n\(Company\) Tj/);
    assert.doesNotMatch(disabled.stream,/\nB\*/);
    /** @type {[string, RegExp][]} */
    const invalidArtwork=[['<svg viewBox="0 0 0 100"/>',/positive SVG/],['<svg viewBox="0 0 100 100"><path d="M0 0 A2 2 0 0 1 4 4"/></svg>',/Unsupported SVG path command/]];
    for (const [data,error] of invalidArtwork) {
        writeFileSync(path,data);
        const invalid=renderLogo(logo);
        assert.equal(invalid.result.success,false);assert.equal(invalid.result.output,null);assert.match(invalid.result.errors.join('; '),error);
    }
    const missing=renderLogo({...logo,path:join(directory,'missing.svg')});
    assert.equal(missing.result.success,false);assert.match(missing.result.errors.join('; '),/ENOENT/);
});
