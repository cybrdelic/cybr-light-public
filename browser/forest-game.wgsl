struct Camera {eye:vec4f,right:vec4f,up:vec4f,forward:vec4f,sunRight:vec4f,sunUp:vec4f,sunForward:vec4f,settings:vec4f}
struct Instance {position:vec4f,rotation:vec4f,info:vec4u}
struct Draw {indexCount:u32,count:atomic<u32>,firstIndex:u32,baseVertex:u32,firstInstance:u32,start:u32,capacity:u32,pad:u32}
@group(0) @binding(0) var<uniform> camera:Camera;
@group(0) @binding(1) var<storage,read> instances:array<Instance>;
@group(0) @binding(2) var<storage,read_write> draws:array<Draw>;
@group(0) @binding(3) var<storage,read_write> visible:array<u32>;
@group(0) @binding(4) var<storage,read> lodErrors:array<vec4f>;
fn rotate(q:vec4f,v:vec3f)->vec3f{return v+2.*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
@compute @workgroup_size(128) fn cull(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&instances)){return;}
 let i=instances[id.x];let radius=bitcast<f32>(i.info.z);let d=i.position.xyz-camera.eye.xyz;
 let z=dot(d,camera.forward.xyz);let x=dot(d,camera.right.xyz);let y=dot(d,camera.up.xyz);
 let tx=camera.forward.w*camera.right.w;let ty=camera.forward.w;
 if(z+radius<.05||abs(x)>z*tx+radius*sqrt(1.+tx*tx)||abs(y)>z*ty+radius*sqrt(1.+ty*ty)){return;}
 var level=0u;
 if(camera.settings.z>0.){for(var k=1u;k<4u;k++){if(lodErrors[i.info.x][k]*i.position.w*270./(max(z-radius,.05)*ty)<=camera.settings.z){level=k;}}}
 let group=i.info.x*4u+level;let at=atomicAdd(&draws[group].count,1u);visible[draws[group].start+at]=id.x;
}
