struct Uniforms { size:vec4u,eye:vec4f,right:vec4f,up:vec4f,forward:vec4f,previousEye:vec4f,previousRight:vec4f,previousUp:vec4f,previousForward:vec4f,flags:vec4f,features:vec4f }
@group(0) @binding(0) var<uniform> u:Uniforms;
@group(0) @binding(1) var<storage,read> current:array<Signals>;
@group(0) @binding(2) var<storage,read> previous:array<Signals>;
@group(0) @binding(3) var<storage,read> lighting:array<vec4f>;
@group(0) @binding(4) var<storage,read> modulation:array<vec4f>;
@group(0) @binding(5) var<storage,read> history:array<vec4f>;
@group(0) @binding(6) var<storage,read_write> output:array<vec4f>;
fn indexAt(q:vec2i)->u32{let p=clamp(q,vec2i(0),vec2i(u.size.xy)-1);return u32(p.y)*u.size.x+u32(p.x);}
fn composed(q:vec2i)->vec3f{
 let i=indexAt(q);let count=u.size.x*u.size.y;
 return (lighting[i].rgb+lighting[i+3u*count].rgb)*modulation[i].rgb+lighting[i+count].rgb+lighting[i+2u*count].rgb;
}
fn project(point:vec3f)->vec3f{
 let r=point-u.previousEye.xyz;let z=dot(r,u.previousForward.xyz);
 let xy=(vec2f(dot(r,u.previousRight.xyz)*f32(u.size.y)/f32(u.size.x),-dot(r,u.previousUp.xyz))/(max(z,.001)*u.previousForward.w)*.5+.5)*vec2f(u.size.xy);
 return vec3f(xy,z);
}
fn sameSecondary(a:Signals,b:Signals)->bool{
 return a.secondaryNormal.w>.5&&b.secondaryNormal.w>.5&&abs(a.position.w-b.position.w)<.1&&abs(a.secondary.w-b.secondary.w)<.1&&dot(a.secondaryNormal.xyz,b.secondaryNormal.xyz)>.98&&dot(a.normal.xyz,b.normal.xyz)>.9;
}
fn cubic(x:f32)->f32{
 let a=abs(x);if(a<1.){return 1.5*a*a*a-2.5*a*a+1.;}if(a<2.){return -.5*a*a*a+2.5*a*a-4.*a+2.;}return 0.;
}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=u.size.xy)){return;}let q=vec2i(gid.xy);let i=indexAt(q);
 // Reference mode is an independent, unfiltered Monte Carlo accumulation.
 if(u.flags.y>.5||u.features.z<.5){output[i]=vec4f(composed(q),1);return;}
 let jitter=coverageJitter(u.size.z);let samplePosition=vec2f(q)+.5-jitter;
 let base=vec2i(floor(samplePosition));
 var now=vec3f(0);var total=0.;var low=vec3f(1e30);var high=vec3f(-1e30);
 for(var y=-1;y<=2;y++){for(var x=-1;x<=2;x++){
  let p=base+vec2i(x,y);let c=composed(p);
  let w=cubic(f32(p.x)-samplePosition.x)*cubic(f32(p.y)-samplePosition.y);
  now+=c*w;total+=w;
  if(x>=0&&x<=1&&y>=0&&y<=1){low=min(low,c);high=max(high,c);}
 }}
 now=clamp(now/max(total,1e-6),low,high);
 var guide=current[i];var guideXY=q;
 // Foreground velocity dilation protects silhouettes from background motion.
 var nearest=1e30;
 for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
  let p=q+vec2i(x,y);let s=current[indexAt(p)];let d=distance(s.position.xyz,u.eye.xyz);
  if(s.position.w!=-1.&&d<nearest){nearest=d;guide=s;guideXY=clamp(p,vec2i(0),vec2i(u.size.xy)-1);}
 }}
 var valid=u.size.z>0u;var previousPixel=vec2f(q);
 if(guide.position.w!=-1.){
  let projected=project(guide.position.xyz);valid=valid&&projected.z>0.;
  previousPixel=vec2f(q)+projected.xy-(vec2f(guideXY)+jitter);
 }else{
  // Sky directions have rotational motion, but no translation/parallax.
  let screen=(vec2f(q)+.5)/vec2f(u.size.xy)*2.-1.;
  let ray=normalize(u.forward.xyz+(u.right.xyz*screen.x*f32(u.size.x)/f32(u.size.y)-u.up.xyz*screen.y)*u.forward.w);
  let projected=project(u.previousEye.xyz+ray*1000.);previousPixel=projected.xy-.5;valid=valid&&projected.z>0.;
 }
 let glass=modulation[indexAt(guideXY)].w>.5;
 let reflection=guide.specularMoments.w>.5&&guide.specularMoments.z>0.;
 if(glass){
  // Solve for the actual transmitted hit in the previous guide field. Never
  // pretend front-surface motion describes the world seen through the glass.
  var pixel=project(guide.position.xyz).xy-coverageJitter(u.size.z-1u);let start=pixel;
  valid=valid&&guide.secondaryNormal.w>.5;
  for(var k=0;k<3;k++){
   let p=vec2i(round(pixel));if(any(p<vec2i(1))||any(p>=vec2i(u.size.xy)-2)){valid=false;break;}
   let c=previous[indexAt(p)];let a=previous[indexAt(p+vec2i(1,0))];let b=previous[indexAt(p+vec2i(0,1))];
   if(!sameSecondary(guide,c)||!sameSecondary(c,a)||!sameSecondary(c,b)){valid=false;break;}
   let dx=a.secondary.xyz-c.secondary.xyz;let dy=b.secondary.xyz-c.secondary.xyz;let e=guide.secondary.xyz-c.secondary.xyz;
   let aa=dot(dx,dx);let ab=dot(dx,dy);let bb=dot(dy,dy);let det=aa*bb-ab*ab;
   if(det<1e-16){valid=false;break;}
   pixel=vec2f(p)+clamp(vec2f(bb*dot(dx,e)-ab*dot(dy,e),aa*dot(dy,e)-ab*dot(dx,e))/det,vec2f(-3),vec2f(3));
   if(distance(pixel,start)>8.){valid=false;break;}
  }
  let old=previous[indexAt(vec2i(round(pixel)))];
  let footprint=max(.003,distance(guide.secondary.xyz,u.eye.xyz)*u.forward.w*4./f32(u.size.y));
  valid=valid&&sameSecondary(guide,old)&&distance(old.secondary.xyz,guide.secondary.xyz)<footprint;
  previousPixel=vec2f(q-guideXY)+pixel+coverageJitter(u.size.z-1u)-jitter;
 }else if(reflection){
  let virtualPoint=guide.position.xyz+normalize(guide.position.xyz-u.eye.xyz)*guide.specularMoments.z;
  let projected=project(virtualPoint);previousPixel=vec2f(q)+projected.xy-(vec2f(guideXY)+jitter);valid=valid&&projected.z>0.;
 }
 let oldXY=vec2i(round(previousPixel));valid=valid&&all(oldXY>=vec2i(0))&&all(oldXY<vec2i(u.size.xy));
 let oldGuide=previous[indexAt(oldXY)];
 if(!glass){
  valid=valid&&abs(guide.position.w-oldGuide.position.w)<.1;
  if(guide.position.w!=-1.){
   let footprint=max(.003,distance(guide.position.xyz,u.eye.xyz)*u.forward.w*4./f32(u.size.y));
   valid=valid&&abs(dot(oldGuide.position.xyz-guide.position.xyz,guide.normal.xyz))<footprint&&dot(oldGuide.normal.xyz,guide.normal.xyz)>.8;
   if(reflection){valid=valid&&oldGuide.specularMoments.w>.5&&dot(oldGuide.normal.xyz,guide.normal.xyz)>.995&&abs(oldGuide.specularMoments.z-guide.specularMoments.z)<max(.02,guide.specularMoments.z*.08);}
  }
 }
 // RGB neighborhood clipping is intentionally limited to this final coverage
 // pass; it never clamps transport or the reference estimator.
 for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){let c=composed(q+vec2i(x,y));low=min(low,c);high=max(high,c);}}
 var old=vec4f(0);total=0.;let historyBase=vec2i(floor(previousPixel));
 for(var y=-1;y<=2;y++){for(var x=-1;x<=2;x++){
  let p=historyBase+vec2i(x,y);let w=cubic(f32(p.x)-previousPixel.x)*cubic(f32(p.y)-previousPixel.y);
  old+=history[indexAt(p)]*w;total+=w;
 }}
 old/=max(total,1e-6);let weight=select(0.,min(max(old.w,0.),7.),valid);
 output[i]=vec4f((now+clamp(old.rgb,low,high)*weight)/(weight+1.),weight+1.);
}
