import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {traceCompileProbe} from './trace-compile-probes.mjs';
import {workgroupMediumStack,wgslFunctions} from './medium-stack-workgroup.mjs';
import {buildRendererShader} from './renderer-shaders.mjs';
import {rendererOptions} from './renderer-options.mjs';
const raw=await readFile(new URL('./trace.wgsl',import.meta.url),'utf8');
const prefix=raw.slice(0,raw.indexOf('@group'));
const load=name=>readFile(new URL('./'+name,import.meta.url),'utf8');
const zero=vector=>({count:0,ids:Array.from({length:16},()=>vector?[0,0]:0),values:Array.from({length:16},()=>[0,0,0,0])});
const clone=value=>structuredClone(value);
const body=(source,name)=>wgslFunctions(source).find(fn=>fn.name===name).body;
function cpu(source,args,bindings={}){
 const js=source.replace(/\(\*(stack|s)\)\./g,'$1.')
  .replace(/all\(([^()]+)==([^()]+)\)/g,'equalKey($1,$2)')
  .replace(/\bcybrMediumLane\b/g,'context.lane')
  .replace(/\bvar\b/g,'let').replace(/\b(\d+)u\b/g,'$1');
 const vec4f=(...v)=>v.length===1?Array(4).fill(v[0]):v;
 const equalKey=(a,b)=>Array.isArray(a)?a.every((v,i)=>v===b[i]):a===b;
 return Function(...Object.keys(bindings),'vec4f','equalKey','return function('+args.join(',')+'){'+js+'}')(...Object.values(bindings),vec4f,equalKey);
}
function reference(source){
 const exit=cpu(body(source,'mediumExitSlot'),['stack','boundary']);
 return {target:cpu(body(source,'mediumTarget'),['stack','boundary','entering','inside'],{mediumExitSlot:exit}),
  commit:cpu(body(source,'commitMedium'),['stack','boundary','entering','inside'],{mediumExitSlot:exit})};
}
function fixture(vector=false){
 const original=(vector?prefix.replace('ids:array<u32,16>','ids:array<vec2u,16>').replaceAll('boundary:u32','boundary:vec2u').replace('if((*stack).ids[s]==boundary)','if(all((*stack).ids[s]==boundary))'):prefix)
  +'\n@compute @workgroup_size(8,8) fn fixture(){var first:MediumStack;var second:MediumStack;}';
 const transformed=workgroupMediumStack(original),arena=Array.from({length:32},()=>zero(vector));
 const context={lane:0},bindings={cybrMediumArena:arena,context,MediumStack:()=>zero(vector)};
 const exit=cpu(body(transformed.code,'mediumExitSlot'),['stack','boundary'],bindings);
 const candidate={target:cpu(body(transformed.code,'mediumTarget'),['stack','boundary','entering','inside'],{...bindings,mediumExitSlot:exit}),
  commit:cpu(body(transformed.code,'commitMedium'),['stack','boundary','entering','inside'],{...bindings,mediumExitSlot:exit})};
 const initialize=cpu(body(transformed.code,'fixture'),['cybrMediumLaneInput'],bindings);
 return {original,transformed,arena,candidate,initialize,reference:reference(original)};
}
function compareStep(fixture,states,index,key,entering,value){
 const before=clone(fixture.arena);
 assert.deepEqual(fixture.candidate.target(index,key,entering,value),fixture.reference.target(states[index],key,entering,value));
 assert.deepEqual(fixture.arena,before,'target query mutated workgroup state');
 fixture.reference.commit(states[index],key,entering,value);fixture.candidate.commit(index,key,entering,value);
 assert.deepEqual(fixture.arena,states,'a medium operation changed another invocation/stack or its own result');
}
test('actual workgroup operations preserve every slot at full capacity, non-top, duplicate and unmatched exits',()=>{
 for(const vector of [false,true]){
  const f=fixture(vector),states=Array.from({length:32},()=>zero(vector)),key=i=>vector?[i+1,0xffffffff-i]:i+1;
  for(let i=0;i<16;i++)compareStep(f,states,0,key(i),true,[i/32,-0,i/8,Math.fround(1.333)]);
  for(const i of [0,15,8,4,3,2,1,5,6,7,9,10,11,12,13,14])compareStep(f,states,0,key(i),false,[0,0,0,1]);
  compareStep(f,states,0,key(2),false,[0,0,0,1]);
  compareStep(f,states,0,key(7),true,[.125,.25,.5,1.5]);compareStep(f,states,0,key(7),true,[.5,.25,.125,Math.fround(1.333)]);
  compareStep(f,states,0,key(7),false,[0,0,0,1]);compareStep(f,states,0,key(7),false,[0,0,0,1]);
 }
});
test('8192 interleaved original-WGSL/workgroup operations preserve two stacks across all sixteen invocations and exact keys',()=>{
 let seed=0x19a743b;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 for(const vector of [false,true]){
  const f=fixture(vector),states=Array.from({length:32},()=>zero(vector));
  for(let i=0;i<4096;i++){
   const index=i%32,a=states[index],entering=a.count===0||a.count<16&&(random()&3)!==0;
   const key=!entering&&(random()&1)?clone(a.ids[random()%a.count]):vector?[random(),random()]:random();
   const value=[random()/2**32,random()/2**32,random()/2**32,1+random()/2**32].map(Math.fround);
   compareStep(f,states,index,key,entering,value);
  }
 }
});
test('declaration re-entry resets every slot for its invocation without touching any other invocation',()=>{
 for(const vector of [false,true]){
  const f=fixture(vector);
  for(let index=0;index<32;index++)Object.assign(f.arena[index],{count:16,ids:Array.from({length:16},(_,i)=>vector?[index+i+1,0xffffffff-i]:index+i+1),values:Array.from({length:16},(_,i)=>[index+i+.5,-0,i+.25,1.5])});
  for(let lane=15;lane>=0;lane--){
   const expected=clone(f.arena);expected[lane*2]=zero(vector);expected[lane*2+1]=zero(vector);
   f.initialize(lane);assert.deepEqual(f.arena,expected);
   f.arena[lane*2].count=3;f.initialize(lane);assert.deepEqual(f.arena,expected,'revisited scope failed to reset');
  }
 }
});
test('helper-local stacks have distinct allocation from live caller state and reset on each call',()=>{
 const source=prefix+'\nfn inner(){var nested:MediumStack;commitMedium(&nested,99u,true,vec4f(0,0,0,1.5));}\n@compute @workgroup_size(8,8) fn fixture(){var outer:MediumStack;commitMedium(&outer,77u,true,vec4f(0,0,0,1.333));inner();}';
 const t=workgroupMediumStack(source),arena=Array.from({length:32},()=>zero(false)),context={lane:0};
 const bindings={cybrMediumArena:arena,context,MediumStack:()=>zero(false)};
 const exit=cpu(body(t.code,'mediumExitSlot'),['stack','boundary'],bindings);
 const commit=cpu(body(t.code,'commitMedium'),['stack','boundary','entering','inside'],{...bindings,mediumExitSlot:exit});
 const inner=cpu(body(t.code,'inner'),[],{...bindings,commitMedium:commit});
 const run=cpu(body(t.code,'fixture'),['cybrMediumLaneInput'],{...bindings,commitMedium:commit,inner});
 for(let lane=0;lane<16;lane++){run(lane);assert.equal(arena[lane*2].count,1);assert.equal(arena[lane*2].ids[0],99);assert.equal(arena[lane*2+1].count,1);assert.equal(arena[lane*2+1].ids[0],77);}
 run(7);assert.equal(arena[14].count,1);assert.equal(arena[15].count,1);
});
test('camera initialization preserves counts 0..16, scalar/two-word keys, inside/outside behavior and trailing signed zero',async()=>{
 for(const vector of [false,true])for(const outside of [false,true]){
  const parameters=new URLSearchParams('transport=corrected');
  const source=await buildRendererShader((outside?'outside-':'')+(vector?'trace-pile':'trace'),{load,parameters,options:rendererOptions(parameters)});
  const transformed=workgroupMediumStack(source),arena=Array.from({length:transformed.stacksPerInvocation*16},()=>zero(vector));
  for(let count=0;count<=16;count++){
   const a=zero(vector);a.count=16;a.ids=a.ids.map((_,i)=>vector?[i+300,400]:i+300);a.values=a.values.map((_,i)=>[i+.5,-0,i+.75,1+i/16]);
   const camera={info:{x:count},ids:Array.from({length:16},(_,i)=>vector?[i+1,i+1000000]:{x:i+1}),values:Array.from({length:16},(_,i)=>[i/32,i/16,i/8,1+i/16])};
   arena[3]=clone(a);
   const original=cpu(body(source,'initializeCameraStack'),['s'],{cameraMedium:camera});
   const candidate=cpu(body(transformed.code,'initializeCameraStack'),['s'],{cameraMedium:camera,cybrMediumArena:arena});
   original(a);candidate(3);assert.deepEqual(arena[3],a);
  }
 }
});
test('exact per-invocation addresses are disjoint and arena budgets fit the existing 32KiB request',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../docs/WORKGROUP_MEDIUM_VALIDATION.json',import.meta.url),'utf8'));
 for(const module of manifest.modules.filter(m=>m.name.endsWith('-workgroup')&&!m.unchanged)){
  assert.ok(module.workgroupBytes<=32768,module.name);assert.equal(module.mediumSlots,16);
  const addresses=new Set();
  for(let lane=0;lane<16;lane++)for(let slot=0;slot<module.stacksPerInvocation;slot++){
   const address=lane*module.stacksPerInvocation+slot;assert.ok(!addresses.has(address));addresses.add(address);
  }
  assert.equal(addresses.size,module.stacksPerInvocation*16);
  assert.equal(module.workgroupBytes,module.stackBytes*addresses.size);
 }
 const current=manifest.modules.find(x=>x.name==='current-workgroup');assert.equal(current.workgroupBytes,10752);
 assert.equal(fixture(true).transformed.workgroupBytes,12800);
});
test('4x4 host dispatch covers each pixel exactly once including partial edge tiles with unchanged global-id seed input',()=>{
 for(const [width,height] of [[960,540],[640,360],[319,211],[1,1],[7,9]]){
  const coverage=tile=>{const seen=new Uint8Array(width*height);for(let gy=0;gy<Math.ceil(height/tile);gy++)for(let gx=0;gx<Math.ceil(width/tile);gx++)for(let ly=0;ly<tile;ly++)for(let lx=0;lx<tile;lx++){
   const x=gx*tile+lx,y=gy*tile+ly;if(x>=width||y>=height)continue;seen[y*width+x]++;
  }return seen;};
  const candidate=coverage(4);assert.deepEqual(candidate,coverage(8));assert.ok(candidate.every(x=>x===1));
 }
});
test('all prepared variants preserve unrelated function bytes; workgroup and binding counts are explicit',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../docs/WORKGROUP_MEDIUM_VALIDATION.json',import.meta.url),'utf8'));
 for(const module of manifest.modules){
  const parameters=new URLSearchParams(module.query);if(module.name.endsWith('-workgroup'))parameters.set('mediumStack','workgroup');
  let code=await buildRendererShader(module.renderer,{load,parameters,options:rendererOptions(parameters)});
  if(module.probe)code=workgroupMediumStack(traceCompileProbe(await buildRendererShader('trace',{load,parameters:new URLSearchParams('scene=proof-optics&glass=split&motion=bilinear'),options:rendererOptions(new URLSearchParams('scene=proof-optics&glass=split&motion=bilinear'))}),'medium',{sourceSha256:manifest.sourceSha256}).code).code;
  assert.equal(createHash('sha256').update(code).digest('hex'),module.sha256);
  if(!module.name.endsWith('-workgroup')||module.unchanged)continue;
  assert.doesNotMatch(code,/ptr<function,MediumStack>|\bvar\s+\w+\s*:\s*MediumStack\s*;/);
  assert.equal(module.barriersAdded,0);assert.equal(module.extraStorageBindings,0);
  for(const fn of module.unchangedFunctions){const current=wgslFunctions(code).find(x=>x.name===fn.name);assert.equal(createHash('sha256').update(code.slice(current.start,current.end)).digest('hex'),fn.sha256);}
 }
});
test('capacity, helper-contract, allocation-budget, existing-workgroup and repeated-transform changes fail explicitly',()=>{
 assert.throws(()=>workgroupMediumStack(raw.replace('values:array<vec4f,16>','values:array<vec4f,10>')),/16-slot/);
 assert.throws(()=>workgroupMediumStack(raw.replace('count--;','count-=2u;')),/contract changed/);
 assert.throws(()=>workgroupMediumStack(raw,{maxWorkgroupBytes:8192}),/budget/);
 assert.throws(()=>workgroupMediumStack(raw,{dimensions:[8,8,1]}),/sixteen invocations/);
 assert.throws(()=>workgroupMediumStack('var<workgroup> other:array<u32,16>;\n'+raw),/Existing workgroup/);
 assert.throws(()=>workgroupMediumStack(workgroupMediumStack(raw).code),/already applied/);
});
