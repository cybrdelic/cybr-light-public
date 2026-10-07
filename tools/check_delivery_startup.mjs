// Worker imports must finish before a delayed delivery manifest becomes ready.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = new URL('../out/browser/', import.meta.url);
const mapping = JSON.parse(await readFile(new URL('asset-parts.json', browser), 'utf8'));
let release;
let manifestRequests = 0;
globalThis.fetch = async input => {
  const url = new URL(input, browser);
  if (url.pathname.endsWith('/asset-parts.json')) {
    manifestRequests++;
    await new Promise(resolve => { release = resolve; });
    return Response.json(mapping);
  }
  return new Response('unchanged local response');
};
await import(new URL('segmented-fetch.mjs', browser));
assert.equal(manifestRequests, 0, 'Import cannot wait for network metadata');
assert.equal(await (await fetch(new URL('shader.wgsl', browser))).text(), 'unchanged local response');
assert.equal(manifestRequests, 0, 'Shader/source requests do not depend on asset metadata');
const pending = fetch(new URL('assets/unmapped.json', browser));
assert.equal(manifestRequests, 1);
release();
assert.equal(await (await pending).text(), 'unchanged local response');
await fetch(new URL('assets/another-unmapped.json', browser));
assert.equal(manifestRequests, 1, 'One cached manifest serves later asset requests');
console.log('PASS: synchronous worker imports; delayed manifest waits inside asset fetch only');
