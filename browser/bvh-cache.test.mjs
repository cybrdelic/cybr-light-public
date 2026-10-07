import test from 'node:test';
import assert from 'node:assert/strict';
import { createBVHCache } from './bvh-cache.mjs';
const bounds = new Float32Array([0, 0, 0, 1, 1, 1]),
  centers = new Float32Array([0.5, 0.5, 0.5]);
test('cache compares exact inputs and owns copies, including changed geometry under the same key', () => {
  const cache = createBVHCache(1024);
  const b = bounds.slice(),
    first = cache.build('a', b, centers, 1);
  assert.equal(cache.build('a', b, centers, 1), first);
  b[0] = -0.1;
  assert.notEqual(cache.build('a', b, centers, 1), first);
  assert.equal(cache.stats().hits, 1);
  assert.equal(cache.stats().misses, 2);
});
test('cache budget is bounded and detail churn does not evict a resident base template', () => {
  const cache = createBVHCache(176); // two 88-byte one-primitive trees
  const base = cache.build('base', bounds, centers, 1, 6, 1);
  cache.build('detail-a', bounds, centers, 1);
  cache.build('detail-b', bounds, centers, 1);
  assert.equal(cache.build('base', bounds, centers, 1, 6, 1), base);
  assert.ok(cache.stats().bytes <= 176);
  assert.equal(cache.stats().entries, 2);
  cache.clear();
  assert.equal(cache.stats().bytes, 0);
  const small = createBVHCache(1);
  small.build('large', bounds, centers, 1);
  assert.equal(small.stats().bytes, 0);
});
