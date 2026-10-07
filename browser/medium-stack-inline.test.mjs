import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inlineMediumStack} from './medium-stack-inline.mjs';
import {rendererOptions} from './renderer-options.mjs';
import {buildRendererShader} from './renderer-shaders.mjs';

const load=name=>readFile(new URL(name,import.meta.url),'utf8');
const raw=await load('trace.wgsl'),prefix=raw.slice(0,raw.indexOf('@group'));
const hash=text=>createHash('sha256').update(text).digest('hex');
function body(text,name){
 const start=text.indexOf('fn '+name+'('),open=text.indexOf('{',start);let depth=1,end=open+1;
 for(;depth;end++){if(text[end]==='{')depth++;if(text[end]==='}')depth--;}
 return text.slice(open+1,end-1);
}
// This restricted CPU translator executes the actual checked-in WGSL operation
// bodies and the actual transformed snippets. It does not model GPU execution.
// Its supported subset has scalar control flow, copy-only vec4 values and keys.
function cpu(text,parameters,bindings={}){
 const js=text.replace(/\(\*stack\)\./g,'stack.')
  .replace(/all\((stack\.ids\[[^\]]+\])==([^()]+)\)/g,'equalKey($1,$2)')
  .replace(/(stack\.ids\[[^\]]+\])==([\w]+)/g,'equalKey($1,$2)')
  .replace(/\bvar\b/g,'let').replace(/\b(\d+)u\b/g,'$1')
  .replace(/\b(let\s+\w+)\s*:\s*(?:u32|vec4f)\b/g,'$1');
 const vec4f=(...values)=>values.length===1?Array(4).fill(values[0]):values;
 const equalKey=(a,b)=>Array.isArray(a)?a.length===b.length&&a.every((v,i)=>v===b[i]):a===b;
 return Function(...Object.keys(bindings),'vec4f','equalKey','return function('+parameters.join(',')+'){'+js+'}')( ...Object.values(bindings),vec4f,equalKey);
}
function operations(vector=false){
 const source=vector?prefix.replace('ids:array<u32,16>','ids:array<vec2u,16>').replaceAll('boundary:u32','boundary:vec2u').replace('if((*stack).ids[s]==boundary)','if(all((*stack).ids[s]==boundary))'):prefix;
 const parameters=['stack','boundary','entering','inside'];
 const exit=cpu(body(source,'mediumExitSlot'),['stack','boundary']);
 const original={target:cpu(body(source,'mediumTarget'),parameters,{mediumExitSlot:exit}),commit:cpu(body(source,'commitMedium'),parameters,{mediumExitSlot:exit})};
 const fixture=source+'\nfn targetFixture(){let result=mediumTarget(&stack,boundary,entering,inside);return result;}\nfn commitFixture(){commitMedium(&stack,boundary,entering,inside);}';
 const transformed=inlineMediumStack(fixture).code;
 const candidate={target:cpu(body(transformed,'targetFixture'),parameters),commit:cpu(body(transformed,'commitFixture'),parameters)};
 return {original,candidate};
}
const air=[0,0,0,1],glass=[.125,.25,.5,1.5].map(Math.fround),water=[.5,.0625,0,1.333].map(Math.fround);
const stack=vector=>({count:0,ids:Array.from({length:16},()=>vector?[0,0]:0),values:Array.from({length:16},()=>[0,0,0,0])});
const copy=value=>structuredClone(value);
function compareSequence(steps,vector=false){
 const {original,candidate}=operations(vector),a=stack(vector),b=stack(vector);
 for(const {key,entering,value=air,expected} of steps){
  const before=copy(a),target=original.target(a,key,entering,value),equivalent=candidate.target(b,key,entering,value);
  assert.deepEqual(a,before,'lookup must not mutate stack');assert.deepEqual(equivalent,target);
  if(expected)assert.deepEqual(target,expected);
  original.commit(a,key,entering,value);candidate.commit(b,key,entering,value);
  assert.deepEqual(b,a,'all sixteen slots and count match after each commit');
 }
 return a;
}
test('exact WGSL operations preserve nested glass/water IOR and absorption',()=>{
 const result=compareSequence([{key:7,entering:true,value:glass,expected:glass},{key:9,entering:true,value:water,expected:water},
  {key:9,entering:false,expected:glass},{key:7,entering:false,expected:air}]);assert.equal(result.count,0);
});
test('non-top exits retain innermost medium and remove the matching boundary',()=>{
 const result=compareSequence([{key:7,entering:true,value:glass},{key:9,entering:true,value:water},
  {key:7,entering:false,expected:water},{key:9,entering:false,expected:air}]);assert.equal(result.count,0);
});
test('duplicate boundary exit finds the final matching slot; unmatched and camera-inside exits retain the existing fallback',()=>{
 const result=compareSequence([{key:77,entering:false,expected:air},{key:7,entering:true,value:glass},
  {key:7,entering:true,value:water},{key:7,entering:false,expected:glass},{key:99,entering:false,expected:air}]);
 assert.equal(result.count,1);assert.deepEqual(result.values[0],glass);
});
test('all sixteen stack entries survive exact enter/exit order without a reduced capacity',()=>{
 const steps=Array.from({length:16},(_,i)=>({key:i+1,entering:true,value:[i/32,i/16,i/8,1+i/16].map(Math.fround)}));
 steps.push(...Array.from({length:16},(_,i)=>({key:16-i,entering:false})));
 assert.equal(compareSequence(steps).count,0);
});
test('exact two-word instanced boundary keys distinguish instances without numeric packing',()=>{
 compareSequence([{key:[7,1000000],entering:true,value:glass},{key:[7,1000001],entering:true,value:water},
  {key:[7,1000000],entering:false,expected:water},{key:[7,1000001],entering:false,expected:air}],true);
});
test('deterministic adversarial operation sequences match after every target and commit',()=>{
 let seed=0x789abcd;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 for(const vector of [false,true]){
  const {original,candidate}=operations(vector),a=stack(vector),b=stack(vector);
  for(let i=0;i<4096;i++){
   const entering=a.count===0||a.count<16&&(random()&3)!==0;
   const key=vector?[random()%7,random()%3]:random()%7,value=[random()/2**32,random()/2**32,random()/2**32,1+random()/2**32].map(Math.fround);
   assert.deepEqual(candidate.target(b,key,entering,value),original.target(a,key,entering,value));
   original.commit(a,key,entering,value);candidate.commit(b,key,entering,value);assert.deepEqual(b,a,'step '+i);
  }
 }
});
test('ordinary, signals, instanced, packed, corrected and outside paths retain their original default source and capacities',async()=>{
 for(const [name,query] of [['trace',''],['trace','backend=signals'],['trace-pile',''],['trace-meshlets',''],
  ['trace','transport=corrected'],['trace-pile','transport=corrected'],['outside-trace','transport=corrected']]){
  const parameters=new URLSearchParams(query),original=await buildRendererShader(name,{load,parameters,options:rendererOptions(parameters)});
  parameters.set('mediumStack','inline');
  const candidate=await buildRendererShader(name,{load,parameters,options:rendererOptions(parameters)});
  assert.equal(candidate,inlineMediumStack(original).code);assert.match(candidate,/values:array<vec4f,16>/);
  assert.doesNotMatch(candidate,/\b(?:mediumTarget|commitMedium|mediumExitSlot)\(/);
  parameters.delete('mediumStack');assert.equal(hash(await buildRendererShader(name,{load,parameters,options:rendererOptions(parameters)})),hash(original));
 }
});
test('changed helper bodies, reduced capacity and a second application fail explicitly',()=>{
 assert.throws(()=>inlineMediumStack(raw.replace('count--;','count-=2u;')),/contract changed/);
 assert.throws(()=>inlineMediumStack(raw.replace('values:array<vec4f,16>','values:array<vec4f,10>')),/16-slot/);
 assert.throws(()=>inlineMediumStack(inlineMediumStack(raw).code),/already applied/);
});
