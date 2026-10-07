// Transform the shared production integrator, retaining one secondary path.
// Decomposition classifies energy at the FIRST interaction, not the last hit.
export function rasterSignalTransport(transport){
 const at=transport.indexOf('fn incident(');if(at<0)throw Error('Missing shared transport');
 let body=transport.slice(at).replace('fn incident(', 'fn rasterTransport(')
  .replace('initialPdf:f32)->vec3f', 'initialPdf:f32,initialHit:Hit)->Signals')
  .replace('let guide=trace(startPoint,startDirection,1e20,false);','let guide=initialHit;')
  .replace('var hit=trace(origin,direction,1e20,false);','var hit=guide;if(bounce>0u){hit=trace(origin,direction,1e20,false);}')
  .replace('var radiance=vec3f(0);','var output:Signals;var fraction=vec3f(0);var kind=3u;');
 let additions=0;
 body=body.replace(/radiance\+=([^;]+);/g,(_,value)=>{
  additions++;
  if(value.includes('brdf.rgb')){
   const wi=value.includes('environment(skyDirection)')?'skyDirection':'wi';
   return `addSignal(&output,${value},select(fraction,diffuseFraction(n,wo,${wi},color,metal,m.physical.w,brdf.rgb),bounce==0u&&branch==0u),select(kind,0u,bounce==0u&&branch==0u));`;
  }
  return `addSignal(&output,${value},fraction,kind);`;
 });
 if(additions!==8)throw Error('Radiance accumulation contract changed: '+additions);
 body=body.replace('previousPdf=sampled.w;throughput*=', 'if(bounce==0u&&branch==0u){kind=0u;fraction=diffuseFraction(n,wo,direction,color,metal,m.physical.w,sampled.rgb);}previousPdf=sampled.w;throughput*=')
  .replace('}delta=true;', '}if(bounce==0u&&branch==0u){kind=select(2u,1u,dot(direction,geometricNormal)>0.);}delta=true;')
  .replace('pending=false;origin=pendingOrigin;', 'kind=1u;pending=false;origin=pendingOrigin;')
  .replace('return radiance;', 'return output;');
 if(body.includes('radiance'))throw Error('Unclassified radiance remains');
 return body;
}
