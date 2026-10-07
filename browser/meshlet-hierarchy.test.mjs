import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {partitionMeshlets,buildForestClusterPlan,cullHierarchyCpu,sphereVisible,selectHierarchyLod,rotate} from './meshlet-hierarchy.mjs';
const hash=x=>createHash('sha256').update(new Uint8Array(x.buffer??x,x.byteOffset??0,x.byteLength)).digest('hex');
function mesh(n=180){const v=new Float32Array(n*3*10),w=new Uint32Array(v.buffer),ix=new Uint32Array(n*3);for(let t=0;t<n;t++)for(let j=0;j<3;j++){const i=t*3+j;v.set([(t%3-1)*20+j*.1,Math.floor(t/3)*.01,20+j*.02,0,1,0,.11,.2,.3],i*10);w[i*10+9]=t%2?128:1;ix[i]=i;}return {v,ix};}
function batches(n=180){const {v,ix}=mesh(n);return [{id:'fixture',radius:40,levels:[0,.001,.002,.004].map(error=>({vertices:v.slice().buffer,indices:ix.slice().buffer,error}))}];}
const camera={eye:[0,0,0],forward:[0,0,1],right:[1,0,0],up:[0,1,0],tan:.15,aspect:1,lodPixels:0};
function instances(n=1){const v=new Float32Array(n*12),w=new Uint32Array(v.buffer);for(let i=0;i<n;i++){v.set([0,0,0,1,0,0,0,1],i*12);w[i*12+8]=0;w[i*12+9]=129;v[i*12+10]=40;}return v;}
function triples(ix){const out=[];for(let i=0;i<ix.length;i+=3)out.push(Array.from(ix.subarray(i,i+3)).join(','));return out.sort();}
test('bounded deterministic clusters preserve exact oriented triangle multiset and vertex words',()=>{
 const {v,ix}=mesh(),before=hash(v),a=partitionMeshlets(v,ix),b=partitionMeshlets(v,ix);
 assert.deepEqual(triples(a.indices),triples(ix));assert.equal(hash(a.indices),hash(b.indices));assert.equal(hash(v),before);assert.deepEqual(a.nodes,b.nodes);
 for(const c of a.clusters){assert.ok(c.vertexCount<=64&&c.indexCount/3<=64);for(const index of a.indices.subarray(c.firstIndex,c.firstIndex+c.indexCount)){const p=v.subarray(index*10,index*10+3);assert.ok(Math.hypot(...p.map((x,k)=>x-c.sphere[k]))<=c.sphere[3]);}}
 for(let i=0;i<a.nodes.length;i++){const n=a.nodes[i];assert.ok(n.escape>i&&n.escape<=a.nodes.length);if(n.draw===0xffffffff)for(let j=i+1;j<n.escape;j++){const c=a.nodes[j];assert.ok(Math.hypot(...c.sphere.slice(0,3).map((x,k)=>x-n.sphere[k]))+c.sphere[3]<=n.sphere[3]+1e-5);}}
});
test('all clusters together equal full resolution; frustum removes offscreen clusters',()=>{
 const b=batches(),plan=buildForestClusterPlan(b,[1]),v=instances();assert.equal(plan.metrics.clusteredModels,1);
 const all=cullHierarchyCpu(plan,v,{...camera,tan:100});assert.equal(all.triangles,180);assert.equal(new Set(all.visible.flat()).size,1);
 const edge=cullHierarchyCpu(plan,v,camera);assert.ok(edge.triangles>0&&edge.triangles<180);assert.ok(edge.rejected>0);
 for(let i=0;i<edge.visible.length;i++)assert.ok(edge.visible[i].length<=new Uint32Array(plan.draw)[i*8+6]);
});
test('allocation limits choose whole-tree fallback without truncation, mixed LOD, or indirect firstInstance',()=>{
 const b=batches(),original=hash(b[0].levels[0].indices),plan=buildForestClusterPlan(b,[2],{maxDraws:4,maxVisibleBytes:32,maxNodesBytes:128});
 assert.equal(plan.metrics.clusteredModels,0);assert.equal(hash(b[0].levels[0].indices),original);assert.equal(plan.visibleBytes,32);assert.equal(plan.metrics.nodeBytes,128);
 const draw=new Uint32Array(plan.draw);for(let i=0;i<4;i++){assert.equal(draw[i*8+4],0);assert.equal(draw[i*8+6],2);}
 const c=cullHierarchyCpu(plan,instances(2),{...camera,tan:100});assert.equal(c.triangles,360);assert.equal(c.visible.filter(x=>x.length).length,1);
});
test('error cap and hysteresis retain close detail and disable simplification at zero',()=>{
 const errors=[0,.001,.002,.004],c={...camera,tan:1,lodPixels:1};
 assert.equal(selectHierarchyLod(errors,1,100,1,{...c,lodPixels:0},3),0);
 assert.equal(selectHierarchyLod(errors,1,1,1,c),0);
 // A level at .95 px cannot demote into coarse detail, but may remain there.
 const e=[0,.95/270,2/270,3/270];assert.equal(selectHierarchyLod(e,1,2,1,c,0),0);assert.equal(selectHierarchyLod(e,1,2,1,c,1),1);
 assert.equal(selectHierarchyLod(e,1,1.9,1,c,1),0);
});
// Independent polygon clipping tests all five planes, including edge-crossing triangles.
function intersects(points,c){let poly=points.map(p=>p.map((x,k)=>x-c.eye[k]));const dot=(a,b)=>a.reduce((s,x,k)=>s+x*b[k],0),planes=[p=>dot(p,c.forward)-.05,p=>dot(p,c.forward)*c.tan*c.aspect-dot(p,c.right),p=>dot(p,c.forward)*c.tan*c.aspect+dot(p,c.right),p=>dot(p,c.forward)*c.tan-dot(p,c.up),p=>dot(p,c.forward)*c.tan+dot(p,c.up)];
 for(const plane of planes){const next=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],fa=plane(a),fb=plane(b);if(fa>=0)next.push(a);if((fa<0)!==(fb<0)){const t=fa/(fa-fb);next.push(a.map((x,k)=>x+(b[k]-x)*t));}}poly=next;if(!poly.length)return false;}return true;
}
test('hierarchical spheres never remove a clipped triangle under seeded rotations, scales and cameras',()=>{
 const b=batches(90),plan=buildForestClusterPlan(b,[1]),v=new Float32Array(b[0].levels[0].vertices),ix=new Uint32Array(b[0].levels[0].indices),record=plan.records;
 let seed=12345;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 for(let sample=0;sample<100;sample++){const inst=instances(),scale=.1+random()*3,angle=random()*Math.PI*2,q=[0,Math.sin(angle/2),0,Math.cos(angle/2)],p=[random()*10-5,random()*4-2,random()*30];inst.set([...p,scale,...q]);inst[10]=40*scale;
  const c={...camera,tan:.1+random(),aspect:.5+random()*2},result=cullHierarchyCpu(plan,inst,c);
  for(let draw=0;draw<record.length;draw++){const r=record[draw];if(r.level!==0||result.visible[draw].length)continue;for(let t=r.firstIndex;t<r.firstIndex+r.indexCount;t+=3){const points=Array.from(ix.subarray(t,t+3),index=>rotate(q,Array.from(v.subarray(index*10,index*10+3)).map(x=>x*scale)).map((x,k)=>x+p[k]));assert.equal(intersects(points,c),false,`visible triangle rejected at sample ${sample}, draw ${draw}`);}}
 }
});
test('malformed input is rejected and float32 bounds include large coordinates',()=>{
 assert.throws(()=>partitionMeshlets(new Float32Array(11),new Uint32Array(3)),/layout/);assert.throws(()=>partitionMeshlets(new Float32Array(30),new Uint32Array([0,1,9])),/outside/);
 const {v,ix}=mesh(1);v[0]=NaN;assert.throws(()=>partitionMeshlets(v,ix),/Non-finite/);v[0]=1e8;const a=partitionMeshlets(v,ix);assert.ok(sphereVisible(a.clusters[0].sphere,{...camera,tan:100}));
});
test('portable shader and integration expose counters with existing material shader and resident fallback',async()=>{
 const shader=await readFile(new URL('./forest-meshlet-cull.wgsl',import.meta.url),'utf8'),runtime=await readFile(new URL('./forest-game.mjs',import.meta.url),'utf8');
 assert.ok(shader.includes('at<draws[draw].capacity'));assert.ok(shader.includes('nodes[node].links.y'));assert.ok(runtime.includes("get('meshlets')==='1'"));assert.ok(runtime.includes('inspectMeshlets'));assert.ok(runtime.includes('originalDrawWords[i*8]'));
});
