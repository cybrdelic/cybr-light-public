struct Camera {eye:vec4f,right:vec4f,up:vec4f,forward:vec4f,sunRight:vec4f,sunUp:vec4f,sunForward:vec4f,settings:vec4f}
struct Instance {position:vec4f,rotation:vec4f,info:vec4u}
@group(0) @binding(0) var<uniform> camera:Camera;
@group(0) @binding(1) var<storage,read> instances:array<Instance>;
@group(0) @binding(2) var<storage,read> visible:array<u32>;
@group(0) @binding(3) var shadow:texture_depth_2d;
@group(0) @binding(4) var shadowSampler:sampler_comparison;
@group(1) @binding(0) var<uniform> batch:vec4u;
struct Vertex {@builtin(position) clip:vec4f,@location(0) world:vec3f,@location(1) normal:vec3f,@location(2) color:vec3f}
fn rotate(q:vec4f,v:vec3f)->vec3f{return v+2.*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
fn sunClip(p:vec3f)->vec4f{return vec4f(dot(p,camera.sunRight.xyz)/camera.sunRight.w,dot(p,camera.sunUp.xyz)/camera.sunUp.w,.5-dot(p,camera.sunForward.xyz)/camera.sunForward.w,1);}
@vertex fn vertex(@location(0) position:vec3f,@location(1) normal:vec3f,@location(2) color:vec3f,@location(3) mask:u32,@builtin(instance_index) copy:u32)->Vertex{
 let index=select(visible[batch.x+copy],batch.x+copy,camera.settings.x>.5);
 let i=instances[index];let p=rotate(i.rotation,position*i.position.w)+i.position.xyz;
 let n=rotate(i.rotation,normal);let d=p-camera.eye.xyz;
 var clip=vec4f(dot(d,camera.right.xyz)/(camera.forward.w*camera.right.w),dot(d,camera.up.xyz)/camera.forward.w,.05,dot(d,camera.forward.xyz));
 if(camera.settings.x>.5){clip=sunClip(p);}
 if(mask!=0u&&(mask&i.info.y)==0u){clip=vec4f(2,2,2,1);}
 return Vertex(clip,p,n,color);
}
@fragment fn fragment(v:Vertex,@builtin(front_facing) front:bool)->@location(0) vec4f{
 let n=normalize(v.normal)*select(-1.,1.,front);let sun=normalize(vec3f(-.469,.559,.684));
 let light=sunClip(v.world);let uv=light.xy*vec2f(.5,-.5)+.5;
 var visibility=1.;
 if(all(uv>=vec2f(0))&&all(uv<=vec2f(1))){visibility=textureSampleCompareLevel(shadow,shadowSampler,uv,light.z-.00015);}
 // Stable hemispherical irradiance approximation; not a claim of traced GI.
 let sky=mix(vec3f(.06,.065,.06),vec3f(.25,.32,.42),n.y*.5+.5);
 let direct=vec3f(3.1,2.8,2.4)*max(dot(n,sun),0.)*visibility/3.14159265;
 let raw=max(v.color*(sky+direct),vec3f(0));
 let mapped=clamp(raw*(2.51*raw+.03)/(raw*(2.43*raw+.59)+.14),vec3f(0),vec3f(1));
 return vec4f(select(12.92*mapped,1.055*pow(mapped,vec3f(1./2.4))-.055,mapped>vec3f(.0031308)),1);
}
