import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {rendererOptions} from './renderer-options.mjs';
import {buildRendererShader} from './renderer-shaders.mjs';
import {traceCompileProbe,traceProbeCases,traceProbeSourceSha256} from './trace-compile-probes.mjs';

const parameters=new URLSearchParams('scene=proof-optics&glass=split&motion=bilinear');
const source=await buildRendererShader('trace',{parameters,options:rendererOptions(parameters),load:name=>readFile(new URL(name,import.meta.url),'utf8')});
const hash=code=>createHash('sha256').update(code).digest('hex');
const receipt=JSON.parse(await readFile(new URL('../docs/TRACE_PROBE_VALIDATION.json',import.meta.url),'utf8'));

test('probe baseline is the exact trace reproduced on physical Adreno',()=>{
 assert.equal(hash(source),traceProbeSourceSha256);assert.equal(Buffer.byteLength(source),24033);
});
test('every browser probe matches its CPU type-validated module and preserves the original main',()=>{
 for(const name of traceProbeCases){
  const probe=traceCompileProbe(source,name,{sourceSha256:hash(source)}),record=receipt.probes.find(record=>record.name===name);
  assert.ok(probe.code.startsWith(source));assert.equal(hash(probe.code),record.sha256);assert.equal(Buffer.byteLength(probe.code),record.bytes);
  assert.equal(probe.code.match(/\bfn\s+main\(/g).length,1);assert.notEqual(probe.entryPoint,'main');assert.equal(probe.entryPoint,record.entryPoint);
  assert.equal(probe.workgroup,8);assert.equal(probe.compileOnly,true);
 }
});
test('unknown probes and changed baselines are rejected before shader creation',()=>{
 assert.throws(()=>traceCompileProbe(source,'current',{sourceSha256:hash(source)}),/Unknown trace compile probe/);
 assert.throws(()=>traceCompileProbe(source,'traversal',{sourceSha256:'changed'}),/baseline changed/);
});
test('probe family excludes all original comparisons and preserves helper capacities',()=>{
 assert.deepEqual(traceProbeCases,['probe-control-8','binding-abi','traversal','medium']);
 assert.match(traceCompileProbe(source,'traversal',{sourceSha256:hash(source)}).code,/var stack:array<u32,64>/);
 assert.match(traceCompileProbe(source,'medium',{sourceSha256:hash(source)}).code,/values:array<vec4f,16>/);
 assert.equal(receipt.gpuUsed,false);assert.equal(receipt.physicalProbeResult,'not yet run');
});
