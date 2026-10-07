import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {tiledFilter,baselineTileBytes} from './tiled-filter.mjs';
test('baseline tile budget and exact neighbour-only replacement',async()=>{
 const source=await readFile(new URL('filter.wgsl',import.meta.url),'utf8');
 for(const step of [1,2,4]){
  const s=tiledFilter(source,{step});
  assert.equal(baselineTileBytes(step),(8+4*step)**2*48);
  assert.ok(s.includes('tileRadiance[t]=input[j]'));
  assert.ok(s.includes('luminance(tileRadiance[ti].rgb)'));
  assert.ok(s.indexOf('workgroupBarrier();')<s.indexOf('if(any(gid.xy>=config.xy))'));
  assert.ok(!s.slice(s.indexOf('var sum=vec3f(0);')).includes('input[j]'));
 }
 assert.throws(()=>baselineTileBytes(3),/Invalid/);
});
