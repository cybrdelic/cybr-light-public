import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {incidentTransport} from './hybrid-transport.mjs';
import {rasterSignalTransport} from './hybrid-signals.mjs';
import {pathCacheTransport} from './hybrid-path-cache.mjs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('branch control variate preserves expectation even for wrong signed cache estimates',()=>{
 for(const estimate of [-10,0,.1,10,100])for(const actual of [0,.01,1,100]){
  const p=.25,terminated=estimate,continued=estimate+(actual-estimate)/p;
  assert.ok(Math.abs((1-p)*terminated+p*continued-actual)<1e-12);
 }
});
test('constant-cache roulette is not falsely classified as variance reduction',()=>{
 const p=.25,values=[0,0,0,4],mean=1;
 const originalVariance=values.reduce((a,x)=>a+(x-mean)**2,0)/values.length;
 const variance=(1-p)*0+values.reduce((a,x)=>a+p*((x-mean)/p)**2,0)/values.length;
 assert.equal(variance,originalVariance/p);
 assert.ok(variance>originalVariance);
});
test('cache build uses independent full transport and correct remaining depth',()=>{
 const t=incidentTransport(read('./trace.wgsl')),s=pathCacheTransport(t,rasterSignalTransport(t));
 const build=s.slice(0,s.indexOf('fn rasterTransport('));
 assert.ok(build.includes('min(budget,16u)'));assert.ok(!build.includes('pathLookup('));
 assert.ok(s.includes('min(u.size.w,16u)-bounce'));
 assert.ok(s.includes('(kind==1u||kind==2u)'));
 assert.ok(s.includes('-throughput*cached.rgb/survive'));
 assert.ok(s.includes('ior==1.&&all(medium==vec3f(0))'));
});
test('cache publication and identity checks fail closed',()=>{
 const s=read('./hybrid-path-cache.wgsl');
 for(const text of ['state!=2u','any(key!=identity)','directionKey!=directionKey','lab.epoch,budget','atomicCompareExchangeWeak','value.w<16.'])assert.ok(s.includes(text),text);
});
