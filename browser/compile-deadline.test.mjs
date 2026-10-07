import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompileDeadline} from './compile-deadline.mjs';
const fixture=()=>{let fire,cleared=false;const deadline=createCompileDeadline({setTimer:callback=>{fire=callback;return 7;},clearTimer:id=>{assert.equal(id,7);cleared=true;}});return {deadline,fire:()=>fire(),cleared:()=>cleared};};
test('deadline bounds a stalled startup prefix before pipeline compilation',async()=>{
 const {deadline,fire}=fixture(),pending=deadline.wait(new Promise(()=>{}));fire();
 await assert.rejects(pending,/Startup comparison did not finish within 40 seconds/);assert.equal(deadline.expired,true);deadline.close();
});
test('one deadline bounds later stages after earlier startup steps completed',async()=>{
 const {deadline,fire}=fixture();assert.equal(await deadline.wait(Promise.resolve('adapter')),'adapter');
 const pending=deadline.wait(new Promise(()=>{}));fire();await assert.rejects(pending,/Startup comparison/);deadline.close();
});
test('a device delivered after timeout is destroyed instead of starting late work',async()=>{
 const {deadline,fire}=fixture();let deliver,destroyed=0;
 const pending=deadline.wait(new Promise(resolve=>{deliver=resolve;}),device=>device.destroy());fire();await assert.rejects(pending);
 deliver({destroy(){destroyed++;}});await Promise.resolve();assert.equal(destroyed,1);deadline.close();
});
test('closing a successful check clears its timer without losing the result',async()=>{
 const {deadline,cleared}=fixture();assert.equal(await deadline.wait(Promise.resolve(42)),42);deadline.close();assert.equal(cleared(),true);assert.equal(deadline.expired,false);
});
