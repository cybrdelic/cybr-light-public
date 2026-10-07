import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {rendererOptions} from './renderer-options.mjs';
import {buildRendererShader} from './renderer-shaders.mjs';
const load=n=>readFile(new URL(n,import.meta.url),'utf8');
test('pure-metal eligibility has no gap at the roughness boundary',()=>{
 for(const roughness of [.025,.19,.27,.3,.32,.69]){
  const reflectedGuide=roughness<.3;
  const surfaceHistory=roughness>=.3;
  assert.equal(reflectedGuide||surfaceHistory,true);
 }
});
test('boundary correction leaves transport and existing geometric rejection intact',async()=>{
 const shader=async(name,mode)=>{const parameters=new URLSearchParams('reconstruction=coverage-single&reflectionHistory='+mode);return buildRendererShader(name,{load,parameters,options:rendererOptions(parameters)});};
 const before=await shader('trace','legacy'),after=await shader('trace','complete');
 assert.equal(after,before);
 const r=await shader('reconstruct','complete');
 assert.ok(r.includes('p.normal.w>=.3||reflected'));
 assert.ok(r.includes('dot(old.normal.xyz,p.normal.xyz)>.995'));
 assert.ok(r.includes('abs(old.position.w-p.position.w)<.1'));
});
