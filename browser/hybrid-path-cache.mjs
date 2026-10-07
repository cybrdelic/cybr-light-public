// Branch-local control variate. Cache construction never reads the cache itself.
export function pathCacheTransport(transport, separated){
 const marker='  if(bounce==0u&&guide.id>=0&&hit.id>=0)';
 if(!separated.includes(marker))throw Error('Missing path-cache insertion contract');
 const at=transport.indexOf('fn incident(');
 if(at<0)throw Error('Missing cache reference transport');
 const build=transport.slice(at).replace('fn incident(', 'fn cacheIncident(')
  .replace('initialPdf:f32)->vec3f','initialPdf:f32,budget:u32)->vec3f')
  .replaceAll('min(u.size.w,16u)','min(budget,16u)');
 const trace=separated.replace(marker,`  if(lab.mode==12u&&hit.id>=0&&bounce>0u&&(kind==1u||kind==2u)&&m.physical.y<.5&&ior==1.&&all(medium==vec3f(0))){
   let cached=pathLookup(hit,point,n,direction,min(u.size.w,16u)-bounce);
   if(cached.w>0.){
    // Keep an unbiased correction: coarse cache values are NOT final lighting.
    let survive=.25;
    addSignal(&output,throughput*cached.rgb,fraction,kind);
    if(random(&seed)>=survive){break;}
    addSignal(&output,-throughput*cached.rgb/survive,fraction,kind);
    throughput/=survive;
   }
  }
`+marker);
 return build+'\n'+trace;
}
