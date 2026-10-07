// Reuse the presentation algorithm, not the four-lobe lighting allocation.
// The main backend supplies already composed RGB and the smaller Pixel guide.
export function singleCoverageResolve(source){
 const abi='struct Signals { color:vec4f,position:vec4f,normal:vec4f,moments:vec4f,secondary:vec4f,secondaryNormal:vec4f }';
 const start=source.indexOf('fn composed('),end=source.indexOf('fn project(');
 if(start<0||end<start)throw Error('Coverage composition contract changed');
 source=source.slice(0,start)+'fn composed(q:vec2i)->vec3f{return lighting[indexAt(q)].rgb;}\n'+source.slice(end);
 source=source.replace('@group(0) @binding(4) var<storage,read> modulation:array<vec4f>;','');
 source=source.replace('@binding(5)','@binding(4)').replace('@binding(6)','@binding(5)');
 source=source.replaceAll('specularMoments','moments');
 // Presentation pixels are already unjittered. A stationary view needs no
 // surface correspondence (especially through glass); accumulate at that pixel.
 // Host resets the count on camera motion and scene/material changes.
 const stationaryAnchor='var guide=current[i];var guideXY=q;';
 if(!source.includes(stationaryAnchor))throw Error('Stationary coverage contract changed');
 source=source.replace(stationaryAnchor,`if(u.flags.x<.5){
  let weight=min(max(u.features.y-1.,0.),511.);
  output[i]=vec4f((now+history[i].rgb*weight)/(weight+1.),weight+1.);
  return;
 }
 ${stationaryAnchor}`);
 source=source.replace('let glass=modulation[indexAt(guideXY)].w>.5;','let glass=guide.moments.w==-1.;');
 // Combined radiance cannot follow a single refracted/reflected endpoint.
 source=source.replace('let oldXY=vec2i(round(previousPixel));','if(glass||reflection){valid=false;}\n let oldXY=vec2i(round(previousPixel));');
 // Guides live on the previous jittered sampling grid; history is unjittered.
 source=source.replace('let oldGuide=previous[indexAt(oldXY)];',`let oldGuideSample=select(previousPixel+vec2f(.5),project(guide.position.xyz).xy,guide.position.w!=-1.);
 let oldGuideXY=vec2i(round(oldGuideSample-coverageJitter(u.size.z-1u)));
 let oldGuide=previous[indexAt(oldGuideXY)];`);
 return abi+'\n'+source;
}
