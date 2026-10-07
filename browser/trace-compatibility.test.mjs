import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildRendererShader} from './renderer-shaders.mjs';
import {rendererOptions} from './renderer-options.mjs';
import {traceCompatibility,traceCompileVariant} from './trace-compatibility.mjs';
const load=name=>readFile(new URL(name,import.meta.url),'utf8');
const parameters=new URLSearchParams('scene=proof-optics&glass=split&motion=bilinear');
const original=await buildRendererShader('trace',{load,parameters,options:rendererOptions(parameters)});
test('compatibility changes only independent workgroup shape and supported path capacity',()=>{
 const variant=traceCompatibility(original);
 assert.equal(variant.workgroup,4);assert.equal(variant.mediumSlots,10);
 const restored=variant.code.replaceAll('@workgroup_size(4,4)','@workgroup_size(8,8)')
  .replace('ids:array<u32,10>','ids:array<u32,16>').replace('values:array<vec4f,10>','values:array<vec4f,16>')
  .replaceAll('min(u.size.w,10u)','min(u.size.w,16u)');
 assert.equal(restored,original,'Every transport operation, glass split, RNG and traversal statement is preserved');
});
test('capacity retains the terminal emission endpoint and full traversal stack',()=>{
 const {code}=traceCompatibility(original);
 assert.ok(code.includes('bounce<=min(u.size.w,10u)'));
 assert.ok(code.includes('if(bounce>=min(u.size.w,10u)){break;}'));
 assert.ok(code.includes('array<u32,64>'));
 const ui=readFile(new URL('index.html',import.meta.url),'utf8');
 return ui.then(html=>{const depth=html.match(/id="bounces"[\s\S]*?<\/select>/)[0];
  assert.deepEqual([...depth.matchAll(/value="(\d+)"/g)].map(m=>Number(m[1])),[1,4,6,10]);});
});
test('compiler comparisons isolate workgroup, private arrays, limits and unused full source',()=>{
 assert.equal(traceCompileVariant(original,'current').code,original);
 assert.equal(traceCompileVariant(original,'default-limits').code,original);
 assert.equal(traceCompileVariant(original,'host-prefix').code,original);
 assert.equal(traceCompileVariant(original,'full-control').entryPoint,'compileControl');
 assert.equal(traceCompileVariant(original,'workgroup-4').mediumSlots,16);
 assert.equal(traceCompileVariant(original,'compact-media').workgroup,8);
 assert.equal(traceCompileVariant(original,'compat').mediumSlots,10);
 assert.throws(()=>traceCompileVariant(original,'unknown'));
});
test('reject changed contracts, shared workgroup state and corrected transport',()=>{
 assert.throws(()=>traceCompatibility(original,{mediumSlots:6}));
 assert.throws(()=>traceCompatibility(original+'\nvar<workgroup> shared:u32;'));
 assert.throws(()=>traceCompatibility(original+'\nstruct CameraMedium { value:u32 }'));
 assert.throws(()=>traceCompatibility(original.replace('@workgroup_size(8,8)','@workgroup_size(2,2)')));
});
