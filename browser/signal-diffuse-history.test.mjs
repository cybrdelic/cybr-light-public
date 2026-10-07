import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gameShader} from './game-shader.mjs';
import {signalDiffuseHistoryShader} from './diffuse-history.mjs';
const source=name=>gameShader(name,readFileSync(new URL('./experimental-signals/signals.wgsl',import.meta.url),'utf8')+'\n'+readFileSync(new URL(`./experimental-signals/${name}.wgsl`,import.meta.url),'utf8'));
test('signal correction writes albedo after optical-guide setup, without transport/RNG edits',()=>{
 const before=source('trace'),after=signalDiffuseHistoryShader(before,'trace');
 assert.ok(after.indexOf('secondaryNormal=vec4f(gm.base.rgb*vertexColor(guide),-1.)')>after.indexOf('let tg=transmittedGuide'));
 assert.equal(after.split('random(').length,before.split('random(').length);
 assert.equal(after.slice(after.indexOf('var startDepth=0u;')),before.slice(before.indexOf('var startDepth=0u;')));
});
test('only validated rough diffuse lobes bypass clamp; shape and material guards remain',()=>{
 const after=signalDiffuseHistoryShader(source('reconstruct'),'reconstruct');
 assert.match(after,/channel==0u\|\|channel==3u/);assert.match(after,/p.normal.w>\.55/);
 assert.match(after,/if\(!stableAlbedo\)\{history.color=vec4f\(clamp/);
 assert.match(after,/distance\(p.secondaryNormal.xyz,old.secondaryNormal.xyz\)>\.01/);
 assert.throws(()=>signalDiffuseHistoryShader('changed','reconstruct'),/contract/);
});
