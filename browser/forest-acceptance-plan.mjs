// CPU acceptance policy; no browser/GPU initialization or renderer changes.
import {cameraBasis} from './hybrid-geometry.mjs';
import {rotate,selectHierarchyLod,sphereVisible} from './meshlet-hierarchy.mjs';
import {transformSphereF32,sphereVisibleF32} from './forest-acceptance-f32.mjs';
export const ACCEPTANCE_POLICY=Object.freeze({version:3,maxPairs:80,maxProbes:256,maxFullDetailTriangles:600000000,near:.05,depthRelativeTolerance:2**-20,maximumRuntimeMs:150000,outerSlotMs:180000});
const dot=(a,b)=>a.reduce((sum,x,k)=>sum+x*b[k],0);
export function poseForView(view){const d=view.position.map((x,k)=>x-view.target[k]),distance=Math.hypot(...d);return {target:[...view.target],distance,yaw:Math.atan2(d[0],d[2]),pitch:Math.asin(d[1]/distance)};}
export function triangleIntersects(points,camera){
 let polygon=points.map(p=>p.map((x,k)=>x-camera.eye[k]));
 const tx=camera.tan*camera.aspect,planes=[p=>dot(p,camera.forward)-ACCEPTANCE_POLICY.near,p=>dot(p,camera.forward)*tx-dot(p,camera.right),p=>dot(p,camera.forward)*tx+dot(p,camera.right),p=>dot(p,camera.forward)*camera.tan-dot(p,camera.up),p=>dot(p,camera.forward)*camera.tan+dot(p,camera.up)];
 for(const plane of planes){const next=[];for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length],fa=plane(a),fb=plane(b);if(fa>=0)next.push(a);if((fa<0)!==(fb<0)){const t=fa/(fa-fb);next.push(a.map((x,k)=>x+(b[k]-x)*t));}}polygon=next;if(!polygon.length)return false;}
 return true;
}
export function prepareAcceptanceInputs(data,plan){
 const values=new Float32Array(data.instances),words=new Uint32Array(data.instances),modelIds=new Uint16Array(data.count),errors=new Float32Array(plan.models),clustered=new Set(plan.records.filter(r=>r.clustered).map(r=>r.model));
 const fallbackDraws=new Int32Array(data.batches.length*4).fill(-1),fallbackSpheres=new Float32Array(data.batches.length*16),nodeFloats=new Float32Array(plan.nodes),modelWords=new Uint32Array(plan.models);
 plan.records.forEach((record,draw)=>{if(!record.clustered){const key=record.model*4+record.level,root=modelWords[record.model*8+record.level];fallbackDraws[key]=draw;fallbackSpheres.set(nodeFloats.subarray(root*8,root*8+4),key*4);}});
 const views=Object.entries(data.views),bases=views.map(([name,view])=>({name,pose:poseForView(view),basis:cameraBasis(poseForView(view))})),best=bases.map(()=>new Map()),fullTriangles=bases.map(()=>0);
 for(let i=0;i<data.count;i++){
  const o=i*12,model=words[o+8];modelIds[i]=model;
  for(let v=0;v<bases.length;v++){
   const camera=bases[v].basis,relative=[0,1,2].map(k=>values[o+k]-camera.eye[k]),z=dot(relative,camera.forward),radius=values[o+10],tx=camera.tan*960/540;
   if(z+radius<.05||Math.abs(dot(relative,camera.right))>z*tx+radius*Math.sqrt(1+tx*tx)||Math.abs(dot(relative,camera.up))>z*camera.tan+radius*Math.sqrt(1+camera.tan**2))continue;
   fullTriangles[v]+=data.batches[model].levels[0].indices.byteLength/12;
   let score=Infinity,level=1;
   for(let k=1;k<4;k++){const pixels=errors[model*8+4+k]*Math.abs(values[o+3])*270/(Math.max(z-radius,.05)*camera.tan),distance=Math.abs(pixels-.75);if(pixels>0&&distance<score){score=distance;level=k;}}
   if(Number.isFinite(score)&&(!best[v].has(model)||score<best[v].get(model).score))best[v].set(model,{id:i,model,score,level,clustered:clustered.has(model)});
  }
 }
 const selected=new Map(),targets=[],cases=[];
 bases.forEach((base,v)=>{
  const ranked=[...best[v].values()].sort((a,b)=>a.score-b.score||a.id-b.id),chosen=[...ranked.filter(x=>x.clustered).slice(0,16),...ranked.filter(x=>!x.clustered).slice(0,24)];
  chosen.forEach(x=>selected.set(x.id,x));
  const camera=cameraBasis(base.pose),target=chosen.map(candidate=>{
   const o=candidate.id*12,relative=[0,1,2].map(k=>values[o+k]-base.pose.target[k]),offset=dot(relative,camera.forward),term=errors[candidate.model*8+4+candidate.level]*Math.abs(values[o+3])*270/camera.tan;
   const promote=values[o+10]+term/.75-offset,demote=values[o+10]+term/(.75*.9)-offset;
   return {...candidate,promoteDistance:promote,demoteDistance:demote};
  }).find(x=>x.clustered&&x.promoteDistance>base.pose.distance*.5&&x.demoteDistance<base.pose.distance*2);
  targets.push({view:base.name,target:target??null});
  const add=(kind,pose,lodPixels=.75,resetHistory=false)=>cases.push({index:cases.length,view:base.name,kind,pose,lodPixels,resetHistory,targetId:target?.id??null});
  if(fullTriangles[v]<=ACCEPTANCE_POLICY.maxFullDetailTriangles)add('full-detail',base.pose,0,true);add('start',base.pose,.75,true);
  for(const yaw of [-.035,0,.035])add('frustum-pan',{...base.pose,yaw:base.pose.yaw+yaw});
  if(target){
   for(const [kind,distance] of [['before-promote',target.promoteDistance*.98],['inside-band',target.promoteDistance*1.02],['outbound-mid-band',(target.promoteDistance+target.demoteDistance)/2],['after-demote',target.demoteDistance*1.02],['hold-coarse',target.demoteDistance*1.02],['return-band',target.demoteDistance*.98],['inbound-mid-band',(target.promoteDistance+target.demoteDistance)/2],['after-promote',target.promoteDistance*.98],['hold-fine',target.promoteDistance*.98]])add(kind,{...base.pose,distance});
  }else for(const distance of [.8,1,1.2,1,.8])add('zoom',{...base.pose,distance:base.pose.distance*distance});
  add('hold-base',base.pose);add('hold-base',base.pose);
 });
 if(cases.length>ACCEPTANCE_POLICY.maxPairs||selected.size>ACCEPTANCE_POLICY.maxProbes)throw Error('Acceptance case/probe budget exceeded');
 const triangles=new Map(),probes=[...selected.values()].map(candidate=>{
  const o=candidate.id*12;
  if(!triangles.has(candidate.model))triangles.set(candidate.model,data.batches[candidate.model].levels.map(lod=>{
   const vertices=new Float32Array(lod.vertices),vw=new Uint32Array(lod.vertices),indices=new Uint32Array(lod.indices),result=[];
   for(let n=0;n<Math.min(8,indices.length/3);n++){const at=Math.floor(n*Math.max(0,indices.length/3-1)/Math.max(1,Math.min(8,indices.length/3)-1))*3,ix=Array.from(indices.subarray(at,at+3));result.push({mask:vw[ix[0]*10+9],points:ix.map(index=>Array.from(vertices.subarray(index*10,index*10+3)))});}
   return result;
  }));
  return {...candidate,position:Array.from(values.subarray(o,o+3)),scale:values[o+3],rotation:Array.from(values.subarray(o+4,o+8)),radius:values[o+10],leafMask:words[o+9],errors:Array.from(errors.subarray(candidate.model*8+4,candidate.model*8+8)),triangles:triangles.get(candidate.model)};
 });
 return {modelIds,instanceTransforms:values,fallbackDraws,fallbackSpheres,records:plan.records,drawWords:new Uint32Array(plan.draw),probes,manifest:{policy:ACCEPTANCE_POLICY,cases,targets,fullDetailBudget:bases.map((b,i)=>({view:b.name,triangles:fullTriangles[i],included:fullTriangles[i]<=ACCEPTANCE_POLICY.maxFullDetailTriangles})),probeIds:probes.map(p=>p.id),instanceCount:data.count,clusteredModels:plan.metrics.clusteredModels,fallbackModels:plan.metrics.fallbackModels,drawGroupSize:plan.metrics.drawGroupSize,coverage:'four-sample depth/color against complete selected model LODs; sampled independent root triangle clipping'}};
}
export function auditLodState(states,previous,input,camera){
 if(states.length!==input.modelIds.length||(previous&&previous.length!==states.length))throw Error('Acceptance history length mismatch');
 const populations=new Uint32Array((Math.max(...input.records.map(r=>r.model))+1)*4),levels=[0,0,0,0];let visible=0,changed=0,demoted=0,promoted=0,historyErrors=0;
 for(let i=0;i<states.length;i++){
  const before=states[i]&3,after=(states[i]>>>2)&3;
  if(before!==(previous?((previous[i]>>>2)&3):0))historyErrors++;
  if(states[i]&16){visible++;levels[after]++;populations[input.modelIds[i]*4+after]++;if(before!==after){changed++;if(after>before)demoted++;else promoted++;}}
  else if(before!==after)historyErrors++;
 }
 let selectorErrors=0,rootWitnessErrors=0,clippedWitnesses=0;
 for(const probe of input.probes){
  const packed=states[probe.id],before=packed&3,after=(packed>>>2)&3;
  if(packed&16){const z=dot(probe.position.map((x,k)=>x-camera.eye[k]),camera.forward),expected=selectHierarchyLod(probe.errors,probe.scale,z,probe.radius,camera,before);if(after!==expected)selectorErrors++;}
  for(const triangle of probe.triangles[after]){
   if(triangle.mask&&(triangle.mask&probe.leafMask)===0)continue;
   const world=triangle.points.map(p=>rotate(probe.rotation,p.map(x=>x*probe.scale)).map((x,k)=>x+probe.position[k]));
   if(triangleIntersects(world,camera)){clippedWitnesses++;if(!(packed&16))rootWitnessErrors++;}
  }
 }
 return {populations,visible,levels,changed,demoted,promoted,historyErrors,selectorErrors,rootWitnessErrors,clippedWitnesses};
}
export function predictFallbackCounts(states,input,camera){
 if(states.length!==input.modelIds.length||input.instanceTransforms.length!==states.length*12)throw Error('Fallback transform/state layout mismatch');
 const expected=new Uint32Array(input.records.length),values=input.instanceTransforms;
 for(let i=0;i<states.length;i++){
  if(!(states[i]&16))continue;const key=input.modelIds[i]*4+((states[i]>>>2)&3),draw=input.fallbackDraws[key];if(draw<0)continue;
  const o=i*12,n=key*4,sphere=transformSphereF32(Array.from(input.fallbackSpheres.subarray(n,n+4)),values,o);
  if(sphereVisibleF32(sphere,camera))expected[draw]++;
 }
 return expected;
}
export function auditDrawCounts(normal,reference,input,populations,fallbackCounts){
 if(input.records.some(r=>!r.clustered)&&(!fallbackCounts||fallbackCounts.length!==input.records.length))throw Error('Explicit selected-LOD fallback expectations required');
 let overflow=0,referenceErrors=0,fallbackErrors=0,normalTriangles=0,referenceTriangles=0;
 input.records.forEach((record,i)=>{const capacity=input.drawWords[i*8+6],expected=populations[record.model*4+record.level],a=normal[i*8+1],b=reference[i*8+1];if(a>capacity||b>capacity||a>expected)overflow++;if(b!==expected)referenceErrors++;if(!record.clustered&&a!==fallbackCounts[i])fallbackErrors++;normalTriangles+=a*normal[i*8]/3;referenceTriangles+=b*reference[i*8]/3;});
 return {overflow,referenceErrors,fallbackErrors,normalTriangles,referenceTriangles};
}
export function compareCoverage(a,b,{depthRelativeTolerance=ACCEPTANCE_POLICY.depthRelativeTolerance}={}){
 if(a.color.length!==b.color.length||a.depth.length!==b.depth.length||a.depth.length!==a.color.length)throw Error('Acceptance image layout mismatch');
 let changedPixels=0,maxChannelDifference=0,missingSamples=0,closerReferenceSamples=0,unexpectedCloserSamples=0,nonfiniteDepth=0,normalCoveredSamples=0,referenceCoveredSamples=0;
 for(let i=0;i<a.color.length;i+=4){let changed=false;for(let k=0;k<3;k++){const difference=Math.abs(a.color[i+k]-b.color[i+k]);changed||=difference>0;maxChannelDifference=Math.max(maxChannelDifference,difference);}if(changed)changedPixels++;}
 for(let i=0;i<a.depth.length;i++){const x=a.depth[i],y=b.depth[i];if(!Number.isFinite(x)||!Number.isFinite(y)){nonfiniteDepth++;continue;}if(x>0)normalCoveredSamples++;if(y>0)referenceCoveredSamples++;const tolerance=depthRelativeTolerance*Math.max(Math.abs(x),Math.abs(y),1e-12);if(y>0&&x===0)missingSamples++;if(y>x+tolerance)closerReferenceSamples++;if(x>y+tolerance)unexpectedCloserSamples++;}
 return {changedPixels,maxChannelDifference,normalCoveredSamples,referenceCoveredSamples,missingSamples,closerReferenceSamples,unexpectedCloserSamples,nonfiniteDepth,geometryPassed:referenceCoveredSamples>0&&missingSamples+closerReferenceSamples+unexpectedCloserSamples+nonfiniteDepth===0,imageExact:changedPixels===0};
}
