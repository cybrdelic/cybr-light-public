// Diagnostic attribution only: preserve every random draw and radiance term.
// transmission = a light reached through refraction AFTER opaque scattering;
// specular = a light reached through ideal reflection but no such refraction;
// diffuse = all remaining transport, including camera-through-glass visibility.
export function causticAuditTransport(transport){
 const at=transport.indexOf('fn incident(');if(at<0)throw Error('Missing transport');
 let s=transport.slice(at).replace('fn incident(', 'fn rasterTransport(')
  .replace('initialPdf:f32)->vec3f','initialPdf:f32,initialHit:Hit)->Signals')
  .replace('let guide=trace(startPoint,startDirection,1e20,false);','let guide=initialHit;')
  .replace('var hit=trace(origin,direction,1e20,false);','var hit=guide;if(bounce>0u){hit=trace(origin,direction,1e20,false);}')
  .replace('var radiance=vec3f(0);','var output:Signals;var scattered=false;var refractedTail=false;var reflectedTail=false;');
 let count=0;
 s=s.replace(/radiance\+=([^;]+);/g,(_,value)=>{
  count++;
  return `addSignal(&output,${value},vec3f(1),select(select(0u,1u,scattered&&reflectedTail),2u,scattered&&refractedTail));`;
 });
 if(count!==8)throw Error('Transport attribution contract changed');
 s=s.replace('  if(m.physical.y>.5){','  if(m.physical.y<.5){scattered=true;refractedTail=false;reflectedTail=false;}\n  if(m.physical.y>.5){')
  .replace('}delta=true;','}if(scattered){if(dot(direction,geometricNormal)>0.){reflectedTail=true;}else{refractedTail=true;}}delta=true;')
  .replace('pending=false;origin=pendingOrigin;','scattered=false;refractedTail=false;reflectedTail=false;pending=false;origin=pendingOrigin;')
  .replace('return radiance;','return output;');
 return s;
}
