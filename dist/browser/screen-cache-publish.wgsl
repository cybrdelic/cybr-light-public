struct Pixel { color:vec4f,position:vec4f,normal:vec4f,moments:vec4f,secondary:vec4f,secondaryNormal:vec4f }
@group(0) @binding(0) var<uniform> size:vec4u;
@group(0) @binding(1) var<storage,read> guide:array<Pixel>;
@group(0) @binding(2) var<storage,read> lighting:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> cache:array<Pixel>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=size.xy)){return;}let i=gid.y*size.x+gid.x;var p=guide[i];p.color=vec4f(lighting[i].rgb,p.color.w);cache[i]=p;
}
