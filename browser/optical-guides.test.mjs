import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {gameShader} from './game-shader.mjs';import {opticalGuideShader} from './optical-guides.mjs';
const read=f=>readFileSync(new URL(f,import.meta.url),'utf8');
test('independent reflected metadata reaches every consumer',()=>{
 for(const name of ['trace','filter','reconstruct']){
  const s=opticalGuideShader(name,gameShader(name,read('experimental-signals/signals.wgsl')+'\n'+read(`experimental-signals/${name}.wgsl`)));
  assert.ok(s.includes('reflectedPosition:vec4f,reflectedNormal:vec4f'));
  assert.ok(s.includes('s.reflectedPosition,s.reflectedNormal'));
  if(name==='trace')assert.ok(s.includes('reflectedEdge.position,reflectedEdge.normal)'));
  if(name==='filter')assert.ok(s.includes('CHANNEL==2u||CHANNEL==1u'));
  if(name==='reconstruct')assert.ok(s.includes('output[i].reflectedPosition=current[i].reflectedPosition'));
 }
});
test('fused kernel uses independent optical guides without changing diffuse filtering',()=>{
 const source=gameShader('filter',read('experimental-signals/signals.wgsl'))+'\n'+read('coverage-filter.wgsl');
 const s=opticalGuideShader('fused-filter',source);
 assert.ok(s.includes('geometry.y=kernel(x)*kernel(y)'));assert.ok(s.includes('geometry.z=kernel(x)*kernel(y)'));
 assert.ok(s.includes('other.reflectedPosition.xyz-c.reflectedPosition.xyz'));assert.ok(s.includes('if(c.secondaryNormal.w>1.5){viewDependent.z=false;}'));
});
