import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {diffuseHistoryShader} from './diffuse-history.mjs';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
test('diffuse albedo metadata has a non-optical sentinel and excludes metals/glass',()=>{
 const code=diffuseHistoryShader(read('trace.wgsl'),'trace');
 assert.match(code,/gm\.physical\.x<\.001&&gm\.physical\.y<\.5&&gm\.base\.w>\.55/);
 assert.match(code,/vertexColor\(guide\),-1\./);
 assert.match(code,/samples\[index\]=Pixel/);
});
test('all geometry rejection remains; rough diffuse clamp exception checks albedo',()=>{
 const code=diffuseHistoryShader(read('reconstruct.wgsl'),'reconstruct');
 assert.match(code,/old\.secondaryNormal\.w>=-\.5/);
 assert.match(code,/history\.secondaryNormal\.w<-\.5/);
 assert.match(code,/stableDiffuse&&p\.normal\.w>\.55&&history\.color\.w>1\.&&sameAlbedo/);
 assert.match(code,/if\(!diffuseLighting\)\{history\.color=vec4f\(clamp/);
 assert.match(code,/if\(u\.flags\.y>\.5&&!moving&&u\.size\.z>0u\)/);
 assert.match(code,/var cap=7\./);
});
test('fail closed on shader contract changes',()=>{
 assert.throws(()=>diffuseHistoryShader('', 'trace'));
 assert.throws(()=>diffuseHistoryShader('', 'reconstruct'));
});
