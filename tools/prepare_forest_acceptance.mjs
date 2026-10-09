// CPU-only real-scene plan and sampled clipping/LOD history rehearsal.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {buildForestRasterData} from '../browser/forest-raster-worker.mjs';
import {loadForest} from '../browser/forest-loader.mjs';
import {prepareAcceptanceInputs,auditLodState} from '../browser/forest-acceptance-plan.mjs';
import {cameraBasis} from '../browser/hybrid-geometry.mjs';
import {sphereVisible,selectHierarchyLod} from '../browser/meshlet-hierarchy.mjs';
const [assetDirectory,outputFile,group='8']=process.argv.slice(2);if(!assetDirectory||!outputFile)throw Error('Usage: node tools/prepare_forest_acceptance.mjs <forest assets> <plan.json> [1|8]');
const base=resolve(assetDirectory),sha=x=>createHash('sha256').update(x).digest('hex');
// Exercise the unchanged loader, including its authored views and hash checks.
// Local Response mocks read exactly three files; no network or browser is used.
const originalFetch=globalThis.fetch;let forest;
globalThis.fetch=async url=>{const name=new URL(url).pathname.slice(1);if(!['manifest.json','instrument.bin.gz','instances.bin.gz'].includes(name))throw Error('Unexpected forest asset request');return new Response(await readFile(join(base,name)));};
try{forest=await loadForest('https://cpu-forest.invalid/','forest');}finally{globalThis.fetch=originalFetch;}
const data=await buildForestRasterData(forest,{meshlets:true,limits:{drawGroupSize:Number(group)}}),input=prepareAcceptanceInputs(data,data.meshlets);
let previous=new Uint32Array(data.count);const rehearsal=[];
for(const test of input.manifest.cases){
 if(test.resetHistory)previous.fill(0);
 const camera={...cameraBasis(test.pose),aspect:960/540,lodPixels:test.lodPixels},states=new Uint32Array(data.count);
 // Only probes are rehearsed; GPU acceptance audits all instance history/populations.
 for(const probe of input.probes){const before=(previous[probe.id]>>>2)&3,relative=probe.position.map((x,k)=>x-camera.eye[k]),z=relative.reduce((sum,x,k)=>sum+x*camera.forward[k],0),visible=sphereVisible([...probe.position,probe.radius],camera),after=visible?selectHierarchyLod(probe.errors,probe.scale,z,probe.radius,camera,before):before;states[probe.id]=before|(after<<2)|(visible?16:0);}
 const minimal={...input,modelIds:input.modelIds};
 const audit=auditLodState(states,previous,minimal,camera);
 assert.equal(audit.historyErrors,0);assert.equal(audit.selectorErrors,0);assert.equal(audit.rootWitnessErrors,0);
 let promoted=0,demoted=0;for(const probe of input.probes){const before=states[probe.id]&3,after=(states[probe.id]>>>2)&3;assert.equal(before,(previous[probe.id]>>>2)&3);if(after>before)demoted++;if(after<before)promoted++;}
 previous.set(states);
 const target=test.targetId===null?null:{before:states[test.targetId]&3,after:(states[test.targetId]>>>2)&3,rootVisible:Boolean(states[test.targetId]&16)};
 rehearsal.push({index:test.index,view:test.view,kind:test.kind,promoted,demoted,target,clippedWitnesses:audit.clippedWitnesses,historyErrors:audit.historyErrors,selectorErrors:audit.selectorErrors,rootWitnessErrors:audit.rootWitnessErrors});
}
const report={status:'CPU preparation only; native geometry/image/transition acceptance pending',gpuUsed:false,browserUsed:false,source:data.provenance,manifest:input.manifest,rehearsal,implementationSha256:{}};
for(const file of ['browser/forest-acceptance-plan.mjs','browser/forest-acceptance-f32.mjs','browser/forest-acceptance.mjs','browser/forest-acceptance-depth.wgsl','browser/forest-acceptance-reset.wgsl','tools/meshlet-acceptance.browser.js','tools/meshlet_validation_server.py'])report.implementationSha256[file]=sha(await readFile(new URL('../'+file,import.meta.url)));
await mkdir(dirname(resolve(outputFile)),{recursive:true});await writeFile(resolve(outputFile),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output:resolve(outputFile),cases:input.manifest.cases.length,probes:input.probes.length,targets:input.manifest.targets,gpuUsed:false}));
