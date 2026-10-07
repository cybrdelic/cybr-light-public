import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildSignalShaders } from './hybrid-shaders.mjs';
import { incidentTransport } from './hybrid-transport.mjs';
import { instancedShader } from './instanced-shader.mjs';

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const hash = (source) => createHash('sha256').update(source).digest('hex');
const defaults = {
  load: read,
  transport: incidentTransport(read('./trace.wgsl')),
  sampling: read('./hybrid-sampling.wgsl'),
  instanced: false,
  sceneName: 'proof-optics',
  opticalMap: 'legacy',
  connectionChance: 0.5,
};

test('default shader assembly does not fetch or include optional experiment implementations', async () => {
  const loaded = [];
  const result = await buildSignalShaders({
    ...defaults,
    load: (name) => {
      loaded.push(name);
      return read(name);
    },
  });
  assert.deepEqual(Object.keys(result), ['signals']);
  assert.deepEqual(loaded, [
    './hybrid-signals.wgsl',
    './hybrid-optical.wgsl',
    './hybrid-reconstruct.wgsl',
  ]);
  assert.ok(!result.signals.includes('fn connectRefracted('));
  assert.ok(!/\/\*(?:OPTICAL|DATA|ZERO|WORLD)_/.test(result.signals));
});

test('refactor preserves independently compiled control and queue kernels byte for byte', async () => {
  const sources = await buildSignalShaders({
    ...defaults,
    experiment: 'refracted-nee',
    derivatives: 'analytic',
    queuedConnections: true,
  });
  // Recorded from the GPU-validated pre-refactor generated modules, not this builder.
  assert.equal(
    hash(sources.control),
    'fd18ce2a682d4559ec3921229615fb03f4dd9c2ef8553017632a0036396edf1b',
  );
  assert.equal(
    hash(sources.queueTrace),
    '4eb13aadc72f6ac44d99169dbaadea541cdd88f7235f9a46572d2d3613800e48',
  );
  assert.equal(
    hash(sources.queueSolve),
    'e5adc65fa71f06d0936d4faa3feb55cc852f941ccefcbc8b283b3467b2609627',
  );
});

test('both derivative variants, inline solver and opted-in optical inverse assemble explicitly', async () => {
  for (const derivatives of ['analytic', 'finite']) {
    const result = await buildSignalShaders({
      ...defaults,
      experiment: 'refracted-nee',
      derivatives,
      opticalMap: 'bilinear-experimental',
    });
    assert.ok(result.signals.includes('const CONNECTION_CHANCE=0.50000;'));
    assert.ok(result.signals.includes('fn opticalHistoryLegacy('));
    assert.ok(!result.signals.includes('fn opticalHistoryBilinear('));
    assert.ok(!result.queueTrace);
  }
});

test('instanced baseline and path cache preserve instance-aware optical and medium identities', async () => {
  const transport = incidentTransport(
    instancedShader(read('./trace.wgsl'), read('./trace-instances.wgsl')),
  );
  for (const experiment of [undefined, 'path-cache']) {
    const result = await buildSignalShaders({
      ...defaults,
      transport,
      instanced: true,
      sceneName: 'example-pile',
      experiment,
    });
    assert.ok(
      result.signals.includes(
        'vec2u(u32(attributes[h.id].n0.w),instanceIdentity(h))',
      ),
    );
    if (experiment) assert.ok(result.pathCache.includes('fn updatePathCache('));
  }
});

test('unsupported solver scenes and changed shader splice contracts fail loudly', async () => {
  await assert.rejects(
    buildSignalShaders({
      ...defaults,
      experiment: 'refracted-nee',
      sceneName: 'example-pile',
    }),
    /restricted/,
  );
  await assert.rejects(
    buildSignalShaders({
      ...defaults,
      experiment: 'refracted-nee',
      derivatives: 'analytic',
      load: (name) =>
        read(name).replace(
          'const CONNECTION_CHANCE=.125;',
          'const CONNECTION_CHANCE=.25;',
        ),
    }),
    /contract changed/,
  );
});

test('optical inverses share one history acceptance implementation', () => {
  const source = read('./hybrid-optical.wgsl');
  assert.equal(source.split('fn gatherOpticalHistory(').length - 1, 1);
  assert.equal(
    source.split(
      'return gatherOpticalHistory(current,previous,transmission,pixel,footprint);',
    ).length - 1,
    2,
  );
  assert.equal(
    source.split('let ratio=currentOptic.weight.rgb/old.weight.rgb;').length -
      1,
    1,
  );
});
