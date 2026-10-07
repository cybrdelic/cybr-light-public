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

async function runCase(name,{invalidTrace=false}={}){
 const calls=new Map(),modules=[],pipelines=[];let destroys=0;
 const limits={maxBufferSize:536870912,maxStorageBufferBindingSize:536870912,maxStorageBuffersPerShaderStage:8,maxComputeInvocationsPerWorkgroup:256,maxComputeWorkgroupSizeX:256,maxComputeWorkgroupSizeY:256,maxComputeWorkgroupStorageSize:32768};
 const device={limits,lost:new Promise(()=>{}),addEventListener(){},destroy(){destroys++;},
  createShaderModule({label,code}){const module={label,code,async getCompilationInfo(){const count=(calls.get(label)||0)+1;calls.set(label,count);if(count>1)throw Error('Duplicate shader-info request');return {messages:invalidTrace&&label==='trace'?[{type:'error',lineNum:7,message:'CPU validation fixture error'}]:[]};}};modules.push(module);return module;},
  async createRenderPipelineAsync(){return {diagnostic:true};},createBuffer({size}){assert.equal(size,16);return {size};},
  async createComputePipelineAsync(descriptor){pipelines.push(descriptor);return {compute:true};},
 };
 const adapter={limits,features:new Set(),info:{vendor:'cpu-fixture'},async requestDevice(){return device;}};
 const elements=Object.fromEntries(['case','status','report','copy','run'].map(id=>['#'+id,{value:name,options:[{value:name}],disabled:false,textContent:''}]));
 const window={addEventListener(){}};window.top=window;
 const document={visibilityState:'visible',querySelector:selector=>elements[selector],addEventListener(){},createElement(tag){assert.equal(tag,'canvas');return {width:300,height:150,getContext(){return {configure(){}};}};}};
 const sandbox={window,document,location:{search:'?case='+name},navigator:{userAgent:'CPU fixture, no GPU',gpu:{async requestAdapter(){return adapter;},getPreferredCanvasFormat:()=> 'bgra8unorm'}},sessionStorage:{setItem(){}},
  fetch:async path=>({ok:true,text:()=>readFile(new URL(path,import.meta.url),'utf8')}),crypto:webcrypto,TextEncoder,URLSearchParams,performance,setTimeout,clearTimeout,GPUBufferUsage:{UNIFORM:64,COPY_DST:8},
  rendererOptions,buildRendererShader,gpuDeviceOptions,traceCompileVariant,diagnosticShader,createCompileDeadline};
 new vm.Script(controller,{filename:'gpu-compile-check.mjs'}).runInNewContext(sandbox);
 await elements['#run'].onclick();
 return {report:window.cybrCompileCheck.snapshot(),calls,modules,pipelines,destroys};
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
