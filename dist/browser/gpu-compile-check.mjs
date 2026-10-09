import {rendererOptions} from './renderer-options.mjs';
import {buildRendererShader} from './renderer-shaders.mjs';
import {gpuDeviceOptions} from './gpu-session.mjs?revision=mobile-lifecycle-2';
import {traceCompileVariant} from './trace-compatibility.mjs';
import {traceCompileProbe,traceProbeCases} from './trace-compile-probes.mjs';
import {mediumStackCandidate,mediumCandidateCases} from './medium-stack-candidate.mjs';
import {diagnosticShader} from './diagnostics.mjs';
import {createCompileDeadline} from './compile-deadline.mjs';

const build='mobile-medium-inline-9',saveKey='cybrLightCompileReport';
const $=selector=>document.querySelector(selector),utc=()=>new Date().toISOString();
const parameters=new URLSearchParams('scene=proof-optics&glass=split&motion=bilinear');
const load=async name=>{const response=await fetch(name,{cache:'no-store'});if(!response.ok)throw Error('Shader unavailable: '+name);return response.text();};
const options=rendererOptions(parameters),query=new URLSearchParams(location.search);
const cases=[...$('#case').options].map(option=>option.value);
const comparisonCases=cases.filter(name=>!traceProbeCases.includes(name)&&!mediumCandidateCases.includes(name));
const sha256=async code=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(code))),v=>v.toString(16).padStart(2,'0')).join('');
if(cases.includes(query.get('case')))$('#case').value=query.get('case');
$('#build').textContent=build;
let active=false,device,report,sequenceReport,cancelCurrent,restoredPending=false;
const displayed=()=>sequenceReport||report;
const showReport=()=>{
 const current=displayed();$('#report').textContent=current?JSON.stringify(current,null,2):'';
 const runs=sequenceReport?[...sequenceReport.results,...(sequenceReport.activeReport?[sequenceReport.activeReport]:[])]:report?[report]:[];
 $('#stages').textContent=runs.map(run=>run.case+'\n'+(Array.isArray(run.stages)?run.stages:[]).map(stage=>'  '+stage.elapsedMs+' ms: '+stage.phase).join('\n')).join('\n\n');
};
const saveReport=()=>{
 const current=displayed();if(!current)return;current.checkpointUtc=utc();
 // Keep one local report. No device logs or report data are sent to a server.
 for(const name of ['localStorage','sessionStorage']){
  try{current.storage={available:true,kind:name};window[name].setItem(saveKey,JSON.stringify(current));break;}
  catch(error){current.storage={available:false,errorName:error.name};}
 }
 showReport();
};
const update=(phase,current=report)=>{
 const changed=current.phase!==phase;current.phase=phase;
 if(changed||!current.stages?.length){
  current.stages??=[];current.stages.push({phase,utc:utc(),elapsedMs:Math.round(performance.now()-current.startedMs)});
 }
 if(current!==report)return;
 if(sequenceReport)sequenceReport.phase=phase;
 $('#status').textContent=(sequenceReport?current.case+': ':'')+phase;saveReport();
};
const savedReports=[];
for(const name of ['localStorage','sessionStorage']){
 try{const saved=JSON.parse(window[name].getItem(saveKey));if(saved)savedReports.push(saved);}catch{}
}
// A fallback session checkpoint can be newer than a stale local report left
// behind when local storage fills up or a later write is denied.
for(const saved of savedReports.sort((a,b)=>String(b.checkpointUtc||'').localeCompare(String(a.checkpointUtc||'')))){
 try{
  if(saved?.kind==='sequence'&&Array.isArray(saved.results)&&typeof saved.phase==='string'){
   sequenceReport=saved;report=saved.activeReport||saved.results.at(-1);restoredPending=!saved.completed;
  }else if(saved&&typeof saved.phase==='string'&&cases.includes(saved.case)){
   report=saved;restoredPending=saved.case===$('#case').value&&!saved.closedByCheck;
  }else continue;
  showReport();$('#status').textContent='Previous check: '+saved.phase+' (saved checkpoint; tap Run for a new check).';break;
 }catch{/* Storage can be unavailable or contain an older invalid report. */}
}
const selectLimits=limits=>Object.fromEntries(['maxBufferSize','maxStorageBufferBindingSize','maxStorageBuffersPerShaderStage','maxComputeInvocationsPerWorkgroup','maxComputeWorkgroupSizeX','maxComputeWorkgroupSizeY','maxComputeWorkgroupStorageSize'].map(name=>[name,limits[name]]));
const setBusy=value=>{active=value;for(const selector of ['#run','#sequence','#probes','#candidate','#case','#clear'])$(selector).disabled=value;$('#stop').disabled=!value;};
window.cybrCompileCheck={snapshot:()=>report,sequenceSnapshot:()=>sequenceReport};
$('#copy').onclick=async()=>{try{await navigator.clipboard.writeText($('#report').textContent);$('#status').textContent='Report copied.';}catch{$('#status').textContent='Select and copy the report below.';}};
$('#clear').onclick=()=>{
 if(active)return;
 for(const name of ['localStorage','sessionStorage'])try{window[name].removeItem(saveKey);}catch{}
 report=sequenceReport=undefined;restoredPending=false;showReport();$('#status').textContent='Report cleared.';
};
$('#stop').onclick=()=>{if(report&&active){report.stoppedByUser=true;cancelCurrent?.(new Error('Check stopped by user'));}};

async function runCase(name){
 const current=report={schemaVersion:3,build,case:name,startedUtc:utc(),startedMs:performance.now(),stages:[],browser:navigator.userAgent,embedded:window.top!==window,visibility:document.visibilityState,lifecycle:[],phase:'Requesting adapter',passed:false,sceneBuffersAllocated:0,frameBuffersAllocated:0,gpuBytesAllocatedByCheck:0};
 if(sequenceReport)sequenceReport.activeReport=current;
 const ownerSequence=sequenceReport,deadline=createCompileDeadline();let rejectStopped;
 const stopped=new Promise((_,reject)=>{rejectStopped=reject;});stopped.catch(()=>{});
 cancelCurrent=rejectStopped;
 const begin=phase=>{current.activeOperation=phase;update(phase,current);};
 const wait=(pending,onLateResult)=>Promise.race([deadline.wait(pending,onLateResult),stopped]);
 let ownedDevice,prefixModules;const retained=[];
 try{
  begin('Requesting adapter');if(!navigator.gpu)throw Error('WebGPU unavailable');
  const adapter=await wait(navigator.gpu.requestAdapter({powerPreference:'high-performance'}));
  if(!adapter)throw Error('No WebGPU adapter');
  current.adapter={vendor:adapter.info?.vendor,architecture:adapter.info?.architecture,device:adapter.info?.device,description:adapter.info?.description};
  current.adapterLimits=selectLimits(adapter.limits);
  current.requested=name==='default-limits'?{}:gpuDeviceOptions(adapter,{mobile:true,timings:false});
  begin('Requesting device');device=ownedDevice=await wait(adapter.requestDevice(current.requested),lateDevice=>lateDevice.destroy());current.deviceCreated=true;
  current.deviceLimits=selectLimits(device.limits);
  device.lost.then(info=>{
   if((current.closedByCheck||current.pageLeft)&&info.reason==='destroyed')return;
   current.passed=false;current.lost={reason:info.reason,message:info.message,activeOperation:current.activeOperation,afterCheckClosed:!!current.closedByCheck};
   update('GPU device lost during '+current.lost.activeOperation,current);rejectStopped(new Error(info.message||'GPU device lost'));
   if(ownerSequence&&ownerSequence===sequenceReport){
    ownerSequence.stop??={case:current.case,reason:'device-lost'};
    if(current!==report){cancelCurrent?.(new Error('Device lost in earlier comparison '+current.case));saveReport();}
   }
  });
  device.addEventListener('uncapturederror',event=>{current.validationError=event.error.message;update(current.phase,current);});
  begin('Building exact current trace source');
  const source=await wait(buildRendererShader('trace',{load,parameters,options}));
  const sourceSha256=await wait(sha256(source));
  const variant=mediumCandidateCases.includes(name)?mediumStackCandidate(source,name,{sourceSha256}):traceProbeCases.includes(name)?traceCompileProbe(source,name,{sourceSha256}):traceCompileVariant(source,name);
  current.shader={bytes:new TextEncoder().encode(variant.code).length,entryPoint:variant.entryPoint,workgroup:variant.workgroup,
   privateArrays:[...variant.code.matchAll(/(?:var \w+:array<[^;]+|struct MediumStack[^\n]+)/g)].map(match=>match[0])};
  current.shader.sha256=await wait(sha256(variant.code));
  if(variant.compileOnly)current.probe={compileOnly:true,dispatchAllowed:false,purpose:variant.purpose,originalSourceSha256:sourceSha256,originalSourceBytes:new TextEncoder().encode(source).length,originalSourcePrefixUnchanged:variant.code.startsWith(source)};
  if(variant.mediumInline)current.candidate={mode:'mediumStack=inline',mediumSlots:variant.mediumSlots,workgroup:variant.workgroup,targetsExpanded:variant.targets,commitsExpanded:variant.commits,defaultRendererChanged:false,renderingValidated:false};
  if(name==='host-prefix'){
   const canvas=document.createElement('canvas'),context=canvas.getContext('webgpu');
   if(!context)throw Error('WebGPU canvas unavailable for startup prefix');
   context.configure({device,format:navigator.gpu.getPreferredCanvasFormat(),alphaMode:'opaque'});
   retained.push(canvas,context);current.canvasConfigured=true;current.canvasSizeBeforeTrace=[canvas.width,canvas.height];
   begin('Compiling original diagnostic render prefix');
   const debug=device.createShaderModule({label:'diagnostic display',code:diagnosticShader(options.pixelBytes,options.separateSignals,options.opticalGuides)});
   retained.push(await wait(device.createRenderPipelineAsync({layout:'auto',vertex:{module:debug,entryPoint:'vertex'},fragment:{module:debug,entryPoint:'fragment',targets:[{format:navigator.gpu.getPreferredCanvasFormat()}]},primitive:{topology:'triangle-list'}})));
   retained.push(device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));current.gpuBytesAllocatedByCheck=16;
   current.diagnosticPipelineCreated=true;begin('Preparing original four-module prefix');current.prefixModules={};
   prefixModules=await wait(Promise.all(['trace','reconstruct','filter','display'].map(async moduleName=>{
    const code=await wait(buildRendererShader(moduleName,{load,parameters,options})),module=ownedDevice.createShaderModule({label:moduleName,code});
    current.prefixModules[moduleName]={moduleCreated:true,compilationInfoRequests:1,compilationInfoRequestedUtc:utc(),compilationInfoCompleted:false,messages:[]};update(current.phase,current);
    const info=await wait(module.getCompilationInfo());current.prefixModules[moduleName].compilationInfoCompleted=true;current.prefixModules[moduleName].compilationInfoCompletedUtc=utc();current.prefixModules[moduleName].messages=info.messages.map(m=>({type:m.type,line:m.lineNum,message:m.message}));update(current.phase,current);return {module,info};
   })));
  }
  let module,info;
  if(prefixModules){
   begin('Reusing validated trace module from startup prefix');
   ({module,info}=prefixModules[0]);current.traceValidationSource='completed-startup-prefix';current.traceCompilationInfoRequests=current.prefixModules.trace.compilationInfoRequests;
  }else{
   begin('Creating trace shader module');module=device.createShaderModule({label:name,code:variant.code});
   current.traceValidationSource='fresh-module';current.traceCompilationInfoRequests=1;
   begin('Requesting trace shader compilation info');info=await wait(module.getCompilationInfo());
  }
  current.traceShaderModuleCreated=true;current.compilationMessages=info.messages.map(m=>({type:m.type,line:m.lineNum,message:m.message}));
  if(info.messages.some(m=>m.type==='error'))throw Error('WGSL validation failed');
  current.compilationInfoCompleted=true;begin('Compiling selected compute entrypoint');
  const start=performance.now();current.pipelineRequestedUtc=utc();saveReport();
  await wait(device.createComputePipelineAsync({label:name,layout:'auto',compute:{module,entryPoint:variant.entryPoint}}));
  current.elapsedMs=Math.round(performance.now()-start);current.pipelineCreated=true;current.passed=!current.lost&&!current.validationError;
  update(current.passed?'Compilation passed; actual rendering still needs validation':'Compilation returned with a GPU error');
 }catch(error){current.error={name:error.name,message:error.message};update(current.lost?'GPU device lost during '+current.lost.activeOperation:'Comparison failed: '+error.message);}
 finally{
  deadline.close();cancelCurrent=undefined;current.closedByCheck=true;current.finishedUtc=utc();current.timeout=deadline.expired;current.retainedPrefixObjects=retained.length;
  ownedDevice?.destroy();device=undefined;saveReport();
 }
 return current;
}
$('#run').onclick=async()=>{
 if(active)return;sequenceReport=undefined;setBusy(true);
 try{await runCase($('#case').value);}finally{setBusy(false);}
};
async function runSequence(selected,family){
 if(active)return;setBusy(true);
 sequenceReport={schemaVersion:3,kind:'sequence',family,build,browser:navigator.userAgent,startedUtc:utc(),cases:selected,results:[],completed:false,phase:'Starting comparison sequence'};
 try{
  for(const name of selected){
   const result=await runCase(name);sequenceReport.results.push(result);delete sequenceReport.activeReport;
   if(sequenceReport.stop||!result.passed){sequenceReport.stop??={case:name,reason:result.lost?'device-lost':result.timeout?'timeout':result.stoppedByUser?'user-stop':result.pageLeft?'page-left':'check-failed'};break;}
  }
  sequenceReport.completed=true;sequenceReport.finishedUtc=utc();sequenceReport.phase=sequenceReport.stop?'Sequence stopped at '+sequenceReport.stop.case+'; no later cases started':'All selected compilation checks passed; actual rendering still needs validation';
  $('#status').textContent=sequenceReport.phase;saveReport();
 }finally{setBusy(false);}
}
$('#sequence').onclick=()=>{
 const family=mediumCandidateCases.includes($('#case').value)?mediumCandidateCases:traceProbeCases.includes($('#case').value)?traceProbeCases:comparisonCases;
 return runSequence(family.slice(Math.max(0,family.indexOf($('#case').value))),family===mediumCandidateCases?'medium-inline-candidate':family===traceProbeCases?'trace-probes':'original-comparisons');
};
// The next physical bisection never requests the already-failing main pipeline.
$('#probes').onclick=()=>runSequence(traceProbeCases,'trace-probes');
// Try the equivalent medium form first, then the same form in full trace main.
// Known failing original medium/current cases are available only by selection.
$('#candidate').onclick=()=>runSequence(mediumCandidateCases,'medium-inline-candidate');
document.addEventListener('visibilitychange',()=>{if(report){report.lifecycle??=[];report.lifecycle.push({event:'visibilitychange',state:document.visibilityState,operation:report.activeOperation});saveReport();}});
window.addEventListener('pagehide',event=>{
 if(report){report.lifecycle??=[];report.lifecycle.push({event:'pagehide',persisted:event.persisted,operation:report.activeOperation});if(active){report.pageLeft=true;cancelCurrent?.(new Error('Page left during check'));}saveReport();}
 device?.destroy();
});
// Keep a restored unfinished checkpoint visible instead of automatically
// replacing the evidence after a browser/GPU process failure.
if(query.get('run')==='1'&&!restoredPending)$(query.get('candidateSequence')==='1'?'#candidate':query.get('probeSequence')==='1'?'#probes':query.get('sequence')==='1'?'#sequence':'#run').click();
