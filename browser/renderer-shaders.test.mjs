import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { rendererOptions } from './renderer-options.mjs';
import { buildRendererShader } from './renderer-shaders.mjs';

const load = (name) => readFile(new URL(name, import.meta.url), 'utf8');
// Captured from app.js before extraction, not regenerated from the new builder.
// Update only for an intentional renderer change with its own visual validation.
const fixtures = JSON.parse(
  await load('./test-fixtures/renderer-shader-hashes.json'),
);
for (const { query, name, hash } of fixtures) {
  test(`shader source parity: ${name} / ${query || 'default'}`, async () => {
    const parameters = new URLSearchParams(query);
    // Preserve the pre-correction extraction baseline; new transport has its
    // own numerical/runtime tests and can be compared using transport=legacy.
    parameters.set('transport','legacy');
    parameters.set('referenceHistory','legacy');
    parameters.set('metalEnergy','legacy');
    parameters.set('distanceStack','0');
    parameters.set('reflectionHistory','legacy');
    parameters.set('terminalEmission','0');
    if(!parameters.has('reconstruction'))parameters.set('reconstruction','baseline');
    if (!parameters.has('glass')) parameters.set('glass', 'split');
    if (!parameters.has('motion')) parameters.set('motion', 'bilinear');
    const code = await buildRendererShader(name, {
      load,
      parameters,
      options: rendererOptions(parameters),
    });
    assert.equal(createHash('sha256').update(code).digest('hex'), hash);
  });
}
