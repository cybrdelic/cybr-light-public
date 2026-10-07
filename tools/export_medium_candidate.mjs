// CPU-only source export for the explicit medium candidate and supported modes.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {rendererOptions} from '../browser/renderer-options.mjs';
import {buildRendererShader} from '../browser/renderer-shaders.mjs';
import {mediumStackCandidate,mediumCandidateCases} from '../browser/medium-stack-candidate.mjs';
const load=name=>readFile(new URL('../browser/'+name,import.meta.url),'utf8');
const parameters=new URLSearchParams('scene=proof-optics&glass=split&motion=bilinear');
const source=await buildRendererShader('trace',{parameters,options:rendererOptions(parameters),load});
const hash=code=>createHash('sha256').update(code).digest('hex'),sourceSha256=hash(source);
const destination=resolve(process.argv[2]||'build/wgsl-medium-candidate');await mkdir(destination,{recursive:true});
const modules=[];
async function add(name,code,detail={}){
 await writeFile(resolve(destination,name+'.wgsl'),code);
 modules.push({name,bytes:Buffer.byteLength(code),sha256:hash(code),...detail});
}
await add('current-original',source,{entryPoint:'main'});
for(const name of mediumCandidateCases){
 const candidate=mediumStackCandidate(source,name,{sourceSha256});
 await add(name,candidate.code,{entryPoint:candidate.entryPoint,targetsExpanded:candidate.targets,commitsExpanded:candidate.commits,mediumSlots:16,workgroup:8});
}
for(const [label,name,query] of [['signals','trace','backend=signals'],['instanced','trace-pile',''],
 ['packed','trace-meshlets',''],['corrected','trace','transport=corrected'],['corrected-instanced','trace-pile','transport=corrected'],
 ['outside-corrected','outside-trace','transport=corrected'],['camera-corrected','camera-trace','transport=corrected']]){
 const parameters=new URLSearchParams(query+'&mediumStack=inline');
 await add(label,await buildRendererShader(name,{parameters,options:rendererOptions(parameters),load}),{entryPoint:'main',query:parameters.toString()});
}
for(const name of ['reconstruct','filter','display'])
 await add(name,await buildRendererShader(name,{parameters,options:rendererOptions(parameters),load}),name==='display'?{entryPoints:['vertex','fragment']}:{entryPoint:'main'});
await writeFile(resolve(destination,'manifest.json'),JSON.stringify({sourceSha256,modules,gpuUsed:false},null,2)+'\n');
console.log(JSON.stringify({output:destination,files:modules.length,sourceSha256,gpuUsed:false}));
