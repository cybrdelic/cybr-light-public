// Separate direct transmission from internally reflected optical contributions.
// A zero Monte Carlo estimate still belongs to its expected path's guide.
export function pathCorrespondence(stage, source) {
  const replace = (a, b) => {
    if (!source.includes(a))
      throw Error('Path correspondence contract: ' + stage);
    source = source.replace(a, b);
  };
  if (stage !== 'display' && source.includes('reflectedNormal:vec4f')) {
    replace(
      'reflectedNormal:vec4f',
      'reflectedNormal:vec4f,residualPosition:vec4f,residualNormal:vec4f,layoutPadding:vec4f',
    );
    replace(
      'return Pixel(c,s.position,s.normal,m,s.secondary,s.secondaryNormal);',
      'if(channel==3u&&s.normal.w==0.){return Pixel(c,s.position,s.normal,m,s.residualPosition,s.residualNormal);}\n return Pixel(c,s.position,s.normal,m,s.secondary,s.secondaryNormal);',
    );
  }
  if (stage === 'trace' || stage === 'trace-pile') {
    replace(
      'var<private> radianceT:vec3f;',
      'var<private> radianceT:vec3f;var<private> opticalResidual:bool;',
    );
    source = source.replaceAll(
      'radianceT+=value*weightT;',
      'if(opticalResidual){radianceI+=value*weightT;}else{radianceT+=value*weightT;}',
    );
    replace(
      'if(u.features.x>.5){let tg=transmittedGuide(guide,guideDirection);secondary=tg.position;secondaryNormal=tg.normal;}',
      'if(u.features.x>.5){let tg=transmittedGuide(guide,guideDirection);secondary=tg.position;secondaryNormal=tg.normal;}var transmissionEndpoint=false;var residualEndpoint=false;var residualMixed=false;var residualGuide=TransmissionGuide(vec4f(0,0,0,-1),vec4f(0));',
    );
    replace(
      'if(u.features.x<.5&&branch==0u&&transmissionChain&&m.physical.y<.5)',
      'if(opticalResidual&&!residualEndpoint&&any(weightT>vec3f(0))&&m.physical.y<.5){var surface=-2.;if(hit.id>=0){surface=triangles[hit.id].p.w+3.;}residualGuide=TransmissionGuide(vec4f(point,surface),vec4f(n,1));residualEndpoint=true;}\n if(u.features.x<.5&&branch==0u&&transmissionChain&&m.physical.y<.5)',
    );
    replace(
      'if(u.features.x<.5&&branch==0u&&transmissionChain&&m.physical.y<.5)',
      'if(branch==0u&&!opticalResidual&&!transmissionEndpoint&&any(weightT>vec3f(0))&&m.physical.y<.5)',
    );
    replace(
      'secondary=vec4f(point,surface);secondaryNormal=vec4f(n,1);transmissionChain=false;',
      'transmissionEndpoint=true;transmissionChain=false;',
    );
    // Only reflections before the first opaque endpoint change the optical
    // contribution class. Endpoint lighting remains part of that same estimate.
    replace(
      '}delta=true;',
      `}
   if(branch==0u&&!transmissionEndpoint){
    let reflected=dot(direction,geometricNormal)>0.;
    if(reflected&&any(weightT>vec3f(0))){opticalResidual=true;}
   }
   delta=true;`,
    );
    replace(
      'if(exitPending){exitPending=false;',
      'if(exitPending){residualMixed=residualEndpoint;opticalResidual=true;exitPending=false;',
    );
    replace(
      'vec4f(il,il*il,0,0)',
      'vec4f(il,il*il,0,select(0.,-1.,guideNormal.w==0.))',
    );
    replace(
      'reflectedEdge.position,reflectedEdge.normal);',
      'reflectedEdge.position,reflectedEdge.normal,residualGuide.position,residualGuide.normal,vec4f(0));',
    );
    replace('samples[index]=Signals(', 'if(residualMixed){residualGuide.normal.w=0.;}\n samples[index]=Signals(');
  } else if (stage === 'reconstruct') {
    replace(
      'output[i].reflectedPosition=current[i].reflectedPosition;',
      'output[i].residualPosition=current[i].residualPosition;output[i].residualNormal=current[i].residualNormal;output[i].reflectedPosition=current[i].reflectedPosition;',
    );
  }
  return source;
}
