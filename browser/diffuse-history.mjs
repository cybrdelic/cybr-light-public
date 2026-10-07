// Do not clamp a validated, view-independent lighting estimate to a noisy
// one-sample neighborhood. Preserve rejection at material/albedo boundaries.
export function diffuseHistoryShader(source,stage){
 if(stage==='trace'){
  const marker='var secondary=vec4f(0,0,0,-1);var secondaryNormal=vec4f(0);';
  if(!source.includes(marker))throw Error('Diffuse guide trace contract changed');
  return source.replace(marker,marker+`
 // For opaque diffuse pixels this otherwise unused field carries albedo.
 // Negative w identifies albedo, never a valid optical guide.
 if(guide.id!=-1){let gm=material(guide);if(gm.physical.x<.001&&gm.physical.y<.5&&gm.base.w>.55){secondaryNormal=vec4f(gm.base.rgb*vertexColor(guide),-1.);}}
 `);
 }
 if(stage==='reconstruct'){
  const marker='history.color=vec4f(clamp(history.color.rgb,low,high),history.color.w);';
  if(!source.includes(marker))throw Error('Diffuse history reconstruction contract changed');
  const tap='let old=previous[u32(q.y)*u.size.x+u32(q.x)];let delta=';
  if(!source.includes(tap))throw Error('Diffuse history gather contract changed');
  source=source.replace(tap,`let old=previous[u32(q.y)*u.size.x+u32(q.x)];
   if(p.secondaryNormal.w<-.5&&(old.secondaryNormal.w>=-.5||distance(old.secondaryNormal.xyz,p.secondaryNormal.xyz)>=.01)){continue;}
   let delta=`);
  return source.replace(marker,`
 let sameAlbedo=p.secondaryNormal.w<-.5&&history.secondaryNormal.w<-.5&&distance(history.secondaryNormal.xyz,p.secondaryNormal.xyz)<.01;
 let diffuseLighting=stableDiffuse&&p.normal.w>.55&&history.color.w>1.&&sameAlbedo;
 if(!diffuseLighting){${marker}}
 `);
 }
 return source;
}

// Same validated diffuse-history rule for the four-lobe backend, independent
// of endpoint-cache experiments. Optical/specular channels retain their clamp.
export function signalDiffuseHistoryShader(source,stage){
 if(stage==='trace'||stage==='trace-pile'){
  const marker='var startDepth=0u;';
  if(!source.includes(marker))throw Error('Signal diffuse trace contract changed');
  return source.replace(marker,`if(guide.id!=-1){let gm=material(guide);if(gm.physical.x<.001&&gm.physical.y<.5&&gm.base.w>.55){secondaryNormal=vec4f(gm.base.rgb*vertexColor(guide),-1.);}}\n ${marker}`);
 }
 if(stage==='reconstruct'){
  const marker='history.color=vec4f(clamp(history.color.rgb,low,high),history.color.w);';
  const tap='let old=readSignal(previous[u32(q.y)*u.size.x+u32(q.x)],channel);let delta=';
  if(!source.includes(marker)||!source.includes(tap))throw Error('Signal diffuse history contract changed');
  return source.replace(marker,`let stableAlbedo=(channel==0u||channel==3u)&&stableDiffuse&&p.normal.w>.55&&history.color.w>1.&&p.secondaryNormal.w<-.5&&history.secondaryNormal.w<-.5&&distance(p.secondaryNormal.xyz,history.secondaryNormal.xyz)<.01;
 if(!stableAlbedo){${marker}}`).replace(tap,`let old=readSignal(previous[u32(q.y)*u.size.x+u32(q.x)],channel);
 if((channel==0u||channel==3u)&&p.secondaryNormal.w<-.5&&(old.secondaryNormal.w>=-.5||distance(p.secondaryNormal.xyz,old.secondaryNormal.xyz)>.01)){continue;}
 let delta=`);
 }
 return source;
}
