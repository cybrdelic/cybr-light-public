import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {rendererOptions} from './renderer-options.mjs';
import {buildRendererShader} from './renderer-shaders.mjs';
const load=n=>readFile(new URL(n,import.meta.url),'utf8');
test('single coverage owns presentation without allocating four lighting signals',()=>{
 const o=rendererOptions(new URLSearchParams('reconstruction=coverage-single&aa=adaptive&cache=screen'));
 assert.equal(o.coverageReconstruction,true);assert.equal(o.separateSignals,false);
 assert.equal(o.fusedCoverageFilter,false);assert.equal(o.adaptiveAA,false);assert.equal(o.screenCacheEnabled,false);
 assert.equal(o.pixelBytes,96);assert.equal(o.signalCount,1);
 assert.equal(rendererOptions(new URLSearchParams()).coverageReconstruction,true);
 assert.equal(rendererOptions(new URLSearchParams('reconstruction=baseline')).coverageReconstruction,false);
 for(const query of ['optics=paths','aa=adaptive','backend=signals','cache=screen','transport=corrected'])
  assert.equal(rendererOptions(new URLSearchParams(query)).coverageReconstruction,false);
});
test('single presentation ABI and optical rejection preserve transport independence',async()=>{
 const parameters=new URLSearchParams('reconstruction=coverage-single');
 const options=rendererOptions(parameters);
 const s=await buildRendererShader('coverage-resolve',{load,parameters,options});
 assert.ok(!s.includes('modulation'));assert.ok(!s.includes('specularMoments'));
 assert.ok(s.includes('if(glass||reflection){valid=false;}'));
 assert.ok(s.includes('let weight=min(max(u.features.y-1.,0.),511.);'));
 assert.ok(s.includes('(now+history[i].rgb*weight)/(weight+1.)'));
 assert.ok(s.indexOf('if(u.flags.x<.5)')<s.indexOf('var guide=current[i]'));
 assert.ok(s.indexOf('if(u.flags.y>.5||u.features.z<.5)')<s.indexOf('if(u.flags.x<.5)'));
 assert.ok(s.includes('project(guide.position.xyz).xy'));
 assert.ok(s.includes('oldGuideSample-coverageJitter(u.size.z-1u)'));
 assert.ok(s.includes('@binding(5) var<storage,read_write> output'));
 for(const name of ['trace','trace-pile','reconstruct']){
  const code=await buildRendererShader(name,{load,parameters,options});
  assert.ok(!code.includes('readSignal('));assert.ok(!code.includes('modulation['));
 }
 const t=await buildRendererShader('trace',{load,parameters,options});
 assert.equal((t.match(/var reflected=reflect\(guideDirection,n\)/g)||[]).length,1);
});
