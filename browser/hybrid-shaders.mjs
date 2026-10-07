// Shader composition only: no DOM, device, buffers, or mutable renderer state.
// The loader is injected so every variant can be checked without a GPU.
import { rasterSignalTransport } from './hybrid-signals.mjs';
import { pathCacheTransport } from './hybrid-path-cache.mjs';
import { causticAuditTransport } from './hybrid-caustic-audit.mjs';
import { refractedNeeTransport } from './hybrid-refracted-nee.mjs';
import { queuedConnectionTransport } from './hybrid-connection-queue.mjs';

function replaceOnce(source, marker, replacement) {
  if (source.split(marker).length !== 2) {
    throw Error('Hybrid shader contract changed: ' + marker);
  }
  return source.replace(marker, replacement);
}

export async function buildSignalShaders({
  load,
  transport,
  sampling,
  instanced,
  sceneName,
  experiment,
  opticalMap,
  derivatives,
  connectionChance,
  queuedConnections,
  legacyReplay,
}) {
  const signals = (await load('./hybrid-signals.wgsl'))
    .replaceAll('/*ZERO_INSTANCE*/', instanced ? ',0u' : '')
    .replaceAll('/*DATA_INSTANCE*/', instanced ? ',data.y' : '')
    .replaceAll(
      '/*WORLD_POINT*/',
      instanced
        ? 'let transform=nodes[data.y];p=rotateInstance(normalize(transform.high),p*dot(transform.high,transform.high))+transform.low.xyz;'
        : '',
    );
  let optical = (await load('./hybrid-optical.wgsl'))
    .replaceAll(
      '/*OPTICAL_INSTANCE*/',
      instanced ? 'instanceIdentity(h)' : '0u',
    )
    .replaceAll(
      '/*OPTICAL_BOUNDARY*/',
      instanced
        ? 'vec2u(u32(attributes[h.id].n0.w),instanceIdentity(h))'
        : 'u32(attributes[h.id].n0.w)',
    );
  if (opticalMap === 'bilinear-experimental') {
    optical = replaceOnce(
      optical,
      'fn opticalHistory(',
      'fn opticalHistoryLegacy(',
    );
    optical = replaceOnce(
      optical,
      'fn opticalHistoryBilinear(',
      'fn opticalHistory(',
    );
  }

  const baseline = rasterSignalTransport(transport);
  let separated =
    experiment === 'caustic-audit'
      ? causticAuditTransport(transport)
      : baseline;
  let connection = '';
  const refracted = experiment === 'refracted-nee';
  if (refracted) {
    if (sceneName !== 'proof-optics' || instanced) {
      throw Error(
        'Refracted NEE is currently restricted to the nested-glass proof scene',
      );
    }
    const file =
      derivatives === 'analytic'
        ? './hybrid-refracted-nee-analytic.wgsl'
        : './hybrid-refracted-nee.wgsl';
    connection = replaceOnce(
      await load(file),
      '/*NEE_BOUNDARY*/',
      'u32(attributes[h.id].n0.w)',
    );
    connection = replaceOnce(
      connection,
      'const CONNECTION_CHANCE=.125;',
      `const CONNECTION_CHANCE=${connectionChance.toFixed(5)};`,
    );
    if (!queuedConnections)
      separated = refractedNeeTransport(separated, { legacyReplay });
  }

  const reconstruction = await load('./hybrid-reconstruct.wgsl');
  const sources = {
    signals:
      transport +
      signals +
      (queuedConnections ? '' : connection) +
      separated +
      sampling +
      optical +
      reconstruction,
  };
  if (refracted) {
    // Keep the control independent of the connection solver, including at compile time.
    sources.control = transport + signals + baseline + sampling;
  }
  if (queuedConnections) {
    const queue = await load('./hybrid-connection-queue.wgsl');
    const solveMarker = '@compute @workgroup_size(64) fn solveConnections';
    const resolveMarker = '@compute @workgroup_size(64) fn resolveConnections';
    const solveStart = queue.indexOf(solveMarker);
    const resolveStart = queue.indexOf(resolveMarker);
    if (
      queue.split(solveMarker).length !== 2 ||
      queue.split(resolveMarker).length !== 2 ||
      resolveStart <= solveStart
    )
      throw Error('Connection queue entry points changed');
    const withoutSolver =
      queue.slice(0, solveStart) + queue.slice(resolveStart);
    const queuedSignals = replaceOnce(
      signals,
      'seed,0.,h);',
      'seed,0.,h,index);',
    );
    sources.queueTrace =
      transport +
      queuedSignals +
      `\nconst CONNECTION_CHANCE=${connectionChance.toFixed(5)};\n` +
      withoutSolver +
      queuedConnectionTransport(baseline) +
      sampling;
    sources.queueSolve =
      transport + signals + connection + queue + baseline + sampling;
  }
  if (experiment === 'path-cache') {
    const path = replaceOnce(
      await load('./hybrid-path-cache.wgsl'),
      '/*PATH_INSTANCE*/',
      instanced ? 'instanceIdentity(h)' : '0u',
    );
    sources.pathCache =
      transport +
      signals +
      path +
      pathCacheTransport(transport, baseline) +
      sampling +
      reconstruction;
  }
  return sources;
}
