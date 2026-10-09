// Select an equivalent compiler form for the adapter that reproduced the
// original medium-pipeline failure. Physical Adreno success is unverified.
export function workgroupMediumSupport(limits){
 const requirements={maxComputeWorkgroupStorageSize:16384,maxComputeInvocationsPerWorkgroup:16,
  maxComputeWorkgroupSizeX:4,maxComputeWorkgroupSizeY:4,maxComputeWorkgroupSizeZ:1};
 const missing=Object.entries(requirements).filter(([name,value])=>!Number.isFinite(limits?.[name])||limits[name]<value).map(([name])=>name);
 return {supported:missing.length===0,requirements,missing};
}
export function selectMediumStackMode(adapter,requested=null,{limits=adapter?.limits,compatibilityMode=false}={}){
 if(requested!==null&&!['workgroup','scalar','inline','legacy'].includes(requested))
  throw Error('mediumStack must be workgroup, scalar, inline or legacy');
 const identifiedAdreno=/qualcomm|adreno/i.test([adapter?.info?.vendor,adapter?.info?.architecture].join(' '));
 const capability=workgroupMediumSupport(limits);
 if(requested==='workgroup'&&(!capability.supported||compatibilityMode))
  throw Error('Workgroup medium mode requires checked device storage/workgroup limits and the full sixteen-slot renderer');
 const mode=requested||(identifiedAdreno?(compatibilityMode?'legacy':capability.supported?'workgroup':'scalar'):'legacy');
 return {mode,selection:requested?'explicit':identifiedAdreno?'adapter':'default',
  mediumSlots:16,physicalAdrenoVerified:false,rollbackParameter:'mediumStack=scalar',legacyRollbackParameter:'mediumStack=legacy',
  workgroupCapability:capability,workgroupDimensions:mode==='workgroup'?[4,4,1]:null};
}
