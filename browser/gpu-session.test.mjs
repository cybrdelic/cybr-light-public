import test from 'node:test';import assert from 'node:assert/strict';
import {probeGpuSession,gpuDeviceOptions,createGpuRuntime,validateGpuBuffer} from './gpu-session.mjs';
const canvas={getContext:()=>({})};
const gpu={requestAdapter:async()=>({}),getPreferredCanvasFormat:()=> 'bgra8unorm'};
test('reject insecure and unsupported contexts with actionable errors',async()=>{
 await assert.rejects(probeGpuSession(canvas,{gpu,secure:false}),{code:'insecure'});
 await assert.rejects(probeGpuSession(canvas,{gpu:null,secure:true}),{code:'unsupported'});
});

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const fakeDevice=()=>{const loss=deferred(),events={};return {
 lost:loss.promise,loss,events,destroyed:0,
 addEventListener(name,fn){events[name]=fn;},destroy(){this.destroyed++;},
};};
test('mobile/recovery omits optional timing; limits and explicit opt-in stay valid',()=>{
 const adapter={features:new Set(['timestamp-query']),limits:{maxComputeWorkgroupStorageSize:16384,maxStorageBufferBindingSize:128*1024*1024,maxBufferSize:256*1024*1024}};
 assert.deepEqual(gpuDeviceOptions(adapter).requiredFeatures,['timestamp-query']);
 for(const settings of [{mobile:true},{recovery:true},{timings:false}])assert.deepEqual(gpuDeviceOptions(adapter,settings).requiredFeatures,[]);
 assert.deepEqual(gpuDeviceOptions(adapter,{mobile:true,timings:true}).requiredFeatures,['timestamp-query']);
 assert.deepEqual(gpuDeviceOptions(adapter,{mobile:true}).requiredLimits,adapter.limits);
});
test('serialized compilation keeps original descriptors and order with one in flight',async()=>{
 const device=fakeDevice(),gate=deferred(),descriptors=[{label:'trace'},{label:'filter'}],calls=[];
 device.createComputePipelineAsync=async descriptor=>{calls.push(descriptor);if(calls.length===1)await gate.promise;return descriptor;};
 const runtime=createGpuRuntime(device,{serial:true});
 const pending=descriptors.map(d=>runtime.compile('createComputePipelineAsync',d));
 await Promise.resolve();assert.deepEqual(calls,[descriptors[0]]);
 gate.resolve();assert.deepEqual(await Promise.all(pending),descriptors);
 assert.deepEqual(calls,descriptors);
});
test('loss retains stage/reason when a later queue failure is reported',async()=>{
 const device=fakeDevice(),failures=[],runtime=createGpuRuntime(device,{onFailure:message=>failures.push(message)});
 runtime.setPhase('Compiling trace');
 device.loss.resolve({reason:'unknown',message:'A valid external Instance reference no longer exists.'});
 await Promise.resolve();
 runtime.report(Error('queue rejected'));
 assert.match(failures[0],/lost \(unknown\) during Compiling trace/);
 assert.equal(failures[1],failures[0]);
 assert.throws(runtime.assertActive,{name:'AbortError'});
});
test('shutdown cancels queued/in-flight startup and ignores intentional device loss',async()=>{
 const device=fakeDevice(),gate=deferred(),calls=[],failures=[];
 device.createComputePipelineAsync=async descriptor=>{calls.push(descriptor);await gate.promise;return descriptor;};
 const runtime=createGpuRuntime(device,{serial:true,onFailure:error=>failures.push(error)});
 const first=runtime.compile('createComputePipelineAsync',{}),second=runtime.compile('createComputePipelineAsync',{});
 const rejected=Promise.all([assert.rejects(first,{name:'AbortError'}),assert.rejects(second,{name:'AbortError'})]);
 await Promise.resolve();runtime.dispose();runtime.dispose();gate.resolve();
 device.loss.resolve({reason:'destroyed',message:'intentional'});
 await rejected;assert.equal(calls.length,1);assert.equal(device.destroyed,1);assert.deepEqual(failures,[]);
});
test('buffer preflight catches binding/allocation limits without changing legal sizes',()=>{
 const limits={maxBufferSize:256,maxStorageBufferBindingSize:128};
 assert.equal(validateGpuBuffer(97,128,limits),100);
 assert.equal(validateGpuBuffer(1,64,limits),16);
 assert.equal(validateGpuBuffer(200,64,limits),200);
 assert.throws(()=>validateGpuBuffer(132,128,limits),/permits 128/);
 assert.throws(()=>validateGpuBuffer(260,64,limits),/permits 256/);
 assert.throws(()=>validateGpuBuffer(NaN,128,limits),/Invalid/);
});
test('preference failure retries without requiring a browser-specific GPU',async()=>{
 const calls=[];const result=await probeGpuSession(canvas,{secure:true,gpu:{...gpu,requestAdapter:async options=>{calls.push(options);return options?null:{};}}});
 assert.equal(calls.length,2);assert.equal(calls[1],undefined);assert.equal(result.format,'bgra8unorm');
});
test('adapter, canvas, and format failure are distinguished',async()=>{
 await assert.rejects(probeGpuSession(canvas,{gpu:{...gpu,requestAdapter:async()=>null}}),{code:'adapter-unavailable'});
 await assert.rejects(probeGpuSession({getContext:()=>null},{gpu}),{code:'context-unavailable'});
 await assert.rejects(probeGpuSession({getContext:()=>{throw Error('provider');}},{gpu}),{code:'context-unavailable'});
 await assert.rejects(probeGpuSession(canvas,{gpu:{...gpu,getPreferredCanvasFormat:()=>{throw Error('format');}}}),{code:'format-unavailable'});
});
