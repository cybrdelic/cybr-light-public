// CPU-only reproduction against a captured native acceptance pair.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {loadForest} from '../browser/forest-loader.mjs';
import {buildForestRasterData} from '../browser/forest-raster-worker.mjs';
import {cullHierarchyCpu,sphereVisible,rotate} from '../browser/meshlet-hierarchy.mjs';
import {triangleIntersects,predictFallbackCounts,auditDrawCounts} from '../browser/forest-acceptance-plan.mjs';
const [assets,pairPath,outputPath]=process.argv.slice(2);if(!assets||!pairPath||!outputPath)throw Error('Usage: node tools/reproduce_fallback_acceptance.mjs <forest assets> <captured pair.json> <proof.json>');
const pair=JSON.parse(await readFile(resolve(pairPath),'utf8')),u=pair.appliedUniforms,camera={eye:u.slice(0,3),right:u.slice(4,7),up:u.slice(8,11),forward:u.slice(12,15),tan:u[15],aspect:u[7],lodPixels:u[30]};
assert.equal(pair.resetHistory,true,'This reproduction requires an explicitly reset history');
const originalFetch=globalThis.fetch;let forest;globalThis.fetch=async url=>{const name=new URL(url).pathname.slice(1);if(!['manifest.json','instrument.bin.gz','instances.bin.gz'].includes(name))throw Error('Unexpected asset');return new Response(await readFile(join(resolve(assets),name)));};
try{forest=await loadForest('https://cpu-forest.invalid/','forest');}finally{globalThis.fetch=originalFetch;}
const data=await buildForestRasterData(forest,{meshlets:true,limits:{drawGroupSize:8}}),plan=data.meshlets,values=new Float32Array(data.instances),iw=new Uint32Array(data.instances),nodes=new Float32Array(plan.nodes),models=new Uint32Array(plan.models),words=new Uint32Array(plan.draw);
const result=cullHierarchyCpu(plan,values,camera),populations=new Uint32Array(data.batches.length*4),packed=new Uint32Array(data.count),rootIds=Array.from({length:populations.length},()=>[]);
for(let i=0;i<data.count;i++){const o=i*12,visible=sphereVisible([values[o],values[o+1],values[o+2],values[o+10]],camera);packed[i]=(result.previous[i]<<2)|(visible?16:0);if(visible){const key=iw[o+8]*4+result.previous[i];populations[key]++;rootIds[key].push(i);}}
const sha=x=>createHash('sha256').update(x).digest('hex'),stateSha256=sha(new Uint8Array(packed.buffer)),mismatches=[];let referenceTriangles=0;
plan.records.forEach((record,draw)=>{const referenceCount=populations[record.model*4+record.level],normalCount=result.visible[draw].length;referenceTriangles+=referenceCount*record.indexCount/3;if(!record.clustered&&referenceCount!==normalCount){const accepted=new Set(result.visible[draw]);mismatches.push({draw,model:record.model,id:data.batches[record.model].id,level:record.level,indexCount:record.indexCount,referenceRootCount:referenceCount,expectedNormalCount:normalCount,excludedIds:rootIds[record.model*4+record.level].filter(i=>!accepted.has(i))});}});
console.log(JSON.stringify({stage:'counts reproduced',fallbackMismatches:mismatches.length,expectedNormalTriangles:result.triangles,referenceTriangles,stateSha256,gpuStateSha256:pair.lodStateSha256,stateExact:stateSha256===pair.lodStateSha256,expectedRejectedNodes:result.rejected,gpuRejectedNodes:pair.normalCounters[2]}));
assert.equal(stateSha256,pair.lodStateSha256,'CPU selected/root state must match every captured GPU state word');assert.equal(result.triangles,pair.draw.normalTriangles);assert.equal(referenceTriangles,pair.draw.referenceTriangles);assert.equal(result.rejected,pair.normalCounters[2]);assert.equal(mismatches.length,pair.draw.fallbackErrors);
const modelIds=new Uint16Array(data.count),fallbackDraws=new Int32Array(data.batches.length*4).fill(-1),fallbackSpheres=new Float32Array(data.batches.length*16),normalWords=words.slice(),referenceWords=words.slice();
for(let i=0;i<data.count;i++)modelIds[i]=iw[i*12+8];
plan.records.forEach((record,draw)=>{const key=record.model*4+record.level;normalWords[draw*8+1]=result.visible[draw].length;referenceWords[draw*8+1]=populations[key];if(!record.clustered){fallbackDraws[key]=draw;const root=models[record.model*8+record.level];fallbackSpheres.set(nodes.subarray(root*8,root*8+4),key*4);}});
const input={modelIds,instanceTransforms:values,fallbackDraws,fallbackSpheres,records:plan.records,drawWords:words},predicted=predictFallbackCounts(packed,input,camera);
let fallbackDrawsVerified=0;plan.records.forEach((record,draw)=>{if(!record.clustered){assert.equal(predicted[draw],result.visible[draw].length,'Corrected oracle must equal traversal for every fallback draw');fallbackDrawsVerified++;}});
const correctedAudit=auditDrawCounts(normalWords,referenceWords,input,populations,predicted);assert.equal(correctedAudit.overflow,0);assert.equal(correctedAudit.referenceErrors,0);assert.equal(correctedAudit.fallbackErrors,0);
const dot=(a,b)=>a.reduce((n,x,k)=>n+x*b[k],0),planes=[p=>dot(p,camera.forward)-.05,p=>dot(p,camera.forward)*camera.tan*camera.aspect-dot(p,camera.right),p=>dot(p,camera.forward)*camera.tan*camera.aspect+dot(p,camera.right),p=>dot(p,camera.forward)*camera.tan-dot(p,camera.up),p=>dot(p,camera.forward)*camera.tan+dot(p,camera.up)];
let excludedInstances=0,testedTriangles=0,visibleExcludedTriangles=0,boundsErrors=0;
for(const item of mismatches){
 const lod=data.batches[item.model].levels[item.level],vertices=new Float32Array(lod.vertices),indices=new Uint32Array(lod.indices),root=models[item.model*8+item.level],localSphere=Array.from(nodes.subarray(root*8,root*8+4)),unique=[...new Set(indices)];
 let maximumLocalDistance=0;for(const index of unique){const p=vertices.subarray(index*10,index*10+3);maximumLocalDistance=Math.max(maximumLocalDistance,Math.hypot(...Array.from(p,(x,k)=>x-localSphere[k])));}assert.ok(maximumLocalDistance<=localSphere[3]);
 item.selectedLodSphere=localSphere;item.maximumReferencedVertexDistance=maximumLocalDistance;item.localContainmentMargin=localSphere[3]-maximumLocalDistance;item.instances=[];
 for(const id of item.excludedIds){const o=id*12,position=Array.from(values.subarray(o,o+3)),scale=values[o+3],q=Array.from(values.subarray(o+4,o+8)),center=rotate(q,localSphere.slice(0,3).map(x=>x*scale)).map((x,k)=>x+position[k]),sphere=[...center,localSphere[3]*Math.abs(scale)],transformed=new Map(),maxima=planes.map(()=>-Infinity);let visible=0,maxDistance=0;
  assert.equal(sphereVisible([...position,values[o+10]],camera),true);assert.equal(sphereVisible(sphere,camera),false);
  for(const index of unique){const p=rotate(q,Array.from(vertices.subarray(index*10,index*10+3)).map(x=>x*scale)).map((x,k)=>x+position[k]);transformed.set(index,p);const relative=p.map((x,k)=>x-camera.eye[k]);planes.forEach((plane,k)=>maxima[k]=Math.max(maxima[k],plane(relative)));maxDistance=Math.max(maxDistance,Math.hypot(...p.map((x,k)=>x-center[k])));}
  if(maxDistance>sphere[3]+1e-7)boundsErrors++;
  for(let t=0;t<indices.length;t+=3){testedTriangles++;if(triangleIntersects(Array.from(indices.subarray(t,t+3),index=>transformed.get(index)),camera)){visible++;visibleExcludedTriangles++;}}
  assert.equal(visible,0);assert.ok(indices.length===0||maxima.some(x=>x<0),'Every referenced vertex must lie outside one common clipping plane');
  item.instances.push({id,position,scale,rotation:q,fullRootRadius:values[o+10],worldSelectedSphere:sphere,maximumWorldVertexDistance:maxDistance,planeMaximumSignedDistances:maxima,clippedVisibleTriangles:visible});excludedInstances++;
 }
 delete item.excludedIds;
}
assert.equal(boundsErrors,0);assert.equal(visibleExcludedTriangles,0);
const report={status:'CPU proves the fallback equality assumption was wrong; production implementation unchanged',gpuUsed:false,browserUsed:false,capturedPairSha256:sha(await readFile(resolve(pairPath))),source:data.provenance,appliedUniforms:u,stateSha256,expectedNormalTriangles:result.triangles,referenceTriangles,fallbackMismatches:mismatches.length,excludedInstances,testedTriangles,visibleExcludedTriangles,boundsErrors,fallbackDrawsVerified,correctedAudit,mismatches,proof:'all selected/root state words and aggregate draw/rejection counts match GPU; all referenced selected-LOD vertices are enclosed, every excluded instance lies beyond a common clipping plane, and exhaustive independent triangle clipping finds no intersection; corrected oracle equals traversal for every fallback draw'};
await mkdir(dirname(resolve(outputPath)),{recursive:true});await writeFile(resolve(outputPath),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({stage:'coverage proved',output:resolve(outputPath),excludedInstances,testedTriangles,visibleExcludedTriangles,boundsErrors}));
