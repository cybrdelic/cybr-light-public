import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {incidentTransport} from './hybrid-transport.mjs';
import {rasterSignalTransport} from './hybrid-signals.mjs';
import {instancedShader} from './instanced-shader.mjs';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
test('raster transport uses supplied primary hit and retains secondary tracing',()=>{
 const s=rasterSignalTransport(incidentTransport(read('./trace.wgsl')));
 assert.ok(s.includes('let guide=initialHit;'));
 assert.ok(s.includes('var hit=guide;if(bounce>0u){hit=trace('));
 assert.ok(!s.includes('radiance'));
 assert.equal((s.match(/addSignal\(/g)||[]).length,8);
 assert.ok(s.includes('kind=1u;pending=false;origin=pendingOrigin'));
 assert.ok(s.includes('commitMedium(&media'));
 assert.ok(s.includes('fraction=diffuseFraction(n,wo,direction'));
 assert.throws(()=>rasterSignalTransport(''),/Missing shared transport/);
 const pile=rasterSignalTransport(incidentTransport(instancedShader(read('./trace.wgsl'),read('./trace-instances.wgsl'))));
 assert.ok(pile.includes('let boundary=vec2u(u32(attributes[hit.id].n0.w),instanceIdentity(hit));'));
});
test('fullscreen visibility derives hardware sample locations, not assumed MSAA offsets',()=>{
 const s=read('./hybrid-primary.wgsl');
 assert.ok(s.includes('@interpolate(linear,sample)'));
 assert.ok(s.includes('@builtin(frag_depth)'));
 assert.ok(!s.includes('100.'));
 assert.ok(s.includes('bitcast<u32>(pixel.x)'));
 assert.ok(s.includes('v.pixel+rasterJitterAt'));
});
test('separated histories use ping-pong storage and never primary motion for optical history',()=>{
 const s=read('./hybrid-reconstruct.wgsl');
 assert.ok(s.includes('oldGuide.identity.xyz!=guide.identity.xyz'));
 assert.ok(s.includes('distance(oldGuide.position.xyz,guide.position.xyz)>footprint'));
 assert.ok(s.includes('abs(dot(guide.normal.xyz,normalize(u.eye.xyz-guide.position.xyz)))'));
 assert.ok(s.includes('u.flags.x>.5&&u.flags.y<.5'));
 const moving=s.slice(s.indexOf('if(u.flags.x>.5&&u.flags.y>.5'),s.indexOf('if((lab.mode==11u'));
 assert.ok(!moving.includes('value.specular='));assert.ok(!moving.includes('value.transmission='));
});
test('optical reconstruction has independent endpoint inversion and fail-closed path checks',()=>{
 const s=read('./hybrid-optical.wgsl'),r=read('./hybrid-reconstruct.wgsl');
 for(const check of ['mediumTarget(&media','commitMedium(&media','all(a.identity==b.identity)','oldPrimary.identity.xyz!=primary.identity.xyz','det<=max','distance(pixel,start)>24.','weight<.75'])assert.ok(s.includes(check),check);
 assert.ok(r.includes('opticalHistory(current,previous,false)'));
 assert.ok(r.includes('opticalHistory(current,previous,true)'));
 assert.ok(read('./hybrid-signals.wgsl').includes('lab.mode!=10u&&lab.mode!=11u'));
 assert.ok(!s.includes('result['));
});
test('raster sampling has dedicated uniforms and does not repurpose transport flags',()=>{
 const js=read('./hybrid-lab.mjs'),primary=read('./hybrid-primary.wgsl'),visibility=read('./hybrid-visibility.wgsl');
 assert.match(js,/device.queue.writeBuffer\(controls,\s*16,\s*sampling\)/);
 assert.ok(primary.includes('sampling.z>.5'));
 assert.ok(visibility.includes('rasterJitterAt(u32(sampling.x))'));
 assert.ok(!primary.includes('u.flags.z'));assert.ok(!visibility.includes('u.flags.z'));
});
test('camera movement does not restart the temporal reconstruction sample sequence',()=>{
 const s=read('./hybrid-lab.mjs');
 assert.match(s,/\?\s*reconstructionFrame\s*:\s*referenceFrame/);
 assert.ok(s.includes('reconstructionFrame++'));
 const camera=s.match(/setCamera:\s*async[\s\S]*?(?=steps:\s*async)/)?.[0];
 assert.ok(camera);assert.doesNotMatch(camera,/reconstructionFrame\s*=/);
 assert.match(s,/previousRender\?\.phase\s*\|\|\s*0/);
});
