fn primaryIrradiance(h:Hit,point:vec3f,back:bool,n:vec3f)->vec4f{
 var cachedNormal=normal(h);let gn=select(geometric(h),-geometric(h),back);
 if(dot(cachedNormal,gn)<0.){cachedNormal=-cachedNormal;}
 // Do not apply a cache built for a different shading normal at grazing angles.
 if(dot(n,cachedNormal)<.99999){return vec4f(0);}
 var data=vec4u(u32(h.id)+3u,/*BEAUTY_INSTANCE*/,bitcast<u32>(h.bary.x),bitcast<u32>(h.bary.y)|select(0u,0x80000000u,back));
 if(h.id==-2){if(back||any(abs(point.xz)>vec2f(100.))){return vec4f(0);}data=vec4u(1,0,bitcast<u32>(point.x),bitcast<u32>(point.z));}
 var value=vec3f(0);
 for(var corner=0u;corner<3u;corner++){
  let support=supportFor(data,corner);if(support.weight<1e-7){continue;}
  let slot=lookup(support.key);if(slot==SLOTS){return vec4f(0);}
  let cell=cells[slot];if(cell.value.w<16.){return vec4f(0);}
  value+=support.weight*cell.value.rgb;
 }
 return vec4f(value,1);
}
fn residualBsdf(n:vec3f,wo:vec3f,wi:vec3f,color:vec3f,metal:f32,alpha:f32,diffuseOnly:f32,weight:vec3f)->vec4f{
 let b=bsdf(n,wo,wi,color,metal,alpha,diffuseOnly);
 if(dot(n,wi)<=0.){return b;}
 return vec4f(b.rgb-weight/PI,b.w);
}
@compute @workgroup_size(8,8) fn resolveHybridBeauty(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=u.size.xy)){return;}
 let index=gid.y*u.size.x+gid.x;var color=vec3f(0);
 for(var s=0u;s<4u;s++){
  var seed=(index*4u+s)*9781u+lab.referenceFrame*6271u+89173u;
  let direction=camera(vec2f(gid.xy)+vec2f(random(&seed),random(&seed)));
  color+=incidentBeauty(u.eye.xyz,direction,seed,0.);
 }
 color*=.25;
 if(lab.referenceFrame>0u){color=mix(result[index].rgb,color,1./f32(lab.referenceFrame+1u));}
 result[index]=vec4f(color,1);
}
