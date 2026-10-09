// Sixteen separately named function-local slots
// remove private medium arrays, dynamic indexing and medium pointer helpers.
// Validate against the exact original operation contracts before transforming.
import {inlineMediumStack} from './medium-stack-inline.mjs';
const compact=text=>text.replace(/\s/g,'');
function close(text,start,open,shut){let depth=0;for(let i=start;i<text.length;i++){if(text[i]===open)depth++;if(text[i]===shut&&--depth===0)return i;}throw Error('Unbalanced scalar medium source');}
function argsOf(text){const args=[];let depth=0,start=0;for(let i=0;i<text.length;i++){if('(['.includes(text[i]))depth++;if(')]'.includes(text[i]))depth--;if(text[i]===','&&depth===0){args.push(text.slice(start,i).trim());start=i+1;}}args.push(text.slice(start).trim());return args;}
function removeFunction(code,name){const start=code.indexOf('fn '+name+'(');if(start<0)throw Error('Missing medium function '+name);const open=code.indexOf('{',start),end=close(code,open,'{','}')+1;return {code:code.slice(0,start)+code.slice(end),source:code.slice(start,end)};}
export function scalarMediumStack(source){
 if(source.includes('cybrMediumFlat'))throw Error('Scalar medium candidate already applied');
 const verified=inlineMediumStack(source),vector=verified.vectorKey;
 const names=[...new Set([...source.matchAll(/\bvar\s+(\w+)\s*:\s*MediumStack\s*;/g)].map(x=>x[1]))];
 const base=name=>'cybrMediumFlat_'+name+'_';
 const count=name=>base(name)+'Count',id=(name,i)=>base(name)+'Id'+i,value=(name,i)=>base(name)+'Value'+i;
 const equal=(a,b)=>vector?`all(${a}==${b})`:`${a}==${b}`;
 const lookup=(name,p)=>`var ${p}Slot=${count(name)};`+Array.from({length:16},(_,i)=>`if(${i}u<${count(name)}&&${equal(id(name,i),p+'Boundary')}){${p}Slot=${i}u;}`).join('');
 const read=(name,index,result)=>`{let cybrMediumFlatReadIndex=${index};`+Array.from({length:16},(_,i)=>`if(cybrMediumFlatReadIndex==${i}u){${result}=${value(name,i)};}`).join('')+'}';
 let code=source;
 for(const name of ['mediumExitSlot','mediumTarget','commitMedium'])code=removeFunction(code,name).code;
 if(code.includes('fn initializeCameraStack(')){
  const removed=removeFunction(code,'initializeCameraStack');
  const outside='fn initializeCameraStack(s:ptr<function,MediumStack>){(*s).count=0u;}';
  const storage=`fn initializeCameraStack(s:ptr<function,MediumStack>){(*s).count=cameraMedium.info.x;for(var i=0u;i<(*s).count;i++){(*s).ids[i]=cameraMedium.ids[i]${vector?'':'.x'};(*s).values[i]=cameraMedium.values[i];}}`;
  if(![compact(outside),compact(storage)].includes(compact(removed.source)))throw Error('Camera initializer contract changed');
  const outsideOnly=compact(removed.source)===compact(outside);code=removed.code;
  code=code.replace(/initializeCameraStack\(&([A-Za-z_]\w*)\);/g,(_,name)=>{
   if(!names.includes(name))throw Error('Undeclared camera medium stack');
   if(outsideOnly)return `${count(name)}=0u;`;
   return `{${count(name)}=cameraMedium.info.x;`+Array.from({length:16},(_,i)=>`if(${i}u<${count(name)}){${id(name,i)}=cameraMedium.ids[${i}]${vector?'':'.x'};${value(name,i)}=cameraMedium.values[${i}];}`).join('')+'}';
  });
 }
 let serial=0,targets=0,commits=0;
 while(true){
  const match=/\b(mediumTarget|commitMedium)\(/.exec(code);if(!match)break;
  const start=match.index,open=start+match[0].length-1,end=close(code,open,'(',')'),args=argsOf(code.slice(open+1,end));
  if(args.length!==4||!/^&[A-Za-z_]\w*$/.test(args[0]))throw Error('Unsupported scalar medium call');
  const name=args[0].slice(1),p='cybrMediumFlatOp'+serial++;if(!names.includes(name))throw Error('Undeclared medium stack '+name);
  const inputs=`let ${p}Boundary=${args[1]};let ${p}Entering=${args[2]};let ${p}Inside=${args[3]};`;
  if(match[1]==='mediumTarget'){
   let statement=start;while(statement>0&&!';{}'.includes(code[statement-1]))statement--;
   const expansion=`var ${p}Result=vec4f(0,0,0,1);{${inputs}if(${p}Entering){${p}Result=${p}Inside;}else{${lookup(name,p)}if(${p}Slot<${count(name)}){if(${p}Slot+1u<${count(name)}){${read(name,count(name)+'-1u',p+'Result')}}else if(${p}Slot>0u){${read(name,p+'Slot-1u',p+'Result')}}}}}\n`;
   code=code.slice(0,statement)+expansion+code.slice(statement,start)+p+'Result'+code.slice(end+1);targets++;
  }else{
   if(code[end+1]!==';')throw Error('Medium commit must be standalone');
   const push=Array.from({length:16},(_,i)=>`if(${count(name)}==${i}u){${id(name,i)}=${p}Boundary;${value(name,i)}=${p}Inside;}`).join('');
   const shift=Array.from({length:15},(_,i)=>`if(${i}u>=${p}Slot&&${i+1}u<${count(name)}){${id(name,i)}=${id(name,i+1)};${value(name,i)}=${value(name,i+1)};}`).join('');
   const expansion=`{${inputs}if(${p}Entering){${push}${count(name)}++;}else{${lookup(name,p)}if(${p}Slot<${count(name)}){${shift}${count(name)}--;}}}`;
   code=code.slice(0,start)+expansion+code.slice(end+2);commits++;
  }
 }
 code=code.replace(/\bvar\s+(\w+)\s*:\s*MediumStack\s*;/g,(_,name)=>`var ${count(name)}:u32;`+Array.from({length:16},(_,i)=>`var ${id(name,i)}:${vector?'vec2u':'u32'};var ${value(name,i)}:vec4f;`).join(''));
 for(const name of names){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  code=code.replace(new RegExp('\\b'+escaped+'\\.count\\b','g'),count(name));
  code=code.replace(new RegExp('\\b'+escaped+'\\.(ids|values)\\[([^\\]]+)\\]','g'),(_,kind,index)=>{
   const constant=/^(\d+)u?$/.exec(index.trim());
   if(constant){const slot=Number(constant[1]);if(slot>=16)throw Error('Medium slot outside original capacity');return kind==='ids'?id(name,slot):value(name,slot);}
   // Remaining original dynamic reads occur only at initialized camera tops.
   if(kind!=='values'||compact(index)!==count(name)+'-1u')throw Error('Unsupported residual medium array expression: '+index);
   let result='vec4f(0)';for(let i=0;i<16;i++)result=`select(${result},${value(name,i)},(${index})==${i}u)`;return '('+result+')';
  });
 }
 code=code.replace(/struct\s+MediumStack\s*\{[^}]*\}/,'');
 if(/\b(?:MediumStack|mediumTarget|commitMedium|mediumExitSlot|initializeCameraStack)\b/.test(code))throw Error('Residual medium aggregate/helper');
 return {code,targets,commits,stacks:names.length,mediumSlots:16,vectorKey:vector,privateMediumArrays:0,dynamicMediumAccesses:0};
}
