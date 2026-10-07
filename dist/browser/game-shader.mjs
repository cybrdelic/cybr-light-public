// Extend the established three-lobe shader ABI without forking its transport.
// Exact replacements fail closed when the upstream shader contract changes.
import {lightReservoirShader} from './light-reservoir.mjs';
export function gameShader(name,source,{lightCandidates=1}={}){
 source=source.replaceAll('\r\n','\n');
 const replace=(from,to)=>{if(!source.includes(from))throw Error(`Game shader contract changed: ${name}: ${from.slice(0,60)}`);source=source.replace(from,to);};
 if(name!=='display'){
  replace('secondary:vec4f,secondaryNormal:vec4f\n}', 'secondary:vec4f,secondaryNormal:vec4f,indirect:vec4f,indirectMoments:vec4f\n}');
  replace('return Pixel(c,s.position', 'if(channel==3u){c=s.indirect;m=s.indirectMoments;}\n return Pixel(c,s.position');
 }
 if(name==='trace'||name==='trace-pile'){
  replace('return 2.*distance*distance/max(abs(dot(d,areaVector))*lighting.info.y,1e-20);','return 2.*distance*distance*light.e1.w/max(abs(dot(d,areaVector)),1e-20);');
  replace('fn sourceLightPDF(', 'fn sampleSourceLight(r:f32,count:u32)->u32{var lo=0u;var hi=count-1u;loop{if(lo>=hi){break;}let mid=(lo+hi)/2u;if(r<lighting.lights[mid].p.w){hi=mid;}else{lo=mid+1u;}}return lo;}\nfn sourceLightPDF(');
  replace('min(u32(random(&seed)*f32(count)),count-1u)','sampleSourceLight(random(&seed),count)');
  replace('var<private> radianceD:vec3f;','var<private> radianceD:vec3f;\nvar<private> radianceI:vec3f;\nvar<private> firstSegment:bool;');
  replace('fn accumulate(value:vec3f){radianceD+=value*weightD;','fn accumulate(value:vec3f){radianceI+=value*weightD;');
  replace('fn accumulateSurface(', 'fn accumulateEmitter(value:vec3f){if(firstSegment){radianceD+=value*weightD;}else{radianceI+=value*weightD;}radianceS+=value*weightS;radianceT+=value*weightT;}\nfn accumulateSurface(');
  replace('for(var bounce=startDepth;bounce<min(u.size.w,16u);bounce++){','for(var bounce=startDepth;bounce<min(u.size.w,16u);bounce++){\n firstSegment=bounce<=1u;');
  source=source.replaceAll('accumulate(throughput*','accumulateEmitter(throughput*');
  replace('let combined=radianceD+radianceS+radianceT;','let combined=radianceD+radianceI+radianceS+radianceT;');
  replace('var d=radianceD/demod;', 'var indirect=radianceI/demod;var d=radianceD/demod;');
  replace('if(u.features.x<.5){d=vec3f(0);','if(u.features.x<.5){indirect=vec3f(0);d=vec3f(0);');
  replace('let dl=dot(d,luma);','let il=dot(indirect,luma);let dl=dot(d,luma);');
  replace('secondary,secondaryNormal);','secondary,secondaryNormal,vec4f(indirect,1),vec4f(il,il*il,0,0));');
  if(lightCandidates!==1){
   const start=source.indexOf('    if(count>0u){let light=lighting.lights[');
   const end=source.indexOf('\n    }\n   }else if',start);
   if(start<0||end<0)throw Error('Direct-light reservoir shader contract changed');
   source=source.slice(0,start)+'    let estimate=reservoirDirect(point,n,geometricNormal,wo,color,metal,alpha,m.physical.w,&seed);\n    accumulateSurface(throughput*estimate.value,estimate.fraction,bounce==0u);'+source.slice(end+6);
   source=lightReservoirShader(lightCandidates)+'\n'+source;
  }
 }else if(name==='reconstruct'){
  replace('color[outIndex]=', 'if(channel==3u){output[i].indirect=vec4f(result,weight+1.);output[i].indirectMoments=vec4f(moments,p.moments.zw);}\n color[outIndex]=');
 }else if(name==='display'){
  replace('pixels[i].rgb*modulation[i].rgb','(pixels[i].rgb+pixels[i+3u*count].rgb)*modulation[i].rgb');
 }
 return source;
}
