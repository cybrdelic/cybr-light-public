// Reciprocal Kulla-Conty lobe with Hill's corrected F_avg^2 factor.
// https://blog.selfshadow.com/2018/06/04/multi-faceted-part-2/
export function metalEnergyShader(source) {
  source = source.replaceAll('\r\n', '\n');
  const replace = (a, b) => {
    if (!source.includes(a))
      throw Error('Metal energy shader contract changed: ' + a);
    source = source.replace(a, b);
  };
  // A 0.001 outgoing-cosine clamp breaks reciprocity at grazing incidence
  // and makes BSDF evaluation disagree with its sampler. Reject the wrong
  // hemisphere instead; only protect the true underflow range in denominators.
  source = source.replaceAll(
    'let nv=max(dot(n,wo),.001);',
    'let nv=max(dot(n,wo),0.);',
  );
  replace(
    'if(nl<=0.){return vec4f(0);}',
    'if(nv<=0.||nl<=0.){return vec4f(0);}',
  );
  replace('max(4.*nv*nl,1e-6)', 'max(4.*nv*nl,1e-30)');
  const helpers = `
fn metalEnergy(mu:f32,alpha:f32)->vec2f{
 let p=vec2f(sqrt(clamp(mu,0.,1.)),sqrt(clamp(alpha,0.,1.)))*31.;
 let cell=min(vec2u(p),vec2u(30));let w=p-vec2f(cell);let i=2u+cell.y*32u+cell.x;
 return mix(mix(portals[i].center.xy,portals[i+1u].center.xy,w.x),mix(portals[i+32u].center.xy,portals[i+33u].center.xy,w.x),w.y);
}
fn metalMultipleTint(color:vec3f,avg:f32)->vec3f{
 let f=clamp(color,vec3f(0),vec3f(1));let fa=f+(vec3f(1)-f)/21.;
 return fa*fa*avg/max(vec3f(1)-fa*(1.-avg),vec3f(1e-6));
}
fn metalSampleProbability(color:vec3f,nv:f32,alpha:f32)->f32{
 let e=metalEnergy(nv,alpha);let loss=max(0.,1.-e.x);if(loss<1e-5){return 1.;}
 let f=clamp(color,vec3f(0),vec3f(1));let fa=f+(vec3f(1)-f)/21.;
 let single=e.x*dot(fa,vec3f(.2126,.7152,.0722));
 let multiple=loss*dot(metalMultipleTint(color,e.y),vec3f(.2126,.7152,.0722));
 return clamp(single/max(single+multiple,1e-8),.02,.999);
}
`;
  replace('fn specularProbability(', helpers + '\nfn specularProbability(');
  replace(
    'metal:f32,nv:f32)->f32{',
    'metal:f32,nv:f32,alpha:f32)->f32{\n if(metal>.99){return metalSampleProbability(color,nv,alpha);}',
  );
  source = source.replaceAll(
    'specularProbability(color,metal,nv)',
    'specularProbability(color,metal,nv,alpha)',
  );
  replace('let value=color*(1.-metal)', 'var value=color*(1.-metal)');
  replace(
    ' return vec4f(value,pdf);',
    ` if(metal>.99){
  let eo=metalEnergy(nv,alpha);let ei=metalEnergy(nl,alpha);
  value+=metalMultipleTint(color,eo.y)*max(0.,1.-eo.x)*max(0.,1.-ei.x)/(PI*max(1.-eo.y,1e-6));
 }
 return vec4f(value,pdf);`,
  );
  return source;
}
