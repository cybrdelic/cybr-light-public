import test from 'node:test';
import assert from 'node:assert/strict';
import {forestDetailLevels} from './forest-detail.mjs';
import {readFile} from 'node:fs/promises';
test('detail levels preserve distinct leaf masks, normals and colors',async()=>{
 const vertices=new Float32Array(60),words=new Uint32Array(vertices.buffer);
 for(let i=0;i<6;i++){vertices.set([i%3,Math.floor(i/3),i%2,0,0,1,.11,.23,.045],i*10);words[i*10+9]=i<3?1:128;}
 const levels=await forestDetailLevels(vertices,new Uint32Array([0,1,2,3,4,5]),[3,3],2);
 assert.equal(levels.length,4);
 for(const lod of levels){const index=new Uint32Array(lod.indices),v=new Float32Array(lod.vertices),w=new Uint32Array(lod.vertices);
  assert.equal(index.length,6);assert.ok(Number.isFinite(lod.error));
  const masks=[];
  for(let t=0;t<6;t+=3){const mask=w[index[t]*10+9];masks.push(mask);for(let j=0;j<3;j++){
   const at=index[t+j]*10;assert.equal(w[at+9],mask);assert.deepEqual(Array.from(v.subarray(at+3,at+9)),Array.from(vertices.subarray(3,9)));
  }}
  assert.deepEqual(masks.sort((a,b)=>a-b),[1,128]);
 }
});
test('invalid geometry layout fails before preprocessing',async()=>{
 await assert.rejects(forestDetailLevels(new Float32Array(11),new Uint32Array(3),[3],1),/layout/);
});
test('zero-error setting explicitly disables LOD and near bounds protect close detail',async()=>{
 const source=await readFile(new URL('./forest-game.wgsl',import.meta.url),'utf8');
 assert.ok(source.includes('var level=0u;'));
 assert.ok(source.includes('if(camera.settings.z>0.)'));
 assert.ok(source.includes('max(z-radius,.05)'));
});
