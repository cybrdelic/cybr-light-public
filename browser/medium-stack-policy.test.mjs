import test from 'node:test';
import assert from 'node:assert/strict';
import {selectMediumStackMode} from './medium-stack-policy.mjs';
test('normal Qualcomm/Adreno startup selects the original-capacity equivalent form without a diagnostic URL',()=>{
 for(const info of [{vendor:'qualcomm',architecture:'adreno-8xx'},{vendor:'QUALCOMM'},{architecture:'Adreno 740'}]){
  const selected=selectMediumStackMode({info});
  assert.equal(selected.mode,'scalar');assert.equal(selected.selection,'adapter');assert.equal(selected.mediumSlots,16);assert.equal(selected.physicalAdrenoVerified,false);
 }
});
test('explicit legacy rollback overrides Adreno selection and explicit scalar and inline remain available elsewhere',()=>{
 assert.equal(selectMediumStackMode({info:{vendor:'qualcomm'}},'legacy').mode,'legacy');
 assert.equal(selectMediumStackMode({info:{vendor:'nvidia'}},'inline').mode,'inline');
 assert.equal(selectMediumStackMode({info:{vendor:'nvidia'}},'scalar').mode,'scalar');
 assert.equal(selectMediumStackMode({info:{vendor:'qualcomm'}},'legacy').selection,'explicit');
});
test('other adapters retain their current path and invalid modes are rejected',()=>{
 for(const vendor of ['nvidia','intel','amd','apple','arm',''])assert.equal(selectMediumStackMode({info:{vendor}}).mode,'legacy');
 assert.equal(selectMediumStackMode(null).mode,'legacy');
 assert.throws(()=>selectMediumStackMode({info:{}},'unknown'),/scalar, inline or legacy/);
});
