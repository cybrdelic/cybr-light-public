// Spend a second independent lighting path only on glass/polished metal.
// Both paths share coverage jitter, so averaging never mixes surface guides.
// Reference mode retains its independent one-path random stream.
export function tracePassTiming(querySet,hasPriorPass,hasOpticalPass){
 if(!querySet||hasPriorPass&&hasOpticalPass)return undefined;
 return {querySet,...(hasPriorPass?{}:{beginningOfPassWriteIndex:0}),...(hasOpticalPass?{}:{endOfPassWriteIndex:1})};
}
export function opticalSampling(source){
 const edit=(a,b)=>{if(!source.includes(a))throw Error('Optical sampling contract: '+a);source=source.replace(a,b);};
 edit('@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) gid:vec3u){if(any(gid.xy>=u.size.xy)){return;}',
 'fn pathSample(gid:vec3u,sampleOffset:u32)->Pixel{');
 edit('var seed=index*9781u+u.size.z*6271u+89173u;','var seed=index*9781u+u.size.z*6271u+89173u+sampleOffset;');
 edit('samples[index]=Pixel(','return Pixel(');
 return source+`
 @compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) gid:vec3u){
  if(any(gid.xy>=u.size.xy)){return;}
  let index=gid.y*u.size.x+gid.x;
  if(u.flags.y<.5&&samples[index].normal.w<.3&&samples[index].moments.w!=0.){
   let second=pathSample(gid,0x9e3779b9u).color.rgb;
   var p=samples[index];
   p.color=vec4f((p.color.rgb+second)*.5,1);
   let l=dot(p.color.rgb,vec3f(.2126,.7152,.0722));p.moments=vec4f(l,l*l,p.moments.zw);
   samples[index]=p;
  }
 }
 `;
}
