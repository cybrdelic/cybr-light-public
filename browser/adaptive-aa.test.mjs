import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {adaptiveAaShader,adaptiveAaResolve} from './adaptive-aa.mjs';import {instancedShader} from './instanced-shader.mjs';
const read=n=>readFileSync(new URL(n,import.meta.url),'utf8');
test('adaptive coverage preserves linear radiance and does not blur or clamp',()=>{
 const s=adaptiveAaShader(read('./trace.wgsl'));
 assert.equal((s.match(/@compute/g)||[]).length,1);
 assert.match(adaptiveAaResolve,/sum.rgb\/max\(sum.w,1.\)/);assert.match(s,/sampleIndex\*2891336453u/);
 assert.match(s,/let sampleIndex=gid.z/);assert.doesNotMatch(s,/fn samplePixel/);
 assert.match(s,/if\(u.flags.y<.5&&needsCoverage/);
 assert.match(s,/@binding\(8\).*aaHistory/);
 assert.match(s,/sampleCount==4u/);
 instancedShader(s,read('./trace-instances.wgsl'),32);
});
test('reference accumulation never rejects stochastic subpixel coverage',()=>{
 assert.match(read('./reconstruct.wgsl'),/if\(u.flags.y>\.5&&!moving&&u.size.z>0u\)\{history=previous\[i\];\}/);
});
test('shader drift fails closed',()=>assert.throws(()=>adaptiveAaShader('bad'),/contract changed/));
