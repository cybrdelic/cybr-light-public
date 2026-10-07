// Exercise the production worker without a browser, network, asset pack or GPU.
import assert from 'node:assert/strict';

globalThis.self = {};
globalThis.fetch = async (url) => {
  throw Error('Built-in proof scene unexpectedly requires an external asset: ' + url);
};
let result;
globalThis.postMessage = (message) => {
  if (message.error || message.triangles) result = message;
};
await import('../browser/bvh-worker.js');
for (const name of ['proof-optics', 'proof-metals', 'proof-indirect']) {
  result = undefined;
  await self.onmessage({data: {
    module: name, base: 'http://127.0.0.1/assets/',
    maxStorageBytes: 256 * 1024 * 1024,
  }});
  assert.ok(result, name + ': worker produced no geometry');
  assert.equal(result.error, undefined, name + ': ' + result.error);
  assert.ok(result.count > 0 && result.nodeCount > 0, name + ': empty BVH');
  for (const field of ['triangles', 'attributes', 'nodes', 'materials', 'lighting']) {
    assert.ok(result[field] instanceof ArrayBuffer && result[field].byteLength > 0,
      name + ': missing ' + field);
  }
  for (const field of ['materials', 'lighting']) {
    assert.ok([...new Float32Array(result[field])].every(Number.isFinite),
      name + ': nonfinite ' + field);
  }
  console.log('PASS:', name, result.count, 'triangles;', result.nodeCount,
    'BVH nodes; zero external asset requests');
}
