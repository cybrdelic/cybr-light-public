struct Uniforms {size:vec4u,eye:vec4f,right:vec4f,up:vec4f,forward:vec4f,previousEye:vec4f,previousRight:vec4f,previousUp:vec4f,previousForward:vec4f,flags:vec4f}
@group(0) @binding(0) var<uniform> u:Uniforms;
@group(0) @binding(1) var<uniform> sampling:vec4f;
struct Vertex {@builtin(position) clip:vec4f,@location(0) @interpolate(linear,sample) pixel:vec2f}
@vertex fn vertex(@builtin(vertex_index) i:u32)->Vertex{
 let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3))[i];
 return Vertex(vec4f(p,0,1),(p*vec2f(.5,-.5)+.5)*vec2f(u.size.xy));
}
struct Packed {@location(0) low:vec4u,@location(1) high:vec4u,@builtin(frag_depth) depth:f32}
@fragment fn fragment(v:Vertex)->Packed{
 let pixel=v.pixel+rasterJitterAt(u32(sampling.x));
 let screen=(pixel/vec2f(u.size.xy)*2.-1.)*vec2f(f32(u.size.x)/f32(u.size.y),-1.);
 let d=normalize(u.forward.xyz+(u.right.xyz*screen.x+u.up.xyz*screen.y)*u.forward.w);
 var data=vec4u(0,0,bitcast<u32>(pixel.x),bitcast<u32>(pixel.y));var depth=0.;
 if(sampling.z>.5&&abs(d.y)>1e-8){let t=(u.eye.w-u.eye.y)/d.y;
  if(t>.00001){let p=u.eye.xyz+d*t;data=vec4u(1,0,bitcast<u32>(p.x),bitcast<u32>(p.z));depth=.00001/dot(p-u.eye.xyz,u.forward.xyz);}
 }
 return Packed(data&vec4u(65535),data>>vec4u(16),depth);
}
