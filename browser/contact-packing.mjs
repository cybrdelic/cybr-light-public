import {rotate} from './instanced-bvh.mjs';

// Sparse vertical envelopes of compound boxes. Empty projected cells remain
// empty, unlike a full object AABB. Conservative intervals prevent crossings;
// orientations stay fixed, so this is not a rigid-body equilibrium solver.
export function contactProfile(boxes,rotation,cell=.12){
  const columns=new Map();
  for(const box of boxes){
    const c=box.slice(0,3).map((v,k)=>(v+box[k+3])/2);
    const h=box.slice(0,3).map((v,k)=>(box[k+3]-v)/2);
    const center=rotate(rotation,c),axes=h.map((v,k)=>rotate(rotation,[0,0,0].map((_,j)=>j===k?v:0)));
    const ext=[0,1,2].map(k=>axes.reduce((s,a)=>s+Math.abs(a[k]),0));
    const normals=axes.map(a=>[-a[2],a[0]]).filter(n=>Math.hypot(...n)>1e-10);
    for(let z=Math.floor((center[2]-ext[2])/cell);z<=Math.floor((center[2]+ext[2])/cell);z++)
      for(let x=Math.floor((center[0]-ext[0])/cell);x<=Math.floor((center[0]+ext[0])/cell);x++){
        const dx=(x+.5)*cell-center[0],dz=(z+.5)*cell-center[2];
        if(normals.some(([nx,nz])=>Math.abs(nx*dx+nz*dz)>axes.reduce((s,a)=>s+Math.abs(nx*a[0]+nz*a[2]),0)+(Math.abs(nx)+Math.abs(nz))*cell/2+1e-8))continue;
        const key=x+','+z,old=columns.get(key),low=center[1]-ext[1],high=center[1]+ext[1];
        columns.set(key,[x,z,Math.min(old?.[2]??Infinity,low),Math.max(old?.[3]??-Infinity,high)]);
      }
  }
  if(!columns.size)throw Error('Empty contact profile');
  return [...columns.values()];
}
