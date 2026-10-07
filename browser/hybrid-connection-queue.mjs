// Defer both techniques together. Overflow is a host-visible FAILED sample,
// not a path-dependent fallback that may be accumulated as an unbiased sample.
import {assertConnectionContract} from './hybrid-connection-contract.mjs';
export function queuedConnectionTransport(separated){
 assertConnectionContract(separated,{queued:true});
 let s=separated.replace('initialHit:Hit)->Signals','initialHit:Hit,pixelIndex:u32)->Signals')
  .replace('var output:Signals;', 'var output:Signals;var connectionActive=false;var connectionCrossed=false;var connectionOrigin=vec3f(0);var connectionDirection=vec3f(0);var connectionProbability=1.;var connectionBudget=0u;');
 const emitter='if(!delta&&lightIndex>0u){weight=mis(previousPdf,sourceLightPDF(lighting.lights[lightIndex-1u],direction,hit.t));}';
 if(!s.includes(emitter))throw Error('Missing emitter MIS');
 s=s.replace(emitter,emitter+`if(connectionActive&&connectionCrossed&&lightIndex>0u){
   var item:ConnectionWork;item.info=vec4u(0,0,1,connectionBudget);
   item.origin=vec4f(connectionOrigin,f32(lightIndex-1u));item.destination=vec4f(point,connectionProbability);
   item.direction=vec4f(connectionDirection,previousPdf);item.throughput=vec4f(throughput*m.emission.xyz,weight);item.fraction=vec4f(fraction,f32(kind));
   enqueueConnection(item,pixelIndex);
  }`);
 const marker='  if(m.physical.y>.5){';
 s=s.replace(marker,`  if(m.physical.y<.5){
   connectionActive=media.count==0u&&ior==1.&&all(medium==vec3f(0))&&lighting.info.x>.5&&u32(lighting.info.y)>0u&&bounce+2u<min(u.size.w,16u);
   connectionOrigin=point+geometricNormal*.0001;connectionBudget=min(u.size.w,16u)-bounce-1u;connectionProbability=1.;connectionCrossed=false;
   if(connectionActive&&random(&seed)<CONNECTION_CHANCE){
    let lightIndex=sampleSourceLight(random(&seed),u32(lighting.info.y));let light=lighting.lights[lightIndex];let r=sqrt(random(&seed));let v=random(&seed);
    var item:ConnectionWork;item.info=vec4u(0,0,0,connectionBudget);item.origin=vec4f(connectionOrigin,f32(lightIndex));
    item.destination=vec4f(light.p.xyz+light.e1.xyz*(1.-r)+light.e2.xyz*(r*v),0);
    item.normal=vec4f(n,alpha);item.geometric=vec4f(geometricNormal,metal);item.wo=vec4f(wo,m.physical.w);
    item.color=vec4f(color,select(0.,1.,bounce==0u&&branch==0u));item.throughput=vec4f(throughput,0);
    item.fraction=vec4f(fraction,f32(select(kind,0u,bounce==0u&&branch==0u)));enqueueConnection(item,pixelIndex);
   }
  }
`+marker);
 return s.replace('}if(bounce==0u&&branch==0u){kind=select(', '}if(connectionActive){if(dot(direction,geometricNormal)>0.){connectionActive=false;}else{connectionCrossed=true;connectionProbability*=1.-f;}}if(bounce==0u&&branch==0u){kind=select(')
  .replace('previousPdf=sampled.w;throughput*=', 'connectionDirection=direction;previousPdf=sampled.w;throughput*=')
  .replace('pending=false;origin=pendingOrigin;', 'connectionActive=false;pending=false;origin=pendingOrigin;');
}
