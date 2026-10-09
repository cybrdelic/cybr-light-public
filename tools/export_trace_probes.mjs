// Reproduce the CPU-validated, compile-only WGSL diagnostics; no GPU required.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {rendererOptions} from '../browser/renderer-options.mjs';
import {buildRendererShader} from '../browser/renderer-shaders.mjs';
import {traceCompileProbe,traceProbeCases,traceProbeSourceSha256} from '../browser/trace-compile-probes.mjs';
const parameters=new URLSearchParams('scene=proof-optics&glass=split&motion=bilinear');
const source=await buildRendererShader('trace',{parameters,options:rendererOptions(parameters),load:name=>readFile(new URL('../browser/'+name,import.meta.url),'utf8')});
const hash=code=>createHash('sha256').update(code).digest('hex'),sourceSha256=hash(source);
if(sourceSha256!==traceProbeSourceSha256)throw Error('Probe baseline changed; review before export');
const destination=resolve(process.argv[2]||'build/wgsl-probes');await mkdir(destination,{recursive:true});
await writeFile(resolve(destination,'current-trace.wgsl'),source);
for(const name of traceProbeCases){const probe=traceCompileProbe(source,name,{sourceSha256});await writeFile(resolve(destination,name+'.wgsl'),probe.code);}
console.log(JSON.stringify({output:destination,files:traceProbeCases.length+1,sourceSha256,gpuUsed:false}));
