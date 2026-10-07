struct Uniforms { size:vec4u,eye:vec4f,right:vec4f,up:vec4f,forward:vec4f,previousEye:vec4f,previousRight:vec4f,previousUp:vec4f,previousForward:vec4f,flags:vec4f }
struct Node { low:vec4f,high:vec4f,links:vec4u }
@group(0) @binding(0) var<uniform> u:Uniforms;
@group(0) @binding(1) var<storage,read_write> nodes:array<Node>;
@group(0) @binding(2) var<uniform> records:vec4u;
@compute @workgroup_size(128) fn main(@builtin(global_invocation_id) gid:vec3u){
 if(gid.x>=records.y){return;}
 let i=records.x+gid.x;let transform=nodes[i];let radius=transform.low.w;
 let distanceToEye=max(length(transform.low.xyz-u.eye.xyz)-radius,.00001);
 let pixels=radius*f32(u.size.y)/(distanceToEye*u.forward.w);
 // Promote at the original threshold; retain detail until clearly farther away.
 let wasDetailed=transform.links.z!=0u&&transform.links.w==transform.links.z;
 let threshold=select(48.,40.,wasDetailed);
 nodes[i].links.w=select(transform.links.x,transform.links.z,transform.links.z!=0u&&pixels>threshold);
}
