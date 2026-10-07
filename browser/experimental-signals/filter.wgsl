@group(0) @binding(0) var<uniform> config:vec4u;
@group(0) @binding(1) var<storage,read> guide:array<Signals>;
@group(0) @binding(2) var<storage,read> input:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> output:array<vec4f>;
override CHANNEL:u32=0u;
fn luminance(v:vec3f)->f32{return dot(v,vec3f(.2126,.7152,.0722));}
fn kernel(x:i32)->f32{if(x==0){return 6.;}if(abs(x)==1){return 4.;}return 1.;}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=config.xy)){return;}let index=gid.y*config.x+gid.x;let offset=CHANNEL*config.x*config.y;let center=readSignal(guide[index],CHANNEL);let value=input[index+offset];
 // Unoccluded sky has no stochastic lighting path. Avoid neighborhood work
 // only for converged zero-variance pixels; retain filtering at mixed edges.
 if(center.position.w==-1.&&center.color.w>=8.&&value.w<1e-10){output[index+offset]=value;return;}
 // A primary-surface guide cannot describe detail seen through glass or in
 // polished reflections. Do not apply the broad third pass to those pixels.
 let viewDependent=center.normal.w<.3&&(config.w==0u||center.moments.w!=0.);
 if(viewDependent&&config.z>=4u){output[index+offset]=value;return;}
 var sum=vec3f(0);var total=0.;var variance=0.;
 for(var y=-2;y<=2;y++){for(var x=-2;x<=2;x++){
  if(viewDependent&&(abs(x)>1||abs(y)>1)){continue;}
  let q=clamp(vec2i(gid.xy)+vec2i(x,y)*i32(config.z),vec2i(0),vec2i(config.xy)-1);let j=u32(q.y)*config.x+u32(q.x);let other=readSignal(guide[j],CHANNEL);
  if(abs(center.position.w-other.position.w)>.1){continue;}
  // Transmitted content has edges behind the front glass surface. Never let
  // the container's smooth normal blur across those independently moving edges.
  if(CHANNEL==2u){
   if(center.secondaryNormal.w!=other.secondaryNormal.w){continue;}
   if(center.secondaryNormal.w>.5){
    if(abs(center.secondary.w-other.secondary.w)>.1||dot(center.secondaryNormal.xyz,other.secondaryNormal.xyz)<.98){continue;}
    let delta=other.secondary.xyz-center.secondary.xyz;
    if(abs(dot(delta,center.secondaryNormal.xyz))>max(.003,.005*f32(config.z))){continue;}
   }
  }
  var w=kernel(x)*kernel(y);
  if(center.position.w!=-1.){
   w*=pow(max(dot(center.normal.xyz,other.normal.xyz),0.),32.);
   // Plane distance preserves filtering on distant coplanar surfaces.
   let delta=other.position.xyz-center.position.xyz;
   let plane=max(abs(dot(delta,center.normal.xyz)),abs(dot(delta,other.normal.xyz)));
   w*=exp(-plane/max(.002,.005*f32(config.z)));
  }
  let phi=max(.015,4.*sqrt(max(0.,value.w+input[j+offset].w)));
  w*=exp(-abs(luminance(value.rgb)-luminance(input[j+offset].rgb))/phi);
  sum+=input[j+offset].rgb*w;variance+=input[j+offset].w*w*w;total+=w;
 }}
 output[index+offset]=vec4f(sum/max(total,1e-6),variance/max(total*total,1e-6));
}
