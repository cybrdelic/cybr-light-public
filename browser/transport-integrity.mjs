// Main renderer corrections. Legacy transport remains available for paired tests.
// Strict comparison: boundary points use the general containment path.
export function outsideSceneBounds(eye,bounds){
 return eye.some((v,i)=>v<bounds[i]||v>bounds[i+3]);
}
export function transportIntegrity(
  source,
  instanced = false,
  roughDielectrics = true,
  cameraOutside = false,
) {
  source = source.replaceAll('\r\n', '\n');
  const replace = (a, b) => {
    if (!source.includes(a))
      throw Error('Transport integrity contract changed: ' + a);
    source = source.replace(a, b);
  };
  const key = instanced
    ? 'vec2u(u32(attributes[h.id].n0.w),instanceIdentity(h))'
    : 'vec2u(u32(attributes[h.id].n0.w),0u)';
  const stackId = instanced ? 'cameraMedium.ids[i]' : 'cameraMedium.ids[i].x';
  const helpers = `
struct CameraMedium { info:vec4u,ids:array<vec2u,16>,values:array<vec4f,16> }
${cameraOutside?'':'@group(0) @binding(8) var<storage,read> cameraMedium:CameraMedium;'}
fn initializeCameraStack(s:ptr<function,MediumStack>){
 ${cameraOutside?'(*s).count=0u;':`(*s).count=cameraMedium.info.x;
 for(var i=0u;i<(*s).count;i++){(*s).ids[i]=${stackId};(*s).values[i]=cameraMedium.values[i];}`}
}

fn opticalKey(h:Hit)->vec2u{return ${key};}
fn opticalMedium(h:Hit)->vec4f{
 let m=material(h);
 return vec4f(-log(clamp(m.attenuation.xyz,vec3f(1e-20),vec3f(1)))/max(m.attenuation.w,1e-8),m.physical.z);
}
`;
  replace('@compute @workgroup_size', helpers + '\n@compute @workgroup_size');
  replace(
    'var media:MediumStack;',
    'var media:MediumStack;initializeCameraStack(&media);if(media.count>0u){medium=media.values[media.count-1u].xyz;ior=media.values[media.count-1u].w;}',
  );
  replace(
    'var guideMedia:MediumStack;var gi=1.;',
    'var guideMedia:MediumStack;initializeCameraStack(&guideMedia);var gi=1.;if(guideMedia.count>0u){gi=guideMedia.values[guideMedia.count-1u].w;}',
  );
  replace('depth<min(u.size.w,16u)', 'depth<24u');
  replace(
    'commitMedium(&guideMedia,boundary,entering,inside);',
    'if(entering&&guideMedia.count>=16u){break;}commitMedium(&guideMedia,boundary,entering,inside);',
  );
  replace(
    'for(var bounce=startDepth;bounce<min(u.size.w,16u);bounce++){',
    `var scatteringDepth=select(0u,1u,branch==1u);var interfaces=select(0u,1u,branch==1u);
 for(var bounce=startDepth;bounce<min(u.size.w,16u)+24u;bounce++){`,
  );
  replace(
    'if(m.physical.y>.5){\n   let boundary=',
    'if(m.physical.y>.5){\n   if(interfaces>=24u||(entering&&media.count>=16u)){break;}interfaces++;\n   let boundary=',
  );
  replace(
    '   // Ideal directional daylight.',
    '   if(scatteringDepth>=min(u.size.w,16u)){break;}scatteringDepth++;\n   // Ideal directional daylight.',
  );
  replace(
    'direction=reflectedDirection;transmissionChain=false;',
    'if(scatteringDepth>=min(u.size.w,16u)){break;}scatteringDepth++;direction=reflectedDirection;transmissionChain=false;',
  );
  replace(
    'if(bounce>=3u&&!(u.previousUp.w>.5&&delta))',
    'if(scatteringDepth>=3u&&!delta)',
  );
  replace(
    'media.count=0u;startDepth=pendingDepth;',
    'initializeCameraStack(&media);startDepth=pendingDepth;',
  );
  if (!roughDielectrics) return source;
  // VNDF sampling cancels D and the outgoing G1 in f*cos/pdf. Remaining
  // throughput is incoming G1 (and eta^2 for radiance transmission).
  replace(
    'var opticalNormal=geometricNormal;if(u.previousUp.w>.5){opticalNormal=n;}',
    `let roughDielectric=m.base.w>.001&&eta!=1.;let opticalAlpha=max(m.base.w*m.base.w,1e-6);
   var opticalNormal=geometricNormal;if(u.previousUp.w>.5){opticalNormal=n;}
   if(roughDielectric){opticalNormal=visibleGGX(n,wo,opticalAlpha,vec2f(random(&seed),random(&seed)));}`,
  );
  replace(
    'if(dot(reflectedDirection,geometricNormal)<=0.||dot(refracted,geometricNormal)>0.)',
    'if(!roughDielectric&&(dot(reflectedDirection,geometricNormal)<=0.||dot(refracted,geometricNormal)>0.))',
  );
  replace(
    'pendingThroughput=throughput*f;',
    'pendingThroughput=throughput*f;if(roughDielectric){pendingThroughput*=masking(max(dot(n,reflectedDirection),0.),opticalAlpha)*select(0.,1.,dot(reflectedDirection,geometricNormal)>0.);}',
  );
  replace(
    '   }delta=true;',
    `   }
   if(roughDielectric){
    let isReflection=dot(direction,opticalNormal)>0.;
    if((isReflection&&dot(direction,geometricNormal)<=0.)||(!isReflection&&dot(direction,geometricNormal)>=0.)){break;}
    throughput*=masking(abs(dot(n,direction)),opticalAlpha);
   }
   // No direct-light technique competes at dielectric vertices yet, so BSDF
   // emitter hits retain weight one even for non-delta rough transmission.
   delta=true;`,
  );
  return source;
}

export function cameraMediumShader(source) {
  // This is a one-invocation preparation pass, not extra rays per screen pixel.
  const prefix = source
    .slice(0, source.indexOf('@compute @workgroup_size'))
    .replace(
      'var<storage,read> cameraMedium:',
      'var<storage,read_write> cameraMedium:',
    );
  if (!prefix.includes('fn opticalKey'))
    throw Error('Missing camera medium helpers');
  return (
    prefix +
    `
@compute @workgroup_size(1) fn main(){
 cameraMedium.info=vec4u(0);
 if(any(u.eye.xyz<nodes[0].low.xyz)||any(u.eye.xyz>nodes[0].high.xyz)){return;}
 let direction=normalize(vec3f(.37139067,.55708601,.74278135));
 var origin=u.eye.xyz;var seen:array<vec2u,128>;var count=0u;var contained=0u;
 for(var step=0u;step<128u;step++){
  let h=trace(origin,direction,1e20,false);
  if(h.id==-1){break;}
  if(h.id>=0&&material(h).physical.y>.5){
   let key=opticalKey(h);var first=true;
   for(var j=0u;j<count;j++){if(all(seen[j]==key)){first=false;break;}}
   if(first){
    seen[count]=key;count++;
    if(dot(geometric(h),direction)>0.){
     if(contained>=16u){cameraMedium.info.y=1u;break;}
     cameraMedium.ids[contained]=key;cameraMedium.values[contained]=opticalMedium(h);contained++;
    }
   }
  }
  origin+=direction*(h.t+max(1e-6,abs(h.t)*1e-6));
  if(step==127u){cameraMedium.info.y=1u;}
 }
 // First exits arrive innermost first. The stack stores outermost first.
 for(var i=0u;i<contained/2u;i++){
  let j=contained-1u-i;let id=cameraMedium.ids[i];let v=cameraMedium.values[i];
  cameraMedium.ids[i]=cameraMedium.ids[j];cameraMedium.values[i]=cameraMedium.values[j];
  cameraMedium.ids[j]=id;cameraMedium.values[j]=v;
 }
 cameraMedium.info.x=contained;
}`
  );
}
