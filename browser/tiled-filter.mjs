// Exact spatial kernel, cached per workgroup. No change to filter radius,
// thresholds, resolution, or sample count. Large transmission tiles fall back.
export function tiledFilter(source,{step,channel}){
 if(source.includes('guide:array<Pixel>'))return baselineTiledFilter(source,step);
 if(![1,2,4].includes(step)||![0,1,2,3].includes(channel))throw Error('Invalid filter specialization');
 const width=8+4*step,count=width*width,transmission=channel===2;
 const bytes=count*(transmission?80:48);
 if(bytes>32768)return source;
 const replace=(a,b)=>{if(!source.includes(a))throw Error('Tiled filter contract changed: '+a);source=source.replace(a,b);};
 const members=transmission?',secondary:vec4f,secondaryNormal:vec4f':'';
 const suffix=transmission?',g.secondary,g.secondaryNormal':'';
 source=`struct TileGuide { position:vec4f,normal:vec4f${members} }\nvar<workgroup> tileGuide:array<TileGuide,${count}>;\nvar<workgroup> tileValue:array<vec4f,${count}>;\n`+source;
 replace('gid:vec3u){\n if(any(gid.xy>=config.xy))','gid:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(workgroup_id) wid:vec3u){\n'+`
 for(var t=lid.y*8u+lid.x;t<${count}u;t+=64u){
  let xy=clamp(vec2i(wid.xy*8u)+vec2i(i32(t%${width}u),i32(t/${width}u))-vec2i(${2*step}),vec2i(0),vec2i(config.xy)-1);
  let j=u32(xy.y)*config.x+u32(xy.x);let g=readSignal(guide[j],CHANNEL);
  tileGuide[t]=TileGuide(g.position,g.normal${suffix});tileValue[t]=input[j+CHANNEL*config.x*config.y];
 }
 workgroupBarrier();
 if(any(gid.xy>=config.xy))`);
 replace('let other=readSignal(guide[j],CHANNEL);',`let tq=vec2i(lid.xy)+vec2i(${2*step})+vec2i(x,y)*${step};let ti=u32(tq.y)*${width}u+u32(tq.x);let other=tileGuide[ti];`);
 source=source.replaceAll('input[j+offset]','tileValue[ti]');
 // Non-transmission specializations still parse all WGSL branches.
 if(!transmission){
  const a=source.indexOf('  if(CHANNEL==2u){'),b=source.indexOf('\n  var w=kernel',a);
  if(a<0||b<0)throw Error('Transmission filter contract changed');
  source=source.slice(0,a)+source.slice(b);
 }
 return source;
}

export function baselineTileBytes(step){
 if(![1,2,4].includes(step))throw Error('Invalid baseline filter step');
 return (8+4*step)**2*48;
}
function baselineTiledFilter(source,step){
 baselineTileBytes(step);
 const width=8+4*step,count=width*width;
 const replace=(a,b)=>{if(!source.includes(a))throw Error('Baseline tile contract changed');source=source.replace(a,b);};
 replace('gid:vec3u){\n if(any(gid.xy>=config.xy))',`gid:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(workgroup_id) wid:vec3u){
 for(var t=lid.y*8u+lid.x;t<${count}u;t+=64u){
  let xy=clamp(vec2i(wid.xy*8u)+vec2i(i32(t%${width}u),i32(t/${width}u))-vec2i(${2*step}),vec2i(0),vec2i(config.xy)-1);
  let j=u32(xy.y)*config.x+u32(xy.x);let g=guide[j];
  tileGeometry[t]=BaselineTileGuide(g.position,g.normal);tileRadiance[t]=input[j];
 }
 workgroupBarrier();
 if(any(gid.xy>=config.xy))`);
 replace('let other=guide[j];',`let tq=vec2i(lid.xy)+vec2i(${2*step})+vec2i(x,y)*${step};let ti=u32(tq.y)*${width}u+u32(tq.x);let other=tileGeometry[ti];`);
 // Replace neighbour fetches only, leaving the tile fill's input[j] intact.
 const start=source.indexOf('var sum=vec3f(0);');
 if(start<0)throw Error('Baseline filter kernel changed');
 source=source.slice(0,start)+source.slice(start).replaceAll('input[j]','tileRadiance[ti]');
 return `struct BaselineTileGuide {position:vec4f,normal:vec4f}
var<workgroup> tileGeometry:array<BaselineTileGuide,${count}>;
var<workgroup> tileRadiance:array<vec4f,${count}>;
`+source;
}
