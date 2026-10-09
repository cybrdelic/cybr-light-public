import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {workgroupMediumStack} from './medium-stack-workgroup.mjs';
import {buildRendererShader} from './renderer-shaders.mjs';
import {rendererOptions} from './renderer-options.mjs';
const host=await readFile(new URL('./app.js',import.meta.url),'utf8');
function functionSource(source,name){
 const start=source.indexOf('function '+name+'('),open=source.indexOf('{',start);let depth=1,end=open+1;
 for(;depth;end++){if(source[end]==='{')depth++;if(source[end]==='}')depth--;}
 return (source.slice(start-6,start)==='async '?'async ':'')+source.slice(start,end);
}
function fixture(query,{memory=32768,compatibilityMode=false}={}){
 const parameters=new URLSearchParams(query),options=rendererOptions(parameters),moduleWorkgroups=new Map(),pipelineWorkgroups=new Map(),modules=[],calls=[];
 const device={limits:{maxComputeWorkgroupStorageSize:memory},createShaderModule({label,code}){
  const module={label,code,async getCompilationInfo(){return {messages:[]};}};modules.push(module);return module;
 }};
 const gpuRuntime={assertActive(){},setPhase(){},report(){},checkShaderInfo(module){return module.getCompilationInfo();},async compile(method,descriptor){assert.equal(method,'createComputePipelineAsync');return {descriptor};}};
 const fakeFetch=async path=>({ok:true,text:()=>readFile(new URL('./'+path,import.meta.url),'utf8')});
 const encoder={beginComputePass(){return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(...args){calls.push(args);},end(){}};}};
 const bindings={buildRendererShader,parameters,options,motionReconstruction:options.motionReconstruction,compatibilityMode,
  traceCompatibility(){throw Error('Old compact form must not run in this isolated fixture');},gpuRuntime,device,moduleWorkgroups,pipelineWorkgroups,
  workgroupMediumStack,fetch:fakeFetch,canvas:{width:960,height:540}};
 const api=Function(...Object.keys(bindings),functionSource(host,'shader')+'\n'+functionSource(host,'compileCompute')+'\n'+functionSource(host,'dispatch')+'\nreturn {shader,compileCompute,dispatch};')(...Object.values(bindings));
 return {...api,encoder,modules,calls,moduleWorkgroups};
}
test('integrated host shader/compile/dispatch uses GPU-validated exact bytes and 4x4 coverage',async()=>{
 const f=fixture('scene=proof-optics&glass=split&motion=bilinear&mediumStack=workgroup');
 const module=await f.shader('trace'),pipeline=await f.compileCompute({compute:{module,entryPoint:'main'}});
 assert.equal(createHash('sha256').update(module.code).digest('hex'),'9ff8fba4cecc7b6add647624e3d7507b0deb1a9e0a943fa8e56d251ef1fef30a');
 assert.equal(f.moduleWorkgroups.get(module),4);f.dispatch(f.encoder,pipeline,{});assert.deepEqual(f.calls,[[240,135,1]]);
});
test('legacy rollback retains original trace bytes and actual 8x8 host dispatch; reconstruction remains unchanged',async()=>{
 const f=fixture('scene=proof-optics&glass=split&motion=bilinear&mediumStack=legacy');
 const module=await f.shader('trace'),pipeline=await f.compileCompute({compute:{module,entryPoint:'main'}});
 assert.equal(createHash('sha256').update(module.code).digest('hex'),'563e314d2f974482c1b24c890067316eab892b7adeb8806ad688b15527a60b3f');
 f.dispatch(f.encoder,pipeline,{});assert.deepEqual(f.calls,[[120,68,1]]);
 const g=fixture('scene=proof-optics&mediumStack=workgroup');
 const reconstruct=await g.shader('reconstruct');assert.equal(g.moduleWorkgroups.get(reconstruct),8);
});
test('actual host rejects insufficient storage and incompatible compact mode before module creation',async()=>{
 const low=fixture('mediumStack=workgroup',{memory:8192});await assert.rejects(()=>low.shader('trace'),/budget/);assert.equal(low.modules.length,0);
 const compact=fixture('mediumStack=workgroup',{compatibilityMode:true});await assert.rejects(()=>compact.shader('trace'),/compact compatibility/);assert.equal(compact.modules.length,0);
});

test('scalar rollback retains its native-validated bytes and 8x8 dispatch',async()=>{
 const f=fixture('scene=proof-optics&glass=split&motion=bilinear&mediumStack=scalar');
 const module=await f.shader('trace'),pipeline=await f.compileCompute({compute:{module,entryPoint:'main'}});
 assert.equal(createHash('sha256').update(module.code).digest('hex'),'49cc7c138f6ea80a3e049429636b2956a329d8ea9dbf8963921a519d0bd22867');
 f.dispatch(f.encoder,pipeline,{});assert.deepEqual(f.calls,[[120,68,1]]);
});
