import test from 'node:test';
import assert from 'node:assert/strict';
import {temporalColors} from './readback.mjs';
test('temporal RGB comes from each history lobe, not spatial ping-pong',()=>{
 const h=new Float32Array(96);for(let i=0;i<96;i++)h[i]=i;
 const out=temporalColors(h,2,48,true);
 assert.deepEqual(Array.from(out),[0,1,2,0,48,49,50,0,4,5,6,0,52,53,54,0,8,9,10,0,56,57,58,0,40,41,42,0,88,89,90,0]);
});
test('baseline temporal readback ignores metadata and rejects incompatible ABI',()=>{
 const h=new Float32Array(48);h.set([1,2,3,100]);h.set([4,5,6,200],24);
 assert.deepEqual(Array.from(temporalColors(h,2,24,false)),[1,2,3,0,4,5,6,0]);
 assert.throws(()=>temporalColors(h,2,48,true),/ABI/);
});
