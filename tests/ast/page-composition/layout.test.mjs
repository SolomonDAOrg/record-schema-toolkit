import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMarkdownDoc} from '../../../lib/parsing/markdown.mjs';
import {convertMarkdownToDocument} from '../../../lib/ast/converters/MarkdownToAstConverter.mjs';
import {LayoutEngine} from '../../../lib/ast/layout/LayoutEngine.mjs';
/** @typedef {import("../../../lib/ast/types/core.mjs").PageComposition} PageComposition */
const engine = new LayoutEngine();
const layoutPageComposition = engine.layoutPageComposition.bind(engine);
const layoutLetterheadLogo = engine.layoutLetterheadLogo.bind(engine);

/** @type {PageComposition} */
const configuration = {mode:'fixed', regions:[{sourceHeading:'Issuer',x:40,top:40,width:220,height:50,fontSize:12},{sourceHeading:'Income',x:300,top:40,width:220,height:50,fontSize:12}]};
const logo = {path:'company.svg',x:40,top:40,width:40,height:40,scale:1,gap:12,shiftSourceHeadings:['Issuer']};
function sections(markdown = '# Issuer\n\nExample company\n\n# Income\n\nUSD [amount]') {
    const document = convertMarkdownToDocument(parseMarkdownDoc(markdown));
    return [{id:'example',config:{id:'example'},content:document.root.children}];
}

test('assigns every named Markdown block exactly once',()=>{
    assert.deepEqual([...layoutPageComposition(configuration, sections(),595,842).keys()],['Issuer','Income']);
});
test('rejects an omitted source block',()=>{
    assert.throws(()=>layoutPageComposition({...configuration,regions:configuration.regions.slice(0,1)},sections(),595,842),/Unplaced source heading: Income/);
});
test('rejects a missing selector',()=>{
    const modified=structuredClone(configuration); modified.regions[1].sourceHeading='Missing';
    assert.throws(()=>layoutPageComposition(modified,sections(),595,842),/Missing source heading/);
});
test('rejects repeated source headings and region references',()=>{
    assert.throws(()=>layoutPageComposition(configuration,sections('# Issuer\n\nOne\n\n# Issuer\n\nTwo'),595,842),/Duplicate source heading/);
    const modified=structuredClone(configuration); modified.regions[1].sourceHeading='Issuer';
    assert.throws(()=>layoutPageComposition(modified,sections(),595,842),/selected twice/);
});
test('rejects source-region intersections but permits background decorations',()=>{
    const modified=structuredClone(configuration); modified.regions[1].x=200;
    assert.throws(()=>layoutPageComposition(modified,sections(),595,842),/Overlapping source regions/);
    assert.doesNotThrow(()=>layoutPageComposition({...configuration,decorations:[{x:0,top:0,width:595,height:842,fill:'#FFFFFF'}]},sections(),595,842));
});
test('rejects off-page boxes and invalid dimensions',()=>{
    const modified=structuredClone(configuration); modified.regions[1].width=400;
    assert.throws(()=>layoutPageComposition(modified,sections(),595,842),/outside the physical page/);
    modified.regions[1].width=NaN;
    assert.throws(()=>layoutPageComposition(modified,sections(),595,842),/outside the physical page/);
});
test('rejects unselected leading prose and unsupported block structure',()=>{
    assert.throws(()=>layoutPageComposition(configuration,sections('Leading prose\n\n# Issuer\n\nCompany'),595,842),/precedes the first/);
    assert.throws(()=>layoutPageComposition(configuration,sections('# Issuer\n\n- List item\n\n# Income\n\nAmount'),595,842),/requires paragraph, table, image or signature-block content/);
});

test('scales the logo reservation and preserves company right edges without mutation', () => {
    const original = structuredClone(configuration);
    const full = layoutLetterheadLogo({...configuration,letterheadLogo:logo},595,842);
    const smaller = layoutLetterheadLogo({...configuration,letterheadLogo:{...logo,scale:0.5}},595,842);
    assert.equal(full.regions[0].x,92); assert.equal(full.regions[0].width,168);
    assert.equal(smaller.regions[0].x,72); assert.equal(smaller.regions[0].width,188);
    assert.deepEqual(full.regions[1],original.regions[1]);
    assert.deepEqual(configuration,original);
    assert.deepEqual(layoutLetterheadLogo({...configuration,letterheadLogo:logo},595,842),full);
    assert.deepEqual(layoutLetterheadLogo({...configuration,letterheadLogo:{...logo,enabled:false}},595,842).regions,configuration.regions);
});

test('rejects invalid logo geometry, missing selectors, collisions and oversized reservations', () => {
    for (const change of [{scale:0},{scale:NaN},{width:-1},{gap:-1},{scale:1e308},{scale:2},{path:''},{shiftSourceHeadings:[]},{shiftSourceHeadings:['Issuer','Issuer']},{shiftSourceHeadings:['Missing']},{width:250}]) {
        assert.throws(()=>layoutLetterheadLogo({...configuration,letterheadLogo:{...logo,...change}},595,842),/letterhead|Letterhead/);
    }
    const collision={...configuration,regions:[...configuration.regions,{sourceHeading:'Other',x:40,top:60,width:25,height:20,fontSize:10}],letterheadLogo:logo};
    assert.throws(()=>layoutLetterheadLogo(collision,595,842),/overlaps source region: Other/);
    assert.throws(()=>layoutLetterheadLogo({...configuration,letterheadLogo:logo,pagination:{x:40,top:40,width:30,fontSize:8}},595,842),/overlaps pagination/);
});
