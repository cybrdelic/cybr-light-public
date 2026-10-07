// Fail closed: screenshots, submitted FPS, or finite pixels alone cannot
// certify a game renderer. Inputs are saved measurements, not UI counters.
export const releaseTarget=Object.freeze({width:1920,height:1080,gpuP95Ms:16.67});
export const requiredCases=Object.freeze([
 'diffuse-motion','metal-motion','nested-glass-motion','disocclusion',
 'camera-cut','moving-light','moving-object','animated-fluid',
 'resize-recovery','device-loss-recovery',
]);
export function evaluateRelease(report,target=releaseTarget){
 const failures=[];
 if(!report?.adapter)failures.push('Missing measured adapter identity');
 if(report?.isolatedGPU!==true)failures.push('GPU timings are not isolated');
 for(const name of requiredCases){
  const c=report?.cases?.[name];
  if(!c){failures.push(`${name}: missing evidence`);continue;}
  if(c.width!==target.width||c.height!==target.height)failures.push(`${name}: resolution mismatch`);
  if(!Number.isFinite(c.gpuP95Ms)||c.gpuP95Ms<0||c.gpuP95Ms>target.gpuP95Ms)failures.push(`${name}: GPU frame budget failed`);
  if(c.gpuErrors!==0||c.nonfinitePixels!==0)failures.push(`${name}: GPU/pixel safety failed`);
  if(c.sequenceComplete!==true||!c.sequencePath||!c.referencePath)failures.push(`${name}: incomplete sequence/reference evidence`);
  if(c.visualApproval!==true)failures.push(`${name}: motion/detail/trails review not approved`);
  if(!Number.isFinite(c.relativeRMSE)||c.relativeRMSE<0||c.relativeRMSE>.03)failures.push(`${name}: reference error failed`);
  if(!Number.isFinite(c.temporalResidual)||c.temporalResidual<0||c.temporalResidual>.02)failures.push(`${name}: temporal stability failed`);
 }
 return {accepted:failures.length===0,target,failures};
}
