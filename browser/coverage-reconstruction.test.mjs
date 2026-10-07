import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {coverageShader} from './coverage-reconstruction.mjs';
import {gameShader} from './game-shader.mjs';
import {instancedShader} from './instanced-shader.mjs';
const read=n=>readFileSync(new URL(n,import.meta.url),'utf8');
const build=n=>coverageShader(n,gameShader(n,read('./experimental-signals/signals.wgsl')+'\n'+read(`./experimental-signals/${n}.wgsl`)));
test('transport and guides share a reproducible jitter without altering random reference sampling',()=>{
 const s=build('trace');assert.match(s,/select\(coverageJitter\(u.size.z\),randomJitter,u.flags.y>\.5\)/);
 assert.match(s,/radianceD\+radianceI\+radianceS\+radianceT/);
 assert.match(s,/glassBoundary=select\(0.,1.,material\(guide\).physical.y>\.5\)/);
 assert.match(s,/if\(false&&bounce==1u&&trackReflection\)/);
 instancedShader(s,read('./trace-instances.wgsl'),32);
});
test('lighting reprojection accounts for preceding jitter; reference integrates all coverage',()=>{
 const s=build('reconstruct');assert.match(s,/-coverageJitter\(u.size.z-1u\)/);
 assert.match(s,/history=readSignal\(previous\[i\],channel\)/);
});
test('presentation preserves material recomposition and rejects unmatched glass content',()=>{
 const s=read('./coverage-resolve.wgsl');
 assert.match(s,/lighting\[i\].rgb\+lighting\[i\+3u\*count\].rgb/);
 assert.match(s,/sameSecondary\(guide,old\)/);assert.match(s,/distance\(old.secondary.xyz,guide.secondary.xyz\)<footprint/);
 assert.match(s,/let glass=modulation\[indexAt\(guideXY\)\].w>\.5/);
 assert.match(s,/if\(u.flags.y>\.5\|\|u.features.z<\.5\)/);
 assert.match(s,/valid=valid&&all\(oldXY>=vec2i\(0\)\)/);
});
test('transport contract drift fails closed',()=>assert.throws(()=>coverageShader('trace','broken'),/Coverage contract/));
test('coverage modes preserve reference demodulation and own frame resources',()=>{
 const s=read('./app.js');assert.match(read('./renderer-options.mjs'),/\['coverage','coverage-single'\].includes\(reconstruction\)/);
 assert.match(s,/f\[40\]\s*=\s*reference\s*\?\s*0\s*:\s*1/);
 assert.match(s,/frameBuffers.push\(\.\.\.coverageBuffers\)/);
 assert.match(s,/coverageBuffers\[\(state.frame\s*\+\s*1\)\s*%\s*2\]/);
});
test('fused filter retains independent per-signal variance and transmission edge gates',()=>{
 const s=read('./coverage-filter.wgsl');
 assert.match(s,/variance\+=nv\*w\*w/);assert.match(s,/variance\/=max\(total\*total/);
 assert.match(s,/c.secondaryNormal.w!=other.secondaryNormal.w/);
 assert.match(s,/dot\(c.secondaryNormal.xyz,other.secondaryNormal.xyz\)<\.98/);
 assert.match(s,/c.normal.w<\.3/);assert.match(s,/config.z>=4u/);
});
