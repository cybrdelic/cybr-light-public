import {buildBVH} from './bvh.mjs?revision=tlas-leaf-1';
import {packTriangles} from './triangle-layout.mjs';

export function rotate(q,v){
  const [x,y,z,w]=q,[a,b,c]=v;
  const tx=2*(y*c-z*b),ty=2*(z*a-x*c),tz=2*(x*b-y*a);
  return [a+w*tx+y*tz-z*ty,b+w*ty+z*tx-x*tz,c+w*tz+x*ty-y*tx];
}

// Two-level BVH. Geometry/attributes are stored once per template. TLAS leaves
// reference transform records in the same node buffer: no extra GPU binding.
export function buildInstancedBVH(tri,bounds,centers,meshes,pile,sourceScale,tlasLeafSize=6,cache){
  if(!pile.instances.length||pile.instances.length>2000000)throw Error('Instance identity budget exceeded');
  const instanceAt=i=>pile.instanceAt?pile.instanceAt(i):pile.instances[i];
  for(let i=0;i<pile.instances.length;i++){
    const item=instanceAt(i);
    if(!Number.isInteger(item.model)||item.model<0||item.model>=pile.models.length||item.position.length!==3||item.rotation.length!==4||![...item.position,...item.rotation].every(Number.isFinite)||Math.abs(Math.hypot(...item.rotation)-1)>.001||!Number.isFinite(item.scale??1)||(item.scale??1)<=0)throw Error('Invalid pile transform');
  }
  for(let i=0;i<tri.length;i+=36)if(tri[i+3]>=8192||tri[i+15]>=65536)throw Error('Pile material/boundary identity budget exceeded');
  const groups=[];let at=0;
  for(const mesh of meshes){
    const n=mesh.indices.count/3;
    let g=groups.at(-1);
    if(g?.id!==mesh.galleryId||g?.lod!==(mesh.lod||'low')){g={id:mesh.galleryId,lod:mesh.lod||'low',start:at,count:0};groups.push(g);}
    g.count+=n;at+=n;
  }
  const baseGroups=pile.models.map(m=>groups.find(g=>g.id===m.id&&g.lod==='low'));
  if(baseGroups.some(g=>!g))throw Error('Pile template ordering mismatch');
  for(const g of groups){
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(let i=g.start;i<g.start+g.count;i++)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],bounds[i*6+k]);hi[k]=Math.max(hi[k],bounds[i*6+k+3]);}
    g.center=lo.map((v,k)=>(v+hi[k])/2);
    g.half=hi.map((v,k)=>(v-lo[k])/2/sourceScale);
  }
  // Both levels keep the low-level origin. Independent recentering makes a
  // part jump when LOD changes, and invalidates baked contact transforms.
  for(const g of groups)if(g.lod==='near')g.center=[...baseGroups[pile.models.findIndex(m=>m.id===g.id)].center];
  const modelBounds=baseGroups.map(g=>{
    const half=[...g.half];
    for(const near of groups.filter(n=>n.id===g.id&&n.lod==='near'))
      for(let i=near.start;i<near.start+near.count;i++)for(let k=0;k<3;k++)half[k]=Math.max(half[k],Math.abs(bounds[i*6+k]-g.center[k])/sourceScale,Math.abs(bounds[i*6+k+3]-g.center[k])/sourceScale);
    return half;
  });
  const rawBoxes=new Float32Array(pile.instances.length*6);
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<pile.instances.length;i++){
    const item=instanceAt(i);
    const stableHalf=baseGroups[item.model].half.map(v=>v*(item.scale??1));
    const axes=[0,1,2].map(k=>rotate(item.rotation,[0,1,2].map(j=>j===k?stableHalf[k]:0)));
    for(let k=0;k<3;k++){
      const extent=axes.reduce((s,a)=>s+Math.abs(a[k]),0);
      lo[k]=Math.min(lo[k],item.position[k]-extent);hi[k]=Math.max(hi[k],item.position[k]+extent);
    }
    {
    const half=modelBounds[item.model].map(v=>v*(item.scale??1)),lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(let mask=0;mask<8;mask++){
      const p=rotate(item.rotation,half.map((v,k)=>mask&(1<<k)?v:-v)).map((v,k)=>v+item.position[k]);
      for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],p[k]);hi[k]=Math.max(hi[k],p[k]);}
    }
    rawBoxes.set([...lo,...hi],i*6);
    }
  }
  const scale=4/Math.max(...hi.map((v,k)=>v-lo[k]));
  const origin=[(lo[0]+hi[0])/2,pile.individual?lo[1]:0,(lo[2]+hi[2])/2],ratio=scale/sourceScale;
  const blas=[],order=new Uint32Array(at);let nodeTotal=0,maxDepth=0;
  for(const g of groups){
    const bb=new Float32Array(g.count*6),cc=new Float32Array(g.count*3);
    for(let j=0;j<g.count;j++){
      const i=g.start+j;
      for(let k=0;k<3;k++){
        tri[i*36+k]=(tri[i*36+k]-g.center[k])*ratio;
        tri[i*36+4+k]*=ratio;tri[i*36+8+k]*=ratio;
        bb[j*6+k]=(bounds[i*6+k]-g.center[k])*ratio;
        bb[j*6+k+3]=(bounds[i*6+k+3]-g.center[k])*ratio;
        cc[j*3+k]=(centers[i*3+k]-g.center[k])*ratio;
      }
    }
    const built=cache?cache.build(g.id+':'+g.lod,bb,cc,g.count,6,g.lod==='low'?1:0):buildBVH(bb,cc,g.count);
    const b={...built,triangleStart:g.start,nodeOffset:nodeTotal};g.blas=b;
    for(let j=0;j<g.count;j++)order[g.start+j]=g.start+b.ids[j];
    nodeTotal+=b.nodeCount;maxDepth=Math.max(maxDepth,b.maxDepth);blas.push(b);
  }
  const ib=new Float32Array(pile.instances.length*6),ic=new Float32Array(pile.instances.length*3);
  for(let i=0;i<pile.instances.length;i++)for(let k=0;k<3;k++){ib[i*6+k]=(rawBoxes[i*6+k]-origin[k])*scale;ib[i*6+k+3]=(rawBoxes[i*6+k+3]-origin[k])*scale;ic[i*3+k]=(ib[i*6+k]+ib[i*6+k+3])/2;}
  const tlas=buildBVH(ib,ic,pile.instances.length,tlasLeafSize),recordStart=tlas.nodeCount,blasStart=recordStart+pile.instances.length;
  const buffer=new ArrayBuffer((blasStart+nodeTotal)*48),f=new Float32Array(buffer),u=new Uint32Array(buffer);
  new Uint8Array(buffer).set(new Uint8Array(tlas.buffer));
  f[3]=ratio; // world-space ray offsets scale with the actual template geometry
  for(let i=0;i<tlas.nodeCount;i++){
    const off=i*12;if(u[off+11]){u[off+10]+=recordStart;u[off+11]=(u[off+11]|0x80000000)>>>0;}
  }
  const detailGroups=baseGroups.map(g=>groups.find(n=>n.id===g.id&&n.lod==='near'));
  tlas.ids.forEach((id,j)=>{
    const item=instanceAt(id),off=(recordStart+j)*12;
    f.set(item.position.map((v,k)=>(v-origin[k])*scale),off);f[off+3]=1;
    const g=baseGroups[item.model],near=detailGroups[item.model];
    // Quaternion squared length carries positive uniform scale; traversal
    // normalizes rotation and divides both ray origin and direction by scale.
    f.set(item.rotation.map(v=>v*Math.sqrt(item.scale??1)),off+4);u[off+8]=blasStart+g.blas.nodeOffset;u[off+9]=((id+1)|((item.leafMask??0)<<24))>>>0;
    u[off+10]=near?blasStart+near.blas.nodeOffset:0;
    f[off+3]=Math.hypot(...modelBounds[item.model])*scale*(item.scale??1);
  });
  for(const b of blas){
    const offset=blasStart+b.nodeOffset;
    new Uint8Array(buffer,offset*48,b.buffer.byteLength).set(new Uint8Array(b.buffer));
    for(let j=0;j<b.nodeCount;j++){
      const off=(offset+j)*12;
      if(u[off+11])u[off+10]+=b.triangleStart;
      else{u[off+8]+=offset;u[off+9]+=offset;}
    }
  }
  const positions=new Float32Array(pile.instances.length*4);
  let representedTriangles=0;for(let i=0;i<pile.instances.length;i++){
    const item=instanceAt(i);representedTriangles+=baseGroups[item.model].count;
    positions.set([...item.position.map((v,k)=>(v-origin[k])*scale),item.model],i*4);
  }
  let camera={yaw:.38,pitch:pile.stress?.45:.65,distance:pile.stress?5:3.9,target:[0,((lo[1]+hi[1])/2-origin[1])*scale,0]};
  if(pile.individual){camera.distance=6.5;camera.pitch=.22;}
  const poseCamera=pose=>{
    const delta=pose.position.map((v,k)=>v-pose.target[k]),distance=Math.hypot(...delta);
    return {yaw:Math.atan2(delta[0],delta[2]),pitch:Math.asin(delta[1]/distance),distance:distance*scale,target:pose.target.map((v,k)=>(v-origin[k])*scale)};
  };
  if(pile.camera)camera=poseCamera(pile.camera);
  const views=pile.views?Object.fromEntries(Object.entries(pile.views).map(([key,value])=>[key,poseCamera(value)])):null;
  return {...packTriangles(tri,order),buffer,nodeCount:buffer.byteLength/48,maxDepth:Math.max(maxDepth,tlas.maxDepth),instanceCount:pile.instances.length,
    representedTriangles,ratio,instanceRecordStart:recordStart,lodPositions:positions,modelRadii:modelBounds.map(h=>Math.hypot(...h)*scale),modelIds:pile.models.map(m=>m.id),
    floor:pile.individual?(lo[1]-origin[1])*scale-.01:undefined,camera,views};
}
