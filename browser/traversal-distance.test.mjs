import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {traversalDistance} from './traversal-distance.mjs';
import {buildRendererShader} from './renderer-shaders.mjs';
import {rendererOptions} from './renderer-options.mjs';
const load=n=>readFile(new URL(n,import.meta.url),'utf8');

test('cached child bounds preserve near-first order and shrinking hit limits',()=>{
 for(const a of [0,.5,2,9])for(const b of [0,.5,2,9])for(const limit of [.1,1,5,10]){
  const accepted=[{id:1,t:a},{id:2,t:b}].filter(n=>n.t<limit);
  // Matches WGSL select: ties visit the right child first.
  accepted.sort((x,y)=>x.t-y.t||y.id-x.id);
  const stack=[];
  if(a<limit&&b<limit){stack.push(a<b?{id:2,t:b}:{id:1,t:a},a<b?{id:1,t:a}:{id:2,t:b});}
  else if(a<limit)stack.push({id:1,t:a});else if(b<limit)stack.push({id:2,t:b});
  assert.deepEqual(stack.reverse(),accepted);
  for(const updated of [.05,.75,3,8])assert.deepEqual(stack.filter(n=>n.t<updated),accepted.filter(n=>n.t<updated));
 }
});
test('both stacks use cached distances with root rejection and ground fallback intact',async()=>{
 for(const query of ['distanceStack=1','distanceStack=1&optics=paths','distanceStack=1&transport=corrected','distanceStack=1&profileTraversal=1']){
  const parameters=new URLSearchParams(query);
  const s=await buildRendererShader('trace-pile',{load,parameters,options:rendererOptions(parameters),stackCapacity:24});
  assert.equal((s.match(/var stack:array<vec2u,24>/g)||[]).length,2);
  assert.equal((s.match(/bitcast<f32>\(entry.y\)>=hit.t/g)||[]).length,2);
  assert.ok(!s.includes('nodes[stack[count]]'));
  assert.ok(s.includes('else{count=0u;}'));
  assert.ok(s.includes('if(lighting.info.x<.5&&abs(d.y)>1e-8)'));
 }
 assert.throws(()=>traversalDistance(''),/contract/);
});
