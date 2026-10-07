import {coverageJitter} from './coverage-reconstruction.mjs';
export function contributorTrace(source){
 const marker='let pathDirection=camera(vec2f(gid.xy)+vec2f(random(&seed),random(&seed)));';
 if(!source.includes(marker))throw Error('Contributor camera contract changed');
 source=source.replace(marker,`let randomJitter=vec2f(random(&seed),random(&seed));
 let coverageCenter=trace(u.eye.xyz,camera(vec2f(gid.xy)+.5),1e20,false);var coverageEligible=false;
 if(coverageCenter.id!=-1){let cm=material(coverageCenter);coverageEligible=u.flags.y<.5&&cm.physical.y<.5&&cm.physical.x<.001&&cm.base.w>.55;}
 let pathDirection=camera(vec2f(gid.xy)+select(randomJitter,coverageJitter(u.size.z),coverageEligible));`);
 source=source.replace('let guide=trace(u.eye.xyz,guideDirection,1e20,false);','var guide=coverageCenter;if(coverageEligible&&u.previousEye.w>.5){guide=trace(u.eye.xyz,guideDirection,1e20,false);}');
 source=source.replaceAll('u.previousEye.w','select(0.,u.previousEye.w,coverageEligible)');
 return coverageJitter+'\n'+source;
}
export function contributorReconstruct(source,separate){
 const jitter='select(vec2f(.5),coverageJitter(u.size.z-1u),p.normal.w>.55&&p.moments.w==0.)';
 // projectPrevious is used for sharp optical paths, whose sampling stays unchanged.
 const main=source.indexOf('@compute');const prefix=source.slice(0,main);let body=source.slice(main);
 body=body.replaceAll('*vec2f(u.size.xy)-.5','*vec2f(u.size.xy)-'+jitter);
 body=body.replaceAll('floor((ndc*.5+.5)*vec2f(u.size.xy))','floor((ndc*.5+.5)*vec2f(u.size.xy)-'+jitter+'+.5)');source=prefix+body;
 if(separate)source=source.replace('var result=p.color.rgb;','if(u.flags.y>.5&&!moving&&u.size.z>0u){history=readSignal(previous[i],channel);}\n var result=p.color.rgb;');
 return coverageJitter+'\n'+source;
}
export function contributorResolve(separate){return coverageJitter+`
struct Uniforms { size:vec4u,eye:vec4f,right:vec4f,up:vec4f,forward:vec4f,previousEye:vec4f,previousRight:vec4f,previousUp:vec4f,previousForward:vec4f,flags:vec4f,features:vec4f }
struct Layer { position:vec4f,normal:vec4f,radiance:vec4f,albedo:vec4f }
@group(0) @binding(0) var<uniform> u:Uniforms;
@group(0) @binding(1) var<storage,read> current:array<${separate?'Signals':'Pixel'}>;
@group(0) @binding(2) var<storage,read> previous:array<Layer>;
@group(0) @binding(3) var<storage,read_write> layers:array<Layer>;
@group(0) @binding(4) var<storage,read> lighting:array<vec4f>;
@group(0) @binding(5) var<storage,read_write> output:array<vec4f>;
${separate?'@group(0) @binding(6) var<storage,read> modulation:array<vec4f>;':''}
fn compose(i:u32)->vec3f {${separate?'let n=u.size.x*u.size.y;return (lighting[i].rgb+lighting[i+3u*n].rgb)*modulation[i].rgb+lighting[i+n].rgb+lighting[i+2u*n].rgb;':'return lighting[i].rgb;'}}
fn project(p:vec3f,old:bool)->vec3f{
 let eye=select(u.eye.xyz,u.previousEye.xyz,old);let right=select(u.right.xyz,u.previousRight.xyz,old);let up=select(u.up.xyz,u.previousUp.xyz,old);let forward=select(u.forward,u.previousForward,old);
 let r=p-eye;let z=dot(r,forward.xyz);return vec3f((vec2f(dot(r,right)*f32(u.size.y)/f32(u.size.x),-dot(r,up))/(max(z,.001)*forward.w)*.5+.5)*vec2f(u.size.xy)-.5,z);
}
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=u.size.xy)){return;}let i=gid.y*u.size.x+gid.x;let p=${separate?'readSignal(current[i],0u)':'current[i]'};let now=compose(i);let albedo=${separate?'modulation[i]':'p.secondaryNormal'};let empty=Layer(vec4f(0,0,0,-100),vec4f(0),vec4f(0),vec4f(0));
 var a=Layer(p.position,vec4f(p.normal.xyz,f32(u.size.z)),vec4f(now,1),albedo);var b=empty;var overflow=false;
 // Do not claim front-surface reprojection describes sharp optics. Those
 // contributions stay fresh; endpoint lighting reuse is independent.
 let optical=${separate?'current[i].specularMoments.w!=0.':'p.moments.w!=0.'};
 if(u.flags.y>.5||u.features.w<.5||p.position.w==-1.||optical||p.normal.w<=.55){layers[2u*i]=a;layers[2u*i+1u]=empty;output[i]=vec4f(now,1);return;}
 if(u.size.z>0u){
  let projected=project(p.position.xyz,true);let base=vec2i(floor(projected.xy));let fraction=fract(projected.xy);
  for(var y=0;y<2;y++){for(var x=0;x<2;x++){
   let q=base+vec2i(x,y);if(projected.z<=0.||any(q<vec2i(0))||any(q>=vec2i(u.size.xy))){continue;}
   let w=select(1.-fraction.x,fraction.x,x==1)*select(1.-fraction.y,fraction.y,y==1)*.8;
   for(var k=0u;k<2u;k++){
    let old=previous[2u*(u32(q.y)*u.size.x+u32(q.x))+k];if(old.radiance.w<=0.||f32(u.size.z)-old.normal.w>4.){continue;}
    let projectedNow=project(old.position.xyz,false);if(projectedNow.z<=0.||any(abs(projectedNow.xy-vec2f(gid.xy))>vec2f(1.25))){continue;}
    let same=abs(old.position.w-p.position.w)<.1;let footprint=max(.001,distance(p.position.xyz,u.eye.xyz)*u.forward.w*3./f32(u.size.y));
    if(same&&(dot(old.normal.xyz,p.normal.xyz)<.98||distance(old.albedo.rgb,albedo.rgb)>.01||abs(dot(old.position.xyz-p.position.xyz,p.normal.xyz))>footprint*.2)){continue;}
    let mass=min(old.radiance.w,8.)*w;if(mass<.01){continue;}
    if(same){a.radiance=vec4f((a.radiance.rgb*a.radiance.w+old.radiance.rgb*mass)/(a.radiance.w+mass),a.radiance.w+mass);}
    else if(b.radiance.w==0.){b=old;b.radiance.w=mass;}
    else if(abs(b.position.w-old.position.w)<.1&&dot(b.normal.xyz,old.normal.xyz)>.98){b.radiance=vec4f((b.radiance.rgb*b.radiance.w+old.radiance.rgb*mass)/(b.radiance.w+mass),b.radiance.w+mass);}
    else{overflow=true;}
   }
  }}
 }
 // Overflow is a fresh observation, not discarded third-surface energy.
 if(overflow){a=Layer(p.position,vec4f(p.normal.xyz,f32(u.size.z)),vec4f(now,1),albedo);b=empty;}
 layers[2u*i]=a;layers[2u*i+1u]=b;
 output[i]=vec4f((a.radiance.rgb*a.radiance.w+b.radiance.rgb*b.radiance.w)/max(a.radiance.w+b.radiance.w,1.),select(a.radiance.w+b.radiance.w,-1.,overflow));
}
`;}
