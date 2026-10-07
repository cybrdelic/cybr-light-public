import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {buildBVH} from './bvh.mjs';
import {compactBVH,compactBVHShader} from './compact-bvh.mjs';
test('compact nodes preserve every bound, child and triangle interval bit-for-bit',()=>{
 const count=137,bounds=new Float32Array(count*6),centers=new Float32Array(count*3);
 for(let i=0;i<count;i++){const p=[i%11,Math.floor(i/11),Math.sin(i)];centers.set(p,i*3);bounds.set([...p.map(x=>x-.2),...p.map(x=>x+.2)],i*6);}
 const built=buildBVH(bounds,centers,count),old=new Uint32Array(built.buffer),packed=new Uint32Array(compactBVH(built.buffer));
 assert.equal(packed.byteLength,built.nodeCount*32);
 for(let i=0;i<built.nodeCount;i++){
  const a=i*12,b=i*8;assert.deepEqual(packed.slice(b,b+3),old.slice(a,a+3));assert.deepEqual(packed.slice(b+4,b+7),old.slice(a+4,a+7));
  if(old[a+11]){assert.equal(packed[b+3],old[a+10]);assert.equal(packed[b+7]&0x7fffffff,old[a+11]);assert.ok(packed[b+7]&0x80000000);}
  else{assert.equal(packed[b+3],old[a+8]);assert.equal(packed[b+7],old[a+9]);}
 }
});
test('both ordinary transport shaders support lossless node packing',()=>{
 for(const file of ['trace.wgsl','experimental-signals/trace.wgsl']){
  const shader=compactBVHShader(readFileSync(new URL(file,import.meta.url),'utf8'));
  assert.ok(!shader.includes('node.links'));assert.match(shader,/left:u32/);
 }
 assert.throws(()=>compactBVHShader('invalid'),/contract/);
 assert.throws(()=>compactBVH(new ArrayBuffer(7)),/Invalid/);
});
