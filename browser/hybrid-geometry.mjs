// Read-only draw extraction from the exact acceleration geometry.
export function rasterDraws(scene) {
  if(scene.instanceRecordStart===undefined)return [{first:0,count:scene.triangles.byteLength/48,instances:[0],root:0}];
  const words=new Uint32Array(scene.nodes), ranges=new Map(), groups=new Map();
  const range=root=>{
    if(ranges.has(root))return ranges.get(root);
    const pending=[root];let first=Infinity,end=0,leaves=0;
    while(pending.length){const i=pending.pop()*12,n=words[i+11];
      if(n){if(n&0x80000000)throw Error('Expected BLAS, found TLAS');first=Math.min(first,words[i+10]);end=Math.max(end,words[i+10]+n);leaves+=n;}
      else pending.push(words[i+8],words[i+9]);
    }
    if(end-first!==leaves)throw Error('Raster BLAS range is not contiguous');
    const r={first,count:end-first};ranges.set(root,r);return r;
  };
  for(let i=0;i<scene.instanceCount;i++){
    const instance=scene.instanceRecordStart+i,off=instance*12;
    for(const root of new Set([words[off+8],words[off+10]].filter(Boolean))){
      if(!groups.has(root))groups.set(root,{...range(root),root,instances:[]});
      groups.get(root).instances.push(instance);
    }
  }
  return [...groups.values()];
}
export function cameraBasis(pose,fov){
  const norm=v=>{const l=Math.hypot(...v);return v.map(x=>x/l);};
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const d=[Math.sin(pose.yaw)*Math.cos(pose.pitch)*pose.distance,Math.sin(pose.pitch)*pose.distance,Math.cos(pose.yaw)*Math.cos(pose.pitch)*pose.distance];
  const forward=norm(d.map(x=>-x)),right=norm(cross(forward,[0,1,0]));
  return {eye:d.map((x,i)=>x+(pose.target?.[i]||0)),forward,right,up:cross(right,forward),tan:fov?Math.tan(fov*Math.PI/360):Math.tan(Math.PI/7)};
}
// Irradiance anchors share authored smooth vertices instead of allocating a
// separate history for every tessellation triangle. XYZ/normals are untouched.
// Boundary + material separate unrelated coincident surfaces. The 1e-7 key
// tolerance is below the existing transport offset; it is not mesh decimation.
export function shareSurfaceAnchors(geometryBuffer,attributeBuffer){
 const g=new Float32Array(geometryBuffer),a=new Float32Array(attributeBuffer),seen=new Map();
 if(g.length/12*3>=16777216)throw Error('Surface anchor float identity budget exceeded');
 let shared=0;
 for(let i=0;i<g.length/12;i++){
  const t=i*12,at=i*24;
  for(let corner=0;corner<3;corner++){
   const p=[0,1,2].map(k=>Math.round(Math.fround(g[t+k]+(corner?g[t+corner*4+k]:0))*1e7));
   const n=[0,1,2].map(k=>Math.round(a[at+corner*4+k]*1e7));
   const key=[...p,...n,a[at+3],g[t+3]].join(',');
   let id=seen.get(key);if(id===undefined){id=i*3+corner;seen.set(key,id);}else shared++;
   a[at+15+corner*4]=id;
  }
 }
 return {anchors:seen.size,shared,corners:g.length/4,positionKeyTolerance:1e-7};
}
