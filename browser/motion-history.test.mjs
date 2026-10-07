import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {motionHistoryShader,motionHistoryMode} from './motion-history.mjs';
import {rendererOptions} from './renderer-options.mjs';

test('page applies motion defaults before deriving its shader mode',()=>{
 const source=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const start=source.indexOf('const parameters = new URLSearchParams(location.search);');
 const end=source.indexOf('const galleryControls',start);
 assert.ok(start>=0&&end>start);
 const initialize=new Function('location','rendererOptions',source.slice(start,end)+'return {motionReconstruction,glass:parameters.get("glass")};');
 assert.deepEqual(initialize({search:''},rendererOptions),{motionReconstruction:'bilinear',glass:'split'});
 assert.deepEqual(initialize({search:'?motion=legacy&glass=stochastic'},rendererOptions),{motionReconstruction:'legacy',glass:'stochastic'});
 assert.equal(initialize({search:'?motion=confidence'},rendererOptions).motionReconstruction,'legacy');
});
test('main renderer and previously shared candidate links restore prior history',()=>{
 assert.equal(motionHistoryMode(null),'legacy');assert.equal(motionHistoryMode('legacy'),'legacy');
 assert.equal(motionHistoryMode('confidence'),'legacy');
 assert.equal(motionHistoryMode('bilinear'),'bilinear');assert.equal(motionHistoryMode(null,true),'legacy');
});
test('long history requires full diffuse coverage and does not relax rejection',()=>{
 const original=readFileSync(new URL('./reconstruct.wgsl',import.meta.url),'utf8');
 const candidate=motionHistoryShader(original);
 assert.match(candidate,/stableDiffuse&&diffuseCoverage>\.98&&p.normal.w>\.55/);
 for(const guard of ['old.moments.w!=0.','dot(old.normal.xyz,p.normal.xyz)<.98','abs(dot(delta,p.normal.xyz))>tolerance','length(delta)>max(tolerance,footprint)','if(transmitted){cap=select(3.,7.,stableGuide);}','history.color.rgb,low,high'])assert.ok(candidate.includes(guard));
 assert.match(candidate,/if\(total>\.5\)\{diffuseCoverage=total;/);
 assert.match(candidate,/sampleVariance\/neighborhoodCount\+historyVariance\/max\(history.color.w,1.\)/);
 assert.match(candidate,/if\(!consistent\).*diffuseCoverage=0/);
 assert.match(candidate,/3\.\*uncertainty\+\.005/);
});
test('history shader drift fails closed',()=>assert.throws(()=>motionHistoryShader('bad'),/contract changed/));

test('diagnostic mode changes update the actual uniform mode, not just the URL parameters',async()=>{
 const source=readFileSync(new URL('./app.js',import.meta.url),'utf8');
 const start=source.indexOf('async function verifyOptions('),end=source.indexOf('window.cybrLight =',start);
 const create=new Function('motionHistoryMode',`const parameters=new URLSearchParams('motion=bilinear');const separateSignals=false;let motionReconstruction='bilinear';const configs=[];const device={queue:{onSubmittedWorkDone:async()=>{}}};const setPaused=()=>{},reset=()=>{};${source.slice(start,end)}return {verifyOptions,mode:()=>motionReconstruction};`);
 const api=create(motionHistoryMode);await api.verifyOptions({motion:false});assert.equal(api.mode(),'legacy');await api.verifyOptions({motion:true});assert.equal(api.mode(),'bilinear');
});
