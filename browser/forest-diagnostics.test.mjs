import test from 'node:test';
import assert from 'node:assert/strict';
import {createForestDiagnostics} from './forest-diagnostics.mjs';
function fixture(){const events=[],values=new Float32Array(32),uniform={},indirect={},stats={},drawWords=new Uint32Array(8);let release;
 const drain=new Promise(resolve=>release=resolve),queue={onSubmittedWorkDone:()=>{events.push('drain');return drain;},writeBuffer:(buffer,_,data)=>events.push({write:buffer,data:Array.from(data)}),submit:()=>events.push('submit')};
 const device={queue,createCommandEncoder:()=>({beginComputePass:()=>({setPipeline:()=>events.push('pipeline'),setBindGroup:()=>events.push('group'),dispatchWorkgroups:n=>events.push({dispatch:n}),end:()=>events.push('end')}),finish:()=>({})})};
 const readBuffer=async(_,source,range)=>{events.push({read:source,size:range.size});return new Uint32Array([9,30,7,0]).buffer;};
 const diagnostics=createForestDiagnostics({device,uniform,indirect,stats,drawWords,uniforms:()=>values,compute:{},computeGroup:{},workgroups:2,readBuffer});
 return {diagnostics,events,values,uniform,indirect,stats,release};
}
test('counter snapshot drains old frames, applies counters, culls, then copies while frame submissions are suspended',async()=>{
 const f=fixture(),pending=f.diagnostics.capture({counters:true});assert.equal(f.diagnostics.busy,true);assert.deepEqual(f.events,['drain']);
 await assert.rejects(f.diagnostics.capture({counters:true}),/in progress/);f.release();const sample=await pending;
 assert.equal(f.diagnostics.busy,false);assert.equal(sample.sampling,'dedicated-current-cull');assert.equal(sample.countersEnabled,true);assert.deepEqual(Array.from(new Uint32Array(sample.bytes)),[9,30,7,0]);
 assert.equal(f.values[31],0);assert.equal(f.events.find(e=>e.write===f.uniform).data[31],1);
 assert.ok(f.events.indexOf('submit')<f.events.findIndex(e=>e.read===f.stats));assert.deepEqual(f.events.find(e=>e.write===f.stats).data,[0,0,0,0]);
});
test('draw diagnostics use the same ordered cull and clear busy after failure',async()=>{
 const f=fixture(),pending=f.diagnostics.capture();f.release();const sample=await pending;assert.equal(sample.countersEnabled,false);assert.equal(f.events.at(-1).read,f.indirect);
 const broken=createForestDiagnostics({device:{queue:{onSubmittedWorkDone:async()=>{throw Error('lost');}}}});await assert.rejects(broken.capture(),/lost/);assert.equal(broken.busy,false);
});
