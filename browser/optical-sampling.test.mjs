import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {opticalSampling,tracePassTiming} from './optical-sampling.mjs';
import {rendererOptions} from './renderer-options.mjs';
import {buildRendererShader} from './renderer-shaders.mjs';
const load=n=>readFile(new URL(n,import.meta.url),'utf8');
test('selective paths retain one independent reference path and matching coverage',async()=>{
 for(const name of ['trace','trace-pile']){
  const parameters=new URLSearchParams('opticalSamples=2');
  const s=await buildRendererShader('optical-'+name,{load,parameters,options:rendererOptions(parameters)});
  assert.equal((s.match(/@compute/g)||[]).length,1);
  assert.ok(s.includes('u.flags.y<.5&&samples[index].normal.w<.3&&samples[index].moments.w!=0.'));
  assert.ok(s.includes('pathSample(gid,0x9e3779b9u)'));
  assert.ok(s.includes('coverageJitter(u.size.z)'));
  assert.ok(s.includes('(p.color.rgb+second)*.5'));
  assert.ok(s.includes('p.moments=vec4f(l,l*l,p.moments.zw)'));
 }
 assert.throws(()=>opticalSampling(''));
});
test('enabling the optional optical pass does not change the main tracing shader',async()=>{
 const make=async query=>{const parameters=new URLSearchParams(query);return buildRendererShader('trace',{load,parameters,options:rendererOptions(parameters)});};
 assert.equal(await make(''),await make('opticalSamples=2'));
});
test('split trace timestamps never submit an empty descriptor',()=>{
 const querySet={};
 assert.equal(tracePassTiming(null,false,false),undefined);
 assert.equal(tracePassTiming(querySet,true,true),undefined);
 assert.deepEqual(tracePassTiming(querySet,false,true),{querySet,beginningOfPassWriteIndex:0});
 assert.deepEqual(tracePassTiming(querySet,true,false),{querySet,endOfPassWriteIndex:1});
 assert.deepEqual(tracePassTiming(querySet,false,false),{querySet,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1});
});
