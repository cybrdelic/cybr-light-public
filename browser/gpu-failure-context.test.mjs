import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createGpuRuntime,formatGpuFailure} from './gpu-session.mjs';
import {buildRendererShader} from './renderer-shaders.mjs';
import {rendererOptions} from './renderer-options.mjs';
const host=await readFile(new URL('./app.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const fakeDevice=()=>{const loss=deferred(),events={};return {lost:loss.promise,loss,events,destroyed:0,
 addEventListener(name,fn){events[name]=fn;},destroy(){this.destroyed++;}};};
function functionSource(source,name){
 const start=source.indexOf('function '+name+'('),open=source.indexOf('{',start);let depth=1,end=open+1;
 for(;depth;end++){if(source[end]==='{')depth++;if(source[end]==='}')depth--;}
 return (source.slice(start-6,start)==='async '?'async ':'')+source.slice(start,end);
}
test('ordinary failure formatter reads actual selection and fallback without mutating settings',()=>{
 const modes=[{mode:'workgroup',selection:'adapter',mediumSlots:16,workgroupDimensions:[4,4,1]},
  {mode:'scalar',selection:'adapter',mediumSlots:16,workgroupCapability:{missing:['maxComputeWorkgroupStorageSize']}},
  {mode:'legacy',selection:'explicit',mediumSlots:16}];
 for(const mode of modes){const before=structuredClone(mode),message=formatGpuFailure('Compiling trace: failure',mode);
  assert.match(message,/Compiling trace: failure/);assert.ok(message.includes('Medium mode: '+mode.mode));
  assert.match(message,/Renderer context: mobile-failure-context-1/);assert.deepEqual(mode,before);}
 assert.match(formatGpuFailure('failure',modes[1]),/workgroup limits unavailable or insufficient: maxComputeWorkgroupStorageSize/);
 assert.match(formatGpuFailure('failure',modes[2],{compatibilityMode:true}),/10 slots; compact compatibility/);
 assert.match(formatGpuFailure('failure',null),/Medium mode: not selected/);
});
test('overlapping shader information records all active labels and attributes a rejected call to its own shader',async()=>{
 const device=fakeDevice(),failures=[],runtime=createGpuRuntime(device,{onFailure:value=>failures.push(value)});
 const first=deferred(),second=deferred();
 const a={label:'trace',getCompilationInfo:()=>first.promise},b={label:'filter',getCompilationInfo:()=>second.promise};
 const checkA=runtime.checkShaderInfo(a),checkB=runtime.checkShaderInfo(b);
 const rejection=assert.rejects(checkA,/trace information failed/);
 assert.deepEqual(runtime.snapshot().checkingShaders,['trace','filter']);
 first.reject(Error('trace information failed'));await rejection;
 assert.match(failures[0],/during Checking WGSL information: trace:/);
 second.resolve({messages:[]});assert.deepEqual(await checkB,{messages:[]});
 assert.deepEqual(runtime.snapshot().checkingShaders,[]);
});
test('loss while shader information overlaps names the active set and refuses further shader/pipeline requests',async()=>{
 const device=fakeDevice(),failures=[],runtime=createGpuRuntime(device,{onFailure:value=>failures.push(value)}),a=deferred(),b=deferred();
 const pending=[runtime.checkShaderInfo({label:'trace',getCompilationInfo:()=>a.promise}),runtime.checkShaderInfo({label:'filter',getCompilationInfo:()=>b.promise})];
 const rejected=pending.map(value=>assert.rejects(value,{name:'AbortError'}));
 device.loss.resolve({reason:'unknown',message:'A valid external Instance reference no longer exists'});await Promise.resolve();
 assert.match(failures[0],/during Checking WGSL information: trace, filter:/);
 a.resolve({messages:[]});b.resolve({messages:[]});await Promise.all(rejected);
 let calls=0;await assert.rejects(runtime.checkShaderInfo({label:'retry',getCompilationInfo:()=>{calls++;}}),{name:'AbortError'});
 device.createComputePipelineAsync=async()=>{calls++;};await assert.rejects(runtime.compile('createComputePipelineAsync',{}),{name:'AbortError'});
 assert.equal(calls,0);assert.ok(failures.every(value=>value===failures[0]));
});
test('concurrent pipeline rejection retains the failing descriptor label instead of another active pipeline phase',async()=>{
 const device=fakeDevice(),failures=[],trace=deferred(),filter=deferred();
 device.createComputePipelineAsync=descriptor=>descriptor.compute.module.label==='trace'?trace.promise:filter.promise;
 const runtime=createGpuRuntime(device,{onFailure:value=>failures.push(value)});
 const first=runtime.compile('createComputePipelineAsync',{compute:{module:{label:'trace'}}});
 const second=runtime.compile('createComputePipelineAsync',{compute:{module:{label:'filter'}}});
 const rejected=assert.rejects(first,/trace pipeline failed/);trace.reject(Error('trace pipeline failed'));await rejected;
 assert.match(failures[0],/during Compiling trace:/);filter.resolve({});await second;
});
test('device loss stops queued mobile pipelines without a retry or changed descriptor',async()=>{
 const device=fakeDevice(),gate=deferred(),calls=[];
 device.createComputePipelineAsync=async descriptor=>{calls.push(descriptor);await gate.promise;return descriptor;};
 const runtime=createGpuRuntime(device,{serial:true}),descriptors=[{label:'trace'},{label:'filter'}];
 const pending=descriptors.map(value=>runtime.compile('createComputePipelineAsync',value));
 const rejected=pending.map(value=>assert.rejects(value,{name:'AbortError'}));
 await Promise.resolve();device.loss.resolve({reason:'unknown',message:'driver loss'});await Promise.resolve();gate.resolve();
 await Promise.all(rejected);assert.deepEqual(calls,[descriptors[0]]);
});
function shaderFixture(mode,{messages=[],build=buildRendererShader}={}){
 const parameters=new URLSearchParams('scene=proof-optics&motion=bilinear&mediumStack='+mode),options=rendererOptions(parameters),modules=[],reports=[],phases=[],moduleWorkgroups=new Map();
 const device={limits:{maxComputeWorkgroupStorageSize:32768},createShaderModule({label,code}){
  const module={label,code,async getCompilationInfo(){return {messages};}};modules.push(module);return module;
 }};
 const gpuRuntime={assertActive(){},setPhase(value){phases.push(value);},checkShaderInfo(module){return module.getCompilationInfo();},report(error,phase){reports.push({error:error.message,phase});}};
 const fetch=async path=>({ok:true,text:()=>readFile(new URL('./'+path,import.meta.url),'utf8')});
 const bindings={parameters,options,motionReconstruction:options.motionReconstruction,compatibilityMode:false,device,moduleWorkgroups,gpuRuntime,fetch,buildRendererShader:build};
 const shader=Function(...Object.keys(bindings),functionSource(host,'shader')+'\nreturn shader;')(...Object.values(bindings));
 return {shader,parameters,modules,reports,phases,moduleWorkgroups};
}
test('actual patched host still emits exact validated workgroup/scalar/legacy trace bytes and dimensions',async()=>{
 for(const [mode,expected,dimensions] of [['workgroup','9ff8fba4cecc7b6add647624e3d7507b0deb1a9e0a943fa8e56d251ef1fef30a',4],
  ['scalar','49cc7c138f6ea80a3e049429636b2956a329d8ea9dbf8963921a519d0bd22867',8],
  ['legacy','563e314d2f974482c1b24c890067316eab892b7adeb8806ad688b15527a60b3f',8]]){
  const f=shaderFixture(mode),before=f.parameters.toString(),module=await f.shader('trace');
  assert.equal(createHash('sha256').update(module.code).digest('hex'),expected);assert.equal(f.moduleWorkgroups.get(module),dimensions);
  assert.equal(f.parameters.toString(),before);assert.deepEqual(f.reports,[]);assert.deepEqual(f.phases,['Creating shader module: trace']);
 }
});
test('actual patched host identifies shader builder and returned WGSL errors before compiling any pipeline',async()=>{
 const missing=shaderFixture('workgroup',{build:async()=>{throw Error('missing source');}});
 await assert.rejects(missing.shader('trace'),/missing source/);assert.equal(missing.modules.length,0);
 assert.equal(missing.reports[0].phase,'Building WGSL shader: trace');
 const invalid=shaderFixture('workgroup',{messages:[{type:'error',lineNum:17,message:'bad source'}]});
 await assert.rejects(invalid.shader('trace'),/17: bad source/);assert.equal(invalid.reports[0].phase,'Validating WGSL information: trace');
});
test('ordinary error panel pauses/cancels on loss, names mode, preserves controls/settings and stays local',()=>{
 const status={style:{},attributes:{},setAttribute(key,value){this.attributes[key]=value;}};
 const state={errors:[],ready:true,paused:false,loading:{scene:'proof-optics'}};
 const controls=new Map(),$=id=>{if(!controls.has(id))controls.set(id,{value:id,disabled:true});return controls.get(id);};
 const loss={reason:'unknown',phase:'Compiling trace',message:'driver loss'},snapshot={lost:loss};let cancel=0;
 const mediumStackMode={mode:'workgroup',selection:'adapter',mediumSlots:16,workgroupDimensions:[4,4,1]},before=structuredClone(mediumStackMode);
 const bindings={sessionClosed:false,state,status,formatGpuFailure,mediumStackMode,compatibilityMode:false,
  gpuRuntime:{snapshot:()=>snapshot},sceneLoader:{cancel(){cancel++;}},retryGpu:{hidden:true},compatibilityRetry:{hidden:true},
  compileCheck:{hidden:true},transportIntegrityEnabled:false,separateSignals:false,galleryLabels:{children:[]},$};
 const present=Function(...Object.keys(bindings),functionSource(host,'presentFailure')+'\nreturn presentFailure;')(...Object.values(bindings));
 const message='GPU device lost (unknown) during Compiling trace: driver loss';present(message);present(message);
 assert.match(status.textContent,/during Compiling trace/);assert.match(status.textContent,/Medium mode: workgroup/);
 assert.equal(status.attributes.role,'alert');assert.equal(status.style.whiteSpace,'pre-line');
 assert.equal(state.errors.length,1);assert.equal(state.ready,false);assert.equal(state.paused,true);assert.equal(cancel,2);
 assert.deepEqual(mediumStackMode,before);for(const [id,control] of controls)assert.equal(control.value,id);
});
test('pre-device error names the stage before medium selection and the session import has an explicit revision',()=>{
 const messages=[],bindings={sessionClosed:false,gpuRuntime:null,startupStage:'Requesting GPU device',presentFailure:value=>messages.push(value)};
 const fail=Function(...Object.keys(bindings),functionSource(host,'fail')+'\nreturn fail;')(...Object.values(bindings));
 fail(Error('request denied'));assert.equal(messages[0],'Renderer failed during Requesting GPU device: request denied');
 assert.match(host,/gpu-session\.mjs\?revision=mobile-failure-context-1/);
});
