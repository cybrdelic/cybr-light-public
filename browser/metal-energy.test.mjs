import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  directionalEnergy,
  lookupEnergy,
  packMetalEnergy,
} from './metal-energy-table.mjs';
import { metalEnergyShader } from './metal-energy.mjs';
import { rendererOptions } from './renderer-options.mjs';
const table = JSON.parse(
  await readFile(new URL('metal-energy-table.json', import.meta.url), 'utf8'),
);
test('main renderer enables compensated metal with an explicit legacy comparison mode', () => {
  assert.equal(rendererOptions(new URLSearchParams()).metalCompensation, true);
  assert.equal(
    rendererOptions(new URLSearchParams('metalEnergy=legacy'))
      .metalCompensation,
    false,
  );
  assert.equal(
    rendererOptions(new URLSearchParams('backend=signals')).metalCompensation,
    false,
  );
});
test('compensated unit conductor passes furnace across view and roughness', () => {
  for (const rough of [0.1, 0.25, 0.5, 0.8, 1])
    for (const mu of [0.05, 0.2, 0.5, 1]) {
      const single = directionalEnergy(mu, rough, 65536),
        [e] = lookupEnergy(table, mu, rough);
      assert.ok(
        Math.abs(single + (1 - e) - 1) < 0.008,
        `r=${rough}, mu=${mu}, energy=${single + 1 - e}`,
      );
    }
  const energy = directionalEnergy(1, 1, 65536);
  assert.ok(Math.abs(energy - (1 - Math.log(2))) < 1e-4);
});
test('lookup average matches integral of lookup, preventing compensation normalization drift', () => {
  for (const rough of [0.15, 0.5, 0.75, 1]) {
    let integral = 0;
    for (let i = 0; i < 10000; i++) {
      const mu = (i + 0.5) / 10000;
      integral += (2 * mu * lookupEnergy(table, mu, rough)[0]) / 10000;
    }
    assert.ok(Math.abs(integral - lookupEnergy(table, 1, rough)[1]) < 1e-6);
  }
});
test('table packing preserves portals and fails closed for invalid data', () => {
  const portals = Float32Array.from({ length: 24 }, (_, i) => i),
    packed = packMetalEnergy(portals, table);
  assert.deepEqual(packed.slice(0, 24), portals);
  assert.equal(packed[24], Math.fround(table[0]));
  assert.throws(() => packMetalEnergy([], []), /Invalid/);
  assert.throws(() => metalEnergyShader(''), /contract/);
});
