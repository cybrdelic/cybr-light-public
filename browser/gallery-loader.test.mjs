import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {loadGallery} from './gallery-loader.mjs';
import {galleryLayout} from './gallery-layout.mjs';

test('gallery remaps materials and offsets without corrupting geometry', async()=>{
  const originalFetch=globalThis.fetch;
  const positions=new Float32Array([0,0,0,1,0,0,0,0,1]);
  const raw=new Uint8Array(84);
  raw.set(new Uint8Array(positions.buffer)); raw.set(new Uint8Array(positions.buffer),36);
  raw.set(new Uint8Array(new Uint32Array([0,1,2]).buffer),72);
  const mesh={material:32,module:'example-gallery',positions:{offset:0,count:9,dtype:'float32'},normals:{offset:36,count:9,dtype:'float32'},indices:{offset:72,count:3,dtype:'uint32'}};
  const requested=[];
  globalThis.fetch=async url=>{
    requested.push(url);
    if(url.endsWith('index.json')) return Response.json({columns:2,entries:[{id:'a',counts:{low:1,near:10}},{id:'b',counts:{low:1,near:10}}]});
    if(url.endsWith('.json')) return Response.json({meshes:[mesh],customMaterials:{32:{color:[1,0,0]}}});
    return new Response(gzipSync(raw));
  };
  try {
    const {raw:combined,manifest}=await loadGallery('test/','b',['b']);
    assert.equal(combined.byteLength,168);
    assert.deepEqual(manifest.meshes.map(m=>m.material),[32,33]);
    assert.equal(manifest.meshes[1].indices.offset,156);
    assert.equal(new Uint32Array(combined,156,3)[2],2);
    assert.ok(Math.abs(new Float32Array(combined)[0]+1.3225)<1e-6);
    assert.ok(Math.abs(new Float32Array(combined,84)[0]-1.3225)<1e-6);
    assert.ok(requested.includes('test/a/low.json'));
    requested.length=0;
    const dual=await loadGallery('test/','b',['b','a'],12,true);
    assert.deepEqual(dual.manifest.nearModels,['b']);
    assert.deepEqual(dual.manifest.meshes.map(m=>m.lod),['low','low','near']);
    assert.equal(dual.manifest.meshes[1].material,dual.manifest.meshes[2].material);
    assert.ok(requested.includes('test/b/low.json')&&requested.includes('test/b/near.json'));
    assert.ok(requested.includes('test/b/near.json'));
    assert.ok(Math.abs(manifest.camera.target[0]-1.3225*4/5.245)<1e-6);
    requested.length=0;
    const capped=await loadGallery('test/','b',['b','a'],11);
    assert.deepEqual(capped.manifest.nearModels,['b']);
    assert.ok(requested.includes('test/a/low.json'));
    assert.ok(requested.includes('test/b/near.json'));
  } finally {globalThis.fetch=originalFetch;}
});

test('variable-sized exhibits have positive clearance and proportional framing',()=>{
  const index={columns:2,entries:[
    {id:'small',normalizedSize:[2,2,2],galleryScale:.1},
    {id:'large',normalizedSize:[2,2,2],galleryScale:2},
    {id:'wide',normalizedSize:[8,1,1],galleryScale:1},
  ]};
  const {items}=galleryLayout(index);
  assert.equal(items[1].size[0]/items[0].size[0],20);
  assert.ok(items[1].distance>items[0].distance);
  for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
    const a=items[i],b=items[j];
    const gapX=Math.abs(a.x-b.x)-(a.size[0]+b.size[0])/2;
    const gapY=Math.abs(a.y-b.y)-(a.size[1]+b.size[1])/2;
    assert.ok(gapX>=.0449 || gapY>=.0449);
  }
});

test('gallery fails explicitly on a missing asset',async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response('',{status:404});
  try {await assert.rejects(loadGallery('missing/'),/Gallery asset unavailable/);}
  finally {globalThis.fetch=originalFetch;}
});
