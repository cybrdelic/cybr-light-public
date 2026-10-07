// Experimental L1 screen-space radiance reuse. This is an approximation,
// not SHARC and not unbiased path tracing. Unsupported/missing hits trace normally.
export function screenRadianceCacheShader(source){
 const marker='  if(bounce==0u&&guide.id>=0&&hit.id>=0)';
 if(!source.includes(marker)||!source.includes('var radiance=vec3f(0)'))throw Error('Screen cache requires baseline transport');
 const lookup=`
@group(0) @binding(8) var<storage,read> radianceCache:array<Pixel>;
fn cachedRadiance(point:vec3f,n:vec3f,wo:vec3f,surface:f32,diffuseOnly:bool)->vec4f{
 if(u.flags.y>.5||u.size.z<8u||(u32(u.flags.w)&16u)==0u){return vec4f(0);}
 let r=point-u.previousEye.xyz;let z=dot(r,u.previousForward.xyz);if(z<=0.){return vec4f(0);}
 let xy=(vec2f(dot(r,u.previousRight.xyz)*f32(u.size.y)/f32(u.size.x),-dot(r,u.previousUp.xyz))/(z*u.previousForward.w)*.5+.5)*vec2f(u.size.xy)-.5;
 let base=vec2i(floor(xy));let f=fract(xy);var result=vec3f(0);var total=0.;
 for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let q=base+vec2i(x,y);if(any(q<vec2i(0))||any(q>=vec2i(u.size.xy))){continue;}
  let old=radianceCache[u32(q.y)*u.size.x+u32(q.x)];
  let footprint=max(.0005,z*u.previousForward.w*2./f32(u.size.y));
  // The first visible surface must be the same hit, not an occluder or another
  // coplanar object. Never reuse glass or sharp specular surface radiance.
  if(old.color.w<4.||old.moments.w!=0.||old.normal.w<.4||abs(old.position.w-surface)>.1||dot(old.normal.xyz,n)<.995||distance(old.position.xyz,point)>footprint*1.5||abs(dot(old.position.xyz-point,n))>footprint*.1){continue;}
  // Non-Lambertian outgoing radiance is direction dependent. Keep an explicitly
  // tight cone rather than pretending rough specular light is diffuse.
  if(!diffuseOnly&&dot(normalize(u.previousEye.xyz-old.position.xyz),wo)<.99995){continue;}
  let w=select(1.-f.x,f.x,x==1)*select(1.-f.y,f.y,y==1);result+=old.color.rgb*w;total+=w;
 }}
 if(total<.99){return vec4f(0);}return vec4f(result/total,1);
}
`;
 return lookup+source.replace(marker,`  if(bounce>0u&&bounce+1u<u.size.w&&m.physical.y<.5&&m.physical.x<.01){
   var surface=-2.;if(hit.id>=0){surface=triangles[hit.id].p.w+3.;}
   let cached=cachedRadiance(point,n,wo,surface,m.physical.w>.5);
   if(cached.w>.5){radiance+=throughput*cached.rgb;break;}
  }
`+marker);
}
