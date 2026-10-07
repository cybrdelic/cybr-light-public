@group(0) @binding(0) var<uniform> config:vec4u;
@group(0) @binding(1) var<storage,read> pixels:array<vec4f>;
struct Uniforms { size:vec4u,eye:vec4f,right:vec4f,up:vec4f,forward:vec4f,previousEye:vec4f,previousRight:vec4f,previousUp:vec4f,previousForward:vec4f,flags:vec4f }
@group(0) @binding(2) var<uniform> u:Uniforms;
@vertex fn vertex(@builtin(vertex_index) id:u32)->@builtin(position) vec4f{let x=f32((id<<1u)&2u);let y=f32(id&2u);return vec4f(x*2.-1.,y*2.-1.,0,1);}
@fragment fn fragment(@builtin(position) position:vec4f)->@location(0) vec4f{let xy=min(vec2u(position.xy),config.xy-1u);let raw=max(pixels[xy.y*config.x+xy.x].rgb*u.previousRight.w,vec3f(0));let mapped=clamp(raw*(2.51*raw+.03)/(raw*(2.43*raw+.59)+.14),vec3f(0),vec3f(1));let srgb=select(12.92*mapped,1.055*pow(mapped,vec3f(1./2.4))-.055,mapped>vec3f(.0031308));return vec4f(srgb,1);}
