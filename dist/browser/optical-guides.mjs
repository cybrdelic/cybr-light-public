// Independent reflected/transmitted edge guides. This changes reconstruction
// metadata, never stochastic transport or the reference radiance estimator.
export function opticalGuideShader(name,source){
 source=source.replaceAll('\r\n','\n');
 const replace=(a,b)=>{if(!source.includes(a))throw Error(`Optical guide contract changed: ${name}`);source=source.replace(a,b);};
 replace('indirect:vec4f,indirectMoments:vec4f','indirect:vec4f,indirectMoments:vec4f,reflectedPosition:vec4f,reflectedNormal:vec4f');
 replace('return Pixel(c,s.position,s.normal,m,s.secondary,s.secondaryNormal);','if(channel==1u){return Pixel(c,s.position,s.normal,m,s.reflectedPosition,s.reflectedNormal);}\n return Pixel(c,s.position,s.normal,m,s.secondary,s.secondaryNormal);');
 if(name==='trace'||name==='trace-pile'){
  replace('@compute @workgroup_size(8,8) fn main',`
fn reflectedSurface(first:Hit,ray:vec3f)->TransmissionGuide{
 var invalid=TransmissionGuide(vec4f(0,0,0,-1),vec4f(0));if(first.id<0){return invalid;}
 let firstMaterial=material(first);if(firstMaterial.physical.y<.5&&firstMaterial.base.w>.4){return invalid;}
 let point=u.eye.xyz+ray*first.t;let gn=geometric(first);let oriented=select(-gn,gn,dot(ray,gn)<0.);
 var normal0=normal(first);if(dot(normal0,oriented)<0.){normal0=-normal0;}
 var d=reflect(ray,normal0);if(dot(d,oriented)<=0.){d=reflect(ray,oriented);}
 var o=point+oriented*.0001;var stack:MediumStack;var ior=1.;
 for(var depth=1u;depth<min(u.size.w,16u);depth++){
  let h=trace(o,d,1e20,false);if(h.id==-1||lightHit(o,d)<h.t){return invalid;}
  let m=material(h);let p=o+d*h.t;let g=geometric(h);let entering=dot(d,g)<0.;let ng=select(-g,g,entering);
  var n=normal(h);if(dot(n,ng)<0.){n=-n;}if(dot(n,-d)<.001){n=ng;}
  if(m.physical.y<.5){var surface=-2.;if(h.id>=0){surface=triangles[h.id].p.w+3.;}return TransmissionGuide(vec4f(p,surface),vec4f(n,1));}
  let boundary=u32(attributes[h.id].n0.w);let inside=vec4f(0,0,0,m.physical.z);
  let destination=mediumTarget(&stack,boundary,entering,inside);let incident=select(ior,m.physical.z,!entering&&stack.count==0u);
  var next=refract(d,n,incident/destination.w);if(dot(next,ng)>0.){next=refract(d,ng,incident/destination.w);}
  if(dot(next,next)<.01){return invalid;}
  commitMedium(&stack,boundary,entering,inside);ior=destination.w;d=normalize(next);o=p-ng*.0001;
 }
 return invalid;
}
@compute @workgroup_size(8,8) fn main`);
  replace('var startDepth=0u;','var reflectedEdge=TransmissionGuide(vec4f(0,0,0,-1),vec4f(0));\n if(u.flags.y<.5){reflectedEdge=reflectedSurface(guide,guideDirection);}\n var startDepth=0u;');
  replace('vec4f(il,il*il,0,0));','vec4f(il,il*il,0,0),reflectedEdge.position,reflectedEdge.normal);');
  // Mark rough non-metal content separately from a valid but view-dependent hit.
  source=source.replaceAll('return TransmissionGuide(vec4f(p,surface),vec4f(n,1));','return TransmissionGuide(vec4f(p,surface),vec4f(n,select(1.,2.,m.physical.x<.01&&m.base.w>.4)));');
 }else if(name==='filter'){
  replace('if(CHANNEL==2u){','if(CHANNEL==2u||CHANNEL==1u){');
  replace('let viewDependent=center.normal.w<.3&&(config.w==0u||center.moments.w!=0.);','let contentGuided=(CHANNEL==1u||CHANNEL==2u)&&center.secondaryNormal.w>1.5;\n let viewDependent=!contentGuided&&center.normal.w<.3&&(config.w==0u||center.moments.w!=0.);');
  replace('w*=pow(max(dot(center.normal.xyz,other.normal.xyz),0.),32.);','let cn=select(center.normal.xyz,center.secondaryNormal.xyz,contentGuided);let on=select(other.normal.xyz,other.secondaryNormal.xyz,contentGuided);\n   w*=pow(max(dot(cn,on),0.),32.);');
  replace('let delta=other.position.xyz-center.position.xyz;\n   let plane=max(abs(dot(delta,center.normal.xyz)),abs(dot(delta,other.normal.xyz)));','let delta=select(other.position.xyz-center.position.xyz,other.secondary.xyz-center.secondary.xyz,contentGuided);\n   let plane=max(abs(dot(delta,cn)),abs(dot(delta,on)));');
 }else if(name==='fused-filter'){
  replace('let viewDependent=','var viewDependent=');
  replace('let sky=','if(c.reflectedNormal.w>1.5){viewDependent.y=false;}if(c.secondaryNormal.w>1.5){viewDependent.z=false;}\n let sky=');
  replace('var w=vec4f(geometricWeight)*exp(-abs(value-nl)/phi);',`
  var geometry=vec4f(geometricWeight);
  if(c.reflectedNormal.w>1.5){
   let delta=other.reflectedPosition.xyz-c.reflectedPosition.xyz;let plane=max(abs(dot(delta,c.reflectedNormal.xyz)),abs(dot(delta,other.reflectedNormal.xyz)));
   geometry.y=kernel(x)*kernel(y)*pow(max(dot(c.reflectedNormal.xyz,other.reflectedNormal.xyz),0.),32.)*exp(-plane/max(.002,.005*f32(config.z)));
  }
  if(c.secondaryNormal.w>1.5){
   let delta=other.secondary.xyz-c.secondary.xyz;let plane=max(abs(dot(delta,c.secondaryNormal.xyz)),abs(dot(delta,other.secondaryNormal.xyz)));
   geometry.z=kernel(x)*kernel(y)*pow(max(dot(c.secondaryNormal.xyz,other.secondaryNormal.xyz),0.),32.)*exp(-plane/max(.002,.005*f32(config.z)));
  }
  var w=geometry*exp(-abs(value-nl)/phi);`);
  replace('if(c.secondaryNormal.w!=other.secondaryNormal.w)',`
  if(c.reflectedNormal.w!=other.reflectedNormal.w){w.y=0.;}
  if(c.reflectedNormal.w>.5){
   let delta=other.reflectedPosition.xyz-c.reflectedPosition.xyz;
   if(abs(c.reflectedPosition.w-other.reflectedPosition.w)>.1||dot(c.reflectedNormal.xyz,other.reflectedNormal.xyz)<.98||abs(dot(delta,c.reflectedNormal.xyz))>max(.003,.005*f32(config.z))){w.y=0.;}
  }
  if(c.secondaryNormal.w!=other.secondaryNormal.w)`);
 }else if(name==='reconstruct'){
  // Reflection history is accepted only when its independently visible content
  // also agrees. The front-surface normal alone is not sufficient.
  replace('if(sky||(abs(old.position.w-p.position.w)<.1&&compatible)){history=old;}',`
  if(channel==1u&&moving&&p.secondaryNormal.w>.5){
   let footprint=max(.003,length(p.secondary.xyz-u.eye.xyz)*u.forward.w*4./f32(u.size.y));
   compatible=compatible&&old.secondaryNormal.w>.5&&abs(old.secondary.w-p.secondary.w)<.1&&dot(old.secondaryNormal.xyz,p.secondaryNormal.xyz)>.98&&distance(old.secondary.xyz,p.secondary.xyz)<footprint;
  }
  if(sky||(abs(old.position.w-p.position.w)<.1&&compatible)){history=old;}`);
  // All channels write their own radiance; one invocation owns extra metadata.
  replace('let moments=(p.moments.xy+', 'if(channel==0u){output[i].reflectedPosition=current[i].reflectedPosition;output[i].reflectedNormal=current[i].reflectedNormal;}\n let moments=(p.moments.xy+');
 }
 return source;
}
