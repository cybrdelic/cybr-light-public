import test from 'node:test';
import assert from 'node:assert/strict';
import { availableHybridModes } from './hybrid-modes.mjs';

test('mode IDs preserve the GPU ABI and experimental modes stay opt-in', () => {
  const defaults = availableHybridModes();
  assert.deepEqual(
    Object.values(defaults).map((m) => m.id),
    [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11],
  );
  assert.equal(defaults.hybrid, undefined);
  assert.equal(defaults.pathCache, undefined);
  assert.equal(availableHybridModes('beauty-cache').hybrid.id, 6);
  assert.equal(availableHybridModes('path-cache').pathCache.id, 12);
  assert.ok(!Object.hasOwn(defaults, 'toString'));
  assert.throws(() => {
    defaults.optical.id = 0;
  }, TypeError);
});

test('mode capabilities preserve pass scheduling and sampling histories', () => {
  const modes = {
    ...availableHybridModes('beauty-cache'),
    ...availableHybridModes('path-cache'),
  };
  for (const [name, mode] of Object.entries(modes)) {
    assert.equal(
      !!mode.raster,
      [
        'raster',
        'rasterReference',
        'rasterOracle',
        'reconstructed',
        'optical',
        'pathCache',
      ].includes(name),
      name,
    );
    assert.equal(
      !!mode.cache,
      ['cache', 'coverage', 'hybrid'].includes(name),
      name,
    );
    assert.equal(
      !!mode.history,
      ['reconstructed', 'optical', 'pathCache'].includes(name),
      name,
    );
    assert.equal(!!mode.optical, ['optical', 'pathCache'].includes(name), name);
    assert.equal(
      mode.accumulate,
      !!mode.raster || ['reference', 'beauty', 'hybrid'].includes(name),
      name,
    );
  }
  assert.equal(modes.reference.resolve, 'resolveReference');
  assert.equal(modes.beauty.resolve, 'resolveBeauty');
  assert.equal(modes.hybrid.resolve, 'resolveHybridBeauty');
  assert.equal(modes.rasterOracle.oracle, true);
});
