// Experimental area-light connection, limited to air-origin opaque vertices.
import {assertConnectionContract} from './hybrid-connection-contract.mjs';
export function refractedNeeTransport(separated,{legacyReplay=false}={}){
 assertConnectionContract(separated);
 let s=separated.replace('var output:Signals;', 'var output:Signals;var connectionActive=false;var connectionOrigin=vec3f(0);var connectionDirection=vec3f(0);var connectionProbability=1.;var connectionBudget=0u;');
 const emitter='if(!delta&&lightIndex>0u){weight=mis(previousPdf,sourceLightPDF(lighting.lights[lightIndex-1u],direction,hit.t));}';
 if(!s.includes(emitter))throw Error('Missing emitter MIS contract');
 s=s.replace(emitter,emitter+`if(connectionActive&&lightIndex>0u){
   let connection=replayRefracted(connectionOrigin,point,connectionDirection,lighting.lights[lightIndex-1u],connectionBudget);
   if(connection.pdf>0.&&dot(connection.direction-connectionDirection,connection.direction-connectionDirection)<2e-7){weight=mis(previousPdf*connectionProbability,CONNECTION_CHANCE*connection.pdf);}
  }`);
 const glass='  if(m.physical.y>.5){';
 if(!s.includes(glass))throw Error('Missing optical branch');
 s=s.replace(glass,`  if(m.physical.y<.5){
   connectionActive=media.count==0u&&ior==1.&&all(medium==vec3f(0))&&lighting.info.x>.5&&u32(lighting.info.y)>0u&&bounce+2u<min(u.size.w,16u);
   connectionOrigin=point+geometricNormal*.0001;connectionBudget=min(u.size.w,16u)-bounce-1u;connectionProbability=1.;
   if(connectionActive&&random(&seed)<CONNECTION_CHANCE){
    let light=lighting.lights[sampleSourceLight(random(&seed),u32(lighting.info.y))];let r=sqrt(random(&seed));let v=random(&seed);
    let destination=light.p.xyz+light.e1.xyz*(1.-r)+light.e2.xyz*(r*v);
    let connection=connectRefracted(connectionOrigin,destination,light,connectionBudget);
    let wi=connection.direction;let nl=max(dot(n,wi),0.);
    if(connection.pdf>0.&&nl>0.&&dot(geometricNormal,wi)>0.){
     let brdf=bsdf(n,wo,wi,color,metal,alpha,m.physical.w);let pdf=CONNECTION_CHANCE*connection.pdf;
     let value=throughput*brdf.rgb*nl*light.emission.xyz*connection.weight/pdf*mis(pdf,brdf.w*connection.probability);
     addSignal(&output,value,select(fraction,diffuseFraction(n,wo,wi,color,metal,m.physical.w,brdf.rgb),bounce==0u&&branch==0u),select(kind,0u,bounce==0u&&branch==0u));
    }
   }
  }
`+glass);
 s=s.replace('}if(bounce==0u&&branch==0u){kind=select(', '}if(connectionActive){if(dot(direction,geometricNormal)>0.){connectionActive=false;}else{connectionProbability*=1.-f;}}if(bounce==0u&&branch==0u){kind=select(')
  .replace('previousPdf=sampled.w;throughput*=', 'connectionDirection=direction;previousPdf=sampled.w;throughput*=')
  .replace('pending=false;origin=pendingOrigin;', 'connectionActive=false;pending=false;origin=pendingOrigin;');
 if(!legacyReplay){
  s=s.replace('var connectionActive=false;', 'var connectionActive=false;var connectionCrossed=false;')
   .replace('if(connectionActive&&lightIndex>0u)', 'if(connectionActive&&connectionCrossed&&lightIndex>0u)')
   .replace('connectionProbability=1.;\n   if(connectionActive', 'connectionProbability=1.;connectionCrossed=false;\n   if(connectionActive')
   .replace('connectionProbability*=1.-f;', 'connectionCrossed=true;connectionProbability*=1.-f;');
 }
 return s;
}
