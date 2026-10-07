// CPU only: verify original forest asset hashes, build resident raster data, count work.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {buildForestRasterData} from '../browser/forest-raster-worker.mjs';
import {buildForestClusterPlan,cullHierarchyCpu,sphereVisible,selectHierarchyLod} from '../browser/meshlet-hierarchy.mjs';
const [assetDirectory,outputFile,drawGroupArgument='1']=process.argv.slice(2);
if(!assetDirectory||!outputFile)throw Error('Usage: node tools/measure_forest_meshlets.mjs <original forest asset directory> <report.json>');
const sha=data=>createHash('sha256').update(new Uint8Array(data)).digest('hex');
const base=resolve(assetDirectory),manifest=JSON.parse(await readFile(join(base,'manifest.json'),'utf8'));
const rawBytes=gunzipSync(await readFile(join(base,'instrument.bin.gz'))),instanceBytes=gunzipSync(await readFile(join(base,'instances.bin.gz')));
assert.equal(rawBytes.byteLength,manifest.byteLength);assert.equal(sha(rawBytes),manifest.sha256);assert.equal(sha(instanceBytes),manifest.instanceSha256);
const raw=rawBytes.buffer.slice(rawBytes.byteOffset,rawBytes.byteOffset+rawBytes.byteLength),records=new Float32Array(instanceBytes.buffer,instanceBytes.byteOffset,instanceBytes.byteLength/4);
const instanceAt=i=>{const o=i*11;return {model:records[o],position:Array.from(records.subarray(o+1,o+4)),rotation:Array.from(records.subarray(o+4,o+8)),scale:records[o+8],leafMask:records[o+10]};};
const forest={raw,manifest,pile:{models:manifest.models,count:manifest.instanceCount,instanceAt,views:{}}};
const start=performance.now(),data=await buildForestRasterData(forest),detailBuildMs=performance.now()-start;
console.log(JSON.stringify({stage:'source LODs built',detailBuildMs,models:data.batches.length,instances:data.count}));
const original=data.batches.map(b=>b.levels.map(l=>({indices:sha(l.indices),vertices:sha(l.vertices)}))),counts=data.batches.map((_,i)=>new Uint32Array(data.draw)[i*32+6]);
const clusterStart=performance.now(),plan=buildForestClusterPlan(data.batches,counts,{drawGroupSize:Number(drawGroupArgument)}),clusterBuildMs=performance.now()-clusterStart;
for(let m=0;m<data.batches.length;m++)for(let k=0;k<4;k++)assert.equal(sha(data.batches[m].levels[k].vertices),original[m][k].vertices);
const generatedHash=()=>{const h=createHash('sha256');for(const buf of [plan.draw,plan.nodes,plan.models,...data.batches.flatMap(b=>b.levels.flatMap(l=>[l.indices,l.vertices]))])h.update(new Uint8Array(buf));return h.digest('hex');};
const digest=generatedHash(),instanceData=new Float32Array(data.instances),iw=new Uint32Array(data.instances),errors=new Float32Array(data.lodErrors);
const views={trail:{position:[-4,7,-8],target:[0,12,-26]},canopy:{position:[30,42,-25],target:[30,12,-26]},sky:{position:[30,6.35,-25],target:[30,24,-25.2]},clearing:{position:[18,9,-24],target:[-4,12,-30]},overview:{position:[145,115,140],target:[0,12,0]}};
const norm=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);},cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const measurements=[];
for(const [view,v] of Object.entries(views))for(const lodPixels of [0,.75]){
 const forward=norm(v.target.map((x,k)=>x-v.position[k])),right=norm(cross(forward,[0,1,0])),up=cross(right,forward),camera={eye:v.position,forward,right,up,tan:Math.tan(Math.PI/7),aspect:960/540,lodPixels};
 let baselineTriangles=0,baselineVisible=0;
 for(let i=0;i<data.count;i++){const o=i*12,p=Array.from(instanceData.subarray(o,o+3)),r=instanceData[o+10];if(!sphereVisible([...p,r],camera))continue;baselineVisible++;
  const model=iw[o+8],z=p.reduce((n,x,k)=>n+(x-camera.eye[k])*forward[k],0),level=selectHierarchyLod(errors.subarray(model*4,model*4+4),instanceData[o+3],z,r,camera,0);baselineTriangles+=data.batches[model].levels[level].indices.byteLength/12;
 }
 const t=performance.now(),culled=cullHierarchyCpu(plan,instanceData,camera);const cpuOracleMs=performance.now()-t;
 const result={view,lodPixels,baselineVisible,baselineTriangles,clusterTriangles:culled.triangles,triangleReduction:1-culled.triangles/baselineTriangles,nodesTested:culled.tested,nodesRejected:culled.rejected,cpuOracleMs,dispatches:1,workgroups:Math.ceil(data.count/128),comparison:'root sphere draws at the same LOD/hysteresis policy'};
 measurements.push(result);console.log(JSON.stringify(result));
}
const implementation={};for(const path of ['browser/meshlet-hierarchy.mjs','browser/forest-meshlet-cull.wgsl','browser/forest-raster-worker.mjs','browser/forest-game.mjs','browser/forest-detail.mjs','browser/vendor/meshoptimizer-1.3.0/meshopt_simplifier.js','browser/vendor/meshoptimizer-1.3.0/meshopt_encoder.js'])implementation[path]=sha(await readFile(new URL('../'+path,import.meta.url)));
const report={status:'CPU geometry/work counts only; GPU speed and visual acceptance pending',sourceCommit:'8f82e06ccadbc77f017eb3d6baba269d3eef93db',source:data.provenance,implementationSha256:implementation,generatedSha256:digest,models:data.batches.length,instances:data.count,detailBuildMs,clusterBuildMs,metrics:plan.metrics,measurements,gpuUsed:false,browserUsed:false,fullNanite:false,streamingImplemented:false};
await writeFile(resolve(outputFile),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:resolve(outputFile),generatedSha256:digest,metrics:plan.metrics}));
