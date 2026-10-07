// Test-only: use the existing broad pass only where the transmission guide
// ends on a rough nonmetal surface. Reflections and unsupported paths keep
// their existing narrow support. Geometry/secondary-edge tests remain intact.
// Optical improvement only; failed the cross-scene pile gate. See
// MOTION-SEQUENCE-AUDIT-20260929.md. Not a production default.
export function transmittedSupport(stage,source){
 const replace=(a,b)=>{if(!source.includes(a))throw Error('Transmission support contract changed: '+stage);source=source.replace(a,b);};
 if(stage==='trace'||stage==='trace-pile'){
  replace('return TransmissionGuide(vec4f(p,surface),vec4f(n,1));',`let color=vec3u(round(clamp(m.base.rgb*vertexColor(h),vec3f(0),vec3f(1))*127.));
   let albedoTag=2.+f32(color.x+128u*color.y+16384u*color.z);
   return TransmissionGuide(vec4f(p,surface),vec4f(n,select(1.,albedoTag,m.physical.x<.001&&m.base.w>.55)));`);
 }else if(stage==='filter'){
  replace('let viewDependent=center.normal.w<.3&&(config.w==0u||center.moments.w!=0.);','let viewDependent=center.normal.w<.3&&(config.w==0u||center.moments.w!=0.)&&!(CHANNEL==2u&&center.secondaryNormal.w>1.5);');
 }else if(stage==='coverage-filter'){
  replace('let viewDependent=vec4<bool>(c.normal.w<.3)', 'var viewDependent=vec4<bool>(c.normal.w<.3)');
  replace(' let sky=', ' if(c.secondaryNormal.w>1.5){viewDependent.z=false;}\n let sky=');
 }
 return source;
}
