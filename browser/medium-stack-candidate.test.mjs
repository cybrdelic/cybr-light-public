import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {rendererOptions} from './renderer-options.mjs';
import {buildRendererShader} from './renderer-shaders.mjs';
import {mediumStackCandidate,mediumCandidateCases} from './medium-stack-candidate.mjs';
const parameters=new URLSearchParams('scene=proof-optics&glass=split&motion=bilinear');
const load=name=>readFile(new URL(name,import.meta.url),'utf8');
const source=await buildRendererShader('trace',{parameters,options:rendererOptions(parameters),load});
const hash=code=>createHash('sha256').update(code).digest('hex'),sourceSha256=hash(source);
const receipt=JSON.parse(await readFile(new URL('../docs/MEDIUM_STACK_VALIDATION.json',import.meta.url),'utf8'));
test('phone candidate bytes match all-flags CPU type validation and preserve the original capacity/workgroup',()=>{
 for(const name of mediumCandidateCases){
  const candidate=mediumStackCandidate(source,name,{sourceSha256}),record=receipt.modules.find(item=>item.name===name);
  assert.equal(hash(candidate.code),record.sha256);assert.equal(Buffer.byteLength(candidate.code),record.bytes);
  assert.equal(candidate.mediumSlots,16);assert.equal(candidate.workgroup,8);assert.equal(candidate.compileOnly,true);
  assert.match(candidate.code,/values:array<vec4f,16>/);assert.doesNotMatch(candidate.code,/\b(?:mediumTarget|commitMedium|mediumExitSlot)\(/);
 }
});
test('full trace candidate is byte-identical to the actual renderer selected with mediumStack=inline',async()=>{
 parameters.set('mediumStack','inline');
 const actual=await buildRendererShader('trace',{parameters,options:rendererOptions(parameters),load});
 assert.equal(actual,mediumStackCandidate(source,'current-inline',{sourceSha256}).code);
 parameters.delete('mediumStack');assert.equal(hash(await buildRendererShader('trace',{parameters,options:rendererOptions(parameters),load})),sourceSha256);
});
test('unknown cases and changed baseline refuse candidate creation; original failing source is never a candidate case',()=>{
 assert.deepEqual(mediumCandidateCases,['medium-inline','current-inline']);
 assert.throws(()=>mediumStackCandidate(source,'medium',{sourceSha256}),/Unknown/);
 assert.throws(()=>mediumStackCandidate(source,'current-inline',{sourceSha256:'changed'}),/baseline changed/);
});
