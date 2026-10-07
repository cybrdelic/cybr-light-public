// An explicit compiler-shape variant. Transport operations and random streams
// are unchanged. The existing UI supports at most ten scattering events.
export function traceCompatibility(source,{workgroup=4,mediumSlots=10}={}){
 if(![1,4,8].includes(workgroup)||![10,16].includes(mediumSlots))throw Error('Unsupported trace compatibility shape');
 if(source.includes('struct CameraMedium')||source.includes('interfaces>=24u'))throw Error('Corrected transport requires its original medium capacity');
 const marker='@workgroup_size(8,8)';
 if(!source.includes(marker)||!source.includes('struct MediumStack'))throw Error('Trace compatibility contract changed');
 if(/var<workgroup>|workgroupBarrier|subgroup/.test(source))throw Error('Trace workgroup is not independent per pixel');
 let code=source.replaceAll(marker,`@workgroup_size(${workgroup},${workgroup})`);
 if(mediumSlots===10){
  if(!code.includes('values:array<vec4f,16>')||!code.includes('min(u.size.w,16u)'))throw Error('Medium capacity contract changed');
  code=code.replace('ids:array<u32,16>','ids:array<u32,10>').replace('ids:array<vec2u,16>','ids:array<vec2u,10>')
   .replace('values:array<vec4f,16>','values:array<vec4f,10>').replaceAll('min(u.size.w,16u)','min(u.size.w,10u)');
 }
 return {code,workgroup,mediumSlots,maxBounces:mediumSlots};
}

export function traceCompileVariant(source,name){
 if(name==='full-control')return {code:source+'\n@compute @workgroup_size(1) fn compileControl() {}',entryPoint:'compileControl',workgroup:1};
 if(name==='tiny')return {code:'@compute @workgroup_size(1) fn main() {}',entryPoint:'main',workgroup:1};
 if(['current','default-limits','host-prefix'].includes(name))return {code:source,entryPoint:'main',workgroup:8};
 const shapes={'workgroup-4':{workgroup:4,mediumSlots:16},'compact-media':{workgroup:8,mediumSlots:10},compat:{workgroup:4,mediumSlots:10}};
 if(!shapes[name])throw Error('Unknown compile comparison');
 return {...traceCompatibility(source,shapes[name]),entryPoint:'main'};
}
