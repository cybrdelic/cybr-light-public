import {inlineMediumStack} from './medium-stack-inline.mjs';
import {traceCompileProbe,traceProbeSourceSha256} from './trace-compile-probes.mjs';
export const mediumCandidateCases=['medium-inline','current-inline'];
export function mediumStackCandidate(source,name,{sourceSha256}={}){
 if(!mediumCandidateCases.includes(name))throw Error('Unknown medium candidate case');
 if(sourceSha256!==traceProbeSourceSha256)throw Error('Medium candidate baseline changed; review before compilation');
 const medium=name==='medium-inline';
 const original=medium?traceCompileProbe(source,'medium',{sourceSha256}).code:source;
 const candidate=inlineMediumStack(original);
 return {...candidate,entryPoint:medium?'probeMedium':'main',workgroup:8,compileOnly:true,
  originalSourceSha256:sourceSha256,mediumInline:true,
  purpose:medium?'Original medium probe with equivalent operations expanded at call sites':'Full current renderer trace with equivalent medium operations expanded at call sites'};
}
