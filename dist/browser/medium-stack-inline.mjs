// Explicit compiler-shape candidate: expand medium helpers at each call site.
// The default renderer never selects this transformation. No stack capacity,
// boundary identity, transport expression or random-stream operation is changed.
const helpers={
 mediumExitSlot:`fn mediumExitSlot(stack:ptr<function,MediumStack>,boundary:u32)->u32{
 var slot=(*stack).count;for(var s=0u;s<(*stack).count;s++){if((*stack).ids[s]==boundary){slot=s;}}return slot;
}`,
 mediumTarget:`fn mediumTarget(stack:ptr<function,MediumStack>,boundary:u32,entering:bool,inside:vec4f)->vec4f{
 if(entering){return inside;}let slot=mediumExitSlot(stack,boundary);
 if(slot<(*stack).count){if(slot+1u<(*stack).count){return (*stack).values[(*stack).count-1u];}if(slot>0u){return (*stack).values[slot-1u];}}
 return vec4f(0,0,0,1);
}`,
 commitMedium:`fn commitMedium(stack:ptr<function,MediumStack>,boundary:u32,entering:bool,inside:vec4f){
 if(entering){(*stack).ids[(*stack).count]=boundary;(*stack).values[(*stack).count]=inside;(*stack).count++;return;}
 let slot=mediumExitSlot(stack,boundary);if(slot<(*stack).count){for(var s=slot;s+1u<(*stack).count;s++){(*stack).ids[s]=(*stack).ids[s+1u];(*stack).values[s]=(*stack).values[s+1u];}(*stack).count--;}
}`,
};
const compact=text=>text.replace(/\s/g,'');
function closing(text,start,open,close){
 let depth=0;
 for(let i=start;i<text.length;i++){if(text[i]===open)depth++;if(text[i]===close&&--depth===0)return i;}
 throw Error('Unbalanced medium helper source');
}
function argumentsOf(text){
 const args=[];let depth=0,start=0;
 for(let i=0;i<text.length;i++){if('(['.includes(text[i]))depth++;if(')]'.includes(text[i]))depth--;
  if(text[i]===','&&depth===0){args.push(text.slice(start,i).trim());start=i+1;}}
 args.push(text.slice(start).trim());return args;
}
export function inlineMediumStack(source){
 if(source.includes('cybrMediumInline'))throw Error('Medium inline candidate already applied');
 const stackDeclaration=/struct\s+MediumStack\s*\{[^}]*\}/.exec(source)?.[0]||'';
 const vectorKey=stackDeclaration.includes('ids:array<vec2u,16>');
 if(!stackDeclaration.includes('values:array<vec4f,16>')||!(vectorKey||stackDeclaration.includes('ids:array<u32,16>')))
  throw Error('Medium inline candidate requires the original 16-slot stack');
 let code=source;
 for(const [name,scalar] of Object.entries(helpers)){
  const start=code.indexOf('fn '+name+'(');if(start<0)throw Error('Medium helper contract changed: '+name);
  const open=code.indexOf('{',start),end=closing(code,open,'{','}')+1;
  const expected=vectorKey?scalar.replaceAll('boundary:u32','boundary:vec2u').replace('if((*stack).ids[s]==boundary)','if(all((*stack).ids[s]==boundary))'):scalar;
  if(compact(code.slice(start,end))!==compact(expected))throw Error('Medium helper contract changed: '+name);
  code=code.slice(0,start)+code.slice(end);
 }
 let serial=0,targets=0,commits=0;
 const equality=(stack,index,boundary)=>vectorKey?`all(${stack}.ids[${index}]==${boundary})`:`${stack}.ids[${index}]==${boundary}`;
 const lookup=(stack,p)=>`var ${p}Slot=${stack}.count;for(var ${p}Index=0u;${p}Index<${stack}.count;${p}Index++){if(${equality(stack,p+'Index',p+'Boundary')}){${p}Slot=${p}Index;}}`;
 while(true){
  const match=/\b(mediumTarget|commitMedium)\(/.exec(code);if(!match)break;
  const start=match.index,open=start+match[0].length-1,end=closing(code,open,'(',')');
  const args=argumentsOf(code.slice(open+1,end));
  if(args.length!==4||!/^&[A-Za-z_]\w*$/.test(args[0]))throw Error('Unsupported medium helper call');
  const stack=args[0].slice(1),p='cybrMediumInline'+serial++;
  const inputs=`let ${p}Boundary=${args[1]};let ${p}Entering=${args[2]};let ${p}Inside=${args[3]};`;
  if(match[1]==='mediumTarget'){
   // Introduce a result before its statement, preserving all four arguments
   // and the original expression that consumes the result.
   let statement=start;while(statement>0&&!';{}'.includes(code[statement-1]))statement--;
   const expansion=`var ${p}Result=vec4f(0,0,0,1);{${inputs}if(${p}Entering){${p}Result=${p}Inside;}else{${lookup(stack,p)}if(${p}Slot<${stack}.count){if(${p}Slot+1u<${stack}.count){${p}Result=${stack}.values[${stack}.count-1u];}else if(${p}Slot>0u){${p}Result=${stack}.values[${p}Slot-1u];}}}}\n`;
   code=code.slice(0,statement)+expansion+code.slice(statement,start)+p+'Result'+code.slice(end+1);targets++;
  }else{
   if(code[end+1]!==';')throw Error('Medium commit must remain a standalone statement');
   const expansion=`{${inputs}if(${p}Entering){${stack}.ids[${stack}.count]=${p}Boundary;${stack}.values[${stack}.count]=${p}Inside;${stack}.count++;}else{${lookup(stack,p)}if(${p}Slot<${stack}.count){for(var ${p}Index=${p}Slot;${p}Index+1u<${stack}.count;${p}Index++){${stack}.ids[${p}Index]=${stack}.ids[${p}Index+1u];${stack}.values[${p}Index]=${stack}.values[${p}Index+1u];}${stack}.count--;}}}`;
   code=code.slice(0,start)+expansion+code.slice(end+2);commits++;
  }
 }
 if(/\b(mediumTarget|commitMedium|mediumExitSlot)\(/.test(code))throw Error('Unexpanded medium operation');
 return {code,targets,commits,mediumSlots:16,vectorKey};
}
