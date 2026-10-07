import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

test('a parallel miss cannot become a valid light-plane intersection',()=>{
 const plane=1e20,hit=1e20,denominator=0;
 assert.ok(plane>1e-5&&plane<=hit+1e-4); // reproduces the old sentinel bug
 assert.equal(Math.abs(denominator)>1e-8&&plane<1e19,false);
 for(const p of ['./hybrid-refracted-nee.wgsl','./hybrid-refracted-nee-analytic.wgsl']){
  const s=read(p);assert.ok(s.includes('abs(denominator)>1e-8&&plane>.00001&&plane<1e19'));
 }
});
test('reciprocal-edge barycentrics remain defined when the float32 Gram determinant cancels',()=>{
 const f=Math.fround,e1=[1,0,0],e2=[1,f(1e-4),0];
 assert.equal(f(f(dot(e1,e1))*f(dot(e2,e2))-f(dot(e1,e2))**2),0);
 const n=cross(e1,e2),area=dot(n,n),du=cross(e2,n),dv=cross(n,e1);
 assert.ok(area>0);
 for(const [dp,expected] of [[e1,[1,0]],[e2,[0,1]],[[.3,.00002,0],[.1,.2]]]){
  const value=[dot(dp,du)/area,dot(dp,dv)/area];
  for(let i=0;i<2;i++)assert.ok(Math.abs(value[i]-expected[i])<1e-7);
 }
 const s=read('./hybrid-refracted-nee-analytic.wgsl');assert.ok(!s.includes('determinant=a*c-b*b'));
 assert.ok(s.includes('dot(areaNormal,areaNormal)>1e-30'));
});
test('bilinear optical inverse uses the fourth corner and correct partial derivatives',()=>{
 // F(x,y)=(x,y+xy,0); the old three-corner affine model is only (x,y,0).
 const target=[.4,.6*(1+.4)];let p=[.2,.2];
 for(let i=0;i<4;i++){
  const residual=[target[0]-p[0],target[1]-p[1]*(1+p[0])];
  const dx=[1,p[1],0],dy=[0,1+p[0],0];const aa=dot(dx,dx),bb=dot(dx,dy),cc=dot(dy,dy),n=cross(dx,dy),det=dot(n,n);
  const r=[...residual,0];p=[p[0]+(cc*dot(dx,r)-bb*dot(dy,r))/det,p[1]+(aa*dot(dy,r)-bb*dot(dx,r))/det];
 }
 assert.ok(Math.abs(p[0]-.4)<1e-12&&Math.abs(p[1]-.6)<1e-12);
 assert.ok(Math.abs(target[1]-.6)>.2); // old affine inverse gives wrong history coordinate
 const s=read('./hybrid-optical.wgsl');for(const marker of ['matchingOptical(bxy,currentOptic)','let dx=mix(x0,x1,f.y)','let dy=mix(y0,y1,f.x)','let residual=currentOptic.endpoint.xyz-endpoint'])assert.ok(s.includes(marker));
});
test('folded bilinear cells have inconsistent corner orientation and are rejected',()=>{
 const a=[0,0,0],b=[1,0,0],c=[0,1,0],d=[-1,1,0];
 const sub=(x,y)=>x.map((v,i)=>v-y[i]);const x0=sub(b,a),y0=sub(c,a),x1=sub(d,c),y1=sub(d,b);
 assert.ok(dot(cross(x0,y0),cross(x1,y1))<0);
 assert.ok(read('./hybrid-optical.wgsl').includes('dot(orientation,cross(x1,y1))<=0.'));
});
test('validation steps cannot silently succeed before initialization or after errors',()=>{
 const s=read('./hybrid-lab.mjs');assert.match(s,/if\s*\(!state.ready\)\s*throw Error\('Renderer is not ready; no steps rendered'\)/);
 assert.match(s,/if\s*\(state.frame\s*!==\s*frame\s*\+\s*1\)\s*throw Error\('Requested step did not render exactly one frame'\)/);
});
test('unproven bilinear reconstruction is not silently enabled in the default renderer',()=>{
 const s=read('./hybrid-lab.mjs');assert.match(s,/params.get\('opticalMap'\)\s*===\s*'bilinear'\s*\?\s*'bilinear-experimental'\s*:\s*'legacy'/);
 assert.ok(read('./hybrid-shaders.mjs').includes("if (opticalMap === 'bilinear-experimental')"));
 const optical=read('./hybrid-optical.wgsl');assert.ok(optical.includes('fn opticalHistoryBilinear('));assert.ok(optical.includes('fn opticalHistory('));
});
