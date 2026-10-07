struct Signals {diffuse:vec4f,specular:vec4f,transmission:vec4f,emission:vec4f}
struct Guide {position:vec4f,normal:vec4f,identity:vec4u,albedo:vec4f}
struct Lab {mode:u32,epoch:u32,view:u32,referenceFrame:u32,sampling:vec4f}
@group(1) @binding(0) var visibility:texture_multisampled_2d<u32>;
@group(1) @binding(6) var visibilityHigh:texture_multisampled_2d<u32>;
@group(1) @binding(1) var<storage,read_write> signals:array<Signals>;
@group(1) @binding(2) var<storage,read_write> guides:array<Guide>;
@group(1) @binding(3) var<storage,read_write> result:array<vec4f>;
@group(1) @binding(4) var<uniform> lab:Lab;
fn diffuseFraction(n:vec3f,wo:vec3f,wi:vec3f,color:vec3f,metal:f32,diffuseOnly:f32,total:vec3f)->vec3f{
 if(diffuseOnly>.5){return vec3f(1);}
 let h=normalize(wo+wi);let f=fresnel(mix(vec3f(.04),color,metal),max(dot(wo,h),0.));
 let diffuse=color*(1.-metal)*(vec3f(1)-f)/PI;
 return clamp(diffuse/max(total,vec3f(1e-30)),vec3f(0),vec3f(1));
}
fn addSignal(out:ptr<function,Signals>,value:vec3f,fraction:vec3f,kind:u32){
 if(kind==0u){(*out).diffuse+=vec4f(value*fraction,0);(*out).specular+=vec4f(value*(vec3f(1)-fraction),0);}
 else if(kind==1u){(*out).specular+=vec4f(value,0);}
 else if(kind==2u){(*out).transmission+=vec4f(value,0);}
 else{(*out).emission+=vec4f(value,0);}
}
fn sumSignals(s:Signals)->vec3f{return s.diffuse.rgb+s.specular.rgb+s.transmission.rgb+s.emission.rgb;}
fn showSignals(sum:Signals)->vec3f{
 var color=sumSignals(sum);
 if(lab.view==1u){color=sum.diffuse.rgb;}if(lab.view==2u){color=sum.specular.rgb;}if(lab.view==3u){color=sum.transmission.rgb;}if(lab.view==4u){color=sum.emission.rgb;}
 return color;
}
fn dataHit(data:vec4u)->Hit{
 if(data.x==0u){return Hit(1e20,-1,vec2f(0)/*ZERO_INSTANCE*/);}
 if(data.x==1u){let p=vec3f(bitcast<f32>(data.z),u.eye.w,bitcast<f32>(data.w));return Hit(length(p-u.eye.xyz),-2,vec2f(0)/*ZERO_INSTANCE*/);}
 let bary=vec2f(bitcast<f32>(data.z),bitcast<f32>(data.w&0x7fffffffu));let tr=triangles[data.x-3u];var p=tr.p.xyz+tr.e1.xyz*bary.x+tr.e2.xyz*bary.y;
 /*WORLD_POINT*/
 return Hit(length(p-u.eye.xyz),i32(data.x)-3,bary/*DATA_INSTANCE*/);
}
fn dataDirection(data:vec4u,h:Hit)->vec3f{
 if(data.x==0u){return camera(vec2f(bitcast<f32>(data.z),bitcast<f32>(data.w)));}
 if(data.x==1u){return normalize(vec3f(bitcast<f32>(data.z),u.eye.w,bitcast<f32>(data.w))-u.eye.xyz);}
 let tr=triangles[h.id];var p=tr.p.xyz+tr.e1.xyz*h.bary.x+tr.e2.xyz*h.bary.y;
 /*WORLD_POINT*/
 return normalize(p-u.eye.xyz);
}
@compute @workgroup_size(8,8) fn resolveRasterSignals(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=u.size.xy)){return;}let index=gid.y*u.size.x+gid.x;var sum:Signals;var guide:Guide;
 let count=u.size.x*u.size.y;let current=(u.size.z&1u)*count+index;let previous=((u.size.z+1u)&1u)*count+index;
 for(var s=0u;s<4u;s++){
  let data=textureLoad(visibility,vec2i(gid.xy),i32(s))|(textureLoad(visibilityHigh,vec2i(gid.xy),i32(s))<<vec4u(16));
  var h=dataHit(data);let d=dataDirection(data,h);
  let m=material(h);var materialId=1u;var boundary=0.;
  if(h.id>=0){materialId=u32(triangles[h.id].p.w)+3u;boundary=attributes[h.id].n0.w;}
  if(h.id==-1){materialId=0u;}
  var n=normal(h);if(dot(n,d)>0.){n=-n;}
  let point=u.eye.xyz+d*h.t;
  let albedo=m.base.rgb*vertexColor(h)*select(1.-m.physical.x,1.,m.physical.w>.5);
  if(s==0u){
   guide.identity=vec4u(materialId,data.y,lab.epoch,select(0u,1u,data.x!=0u));
   guide.position=vec4f(point,h.t);guide.normal=vec4f(n,m.base.w);guide.albedo=vec4f(0,0,0,boundary);
  }else if(guide.identity.x!=materialId||guide.identity.y!=data.y||guide.albedo.w!=boundary||dot(guide.normal.xyz,n)<.995||abs(dot(point-guide.position.xyz,n))>max(.0001,h.t*u.forward.w/f32(u.size.y))){guide.identity.w=0u;}
  guide.albedo=vec4f(guide.albedo.rgb+albedo*.25,guide.albedo.w);
  if(lab.mode==8u){h=trace(u.eye.xyz,d,1e20,false);}
  let seed=(index*4u+s)*9781u+lab.referenceFrame*6271u+89173u;
  if(lab.mode==9u){sum.emission+=vec4f(incident(u.eye.xyz,d,seed,0.)*.25,0);continue;}
  let value=rasterTransport(u.eye.xyz,d,seed,0.,h);
  sum.diffuse+=value.diffuse*.25;sum.specular+=value.specular*.25;sum.transmission+=value.transmission*.25;sum.emission+=value.emission*.25;
 }
 if(lab.mode!=10u&&lab.mode!=11u&&lab.mode!=12u&&lab.referenceFrame>0u){let old=signals[previous];let a=1./f32(lab.referenceFrame+1u);sum=Signals(mix(old.diffuse,sum.diffuse,a),mix(old.specular,sum.specular,a),mix(old.transmission,sum.transmission,a),mix(old.emission,sum.emission,a));}
 signals[current]=sum;guides[current]=guide;
 result[index]=vec4f(showSignals(sum),1);
}
