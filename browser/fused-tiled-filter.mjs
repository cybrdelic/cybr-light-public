// Only the first fused pass passed the cross-scene performance gate.
// Cache geometry and radiance without changing the filter arithmetic.
export function fusedTileBytes(step){return step===1?23040:Infinity;}
export function fusedTiledFilter(source,{step}) {
 if(step!==1)throw Error('Fused pass exceeds the validated tile budget');
 const width=8+4*step,count=width*width;
 const replace=(a,b)=>{if(!source.includes(a))throw Error('Fused tile contract changed');source=source.replace(a,b);};
 const prelude=`struct TileOpticalGuide {position:vec4f,normal:vec4f,secondary:vec4f,secondaryNormal:vec4f,reflectedPosition:vec4f,reflectedNormal:vec4f}
struct TileLight {d:vec4f,s:vec4f,t:vec4f,i:vec4f}
var<workgroup> tileGeometry:array<TileOpticalGuide,${count}>;
var<workgroup> tileLight:array<TileLight,${count}>;
`;
 replace('gid:vec3u){\n if(any(gid.xy>=config.xy))',`gid:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(workgroup_id) wid:vec3u){
 for(var k=lid.y*8u+lid.x;k<${count}u;k+=64u){
  let xy=clamp(vec2i(wid.xy*8u)+vec2i(i32(k%${width}u),i32(k/${width}u))-vec2i(${2*step}),vec2i(0),vec2i(config.xy)-1);
  let j=u32(xy.y)*config.x+u32(xy.x);let g=guide[j];let n=config.x*config.y;
  tileGeometry[k]=TileOpticalGuide(g.position,g.normal,g.secondary,g.secondaryNormal,g.reflectedPosition,g.reflectedNormal);
  tileLight[k]=TileLight(input[j],input[j+n],input[j+2u*n],input[j+3u*n]);
 }
 workgroupBarrier();
 if(any(gid.xy>=config.xy))`);
 replace('let other=guide[j];',`let tq=vec2i(lid.xy)+vec2i(${2*step})+vec2i(x,y)*${step};let ti=u32(tq.y)*${width}u+u32(tq.x);let other=tileGeometry[ti];`);
 replace('let nd=input[j];let ns=input[j+count];let nt=input[j+2u*count];let ni=input[j+3u*count];','let nd=tileLight[ti].d;let ns=tileLight[ti].s;let nt=tileLight[ti].t;let ni=tileLight[ti].i;');
 return prelude+source;
}
