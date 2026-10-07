export function lightReservoirShader(candidates){
 if(![2,4,8].includes(candidates))throw Error('Unsupported light candidate count');
 return `
struct DirectEstimate { value:vec3f, fraction:vec3f }
fn reservoirDirect(point:vec3f,n:vec3f,gn:vec3f,wo:vec3f,color:vec3f,metal:f32,alpha:f32,lambert:f32,seed:ptr<function,u32>)->DirectEstimate{
 var selected=vec3f(0);var selectedFraction=vec3f(0);var selectedDirection=vec3f(0);var selectedDistance=0.;var selectedTarget=0.;var total=0.;
 let count=u32(lighting.info.y);
 if(count==0u){return DirectEstimate(vec3f(0),vec3f(0));}
 for(var candidate=0u;candidate<${candidates}u;candidate++){
  let light=lighting.lights[sampleSourceLight(random(seed),count)];let r=sqrt(random(seed));let v=random(seed);
  let lp=light.p.xyz+light.e1.xyz*(1.-r)+light.e2.xyz*r*v;let delta=lp-point;let d=length(delta);let wi=delta/max(d,1e-20);let nl=max(dot(n,wi),0.);
  if(nl<=0.||dot(gn,wi)<=0.){continue;}
  let b=bsdf(n,wo,wi,color,metal,alpha,lambert);let pdf=sourceLightPDF(light,wi,d);
  let estimate=b.rgb*light.emission.xyz*nl/max(pdf,1e-20)*mis(pdf,b.w);
  let importance=dot(estimate,vec3f(.2126,.7152,.0722));
  if(importance<=0.){continue;}
  total+=importance;
  if(random(seed)*total<importance){selected=estimate;selectedTarget=importance;selectedDirection=wi;selectedDistance=d;selectedFraction=diffuseFraction(wo,wi,color,metal,lambert,b.rgb);}
 }
 if(selectedTarget<=0.){return DirectEstimate(vec3f(0),vec3f(0));}
 let hit=trace(point+gn*.0001,selectedDirection,selectedDistance-.0003,true);
 if(hit.id!=-1){return DirectEstimate(vec3f(0),vec3f(0));}
 // Candidate count includes rejected/zero candidates. Original NEE MIS
 // weights are inside the estimator, so BSDF-emitter MIS stays unchanged.
 return DirectEstimate(selected*(total/(${candidates}.*selectedTarget)),selectedFraction);
}
`;
}
