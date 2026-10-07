// CPU-only export through the actual renderer builder; no GPU or browser needed.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildRendererShader} from '../browser/renderer-shaders.mjs';
import {rendererOptions} from '../browser/renderer-options.mjs';
import {traceCompileProbe} from '../browser/trace-compile-probes.mjs';
import {inlineMediumStack} from '../browser/medium-stack-inline.mjs';
import {scalarMediumStack} from '../browser/medium-stack-scalar.mjs';
const load=name=>readFile(new URL('../browser/'+name,import.meta.url),'utf8');
const hash=code=>createHash('sha256').update(code).digest('hex');
const query='scene=proof-optics&glass=split&motion=bilinear';
async function build(name,query,mode){
 const parameters=new URLSearchParams(query);if(mode)parameters.set('mediumStack',mode);
 return buildRendererShader(name,{load,parameters,options:rendererOptions(parameters)});
}
export async function scalarMediumModules(){
 const source=await build('trace',query),sourceSha256=hash(source),modules=[];
 const add=(name,code,entryPoint='main',detail={})=>modules.push({name,code,entryPoint,bytes:Buffer.byteLength(code),sha256:hash(code),...detail});
 for(const [label,original,entry] of [['current',source,'main'],['medium',traceCompileProbe(source,'medium',{sourceSha256}).code,'probeMedium']]){
  add(label+'-original',original,entry);
  add(label+'-inline',label==='current'?await build('trace',query,'inline'):inlineMediumStack(original).code,entry);
  const candidate=scalarMediumStack(original),code=label==='current'?await build('trace',query,'scalar'):candidate.code;
  if(code!==candidate.code)throw Error('Renderer scalar integration differs from validated transform');
  const {code:transformedCode,...detail}=candidate;
  add(label+'-scalar',code,entry,detail);
 }
 for(const [label,name,query] of [['signals','trace','backend=signals'],['instanced','trace-pile',''],['packed','trace-meshlets',''],['corrected','trace','transport=corrected'],['corrected-instanced','trace-pile','transport=corrected'],['outside-corrected','outside-trace','transport=corrected'],['camera-corrected','camera-trace','transport=corrected']]){
  const candidate=scalarMediumStack(await build(name,query)),code=await build(name,query,'scalar');
  if(code!==candidate.code)throw Error('Renderer mode differs from validated transform: '+label);
  const {code:transformedCode,...detail}=candidate;
  add(label+'-scalar',code,'main',detail);
 }
 return modules;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const destination=resolve(process.argv[2]||'build/wgsl-scalar-medium');await mkdir(destination,{recursive:true});
 const modules=await scalarMediumModules();
 for(const module of modules)await writeFile(resolve(destination,module.name+'.wgsl'),module.code);
 const manifest={sourceSha256:modules[0].sha256,modules:modules.map(({code,...item})=>item),gpuUsed:false,physicalAdrenoVerified:false};
 await writeFile(resolve(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 console.log(JSON.stringify({output:destination,modules:modules.length,sourceSha256:manifest.sourceSha256,gpuUsed:false}));
}
