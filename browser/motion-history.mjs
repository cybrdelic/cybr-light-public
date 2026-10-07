// Diffuse-only confidence. Never relax dielectric or mirror
// acceptance, and never carry long history across incomplete pixel coverage.
// Rejected as a default after user-observed detail/aliasing regressions.
// Existing links used motion=confidence, so those must also fall back on reload.
export function motionHistoryMode(requested,separate=false){return requested==='confidence'?'legacy':requested||'legacy';}
export function motionHistoryShader(source){
 source=source.replaceAll('\r\n','\n');
 const replace=(a,b)=>{if(!source.includes(a))throw Error('Motion history contract changed: '+a);source=source.replace(a,b);};
 replace('let stableDiffuse=', 'var diffuseCoverage=0.;\n let stableDiffuse=');
 replace('if(total>.5){history.color=', 'if(total>.5){diffuseCoverage=total;history.color=');
 replace('var low=result;var high=result;', 'var low=result;var high=result;var neighborhoodMoments=vec2f(0);var neighborhoodCount=0.;');
 replace('let c=neighbor.color.rgb;low=min(low,c);high=max(high,c);', `let c=neighbor.color.rgb;low=min(low,c);high=max(high,c);
   let l=dot(c,vec3f(.2126,.7152,.0722));neighborhoodMoments+=vec2f(l,l*l);neighborhoodCount+=1.;`);
 replace('history.color=vec4f(clamp(history.color.rgb,low,high),history.color.w);', `// A raw one-sample min/max clips rare indirect contributions to black.
  // For validated diffuse history, reject statistically incompatible lighting
  // instead. Reflections, transmission and partial coverage retain the old clamp.
  var consistent=false;
  if(stableDiffuse&&diffuseCoverage>.98&&p.normal.w>.55&&neighborhoodCount>0.){
   let m=neighborhoodMoments/neighborhoodCount;
   let sampleVariance=max(0.,m.y-m.x*m.x);
   let historyVariance=max(0.,history.moments.y-history.moments.x*history.moments.x);
   let uncertainty=sqrt(sampleVariance/neighborhoodCount+historyVariance/max(history.color.w,1.));
   consistent=abs(dot(history.color.rgb,vec3f(.2126,.7152,.0722))-m.x)<=3.*uncertainty+.005;
  }
  if(!consistent){history.color=vec4f(clamp(history.color.rgb,low,high),history.color.w);diffuseCoverage=0.;}`);
 replace('var cap=7.;', `var cap=7.;
  // Only fully covered rough diffuse surfaces can build a longer history.
  // The existing normal/material/plane/footprint tests still reject disocclusion.
  if(stableDiffuse&&diffuseCoverage>.98&&p.normal.w>.55){cap=31.;}`);
 return source;
}
