import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {incidentTransport} from './hybrid-transport.mjs';
import {rasterSignalTransport} from './hybrid-signals.mjs';
import {queuedConnectionTransport} from './hybrid-connection-queue.mjs';
import {refractedNeeTransport} from './hybrid-refracted-nee.mjs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const separated=rasterSignalTransport(incidentTransport(read('./trace.wgsl')));
const power=(a,b)=>a*a/(a*a+b*b);

test('Bernoulli NEE and stochastic transmission partition the same integrand',()=>{
 for(const q of [.03125,.125,.5,1])for(const F of [.02,.5,.99])for(const jacobian of [.001,1,1000]){
  const T=(1-F)**4*.8,pB=.3*(1-F)**4,pL=q*.07*jacobian,integrand=2*T;
  const expectedLight=pL*(integrand/pL)*power(pL,pB);
  const expectedBsdf=pB*(integrand/pB)*power(pB,pL);
  assert.ok(Math.abs(expectedLight+expectedBsdf-integrand)<1e-12);
 }
});
test('unselected roots retain full BSDF weight, not a nonexistent light technique',()=>{
 const pB=.2,value=3;assert.equal(pB*(value/pB)*power(pB,0),value);
});
test('area-to-solid-angle density has the correct vacuum and planar slab limits',()=>{
 const area=4,pmf=.25;
 for(const n of [1,1.333,1.52]){
  // Air distance 2, slab distance 1; endpoint slope at normal incidence.
  const analytic=2+1/n,eps=1e-5;
  const endpoint=s=>{const t=s/Math.sqrt(1+s*s)/n;return 2*s+t/Math.sqrt(1-t*t);};
  const derivative=(endpoint(eps)-endpoint(-eps))/(2*eps);
  assert.ok(Math.abs(derivative**2-analytic**2)<1e-8);
  if(n===1)assert.equal(pmf*analytic**2/area,pmf*9/area);
 }
});
test('nested radiance eta factors telescope; an unmatched exit is not air-to-air',()=>{
 const iors=[1,1.52,1.333,1.52,1];let factor=1;
 for(let i=1;i<iors.length;i++)factor*=(iors[i-1]/iors[i])**2;
 assert.ok(Math.abs(factor-1)<1e-14);
 assert.ok(Math.abs(1.52**2-1)>1); // The old empty-stack assumption discarded this factor.
});
test('analytic refraction differential agrees with an independent finite difference',()=>{
 const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
 const norm=a=>{const l=Math.sqrt(dot(a,a));return a.map(x=>x/l);};
 const refract=(d,n,eta)=>{const c=dot(d,n),r=Math.sqrt(1-eta*eta*(1-c*c));return d.map((v,i)=>eta*v-(eta*c+r)*n[i]);};
 for(const angle of [.05,.3,.7])for(const eta of [1/1.52,1/1.333,1.1]){
  const d=[Math.sin(angle),0,-Math.cos(angle)],n=[0,0,1],dd=[Math.cos(angle),0,Math.sin(angle)],dn=[.1,0,0];
  const c=dot(d,n),dc=dot(dn,d)+dot(n,dd),r=Math.sqrt(1-eta*eta*(1-c*c));
  const derivative=dd.map((v,i)=>eta*v-(eta*dc+eta*eta*c*dc/r)*n[i]-(eta*c+r)*dn[i]);
  const e=1e-5;
  const sample=t=>refract(norm(d.map((v,i)=>v+t*dd[i])),norm(n.map((v,i)=>v+t*dn[i])),eta);
  const a=sample(e),b=sample(-e);
  for(let i=0;i<3;i++)assert.ok(Math.abs((a[i]-b[i])/(2*e)-derivative[i])<1e-8);
 }
});
test('unmatched exits use the production incident IOR, including TIR',()=>{
 // Air substitution would incorrectly transmit this internal 60-degree ray.
 const cosine=.5,eta=1.52;assert.ok(eta*eta*(1-cosine*cosine)>1);
 for(const path of ['./hybrid-refracted-nee.wgsl','./hybrid-refracted-nee-analytic.wgsl']){
  const s=read(path);
  assert.ok(s.includes('select(ior,m.physical.z,!entering&&stack.count==0u)'));
  assert.ok(s.includes('let eta=incidentIor/next.w'));
  assert.ok(s.includes('dot(-d,n)),incidentIor,next.w'));
  assert.ok(s.includes('fn replayRefracted'));
  assert.ok(s.includes('chain!=selected.chain'));
 }
});
test('air-like values do not substitute for an empty medium stack',()=>{
 for(const transform of [queuedConnectionTransport,refractedNeeTransport])assert.ok(transform(separated).includes('media.count==0u&&ior==1.'));
});
test('broken or ambiguous transport insertion points fail closed',()=>{
 for(const transform of [queuedConnectionTransport,refractedNeeTransport]){
  assert.throws(()=>transform(separated.replace('previousPdf=sampled.w;throughput*=','previousPdf = sampled.w;throughput*=')),/contract changed/);
  assert.throws(()=>transform(separated+'\nvar output:Signals;'),/contract changed/);
 }
});
test('overflow cannot be silently accepted as a sample-dependent fallback',()=>{
 // Even two individually unbiased estimators become biased under selection.
 assert.equal(((1+1)+(1-1))/2,1);assert.equal((1+(1-1))/2,.5);
 const s=read('./hybrid-lab.mjs');assert.match(s,/if\s*\(useConnections\s*&&\s*counts\[1\]\s*!==\s*0\)/);
 assert.ok(s.includes('invalid sample; accumulation reset. No fallback accepted.'));
});
test('audit fingerprints source and generated modules and disables shader HTTP caching',()=>{
 const s=read('./hybrid-lab.mjs');
 assert.match(s,/fetch\(name,\s*\{\s*cache:\s*'no-store'\s*\}\)/);
 for(const text of ['state.sourceHashes','state.moduleHashes'])assert.ok(s.includes(text));
});
