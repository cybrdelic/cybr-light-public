// Run the actual page controller with CPU-only DOM/device fixtures. A repeated
// shader-info call deliberately fails, so the startup-prefix regression is real.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {rendererOptions} from './renderer-options.mjs';
import {buildRendererShader} from './renderer-shaders.mjs';
import {gpuDeviceOptions} from './gpu-session.mjs';
import {traceCompileVariant} from './trace-compatibility.mjs';
import {diagnosticShader} from './diagnostics.mjs';
import {createCompileDeadline} from './compile-deadline.mjs';
const controller=(await readFile(new URL('gpu-compile-check.mjs',import.meta.url),'utf8')).replace(/^import[^\r\n]+\r?\n/gm,'');

async function runCase(name,{invalidTrace=false,storageUnavailable=false,cachedReport,olderLocalReport,execute=true,autoRun=false,deviceLoss=false,sequence=false,stopDuringDevice=false,timeoutAdapter=false}={}){
 const calls=new Map(),modules=[],pipelines=[],checkpoints=[],devices=[],fetches=[];let destroys=0,requests=0,clicks=0,automaticRun,releaseLateDevice,copied;
 const limits={maxBufferSize:536870912,maxStorageBufferBindingSize:536870912,maxStorageBuffersPerShaderStage:8,maxComputeInvocationsPerWorkgroup:256,maxComputeWorkgroupSizeX:256,maxComputeWorkgroupSizeY:256,maxComputeWorkgroupStorageSize:32768};
 const adapter={limits,features:new Set(),info:{vendor:'cpu-fixture',architecture:'no-hardware'},requestDevice(){
  let lose;const lost=new Promise(resolve=>{lose=resolve;}),localCalls=new Map();
  const device={limits,lost,addEventListener(){},destroy(){destroys++;lose({reason:'destroyed',message:'Owned fixture device closed'});},
   createShaderModule({label,code}){const module={label,code,async getCompilationInfo(){const count=(localCalls.get(label)||0)+1;localCalls.set(label,count);calls.set(label,(calls.get(label)||0)+1);if(count>1)throw Error('Duplicate shader-info request');return {messages:invalidTrace&&label==='trace'?[{type:'error',lineNum:7,message:'CPU validation fixture error'}]:[]};}};modules.push(module);return module;},
   async createRenderPipelineAsync(){return {diagnostic:true};},createBuffer({size}){assert.equal(size,16);return {size};},
   createComputePipelineAsync(descriptor){pipelines.push(descriptor);if(deviceLoss&&(deviceLoss===true||descriptor.label===deviceLoss)){lose({reason:'unknown',message:'Physical failure fixture'});return new Promise(()=>{});}return Promise.resolve({compute:true});},
  };devices.push(device);
  if(stopDuringDevice){queueMicrotask(()=>elements['#stop'].onclick());return new Promise(resolve=>{releaseLateDevice=()=>resolve(device);});}
  return Promise.resolve(device);
 }};
 const caseNames=['tiny','full-control','current','default-limits','workgroup-4','compact-media','compat','host-prefix'];
 const elements=Object.fromEntries(['case','status','stages','report','copy','run','sequence','stop','clear','build'].map(id=>['#'+id,{value:name,options:caseNames.map(value=>({value})),disabled:false,textContent:''}]));
 for(const selector of ['#run','#sequence'])elements[selector].click=()=>{clicks++;automaticRun=elements[selector].onclick();};
 const events={},window={addEventListener(name,listener){events[name]=listener;}};window.top=window;
 const stored=new Map(cachedReport?[['cybrLightCompileReport',JSON.stringify(cachedReport)]]:[]);
 const storage={getItem(key){if(storageUnavailable)throw Error('Storage unavailable');return stored.get(key)||null;},setItem(key,value){if(storageUnavailable)throw Error('Storage unavailable');stored.set(key,value);checkpoints.push(JSON.parse(value));},removeItem(key){stored.delete(key);}};
 window.sessionStorage=storage;
 window.localStorage=olderLocalReport?{...storage,getItem(){return JSON.stringify(olderLocalReport);}}:storage;
 const document={visibilityState:'visible',querySelector:selector=>elements[selector],addEventListener(){},createElement(tag){assert.equal(tag,'canvas');return {width:300,height:150,getContext(){return {configure(){}};}};}};
 const sandbox={window,document,location:{search:'?case='+name+(autoRun?'&run=1':'')+(sequence?'&sequence=1':'')},navigator:{userAgent:'CPU fixture, no GPU',clipboard:{async writeText(value){copied=value;}},gpu:{async requestAdapter(){requests++;return timeoutAdapter?new Promise(()=>{}):adapter;},getPreferredCanvasFormat:()=> 'bgra8unorm'}},
  fetch:async path=>{fetches.push(path);return {ok:true,text:()=>readFile(new URL(path,import.meta.url),'utf8')};},crypto:webcrypto,TextEncoder,URLSearchParams,performance,setTimeout,clearTimeout,GPUBufferUsage:{UNIFORM:64,COPY_DST:8},
  rendererOptions,buildRendererShader,gpuDeviceOptions,traceCompileVariant,diagnosticShader,createCompileDeadline:()=>createCompileDeadline({milliseconds:timeoutAdapter?5:40000})};
 new vm.Script(controller,{filename:'gpu-compile-check.mjs'}).runInNewContext(sandbox);
 if(automaticRun)await automaticRun;else if(execute)await elements[sequence?'#sequence':'#run'].onclick();
 if(releaseLateDevice){releaseLateDevice();for(let i=0;i<5;i++)await Promise.resolve();}
 return {report:window.cybrCompileCheck.snapshot(),sequence:window.cybrCompileCheck.sequenceSnapshot(),calls,modules,pipelines,destroys,requests,clicks,elements,checkpoints,devices,fetches,events,stored,async copy(){await elements['#copy'].onclick();return copied;}};
}

test('host prefix reuses its completed trace report and compiles the exact original module',async()=>{
 const result=await runCase('host-prefix');assert.equal(result.report.passed,true);
 for(const name of ['trace','reconstruct','filter','display']){
  assert.equal(result.calls.get(name),1);assert.equal(result.report.prefixModules[name].compilationInfoRequests,1);assert.equal(result.report.prefixModules[name].compilationInfoCompleted,true);
 }
 assert.equal(result.report.traceValidationSource,'completed-startup-prefix');assert.equal(result.report.traceCompilationInfoRequests,1);
 assert.equal(result.pipelines.length,1);assert.equal(result.pipelines[0].compute.module,result.modules.find(module=>module.label==='trace'));
 assert.equal(result.report.pipelineCreated,true);assert.equal(result.report.closedByCheck,true);assert.equal(result.destroys,1);
});
test('isolated current trace still requests one fresh shader-info report',async()=>{
 const result=await runCase('current');assert.equal(result.report.passed,true);assert.equal(result.calls.get('current'),1);
 assert.equal(result.report.traceValidationSource,'fresh-module');assert.equal(result.report.traceCompilationInfoRequests,1);assert.equal(result.pipelines.length,1);
});
test('cached prefix validation errors stay visible and prevent pipeline compilation',async()=>{
 const result=await runCase('host-prefix',{invalidTrace:true});assert.equal(result.report.passed,false);assert.equal(result.calls.get('trace'),1);
 assert.equal(result.report.prefixModules.trace.messages[0].message,'CPU validation fixture error');assert.equal(result.report.compilationMessages[0].type,'error');
 assert.equal(result.report.error.message,'WGSL validation failed');assert.equal(result.pipelines.length,0);assert.equal(result.destroys,1);
});

test('each startup stage is visible and checkpointed before the compute request',async()=>{
 const result=await runCase('current');assert.equal(result.report.passed,true);
 const pending=result.checkpoints.find(checkpoint=>checkpoint.pipelineRequestedUtc);
 assert.equal(pending.pipelineCreated,undefined);assert.equal(pending.activeOperation,'Compiling selected compute entrypoint');
 assert.ok(pending.shader.sha256);assert.ok(pending.stages.some(stage=>stage.phase==='Requesting trace shader compilation info'));
 assert.match(result.elements['#stages'].textContent,/Compiling selected compute entrypoint/);
 assert.ok(result.report.finishedUtc);assert.equal(result.checkpoints.at(-1).closedByCheck,true);
});

test('storage denied in an embedded browser cannot prevent compilation or device cleanup',async()=>{
 const result=await runCase('tiny',{storageUnavailable:true});assert.equal(result.report.passed,true);
 assert.equal(result.report.storage.available,false);assert.equal(result.report.closedByCheck,true);assert.equal(result.destroys,1);
 assert.equal(JSON.parse(result.elements['#report'].textContent).pipelineCreated,true);
});

test('reload restores an unfinished stage without automatically replacing its evidence',async()=>{
 const saved={case:'current',phase:'Compiling selected compute entrypoint',activeOperation:'Compiling selected compute entrypoint',passed:false,closedByCheck:false,stages:[{elapsedMs:100,phase:'Compiling selected compute entrypoint'}]};
 const result=await runCase('current',{cachedReport:saved,execute:false,autoRun:true});
 assert.equal(result.requests,0);assert.equal(result.clicks,0);assert.equal(result.checkpoints.length,0);
 assert.equal(result.report.phase,saved.phase);assert.match(result.elements['#status'].textContent,/saved checkpoint/);
 assert.match(result.elements['#stages'].textContent,/100 ms: Compiling selected compute entrypoint/);
});

test('device loss retains the pending operation and primary reason when compilation rejects later',async()=>{
 const result=await runCase('current',{deviceLoss:true});assert.equal(result.report.passed,false);
 assert.equal(result.report.lost.message,'Physical failure fixture');assert.equal(result.report.lost.activeOperation,'Compiling selected compute entrypoint');
 assert.equal(result.report.error.message,'Physical failure fixture');assert.equal(result.report.phase,'GPU device lost during Compiling selected compute entrypoint');
 assert.equal(result.report.closedByCheck,true);assert.equal(result.destroys,1);
 assert.equal(result.checkpoints.at(-1).lost.message,'Physical failure fixture');
});

test('one comparison sequence preserves all results and closes each fresh device',async()=>{
 const result=await runCase('tiny',{sequence:true});assert.equal(result.sequence.completed,true);assert.equal(result.sequence.stop,undefined);
 assert.equal(result.sequence.results.length,8);assert.equal(result.requests,8);assert.equal(result.destroys,8);
 assert.ok(result.sequence.results.every(run=>run.passed&&run.closedByCheck));assert.equal(result.calls.get('trace'),1);
 assert.ok(result.sequence.results.every(run=>run.build==='mobile-compile-sequence-7'&&run.browser==='CPU fixture, no GPU'));
 assert.equal(JSON.parse(await result.copy()).results.length,8);assert.ok(result.fetches.every(path=>path.endsWith('.wgsl')&&!path.includes('://')));
});

test('physical-style loss during a pending pipeline stops the sequence before later devices',async()=>{
 const result=await runCase('tiny',{sequence:true,deviceLoss:'current'});
 assert.equal(result.requests,3);assert.equal(result.destroys,3);assert.equal(result.sequence.results.length,3);
 assert.equal(result.sequence.stop.case,'current');assert.equal(result.sequence.stop.reason,'device-lost');assert.equal(result.sequence.completed,true);
 assert.equal(result.sequence.results[0].passed,true);assert.equal(result.sequence.results[1].passed,true);
 assert.equal(result.report.compilationInfoCompleted,true);assert.equal(result.report.timeout,false);
 assert.match(result.elements['#status'].textContent,/no later cases started/);
 assert.equal(JSON.parse(await result.copy()).results[2].lost.message,'Physical failure fixture');
});

test('reload preserves the whole unfinished sequence without starting another GPU check',async()=>{
 const saved={kind:'sequence',phase:'Compiling selected compute entrypoint',results:[{case:'tiny',passed:true,stages:[]}],completed:false,activeReport:{case:'current',phase:'Compiling selected compute entrypoint',stages:[]}};
 const result=await runCase('tiny',{cachedReport:saved,sequence:true,execute:false,autoRun:true});
 assert.equal(result.requests,0);assert.equal(result.clicks,0);assert.equal(result.sequence.results[0].passed,true);
 assert.equal(result.report.case,'current');assert.equal(JSON.parse(result.elements['#report'].textContent).activeReport.case,'current');
});

test('stop during device request ends the sequence and destroys a device returned late',async()=>{
 const result=await runCase('tiny',{sequence:true,stopDuringDevice:true});
 assert.equal(result.sequence.stop.reason,'user-stop');assert.equal(result.requests,1);assert.equal(result.destroys,1);
 assert.equal(result.report.deviceCreated,undefined);assert.equal(result.report.stoppedByUser,true);assert.equal(result.report.closedByCheck,true);
});

test('adapter timeout stops the sequence without starting a later case',async()=>{
 const result=await runCase('tiny',{sequence:true,timeoutAdapter:true});
 assert.equal(result.sequence.stop.reason,'timeout');assert.equal(result.requests,1);assert.equal(result.destroys,0);assert.equal(result.report.timeout,true);
});

test('clear removes the stored report and leaves the page ready',async()=>{
 const result=await runCase('tiny');assert.ok(result.stored.size);result.elements['#clear'].onclick();
 assert.equal(result.stored.size,0);assert.equal(result.elements['#report'].textContent,'');assert.equal(result.elements['#status'].textContent,'Report cleared.');
});

test('a newer session fallback checkpoint wins over stale local storage',async()=>{
 const saved={case:'current',phase:'Compiling selected compute entrypoint',closedByCheck:false,checkpointUtc:'2026-10-07T09:00:00Z',stages:[]};
 const older={case:'tiny',phase:'Compilation passed',closedByCheck:true,checkpointUtc:'2026-10-07T08:00:00Z',stages:[]};
 const result=await runCase('current',{cachedReport:saved,olderLocalReport:older,execute:false,autoRun:true});
 assert.equal(result.report.case,'current');assert.equal(result.report.phase,saved.phase);assert.equal(result.requests,0);assert.equal(result.clicks,0);
});
