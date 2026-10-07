import {test} from 'node:test';
import assert from 'node:assert/strict';
import {proofScene} from './proof-scenes.mjs';
import {millionPile} from './million-pile.mjs';
for(const id of ['proof-optics','proof-metals','proof-indirect'])test(id+' has finite, correctly wound, nonzero-area geometry',()=>{
  const {manifest}=proofScene(id);let triangles=0;
  assert.equal(manifest.lighting.disableStudio,true);
  assert.deepEqual(manifest.lighting.environment,[0,0,0]);
  for(const mesh of manifest.meshes){
    assert.ok(manifest.customMaterials[mesh.material]);
    const p=mesh.positions.data,n=mesh.normals.data,ix=mesh.indices.data;
    assert.ok(p.every(Number.isFinite)&&n.every(Number.isFinite));
    for(let i=0;i<ix.length;i+=3){
      const a=ix[i]*3,b=ix[i+1]*3,c=ix[i+2]*3;
      assert.ok(Math.max(a,b,c)+2<p.length);
      const e=[0,1,2].map(k=>p[b+k]-p[a+k]),f=[0,1,2].map(k=>p[c+k]-p[a+k]);
      const g=[e[1]*f[2]-e[2]*f[1],e[2]*f[0]-e[0]*f[2],e[0]*f[1]-e[1]*f[0]];
      assert.ok(Math.hypot(...g)>1e-10);
      assert.ok(g.reduce((v,x,k)=>v+x*n[a+k],0)>0,'inverted normal');triangles++;
    }
  }
  assert.ok(triangles>1000);
});
test('single heap is deterministic, grounded and envelope-separated',()=>{
  const source={models:[{id:'box'}],instances:[{model:0,position:[0,0,0],rotation:[0,0,0,1]}]};
  const index={entries:[{id:'box',normalizedSize:[1,1,1],galleryScale:1}]};
  const a=millionPile(source,500,index),b=millionPile(source,500,index);
  assert.equal(a.instances.length,500);
  for(let i=0;i<500;i++){
    const p=a.instanceAt(i).position;assert.deepEqual(p,b.instanceAt(i).position);assert.ok(p[1]>=.5);
    for(let j=0;j<i;j++)assert.ok(p.some((v,k)=>Math.abs(v-a.instanceAt(j).position[k])>=1));
  }
});
