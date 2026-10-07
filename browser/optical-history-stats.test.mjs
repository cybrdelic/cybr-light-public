import test from 'node:test';
import assert from 'node:assert/strict';
import {opticalHistoryStats} from './optical-history-stats.mjs';
test('optical history diagnostics keep reflected and transmitted metadata independent',()=>{
 const data=new Float32Array(112);data[4]=1;data[7]=4;data[55]=1;
 data[56+8]=1;data[56+11]=1;data[56+39]=1;
 const result=opticalHistoryStats(data);
 assert.equal(result.reflection.reused,1);assert.equal(result.transmission.reused,0);
 assert.equal(result.reflection.meanGuidedSamples,4);
 assert.throws(()=>opticalHistoryStats(new Float32Array(3)),/ABI/);
});
