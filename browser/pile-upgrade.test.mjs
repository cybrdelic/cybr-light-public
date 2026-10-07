import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contactProfile} from './contact-packing.mjs';
import {millionPile} from './million-pile.mjs';
import {selectPileDetail} from './pile-lod.mjs';
import {buildInstancedBVH} from './instanced-bvh.mjs';
test('compound profiles preserve empty frame cavities',()=>{
 const profile=contactProfile([[-2,-1,-.2,-1,1,.2],[1,-1,-.2,2,1,.2]],[0,0,0,1],.1);
 assert.ok(profile.length>0);
 assert.ok(profile.every(([x])=>Math.abs((x+.5)*.1)>.8));
});
test('compound stress packing stays grounded and separates boxes',()=>{
 const source={models:[{id:'box',sha256:'a'}],instances:[{model:0,position:[0,0,0],rotation:[0,0,0,1]}]};
 const contacts={models:[{id:'box',sha256:'a',boxes:[[-.5,-.5,-.5,.5,.5,.5]]}]};
 const index={entries:[{id:'box',normalizedSize:[1,1,1],galleryScale:1}]};
 const settled=millionPile(source,100,index,contacts);
 assert.equal(settled.instances.length,100);
 for(let i=0;i<100;i++){
  const a=settled.instanceAt(i).position;assert.ok(a[1]>=.5);
  for(let j=0;j<i;j++){const b=settled.instanceAt(j).position;assert.ok(a.some((v,k)=>Math.abs(v-b[k])>=.9999));}
 }
 assert.throws(()=>millionPile(source,100,index,{models:[]}),/Stale/);
});
test('LOD selects visible nearby templates under the geometry budget',()=>{
 const info={lodPositions:new Float32Array([0,0,1,0,0,0,-1,1]),modelRadii:[.1,.1],modelIds:['near','behind']};
 const cam={eye:[0,0,0],forward:[0,0,1],right:[1,0,0],up:[0,1,0],tan:.4};
 const index={entries:info.modelIds.map(id=>({id,counts:{low:1,near:10}}))};
 assert.deepEqual(selectPileDetail(info,cam,540,12,index),['near']);
 assert.deepEqual(selectPileDetail(info,cam,540,11,index),[]);
});
test('dual LOD shares transforms and exposes separate BLAS pointers',()=>{
 const tri=new Float32Array(72);tri.set([0,0,0,0,1,0,0,0,0,1,0,0]);tri.set(tri.slice(0,36),36);
 const bounds=new Float32Array([0,0,0,1,1,0,0,0,0,1,1,0]);
 const centers=new Float32Array([.5,.5,0,.5,.5,0]);
 const meshes=['low','near'].map(lod=>({galleryId:'m',lod,indices:{count:3}}));
 const pile={models:[{id:'m'}],instances:[{model:0,position:[0,1,0],rotation:[0,0,0,1]}]};
 const result=buildInstancedBVH(tri,bounds,centers,meshes,pile,1);
 const u=new Uint32Array(result.buffer);
 assert.notEqual(u[20],u[22]);assert.ok(u[22]>0);
 assert.equal(result.representedTriangles,1);
 assert.equal(result.lodPositions.length,4);
});
