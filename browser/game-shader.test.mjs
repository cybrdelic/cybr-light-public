import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {gameShader} from './game-shader.mjs';import {instancedShader} from './instanced-shader.mjs';
import {tiledFilter} from './tiled-filter.mjs';
const read=n=>readFileSync(new URL(n,import.meta.url),'utf8');
const build=n=>gameShader(n,(n==='display'?'':read('./experimental-signals/signals.wgsl'))+'\n'+read(`./experimental-signals/${n}.wgsl`));
test('four channels preserve direct+indirect reconstruction',()=>{
 const s=build('trace');assert.match(s,/radianceD\+radianceI\+radianceS\+radianceT/);assert.match(s,/fn accumulate\(value:vec3f\)\{radianceI/);assert.match(s,/firstSegment=bounce<=1u/);
 assert.match(build('display'),/pixels\[i\]\.rgb\+pixels\[i\+3u\*count\]\.rgb/);
 assert.match(build('reconstruct'),/output\[i\]\.indirectMoments/);build('filter');
});
test('all instanced optical medium keys remain two-word identities',()=>{
 const s=instancedShader(build('trace'),read('./trace-instances.wgsl'),34);
 assert.match(s,/let id=vec2u\(u32\(attributes\[h.id\].n0.w\),instanceIdentity\(h\)\)/);
 assert.match(s,/var exitBoundary=vec2u\(0\)/);
});
test('shader ABI drift throws instead of silently misbinding buffers',()=>assert.throws(()=>gameShader('trace','broken'),/contract changed/));
test('RIS generation accepts Windows source newlines and keeps normalized candidate weights',()=>{
 const original=read('./experimental-signals/signals.wgsl')+'\n'+read('./experimental-signals/trace.wgsl');
 for(const n of [2,4,8]){const s=gameShader('trace',original.replaceAll('\r\n','\n').replaceAll('\n','\r\n'),{lightCandidates:n});assert.match(s,/fn reservoirDirect/);assert.ok(s.includes(`total/(${n}.*selectedTarget)`));}
});
test('filter tiles stay within 32 KiB and synchronize before edge returns',()=>{
 for(const step of [1,2,4])for(const channel of [0,1,2,3]){
  const original=build('filter'),s=tiledFilter(original,{step,channel});
  if(step===4&&channel===2){assert.equal(s,original);continue;}
  assert.ok(s.indexOf('workgroupBarrier();')<s.indexOf('if(any(gid.xy>=config.xy))'));
  assert.ok((8+4*step)**2*(channel===2?80:48)<=32768);
 }
});
