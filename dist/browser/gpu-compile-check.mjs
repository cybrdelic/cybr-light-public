import {rendererOptions} from './renderer-options.mjs';
import {buildRendererShader} from './renderer-shaders.mjs';
import {gpuDeviceOptions} from './gpu-session.mjs?revision=mobile-lifecycle-2';
import {traceCompileVariant} from './trace-compatibility.mjs';
import {diagnosticShader} from './diagnostics.mjs';
import {createCompileDeadline} from './compile-deadline.mjs';
const $=selector=>document.querySelector(selector),parameters=new URLSearchParams('scene=proof-optics&glass=split&motion=bilinear');
const load=async name=>{const response=await fetch(name,{cache:'no-store'});if(!response.ok)throw Error('Shader unavailable: '+name);return response.text();};
const options=rendererOptions(parameters),query=new URLSearchParams(location.search);
if([...$('#case').options].some(option=>option.value===query.get('case')))$('#case').value=query.get('case');
let active=false,device,report;
const update=(phase,current=report)=>{current.phase=phase;if(current!==report)return;$('#status').textContent=phase;$('#report').textContent=JSON.stringify(current,null,2);sessionStorage.setItem('cybrLightCompileReport',JSON.stringify(current));};
const selectLimits=limits=>Object.fromEntries(['maxBufferSize','maxStorageBufferBindingSize','maxStorageBuffersPerShaderStage','maxComputeInvocationsPerWorkgroup','maxComputeWorkgroupSizeX','maxComputeWorkgroupSizeY','maxComputeWorkgroupStorageSize'].map(name=>[name,limits[name]]));
window.cybrCompileCheck={snapshot:()=>report};
$('#copy').onclick=async()=>{try{await navigator.clipboard.writeText($('#report').textContent);$('#status').textContent='Report copied.';}catch{$('#status').textContent='Select and copy the report below.';}};
$('#run').onclick=async()=>{
 if(active)return;active=true;$('#run').disabled=true;
 const current=report={case:$('#case').value,browser:navigator.userAgent,embedded:window.top!==window,visibility:document.visibilityState,lifecycle:[],phase:'Requesting adapter',passed:false,sceneBuffersAllocated:0,frameBuffersAllocated:0,gpuBytesAllocatedByCheck:0};
 const deadline=createCompileDeadline(),begin=phase=>{current.activeOperation=phase;update(phase,current);};
 const wait=(pending,onLateResult)=>deadline.wait(pending,onLateResult);
 let ownedDevice,prefixModules;const retained=[];
 try{
  if(!navigator.gpu)throw Error('WebGPU unavailable');
  update(report.phase);
  const adapter=await wait(navigator.gpu.requestAdapter({powerPreference:'high-performance'}));
  if(!adapter)throw Error('No WebGPU adapter');
  report.adapter={vendor:adapter.info?.vendor,architecture:adapter.info?.architecture,device:adapter.info?.device};
  report.adapterLimits=selectLimits(adapter.limits);
  report.requested=report.case==='default-limits'?{}:gpuDeviceOptions(adapter,{mobile:true,timings:false});
  begin('Requesting device');device=ownedDevice=await wait(adapter.requestDevice(report.requested),lateDevice=>lateDevice.destroy());report.deviceCreated=true;
  report.deviceLimits=selectLimits(device.limits);
  device.lost.then(info=>{if(current.closedByCheck&&info.reason==='destroyed')return;current.passed=false;current.lost={reason:info.reason,message:info.message,activeOperation:current.activeOperation,afterCheckClosed:!!current.closedByCheck};update('GPU device lost during '+current.lost.activeOperation,current);});
  device.addEventListener('uncapturederror',event=>{current.validationError=event.error.message;update(current.phase,current);});
  begin('Building exact current trace source');
  const source=await wait(buildRendererShader('trace',{load,parameters,options}));
  const variant=traceCompileVariant(source,report.case);
  report.shader={bytes:new TextEncoder().encode(variant.code).length,entryPoint:variant.entryPoint,workgroup:variant.workgroup,
   privateArrays:[...variant.code.matchAll(/(?:var \w+:array<[^;]+|struct MediumStack[^\n]+)/g)].map(match=>match[0])};
  report.shader.sha256=Array.from(new Uint8Array(await wait(crypto.subtle.digest('SHA-256',new TextEncoder().encode(variant.code)))),v=>v.toString(16).padStart(2,'0')).join('');
  if(report.case==='host-prefix'){
   const canvas=document.createElement('canvas'),context=canvas.getContext('webgpu');
   if(!context)throw Error('WebGPU canvas unavailable for startup prefix');
   context.configure({device,format:navigator.gpu.getPreferredCanvasFormat(),alphaMode:'opaque'});
   retained.push(canvas,context);report.canvasConfigured=true;report.canvasSizeBeforeTrace=[canvas.width,canvas.height];
   begin('Compiling original diagnostic render prefix');
   const debug=device.createShaderModule({label:'diagnostic display',code:diagnosticShader(options.pixelBytes,options.separateSignals,options.opticalGuides)});
   retained.push(await wait(device.createRenderPipelineAsync({layout:'auto',vertex:{module:debug,entryPoint:'vertex'},fragment:{module:debug,entryPoint:'fragment',targets:[{format:navigator.gpu.getPreferredCanvasFormat()}]},primitive:{topology:'triangle-list'}})));
   retained.push(device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));report.gpuBytesAllocatedByCheck=16;
   report.diagnosticPipelineCreated=true;begin('Preparing original four-module prefix');
   report.prefixModules={};
   prefixModules=await wait(Promise.all(['trace','reconstruct','filter','display'].map(async name=>{
    const code=await wait(buildRendererShader(name,{load,parameters,options})),module=ownedDevice.createShaderModule({label:name,code});
    const info=await wait(module.getCompilationInfo());current.prefixModules[name]={compilationInfoCompleted:true,messages:info.messages.map(m=>({type:m.type,line:m.lineNum,message:m.message}))};update(current.phase,current);return module;
   })));
  }
  begin('Creating trace shader module');
  const module=prefixModules?.[0]||device.createShaderModule({label:report.case,code:variant.code});
  const info=await wait(module.getCompilationInfo());report.compilationMessages=info.messages.map(m=>({type:m.type,line:m.lineNum,message:m.message}));
  if(info.messages.some(m=>m.type==='error'))throw Error('WGSL validation failed');
  report.compilationInfoCompleted=true;begin('Compiling selected compute entrypoint');
  const start=performance.now();
  await wait(device.createComputePipelineAsync({label:report.case,layout:'auto',compute:{module,entryPoint:variant.entryPoint}}));
  report.elapsedMs=Math.round(performance.now()-start);report.pipelineCreated=true;report.passed=!report.lost&&!report.validationError;
  update(report.passed?'Compilation passed; actual rendering still needs validation':'Compilation returned with a GPU error');
 }catch(error){report.error={name:error.name,message:error.message};update('Comparison failed: '+error.message);}
 finally{deadline.close();current.closedByCheck=true;current.timeout=deadline.expired;current.retainedPrefixObjects=retained.length;ownedDevice?.destroy();active=false;$('#run').disabled=false;$('#report').textContent=JSON.stringify(current,null,2);sessionStorage.setItem('cybrLightCompileReport',JSON.stringify(current));}
};
document.addEventListener('visibilitychange',()=>{if(report){report.lifecycle.push({event:'visibilitychange',state:document.visibilityState,operation:report.activeOperation});update(report.phase);}});
window.addEventListener('pagehide',event=>{if(report){report.lifecycle.push({event:'pagehide',persisted:event.persisted,operation:report.activeOperation});report.closedByCheck=true;update(report.phase);}device?.destroy();});
if(query.get('run')==='1')$('#run').click();
