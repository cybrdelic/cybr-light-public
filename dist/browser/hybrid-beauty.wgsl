// Uncached beauty oracle: original production BRDFs, media, floor and lights.
// This is deliberately not advertised as the accelerated hybrid beauty path.
@compute @workgroup_size(8,8) fn resolveBeauty(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=u.size.xy)){return;}
 let index=gid.y*u.size.x+gid.x;var color=vec3f(0);
 for(var s=0u;s<4u;s++){
  var seed=(index*4u+s)*9781u+lab.referenceFrame*6271u+89173u;
  let direction=camera(vec2f(gid.xy)+vec2f(random(&seed),random(&seed)));
  color+=incident(u.eye.xyz,direction,seed,0.);
 }
 color*=.25;
 if(lab.referenceFrame>0u){color=mix(result[index].rgb,color,1./f32(lab.referenceFrame+1u));}
 result[index]=vec4f(color,1);
}
