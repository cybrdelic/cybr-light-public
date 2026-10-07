// Exercise the deployed transport adapter against actual packaged parts, CPU only.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const browser = new URL(process.argv.includes('--client') ? '../dist/client/browser/' : '../dist/browser/', import.meta.url);
const original = new URL('../dist/browser/', import.meta.url);
const inputs = JSON.parse(await readFile(new URL('../docs/LIVE_ASSET_INPUTS.json', import.meta.url), 'utf8'));
globalThis.fetch = async input => {
  try {
    const url = new URL(input, browser);
    const path = url.protocol === 'https:' && url.href.startsWith(inputs.base_url)
      ? new URL('assets/' + url.href.slice(inputs.base_url.length), original) : url;
    return new Response(await readFile(fileURLToPath(path)));
  }
  catch { return new Response('missing', {status: 404}); }
};
const mapping = JSON.parse(await readFile(new URL('asset-parts.json', browser), 'utf8'));
await import(new URL('segmented-fetch.mjs', browser));
for (const [name, expected] of Object.entries(mapping)) {
  const response = await fetch(new URL(name, browser));
  assert.equal(response.status, 200);
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of response.body) { hash.update(chunk); bytes += chunk.byteLength; }
  assert.equal(bytes, expected.bytes, name + ': compressed byte length');
  assert.equal(hash.digest('hex'), expected.sha256, name + ': original compressed SHA-256');
  console.log('PASS:', name, bytes, 'original compressed bytes');
}
if (process.argv.includes('--client')) {
  for (const record of Object.values(mapping)) for (const part of record.parts) {
    assert.equal(part.url, inputs.base_url + part.path.slice('assets/'.length));
    const pinned = inputs.files.find(item => item.path === part.path.slice('assets/'.length));
    assert.equal(part.sha256, pinned.sha256);
    assert.equal(part.bytes, pinned.bytes);
  }
  console.log('PASS: deployed part URLs match the pinned public input manifest');
}
console.log('PASS: transport adapter; no browser/GPU launched');
