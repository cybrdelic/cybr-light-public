struct Uniforms {size:vec4u,eye:vec4f,right:vec4f,up:vec4f,forward:vec4f,previousEye:vec4f,previousRight:vec4f,previousUp:vec4f,previousForward:vec4f,flags:vec4f}
struct Triangle {p:vec4f,e1:vec4f,e2:vec4f}
struct Node {low:vec4f,high:vec4f,links:vec4u}
@group(0) @binding(0) var<uniform> u:Uniforms;
@group(0) @binding(1) var<storage,read> triangles:array<Triangle>;
@group(0) @binding(2) var<storage,read> nodes:array<Node>;
@group(0) @binding(3) var<storage,read> instanceIds:array<u32>;
@group(0) @binding(4) var<uniform> draw:vec4u;
@group(0) @binding(5) var<uniform> sampling:vec4f;
struct Vertex { @builtin(position) clip:vec4f,@location(0) @interpolate(perspective,sample) bary:vec2f,@location(1) @interpolate(flat) ids:vec2u }
fn rotate(q:vec4f,v:vec3f)->vec3f{return v+2.*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
@vertex fn vertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) copy:u32)->Vertex{
 let id=draw.x+vertex/3u;let corner=vertex%3u;let tr=triangles[id];
 let bary=select(select(vec2f(0),vec2f(1,0),corner==1u),vec2f(0,1),corner==2u);
 var p=tr.p.xyz+tr.e1.xyz*bary.x+tr.e2.xyz*bary.y;let instance=instanceIds[copy];var visible=true;
 if(instance!=0u){let transform=nodes[instance];let scale=dot(transform.high,transform.high);p=rotate(normalize(transform.high),p*scale)+transform.low.xyz;visible=transform.links.w==draw.z;let mask=transform.links.y>>24u;if(mask!=0u&&(u32(tr.e1.w)&mask)==0u){visible=false;}}
 // Reverse-Z with an infinite far plane avoids far/near cancellation.
 let delta=p-u.eye.xyz;let z=dot(delta,u.forward.xyz);let near=.00001;
 var clip=vec4f(dot(delta,u.right.xyz)/(u.forward.w*f32(u.size.x)/f32(u.size.y)),dot(delta,u.up.xyz)/u.forward.w,near,z);
 if(sampling.x>=0.){let jitter=rasterJitterAt(u32(sampling.x));clip.x-=2.*jitter.x/f32(u.size.x)*clip.w;clip.y+=2.*jitter.y/f32(u.size.y)*clip.w;}
 if(!visible){clip=vec4f(2,2,2,1);}
 return Vertex(clip,bary,vec2u(id+3u,instance));
}
struct Packed { @location(0) low:vec4u,@location(1) high:vec4u }
@fragment fn fragment(v:Vertex,@builtin(front_facing) front:bool)->Packed{
 let data=vec4u(v.ids,bitcast<u32>(max(v.bary.x,0.)),bitcast<u32>(max(v.bary.y,0.))|select(0u,0x80000000u,!front));
 return Packed(data&vec4u(65535),data>>vec4u(16));
}
