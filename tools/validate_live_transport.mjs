// Exercise the deployed transport adapter against actual packaged parts, CPU only.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const browser = new URL('../dist/browser/', import.meta.url);
globalThis.fetch = async input => {
  try { return new Response(await readFile(fileURLToPath(new URL(input, browser)))); }
  catch { return new Response('missing', {status: 404}); }
};
const mapping = JSON.parse(await readFile(new URL('asset-parts.json', browser), 'utf8'));
await import('../dist/browser/segmented-fetch.mjs');
for (const [name, expected] of Object.entries(mapping)) {
  const response = await fetch(new URL(name, browser));
  assert.equal(response.status, 200);
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of response.body) { hash.update(chunk); bytes += chunk.byteLength; }
  assert.equal(bytes, expected.bytes, name + ': compressed byte length');
  assert.equal(hash.digest('hex'), expected.sha256, name + ': original compressed SHA-256');
  console.log('PASS:', name, bytes, 'original compressed bytes');
}
console.log('PASS: transport adapter; no browser/GPU launched');
