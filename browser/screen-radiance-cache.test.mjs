import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {screenRadianceCacheShader} from './screen-radiance-cache.mjs';
test('cache never replaces reference transport, first hits, glass, or final-depth samples',()=>{
 const s=screenRadianceCacheShader(readFileSync(new URL('./trace.wgsl',import.meta.url),'utf8'));
 for(const guard of ['u.flags.y>.5||u.size.z<8u','bounce>0u&&bounce+1u<u.size.w','m.physical.y<.5&&m.physical.x<.01','old.color.w<4.','old.moments.w!=0.','old.normal.w<.4','total<.99','<.99995','abs(old.position.w-surface)>.1'])assert.ok(s.includes(guard),guard);
 assert.throws(()=>screenRadianceCacheShader('bad'),/requires baseline/);
});
