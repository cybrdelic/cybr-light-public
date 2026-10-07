// Select an equivalent compiler form for the adapter that reproduced the
// original medium-pipeline failure. Physical Adreno success is unverified.
export function selectMediumStackMode(adapter,requested=null){
 if(requested!==null&&!['scalar','inline','legacy'].includes(requested))
  throw Error('mediumStack must be scalar, inline or legacy');
 const identifiedAdreno=/qualcomm|adreno/i.test([adapter?.info?.vendor,adapter?.info?.architecture].join(' '));
 const mode=requested||(identifiedAdreno?'scalar':'legacy');
 return {mode,selection:requested?'explicit':identifiedAdreno?'adapter':'default',
  mediumSlots:16,physicalAdrenoVerified:false,rollbackParameter:'mediumStack=legacy'};
}
