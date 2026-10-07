// Same per-lobe spatial kernel as experimental-signals/filter.wgsl, sharing
// geometry fetches across lobes. No wider support or relaxed edge thresholds.
@group(0) @binding(0) var<uniform> config:vec4u;
@group(0) @binding(1) var<storage,read> guide:array<Signals>;
@group(0) @binding(2) var<storage,read> input:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> output:array<vec4f>;
fn luma(v:vec3f)->f32{return dot(v,vec3f(.2126,.7152,.0722));}
fn kernel(x:i32)->f32{if(x==0){return 6.;}if(abs(x)==1){return 4.;}return 1.;}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=config.xy)){return;}let i=gid.y*config.x+gid.x;let count=config.x*config.y;let c=guide[i];
 let d=input[i];let s=input[i+count];let t=input[i+2u*count];let indirect=input[i+3u*count];
 let value=vec4f(luma(d.rgb),luma(s.rgb),luma(t.rgb),luma(indirect.rgb));let v=vec4f(d.w,s.w,t.w,indirect.w);
 let viewDependent=vec4<bool>(c.normal.w<.3)&(vec4<bool>(config.w==0u)|(vec4f(c.diffuseMoments.w,c.specularMoments.w,c.transmissionMoments.w,c.indirectMoments.w)!=vec4f(0)));
 let sky=vec4<bool>(c.position.w==-1.)&(vec4f(c.diffuse.w,c.specular.w,c.transmission.w,c.indirect.w)>=vec4f(8))&(v<vec4f(1e-10));
 let skip=sky|(viewDependent&vec4<bool>(config.z>=4u));
 if(all(skip)){output[i]=d;output[i+count]=s;output[i+2u*count]=t;output[i+3u*count]=indirect;return;}
 var sumD=vec3f(0);var sumS=vec3f(0);var sumT=vec3f(0);var sumI=vec3f(0);var total=vec4f(0);var variance=vec4f(0);
 for(var y=-2;y<=2;y++){for(var x=-2;x<=2;x++){
  let q=clamp(vec2i(gid.xy)+vec2i(x,y)*i32(config.z),vec2i(0),vec2i(config.xy)-1);let j=u32(q.y)*config.x+u32(q.x);let other=guide[j];
  if(abs(c.position.w-other.position.w)>.1){continue;}
  var geometricWeight=kernel(x)*kernel(y);
  if(c.position.w!=-1.){
   geometricWeight*=pow(max(dot(c.normal.xyz,other.normal.xyz),0.),32.);
   let delta=other.position.xyz-c.position.xyz;let plane=max(abs(dot(delta,c.normal.xyz)),abs(dot(delta,other.normal.xyz)));
   geometricWeight*=exp(-plane/max(.002,.005*f32(config.z)));
  }
  let nd=input[j];let ns=input[j+count];let nt=input[j+2u*count];let ni=input[j+3u*count];
  let nv=vec4f(nd.w,ns.w,nt.w,ni.w);let nl=vec4f(luma(nd.rgb),luma(ns.rgb),luma(nt.rgb),luma(ni.rgb));
  let phi=max(vec4f(.015),4.*sqrt(max(vec4f(0),v+nv)));
  var w=vec4f(geometricWeight)*exp(-abs(value-nl)/phi);
  w=select(w,vec4f(0),skip|(viewDependent&vec4<bool>(abs(x)>1||abs(y)>1)));
  if(c.secondaryNormal.w!=other.secondaryNormal.w){w.z=0.;}
  if(c.secondaryNormal.w>.5){
   let delta=other.secondary.xyz-c.secondary.xyz;
   if(abs(c.secondary.w-other.secondary.w)>.1||dot(c.secondaryNormal.xyz,other.secondaryNormal.xyz)<.98||abs(dot(delta,c.secondaryNormal.xyz))>max(.003,.005*f32(config.z))){w.z=0.;}
  }
  sumD+=nd.rgb*w.x;sumS+=ns.rgb*w.y;sumT+=nt.rgb*w.z;sumI+=ni.rgb*w.w;variance+=nv*w*w;total+=w;
 }}
 let safe=max(total,vec4f(1e-6));variance/=max(total*total,vec4f(1e-6));
 output[i]=select(vec4f(sumD/safe.x,variance.x),d,skip.x);
 output[i+count]=select(vec4f(sumS/safe.y,variance.y),s,skip.y);
 output[i+2u*count]=select(vec4f(sumT/safe.z,variance.z),t,skip.z);
 output[i+3u*count]=select(vec4f(sumI/safe.w,variance.w),indirect,skip.w);
}
