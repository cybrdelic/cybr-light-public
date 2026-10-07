// Rank visible instances, not gallery positions. One shared detailed template
// can serve many nearby instances, while distant copies keep their low BLAS.
export function selectPileDetail(info,cam,height,budget=4000000,index){
  if(!info.lodPositions)return [];
  const scores=new Float64Array(info.modelIds.length),p=info.lodPositions;
  for(let i=0;i<p.length;i+=4){
    const m=p[i+3],r=info.modelRadii[m];
    const dx=p[i]-cam.eye[0],dy=p[i+1]-cam.eye[1],dz=p[i+2]-cam.eye[2];
    const depth=dx*cam.forward[0]+dy*cam.forward[1]+dz*cam.forward[2];
    if(depth+r<=0)continue;
    const horizontal=Math.abs(dx*cam.right[0]+dy*cam.right[1]+dz*cam.right[2]);
    const vertical=Math.abs(dx*cam.up[0]+dy*cam.up[1]+dz*cam.up[2]);
    if(horizontal>depth*cam.tan*16/9+r||vertical>depth*cam.tan+r)continue;
    const pixels=r*height/(Math.max(Math.hypot(dx,dy,dz)-r,1e-6)*cam.tan);
    if(pixels>40)scores[m]=Math.max(scores[m],pixels);
  }
  let used=index.entries.reduce((s,e)=>s+e.counts.low,0);
  return info.modelIds.map((id,i)=>({id,score:scores[i]})).filter(e=>e.score>0)
    .sort((a,b)=>b.score-a.score).filter(e=>{
      const n=index.entries.find(x=>x.id===e.id).counts.near;
      if(used+n>budget)return false;used+=n;return true;
    }).map(e=>e.id);
}
