// Real upstream delivery checks for the additional external gallery payloads.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const browser = new URL('../out/browser/', import.meta.url);
const receipt = JSON.parse(await readFile(new URL('../out/docs/DELIVERY.json', import.meta.url), 'utf8'));
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = new URL(input, browser);
  if (url.protocol === 'file:') return new Response(await readFile(fileURLToPath(url)));
  assert.ok(url.href.startsWith(receipt.base_url));
  const response = await realFetch(url, init);
  assert.equal(response.status, 200, url.href);
  assert.equal(response.headers.get('access-control-allow-origin'), '*', url.href);
  return response;
};
await import(new URL('segmented-fetch.mjs', browser));
const checks = [];
for (const item of receipt.additional_external_files) {
  const response = await fetch(new URL('assets/' + item.path, browser));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/gzip');
  let bytes = 0;
  const digest = createHash('sha256');
  for await (const chunk of response.body) { bytes += chunk.byteLength; digest.update(chunk); }
  const sha256 = digest.digest('hex');
  assert.equal(bytes, item.bytes, item.path);
  assert.equal(sha256, item.sha256, item.path);
  checks.push({path:item.path, bytes, sha256, status:200, cors:'*', contentType:'application/gzip'});
}
console.log(JSON.stringify({asset_commit:receipt.asset_commit, checks}));
