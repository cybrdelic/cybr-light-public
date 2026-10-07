// Portable raster-only compute. All indirect firstInstance fields remain zero.
struct Camera {eye:vec4f,right:vec4f,up:vec4f,forward:vec4f,sunRight:vec4f,sunUp:vec4f,sunForward:vec4f,settings:vec4f}
struct Instance {position:vec4f,rotation:vec4f,info:vec4u}
struct Draw {indexCount:u32,count:atomic<u32>,firstIndex:u32,baseVertex:u32,firstInstance:u32,start:u32,capacity:u32,pad:u32}
struct Node {sphere:vec4f,links:vec4u}
struct Model {roots:vec4u,errors:vec4f}
struct Stats {instances:atomic<u32>,tested:atomic<u32>,rejected:atomic<u32>,overflow:atomic<u32>}
@group(0) @binding(0) var<uniform> camera:Camera;
@group(0) @binding(1) var<storage,read_write> instances:array<Instance>;
@group(0) @binding(2) var<storage,read_write> draws:array<Draw>;
@group(0) @binding(3) var<storage,read_write> visible:array<u32>;
@group(0) @binding(4) var<storage,read> nodes:array<Node>;
@group(0) @binding(5) var<storage,read> models:array<Model>;
@group(0) @binding(6) var<storage,read_write> stats:Stats;
fn rotate(q:vec4f,v:vec3f)->vec3f{return v+2.*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
fn sphereVisible(center:vec3f,radius:f32)->bool{
 let d=center-camera.eye.xyz;let z=dot(d,camera.forward.xyz);let x=dot(d,camera.right.xyz);let y=dot(d,camera.up.xyz);
 let tx=camera.forward.w*camera.right.w;let ty=camera.forward.w;
 let magnitude=max(max(abs(center),abs(camera.eye.xyz)),vec3f(1.));
 let r=radius+max(max(magnitude.x,magnitude.y),magnitude.z)*.000002;
 return !(z+r<.05||abs(x)>z*tx+r*sqrt(1.+tx*tx)||abs(y)>z*ty+r*sqrt(1.+ty*ty));
}
@compute @workgroup_size(128) fn cull(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&instances)){return;}
 let i=instances[id.x];let radius=bitcast<f32>(i.info.z);
 if(!sphereVisible(i.position.xyz,radius)){return;}
 let model=models[i.info.x];let z=dot(i.position.xyz-camera.eye.xyz,camera.forward.xyz);var level=0u;
 if(camera.settings.z>0.){for(var k=1u;k<4u;k++){
  let limit=camera.settings.z*select(1.,.9,k>i.info.w);
  if(model.errors[k]*abs(i.position.w)*270./(max(z-radius,.05)*camera.forward.w)<=limit){level=k;}
 }}
 instances[id.x].info.w=level;
 var node=model.roots[level];let end=nodes[node].links.y;var tested=0u;var rejected=0u;
 loop {
  if(node>=end){break;}
  let n=nodes[node];tested++;
  let center=rotate(i.rotation,n.sphere.xyz*i.position.w)+i.position.xyz;
  if(!sphereVisible(center,n.sphere.w*abs(i.position.w))){rejected++;node=n.links.y;continue;}
  if(n.links.x!=0xffffffffu){let draw=n.links.x;let at=atomicAdd(&draws[draw].count,1u);
   if(at<draws[draw].capacity){visible[draws[draw].start+at]=id.x;}else{atomicStore(&stats.overflow,1u);}
  }
  node++;
 }
 if(camera.settings.w>.5){atomicAdd(&stats.instances,1u);atomicAdd(&stats.tested,tested);atomicAdd(&stats.rejected,rejected);}
}
