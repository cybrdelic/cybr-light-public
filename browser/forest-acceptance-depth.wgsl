// Validation only: preserve every MSAA depth sample; no averaging hides holes.
@group(0) @binding(0) var depth:texture_depth_multisampled_2d;
@group(0) @binding(1) var<storage,read_write> samples:array<f32>;
@compute @workgroup_size(8,8) fn capture(@builtin(global_invocation_id) id:vec3u){
 let size=textureDimensions(depth);if(any(id.xy>=size)){return;}
 let at=(id.y*size.x+id.x)*4u;
 for(var sample=0u;sample<4u;sample++){samples[at+sample]=textureLoad(depth,vec2i(id.xy),i32(sample));}
}
