const SLOTS=2097152u;
struct Cell {key:vec4u,value:vec4f,seen:vec4u}
struct Lab {mode:u32,epoch:u32,grid:u32,referenceFrame:u32}
@group(1) @binding(0) var visibility:texture_multisampled_2d<u32>;
@group(1) @binding(1) var<storage,read_write> owners:array<atomic<u32>>;
@group(1) @binding(2) var<storage,read_write> cells:array<Cell>;
@group(1) @binding(3) var<storage,read_write> result:array<vec4f>;
@group(1) @binding(4) var<uniform> lab:Lab;
@group(1) @binding(5) var<storage,read_write> statistics:array<atomic<u32>>;
@group(1) @binding(6) var visibilityHigh:texture_multisampled_2d<u32>;
fn loadVisibility(p:vec2i,s:i32)->vec4u{
 let data=textureLoad(visibility,p,s)|(textureLoad(visibilityHigh,p,s)<<vec4u(16));
 if(lab.mode==6u&&data.x==0u&&u.eye.y>u.eye.w){
  let d=camera(vec2f(p)+.5);if(d.y<-.00001){let t=(u.eye.w-u.eye.y)/d.y;let point=u.eye.xyz+d*t;
   if(all(abs(point.xz)<=vec2f(100.))){return vec4u(1,0,bitcast<u32>(point.x),bitcast<u32>(point.z));}
  }
 }
 return data;
}
fn hash(v:vec4u)->u32 {var x=(v.x*0x9e3779b9u)^(v.y*0x85ebca6bu)^(v.z*0xc2b2ae35u)^v.w;x^=x>>16u;x*=0x7feb352du;x^=x>>15u;x*=0x846ca68bu;return x^(x>>16u);}
fn lookup(key:vec4u)->u32{
 let base=(hash(key)%(SLOTS/8u))*8u;
 for(var i=0u;i<8u;i++){if(all(cells[base+i].key==key)){return base+i;}}
 return SLOTS;
}
fn allocation(key:vec4u)->u32{
 let found=lookup(key);if(found!=SLOTS){return found;}let base=(hash(key)%(SLOTS/8u))*8u;
 let start=(hash(key)>>16u)%8u;
 for(var i=0u;i<8u;i++){let slot=base+(start+i)%8u;if(cells[slot].key.w!=lab.epoch){return slot;}}
 var oldest=u.size.z;var best=SLOTS;
 for(var i=0u;i<8u;i++){let seen=cells[base+i].seen.x;
  // Do not thrash a cell that was visible this frame or the preceding one.
  if(seen+1u<u.size.z&&seen<oldest){oldest=seen;best=base+i;}
 }
 return best;
}
fn surface(data:vec4u)->Hit {return Hit(0.,i32(data.x)-3,vec2f(bitcast<f32>(data.z),bitcast<f32>(data.w&0x7fffffffu))/*DATA_INSTANCE*/);}
fn pointAt(h:Hit)->vec3f {if(h.id==-2){return vec3f(h.bary.x,u.eye.w,h.bary.y);}let tr=triangles[h.id];let local=tr.p.xyz+tr.e1.xyz*h.bary.x+tr.e2.xyz*h.bary.y;/*POINT_TRANSFORM*/}
struct Support {key:vec4u,weight:f32}
fn supportFor(data:vec4u,corner:u32)->Support {
 if(data.x==1u){
  let scaled=vec2f(bitcast<f32>(data.z),bitcast<f32>(data.w))/.05;let base=floor(scaled);let f=fract(scaled);
  var a=base;var weight=1.-f.x-f.y;
  if(f.x+f.y<=1.){if(corner==1u){a+=vec2f(1,0);weight=f.x;}if(corner==2u){a+=vec2f(0,1);weight=f.y;}}
  else{a+=vec2f(1);weight=f.x+f.y-1.;if(corner==1u){a=base+vec2f(1,0);weight=1.-f.y;}if(corner==2u){a=base+vec2f(0,1);weight=1.-f.x;}}
  return Support(vec4u(1,bitcast<u32>(a.x*.05),bitcast<u32>(a.y*.05),lab.epoch),max(weight,0.));
 }
 var b=max(surface(data).bary,vec2f(0));if(b.x+b.y>1.){b/=b.x+b.y;}
 let tri=triangles[data.x-3u];let scale=/*SURFACE_SCALE*/;
 var grid=min(lab.grid,max(1u,u32(ceil(max(length(tri.e1.xyz),length(tri.e2.xyz))*scale/.025))));
 let scaled=b*f32(grid);let base=min(vec2u(scaled),vec2u(grid-1u));let f=scaled-vec2f(base);
 var a=base;var weight=1.-f.x-f.y;
 if(f.x+f.y<=1.){
  if(corner==1u){a+=vec2u(1,0);weight=f.x;}if(corner==2u){a+=vec2u(0,1);weight=f.y;}
 }else{
  a+=vec2u(1);weight=f.x+f.y-1.;
  if(corner==1u){a=base+vec2u(1,0);weight=1.-f.y;}if(corner==2u){a=base+vec2u(0,1);weight=1.-f.x;}
 }
 var id=data.x;
 if(all(a==vec2u(0))||all(a==vec2u(grid,0))||all(a==vec2u(0,grid))){
  let attr=attributes[data.x-3u];var canonical=u32(attr.c0.w);
  if(a.x==grid){canonical=u32(attr.c1.w);}if(a.y==grid){canonical=u32(attr.c2.w);}
  id=canonical/3u+3u;let vertex=canonical%3u;grid=1u;a=vec2u(select(0u,1u,vertex==1u),select(0u,1u,vertex==2u));
 }
 return Support(vec4u(id,data.y,(a.x|(a.y<<8u)|(grid<<16u))|(data.w&0x80000000u),lab.epoch),max(weight,0.));
}
fn hitFor(key:vec4u)->Hit {
 if(key.x==1u){return Hit(0.,-2,vec2f(bitcast<f32>(key.y),bitcast<f32>(key.z))/*GROUND_INSTANCE*/);}
 let b=vec2f(f32(key.z&255u),f32((key.z>>8u)&255u))/f32((key.z>>16u)&255u);
 return Hit(0.,i32(key.x)-3,b/*KEY_INSTANCE*/);
}
fn directIrradiance(p:vec3f,n:vec3f,gn:vec3f,epsilon:f32,seed:ptr<function,u32>)->vec3f{
 var value=vec3f(0);let start=p+gn*epsilon;
 // Same studio mixture and MIS PDFs as the production integrator.
 if(areaSelection()>=1.||random(seed)<areaSelection()){
  let lp=vec3f((random(seed)-.5)*4.,4.5,(random(seed)-.5)*3.);let lv=lp-p;let distance=length(lv);let wi=lv/distance;let cosine=max(dot(n,wi),0.);
  if(cosine>0.&&dot(gn,wi)>0.&&wi.y>0.){let pdf=areaSelection()*distance*distance/(wi.y*12.);
   if(trace(start,wi,distance-epsilon*3.,true).id==-1){value=vec3f(10,9.7,9.2)*(cosine/PI)/pdf*mis(pdf,cosine/PI);}
  }
 }else{
  let wi=sampleEnvironment(seed);let cosine=max(dot(n,wi),0.);let pdf=(1.-areaSelection())*environmentPDF(wi);
  if(cosine>0.&&dot(gn,wi)>0.&&trace(start,wi,1e20,true).id==-1&&lightHit(start,wi)>1e19){value=environment(wi)*(cosine/PI)/pdf*mis(pdf,cosine/PI);}
 }
 return value;
}
fn sampleIrradiance(h:Hit,back:bool,seedValue:u32)->vec3f{
 var seed=seedValue;let gn=select(geometric(h),-geometric(h),back);var n=normal(h);if(dot(n,gn)<0.){n=-n;}
 let epsilon=/*EPSILON*/;
 let p=pointAt(h);let direct=directIrradiance(p,n,gn,epsilon,&seed);
 let r=sqrt(random(&seed));let phi=2.*PI*random(&seed);let d=basis(n,vec3f(r*cos(phi),r*sin(phi),sqrt(max(0.,1.-r*r))));
 if(dot(d,gn)<=0.){return direct;}
 if(lab.mode==6u){return direct+incidentAfterPrimary(p+gn*epsilon,d,seed,max(dot(n,d),0.)/PI);}
 return direct+incident(p+gn*epsilon,d,seed,max(dot(n,d),0.)/PI);
}
@compute @workgroup_size(128) fn clearOwners(@builtin(global_invocation_id) gid:vec3u){if(gid.x<SLOTS){atomicStore(&owners[gid.x],0xffffffffu);}}
@compute @workgroup_size(16) fn clearStatistics(@builtin(global_invocation_id) gid:vec3u){if(gid.x<16u){atomicStore(&statistics[gid.x],0u);}}
@compute @workgroup_size(8,8) fn request(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=u.size.xy)){return;}
 for(var s=0u;s<4u;s++){let data=loadVisibility(vec2i(gid.xy),i32(s));if(data.x==0u){continue;}
  // Analytic floor requests use the same pixel-center location for every
  // coverage sample. Keep the first owner; duplicate atomic requests add no data.
  if(data.x==1u&&s>0u&&loadVisibility(vec2i(gid.xy),0).x==1u){continue;}
  for(var corner=0u;corner<3u;corner++){let support=supportFor(data,corner);if(support.weight<1e-7){continue;}let key=support.key;let slot=allocation(key);if(slot==SLOTS){continue;}let index=((gid.y*u.size.x+gid.x)*4u+s)*3u+corner;
  // Keys are published in the NEXT dispatch, never a cross-workgroup spin lock.
  atomicMin(&owners[slot],index);
  }
 }
}
fn requestedKey(index:u32)->vec4u{
 let sample=index/3u;let pixel=sample/4u;let data=loadVisibility(vec2i(i32(pixel%u.size.x),i32(pixel/u.size.x)),i32(sample%4u));return supportFor(data,index%3u).key;
}
@compute @workgroup_size(64) fn publish(@builtin(global_invocation_id) gid:vec3u){
 let slot=gid.x;if(slot>=SLOTS){return;}let index=atomicLoad(&owners[slot]);if(index==0xffffffffu){return;}
 let key=requestedKey(index);if(any(cells[slot].key!=key)){cells[slot]=Cell(key,vec4f(0),vec4u(u.size.z,0,0,0));atomicAdd(&statistics[0],1u);}
 else{cells[slot].seen.x=u.size.z;}
}
@compute @workgroup_size(64) fn update(@builtin(global_invocation_id) gid:vec3u){
 let slot=gid.x;if(slot>=SLOTS){return;}let index=atomicLoad(&owners[slot]);if(index==0xffffffffu){return;}
 let key=requestedKey(index);var old=cells[slot];if(any(old.key!=key)){return;}
 old.seen.x=u.size.z;
 atomicAdd(&statistics[1],1u);
 // Newly visible anchors get a sample immediately. Existing lighting persists;
 // update one deterministic quarter instead of retracing every visible cell.
 if(old.value.w<1024.&&(old.value.w==0.||((hash(key)+u.size.z)%4u)==0u)){let value=sampleIrradiance(hitFor(key),key.x!=1u&&(key.z&0x80000000u)!=0u,hash(key)^(u32(old.value.w)*6271u));
  old.value=vec4f(old.value.rgb+(value-old.value.rgb)/(old.value.w+1.),old.value.w+1.);atomicAdd(&statistics[2],1u);
 }
 cells[slot]=old;
}
@compute @workgroup_size(8,8) fn resolve(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=u.size.xy)){return;}let index=gid.y*u.size.x+gid.x;var color=vec3f(0);var fallbackMask=0u;
 for(var s=0u;s<4u;s++){let data=loadVisibility(vec2i(gid.xy),i32(s));
  if(data.x==0u){color+=vec3f(.06);continue;}
  let h=surface(data);
  if(lab.mode==2u||lab.mode==4u){let n=normal(h);color+=n*.5+.5;
   if(lab.mode==4u){let p=pointAt(h);let distance=length(p-u.eye.xyz);let rh=trace(u.eye.xyz,normalize(p-u.eye.xyz),1e20,false);
    let error=abs(rh.t-distance)/max(distance,1e-8);atomicAdd(&statistics[6],1u);atomicMax(&statistics[7],bitcast<u32>(error));
    if(rh.id<0||error>1e-4){atomicAdd(&statistics[5],1u);
     if(min(min(h.bary.x,h.bary.y),1.-h.bary.x-h.bary.y)>.001){atomicAdd(&statistics[8],1u);}
     if(rh.id==-2){atomicAdd(&statistics[9],1u);}
    }
   }
   continue;}
  var lighting=vec3f(0);var missing=false;
  for(var corner=0u;corner<3u;corner++){let support=supportFor(data,corner);if(support.weight<1e-7){continue;}let slot=lookup(support.key);
   if(slot==SLOTS){missing=true;continue;}let cell=cells[slot];if(cell.value.w==0.){missing=true;continue;}
   if(lab.mode==3u){lighting+=support.weight*vec3f(0,min(cell.value.w/64.,1.),min(cell.value.w/1024.,1.));}else{lighting+=support.weight*cell.value.rgb;}
  }
  atomicAdd(&statistics[3],1u);
  if(missing){atomicAdd(&statistics[4],1u);
   if(lab.mode==3u){color+=vec3f(1,0,1);}else{fallbackMask|=1u<<s;}
  }else{color+=lighting;}
 }
 color*=.25;
 result[index]=vec4f(color,f32(fallbackMask));
}
// Separate kernels keep the reference compiler workload independent of cache
// lookup/fallback branches. They also prevent expensive-path register pressure
// from affecting pixels that are already completely cached.
@compute @workgroup_size(8,8) fn resolveReference(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=u.size.xy)){return;}let index=gid.y*u.size.x+gid.x;var color=vec3f(0);
 for(var s=0u;s<4u;s++){let data=loadVisibility(vec2i(gid.xy),i32(s));if(data.x==0u){color+=vec3f(.06);continue;}
  color+=sampleIrradiance(surface(data),(data.w&0x80000000u)!=0u,(index*4u+s)*9781u+lab.referenceFrame*6271u+89173u);
 }
 color*=.25;if(lab.referenceFrame>0u){color=mix(result[index].rgb,color,1./f32(lab.referenceFrame+1u));}result[index]=vec4f(color,1);
}
@compute @workgroup_size(8,8) fn resolveFallback(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=u.size.xy)){return;}let index=gid.y*u.size.x+gid.x;let mask=u32(result[index].w);if(mask==0u){return;}var color=result[index].rgb;
 for(var s=0u;s<4u;s++){if((mask&(1u<<s))==0u){continue;}let data=loadVisibility(vec2i(gid.xy),i32(s));
  color+=.25*sampleIrradiance(surface(data),(data.w&0x80000000u)!=0u,(index*4u+s)*9781u+u.size.z*6271u+89173u);
 }result[index]=vec4f(color,1);
}
