import test from 'node:test';
import assert from 'node:assert/strict';
import {selectMediumStackMode,workgroupMediumSupport} from './medium-stack-policy.mjs';
const supported={maxComputeWorkgroupStorageSize:16384,maxComputeInvocationsPerWorkgroup:16,maxComputeWorkgroupSizeX:4,maxComputeWorkgroupSizeY:4,maxComputeWorkgroupSizeZ:1};

test('normal Qualcomm/Adreno startup selects the original-capacity equivalent form without a diagnostic URL',()=>{
 for(const info of [{vendor:'qualcomm',architecture:'adreno-8xx'},{vendor:'QUALCOMM'},{architecture:'Adreno 740'}]){
  const selected=selectMediumStackMode({info,limits:supported});
  assert.equal(selected.mode,'workgroup');assert.equal(selected.selection,'adapter');assert.equal(selected.mediumSlots,16);assert.equal(selected.physicalAdrenoVerified,false);
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


test('every checked device limit is required; automatic selection falls back to scalar, explicit selection fails closed',()=>{
 for(const name of Object.keys(supported)){
  const limits={...supported,[name]:supported[name]-1};
  assert.equal(workgroupMediumSupport(limits).supported,false);
  assert.equal(selectMediumStackMode({info:{vendor:'qualcomm'},limits}).mode,'scalar');
  assert.throws(()=>selectMediumStackMode({info:{vendor:'qualcomm'},limits},'workgroup'),/checked device/);
 }
 assert.equal(selectMediumStackMode({info:{vendor:'qualcomm'}}).mode,'scalar');
 assert.equal(workgroupMediumSupport(null).supported,false);
 assert.equal(workgroupMediumSupport({...supported,maxComputeWorkgroupStorageSize:NaN}).supported,false);
});

test('device limits override adapter limits and compact startup does not select workgroup storage',()=>{
 const adapter={info:{vendor:'adreno'},limits:supported};
 assert.equal(selectMediumStackMode(adapter,null,{limits:{...supported,maxComputeWorkgroupStorageSize:8192}}).mode,'scalar');
 assert.equal(selectMediumStackMode(adapter,null,{compatibilityMode:true}).mode,'legacy');
 assert.throws(()=>selectMediumStackMode(adapter,'workgroup',{compatibilityMode:true}),/sixteen-slot/);
 const explicit=selectMediumStackMode({info:{vendor:'nvidia'},limits:supported},'workgroup');
 assert.equal(explicit.mode,'workgroup');assert.deepEqual(explicit.workgroupDimensions,[4,4,1]);
 assert.equal(explicit.rollbackParameter,'mediumStack=scalar');assert.equal(explicit.legacyRollbackParameter,'mediumStack=legacy');
});
