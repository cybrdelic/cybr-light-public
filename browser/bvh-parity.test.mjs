import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildBVH} from './bvh.mjs';

// Goldens from the pre-allocation-refactor builder, including node padding,
// tie-breaking, leaf order and backing-buffer growth beyond 1,024 nodes.
const goldens=[
 [17,1,'5fa1492b14e28329fa5867e6d7880bf3f875d24295ae91c4d49be3fc45e19201'],
 [17,6,'6c2446eff433ef7711f03473e16af5a65ffed4a0b8f887746ae2f0d8feaae2d5'],
 [1000,1,'569e25ac476428e45147db40f74040d34147caf82fb0010e807495d958293645'],
 [1000,6,'7b37e22414c5d8d8d63bfa526b0da9760be7794f9bf4468c860202a5370151ff'],
];
test('allocation-light builder preserves the previous packed tree byte for byte',()=>{
 for(const [count,leaf,hash] of goldens){
  const b=new Float32Array(count*6),c=new Float32Array(count*3);let seed=123;
  for(let i=0;i<count;i++)for(let k=0;k<3;k++){
   seed=(Math.imul(seed,1664525)+1013904223)>>>0;
   const x=seed/4294967296*100;b[i*6+k]=x;b[i*6+k+3]=x+.01;c[i*3+k]=x+.005;
  }
  const r=buildBVH(b,c,count,leaf);
  assert.equal(createHash('sha256').update(new Uint8Array(r.buffer)).update(new Uint8Array(r.ids.buffer)).digest('hex'),hash);
 }
});
