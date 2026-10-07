import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const verify=vm.runInNewContext(readFileSync(new URL('./verify-reference.js',import.meta.url),'utf8'));
for(const fail of [false,true])test(`reference capture isolates the live page and closes probe (${fail?'failure':'success'})`,async()=>{
 const calls=[];let evaluations=0;
 const probe={
  goto:async url=>calls.push(['goto',url]),
  waitForFunction:async()=>{},
  evaluate:async()=>{
   evaluations++;
   if(evaluations===1)return 'test';
   if(fail&&evaluations===3)throw Error('interrupted');
   if(evaluations===7)return {mode:'reference'};
  },
  locator:()=>({screenshot:async()=>calls.push(['capture'])}),
  close:async()=>calls.push(['close']),
 };
 const owner={
  context:()=>({newPage:async()=>probe}),url:()=> 'http://localhost/renderer?scene=optics',
  bringToFront:async()=>calls.push(['front']),
  evaluate:()=>{throw Error('must not modify live renderer');},
 };
 if(fail)await assert.rejects(()=>verify(owner),/interrupted/);
 else assert.equal((await verify(owner)).mode,'reference');
 assert.deepEqual(calls.slice(-2),[['close'],['front']]);
 assert.equal(calls.filter(([name])=>name==='close').length,1);
});
