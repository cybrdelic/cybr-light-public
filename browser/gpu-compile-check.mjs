import {rendererOptions} from './renderer-options.mjs';
import {buildRendererShader} from './renderer-shaders.mjs';
import {gpuDeviceOptions} from './gpu-session.mjs?revision=mobile-lifecycle-2';
import {traceCompileVariant} from './trace-compatibility.mjs';
import {diagnosticShader} from './diagnostics.mjs';
const $=selector=>document.querySelector(selector),parameters=new URLSearchParams('scene=proof-optics&glass=split&motion=bilinear');
const load=async name=>{const response=await fetch(name,{cache:'no-store'});if(!response.ok)throw Error('Shader unavailable: '+name);return response.text();};
const options=rendererOptions(parameters),query=new URLSearchParams(location.search);
if([...$('#case').options].some(option=>option.value===query.get('case')))$('#case').value=query.get('case');
let active=false,device,report;
const update=(phase)=>{report.phase=phase;$('#status').textContent=phase;$('#report').textContent=JSON.stringify(report,null,2);sessionStorage.setItem('cybrLightCompileReport',JSON.stringify(report));};
const begin=phase=>{report.activeOperation=phase;update(phase);};
const selectLimits=limits=>Object.fromEntries(['maxBufferSize','maxStorageBufferBindingSize','maxStorageBuffersPerShaderStage','maxComputeInvocationsPerWorkgroup','maxComputeWorkgroupSizeX','maxComputeWorkgroupSizeY','maxComputeWorkgroupStorageSize'].map(name=>[name,limits[name]]));
window.cybrCompileCheck={snapshot:()=>report};
$('#copy').onclick=async()=>{try{await navigator.clipboard.writeText($('#report').textContent);$('#status').textContent='Report copied.';}catch{$('#status').textContent='Select and copy the report below.';}};
$('#run').onclick=async()=>{
 if(active)return;active=true;$('#run').disabled=true;
 report={case:$('#case').value,browser:navigator.userAgent,embedded:window.top!==window,visibility:document.visibilityState,lifecycle:[],phase:'Requesting adapter',passed:false,sceneBuffersAllocated:0,frameBuffersAllocated:0,gpuBytesAllocatedByCheck:0};
 let timer,prefixModules;const retained=[];
 try{
  if(!navigator.gpu)throw Error('WebGPU unavailable');
  update(report.phase);
  const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
  if(!adapter)throw Error('No WebGPU adapter');
  report.adapter={vendor:adapter.info?.vendor,architecture:adapter.info?.architecture,device:adapter.info?.device};
  report.adapterLimits=selectLimits(adapter.limits);
  report.requested=report.case==='default-limits'?{}:gpuDeviceOptions(adapter,{mobile:true,timings:false});
  begin('Requesting device');device=await adapter.requestDevice(report.requested);report.deviceCreated=true;
  report.deviceLimits=selectLimits(device.limits);
  device.lost.then(info=>{if(report.closedByCheck&&info.reason==='destroyed')return;report.passed=false;report.lost={reason:info.reason,message:info.message,activeOperation:report.activeOperation,afterCheckClosed:!!report.closedByCheck};update('GPU device lost during '+report.lost.activeOperation);});
  device.addEventListener('uncapturederror',event=>{report.validationError=event.error.message;update(report.phase);});
  begin('Building exact current trace source');
  const source=await buildRendererShader('trace',{load,parameters,options});
  const variant=traceCompileVariant(source,report.case);
  report.shader={bytes:new TextEncoder().encode(variant.code).length,entryPoint:variant.entryPoint,workgroup:variant.workgroup,
   privateArrays:[...variant.code.matchAll(/(?:var \w+:array<[^;]+|struct MediumStack[^\n]+)/g)].map(match=>match[0])};
  report.shader.sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(variant.code))),v=>v.toString(16).padStart(2,'0')).join('');
  if(report.case==='host-prefix'){
   const canvas=document.createElement('canvas'),context=canvas.getContext('webgpu');
   if(!context)throw Error('WebGPU canvas unavailable for startup prefix');
   context.configure({device,format:navigator.gpu.getPreferredCanvasFormat(),alphaMode:'opaque'});
   retained.push(canvas,context);report.canvasConfigured=true;report.canvasSizeBeforeTrace=[canvas.width,canvas.height];
   begin('Compiling original diagnostic render prefix');
   const debug=device.createShaderModule({label:'diagnostic display',code:diagnosticShader(options.pixelBytes,options.separateSignals,options.opticalGuides)});
   retained.push(await device.createRenderPipelineAsync({layout:'auto',vertex:{module:debug,entryPoint:'vertex'},fragment:{module:debug,entryPoint:'fragment',targets:[{format:navigator.gpu.getPreferredCanvasFormat()}]},primitive:{topology:'triangle-list'}}));
   retained.push(device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}));report.gpuBytesAllocatedByCheck=16;
   report.diagnosticPipelineCreated=true;begin('Preparing original four-module prefix');
   prefixModules=await Promise.all(['trace','reconstruct','filter','display'].map(async name=>{
    const code=await buildRendererShader(name,{load,parameters,options}),module=device.createShaderModule({label:name,code});
    await module.getCompilationInfo();return module;
   }));
  }
  begin('Creating trace shader module');
  const module=prefixModules?.[0]||device.createShaderModule({label:report.case,code:variant.code});
  const info=await module.getCompilationInfo();report.compilationMessages=info.messages.map(m=>({type:m.type,line:m.lineNum,message:m.message}));
  if(info.messages.some(m=>m.type==='error'))throw Error('WGSL validation failed');
  report.compilationInfoCompleted=true;begin('Compiling selected compute entrypoint');
  const start=performance.now();
  await Promise.race([device.createComputePipelineAsync({label:report.case,layout:'auto',compute:{module,entryPoint:variant.entryPoint}}),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Compilation did not finish within 40 seconds; check will close its device')),40000);})]);
  report.elapsedMs=Math.round(performance.now()-start);report.pipelineCreated=true;report.passed=!report.lost&&!report.validationError;
  update(report.passed?'Compilation passed; actual rendering still needs validation':'Compilation returned with a GPU error');
 }catch(error){report.error={name:error.name,message:error.message};update('Comparison failed: '+error.message);}
 finally{clearTimeout(timer);report.closedByCheck=true;device?.destroy();active=false;$('#run').disabled=false;$('#report').textContent=JSON.stringify(report,null,2);sessionStorage.setItem('cybrLightCompileReport',JSON.stringify(report));}
};
document.addEventListener('visibilitychange',()=>{if(report){report.lifecycle.push({event:'visibilitychange',state:document.visibilityState,operation:report.activeOperation});update(report.phase);}});
window.addEventListener('pagehide',event=>{if(report){report.lifecycle.push({event:'pagehide',persisted:event.persisted,operation:report.activeOperation});report.closedByCheck=true;update(report.phase);}device?.destroy();});
if(query.get('run')==='1')$('#run').click();
