// Diffuse history follows the primary surface. Mode 11 separately inverts
// reflection/transmission endpoint maps; mode 10 retains static-only optics.
@compute @workgroup_size(8,8) fn reconstructSignals(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=u.size.xy)){return;}
 let count=u.size.x*u.size.y;let index=gid.y*u.size.x+gid.x;
 let current=(u.size.z&1u)*count+index;let previous=((u.size.z+1u)&1u)*count;
 var value=signals[current];let guide=guides[current];
 value.diffuse.w=1.;value.specular.w=1.;value.transmission.w=1.;value.emission.w=1.;
 if(u.flags.x>.5&&u.flags.y>.5&&guide.identity.w==1u){
  let delta=guide.position.xyz-u.previousEye.xyz;let z=dot(delta,u.previousForward.xyz);
  if(z>0.){
   let ndc=vec2f(dot(delta,u.previousRight.xyz)/(z*u.previousForward.w*f32(u.size.x)/f32(u.size.y)),dot(delta,u.previousUp.xyz)/(z*u.previousForward.w));
   let pixel=(ndc*vec2f(.5,-.5)+.5)*vec2f(u.size.xy)-.5-rasterJitterAt(u32(lab.sampling.y));let base=vec2i(floor(pixel));let f=fract(pixel);
   var history=vec4f(0);var weight=0.;
   let tolerance=max(.0001,guide.position.w*u.forward.w*6./f32(u.size.y));
   let footprint=tolerance/max(abs(dot(guide.normal.xyz,normalize(u.eye.xyz-guide.position.xyz))),.001);
   for(var y=0;y<2;y++){for(var x=0;x<2;x++){
    let p=base+vec2i(x,y);if(any(p<vec2i(0))||any(p>=vec2i(u.size.xy))){continue;}
    let oldIndex=previous+u32(p.y)*u.size.x+u32(p.x);let oldGuide=guides[oldIndex];
    if(oldGuide.identity.w==0u||any(oldGuide.identity.xyz!=guide.identity.xyz)||oldGuide.albedo.w!=guide.albedo.w||dot(oldGuide.normal.xyz,guide.normal.xyz)<.995||distance(oldGuide.position.xyz,guide.position.xyz)>footprint||abs(dot(oldGuide.position.xyz-guide.position.xyz,guide.normal.xyz))>tolerance){continue;}
    let w=select(1.-f.x,f.x,x==1)*select(1.-f.y,f.y,y==1);
    let old=signals[oldIndex].diffuse;history+=vec4f(old.rgb/max(oldGuide.albedo.rgb,vec3f(.0001)),old.w)*w;weight+=w;
   }}
   if(weight>.5){history/=weight;let age=min(history.w,31.);value.diffuse=vec4f((history.rgb*guide.albedo.rgb*age+value.diffuse.rgb)/(age+1.),age+1.);}
  }
 }
 if((lab.mode==11u||lab.mode==12u)&&u.flags.x>.5&&u.flags.y>.5&&guide.identity.w==1u){
  let reflection=opticalHistory(current,previous,false);
  let transmission=opticalHistory(current,previous,true);
  if(reflection.w>0.){let age=min(reflection.w,7.);value.specular=vec4f((reflection.rgb*age+value.specular.rgb)/(age+1.),age+1.);}
  if(transmission.w>0.){let age=min(transmission.w,7.);value.transmission=vec4f((transmission.rgb*age+value.transmission.rgb)/(age+1.),age+1.);}
 }
 if(u.flags.x>.5&&u.flags.y<.5){
  let old=signals[previous+index];
  let nd=min(old.diffuse.w,255.);value.diffuse=vec4f((old.diffuse.rgb*nd+value.diffuse.rgb)/(nd+1.),nd+1.);
  // Exact static camera: directional images do not move.
  let ns=min(old.specular.w,255.);let nt=min(old.transmission.w,255.);let ne=min(old.emission.w,255.);
  value.specular=vec4f((old.specular.rgb*ns+value.specular.rgb)/(ns+1.),ns+1.);
  value.transmission=vec4f((old.transmission.rgb*nt+value.transmission.rgb)/(nt+1.),nt+1.);
  value.emission=vec4f((old.emission.rgb*ne+value.emission.rgb)/(ne+1.),ne+1.);
 }
 signals[current]=value;result[index]=vec4f(showSignals(value),1);
}
