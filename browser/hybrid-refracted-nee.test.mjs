import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {incidentTransport} from './hybrid-transport.mjs';
import {rasterSignalTransport} from './hybrid-signals.mjs';
import {causticAuditTransport} from './hybrid-caustic-audit.mjs';
import {refractedNeeTransport} from './hybrid-refracted-nee.mjs';
import {queuedConnectionTransport} from './hybrid-connection-queue.mjs';
import {glassBounds} from './hybrid-glass-bounds.mjs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const transport=incidentTransport(read('./trace.wgsl'));
test('attribution preserves random sequence and all eight transport contributions',()=>{
 const s=causticAuditTransport(transport);
 const body=transport.slice(transport.indexOf('fn incident('));
 assert.equal((s.match(/random\(/g)||[]).length,(body.match(/random\(/g)||[]).length);
 assert.equal((s.match(/addSignal\(/g)||[]).length,8);
 assert.ok(s.includes('scattered=false;refractedTail=false;reflectedTail=false;pending=false'));
 assert.ok(s.includes('m.physical.y<.5){scattered=true;refractedTail=false;reflectedTail=false;'));
});
test('connection and BSDF-hit techniques use complementary PDFs on the same selected root',()=>{
 const s=refractedNeeTransport(rasterSignalTransport(transport));
 assert.ok(s.includes('mis(pdf,brdf.w*connection.probability)'));
 assert.ok(s.includes('mis(previousPdf*connectionProbability,CONNECTION_CHANCE*connection.pdf)'));
 assert.ok(s.includes('dot(connection.direction-connectionDirection,connection.direction-connectionDirection)<2e-7'));
 assert.ok(s.includes('connectionProbability*=1.-f'));
 assert.ok(s.includes('connectionActive=false;pending=false'));
 for(const a of [.001,.1,1,10])for(const b of [.001,.1,1,10])assert.ok(Math.abs(a*a/(a*a+b*b)+b*b/(a*a+b*b)-1)<1e-14);
});
test('root matching compares vector differences, not a near-one float32 dot product',()=>{
 const f=Math.fround;const v=[.3,.4,Math.sqrt(.75)].map(f);
 const length=Math.sqrt(v.reduce((a,b)=>a+b*b,0));const d=v.map(x=>f(x/length));
 const scaled=d.map(x=>f(x*(1-2e-7)));
 const dot=f(f(f(d[0]*scaled[0])+f(d[1]*scaled[1]))+f(d[2]*scaled[2]));
 const error=d.reduce((a,x,i)=>a+(x-scaled[i])**2,0);
 assert.ok(dot<=f(1-1e-7));assert.ok(error<1e-12);
 const q=read('./hybrid-connection-queue.wgsl');
 assert.ok(q.includes('dot(c.direction-item.direction.xyz,c.direction-item.direction.xyz)<2e-7'));
 assert.ok(!q.includes('dot(c.direction,item.direction.xyz)>'));
});
test('queued tracing contains no solver call and preserves complete baseline lighting',()=>{
 const s=queuedConnectionTransport(rasterSignalTransport(transport));
 assert.ok(!s.includes('connectRefracted('));
 assert.ok(s.includes('throughput*m.emission.xyz,weight'));
 assert.ok(s.includes('connectionActive&&connectionCrossed&&lightIndex>0u'));
 assert.ok(s.includes('geometricNormal,metal'));
 const q=read('./hybrid-connection-queue.wgsl');
 assert.ok(q.includes('weight-item.throughput.w'));
 assert.ok(q.includes('atomicLoad(&connectionQueue.overflow)!=0u'));
 assert.ok(q.includes('f32(lab.referenceFrame+1u)'));
});
test('glass rejection bounds contain all triangle vertices and exclude opaque materials',()=>{
 const t=new Float32Array([1,2,3,0,-4,0,1,0,0,5,-2,0,100,100,100,1,1,0,0,0,0,1,0,0]);
 const a=new Float32Array(48);a[3]=7;a[27]=8;const m=new Float32Array(32);m[5]=1;
 const b=glassBounds(t.buffer,a.buffer,m.buffer);assert.equal(b.count,1);
 for(const p of [[1,2,3],[-3,2,4],[1,7,1]])for(let k=0;k<3;k++){assert.ok(b.data[k]<p[k]);assert.ok(b.data[k+4]>p[k]);}
});
test('finite-difference solid-angle Jacobian has correct planar-slab normal-incidence limit',()=>{
 const epsilon=.0005,ior=1.5;
 // Two air units plus one glass unit between receiver and emitting plane.
 const endpoint=s=>{const sinAir=s/Math.sqrt(1+s*s),sinGlass=sinAir/ior;return 2*s+sinGlass/Math.sqrt(1-sinGlass*sinGlass);};
 const derivative=(endpoint(epsilon)-endpoint(-epsilon))/(2*epsilon);
 assert.ok(Math.abs(derivative**2-(2+1/ior)**2)<1e-6);
 const s=read('./hybrid-refracted-nee.wgsl');
 for(const text of ['xp.chain!=center.chain','stack.count==0u&&interfaces>0u','light.e1.w*abs(determinant)/area','commitMedium(&stack','weight*=(1.-f)*eta*eta'])assert.ok(s.includes(text));
});
