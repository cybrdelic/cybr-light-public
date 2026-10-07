import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transmittedSupport} from './transmitted-support.mjs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('only rough nonmetal endpoint guides receive an exact-in-f32 albedo tag',()=>{
 const shader=transmittedSupport('trace',read('./experimental-signals/trace.wgsl'));
 assert.ok(shader.includes('m.physical.x<.001&&m.base.w>.55'));
 const maximum=2+127+128*127+16384*127;
 assert.equal(new Float32Array([maximum])[0],maximum);
 assert.ok(shader.includes('m.base.rgb*vertexColor(h)'));
});
test('secondary material, normal, plane and albedo discontinuities remain protected',()=>{
 const shader=transmittedSupport('coverage-filter',read('./coverage-filter.wgsl'));
 for(const marker of ['c.secondaryNormal.w!=other.secondaryNormal.w','abs(c.secondary.w-other.secondary.w)>.1','dot(c.secondaryNormal.xyz,other.secondaryNormal.xyz)<.98','max(.003,.005*f32(config.z))'])assert.ok(shader.includes(marker));
 assert.ok(shader.includes('viewDependent.z=false'));
 assert.ok(!shader.includes('viewDependent.x=false'));
});
test('changed trace contracts fail closed',()=>assert.throws(()=>transmittedSupport('trace','')));
