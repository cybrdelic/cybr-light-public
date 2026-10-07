import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=name=>readFile(new URL(name,import.meta.url),'utf8');
test('host and shader builder request the same versioned filter interfaces',async()=>{
 const app=await read('app.js'),builder=await read('renderer-shaders.mjs');
 for(const [file,exportName] of [['tiled-filter.mjs','baselineTileBytes'],['fused-tiled-filter.mjs','fusedTileBytes']]){
  const specifier=app.match(new RegExp("from '(\\./"+file.replaceAll('.','\\.')+"\\?revision=[^']+)'"))?.[1];
  assert.ok(specifier,'Filter interface must have a cache revision');
  assert.ok(builder.includes("from '"+specifier+"'"));
  assert.equal(typeof (await import(new URL(specifier,import.meta.url)))[exportName],'function');
 }
});
test('module linkage failure becomes a visible startup error',async()=>{
 const html=await read('index.html');
 const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
 assert.ok(script);
 const status={textContent:'Loading',setAttribute(name,value){this[name]=value;}},errors=[];
 const AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
 const run=new AsyncFunction('location','document','console','load',script.replace('await import(','await load('));
 await run({search:''},{querySelector:()=>status},{error:error=>errors.push(error)},async()=>{throw new SyntaxError('Missing export');});
 assert.equal(status.role,'alert');assert.match(status.textContent,/Renderer could not start: Missing export/);
 assert.equal(errors.length,1);
});
