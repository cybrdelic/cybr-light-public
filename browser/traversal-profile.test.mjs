import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {traversalProfileShader,summarizeTraversal} from './traversal-profile.mjs';
test('counts traversal only, not medium stack pops',()=>{
 const source=readFileSync(new URL('./trace.wgsl',import.meta.url),'utf8');const code=traversalProfileShader(source);
 assert.ok(code.includes('count--;traversalCounts.y++;let'));
 assert.ok(code.includes('(*stack).count--;'));assert.ok(!code.includes('(*stack).count--;traversalCounts'));
 assert.ok(code.includes('traversalStats[index]=vec4f(traversalCounts)'));
});
test('summary reports per-pixel counts, not timings',()=>{assert.deepEqual(summarizeTraversal([1,2,3,4,3,4,5,6]).traceCalls,{mean:2,p95:3,max:3});});
