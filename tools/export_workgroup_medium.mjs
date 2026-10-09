// Export the pinned native candidate/control matrix without launching a GPU.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {buildRendererShader} from '../browser/renderer-shaders.mjs';
import {rendererOptions} from '../browser/renderer-options.mjs';
import {traceCompileProbe} from '../browser/trace-compile-probes.mjs';
import {workgroupMediumStack,wgslFunctions} from '../browser/medium-stack-workgroup.mjs';
const load=name=>readFile(new URL('../browser/'+name,import.meta.url),'utf8');
const hash=code=>createHash('sha256').update(code).digest('hex');
const destination=pathToFileURL(resolve(process.argv[2]||'build/wgsl-workgroup-medium')+'/');await mkdir(destination,{recursive:true});
const modules=[];
async function add(name,code,detail={}){
 await writeFile(new URL(name+'.wgsl',destination),code);
 modules.push({name,bytes:Buffer.byteLength(code),sha256:hash(code),...detail});
}
async function build(name,query){const parameters=new URLSearchParams(query);return buildRendererShader(name,{load,parameters,options:rendererOptions(parameters)});}
async function candidate(label,source){
 const transformed=workgroupMediumStack(source),{code,...detail}=transformed;
 const originalFunctions=wgslFunctions(source),candidateFunctions=wgslFunctions(code);
 const unchangedFunctions=[];
 for(const fn of originalFunctions){
  if(detail.entries.some(entry=>entry.name===fn.name)||detail.allocations?.some(entry=>entry.function===fn.name)||['mediumExitSlot','mediumTarget','commitMedium','initializeCameraStack'].includes(fn.name))continue;
  const other=candidateFunctions.find(x=>x.name===fn.name);
  if(!other||source.slice(fn.start,fn.end)!==code.slice(other.start,other.end))throw Error('Unrelated function changed: '+fn.name);
  unchangedFunctions.push({name:fn.name,sha256:hash(source.slice(fn.start,fn.end))});
 }
 await add(label+'-workgroup',code,{...detail,originalSha256:hash(source),unchangedFunctions});
}
const source=await build('trace','scene=proof-optics&glass=split&motion=bilinear');
await add('current-original',source);await add('current-v10-scalar',await build('trace','scene=proof-optics&glass=split&motion=bilinear&mediumStack=scalar'));
await candidate('current',source);
const probe=traceCompileProbe(source,'medium',{sourceSha256:hash(source)}).code;
await add('medium-original',probe);await candidate('medium',probe);
for(const [label,name,query] of [['signals','trace','backend=signals'],['instanced','trace-pile',''],['packed','trace-meshlets',''],['corrected','trace','transport=corrected'],['corrected-instanced','trace-pile','transport=corrected'],['outside-corrected','outside-trace','transport=corrected'],['camera-corrected','camera-trace','transport=corrected']])
 await candidate(label,await build(name,query));
await writeFile(new URL('manifest.json',destination),JSON.stringify({sourceSha256:hash(source),modules,gpuUsed:false,physicalAdrenoVerified:false,hostIntegrationRequired:'Use 4x4 dispatch metadata for transformed trace entries; camera pass unchanged.'},null,2)+'\n');
console.log(JSON.stringify({modules:modules.length,gpuUsed:false,physicalAdrenoVerified:false}));
