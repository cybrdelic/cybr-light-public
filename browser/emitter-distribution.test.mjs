import test from 'node:test';
import assert from 'node:assert/strict';
import {weightEmitters} from './emitter-distribution.mjs';
test('emitter PMF tracks area and power; CDF normalized',()=>{
 const lights=[0,0,0,0, 1,0,0,0, 0,1,0,0, 1,1,1,0,
               0,0,0,0, 2,0,0,0, 0,1,0,0, 3,3,3,0];
 weightEmitters(lights);
 assert.ok(Math.abs(lights[7]-1/7)<1e-12);
 assert.ok(Math.abs(lights[23]-6/7)<1e-12);
 assert.equal(lights[19],1);
 assert.equal(lights[3],lights[7]);
});
test('empty emitter list supported',()=>assert.deepEqual(weightEmitters([]),[]));
