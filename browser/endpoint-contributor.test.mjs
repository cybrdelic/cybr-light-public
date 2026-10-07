import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {endpointCacheShader,endpointPublish,endpointReconstruct} from './endpoint-cache.mjs';
import {contributorTrace,contributorResolve,contributorReconstruct} from './contributor-coverage.mjs';
import {gameShader} from './game-shader.mjs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('endpoint cache uses existing arena, fresh specular and reference bypass',()=>{
 const code=endpointCacheShader(gameShader('trace',read('experimental-signals/signals.wgsl')+read('experimental-signals/trace.wgsl')));
 assert.match(code,/u.flags.y>.5\|\|u.size.z<8u/);assert.match(code,/u.size.z%4u==0u/);
 assert.match(code,/endpointSpecularOnly\)\{return vec4f\(spec,d\*g\/\(4.\*nv\)\)/);
 assert.ok(!code.includes('@binding(9)'));assert.match(endpointPublish,/p.specularMoments.w!=0./);
});
test('contributor reference keeps random camera sampling and bypasses presentation history',()=>{
 const code=contributorTrace(read('trace.wgsl'));
 assert.match(code,/coverageEligible=u.flags.y<.5/);assert.match(code,/select\(randomJitter,coverageJitter\(u.size.z\),coverageEligible\)/);
 for(const separate of [false,true]){const r=contributorResolve(separate);assert.match(r,/u.flags.y>.5\|\|u.features.w<.5/);assert.match(r,/if\(overflow\)/);assert.match(r,/optical\|\|p.normal.w<=.55/);assert.match(r,/distance\(old.albedo.rgb,albedo.rgb\)>.01/);}
 const r=contributorReconstruct(read('experimental-signals/reconstruct.wgsl'),true);assert.match(r,/history=readSignal\(previous\[i\],channel\)/);
});
test('transforms fail closed on source contract drift',()=>{assert.throws(()=>endpointCacheShader(''));assert.throws(()=>contributorTrace(''));});
test('screen-cache source avoids the rejected diffuse clamp and retains specular clipping',()=>{
 const r=endpointReconstruct(gameShader('reconstruct',read('experimental-signals/signals.wgsl')+read('experimental-signals/reconstruct.wgsl')));
 assert.match(r,/channel==0u\|\|channel==3u/);assert.match(r,/if\(!stableAlbedo\)/);assert.match(r,/old.secondaryNormal.w>=-.5/);
});
test('ground ID -2 is valid, sky ID -1 is rejected',()=>{
 assert.match(endpointPublish,/p.position.w==-1./);
 assert.match(contributorResolve(false),/p.position.w==-1./);
 assert.ok(!contributorResolve(false).includes('p.position.w<0.'));
});
