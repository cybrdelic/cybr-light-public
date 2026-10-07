import test from 'node:test';import assert from 'node:assert/strict';
import {probeGpuSession} from './gpu-session.mjs';
const canvas={getContext:()=>({})};
const gpu={requestAdapter:async()=>({}),getPreferredCanvasFormat:()=> 'bgra8unorm'};
test('reject insecure and unsupported contexts with actionable errors',async()=>{
 await assert.rejects(probeGpuSession(canvas,{gpu,secure:false}),{code:'insecure'});
 await assert.rejects(probeGpuSession(canvas,{gpu:null,secure:true}),{code:'unsupported'});
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
