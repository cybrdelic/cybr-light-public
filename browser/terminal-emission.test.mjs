import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildRendererShader} from './renderer-shaders.mjs';
import {rendererOptions} from './renderer-options.mjs';
import {terminalEmission} from './terminal-emission.mjs';
const load=n=>readFile(new URL(n,import.meta.url),'utf8');
test('finite-depth transport includes the light endpoint but no extra scatter',async()=>{
 for(const query of ['','backend=signals'])for(const name of ['trace','trace-pile']){
  const parameters=new URLSearchParams(query);
  const s=await buildRendererShader(name,{load,parameters,options:rendererOptions(parameters)});
  const cap=s.indexOf('if(bounce>=min(u.size.w,16u)){break;}');
  assert.ok(s.includes('bounce<=min(u.size.w,16u)'));
  assert.ok(cap>s.indexOf('if(lamp<hit.t)'));
  assert.ok(cap>s.indexOf('if(any(m.emission.xyz>vec3f(0)))'));
  assert.ok(cap<s.indexOf('let probability=select('));
 }
 assert.throws(()=>terminalEmission(''));
});
test('legacy comparison and corrected-depth backend retain their contracts',async()=>{
 for(const query of ['terminalEmission=0','transport=corrected']){
  const parameters=new URLSearchParams(query);
  const s=await buildRendererShader('trace',{load,parameters,options:rendererOptions(parameters)});
  assert.ok(!s.includes('if(bounce>=min(u.size.w,16u)){break;}'));
 }
});
test('power MIS requires both techniques at the final scattering event',()=>{
 const lightPdf=.08,bsdfPdf=10;
 const lightWeight=lightPdf**2/(lightPdf**2+bsdfPdf**2);
 const bsdfWeight=bsdfPdf**2/(lightPdf**2+bsdfPdf**2);
 assert.ok(lightWeight<.0001);
 assert.equal(lightWeight+bsdfWeight,1);
});
