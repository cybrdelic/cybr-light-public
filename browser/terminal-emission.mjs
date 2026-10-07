// A depth budget counts scattering events, not the light endpoint. At the
// final scatter NEE uses MIS against the BSDF continuation, so that competing
// continuation must still be allowed to hit emission or the environment.
export function terminalEmission(source){
 const loop='for(var bounce=startDepth;bounce<min(u.size.w,16u);bounce++){';
 if(!source.includes(loop))throw Error('Terminal emission loop contract changed');
 source=source.replace(loop,'for(var bounce=startDepth;bounce<=min(u.size.w,16u);bounce++){');
 const emitter=source.indexOf('if(any(m.emission.xyz>vec3f(0)))',source.indexOf('@compute'));
 const end=source.indexOf('\n',emitter);
 if(emitter<0||end<0)throw Error('Terminal emission endpoint contract changed');
 return source.slice(0,end)+'\n  if(bounce>=min(u.size.w,16u)){break;}'+source.slice(end);
}
