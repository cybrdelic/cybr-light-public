// Extra independent radiance samples, not post-process edge smoothing.
export function adaptiveAaShader(source){
 source=source.replaceAll('\r\n','\n');
 const replace=(a,b)=>{if(!source.includes(a))throw Error('Adaptive AA contract changed: '+a);source=source.replace(a,b);};
 replace('@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) gid:vec3u){if(any(gid.xy>=u.size.xy)){return;}let index=gid.y*u.size.x+gid.x;var seed=index*9781u+u.size.z*6271u+89173u;',
 `@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) gid:vec3u){if(any(gid.xy>=u.size.xy)){return;}let index=gid.y*u.size.x+gid.x;
 let sampleIndex=gid.z;let guideDirection=camera(vec2f(gid.xy)+.5);let guide=trace(u.eye.xyz,guideDirection,1e20,false);
 var sampleCount=1u;if(u.flags.y<.5&&needsCoverage(gid,guide)){sampleCount=4u;}
 let extra=index+u.size.x*u.size.y;
 if(sampleIndex>=sampleCount){if(sampleIndex==1u){samples[extra].color=vec4f(0);}if(sampleIndex==2u){samples[extra].position=vec4f(0);}if(sampleIndex==3u){samples[extra].normal=vec4f(0);}return;}
 var seed=index*9781u+u.size.z*6271u+89173u+sampleIndex*2891336453u;`);
 replace('let pathDirection=camera(vec2f(gid.xy)+vec2f(random(&seed),random(&seed)));',
 `var jitter=vec2f(random(&seed),random(&seed));if(sampleCount==4u){jitter=(vec2f(f32(sampleIndex%2u),f32(sampleIndex/2u))+jitter)*.5;}
 let pathDirection=camera(vec2f(gid.xy)+jitter);`);
 replace('let guideDirection=select(camera(vec2f(gid.xy)+.5),pathDirection,u.previousEye.w>.5);let guide=trace(u.eye.xyz,guideDirection,1e20,false);','');
 replace('samples[index]=Pixel(', 'let result=Pixel(');
 source=source.trimEnd();
 source=source.slice(0,-1)+`if(sampleIndex==0u){samples[index]=result;}else if(sampleIndex==1u){samples[extra].color=result.color;}else if(sampleIndex==2u){samples[extra].position=result.color;}else{samples[extra].normal=result.color;}\n}`;
 return source+`
@group(0) @binding(8) var<storage,read> aaHistory:array<Pixel>;
fn needsCoverage(gid:vec3u,guide:Hit)->bool{
 if(u.size.z==0u){return true;}
 var pixel=vec2i(gid.xy);
 if(guide.id!=-1){
  let direction=camera(vec2f(gid.xy)+.5);let point=u.eye.xyz+direction*guide.t;
  let rel=point-u.previousEye.xyz;let z=dot(rel,u.previousForward.xyz);
  if(z<=0.){return true;}
  let ndc=vec2f(dot(rel,u.previousRight.xyz)*f32(u.size.y)/f32(u.size.x),-dot(rel,u.previousUp.xyz))/(z*u.previousForward.w);
  pixel=vec2i(floor((ndc*.5+.5)*vec2f(u.size.xy)));
  // Polished surfaces need coverage of high-frequency reflected features too.
  let m=material(guide);if(m.base.w<.3){return true;}
 }
 if(any(pixel<vec2i(1))||any(pixel>=vec2i(u.size.xy)-1)){return true;}
 let center=aaHistory[u32(pixel.y)*u.size.x+u32(pixel.x)];
 for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
  let q=pixel+vec2i(x,y);let other=aaHistory[u32(q.y)*u.size.x+u32(q.x)];
  if(abs(center.position.w-other.position.w)>.1){return true;}
  if(center.position.w!=-1.){
   if(dot(center.normal.xyz,other.normal.xyz)<.98){return true;}
   let delta=other.position.xyz-center.position.xyz;
   let footprint=max(.001,length(center.position.xyz-u.previousEye.xyz)*u.previousForward.w*2./f32(u.size.y));
   if(abs(dot(delta,center.normal.xyz))>footprint){return true;}
  }
 }}return false;
}
`;
}

// Separate invocations keep one transport stack per thread. Only radiance is
// supersampled; center geometry guides remain stable for reconstruction.
export const adaptiveAaResolve=`
struct Pixel { color:vec4f,position:vec4f,normal:vec4f,moments:vec4f,secondary:vec4f,secondaryNormal:vec4f }
@group(0) @binding(0) var<uniform> config:vec4u;
@group(0) @binding(1) var<storage,read> raw:array<Pixel>;
@group(0) @binding(2) var<storage,read_write> output:array<Pixel>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=config.xy)){return;}let i=gid.y*config.x+gid.x;
 var pixel=raw[i];let extra=raw[i+config.x*config.y];
 let sum=pixel.color+extra.color+extra.position+extra.normal;
 let value=sum.rgb/max(sum.w,1.);let l=dot(value,vec3f(.2126,.7152,.0722));
 pixel.color=vec4f(value,1);pixel.moments=vec4f(l,l*l,pixel.moments.zw);output[i]=pixel;
}`;
