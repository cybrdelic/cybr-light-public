import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {packMeshletAttributes,meshletAttributeShader} from './meshlet-attributes.mjs';
test('sharing is bit-exact including boundary IDs and signed zero',()=>{
 const input=new Float32Array(130*24);
 for(let i=0;i<130;i++)for(let j=0;j<3;j++){input.set([i%4,j%2,-0,j===0?15:0],i*24+j*4);input.set([.5,.3,1,0],i*24+12+j*4);}
 const packed=packMeshletAttributes(input),u=new Uint32Array(packed.data.buffer),src=new Uint32Array(input.buffer);assert.equal(packed.clusters,3);assert.ok(packed.data.byteLength<input.byteLength);
 for(let i=0;i<130;i++)for(let j=0;j<3;j++){
  const at=u[0]*4+u[4+i*4+j]*8;
  assert.deepEqual(u.slice(at,at+4),src.slice(i*24+j*4,i*24+j*4+4));assert.deepEqual(u.slice(at+4,at+8),src.slice(i*24+12+j*4,i*24+16+j*4));
 }
});
test('shader keeps intersection geometry and loads shared attributes only',()=>{
 const s=meshletAttributeShader(readFileSync(new URL('./trace.wgsl',import.meta.url),'utf8'));
 assert.ok(s.includes('var<storage,read> triangles:array<Triangle>'));assert.ok(!s.includes('attributes['));assert.ok(s.includes('loadAttributes(hit.id).n0.w'));
});
