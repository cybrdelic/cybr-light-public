// Transport surgery must fail loudly if the shared integrator changes.
export function assertConnectionContract(source,{queued=false}={}){
 const markers=['var output:Signals;','  if(m.physical.y>.5){',
  'if(!delta&&lightIndex>0u){weight=mis(previousPdf,sourceLightPDF(lighting.lights[lightIndex-1u],direction,hit.t));}',
  '}if(bounce==0u&&branch==0u){kind=select(',
  'previousPdf=sampled.w;throughput*=', 'pending=false;origin=pendingOrigin;'];
 if(queued)markers.push('initialHit:Hit)->Signals');
 for(const marker of markers){if(source.split(marker).length!==2)throw Error('Connection transport contract changed: '+marker);}
}
