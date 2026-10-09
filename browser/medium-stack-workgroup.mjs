// Equivalent sixteen-slot medium state with disjoint workgroup storage.
// Change medium storage/addressing, retaining the verified original operations.
import {scalarMediumStack} from './medium-stack-scalar.mjs';

function close(source,start,left,right){
 let depth=0;
 for(let i=start;i<source.length;i++){
  if(source[i]===left)depth++;
  if(source[i]===right&&--depth===0)return i;
 }
 throw Error('Unbalanced workgroup medium source');
}
export function wgslFunctions(source){
 const records=[];
 for(const match of source.matchAll(/\bfn\s+(\w+)\s*\(/g)){
  const start=match.index,parametersStart=start+match[0].length-1;
  const parametersEnd=close(source,parametersStart,'(',')');
  const bodyStart=source.indexOf('{',parametersEnd),bodyEnd=close(source,bodyStart,'{','}');
  const before=source.slice(records.at(-1)?.end||0,start);
  const compute=/@compute\s+@workgroup_size\(([^)]+)\)\s*$/.exec(before);
  records.push({name:match[1],start,end:bodyEnd+1,parametersStart,parametersEnd,bodyStart,bodyEnd,
   parameters:source.slice(parametersStart+1,parametersEnd),body:source.slice(bodyStart+1,bodyEnd),
   compute:compute?{text:compute[0],start:start-compute[0].length,
    dimensions:compute[1].split(',').map(x=>Number(x.trim().replace(/u$/,'')))}:null});
 }
 return records;
}
export function workgroupMediumStack(source,{dimensions=[4,4,1],maxWorkgroupBytes=32768}={}){
 if(source.includes('cybrMediumArena'))throw Error('Workgroup medium candidate already applied');
 if(dimensions.length!==3||dimensions.some(x=>!Number.isInteger(x)||x<1)||dimensions.reduce((a,b)=>a*b,1)!==16)
  throw Error('Workgroup medium candidate requires exactly sixteen invocations');
 // This independently verifies capacity, key shape, original helper bodies,
 // all call contracts and both supported camera initialization contracts.
 const verified=scalarMediumStack(source),functions=wgslFunctions(source);
 const declarationsByFunction=[],helpers=new Set(['mediumExitSlot','mediumTarget','commitMedium','initializeCameraStack']);
 let stacksPerInvocation=0;
 for(const fn of functions){
  const declarations=[...fn.body.matchAll(/\bvar\s+(\w+)\s*:\s*MediumStack\s*;/g)];
  if(!declarations.length)continue;
  if(new Set(declarations.map(x=>x[1])).size!==declarations.length)throw Error('Shadowed medium declarations require explicit adaptation');
  declarationsByFunction.push({fn,declarations,firstSlot:stacksPerInvocation});stacksPerInvocation+=declarations.length;
 }
 if(stacksPerInvocation===0)return {code:source,mediumSlots:16,vectorKey:verified.vectorKey,
  stacksPerInvocation:0,workgroupBytes:0,privateMediumArrays:0,mediumPointerParameters:0,entries:[],unchanged:true};
 const keyAlignment=verified.vectorKey?8:4;
 const valuesOffset=Math.ceil((keyAlignment+16*keyAlignment)/16)*16;
 const stackBytes=valuesOffset+16*16,workgroupBytes=stackBytes*stacksPerInvocation*16;
 if(workgroupBytes>maxWorkgroupBytes)throw Error('Workgroup medium allocation exceeds the requested budget: '+workgroupBytes);
 if(/var\s*<\s*workgroup\s*>/.test(source))throw Error('Existing workgroup allocation requires explicit budget accounting');
 const entries=functions.filter(fn=>fn.compute);
 if(!entries.length)throw Error('Missing compute entrypoint');
 if(entries.some(fn=>fn.parameters.includes('local_invocation_index')))throw Error('Existing lane input requires explicit adaptation');
 const edits=[];
 for(const fn of functions){
  let parameters=fn.parameters,body=fn.body;
  if(helpers.has(fn.name)){
   const pointer=/\b(\w+)\s*:\s*ptr<function,MediumStack>/.exec(parameters);
   if(!pointer)throw Error('Medium helper pointer contract changed: '+fn.name);
   parameters=parameters.replace(pointer[0],pointer[1]+':u32');
   body=body.replaceAll('(*'+pointer[1]+')','cybrMediumArena['+pointer[1]+']');
  }
  const allocation=declarationsByFunction.find(x=>x.fn===fn);
  if(allocation){
   for(const [offset,declaration] of allocation.declarations.entries()){
    const slot=allocation.firstSlot+offset;
    const name=declaration[1],escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    // The original function-scope declaration zeroes ALL slots each time it
    // executes, including when this scope is revisited. Preserve that reset.
    body=body.replace(declaration[0],`let ${name}=cybrMediumLane*${stacksPerInvocation}u+${slot}u;cybrMediumArena[${name}]=MediumStack();`);
    body=body.replace(new RegExp('\\b'+escaped+'\\.(count|ids|values)\\b','g'),`cybrMediumArena[${name}].$1`);
    body=body.replace(new RegExp('\\b(mediumTarget|commitMedium|initializeCameraStack)\\(&'+escaped+'(?=[,)])','g'),'$1('+name);
   }
  }
  if(fn.compute){
   parameters+=(parameters.trim()?',':'')+'@builtin(local_invocation_index) cybrMediumLaneInput:u32';
   body='cybrMediumLane=cybrMediumLaneInput;'+body;
   const attribute=fn.compute.text.replace(/@workgroup_size\([^)]+\)/,`@workgroup_size(${dimensions.join(',')})`);
   edits.push({start:fn.compute.start,end:fn.start,text:attribute});
  }
  if(parameters!==fn.parameters||body!==fn.body){
   edits.push({start:fn.parametersStart+1,end:fn.parametersEnd,text:parameters});
   edits.push({start:fn.bodyStart+1,end:fn.bodyEnd,text:body});
  }
 }
 let code=source;
 for(const edit of edits.sort((a,b)=>b.start-a.start))code=code.slice(0,edit.start)+edit.text+code.slice(edit.end);
 const stack=/struct\s+MediumStack\s*\{[^}]*\}/.exec(code);
 code=code.slice(0,stack.index+stack[0].length)+`\nvar<private> cybrMediumLane:u32;\nvar<workgroup> cybrMediumArena:array<MediumStack,${stacksPerInvocation*16}>;`+code.slice(stack.index+stack[0].length);
 if(/ptr<function,MediumStack>|\bvar\s+\w+\s*:\s*MediumStack\s*;/.test(code))throw Error('Residual private medium storage or pointer');
 return {code,mediumSlots:16,vectorKey:verified.vectorKey,stacksPerInvocation,stackBytes,workgroupBytes,
  privateMediumArrays:0,mediumPointerParameters:0,barriersAdded:0,extraStorageBindings:0,
  entries:entries.map(fn=>({name:fn.name,originalDimensions:fn.compute.dimensions,dimensions:[...dimensions]})),
  allocations:declarationsByFunction.map(({fn,declarations,firstSlot})=>({function:fn.name,firstSlot,stackNames:declarations.map(x=>x[1])})),
  privateLaneScalars:1,unchanged:false};
}
