import test from 'node:test';
import assert from 'node:assert/strict';
import { rendererOptions } from './renderer-options.mjs';

test('feature compatibility preserves storage ABI and exclusive profiling paths', () => {
  for (const reconstruction of ['', 'coverage', 'contributors'])
    for (const backend of ['', 'signals'])
      for (const optics of ['', 'guides'])
        for (const cache of ['', 'endpoint', 'screen'])
          for (const aa of ['', 'adaptive'])
            for (const primary of ['', 'shared'])
              for (let mask = 0; mask < 8; mask++) {
                const p = new URLSearchParams({
                  reconstruction,
                  backend,
                  optics,
                  cache,
                  aa,
                  primary,
                  profileTraversal: String(mask & 1),
                  profileVisibility: String((mask >> 1) & 1),
                  profileRejection: String((mask >> 2) & 1),
                });
                const before = p.toString(),
                  o = rendererOptions(p);
                const separated =
                  backend === 'signals' ||
                  reconstruction === 'coverage' ||
                  optics === 'guides' ||
                  cache === 'endpoint';
                assert.equal(o.separateSignals, separated);
                assert.equal(
                  o.pixelBytes,
                  separated ? (optics === 'guides' ? 224 : 192) : 96,
                );
                assert.equal(o.signalCount, separated ? 4 : 1);
                assert.equal(
                  o.adaptiveAA,
                  !separated &&
                    reconstruction !== 'contributors' &&
                    aa === 'adaptive' &&
                    primary !== 'shared',
                );
                assert.equal(
                  o.screenCacheEnabled,
                  !separated && !o.adaptiveAA && cache === 'screen',
                );
                assert.equal(
                  o.traversalProfiling,
                  !!(mask & 1) &&
                    !separated &&
                    !o.adaptiveAA &&
                    !o.screenCacheEnabled,
                );
                assert.equal(
                  o.visibilityProfiling,
                  !!(mask & 2) &&
                    !separated &&
                    !o.adaptiveAA &&
                    !o.screenCacheEnabled &&
                    !o.traversalProfiling,
                );
                assert.equal(p.toString(), before);
              }
});

test('opt-in filter/history defaults and rejected motion fallback remain unchanged', () => {
  const get = (query) => rendererOptions(new URLSearchParams(query));
  assert.equal(get('').fusedCoverageFilter, false);
  assert.equal(get('backend=signals').signalDiffuseHistory, true);
  assert.equal(
    get('backend=signals&signalDiffuseHistory=legacy').signalDiffuseHistory,
    false,
  );
  assert.equal(get('optics=guides').fusedCoverageFilter, true);
  assert.equal(get('optics=guides&fused=0').fusedCoverageFilter, false);
  assert.equal(get('motion=confidence').motionReconstruction, 'legacy');
  assert.equal(get('motion=bilinear').motionReconstruction, 'bilinear');
  assert.throws(() => {
    get('').pixelBytes = 0;
  }, TypeError);
});
