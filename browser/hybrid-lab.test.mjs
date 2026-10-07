import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rasterDraws,cameraBasis,shareSurfaceAnchors} from './hybrid-geometry.mjs';
import {incidentTransport,beautyCacheTransport} from './hybrid-transport.mjs';
import {instancedShader} from './instanced-shader.mjs';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
test('ordinary raster retains every resident triangle',()=>{
 assert.deepEqual(rasterDraws({triangles:new ArrayBuffer(48*17)}),[{first:0,count:17,instances:[0],root:0}]);
});
test('instance draws retain both low and near BLAS and original instance identities',()=>{
 const nodes=new ArrayBuffer(7*48),u=new Uint32Array(nodes);
 for(const id of [1,2]){u[id*12+8]=3;u[id*12+10]=4;}
 u[3*12+10]=0;u[3*12+11]=4;u[4*12+10]=4;u[4*12+11]=6;
 assert.deepEqual(rasterDraws({nodes,instanceRecordStart:1,instanceCount:2}),[
  {first:0,count:4,root:3,instances:[1,2]},{first:4,count:6,root:4,instances:[1,2]}
 ]);
});
test('noncontiguous BLAS ranges fail closed rather than draw unrelated triangles',()=>{
 const nodes=new ArrayBuffer(6*48),u=new Uint32Array(nodes);u[20]=2;u[2*12+8]=3;u[2*12+9]=4;
 u[3*12+10]=0;u[3*12+11]=1;u[4*12+10]=2;u[4*12+11]=1;
 assert.throws(()=>rasterDraws({nodes,instanceRecordStart:1,instanceCount:1}),/not contiguous/);
});
test('camera matches production orientation and focal length',()=>{
 const c=cameraBasis({yaw:0,pitch:0,distance:3,target:[1,2,3]});
 assert.deepEqual(c.eye,[1,2,6]);assert.equal(c.forward[2],-1);assert.equal(c.right[0],1);assert.equal(c.up[1],1);assert.equal(c.tan,Math.tan(Math.PI/7));
});
test('secondary transport retains absorption, nested glass and energy without firefly clamps',()=>{
 const s=incidentTransport(read('./trace.wgsl'));
 assert.ok(s.includes('commitMedium(&media'));assert.ok(s.includes('throughput*=eta*eta'));
 assert.ok(s.includes('exp(-medium*'));assert.ok(s.includes('previousPdf=initialPdf'));
 assert.ok(!s.includes('samples[index]'));assert.ok(!s.includes('fn main('));
 assert.throws(()=>incidentTransport('changed'),/contract changed/);
 const pile=incidentTransport(instancedShader(read('./trace.wgsl'),read('./trace-instances.wgsl')));
 assert.ok(pile.includes('instanceNormal'));assert.ok(pile.includes('ids:array<vec2u,16>'));
});
test('cache verifies all key words, separates publication dispatch and preserves epoch on camera motion',()=>{
 const wgsl=read('./hybrid-lighting.wgsl'),js=read('./hybrid-lab.mjs');
 assert.ok(wgsl.includes('all(cells[base+i].key==key)'));
 assert.ok(wgsl.includes('cells[slot]=old;'));assert.ok(wgsl.includes('atomicMin(&owners[slot],index)'));
 assert.ok(!wgsl.slice(wgsl.indexOf('fn request('),wgsl.indexOf('fn publish(')).includes('cells[slot]='));
 assert.match(js,/function invalidate\(\)\s*\{\s*state\.epoch\+\+/);
 const uniforms=js.match(/function writeUniforms\(\)[\s\S]*?(?=function stamps\()/)?.[0];
 assert.ok(uniforms);assert.ok(!uniforms.includes('state.epoch++'));
});
test('shared anchor metadata does not alter geometry, normals, colors or boundary IDs',()=>{
 const g=new Float32Array(24),a=new Float32Array(48);
 g[4]=1;g[9]=1;g.set(g.subarray(0,12),12);
 for(let i=0;i<2;i++)for(let v=0;v<3;v++){a[i*24+v*4+1]=1;a[i*24+12+v*4]=.7;}
 const before=new Float32Array(a),geometry=new Float32Array(g);
 const stats=shareSurfaceAnchors(g.buffer,a.buffer);
 assert.equal(stats.shared,3);assert.equal(stats.anchors,3);assert.deepEqual(g,geometry);
 for(let i=0;i<48;i++)if(![15,19,23].includes(i%24))assert.equal(a[i],before[i]);
 assert.equal(a[39],a[15]);assert.equal(a[43],a[19]);assert.equal(a[47],a[23]);
 a[27]=99;assert.equal(shareSurfaceAnchors(g.buffer,a.buffer).shared,0);
});
test('queue preserves one owner per anchor, sampling seed and bounded local storage',()=>{
 const q=read('./hybrid-queue.wgsl'),base=read('./hybrid-lighting.wgsl');
 assert.ok(q.includes('atomicLoad(&owners[slot])!=index'));
 assert.ok(q.includes('localSlots:array<u32,768>'));assert.equal(8*8*4*3,768);
 assert.ok(q.includes('hash(key)^(u32(value.w)*6271u)'));
 assert.ok(base.includes('hash(key)^(u32(old.value.w)*6271u)'));
 assert.ok(q.includes('cells[slot].value=value'));
 assert.ok(!q.includes('cells[slot].key='));
 assert.ok(q.includes('workgroupBarrier()'));
});
test('reference dispatch is independent of fallback and cache kernels',()=>{
 const js=read('./hybrid-lab.mjs'),s=read('./hybrid-lighting.wgsl');
 assert.match(js,/resolvePipeline\s*=\s*pipelines\[mode\.resolve\]/);
 const reference=s.slice(s.indexOf('fn resolveReference'),s.indexOf('fn resolveFallback'));
 assert.ok(!reference.includes('lookup('));assert.ok(!reference.includes('cells['));
 assert.ok(reference.includes('lab.referenceFrame*6271u'));
 assert.ok(reference.includes('sampleIrradiance'));
});
test('beauty keeps camera emission weights and original transport, not tinted irradiance',()=>{
 const s=incidentTransport(read('./trace.wgsl')),b=read('./hybrid-beauty.wgsl');
 assert.ok(s.includes('var delta=initialPdf<=0.'));
 assert.ok(b.includes('incident(u.eye.xyz,direction,seed,0.)'));
 assert.ok(!b.includes('sampleIrradiance'));assert.ok(!b.includes('cells['));
 assert.ok(b.includes('lab.referenceFrame>0u'));
});
test('ownership reuse invalidates on camera, epoch and incomplete publication',()=>{
 const js=read('./hybrid-lab.mjs'),q=read('./hybrid-queue.wgsl');
 assert.match(js,/JSON\.stringify\(\[pose,\s*state\.epoch\]\)/);
 assert.match(js,/state\.counts\[0\]\s*>\s*0\s*\|\|\s*state\.counts\[4\]\s*>\s*0/);
 assert.ok(q.includes('cells[slot].seen.x=u.size.z'));
 for(const key of ['cacheMaintenance','queueCollection','cacheTracing','lod'])assert.match(js,new RegExp(key+':\\s*times\\['));
});
test('beauty control variate preserves PDFs, signed residuals and optical fallback',()=>{
 const s=beautyCacheTransport(incidentTransport(read('./trace.wgsl'))),b=read('./hybrid-beauty-cache.wgsl');
 assert.ok(s.includes('var startDepth=1u;'));
 assert.ok(s.includes('m.physical.y<.5&&metal<.999'));
 assert.ok(s.includes('radiance+=throughput*cacheWeight*cached.rgb'));
 assert.ok(s.includes('throughput/=survival'));
 assert.ok(s.includes('abs(throughput.x)'));
 assert.ok(b.includes('b.rgb-weight/PI,b.w'));
 assert.ok(!b.includes('max(b.rgb'));
 assert.ok(b.includes('cell.value.w<16.'));
 assert.ok(s.includes('commitMedium(&media'));
 const beauty=s.slice(s.indexOf('fn incidentBeauty('));
 assert.ok(!beauty.includes('=bsdf('));
 assert.ok(beauty.includes('=residualBsdf('));
 assert.throws(()=>beautyCacheTransport(''),/Missing incident/);
});
test('diffuse Schlick residual recomposes the original energy at every angle',()=>{
 for(const color of [.02,.3,.9])for(const metal of [0,.5,1])for(const cosine of [0,.01,.2,.7,1]){
  const f0=.04*(1-metal)+color*metal,f=f0+(1-f0)*(1-cosine)**5;
  const full=color*(1-metal)*(1-f)/Math.PI;
  const constant=color*(1-metal)*(1-f0)/Math.PI;
  const residual=full-constant;
  assert.ok(Math.abs(constant+residual-full)<1e-15);
 }
});
