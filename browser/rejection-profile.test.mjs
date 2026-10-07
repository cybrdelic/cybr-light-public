import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {rejectionProfile,summarizeRejection} from './rejection-profile.mjs';
test('instrument baseline and separated decisions without changing result expressions',()=>{
 for(const separated of [false,true]){const s=readFileSync(new URL((separated?'./experimental-signals/':'./')+'reconstruct.wgsl',import.meta.url),'utf8');const out=rejectionProfile(s,separated);assert.match(out,/@binding\(5\)/);assert.match(out,/rejection\[/);assert.ok(out.includes('result=(result+history.color.rgb*weight)/(weight+1.)'));}
});
test('candidate rejection is distinct from a final fresh pixel',()=>{
 const s=summarizeRejection(new Float32Array([16,3,0,2,64,0,1,2]),2,1)[0].groups.glass;
 assert.equal(s.pixels,2);assert.equal(s.fresh,1);assert.equal(s.candidateReasons.primaryIdentity,1);assert.equal(s.rejectedReasons.primaryIdentity,undefined);assert.equal(s.rejectedReasons.opticalEndpoint,1);
 assert.throws(()=>rejectionProfile('changed',false),/contract/);
});
