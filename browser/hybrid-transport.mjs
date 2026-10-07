// Reuse production secondary transport, not a second simplified integrator.
export function incidentTransport(source) {
  source=source.replaceAll('\r\n','\n');
  const main=source.indexOf('@compute @workgroup_size(8,8) fn main(');
  const start=source.indexOf(' var origin=u.eye.xyz;',main);
  const guideStart=source.indexOf(' if(guide.id!=-1){let gm=',start);
  const loopStart=source.indexOf(' var startDepth=0u;',guideStart);
  const end=source.indexOf(' // No firefly clamping',loopStart);
  if([main,start,guideStart,loopStart,end].some(i=>i<0))throw Error('Hybrid transport contract changed');
  const prefix=source.slice(0,main).replace('@group(0) @binding(4) var<storage,read_write> samples:array<Pixel>;','');
  let body=source.slice(start,guideStart)+source.slice(loopStart,end);
  body=body.replace('var origin=u.eye.xyz;var direction=pathDirection;','var origin=startPoint;var direction=startDirection;');
  body=body.replace('var hit=guide;if(bounce>0u||u.previousEye.w<.5){hit=trace(origin,direction,1e20,false);}','var hit=trace(origin,direction,1e20,false);');
  body=body.replace('var startDepth=0u;','let stableReflection=false;var startDepth=0u;');
  // Camera rays have no competing light-sampling PDF. Secondary irradiance
  // rays do; treating camera rays as non-delta would darken visible emitters.
  body=body.replace('var delta=true;','var delta=initialPdf<=0.;').replace('var previousPdf=0.;','var previousPdf=initialPdf;');
  return prefix+'\nfn incident(startPoint:vec3f,startDirection:vec3f,initialSeed:u32,initialPdf:f32)->vec3f {\nvar seed=initialSeed;let guide=trace(startPoint,startDirection,1e20,false);let guideDirection=startDirection;let guidePos=vec4f(0);let guideNormal=vec4f(0);\n'+body+'\nreturn radiance;\n}\n';
}

// The cached diffuse term is a control variate, not a replacement BRDF.
// Subtract the same term from NEE and continuation, retaining their original
// MIS PDFs. Signed residuals must never be clamped to zero.
export function beautyCacheTransport(transport){
 const at=transport.indexOf('fn incident(');
 if(at<0)throw Error('Missing incident transport');
 const original=transport.slice(at);
 const limited=original.replace('fn incident(', 'fn incidentAfterPrimary(')
  .replace('var startDepth=0u;', 'var startDepth=1u;');
 let beauty=original.replace('fn incident(', 'fn incidentBeauty(');
 const marker='  if(m.physical.y>.5){';
 if(!beauty.includes(marker))throw Error('Missing primary material branch');
 beauty=beauty.replace(marker,`  var cacheWeight=vec3f(0);
  if(bounce==0u&&branch==0u&&hit.id!=-1&&m.physical.y<.5&&metal<.999){
   let cached=primaryIrradiance(hit,point,!entering,n);
   if(cached.w>0.){
    cacheWeight=select(color*(1.-metal)*(vec3f(1)-mix(vec3f(.04),color,metal)),color,m.physical.w>.5);
    radiance+=throughput*cacheWeight*cached.rgb;
    /*BEAUTY_STATS*/
    if(m.physical.w>.5){break;}
   }
  }
`+marker);
 beauty=beauty.replaceAll('bsdf(n,wo,wi,color,metal,alpha,m.physical.w)', 'residualBsdf(n,wo,wi,color,metal,alpha,m.physical.w,cacheWeight)')
  .replaceAll('bsdf(n,wo,direction,color,metal,alpha,m.physical.w)', 'residualBsdf(n,wo,direction,color,metal,alpha,m.physical.w,cacheWeight)');
 beauty=beauty.replaceAll('bsdf(n,wo,skyDirection,color,metal,alpha,m.physical.w)', 'residualBsdf(n,wo,skyDirection,color,metal,alpha,m.physical.w,cacheWeight)');
 const continuation='   delta=false;';
 beauty=beauty.replace(continuation,`   if(any(cacheWeight>vec3f(0))){
    let magnitude=max(max(abs(throughput.x),abs(throughput.y)),abs(throughput.z));
    let survival=clamp(magnitude,.02,1.);
    if(random(&seed)>=survival){break;}throughput/=survival;
   }
`+continuation);
 beauty=beauty.replace('max(max(throughput.x,throughput.y),throughput.z)', 'max(max(abs(throughput.x),abs(throughput.y)),abs(throughput.z))');
 return limited+'\n'+beauty;
}
