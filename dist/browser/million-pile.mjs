import {rotate} from './instanced-bvh.mjs?revision=million-2';
import {contactProfile} from './contact-packing.mjs';
// One heap packed against conservative envelopes, not a million-body solve.
export function millionPile(source,count=1000000,index,contacts){
  if(!Number.isInteger(count)||count<1||count>1000000)throw Error('Invalid stress instance count');
  const half=source.models.map(m=>{
    const e=index.entries.find(e=>e.id===m.id);
    if(!e?.normalizedSize)throw Error('Missing pile dimensions: '+m.id);
    return [0,2,1].map(k=>e.normalizedSize[k]*e.galleryScale*.505+.004);
  });
  const template=source.instances.map(item=>{
    const axes=[0,1,2].map(k=>rotate(item.rotation,[0,1,2].map(j=>j===k?half[item.model][k]:0)));
    const boxes=contacts?.models.find(m=>m.id===source.models[item.model].id);
    if(contacts&&boxes?.sha256!==source.models[item.model].sha256)throw Error('Stale stress contacts');
    return {item,profile:boxes?contactProfile(boxes.boxes,item.rotation,.25):null,half:[0,1,2].map(k=>axes.reduce((s,a)=>s+Math.abs(a[k]),0))};
  });
  const radius=Math.max(12,300*Math.sqrt(count/1000000)),cell=.25,dimension=Math.ceil((radius+6)*2/cell),origin=dimension*cell/2;
  for(const t of template)if(t.profile){
    t.ground=-Math.min(...t.profile.map(c=>c[2]));
    t.offsets=Int32Array.from(t.profile,c=>c[1]*dimension+c[0]);
    t.lows=Float32Array.from(t.profile,c=>c[2]);t.highs=Float32Array.from(t.profile,c=>c[3]);
  }
  const heights=new Float32Array(dimension*dimension),positions=new Float32Array(count*3);
  let seed=314159265;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
  for(let i=0;i<count;i++){
    const t=template[i%template.length];let best;
    // Relax deposition into the lowest of twelve candidate supports. Pure
    // vertical random deposition bridges empty columns into an implausible spire.
    for(let attempt=0;attempt<12;attempt++){
      const angle=random()*Math.PI*2,r=radius*Math.sqrt(random());
      const x=Math.round(Math.cos(angle)*r/cell)*cell,z=Math.round(Math.sin(angle)*r/cell)*cell;
      const x0=Math.max(0,Math.floor((x-t.half[0]+origin)/cell)),x1=Math.min(dimension-1,Math.floor((x+t.half[0]+origin)/cell));
      const z0=Math.max(0,Math.floor((z-t.half[2]+origin)/cell)),z1=Math.min(dimension-1,Math.floor((z+t.half[2]+origin)/cell));
      let support=0;
      if(t.profile){
        support=t.ground;
        const ix=Math.round((x+origin)/cell),iz=Math.round((z+origin)/cell);
        const offset=iz*dimension+ix;
        for(let k=0;k<t.offsets.length;k++)support=Math.max(support,heights[offset+t.offsets[k]]-t.lows[k]);
      }else for(let a=z0;a<=z1;a++)for(let b=x0;b<=x1;b++)support=Math.max(support,heights[a*dimension+b]);
      const cost=support+r*.65;
      if(!best||cost<best.cost)best={x,z,x0,x1,z0,z1,support,cost};
    }
    const {x,z,x0,x1,z0,z1,support}=best;
    const bottom=support+.001,top=bottom+t.half[1]*2;
    positions.set([x,bottom+(t.profile?0:t.half[1]),z],i*3);
    if(t.profile){
      const ix=Math.round((x+origin)/cell),iz=Math.round((z+origin)/cell);
      const offset=iz*dimension+ix;
      for(let k=0;k<t.offsets.length;k++){const j=offset+t.offsets[k];heights[j]=Math.max(heights[j],bottom+t.highs[k]+.0001);}
    }else for(let a=z0;a<=z1;a++)for(let b=x0;b<=x1;b++)heights[a*dimension+b]=top+.0001;
  }
  return {...source,count,instances:{length:count},stress:true,
    instanceAt(i){const t=template[i%template.length];return {model:t.item.model,rotation:t.item.rotation,position:[positions[i*3],positions[i*3+1],positions[i*3+2]]};},
    description:contacts?'1,000,000 instances / one compound-contact heap. Sparse component profiles preserve projected cavities. Conservative static packing, not million-body dynamics.':'1,000,000 actual model instances in one static heap. Conservative collision-envelope packing—not a million-body physics simulation. Open-frame contact gaps remain possible.'};
}
