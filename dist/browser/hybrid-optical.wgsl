// Optical correspondence is an endpoint map, not primary-surface motion.
struct Optical {endpoint:vec4f,normal:vec4f,identity:vec4u,weight:vec4f}
struct OpticalPair {reflection:Optical,transmission:Optical}
@group(1) @binding(5) var<storage,read_write> optical:array<OpticalPair>;
fn opticalInstance(h:Hit)->u32{return /*OPTICAL_INSTANCE*/;}
fn opticalKey(h:Hit)->vec2u{
 if(h.id==-2){return vec2u(1,0);}if(h.id<0){return vec2u(0);}
 return vec2u(u32(attributes[h.id].n0.w)+3u,opticalInstance(h));
}
fn opticalHash(hash:u32,key:vec2u,event:u32)->u32{return ((((hash^key.x)*16777619u)^key.y)*16777619u)^event;}
fn traceOptical(first:Hit,initialDirection:vec3f,transmission:bool)->Optical{
 var out:Optical;var h=first;var origin=u.eye.xyz;var direction=initialDirection;
 var media:MediumStack;var medium=vec3f(0);var ior=1.;var weight=vec3f(1);var confidence=1.;var distance=0.;var chain=2166136261u;
 let primary=material(first);let rough=primary.base.w;
 if(first.id<0||(!transmission&&primary.physical.y<.5&&rough>.65)||(transmission&&primary.physical.y<.5)){return out;}
 for(var depth=0u;depth<min(u.size.w,16u);depth++){
  if(depth>0u){h=trace(origin,direction,1e20,false);}
  let lamp=lightHit(origin,direction);let segment=min(h.t,lamp);weight*=exp(-medium*segment);distance+=segment;
  if(lamp<h.t){return Optical(vec4f(origin+direction*lamp,distance),vec4f(0,-1,0,rough),vec4u(2,0,chain,1),vec4f(weight,confidence));}
  if(h.id==-1){return Optical(vec4f(direction,0),vec4f(0,0,0,rough),vec4u(0,0,chain,2),vec4f(weight,confidence));}
  let p=origin+direction*h.t;let gn=geometric(h);let entering=dot(direction,gn)<0.;let geometricNormal=select(-gn,gn,entering);
  var n=normal(h);if(dot(n,geometricNormal)<0.){n=-n;}if(dot(n,-direction)<.001){n=geometricNormal;}
  let m=material(h);
  if(depth>0u&&(m.physical.y<.5||any(m.emission.xyz>vec3f(0)))){return Optical(vec4f(p,distance),vec4f(n,rough),vec4u(opticalKey(h),chain,1),vec4f(weight,confidence));}
  if(m.physical.y<.5){
   direction=reflect(direction,n);if(dot(direction,geometricNormal)<=0.){direction=reflect(initialDirection,geometricNormal);}
   chain=opticalHash(chain,opticalKey(h),1u);origin=p+geometricNormal*.0001;continue;
  }
  let boundary=/*OPTICAL_BOUNDARY*/;
  let inside=vec4f(-log(clamp(m.attenuation.xyz,vec3f(1e-20),vec3f(1)))/max(m.attenuation.w,1e-8),m.physical.z);
  let next=mediumTarget(&media,boundary,entering,inside);
  let incidentIor=select(ior,m.physical.z,!entering&&media.count==0u);let eta=incidentIor/next.w;
  var refracted=refract(direction,n,eta);var reflected=reflect(direction,n);
  if(dot(reflected,geometricNormal)<=0.||dot(refracted,geometricNormal)>0.){n=geometricNormal;refracted=refract(direction,n,eta);reflected=reflect(direction,n);}
  let f=dielectricFresnel(max(0.,dot(-direction,n)),incidentIor,next.w);
  if(depth==0u&&!transmission){weight*=f;direction=reflected;chain=opticalHash(chain,opticalKey(h),1u);origin=p+geometricNormal*.0001;continue;}
  if(dot(refracted,refracted)<.01){
   if(depth==0u){return out;}direction=reflected;chain=opticalHash(chain,opticalKey(h),3u);origin=p+geometricNormal*.0001;
  }else{
   weight*=(1.-f)*eta*eta;if(depth>0u){confidence*=1.-f;}if(confidence<.5){return out;}
   commitMedium(&media,boundary,entering,inside);ior=next.w;medium=next.xyz;
   direction=normalize(refracted);chain=opticalHash(chain,opticalKey(h),select(4u,2u,entering));origin=p-geometricNormal*.0001;
  }
 }
 return out;
}
@compute @workgroup_size(8,8) fn buildOpticalGuides(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=u.size.xy)){return;}let index=gid.y*u.size.x+gid.x;let current=(u.size.z&1u)*u.size.x*u.size.y+index;
 var pair:OpticalPair;
 if(guides[current].identity.w==1u){
  let data=textureLoad(visibility,vec2i(gid.xy),0)|(textureLoad(visibilityHigh,vec2i(gid.xy),0)<<vec4u(16));
  let h=dataHit(data);let d=dataDirection(data,h);
  pair.reflection=traceOptical(h,d,false);pair.transmission=traceOptical(h,d,true);
 }
 optical[current]=pair;
}
fn opticalAt(index:u32,transmission:bool)->Optical{if(transmission){return optical[index].transmission;}return optical[index].reflection;}
fn matchingOptical(a:Optical,b:Optical)->bool{
 return a.identity.w!=0u&&all(a.identity==b.identity)&&a.weight.w>=.5&&b.weight.w>=.5&&(a.identity.w==2u||dot(a.normal.xyz,b.normal.xyz)>.95);
}
// Correct four-corner inverse, opt-in until it beats the existing motion result.
fn opticalHistoryBilinear(current:u32,previous:u32,transmission:bool)->vec4f{
 let currentOptic=opticalAt(current,transmission);if(currentOptic.identity.w==0u||currentOptic.weight.w<.5){return vec4f(0);}
 let primary=guides[current];let delta=primary.position.xyz-u.previousEye.xyz;let z=dot(delta,u.previousForward.xyz);if(z<=0.){return vec4f(0);}
 let ndc=vec2f(dot(delta,u.previousRight.xyz)/(z*u.previousForward.w*f32(u.size.x)/f32(u.size.y)),dot(delta,u.previousUp.xyz)/(z*u.previousForward.w));
 var pixel=(ndc*vec2f(.5,-.5)+.5)*vec2f(u.size.xy)-.5-rasterJitterAt(u32(lab.sampling.y));let start=pixel;
 var footprint=0.;
 // Invert the previous optical endpoint map with a local least-squares solve.
 // Singular/folded neighborhoods and path discontinuities reject, never blur.
 for(var iteration=0u;iteration<4u;iteration++){
  let p=vec2i(floor(pixel));if(any(p<vec2i(0))||any(p+vec2i(1)>=vec2i(u.size.xy))){return vec4f(0);}
  let index=previous+u32(p.y)*u.size.x+u32(p.x);
  let a=opticalAt(index,transmission);let bx=opticalAt(index+1u,transmission);let by=opticalAt(index+u.size.x,transmission);let bxy=opticalAt(index+u.size.x+1u,transmission);
  if(!matchingOptical(a,currentOptic)||!matchingOptical(bx,currentOptic)||!matchingOptical(by,currentOptic)||!matchingOptical(bxy,currentOptic)){return vec4f(0);}
  let x0=bx.endpoint.xyz-a.endpoint.xyz;let x1=bxy.endpoint.xyz-by.endpoint.xyz;
  let y0=by.endpoint.xyz-a.endpoint.xyz;let y1=bxy.endpoint.xyz-bx.endpoint.xyz;let f=fract(pixel);
  // The history gather is bilinear; invert that same map, not the plane
  // through three corners. Check all corner orientations for a folded cell.
  let orientation=cross(x0,y0);
  if(dot(orientation,cross(x0,y1))<=0.||dot(orientation,cross(x1,y0))<=0.||dot(orientation,cross(x1,y1))<=0.){return vec4f(0);}
  let dx=mix(x0,x1,f.y);let dy=mix(y0,y1,f.x);
  let endpoint=mix(mix(a.endpoint.xyz,bx.endpoint.xyz,f.x),mix(by.endpoint.xyz,bxy.endpoint.xyz,f.x),f.y);
  let residual=currentOptic.endpoint.xyz-endpoint;
  let aa=dot(dx,dx);let bb=dot(dx,dy);let cc=dot(dy,dy);let areaNormal=cross(dx,dy);let det=dot(areaNormal,areaNormal);
  if(det<=max(1e-24,aa*cc*.0001)){return vec4f(0);}
  let step=vec2f(cc*dot(dx,residual)-bb*dot(dy,residual),aa*dot(dy,residual)-bb*dot(dx,residual))/det;
  pixel+=step*min(1.,8./max(length(step),1e-8));footprint=max(length(dx),length(dy));
  if(distance(pixel,start)>24.){return vec4f(0);}
 }
 return gatherOpticalHistory(current,previous,transmission,pixel,footprint);
}
// Both inverse methods use the same history acceptance, weights, and signal ABI.
fn gatherOpticalHistory(current:u32,previous:u32,transmission:bool,pixel:vec2f,footprint:f32)->vec4f{
 let currentOptic=opticalAt(current,transmission);let primary=guides[current];
 let base=vec2i(floor(pixel));let f=fract(pixel);var sum=vec4f(0);var weight=0.;
 for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let p=base+vec2i(x,y);if(any(p<vec2i(0))||any(p>=vec2i(u.size.xy))){continue;}
  let index=previous+u32(p.y)*u.size.x+u32(p.x);let old=opticalAt(index,transmission);let oldPrimary=guides[index];
  if(!matchingOptical(old,currentOptic)||any(oldPrimary.identity.xyz!=primary.identity.xyz)||oldPrimary.albedo.w!=primary.albedo.w||oldPrimary.identity.w==0u||dot(oldPrimary.normal.xyz,primary.normal.xyz)<.95){continue;}
  if(distance(old.endpoint.xyz,currentOptic.endpoint.xyz)>max(1e-5,footprint*1.75)){continue;}
  if(any(old.weight.rgb<vec3f(.00001))){continue;}
  let ratio=currentOptic.weight.rgb/old.weight.rgb;if(any(ratio<vec3f(.5))||any(ratio>vec3f(2))){continue;}
  let w=select(1.-f.x,f.x,x==1)*select(1.-f.y,f.y,y==1);
  var history=signals[index].specular;if(transmission){history=signals[index].transmission;}
  sum+=vec4f(history.rgb*ratio,history.w)*w;weight+=w;
 }}
 if(weight<.75){return vec4f(0);}return sum/weight;
}
// Retained compatibility baseline. The three-corner inverse is approximate;
// do not describe it as inversion of the bilinear gather.
fn opticalHistory(current:u32,previous:u32,transmission:bool)->vec4f{
 let currentOptic=opticalAt(current,transmission);if(currentOptic.identity.w==0u||currentOptic.weight.w<.5){return vec4f(0);}
 let primary=guides[current];let delta=primary.position.xyz-u.previousEye.xyz;let z=dot(delta,u.previousForward.xyz);if(z<=0.){return vec4f(0);}
 let ndc=vec2f(dot(delta,u.previousRight.xyz)/(z*u.previousForward.w*f32(u.size.x)/f32(u.size.y)),dot(delta,u.previousUp.xyz)/(z*u.previousForward.w));
 var pixel=(ndc*vec2f(.5,-.5)+.5)*vec2f(u.size.xy)-.5-rasterJitterAt(u32(lab.sampling.y));let start=pixel;var footprint=0.;
 for(var iteration=0u;iteration<4u;iteration++){
  let p=vec2i(floor(pixel));if(any(p<vec2i(0))||any(p+vec2i(1)>=vec2i(u.size.xy))){return vec4f(0);}
  let index=previous+u32(p.y)*u.size.x+u32(p.x);
  let a=opticalAt(index,transmission);let bx=opticalAt(index+1u,transmission);let by=opticalAt(index+u.size.x,transmission);
  if(!matchingOptical(a,currentOptic)||!matchingOptical(bx,currentOptic)||!matchingOptical(by,currentOptic)){return vec4f(0);}
  let dx=bx.endpoint.xyz-a.endpoint.xyz;let dy=by.endpoint.xyz-a.endpoint.xyz;let f=fract(pixel);
  let residual=currentOptic.endpoint.xyz-(a.endpoint.xyz+dx*f.x+dy*f.y);
  let aa=dot(dx,dx);let bb=dot(dx,dy);let cc=dot(dy,dy);let det=aa*cc-bb*bb;
  if(det<=max(1e-24,aa*cc*.0001)){return vec4f(0);}
  let step=vec2f(cc*dot(dx,residual)-bb*dot(dy,residual),aa*dot(dy,residual)-bb*dot(dx,residual))/det;
  pixel+=step*min(1.,8./max(length(step),1e-8));footprint=max(length(dx),length(dy));
  if(distance(pixel,start)>24.){return vec4f(0);}
 }
 return gatherOpticalHistory(current,previous,transmission,pixel,footprint);
}
