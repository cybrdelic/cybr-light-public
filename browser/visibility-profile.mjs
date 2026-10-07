// Four deterministic visibility rays, no extra lighting paths and no RNG use.
// Diagnostic only: measurements do not enter radiance or reconstruction.
export function visibilityProfile(source,instanced=false){
 source=source.replaceAll('\r\n','\n');
 const marker='var origin=u.eye.xyz;';if(!source.includes(marker))throw Error('Visibility profile contract changed');
 const identity=instanced?'f32(instanceIdentity(h))+3.':'triangles[h.id].p.w+3.';
 return source.replace(marker,`
 var coverageIds:array<f32,4>;var distinct=0.;var centerMismatch=0.;var normalSpread=0.;var depthSpread=0.;
 for(var v=0u;v<4u;v++){
  let subpixel=vec2f(.25+.5*f32(v%2u),.25+.5*f32(v/2u));let vd=camera(vec2f(gid.xy)+subpixel);let h=trace(u.eye.xyz,vd,1e20,false);
  var identity=f32(h.id);if(h.id>=0){identity=${identity};}coverageIds[v]=identity;
  var unseen=true;for(var j=0u;j<v;j++){if(coverageIds[j]==identity){unseen=false;}}if(unseen){distinct+=1.;}
  if(identity!=guidePos.w){centerMismatch+=.25;}
  if(h.id!=-1&&guide.id!=-1){normalSpread=max(normalSpread,1.-dot(normal(h),guideNormal.xyz));depthSpread=max(depthSpread,abs(h.t-guide.t)/max(guide.t*u.forward.w*2./f32(u.size.y),1e-6));}
 }
 visibility[index]=vec4f(distinct,centerMismatch,normalSpread,depthSpread);
 ${marker}`)+ '\n@group(0) @binding(8) var<storage,read_write> visibility:array<vec4f>;';
}
export function summarizeVisibility(a){
 if(a.length%4)throw Error('Visibility ABI mismatch');const n=a.length/4;let mixed=0,mismatch=0,normal=0,depth=0;const histogram=[0,0,0,0];
 for(let i=0;i<a.length;i+=4){histogram[Math.min(3,Math.max(0,a[i]-1))]++;if(a[i]>1)mixed++;mismatch+=a[i+1];if(a[i+2]>.02)normal++;if(a[i+3]>2)depth++;}
 return {pixels:n,distinctIdentityHistogram:histogram,mixedIdentityPixels:mixed,mixedFraction:mixed/n,meanCenterMismatch:mismatch/n,normalDiscontinuityPixels:normal,depthDiscontinuityPixels:depth};
}
