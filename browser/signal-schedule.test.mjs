import test from 'node:test';import assert from 'node:assert/strict';
import {signalSchedule} from './signal-schedule.mjs';
test('only proven globally opaque scenes skip transmission',()=>{
 const m=new Float32Array(32),options={separate:true,cullEmpty:true};
 assert.deepEqual(signalSchedule(m,options),[0,1,3]);
 assert.deepEqual(signalSchedule(m.buffer,options),[0,1,3]);
 m[21]=1;assert.deepEqual(signalSchedule(m,options),[0,1,2,3]);
 m[21]=NaN;assert.deepEqual(signalSchedule(m,options),[0,1,2,3]);
 assert.deepEqual(signalSchedule(new Float32Array(3),options),[0,1,2,3]);
 assert.deepEqual(signalSchedule(m),[0]);
 assert.deepEqual(signalSchedule(new Float32Array(32),{separate:true}),[0,1,2,3]);
});
