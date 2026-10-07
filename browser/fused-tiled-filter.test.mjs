import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {rendererOptions} from './renderer-options.mjs';
import {buildRendererShader} from './renderer-shaders.mjs';
import {fusedTiledFilter,fusedTileBytes} from './fused-tiled-filter.mjs';
test('fused tiles preserve clamped neighbourhood coordinates, including partial groups',()=>{
 const clamp=(x,n)=>Math.max(0,Math.min(n-1,x));
 for(const step of [1,2])for(const extent of [1,7,8,9,19])for(let g=0;g<Math.ceil(extent/8);g++)for(let lane=0;lane<8;lane++){
  const pixel=g*8+lane;if(pixel>=extent)continue;
  for(let offset=-2;offset<=2;offset++){
   const tile=lane+2*step+offset*step;
   assert.ok(tile>=0&&tile<8+4*step);
   assert.equal(clamp(g*8+tile-2*step,extent),clamp(pixel+offset*step,extent));
  }
 }
 assert.equal(fusedTileBytes(1),144*(96+64));
 assert.equal(fusedTileBytes(2),Infinity);
 assert.equal(fusedTileBytes(4),Infinity);
});
test('fused tiles synchronize all lanes before any boundary return and fit device budget',async()=>{
 const load=n=>readFile(new URL(n,import.meta.url),'utf8');
 for(const optics of ['guides','paths'])for(const step of [1]){
  const parameters=new URLSearchParams('optics='+optics);
  const s=await buildRendererShader('coverage-filter',{load,parameters,options:rendererOptions(parameters),filterOptions:{step}});
  assert.ok(s.indexOf('workgroupBarrier();')<s.indexOf('if(any(gid.xy>=config.xy))'));
  assert.ok(s.includes('let other=tileGeometry[ti]'));
  assert.equal(s.includes('var<workgroup> tileLight:'),step===1);
  assert.ok(fusedTileBytes(step)<=32768);
 }
 assert.throws(()=>fusedTiledFilter('',{step:4}),/budget/);
 assert.throws(()=>fusedTiledFilter('',{step:1}),/contract/);
});
