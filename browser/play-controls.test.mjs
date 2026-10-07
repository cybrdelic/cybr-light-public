import test from 'node:test';import assert from 'node:assert/strict';
import {advanceFlight} from './play-controls.mjs';
const pose={yaw:0,pitch:0,distance:4,target:[0,0,0]},input={lookX:0,lookY:0,forward:0,side:0,up:0,speed:2};
const eye=p=>[p.target[0]+Math.sin(p.yaw)*Math.cos(p.pitch)*p.distance,p.target[1]+Math.sin(p.pitch)*p.distance,p.target[2]+Math.cos(p.yaw)*Math.cos(p.pitch)*p.distance];
test('mouse look rotates about the eye, not the model',()=>{
 const changed=advanceFlight(pose,{...input,lookX:200,lookY:-100},.016);
 eye(changed).forEach((v,i)=>assert.ok(Math.abs(v-eye(pose)[i])<1e-12));
});
test('motion is frame-rate independent, diagonal-normalized and stall-bounded',()=>{
 const move={...input,forward:1};
 const a=advanceFlight(pose,move,.04),b=advanceFlight(advanceFlight(pose,move,.02),move,.02);
 a.target.forEach((v,i)=>assert.ok(Math.abs(v-b.target[i])<1e-12));
 const d=advanceFlight(pose,{...move,side:1},.04);assert.ok(Math.abs(Math.hypot(...d.target)-.08)<1e-12);
 const stalled=advanceFlight(pose,move,2);assert.ok(Math.abs(stalled.target[2]+.1)<1e-12);
});
