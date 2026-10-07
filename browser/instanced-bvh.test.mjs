import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildInstancedBVH,rotate} from './instanced-bvh.mjs';
import {instancedShader} from './instanced-shader.mjs';
import {createBVHCache} from './bvh-cache.mjs';

test('cached template packing preserves bytes across different TLAS layouts',()=>{
 const cache=createBVHCache();
 const build=(leaf,cached)=>{const x=fixture();return buildInstancedBVH(x.tri,x.bounds,x.centers,x.meshes,x.pile,1,leaf,cached);};
 for(const leaf of [6,1,6]){
  const expected=build(leaf),actual=build(leaf,cache);
  assert.deepEqual(actual.geometry,expected.geometry);
  assert.deepEqual(actual.attributes,expected.attributes);
  assert.deepEqual(new Uint8Array(actual.buffer),new Uint8Array(expected.buffer));
 }
 assert.equal(cache.stats().hits,2);
});

function fixture(){
  const tri=new Float32Array(36);tri.set([10,2,3,0,2,0,0,0,0,2,0,0]);
  const bounds=new Float32Array([10,2,3,12,4,3]),centers=new Float32Array([11,3,3]);
  const pile={models:[{id:'test'}],instances:[{model:0,position:[-3,1,0],rotation:[0,0,0,1]},{model:0,position:[3,1,0],rotation:[0,Math.SQRT1_2,0,Math.SQRT1_2]}]};
  return {tri,bounds,centers,pile,meshes:[{galleryId:'test',indices:{count:3}}]};
}
test('pile shares one BLAS, preserves rigid rotations and relocates leaf pointers',()=>{
  const x=fixture(),r=buildInstancedBVH(x.tri,x.bounds,x.centers,x.meshes,x.pile,1);
  assert.equal(r.geometry.length,12);assert.equal(r.instanceCount,2);assert.equal(r.representedTriangles,2);
  const f=new Float32Array(r.buffer),u=new Uint32Array(r.buffer);
  assert.equal(u[11],0x80000002);assert.equal(u[10],1);
  assert.equal(u[12+8],u[24+8]);assert.equal(u[12+8],3);
  assert.equal(u[36+10],0);assert.equal(u[36+11],1);
  for(let i=1;i<=2;i++){
    const q=Array.from(f.slice(i*12+4,i*12+8));
    const v=[.25,.5,.75],world=rotate(q,v),local=rotate([-q[0],-q[1],-q[2],q[3]],world);
    local.forEach((n,k)=>assert.ok(Math.abs(n-v[k])<1e-6));
    const p=rotate(q,Array.from(r.geometry.slice(0,3))).map((v,k)=>v+f[i*12+k]);
    p.forEach((v,k)=>assert.ok(v>=f[k]-1e-6&&v<=f[4+k]+1e-6));
  }
});
test('pile rejects invalid transforms instead of uploading NaNs',()=>{
  const x=fixture();x.pile.instances[0].position[0]=NaN;
  assert.throws(()=>buildInstancedBVH(x.tri,x.bounds,x.centers,x.meshes,x.pile,1),/Invalid pile transform/);
});

test('single-instance TLAS leaves retain geometry, stable identities and transforms',()=>{
 const build=leaf=>{const x=fixture();return buildInstancedBVH(x.tri,x.bounds,x.centers,x.meshes,x.pile,1,leaf);};
 const grouped=build(6),single=build(1);
 assert.deepEqual(single.geometry,grouped.geometry);assert.deepEqual(single.attributes,grouped.attributes);
 assert.equal(single.representedTriangles,grouped.representedTriangles);
 const records=result=>{
  const f=new Float32Array(result.buffer),u=new Uint32Array(result.buffer);
  return Array.from({length:result.instanceCount},(_,j)=>{
   const offset=(result.instanceRecordStart+j)*12;
   return {id:u[offset+9],transform:[...f.slice(offset,offset+8)]};
  }).sort((a,b)=>a.id-b.id);
 };
 assert.deepEqual(records(single),records(grouped));
 const u=new Uint32Array(single.buffer);let instances=0;
 for(let i=0;i<single.instanceRecordStart;i++)if(u[i*12+11]&0x80000000){
  assert.equal(u[i*12+11]&0x7fffffff,1);instances++;
 }
 assert.equal(instances,single.instanceCount);
});
test('forest positive uniform scale expands bounds and preserves ray distance encoding',()=>{
  const x=fixture();x.pile.instances[0].scale=2.5;
  const r=buildInstancedBVH(x.tri,x.bounds,x.centers,x.meshes,x.pile,1),f=new Float32Array(r.buffer),u=new Uint32Array(r.buffer);
  const record=Array.from({length:2},(_,i)=>r.instanceRecordStart+i).find(i=>u[i*12+9]===1);
  const q=Array.from(f.slice(record*12+4,record*12+8));
  assert.ok(Math.abs(q.reduce((s,v)=>s+v*v,0)-2.5)<1e-6);
  x.pile.instances[0].scale=-1;
  assert.throws(()=>buildInstancedBVH(x.tri,x.bounds,x.centers,x.meshes,x.pile,1),/Invalid pile transform/);
});
test('forest whole-leaf membership stays separate from instance identity',()=>{
  const x=fixture();x.tri[7]=64;x.pile.instances[0].leafMask=192;
  const r=buildInstancedBVH(x.tri,x.bounds,x.centers,x.meshes,x.pile,1),u=new Uint32Array(r.buffer);
  assert.equal(r.geometry[7],64);
  const identities=[u[12+9],u[24+9]];
  assert.ok(identities.some(v=>(v>>>24)===192&&(v&0xffffff)===1));
});
test('pile shader transforms normals and separates instance glass/history identities',()=>{
  const source=readFileSync(new URL('trace.wgsl',import.meta.url),'utf8'),traversal=readFileSync(new URL('trace-instances.wgsl',import.meta.url),'utf8');
  const s=instancedShader(source,traversal);
  assert.equal((s.match(/fn trace\(/g)||[]).length,1);
  assert.equal((s.match(/return instanceNormal\(h,n\*inverseSqrt/g)||[]).length,2);
  assert.ok(s.includes('vec2u(u32(attributes[hit.id].n0.w),instanceIdentity(hit))'));
  assert.ok(s.includes('all((*stack).ids[s]==boundary)'));
  assert.ok(s.includes('instanceIdentity(hit)==instanceIdentity(guide)'));
  assert.ok(s.includes('instance:u32'));
  assert.ok(!source.includes('instanceIdentity'));
  const compact=instancedShader(source,traversal,34);
  assert.equal((compact.match(/array<u32,34>/g)||[]).length,2);
  assert.ok(!compact.includes('array<u32,64>'));
  assert.throws(()=>instancedShader(source,traversal,1),/capacity/);
});
