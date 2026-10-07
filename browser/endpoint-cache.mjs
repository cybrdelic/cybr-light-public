// Approximate diffuse endpoint reuse. Specular transport remains freshly sampled.
// Arena layout: N modulation records, N * 5 vec4 cache records, N counters.
export function endpointCacheShader(source){
 const replace=(a,b)=>{if(!source.includes(a))throw Error('Endpoint cache contract: '+a.slice(0,70));source=source.replace(a,b);};
 replace('fn bsdf(',`var<private> endpointSpecularOnly:bool;
 var<private> endpointAttempts:u32;var<private> endpointHits:u32;
 fn endpointLookup(point:vec3f,n:vec3f,wo:vec3f,surface:f32,albedo:vec3f)->vec4f{
  endpointAttempts++;
  if(u.flags.y>.5||u.size.z<8u||u.size.z%4u==0u||u.features.z<.5){return vec4f(0);}
  let r=point-u.previousEye.xyz;let z=dot(r,u.previousForward.xyz);if(z<=0.){return vec4f(0);}
  let xy=(vec2f(dot(r,u.previousRight.xyz)*f32(u.size.y)/f32(u.size.x),-dot(r,u.previousUp.xyz))/(z*u.previousForward.w)*.5+.5)*vec2f(u.size.xy)-.5;
  let base=vec2i(floor(xy));let f=fract(xy);var sum=vec3f(0);var total=0.;let count=u.size.x*u.size.y;
  for(var y=0;y<2;y++){for(var x=0;x<2;x++){
   let q=base+vec2i(x,y);if(any(q<vec2i(0))||any(q>=vec2i(u.size.xy))){continue;}
   let offset=count+5u*(u32(q.y)*u.size.x+u32(q.x));let pos=modulation[offset];let normal=modulation[offset+1u];let a=modulation[offset+2u];let light=modulation[offset+3u];let view=modulation[offset+4u];
   let footprint=max(.0005,z*u.previousForward.w*2./f32(u.size.y));
   if(normal.w<4.||abs(pos.w-surface)>.1||dot(normal.xyz,n)<.995||distance(pos.xyz,point)>footprint*1.5||abs(dot(pos.xyz-point,n))>footprint*.1||distance(a.rgb,albedo)>.01||a.w<.55||dot(view.xyz,wo)<.95||dot(n,wo)<.4||view.w!=f32(u.size.z-1u)){continue;}
   // Reject unsettled lighting instead of presenting a noisy cache as clean.
   let l=dot(light.rgb,vec3f(.2126,.7152,.0722));if(light.w>max(.0025,l*l*.1)){continue;}
   let w=select(1.-f.x,f.x,x==1)*select(1.-f.y,f.y,y==1);sum+=light.rgb*w;total+=w;
  }}
  if(total<.95){return vec4f(0);}endpointHits++;return vec4f(sum/total,1);
 }
 fn bsdf(`);
 replace('let value=color*(1.-metal)*(vec3f(1)-f)/PI+f*d*g*masking(nl,alpha)/max(4.*nv*nl,1e-6);',`let spec=f*d*g*masking(nl,alpha)/max(4.*nv*nl,1e-6);
 if(endpointSpecularOnly){return vec4f(spec,d*g/(4.*nv));}
 let value=color*(1.-metal)*(vec3f(1)-f)/PI+spec;`);
 replace('firstSegment=bounce<=1u;','firstSegment=bounce<=1u;endpointSpecularOnly=false;');
 replace('var startDepth=0u;',`if(guide.id!=-1){let gm=material(guide);if(gm.physical.x<.001&&gm.physical.y<.5&&gm.base.w>.55){secondaryNormal=vec4f(gm.base.rgb*vertexColor(guide),-1.);}}\n var startDepth=0u;`);
 replace('  if(bounce==0u&&guide.id>=0&&hit.id>=0)',`  if(bounce>0u&&delta&&guideNormal.w==0.&&m.physical.y<.5&&metal<.001&&rough>.55){
   var surface=-2.;if(hit.id>=0){surface=triangles[hit.id].p.w+3.;}
   let cached=endpointLookup(point,n,wo,surface,color);
   if(cached.w>.5){accumulate(throughput*cached.rgb*max(color,vec3f(.02)));if(m.physical.w>.5){break;}endpointSpecularOnly=true;}
  }
  if(bounce==0u&&guide.id>=0&&hit.id>=0)`);
 replace('let probability=select(specularProbability(color,metal,nv),0.,m.physical.w>.5);if(random(&seed)<probability)', 'let probability=select(select(specularProbability(color,metal,nv),0.,m.physical.w>.5),1.,endpointSpecularOnly);if(random(&seed)<probability)');
 replace('modulation[index]=vec4f(demod,1);','modulation[index]=vec4f(demod,1);modulation[6u*u.size.x*u.size.y+index]=vec4f(f32(endpointAttempts),f32(endpointHits),0,0);');
 return source;
}

export function endpointReconstruct(source){
 const marker='history.color=vec4f(clamp(history.color.rgb,low,high),history.color.w);';
 if(!source.includes(marker))throw Error('Endpoint diffuse history contract changed');
 return source.replace(marker,`let stableAlbedo=(channel==0u||channel==3u)&&stableDiffuse&&p.normal.w>.55&&history.color.w>1.&&p.secondaryNormal.w<-.5&&history.secondaryNormal.w<-.5&&distance(p.secondaryNormal.xyz,history.secondaryNormal.xyz)<.01;
 if(!stableAlbedo){${marker}}`).replace('let old=readSignal(previous[u32(q.y)*u.size.x+u32(q.x)],channel);let delta=',`let old=readSignal(previous[u32(q.y)*u.size.x+u32(q.x)],channel);
 if((channel==0u||channel==3u)&&p.secondaryNormal.w<-.5&&(old.secondaryNormal.w>=-.5||distance(p.secondaryNormal.xyz,old.secondaryNormal.xyz)>.01)){continue;}
 let delta=`);
}

export const endpointPublish=`
struct Uniforms { size:vec4u,eye:vec4f,right:vec4f,up:vec4f,forward:vec4f,previousEye:vec4f,previousRight:vec4f,previousUp:vec4f,previousForward:vec4f,flags:vec4f,features:vec4f }
@group(0) @binding(0) var<uniform> u:Uniforms;
@group(0) @binding(1) var<storage,read> guides:array<Signals>;
@group(0) @binding(2) var<storage,read> lighting:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> arena:array<vec4f>;
@compute @workgroup_size(8,8) fn main(@builtin(global_invocation_id) gid:vec3u){
 if(any(gid.xy>=u.size.xy)){return;}let i=gid.y*u.size.x+gid.x;let count=u.size.x*u.size.y;let b=count+5u*i;let p=guides[i];
 var samples=min(p.diffuse.w,p.indirect.w);if(u.flags.y>.5||u.features.z<.5||p.normal.w<.55||p.specularMoments.w!=0.||p.position.w==-1.){samples=0.;}
 arena[b]=p.position;arena[b+1u]=vec4f(p.normal.xyz,samples);arena[b+2u]=vec4f(arena[i].rgb,p.normal.w);
 let d=lighting[i];let indirect=lighting[i+3u*count];arena[b+3u]=vec4f(d.rgb+indirect.rgb,max(d.w+indirect.w,0.));
 arena[b+4u]=vec4f(normalize(u.eye.xyz-p.position.xyz),f32(u.size.z));
}
`;
