// CPU-only reconstruction of the actual startup shaders and comparison shapes.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildRendererShader} from '../browser/renderer-shaders.mjs';
import {rendererOptions} from '../browser/renderer-options.mjs';
import {traceCompileVariant} from '../browser/trace-compatibility.mjs';
const parameters=new URLSearchParams('scene=proof-optics&glass=split&motion=bilinear');
const load=name=>readFile(new URL('../browser/'+name,import.meta.url),'utf8');
const options=rendererOptions(parameters),stats=code=>({bytes:Buffer.byteLength(code),sha256:createHash('sha256').update(code).digest('hex'),functions:[...code.matchAll(/\bfn\s+(\w+)\(/g)].map(m=>m[1]),workgroups:[...code.matchAll(/@workgroup_size\(([^)]+)\)/g)].map(m=>m[1]),arrayDeclarations:[...code.matchAll(/array<[^;\n]+/g)].map(m=>m[0])});
const report={gpuUsed:false,sceneWorkerStartedBeforeTraceCompilation:false,sceneBuffersBeforeTraceCompilation:0,frameBuffersBeforeTraceCompilation:0,gpuBufferBytesBeforeTraceCompilation:16,canvasConfiguredBeforeTraceCompilation:true,modules:{},comparisons:{},limitsRequested:['maxComputeWorkgroupStorageSize<=32768','maxStorageBufferBindingSize<=512MiB','maxBufferSize<=512MiB'],notes:['Adapter limits are recorded by the browser check; CPU analysis cannot report them.','Private array ABI size is not measured GPU memory or register usage.','The exact browser error also occurs on pending callbacks during channel teardown.']};
for(const name of ['trace','reconstruct','filter','display'])report.modules[name]=stats(await buildRendererShader(name,{load,parameters,options}));
const source=await buildRendererShader('trace',{load,parameters,options});
for(const name of ['tiny','full-control','current','default-limits','workgroup-4','compact-media','compat','host-prefix']){
 const variant=traceCompileVariant(source,name);report.comparisons[name]={...stats(variant.code),entryPoint:variant.entryPoint,mediumSlots:variant.mediumSlots||16};
}
report.mediumStackLogicalBytes={current:336,compact:208};
report.sceneComparison={};
for(const scene of ['example-geo-printer','proof-optics']){
 const sceneParameters=new URLSearchParams('glass=split&motion=bilinear');sceneParameters.set('scene',scene);
 const code=await buildRendererShader('trace',{load,parameters:sceneParameters,options:rendererOptions(sceneParameters)});
 report.sceneComparison[scene]={current:stats(code),compact:stats(traceCompileVariant(code,'compat').code)};
}
report.sceneComparison.identicalCurrent=report.sceneComparison['example-geo-printer'].current.sha256===report.sceneComparison['proof-optics'].current.sha256;
report.sceneComparison.identicalCompact=report.sceneComparison['example-geo-printer'].compact.sha256===report.sceneComparison['proof-optics'].compact.sha256;
console.log(JSON.stringify(report,null,2));
