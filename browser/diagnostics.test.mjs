import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeStages,diagnosticShader} from './diagnostics.mjs';
test('stage timing uses bounded intervals, not CPU cadence',()=>{
 const t=[0n,5000000n,9000000n,10000000n,5000000n,6000000n,6000000n,8500000n];
 assert.deepEqual(decodeStages(t,true),{trace:5,total:10,display:1,temporal:1,filter:2.5});
 assert.deepEqual(decodeStages(t,false),{trace:5,total:10,display:1});
});
test('diagnostics preserve backend record stride and read-only bindings',()=>{
 for(const [bytes,separate,optical] of [[96,false,false],[192,true,false],[224,true,true]]){
   const code=diagnosticShader(bytes,separate,optical);
   assert.ok(code.includes(`*${bytes/16}u`));
   assert.ok(code.includes('var<storage,read>'));
   assert.ok(!code.includes('read_write'));
 }
});
