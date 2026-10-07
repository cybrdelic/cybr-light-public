import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rendererOptions } from './renderer-options.mjs';
import { buildRendererShader } from './renderer-shaders.mjs';
import {
  transportIntegrity,
  cameraMediumShader,
  outsideSceneBounds,
} from './transport-integrity.mjs';
const load = (name) => readFile(new URL(name, import.meta.url), 'utf8');

test('outside specialization uses strict bounds and retains the general boundary path', async () => {
  const bounds=[-1,-2,-3,1,2,3];
  assert.equal(outsideSceneBounds([0,0,0],bounds),false);
  assert.equal(outsideSceneBounds([1,2,3],bounds),false);
  for(const eye of [[1.001,0,0],[0,-2.001,0],[0,0,3.001]])
    assert.equal(outsideSceneBounds(eye,bounds),true);
  const parameters=new URLSearchParams('transport=corrected');
  for(const name of ['trace','trace-pile','trace-meshlets']){
    const source=await buildRendererShader('outside-'+name,{load,parameters,options:rendererOptions(parameters)});
    assert.ok(!source.includes('var<storage,read> cameraMedium'));
    assert.ok(source.includes('initializeCameraStack'));
  }
});
test('transport corrections compose across ordinary, instanced and packed attributes', async () => {
  for (const name of ['trace', 'trace-pile', 'trace-meshlets']) {
    const parameters = new URLSearchParams('transport=corrected'),
      options = rendererOptions(parameters);
    const s = await buildRendererShader(name, { load, parameters, options });
    assert.ok(s.includes('initializeCameraStack(&media)'));
    assert.ok(s.includes('scatteringDepth>=min(u.size.w,16u)'));
    assert.ok(s.includes('interfaces>=24u||(entering&&media.count>=16u)'));
    assert.ok(
      s.includes('throughput*=masking(abs(dot(n,direction)),opticalAlpha)'),
    );
    const c = await buildRendererShader('camera-' + name, {
      load,
      parameters,
      options,
    });
    assert.equal((c.match(/@compute/g) || []).length, 1);
    assert.ok(c.includes('var<storage,read_write> cameraMedium'));
    if (name === 'trace-pile') assert.ok(c.includes('instanceIdentity(h)'));
    if (name === 'trace-meshlets') assert.ok(!c.includes('attributes['));
  }
});
test('legacy and experimental backends retain their transport contracts', () => {
  for (const query of [
    '',
    'transport=legacy',
    'transport=corrected&backend=signals',
    'transport=corrected&aa=adaptive',
    'transport=corrected&cache=screen',
    'transport=corrected&profileTraversal=1',
  ])
    assert.equal(
      rendererOptions(new URLSearchParams(query)).transportIntegrity,
      false,
    );
  assert.throws(() => transportIntegrity(''), /contract/);
  assert.throws(() => cameraMediumShader(''), /Missing/);
});
test('LOD retains detail within the hysteresis band without delaying promotion', async () => {
  const s = await load('instance-lod.wgsl');
  assert.ok(s.includes('select(48.,40.,wasDetailed)'));
  const update = (pixels, detailed) => pixels > (detailed ? 40 : 48);
  let detailed = false;
  for (const p of [49, 47, 48, 44, 41]) {
    detailed = update(p, detailed);
    assert.equal(detailed, true);
  }
  assert.equal(update(39, detailed), false);
});
