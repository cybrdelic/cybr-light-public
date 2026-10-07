import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {scalarMediumStack} from './medium-stack-scalar.mjs';
import {buildRendererShader} from './renderer-shaders.mjs';
import {rendererOptions} from './renderer-options.mjs';
const raw=await readFile(new URL('./trace.wgsl',import.meta.url),'utf8'),prefix=raw.slice(0,raw.indexOf('@group'));
function body(text,name){const start=text.indexOf('fn '+name+'('),open=text.indexOf('{',start);let depth=1,end=open+1;for(;depth;end++){if(text[end]==='{')depth++;if(text[end]==='}')depth--;}return text.slice(open+1,end-1);}
function cpu(text,parameters,bindings={}){
 const js=text.replace(/\(\*stack\)\./g,'stack.').replace(/\(\*s\)\./g,'s.')
  .replace(/all\((stack\.ids\[[^\]]+\]|[A-Za-z_]\w*)==([^()]+)\)/g,'equalKey($1,$2)')
  .replace(/(stack\.ids\[[^\]]+\])==([\w]+)/g,'equalKey($1,$2)')
  .replace(/\bvar\s+(\w+)\s*:\s*(u32|vec2u|vec4f)\s*;/g,(_,name,type)=>`let ${name}=${type==='u32'?'0':type==='vec2u'?'vec2u(0)':'vec4f(0)'};`)
  .replace(/\bvar\b/g,'let').replace(/\b(\d+)u\b/g,'$1');
 const vec4f=(...v)=>v.length===1?Array(4).fill(v[0]):v,vec2u=(...v)=>v.length===1?Array(2).fill(v[0]):v;
 const equalKey=(a,b)=>Array.isArray(a)?a.length===b.length&&a.every((v,i)=>v===b[i]):a===b;
 return Function(...Object.keys(bindings),'vec4f','vec2u','equalKey','return function('+parameters.join(',')+'){'+js+'}')(...Object.values(bindings),vec4f,vec2u,equalKey);
}
const stack=vector=>({count:0,ids:Array.from({length:16},()=>vector?[0,0]:0),values:Array.from({length:16},()=>[0,0,0,0])});
function operations(vector=false){
 const source=vector?prefix.replace('ids:array<u32,16>','ids:array<vec2u,16>').replaceAll('boundary:u32','boundary:vec2u').replace('if((*stack).ids[s]==boundary)','if(all((*stack).ids[s]==boundary))'):prefix;
 const parameters=['stack','boundary','entering','inside'],exit=cpu(body(source,'mediumExitSlot'),['stack','boundary']);
 const original={target:cpu(body(source,'mediumTarget'),parameters,{mediumExitSlot:exit}),commit:cpu(body(source,'commitMedium'),parameters,{mediumExitSlot:exit})};
 const setup='var stack:MediumStack;stack.count=initialCount;'+Array.from({length:16},(_,i)=>`stack.ids[${i}]=inputIds[${i}];stack.values[${i}]=inputValues[${i}];`).join('');
 const capture='capture(stack.count,'+Array.from({length:16},(_,i)=>`stack.ids[${i}],stack.values[${i}]`).join(',')+')';
 const fixture=source+`\nfn targetFixture(){${setup}let result=mediumTarget(&stack,boundary,entering,inside);return result;}\nfn commitFixture(){${setup}commitMedium(&stack,boundary,entering,inside);return ${capture};}`;
 const transformed=scalarMediumStack(fixture);
 const captureState=(count,...pairs)=>({count,ids:pairs.filter((_,i)=>i%2===0),values:pairs.filter((_,i)=>i%2===1)});
 const args=['initialCount','inputIds','inputValues','boundary','entering','inside'];
 const target=cpu(body(transformed.code,'targetFixture'),args),commit=cpu(body(transformed.code,'commitFixture'),args,{capture:captureState});
 return {original,candidate:{target:(s,b,e,v)=>target(s.count,s.ids,s.values,b,e,v),commit:(s,b,e,v)=>Object.assign(s,commit(s.count,s.ids,s.values,b,e,v))},transformed};
}
function compare(steps,vector=false){const {original,candidate}=operations(vector),a=stack(vector),b=stack(vector);for(const [boundary,entering,inside=[0,0,0,1]] of steps){assert.deepEqual(candidate.target(b,boundary,entering,inside),original.target(a,boundary,entering,inside));original.commit(a,boundary,entering,inside);candidate.commit(b,boundary,entering,inside);assert.deepEqual(b,a);}return a;}
test('actual generated scalar operations preserve nested, non-top, duplicate and unmatched exits',()=>{
 const glass=[.125,.25,.5,1.5],water=[.5,.0625,0,Math.fround(1.333)];
 compare([[77,false],[7,true,glass],[9,true,water],[7,false],[9,false],[99,false]]);
 compare([[7,true,glass],[7,true,water],[7,false],[7,false]]);
});
test('all sixteen slots and trailing values preserve exact compaction state',()=>{
 const steps=Array.from({length:16},(_,i)=>[i+1,true,[i/32,i/16,i/8,1+i/16].map(Math.fround)]);
 steps.push(...Array.from({length:16},(_,i)=>[i+1,false]));assert.equal(compare(steps).count,0);
});
test('unpacked two-word boundary keys distinguish instances exactly',()=>{compare([[[7,1000000],true,[0,0,0,1.5]],[[7,1000001],true,[0,0,0,1.333]],[[7,1000000],false],[[7,1000001],false]],true);});
test('8192 adversarial original-WGSL versus actual generated scalar operations preserve every slot',()=>{
 let seed=0x19a743b;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 for(const vector of [false,true]){const {original,candidate}=operations(vector),a=stack(vector),b=stack(vector);for(let i=0;i<4096;i++){
  const entering=a.count===0||a.count<16&&(random()&3)!==0,key=vector?[random()%7,random()%3]:random()%7;
  const value=[random()/2**32,random()/2**32,random()/2**32,1+random()/2**32].map(Math.fround);
  assert.deepEqual(candidate.target(b,key,entering,value),original.target(a,key,entering,value));original.commit(a,key,entering,value);candidate.commit(b,key,entering,value);assert.deepEqual(b,a,'step '+i);
 }}
});
test('generated medium has no aggregate, private arrays, pointer helpers or loop-dependent accesses',()=>{
 for(const vector of [false,true]){const {transformed}=operations(vector);assert.equal(transformed.mediumSlots,16);assert.equal(transformed.privateMediumArrays,0);assert.equal(transformed.dynamicMediumAccesses,0);assert.doesNotMatch(transformed.code,/MediumStack|\.ids\[|\.values\[|\bcybrMediumFlat\w*\s*\[/);}
});
test('changed contracts, reduced capacity and repeated application fail explicitly',()=>{
 assert.throws(()=>scalarMediumStack(raw.replace('count--;','count-=2u;')),/contract changed/);
 assert.throws(()=>scalarMediumStack(raw.replace('values:array<vec4f,16>','values:array<vec4f,10>')),/16-slot/);
 assert.throws(()=>scalarMediumStack(scalarMediumStack(raw).code),/already applied/);
});
test('actual camera initialization preserves all 0..16 slot counts and unchanged trailing slots, scalar and two-word keys',async()=>{
 const load=name=>readFile(new URL('./'+name,import.meta.url),'utf8');
 for(const vector of [false,true])for(const outside of [false,true]){
  const parameters=new URLSearchParams('transport=corrected');
  const source=await buildRendererShader((outside?'outside-':'')+(vector?'trace-pile':'trace'),{load,parameters,options:rendererOptions(parameters)});
  const initialize=cpu(body(source,'initializeCameraStack'),['s','cameraMedium']);
  const setup='var stack:MediumStack;stack.count=initialCount;'+Array.from({length:16},(_,i)=>`stack.ids[${i}]=inputIds[${i}];stack.values[${i}]=inputValues[${i}];`).join('');
  const capture='capture(stack.count,'+Array.from({length:16},(_,i)=>`stack.ids[${i}],stack.values[${i}]`).join(',')+')';
  const fixture=source+`\nfn cameraFixture(){${setup}initializeCameraStack(&stack);return ${capture};}`;
  const candidate=scalarMediumStack(fixture);
  const captureState=(count,...pairs)=>({count,ids:pairs.filter((_,i)=>i%2===0),values:pairs.filter((_,i)=>i%2===1)});
  const run=cpu(body(candidate.code,'cameraFixture'),['initialCount','inputIds','inputValues','cameraMedium'],{capture:captureState});
  for(let count=0;count<=16;count++){
   const a=stack(vector);a.count=16;a.ids=a.ids.map((_,i)=>vector?[i+300,400]:i+300);a.values=a.values.map((_,i)=>[i+.5,-0,i+.75,1+i/16]);
   const camera={info:{x:count},ids:Array.from({length:16},(_,i)=>({x:i+1,0:i+1,1:i+1000000})),values:Array.from({length:16},(_,i)=>[i/32,i/16,i/8,1+i/16])};
   if(vector)camera.ids=camera.ids.map(v=>[v[0],v[1]]);
   const b=run(a.count,a.ids,a.values,camera);initialize(a,camera);assert.deepEqual(b,a,`${vector?'vector':'scalar'} ${outside?'outside':'inside'} count=${count}`);
  }
 }
});

test('public builder exports exactly the thirteen CPU-validated scalar matrix modules',async()=>{
 const {scalarMediumModules}=await import('../tools/export_scalar_medium.mjs');
 const {createHash}=await import('node:crypto');
 const receipt=JSON.parse(await readFile(new URL('../docs/SCALAR_MEDIUM_VALIDATION.json',import.meta.url),'utf8'));
 const modules=await scalarMediumModules();
 assert.equal(modules.length,13);
 for(const module of modules){
  const expected=receipt.modules.find(item=>item.name===module.name);
  assert.ok(expected,module.name);
  assert.equal(Buffer.byteLength(module.code),expected.bytes,module.name);
  assert.equal(createHash('sha256').update(module.code).digest('hex'),expected.sha256,module.name);
 }
});
test('normal Adreno selection builds the exact desktop-validated scalar trace and retains legacy rollback',async()=>{
 const {selectMediumStackMode}=await import('./medium-stack-policy.mjs');
 const {createHash}=await import('node:crypto');
 const receipt=JSON.parse(await readFile(new URL('../docs/SCALAR_MEDIUM_VALIDATION.json',import.meta.url),'utf8'));
 const load=name=>readFile(new URL('./'+name,import.meta.url),'utf8');
 for(const requested of [null,'legacy','inline']){
  const selection=selectMediumStackMode({info:{vendor:'qualcomm',architecture:'adreno-8xx'}},requested);
  const parameters=new URLSearchParams('scene=proof-optics&glass=split&motion=bilinear');
  parameters.set('mediumStack',selection.mode);
  const code=await buildRendererShader('trace',{load,parameters,options:rendererOptions(parameters)});
  const name=selection.mode==='legacy'?'current-original':'current-'+selection.mode;
  assert.equal(createHash('sha256').update(code).digest('hex'),receipt.modules.find(item=>item.name===name).sha256);
  assert.equal(selection.mediumSlots,16);assert.equal(selection.physicalAdrenoVerified,false);
 }
});
