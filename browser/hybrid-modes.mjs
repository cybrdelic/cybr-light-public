// One source of truth for mode capabilities. GPU entry-point IDs are an ABI.
const diagnosticScope =
  'unit-Lambertian primary diagnostic; full production secondary transport; no primary optical reconstruction';
const rasterScope =
  'sample-exact raster primary visibility; separate diffuse/specular/transmission/emission; no motion reconstruction yet';
const definitions = {
  cache: { id: 0, cache: true, resolve: 'resolve' },
  reference: { id: 1, resolve: 'resolveReference', accumulate: true },
  visibility: { id: 2, resolve: 'resolve' },
  coverage: { id: 3, cache: true, resolve: 'resolve' },
  parity: { id: 4, resolve: 'resolve' },
  beauty: {
    id: 5,
    resolve: 'resolveBeauty',
    accumulate: true,
    scope:
      'uncached original-material beauty reference; six-bounce production transport; no hybrid reconstruction',
  },
  hybrid: {
    id: 6,
    cache: true,
    resolve: 'resolveHybridBeauty',
    accumulate: true,
    experiment: 'beauty-cache',
    scope:
      'rejected experimental beauty cache: visible motion noise and floor-coverage transition; not for production',
  },
  raster: { id: 7, raster: true },
  rasterReference: { id: 8, raster: true },
  rasterOracle: { id: 9, raster: true, oracle: true },
  reconstructed: {
    id: 10,
    raster: true,
    history: true,
    scope:
      'raster primary + validated primary-surface diffuse history; moving specular/transmission histories deliberately reset',
  },
  optical: {
    id: 11,
    raster: true,
    history: true,
    optical: true,
    scope:
      'experimental independent reflection/transmission endpoint reconstruction; unmatched paths reset; not artifact-free',
  },
  pathCache: {
    id: 12,
    raster: true,
    history: true,
    optical: true,
    experiment: 'path-cache',
  },
};

export function availableHybridModes(experiment) {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(definitions)
        .filter(
          ([, mode]) => !mode.experiment || mode.experiment === experiment,
        )
        .map(([name, mode]) => [
          name,
          Object.freeze({
            scope: mode.raster ? rasterScope : diagnosticScope,
            accumulate: !!mode.raster,
            ...mode,
          }),
        ]),
    ),
  );
}
