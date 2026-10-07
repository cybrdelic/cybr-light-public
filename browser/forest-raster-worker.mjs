// Build indexed draw batches directly from the source, without a million-item TLAS.
import {loadForest} from './forest-loader.mjs';
import {forestDetailLevels} from './forest-detail.mjs';
self.onmessage=async()=>{
 try{
  const forest=await loadForest(new URL('./assets/forest/',import.meta.url).href,'forest');
  const {raw,manifest,pile}=forest,models=pile.models;
  const read=s=>new ({float32:Float32Array,uint32:Uint32Array,int16:Int16Array}[s.dtype])(raw,s.offset,s.count);
  const batches=[];
  for(let model=0;model<models.length;model++){
   const meshes=manifest.meshes.filter(m=>m.galleryId===models[model].id);
   const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
   let vertices=0,indices=0;
   for(const m of meshes){const p=read(m.positions);vertices+=p.length/3;indices+=m.indices.count;
    for(let i=0;i<p.length;i+=3){const q=[p[i],p[i+2],-p[i+1]];for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],q[k]);hi[k]=Math.max(hi[k],q[k]);}}
   }
   const center=lo.map((v,k)=>(v+hi[k])/2),radius=Math.hypot(...hi.map((v,k)=>(v-lo[k])/2));
   const v=new Float32Array(vertices*10),words=new Uint32Array(v.buffer),ix=new Uint32Array(indices);let at=0,it=0;
   for(const m of meshes){const p=read(m.positions),n=read(m.normals),c=m.colors?read(m.colors):null,idx=read(m.indices),mat=manifest.customMaterials[m.material];
    const normalScale=m.normals.dtype==='int16'?1/32767:1;
    for(let i=0;i<p.length;i+=3){const off=(at+i/3)*10;
     v.set([p[i]-center[0],p[i+2]-center[1],-p[i+1]-center[2],n[i]*normalScale,n[i+2]*normalScale,-n[i+1]*normalScale],off);
     v.set([0,1,2].map(k=>(c?c[i+k]:1)*(mat?.color[k]??1)),off+6);words[off+9]=m.leafMask||0;
    }
    for(const x of idx)ix[it++]=x+at;at+=p.length/3;
   }
   const levels=await forestDetailLevels(v,ix,meshes.map(m=>m.indices.count),radius);
   batches.push({id:models[model].id,radius,levels});
  }
  const count=pile.count,counts=new Uint32Array(models.length);
  for(let i=0;i<count;i++)counts[pile.instanceAt(i).model]++;
  let total=0;const starts=Array.from(counts,n=>{const first=total;total+=n;return first;});
  const cursors=[...starts],instances=new Float32Array(count*12),iw=new Uint32Array(instances.buffer);
  for(let i=0;i<count;i++){const item=pile.instanceAt(i),o=cursors[item.model]++*12;
   instances.set([...item.position,item.scale,...item.rotation],o);iw[o+8]=item.model;iw[o+9]=item.leafMask;instances[o+10]=batches[item.model].radius*item.scale;
  }
  const draw=new Uint32Array(models.length*4*8),errors=new Float32Array(models.length*4);
  batches.forEach((b,i)=>{b.levels.forEach((lod,k)=>{draw.set([lod.indices.byteLength/4,0,0,0,0,starts[i]*4+k*counts[i],counts[i],0],(i*4+k)*8);errors[i*4+k]=lod.error;});});
  const transfer=[instances.buffer,draw.buffer,errors.buffer,...batches.flatMap(b=>b.levels.flatMap(l=>[l.vertices,l.indices]))];
  postMessage({batches,instances:instances.buffer,draw:draw.buffer,lodErrors:errors.buffer,count,views:pile.views},transfer);
 }catch(e){postMessage({error:e.stack||String(e)});}
};
