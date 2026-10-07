// Experimental separated-lighting + presentation-coverage reconstruction.
// The coverage pass operates after demodulated lighting has been reconstructed.
export const coverageJitter=`
fn coverageJitter(frame:u32)->vec2f{
 var n=(frame%1024u)+1u;var x=0.;var scale=.5;
 for(var k=0u;k<11u;k++){x+=f32(n%2u)*scale;n/=2u;scale*=.5;}
 n=(frame%1024u)+1u;var y=0.;scale=1./3.;
 for(var k=0u;k<7u;k++){y+=f32(n%3u)*scale;n/=3u;scale/=3.;}
 return vec2f(x,y);
}`;

export function coverageShader(name,source,separate=true){
 source=source.replaceAll('\r\n','\n');
 const replace=(a,b)=>{if(!source.includes(a))throw Error(`Coverage contract changed: ${name}: ${a.slice(0,64)}`);source=source.replace(a,b);};
 if(name==='trace'||name==='trace-pile'){
  replace('let pathDirection=camera(vec2f(gid.xy)+vec2f(random(&seed),random(&seed)));',
   'let randomJitter=vec2f(random(&seed),random(&seed));let jitter=select(coverageJitter(u.size.z),randomJitter,u.flags.y>.5);let pathDirection=camera(vec2f(gid.xy)+jitter);');
  if(separate)replace('var startDepth=0u;',`
 // Motion is derived from the ideal reflected guide, never a random GGX ray.
 if(guide.id>=0){let gm=material(guide);if(gm.physical.x>.99&&gm.physical.y<.5&&gm.base.w<.3){
  var gn=geometric(guide);if(dot(gn,guideDirection)>0.){gn=-gn;}
  var n=normal(guide);if(dot(n,gn)<0.){n=-n;}
  var rd=reflect(guideDirection,n);if(dot(rd,gn)<=0.){rd=reflect(guideDirection,gn);}
  let o=guidePos.xyz+gn*.0001;let reflected=trace(o,rd,1e20,false);
  reflectionDistance=min(min(reflected.t,lightHit(o,rd)),50.);reflectionGuide=1.;
 }}
 var startDepth=0u;`);
  if(separate){
   replace('if(bounce==1u&&trackReflection){','if(false&&bounce==1u&&trackReflection){');
   replace('modulation[index]=vec4f(demod,1);','var glassBoundary=0.;if(guide.id>=0){glassBoundary=select(0.,1.,material(guide).physical.y>.5);}\n modulation[index]=vec4f(demod,glassBoundary);');
  }
 }else if(name==='reconstruct'){
  // Lighting history uses the preceding jittered sample grid. Presentation
  // history is unjittered and has its own projection in coverage-resolve.wgsl.
  source=source.replaceAll('*vec2f(u.size.xy)-.5','*vec2f(u.size.xy)-coverageJitter(u.size.z-1u)');
  source=source.replaceAll('floor((ndc*.5+.5)*vec2f(u.size.xy))','floor((ndc*.5+.5)*vec2f(u.size.xy)-coverageJitter(u.size.z-1u)+.5)');
  if(separate)replace('var result=p.color.rgb;','if(u.flags.y>.5&&!moving&&u.size.z>0u){history=readSignal(previous[i],channel);}\n var result=p.color.rgb;');
 }
 return coverageJitter+'\n'+source;
}
