import { motionHistoryMode } from './motion-history.mjs?revision=rollback-1';

// Resolve experiment compatibility once. No device, UI, or parameter mutation.
export function rendererOptions(parameters) {
  // Preserve explicitly selected diagnostic/experimental architectures. Normal
  // viewing uses matched lighting guides plus a separate coverage resolve.
  const reconstruction = parameters.get('reconstruction') ?? (
    ['backend','optics','cache','aa','transport','primary','profileTraversal','profileVisibility','profileRejection']
      .some(key=>parameters.has(key)) ? '' : 'coverage-single');
  const coverageReconstruction =
    ['coverage','coverage-single'].includes(reconstruction);
  const contributorCoverage =
    parameters.get('reconstruction') === 'contributors';
  const endpointCache = parameters.get('cache') === 'endpoint';
  const opticalGuides = ['guides','paths'].includes(parameters.get('optics'));
  const separateSignals =
    parameters.get('backend') === 'signals' ||
    (coverageReconstruction && reconstruction!=='coverage-single') ||
    opticalGuides ||
    endpointCache;
  const fusedCoverageFilter = separateSignals &&
    (coverageReconstruction ||
      endpointCache ||
      opticalGuides ||
      (parameters.get('backend') === 'signals' &&
        parameters.get('fused') === '1')) &&
    parameters.get('fused') !== '0';
  const signalDiffuseHistory =
    separateSignals &&
    !endpointCache &&
    !coverageReconstruction &&
    !contributorCoverage &&
    !opticalGuides &&
    parameters.get('signalDiffuseHistory') !== 'legacy';
  const adaptiveAA =
    !separateSignals &&
    !coverageReconstruction &&
    !contributorCoverage &&
    parameters.get('aa') === 'adaptive' &&
    parameters.get('primary') !== 'shared';
  const screenCacheEnabled =
    !separateSignals && !adaptiveAA && !coverageReconstruction && parameters.get('cache') === 'screen';
  const traversalProfiling =
    parameters.get('profileTraversal') === '1' &&
    !separateSignals &&
    !adaptiveAA &&
    !screenCacheEnabled;
  const visibilityProfiling =
    parameters.get('profileVisibility') === '1' &&
    !separateSignals &&
    !adaptiveAA &&
    !screenCacheEnabled &&
    !traversalProfiling;
  return Object.freeze({
    metalCompensation: parameters.get('metalEnergy') !== 'legacy' && !separateSignals,
    // Correctness tests pass; optical-scene equal-quality timing gate has not.
    // Keep the measured baseline until the extra transport cost is addressed.
    transportIntegrity:
      parameters.get('transport') === 'corrected' &&
      !separateSignals &&
      !contributorCoverage &&
      !adaptiveAA &&
      !screenCacheEnabled &&
      !traversalProfiling &&
      !visibilityProfiling,
    coverageReconstruction,
    contributorCoverage,
    endpointCache,
    opticalGuides,
    separateSignals,
    fusedCoverageFilter,
    signalDiffuseHistory,
    adaptiveAA,
    screenCacheEnabled,
    traversalProfiling,
    visibilityProfiling,
    rejectionProfiling: parameters.get('profileRejection') === '1',
    pixelBytes: separateSignals ? (parameters.get('optics')==='paths' ? 272 : opticalGuides ? 224 : 192) : 96,
    signalCount: separateSignals ? 4 : 1,
    motionReconstruction: motionHistoryMode(
      parameters.get('motion'),
      separateSignals,
    ),
  });
}
