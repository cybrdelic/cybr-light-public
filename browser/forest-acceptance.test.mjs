import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {triangleIntersects,prepareAcceptanceInputs,auditLodState,predictFallbackCounts,auditDrawCounts,compareCoverage} from './forest-acceptance-plan.mjs';
import {buildForestClusterPlan,sphereVisible,rotate} from './meshlet-hierarchy.mjs';
import {transformSphereF32,traceSphereF32} from './forest-acceptance-f32.mjs';
const camera={eye:[0,0,0],forward:[0,0,1],right:[1,0,0],up:[0,1,0],tan:1,aspect:1,lodPixels:.75};
test('independent clipping catches an edge-crossing triangle with all original vertices outside',()=>{
 assert.equal(triangleIntersects([[-2,-2,1],[2,-2,1],[0,2,1]],camera),true);
 assert.equal(triangleIntersects([[2,2,1],[3,2,1],[2,3,1]],camera),false);
 assert.equal(triangleIntersects([[0,0,-1],[.1,0,-1],[0,.1,-1]],camera),false);
});
test('coverage rejects a missing single MSAA sample even when the other three match',()=>{
 const color=new Uint8Array([10,20,30,255]),depth=new Float32Array([.5,.5,.5,.5]);
 const a={color,depth:depth.slice()},b={color,depth};a.depth[2]=0;
 const r=compareCoverage(a,b);assert.equal(r.missingSamples,1);assert.equal(r.geometryPassed,false);assert.equal(r.imageExact,true);
 assert.equal(compareCoverage(b,b).geometryPassed,true);
 const nearer={color,depth:new Float32Array([.6,.5,.5,.5])};assert.equal(compareCoverage(b,nearer).closerReferenceSamples,1);
 assert.equal(compareCoverage({...b,color:new Uint8Array([11,20,30,255])},b).imageExact,false);
});
test('depth readback uses a stored attachment and rejects vacuous all-clear coverage',async()=>{
 const source=await readFile(new URL('./forest-acceptance.mjs',import.meta.url),'utf8');
 assert.match(source,/depthStoreOp:'store'/);assert.doesNotMatch(source,/depthStoreOp:'discard'/);
 const color=new Uint8Array([10,20,30,255]),clear={color,depth:new Float32Array(4)};
 assert.equal(compareCoverage(clear,clear).geometryPassed,false);
 assert.equal(compareCoverage(clear,clear).referenceCoveredSamples,0);
});
test('LOD audit checks prior-state continuity, selected levels and a root clipping witness',()=>{
 const input={modelIds:new Uint16Array([0]),records:[{model:0,level:0,clustered:false}],probes:[{id:0,position:[0,0,5],scale:1,rotation:[0,0,0,1],radius:1,leafMask:1,errors:[0,1,2,3],triangles:Array.from({length:4},()=>[{mask:1,points:[[0,0,0],[.1,0,0],[0,.1,0]]}])}]};
 const okay=auditLodState(new Uint32Array([16]),null,input,camera);assert.equal(okay.historyErrors,0);assert.equal(okay.selectorErrors,0);assert.equal(okay.clippedWitnesses,1);assert.equal(okay.visible,1);
 assert.equal(auditLodState(new Uint32Array([0]),null,input,camera).rootWitnessErrors,1);
 assert.equal(auditLodState(new Uint32Array([17]),null,input,camera).historyErrors,1);
 assert.equal(auditLodState(new Uint32Array([20]),null,input,camera).selectorErrors,1);
});
test('draw audit requires complete reference populations and exact selected-LOD fallback counts, and catches capacity overflow',()=>{
 const input={records:[{model:0,level:0,clustered:true},{model:1,level:0,clustered:false}],drawWords:new Uint32Array([3,0,0,0,0,0,2,0,6,0,0,0,0,0,1,0])};
 const normal=input.drawWords.slice(),reference=input.drawWords.slice(),populations=new Uint32Array([2,0,0,0,1,0,0,0]);normal[1]=1;reference[1]=2;normal[9]=reference[9]=1;
 const expected=new Uint32Array([0,1]);assert.deepEqual(auditDrawCounts(normal,reference,input,populations,expected),{overflow:0,referenceErrors:0,fallbackErrors:0,normalTriangles:3,referenceTriangles:4});
 normal[9]=0;assert.equal(auditDrawCounts(normal,reference,input,populations,expected).fallbackErrors,1);
 normal[1]=3;assert.equal(auditDrawCounts(normal,reference,input,populations,expected).overflow,1);
 reference[1]=1;assert.equal(auditDrawCounts(normal,reference,input,populations,expected).referenceErrors,1);
 assert.throws(()=>auditDrawCounts(normal,reference,input,populations),/Explicit/);
});
test('captured crown-0 LOD3 regression: full root visible, selected bounds outside; a truly visible omission still fails',()=>{
 // Exact failed-pair instance 1036, draw 441, and selected node from the CPU proof.
 const u=[-4,7,-8,0,.9761870503425598,0,.21693046391010284,1.7777777910232544,-.056773293763399124,.965146005153656,.2554798424243927,0,.20936957001686096,.2617119550704956,-.9421630501747131,.4815746247768402],c={eye:u.slice(0,3),right:u.slice(4,7),up:u.slice(8,11),forward:u.slice(12,15),tan:u[15],aspect:u[7]};
 const input={modelIds:new Uint16Array([0]),instanceTransforms:new Float32Array([44.608856201171875,13.384112358093262,-43.41691589355469,1.3304548263549805,0,.9413946270942688,0,-.3373071849346161,0,0,1.2161049842834473,0]),fallbackDraws:new Int32Array([-1,-1,-1,0]),fallbackSpheres:new Float32Array(16),records:[{model:0,level:3,clustered:false}],drawWords:new Uint32Array([48,0,0,0,0,0,1,0])};
 input.fallbackSpheres.set([-.05975784733891487,.028043832629919052,-.2617737054824829,.5757023692131042],12);
 assert.equal(sphereVisible([...input.instanceTransforms.slice(0,3),input.instanceTransforms[10]],c),true);
 const states=new Uint32Array([28]),population=new Uint32Array([0,0,0,1]),normal=input.drawWords.slice(),reference=input.drawWords.slice();reference[1]=1;
 let expected=predictFallbackCounts(states,input,c);assert.equal(expected[0],0);assert.equal(auditDrawCounts(normal,reference,input,population,expected).fallbackErrors,0);
 normal[1]=1;assert.equal(auditDrawCounts(normal,reference,input,population,expected).fallbackErrors,1);
 input.instanceTransforms.set(c.eye.map((x,k)=>x+c.forward[k]*10),0);expected=predictFallbackCounts(states,input,c);assert.equal(expected[0],1);
 normal[1]=0;assert.equal(auditDrawCounts(normal,reference,input,population,expected).fallbackErrors,1);normal[1]=1;assert.equal(auditDrawCounts(normal,reference,input,population,expected).fallbackErrors,0);
});
test('pair 26 litter-1 binary32 tangent is retained exactly; one plane ULP outside is rejected without count tolerance',()=>{
 const c={eye:[30,43.921669006347656,-24.935943603515625],right:[1,0,0],up:[0,.03331483155488968,-.9994449019432068],forward:[0,-.9994449019432068,-.03331483155488968],tan:.4815746247768402,aspect:1.7777777910232544};
 const values=new Float32Array([-4.562016487121582,4.065891742706299,-38.81321716308594,.5241690874099731,0,.9211434125900269,0,-.3892233669757843,0,0,.048114512115716934,0]),local=[0,.00030625000363215804,0,.0917915627360344];
 const sphere64=[...rotate(Array.from(values.slice(4,8)),local.slice(0,3).map(x=>x*values[3])).map((x,k)=>x+values[k]),local[3]*values[3]],trace=traceSphereF32(transformSphereF32(local,values,0),c);
 assert.equal(sphereVisible(sphere64,c),false);assert.equal(trace.visible,true);assert.equal(trace.horizontal,34.562015533447266);assert.equal(Math.abs(trace.x),trace.horizontal);assert.equal(trace.margins.horizontal,0);
 const input={modelIds:new Uint16Array([0]),instanceTransforms:values,fallbackDraws:new Int32Array([-1,-1,-1,0]),fallbackSpheres:new Float32Array(16),records:[{model:0,level:3,clustered:false}],drawWords:new Uint32Array([18,0,0,0,0,0,1,0])};input.fallbackSpheres.set(local,12);
 const state=new Uint32Array([31]),population=new Uint32Array([0,0,0,1]),normal=input.drawWords.slice(),reference=input.drawWords.slice();reference[1]=1;let predicted=predictFallbackCounts(state,input,c);assert.equal(predicted[0],1);
 normal[1]=1;assert.equal(auditDrawCounts(normal,reference,input,population,predicted).fallbackErrors,0);normal[1]=0;assert.equal(auditDrawCounts(normal,reference,input,population,predicted).fallbackErrors,1);
 values[0]=Math.fround(values[0]-2**-18);predicted=predictFallbackCounts(state,input,c);assert.equal(predicted[0],0);assert.equal(traceSphereF32(transformSphereF32(local,values,0),c).margins.horizontal,-(2**-18));normal[1]=1;assert.equal(auditDrawCounts(normal,reference,input,population,predicted).fallbackErrors,1);
});
test('acceptance plan is deterministic, bounded, resets each view and includes a real threshold round trip',()=>{
 const vertex=new Float32Array(30);vertex.set([0,0,0]);vertex.set([1,0,0],10);vertex.set([0,1,0],20);
 const batches=[{id:'fixture',radius:1,levels:[0,.01,.02,.04].map(error=>({vertices:vertex.slice().buffer,indices:new Uint32Array([0,1,2]).buffer,error}))}];
 // A fixture needs several bounded clusters to be admitted; force different masks.
 const v=new Float32Array(180*3*10),w=new Uint32Array(v.buffer),ix=new Uint32Array(180*3);for(let i=0;i<ix.length;i++){v.set([(i%3)*.01,Math.floor(i/3)*.001,0],i*10);w[i*10+9]=(Math.floor(i/3)%2)+1;ix[i]=i;}
 batches[0].levels=[0,.01,.02,.04].map(error=>({vertices:v.slice().buffer,indices:ix.slice().buffer,error}));
 const instances=new Float32Array([0,0,0,1,0,0,0,1,0,0,1,0]);new Uint32Array(instances.buffer)[9]=3;
 const plan=buildForestClusterPlan(batches,[1]),data={instances:instances.buffer,count:1,batches,views:{trail:{position:[0,0,-7],target:[0,0,0]}}};
 const a=prepareAcceptanceInputs(data,plan),b=prepareAcceptanceInputs(data,plan);assert.deepEqual(a.manifest,b.manifest);assert.ok(a.manifest.cases.length<=80);assert.ok(a.probes.length<=256);assert.equal(a.manifest.cases[0].resetHistory,true);assert.equal(a.manifest.cases[1].resetHistory,true);
 assert.ok(a.manifest.targets[0].target);assert.ok(a.manifest.cases.some(x=>x.kind==='after-demote'));assert.ok(a.manifest.cases.some(x=>x.kind==='after-promote'));
});
