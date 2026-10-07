struct Uniforms { size:vec4u,eye:vec4f,right:vec4f,up:vec4f,forward:vec4f,previousEye:vec4f,previousRight:vec4f,previousUp:vec4f,previousForward:vec4f,flags:vec4f }
struct Pixel { color:vec4f,position:vec4f,normal:vec4f,moments:vec4f,secondary:vec4f,secondaryNormal:vec4f }
@group(0) @binding(0) var<uniform> u:Uniforms;
@group(0) @binding(1) var<storage,read> current:array<Pixel>;
@group(0) @binding(2) var<storage,read> previous:array<Pixel>;
@group(0) @binding(3) var<storage,read_write> output:array<Pixel>;
@group(0) @binding(4) var<storage,read_write> color:array<vec4f>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) gid:vec3u){if(any(gid.xy>=u.size.xy)){return;}let i=gid.y*u.size.x+gid.x;let p=current[i];var history=p;history.color.w=0.;var previousXY=vec2i(gid.xy);let moving=u.flags.x>.5;var valid=u.size.z>0u;
 let reflected=moving&&u.size.z>0u&&u.flags.y<.5&&u.flags.w>.5&&p.moments.w>.5&&p.moments.z>0.;
 let transmitted=u.previousUp.w>.5&&p.moments.w==-1.&&p.secondaryNormal.w>.5;
 var reprojectionPoint=p.position.xyz;
 if(reflected){reprojectionPoint+=normalize(p.position.xyz-u.eye.xyz)*p.moments.z;}
 if(moving){let relative=reprojectionPoint-u.previousEye.xyz;let z=dot(relative,u.previousForward.xyz);let aspect=f32(u.size.x)/f32(u.size.y);let ndc=vec2f(dot(relative,u.previousRight.xyz)/aspect,-dot(relative,u.previousUp.xyz))/(max(z,.001)*u.previousForward.w);previousXY=vec2i(floor((ndc*.5+.5)*vec2f(u.size.xy)));valid=valid&&z>0.&&p.position.w!=-1.&&(p.normal.w>.3||reflected||transmitted||(u.flags.w>.5&&p.moments.w==0.))&&u.flags.y<.5;}
 if(valid&&all(previousXY>=vec2i(0))&&all(previousXY<vec2i(u.size.xy))){let old=previous[u32(previousXY.y)*u.size.x+u32(previousXY.x)];let tolerance=max(.003,length(p.position.xyz-u.eye.xyz)*.005);let sky=!moving&&p.position.w==-1.&&old.position.w==-1.;
  var compatible=distance(old.position.xyz,p.position.xyz)<tolerance&&dot(old.normal.xyz,p.normal.xyz)>.97;
  if(transmitted&&moving){
   // Conservative local approximation, not full refractive motion vectors.
   // Both the glass boundary AND what is visible behind it must agree.
   let view=normalize(p.position.xyz-u.eye.xyz);let oldView=normalize(old.position.xyz-u.previousEye.xyz);
   let footprint=length(p.secondary.xyz-u.eye.xyz)*u.forward.w*2./f32(u.size.y);
   compatible=compatible&&old.secondaryNormal.w>.5&&abs(old.secondary.w-p.secondary.w)<.1&&dot(old.secondaryNormal.xyz,p.secondaryNormal.xyz)>.98&&dot(old.normal.xyz,p.normal.xyz)>.999&&distance(view,oldView)<.008&&distance(old.secondary.xyz,p.secondary.xyz)<max(.003,footprint*2.);
  }
  if(!transmitted&&u.previousEye.w>.5&&p.position.w!=-1.&&dot(old.normal.xyz,p.normal.xyz)>.995){
   // A jittered ray can move far along a grazing plane while still sampling
   // the same pixel footprint. Test plane distance AND its projected footprint,
   // rather than rejecting valid history with a fixed world-space radius.
   let view=normalize(p.position.xyz-u.eye.xyz);
   let footprint=length(p.position.xyz-u.eye.xyz)*u.forward.w*4./f32(u.size.y)/max(abs(dot(view,p.normal.xyz)),.02);
   compatible=abs(dot(old.position.xyz-p.position.xyz,p.normal.xyz))<tolerance&&distance(old.position.xyz,p.position.xyz)<max(tolerance,footprint);
  }
  if(reflected){
   let oldVirtual=old.position.xyz+normalize(old.position.xyz-u.previousEye.xyz)*old.moments.z;
   // Conservative planar approximation. Reject curvature, reflected occluder
   // changes and different surfaces, rather than dragging old highlights.
   let footprint=length(reprojectionPoint-u.eye.xyz)*u.forward.w*4./f32(u.size.y);
   let plane=abs(dot(old.position.xyz-p.position.xyz,p.normal.xyz));
   compatible=old.moments.w>.5&&dot(old.normal.xyz,p.normal.xyz)>.995&&plane<tolerance&&abs(old.moments.z-p.moments.z)<max(.02,p.moments.z*.08)&&distance(oldVirtual,reprojectionPoint)<max(tolerance,footprint);
  }
  if(sky||(abs(old.position.w-p.position.w)<.1&&compatible)){history=old;}
 }
 // A rough reflection can retain short surface history when its reflected
 // direction changes by much less than the lobe width. Perfect mirrors and
 // transmission never use this fallback.
 if(reflected&&history.color.w==0.&&p.normal.w>.12){
  let relative=p.position.xyz-u.previousEye.xyz;let z=dot(relative,u.previousForward.xyz);
  let ndc=vec2f(dot(relative,u.previousRight.xyz)*f32(u.size.y)/f32(u.size.x),-dot(relative,u.previousUp.xyz))/(max(z,.001)*u.previousForward.w);
  let pixel=(ndc*.5+.5)*vec2f(u.size.xy)-.5;let base=vec2i(floor(pixel));let fraction=fract(pixel);
  var sum=vec4f(0);var sumMoments=vec2f(0);var total=0.;
  for(var y=0;y<2;y++){for(var x=0;x<2;x++){
   let q=base+vec2i(x,y);
   if(z<=0.||any(q<vec2i(0))||any(q>=vec2i(u.size.xy))){continue;}
   let old=previous[u32(q.y)*u.size.x+u32(q.x)];
   let a=reflect(normalize(p.position.xyz-u.eye.xyz),p.normal.xyz);
   let b=reflect(normalize(old.position.xyz-u.previousEye.xyz),old.normal.xyz);
   let tolerance=max(.003,length(p.position.xyz-u.eye.xyz)*.005);
   if(old.moments.w>.5&&abs(old.position.w-p.position.w)<.1&&dot(old.normal.xyz,p.normal.xyz)>.995&&distance(old.position.xyz,p.position.xyz)<tolerance&&distance(a,b)<p.normal.w*p.normal.w*.5){
    let w=select(1.-fraction.x,fraction.x,x==1)*select(1.-fraction.y,fraction.y,y==1);
    sum+=old.color*w;sumMoments+=old.moments.xy*w;total+=w;
   }
  }}
  if(total>.75){history.color=vec4f(sum.xyz/total,sum.w);history.moments=vec4f(sumMoments/total,history.moments.zw);}
 }
 let stableDiffuse=(u32(u.flags.w)&2u)!=0u&&p.moments.w==0.&&p.normal.w>.2;
 if(stableDiffuse&&moving&&u.size.z>0u&&u.flags.y<.5&&p.position.w!=-1.){
  let relative=p.position.xyz-u.previousEye.xyz;let z=dot(relative,u.previousForward.xyz);
  let ndc=vec2f(dot(relative,u.previousRight.xyz)*f32(u.size.y)/f32(u.size.x),-dot(relative,u.previousUp.xyz))/(max(z,.001)*u.previousForward.w);
  let pixel=(ndc*.5+.5)*vec2f(u.size.xy)-.5;let base=vec2i(floor(pixel));let fraction=fract(pixel);
  let distanceToEye=length(p.position.xyz-u.eye.xyz);let view=normalize(p.position.xyz-u.eye.xyz);
  let tolerance=max(.001,distanceToEye*.001);
  let footprint=distanceToEye*u.forward.w*4./f32(u.size.y)/max(abs(dot(view,p.normal.xyz)),.02);
  var sum=vec4f(0);var sumMoments=vec2f(0);var total=0.;
  if(z>0.){for(var y=0;y<2;y++){for(var x=0;x<2;x++){
   let q=base+vec2i(x,y);if(any(q<vec2i(0))||any(q>=vec2i(u.size.xy))){continue;}
   let old=previous[u32(q.y)*u.size.x+u32(q.x)];let delta=old.position.xyz-p.position.xyz;
   if(abs(old.position.w-p.position.w)>.1||old.moments.w!=0.||dot(old.normal.xyz,p.normal.xyz)<.98||abs(dot(delta,p.normal.xyz))>tolerance||length(delta)>max(tolerance,footprint)){continue;}
   let w=select(1.-fraction.x,fraction.x,x==1)*select(1.-fraction.y,fraction.y,y==1);
   sum+=old.color*w;sumMoments+=old.moments.xy*w;total+=w;
  }}}
  // Weak edge coverage should not carry a full history across disocclusions.
  if(total>.5){history.color=vec4f(sum.xyz/total,sum.w);history.moments=vec4f(sumMoments/total,history.moments.zw);}
 }
 // A static reference integrates all subpixel coverage, including samples that
 // land on different surfaces. Geometry rejection biases silhouette convergence.
 if(u.flags.y>.5&&!moving&&u.size.z>0u){history=previous[i];}
 var result=p.color.rgb;var weight=min(history.color.w,select(511.,2047.,u.flags.y>.5));
 if(moving){
  var low=result;var high=result;
  for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
   let q=clamp(vec2i(gid.xy)+vec2i(x,y),vec2i(0),vec2i(u.size.xy)-1);let neighbor=current[u32(q.y)*u.size.x+u32(q.x)];
   if(stableDiffuse&&(abs(neighbor.position.w-p.position.w)>.1||dot(neighbor.normal.xyz,p.normal.xyz)<.98)){continue;}
   let c=neighbor.color.rgb;low=min(low,c);high=max(high,c);
  }}
  history.color=vec4f(clamp(history.color.rgb,low,high),history.color.w);
  let stableGuide=(u32(u.flags.w)&4u)!=0u;
  var cap=7.;
  if(reflected&&stableGuide&&p.normal.w>.12){cap=15.;}
  if(transmitted){cap=select(3.,7.,stableGuide);}
  weight=min(weight,cap);
 }
 let moments=(p.moments.xy+history.moments.xy*weight)/(weight+1.);
 var variance=max(0.,moments.y-moments.x*moments.x)/max(1.,weight+1.);
 // Bootstrap new/disoccluded pixels: one sample is not a noiseless history.
 if(weight<4.){var m=vec2f(0);var total=0.;for(var y=-2;y<=2;y++){for(var x=-2;x<=2;x++){
  let q=clamp(vec2i(gid.xy)+vec2i(x,y),vec2i(0),vec2i(u.size.xy)-1);let neighbor=current[u32(q.y)*u.size.x+u32(q.x)];
  if(abs(neighbor.position.w-p.position.w)<.1&&dot(neighbor.normal.xyz,p.normal.xyz)>.9){m+=neighbor.moments.xy;total+=1.;}
 }}if(total>1.){m/=total;variance=max(variance,max(0.,m.y-m.x*m.x)/max(1.,weight+1.));}}
 result=(result+history.color.rgb*weight)/(weight+1.);output[i]=Pixel(vec4f(result,weight+1.),p.position,p.normal,vec4f(moments,p.moments.zw),p.secondary,p.secondaryNormal);color[i]=vec4f(result,variance);
}
