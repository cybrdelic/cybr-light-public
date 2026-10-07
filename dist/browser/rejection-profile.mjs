export const rejectionReasons={1:'noHistory',2:'reference',4:'projectionIneligible',8:'outsideViewport',16:'primaryIdentity',32:'primaryGeometry',64:'opticalEndpoint',128:'opticalNormal',256:'opticalView',512:'missingOpticalGuide',1024:'solverOutside',2048:'solverDiscontinuity',4096:'solverSingular',8192:'solverTravel',16384:'solverSupport'};
// Instrument actual decisions. Flags describe failed candidates, NOT proof of
// occlusion. A fallback may still accept history; final weight disambiguates.
export function rejectionProfile(source,separate){
 source=source.replaceAll('\r\n','\n');
 const edit=(a,b)=>{if(!source.includes(a))throw Error('Rejection profile contract: '+a.slice(0,60));source=source.replace(a,b);};
 edit('@compute @workgroup_size(8,8)', '@group(0) @binding(5) var<storage,read_write> rejection:array<vec4f>;\n@compute @workgroup_size(8,8)');
 edit('var valid=u.size.z>0u;', 'var valid=u.size.z>0u;var rejectMask=0u;if(!valid){rejectMask|=1u;}if(u.flags.y>.5){rejectMask|=2u;}if(p.moments.w==-1.&&p.secondaryNormal.w<.5){rejectMask|=512u;}');
 edit(' if(valid&&all(previousXY', ' if(!valid){rejectMask|=4u;}if(any(previousXY<vec2i(0))||any(previousXY>=vec2i(u.size.xy))){rejectMask|=8u;}\n if(valid&&all(previousXY');
 edit('  if(transmitted&&moving){', '  if(abs(old.position.w-p.position.w)>.1){rejectMask|=16u;}if(!compatible){rejectMask|=32u;}\n  if(transmitted&&moving){');
 edit('   compatible=compatible&&old.secondaryNormal.w>.5',`   if(old.secondaryNormal.w<.5){rejectMask|=512u;}
   if(abs(old.secondary.w-p.secondary.w)>.1||distance(old.secondary.xyz,p.secondary.xyz)>=max(.003,footprint*2.)){rejectMask|=64u;}
   if(dot(old.secondaryNormal.xyz,p.secondaryNormal.xyz)<=.98||dot(old.normal.xyz,p.normal.xyz)<=.999){rejectMask|=128u;}
   if(distance(view,oldView)>=.008){rejectMask|=256u;}
   compatible=compatible&&old.secondaryNormal.w>.5`);
 if(separate){
  edit('usable=false;break;}\n   let c=secondaryAt', 'rejectMask|=1024u;usable=false;break;}\n   let c=secondaryAt');
  edit('if(!sameSecondary(p,c)||!sameSecondary(c,x)||!sameSecondary(c,y)){usable=false;', 'if(!sameSecondary(p,c)||!sameSecondary(c,x)||!sameSecondary(c,y)){rejectMask|=2048u;usable=false;');
  edit('if(det<1e-16){usable=false;', 'if(det<1e-16){rejectMask|=4096u;usable=false;');
  const travel=source.includes('if(distance(pixel,start)>24.)')?'24.':'8.';
  edit(`if(distance(pixel,start)>${travel}){usable=false;`, `if(distance(pixel,start)>${travel}){rejectMask|=8192u;usable=false;`);
  edit('   if(total>.8){history.color', '   if(total<=.8){rejectMask|=16384u;}\n   if(total>.8){history.color');
 }
 edit(' var result=p.color.rgb;', ' let unclampedHistory=history.color.rgb;\n var result=p.color.rgb;');
 const at=separate?' color[outIndex]=':'color[i]=';
 edit(at,`rejection[${separate?'outIndex':'i'}]=vec4f(f32(rejectMask),weight,length(history.color.rgb-unclampedHistory),select(select(select(0.,1.,p.moments.w>.5||p.moments.w==-2.),2.,${separate?'p.normal.w==0.':'p.moments.w==-1.'}),3.,p.position.w==-1.));${at}`);
 return source;
}
export function summarizeRejection(data,count,channels){
 if(data.length!==count*channels*4)throw Error('Rejection ABI mismatch');
 const result=[];
 for(let c=0;c<channels;c++){
  const groups={};
  for(let i=0;i<count;i++){
   const o=(c*count+i)*4,mask=data[o],weight=data[o+1],delta=data[o+2],kind=['diffuse','reflection','glass','sky'][data[o+3]]||'other';
   const g=groups[kind]??={pixels:0,fresh:0,meanWeight:0,clamped:0,rejectedReasons:{},candidateReasons:{}};
   g.pixels++;g.meanWeight+=weight;if(delta>1e-6)g.clamped++;if(weight<=0)g.fresh++;
   for(const [bit,name] of Object.entries(rejectionReasons))if(mask&Number(bit)){g.candidateReasons[name]=(g.candidateReasons[name]||0)+1;if(weight<=0)g.rejectedReasons[name]=(g.rejectedReasons[name]||0)+1;}
  }
  for(const g of Object.values(groups)){g.meanWeight/=g.pixels;g.freshFraction=g.fresh/g.pixels;}
  result.push({channel:c,groups});
 }
 return result;
}
