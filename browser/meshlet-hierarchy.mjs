// Raster-only cluster hierarchy. Original vertex words and triangle winding stay exact.
export const MESHLET_BUILD = Object.freeze({version:1,algorithm:'morton-greedy-64v-64t',maxVertices:64,maxTriangles:64,fanout:8});
const INVALID=0xffffffff;
const inflate=(center,radius)=>{
 const rounded=center.map(Math.fround),rounding=Math.hypot(...center.map((x,k)=>x-rounded[k]));
 return [...rounded,Math.fround(radius+rounding+Math.max(1,...center.map(Math.abs),radius)*2e-6)];
};
function sphereForIndices(vertices,indices){
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(const index of indices)for(let k=0;k<3;k++){const x=vertices[index*10+k];lo[k]=Math.min(lo[k],x);hi[k]=Math.max(hi[k],x);}
 if(!indices.length)return [0,0,0,0];
 const center=lo.map((x,k)=>(x+hi[k])/2);
 return inflate(center,Math.hypot(...hi.map((x,k)=>(x-lo[k])/2)));
}
function mergeSpheres(children){
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(const {sphere:s} of children)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],s[k]-s[3]);hi[k]=Math.max(hi[k],s[k]+s[3]);}
 return inflate(lo.map((x,k)=>(x+hi[k])/2),Math.hypot(...hi.map((x,k)=>(x-lo[k])/2)));
}
function morton(x,y,z){
 const spread=v=>{v&=1023;v=(v|(v<<16))&0x030000ff;v=(v|(v<<8))&0x0300f00f;v=(v|(v<<4))&0x030c30c3;return (v|(v<<2))&0x09249249;};
 return (spread(x)|(spread(y)<<1)|(spread(z)<<2))>>>0;
}
function clusterHierarchy(clusters,fanout=8){
 let layer=clusters.map((c,draw)=>({...c,draw}));
 while(layer.length>1){const parents=[];for(let i=0;i<layer.length;i+=fanout){const children=layer.slice(i,i+fanout);parents.push({sphere:mergeSpheres(children),children});}layer=parents;}
 const nodes=[];
 const visit=n=>{const at=nodes.length;nodes.push({sphere:n.sphere,draw:n.draw??INVALID,escape:0});if(n.children)for(const child of n.children)visit(child);nodes[at].escape=nodes.length;};
 if(layer.length)visit(layer[0]);return nodes;
}
export function groupMeshletDraws(partition,size=8){
 if(!Number.isInteger(size)||size<1||size>16)throw Error('Invalid meshlet draw group');
 const clusters=[];
 for(let i=0;i<partition.clusters.length;i+=size){const children=partition.clusters.slice(i,i+size);clusters.push({firstIndex:children[0].firstIndex,indexCount:children.reduce((n,c)=>n+c.indexCount,0),sphere:mergeSpheres(children),fineMeshlets:children.length});}
 return {clusters,nodes:clusterHierarchy(clusters)};
}
export function partitionMeshlets(vertices,indices,{maxVertices=64,maxTriangles=64,fanout=8}={}){
 if(!(vertices instanceof Float32Array)||vertices.length%10||!(indices instanceof Uint32Array)||indices.length%3||!Number.isInteger(maxVertices)||maxVertices<3||maxVertices>256||!Number.isInteger(maxTriangles)||maxTriangles<1||maxTriangles>512||!Number.isInteger(fanout)||fanout<2||fanout>16)throw Error('Invalid meshlet layout or limits');
 const count=vertices.length/10,words=new Uint32Array(vertices.buffer,vertices.byteOffset,vertices.length);
 for(const index of indices){if(index>=count)throw Error('Meshlet index outside vertex buffer');for(let k=0;k<3;k++)if(!Number.isFinite(vertices[index*10+k]))throw Error('Non-finite meshlet position');}
 const sphere=sphereForIndices(vertices,indices),lo=sphere.slice(0,3).map(x=>x-sphere[3]),extent=Math.max(sphere[3]*2,1e-20);
 const triangles=[];
 for(let t=0;t<indices.length;t+=3){const tri=indices.subarray(t,t+3),p=[0,0,0];for(const index of tri)for(let k=0;k<3;k++)p[k]+=vertices[index*10+k]/3;
  const q=p.map((x,k)=>Math.max(0,Math.min(1023,Math.floor((x-lo[k])/extent*1023))));
  triangles.push({ordinal:t,code:morton(...q),mask:words[tri[0]*10+9]});
 }
 triangles.sort((a,b)=>a.mask-b.mask||a.code-b.code||a.ordinal-b.ordinal);
 const reordered=new Uint32Array(indices.length),clusters=[];let cursor=0,begin=0,unique=new Set(),mask;
 const flush=()=>{if(cursor===begin)return;const part=reordered.subarray(begin,cursor);clusters.push({firstIndex:begin,indexCount:cursor-begin,vertexCount:unique.size,sphere:sphereForIndices(vertices,part),mask});begin=cursor;unique=new Set();};
 for(const triangle of triangles){const tri=indices.subarray(triangle.ordinal,triangle.ordinal+3),extra=new Set([...tri].filter(x=>!unique.has(x))).size;
  if(cursor>begin&&((cursor-begin)/3>=maxTriangles||unique.size+extra>maxVertices||mask!==triangle.mask))flush();
  mask=triangle.mask;reordered.set(tri,cursor);cursor+=3;for(const index of tri)unique.add(index);
 }flush();
 const nodes=clusterHierarchy(clusters,fanout);
 return {indices:reordered,clusters,nodes,root:nodes.length?0:INVALID,bytes:{indices:reordered.byteLength,nodes:nodes.length*32},triangles:indices.length/3};
}

// Stable budget decisions depend only on geometry/counts/options, never elapsed time.
export function buildForestClusterPlan(batches,counts,{maxVisibleBytes=64*1024*1024,maxDraws=8192,maxNodesBytes=16*1024*1024,drawGroupSize=1}={}){
 if(batches.length!==counts.length)throw Error('Meshlet model/count mismatch');
 const prepared=batches.map(b=>b.levels.map(l=>partitionMeshlets(new Float32Array(l.vertices),new Uint32Array(l.indices))));
 if(counts.some(c=>!Number.isInteger(c)||c<0)||Object.values({maxVisibleBytes,maxDraws,maxNodesBytes}).some(c=>!Number.isSafeInteger(c)||c<0))throw Error('Invalid meshlet budget/count');
 if(!Number.isInteger(drawGroupSize)||drawGroupSize<1||drawGroupSize>16)throw Error('Invalid meshlet draw group');
 let visibleWords=counts.reduce((n,c)=>n+c*4,0),drawCount=batches.length*4,nodeBytes=batches.length*4*32;
 const enabled=new Set(),candidates=prepared.map((levels,model)=>{
  const draws=levels.reduce((n,l)=>n+l.clusters.length,0),nodes=levels.reduce((n,l)=>n+l.nodes.length,0),extra=Math.max(0,draws-4);
  // Prefer large repeated geometry: tiny repeated litter gains little from splitting.
  const priority=batches[model].radius*counts[model]*levels[0].triangles/(1+extra+extra*counts[model]/4096);
  return {model,draws,nodes,priority};
 });
 candidates.sort((a,b)=>b.priority-a.priority||a.model-b.model);
 for(const c of candidates){const extraDraws=c.draws-4,extraWords=extraDraws*counts[c.model];
  const extraNodes=c.nodes-4;
  if(extraDraws>0&&drawCount+extraDraws<=maxDraws&&(visibleWords+extraWords)*4<=maxVisibleBytes&&nodeBytes+extraNodes*32<=maxNodesBytes){enabled.add(c.model);drawCount+=extraDraws;visibleWords+=extraWords;nodeBytes+=extraNodes*32;}
 }
 const draws=[],records=[],nodes=[],modelWords=new Uint32Array(batches.length*8),modelFloats=new Float32Array(modelWords.buffer);let start=0;
 batches.forEach((b,model)=>{
  let cumulativeError=0;
  b.levels.forEach((lod,level)=>{
   cumulativeError=Math.max(cumulativeError,lod.error);modelFloats[model*8+4+level]=cumulativeError;
   const partition=prepared[model][level],base=nodes.length;
   modelWords[model*8+level]=base;
   const clustered=enabled.has(model),leafDraws=[],submission=clustered&&drawGroupSize>1?groupMeshletDraws(partition,drawGroupSize):partition;
   const pieces=clustered?submission.clusters:[{firstIndex:0,indexCount:lod.indices.byteLength/4,sphere:partition.nodes[0]?.sphere??[0,0,0,0]}];
   if(clustered)lod.indices=partition.indices.buffer;
   for(const piece of pieces){const draw=draws.length/8;leafDraws.push(draw);draws.push(piece.indexCount,0,piece.firstIndex,0,0,start,counts[model],0);records.push({model,level,firstIndex:piece.firstIndex,indexCount:piece.indexCount,clustered});start+=counts[model];}
   if(clustered)for(const n of submission.nodes)nodes.push({sphere:n.sphere,draw:n.draw===INVALID?INVALID:leafDraws[n.draw],escape:base+n.escape});
   else nodes.push({sphere:pieces[0].sphere,draw:leafDraws[0],escape:base+1});
  });
 });
 const nodeWords=new Uint32Array(nodes.length*8),nodeFloats=new Float32Array(nodeWords.buffer);
 nodes.forEach((n,i)=>{nodeFloats.set(n.sphere,i*8);nodeWords.set([n.draw,n.escape,0,0],i*8+4);});
 return {draw:new Uint32Array(draws).buffer,nodes:nodeWords.buffer,models:modelWords.buffer,records,visibleBytes:start*4,metrics:{build:MESHLET_BUILD,drawGroupSize,admission:'fine meshlet budgets retained to keep the model set fixed across grouping comparisons',fineMeshlets:[...enabled].reduce((n,m)=>n+prepared[m].reduce((n,l)=>n+l.clusters.length,0),0),clusteredModels:enabled.size,fallbackModels:batches.length-enabled.size,draws:records.length,nodes:nodes.length,visibleBytes:start*4,nodeBytes:nodeWords.byteLength,modelBytes:modelWords.byteLength,indirectBytes:draws.length*4,drawParameterBytes:records.length*16,instanceBytes:counts.reduce((n,c)=>n+c*48,0),counterBytes:16,geometryBytes:batches.reduce((n,b)=>n+b.levels.reduce((n,l)=>n+l.vertices.byteLength+l.indices.byteLength,0),0),trianglesByLevel:[0,1,2,3].map(k=>batches.reduce((n,b)=>n+b.levels[k].indices.byteLength/12,0)),limits:{maxVisibleBytes,maxDraws,maxNodesBytes},streaming:'resident-only; page residency is a future stage'}};
}
export function rotate(q,v){const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],a=cross(q,v),b=cross(q,a);return v.map((x,k)=>x+2*(b[k]+q[3]*a[k]));}
export function sphereVisible(sphere,camera){
 const d=sphere.slice(0,3).map((x,k)=>x-camera.eye[k]),dot=(a,b)=>a.reduce((n,x,k)=>n+x*b[k],0),z=dot(d,camera.forward),x=dot(d,camera.right),y=dot(d,camera.up),r=sphere[3]+Math.max(1,...sphere.slice(0,3).map(Math.abs),...camera.eye.map(Math.abs))*2e-6,ty=camera.tan,tx=ty*camera.aspect;
 return !(z+r<.05||Math.abs(x)>z*tx+r*Math.sqrt(1+tx*tx)||Math.abs(y)>z*ty+r*Math.sqrt(1+ty*ty));
}
export function selectHierarchyLod(errors,scale,z,radius,camera,previous=0){
 let level=0;if(camera.lodPixels>0)for(let k=1;k<4;k++){const pixels=errors[k]*Math.abs(scale)*270/(Math.max(z-radius,.05)*camera.tan),limit=camera.lodPixels*(k>previous?0.9:1);if(pixels<=limit)level=k;}return level;
}
export function cullHierarchyCpu(plan,instances,camera,previous=new Uint32Array(instances.length/12)){
 const iw=new Uint32Array(instances.buffer,instances.byteOffset,instances.length),models=new Uint32Array(plan.models),errors=new Float32Array(plan.models),nw=new Uint32Array(plan.nodes),nf=new Float32Array(plan.nodes),draw=new Uint32Array(plan.draw),visible=Array.from(plan.records,()=>[]),next=previous.slice();let tested=0,rejected=0;
 for(let instance=0;instance<previous.length;instance++){const o=instance*12,p=Array.from(instances.subarray(o,o+3)),scale=instances[o+3],q=Array.from(instances.subarray(o+4,o+8)),radius=instances[o+10],model=iw[o+8];
  if(!sphereVisible([...p,radius],camera))continue;
  const z=p.reduce((n,x,k)=>n+(x-camera.eye[k])*camera.forward[k],0),level=selectHierarchyLod(errors.subarray(model*8+4,model*8+8),scale,z,radius,camera,previous[instance]);next[instance]=level;
  let node=models[model*8+level],end=nw[node*8+5];
  while(node<end){tested++;const n=node*8,local=Array.from(nf.subarray(n,n+3)).map(x=>x*scale),center=rotate(q,local).map((x,k)=>x+p[k]),sphere=[...center,nf[n+3]*Math.abs(scale)];
   if(!sphereVisible(sphere,camera)){rejected++;node=nw[n+5];continue;}
   const command=nw[n+4];if(command!==INVALID)visible[command].push(instance);node++;
  }
 }
 return {visible,previous:next,triangles:visible.reduce((n,ids,k)=>n+ids.length*draw[k*8]/3,0),tested,rejected};
}
