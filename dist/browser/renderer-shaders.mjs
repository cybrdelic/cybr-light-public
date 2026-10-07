// Source transformation order is part of the renderer contract. This module
// composes WGSL only; the host owns loading policy, compilation, and GPU resources.
import { transmittedSupport } from './transmitted-support.mjs';
import { metalEnergyShader } from './metal-energy.mjs';
import {
  transportIntegrity,
  cameraMediumShader,
} from './transport-integrity.mjs?revision=outside-fast-path';
import { endpointCacheShader, endpointReconstruct } from './endpoint-cache.mjs';
import {
  contributorTrace,
  contributorReconstruct,
} from './contributor-coverage.mjs';
import { traversalProfileShader } from './traversal-profile.mjs';
import {
  diffuseHistoryShader,
  signalDiffuseHistoryShader,
} from './diffuse-history.mjs?revision=signal-isolation-1';
import { rejectionProfile } from './rejection-profile.mjs?revision=2';
import { visibilityProfile } from './visibility-profile.mjs?revision=2';
import { compactBVHShader } from './compact-bvh.mjs';
import { screenRadianceCacheShader } from './screen-radiance-cache.mjs';
import { meshletAttributeShader } from './meshlet-attributes.mjs';
import { opticalGuideShader } from './optical-guides.mjs';
import { pathCorrespondence } from './path-correspondence.mjs';
import { fusedTiledFilter } from './fused-tiled-filter.mjs?revision=tile-budget-1';
import { traversalDistance } from './traversal-distance.mjs';
import { singleCoverageResolve } from './single-coverage.mjs?revision=stationary-1';
import { terminalEmission } from './terminal-emission.mjs';
import { opticalSampling } from './optical-sampling.mjs?revision=sparse-2';
import { adaptiveAaShader } from './adaptive-aa.mjs';
import { coverageShader, coverageJitter } from './coverage-reconstruction.mjs?revision=single-1';
import { instancedShader } from './instanced-shader.mjs?revision=optical-medium-key';
import { gameShader } from './game-shader.mjs';
import { tiledFilter } from './tiled-filter.mjs?revision=baseline-tiles-1';
import { motionHistoryShader } from './motion-history.mjs?revision=rollback-1';
import { inlineMediumStack } from './medium-stack-inline.mjs';
import { scalarMediumStack } from './medium-stack-scalar.mjs';

export async function buildRendererShader(
  name,
  { load, parameters, options, stackCapacity = 64, filterOptions },
) {
  const opticalPass=name.startsWith('optical-');
  if(opticalPass)name=name.slice(8);
  const outsidePass=name.startsWith('outside-');
  if(outsidePass)name=name.slice(8);
  const cameraPass = name.startsWith('camera-');
  if (cameraPass) name = name.slice(7);
  const {
    separateSignals,
    coverageReconstruction,
    contributorCoverage,
    signalDiffuseHistory,
    endpointCache,
    opticalGuides,
    adaptiveAA,
    motionReconstruction,
    screenCacheEnabled,
    traversalProfiling,
    visibilityProfiling,
    rejectionProfiling,
  } = options;
  const packedAttributes = name === 'trace-meshlets';
  if (packedAttributes) name = 'trace';
  const trace = name === 'trace' || name === 'trace-pile';
  const signalShader =
    separateSignals &&
    ['trace', 'trace-pile', 'reconstruct', 'filter', 'display'].includes(
      name,
    ) &&
    !((coverageReconstruction || contributorCoverage) && name === 'display');
  let text = await load(
    (signalShader ? 'experimental-signals/' : '') +
      (name === 'trace-pile' ? 'trace' : name) +
      '.wgsl',
  );
  if (signalShader && name !== 'display')
    text = (await load('experimental-signals/signals.wgsl')) + '\n' + text;
  if (signalShader)
    text = gameShader(name, text, {
      lightCandidates: Number(parameters.get('lightCandidates') || 1),
    });
  if (signalShader && signalDiffuseHistory)
    text = signalDiffuseHistoryShader(text, name);
  if (endpointCache && trace) text = endpointCacheShader(text);
  if (endpointCache && name === 'reconstruct') text = endpointReconstruct(text);
  if (contributorCoverage && trace) text = contributorTrace(text);
  if (contributorCoverage && name === 'reconstruct')
    text = contributorReconstruct(text, separateSignals);
  if (opticalGuides && signalShader && name !== 'display')
    text = opticalGuideShader(name, text);
  if (coverageReconstruction && (trace || name === 'reconstruct'))
    text = coverageShader(name, text, separateSignals);
  if (name === 'coverage-resolve' || name === 'coverage-filter') {
    if(name==='coverage-resolve'&&!separateSignals){
      text=coverageJitter+'\n'+singleCoverageResolve(text);
    }else text =
      gameShader('filter', await load('experimental-signals/signals.wgsl')) +
      '\n' +
      coverageJitter +
      '\n' +
      text;
    if (opticalGuides)
      text = opticalGuideShader(
        name === 'coverage-filter' ? 'fused-filter' : 'abi',
        text,
      );
  }
  if(opticalGuides && parameters.get('optics')==='paths')
    text=pathCorrespondence(name,text);
  if (filterOptions) text = name==='coverage-filter' ? fusedTiledFilter(text,filterOptions) : tiledFilter(text, filterOptions);
  if (separateSignals && parameters.get('transmissionSupport') === 'guided')
    text = transmittedSupport(name, text);
  if (adaptiveAA && trace) text = adaptiveAaShader(text);
  if (name === 'reconstruct' && motionReconstruction === 'confidence')
    text = motionHistoryShader(text);
  if (!separateSignals && parameters.get('diffuseHistory') !== 'legacy')
    text = diffuseHistoryShader(text, name === 'trace-pile' ? 'trace' : name);
  if (screenCacheEnabled && trace) text = screenRadianceCacheShader(text);
  if (options.metalCompensation && trace) text = metalEnergyShader(text);
  if (name === 'trace-pile')
    text = instancedShader(
      text,
      await load('trace-instances.wgsl'),
      stackCapacity,
    );
  if (name === 'trace' && parameters.get('nodes') === 'compact')
    text = compactBVHShader(text);
  // Default only on the measured single-signal pile backend. Optical mode's
  // small timing difference is inconclusive, so keep its existing traversal.
  if(name==='trace-pile' && (parameters.get('distanceStack')==='1' ||
     (!separateSignals && parameters.get('scene')==='example-pile' && parameters.get('distanceStack')!=='0')))text=traversalDistance(text);
  if (options.transportIntegrity && trace)
    text = transportIntegrity(
      text,
      name === 'trace-pile',
      parameters.get('roughGlass') !== 'legacy',
      outsidePass,
    );
  if (packedAttributes) text = meshletAttributeShader(text);
  // The reflected-guide branch uses < .3. Its complementary surface-history
  // branch must include equality, or roughness .3 is always rejected in motion.
  if(!separateSignals && name==='reconstruct' && parameters.get('reflectionHistory')!=='legacy')
    text=text.replace('p.normal.w>.3||reflected','p.normal.w>=.3||reflected');
  if (traversalProfiling && trace) text = traversalProfileShader(text);
  if (visibilityProfiling && trace)
    text = visibilityProfile(text, name === 'trace-pile');
  if (rejectionProfiling && name === 'reconstruct')
    text = rejectionProfile(text, separateSignals);
  if(separateSignals&&name==='reconstruct'&&parameters.get('referenceHistory')!=='legacy'){
    const marker='var result=p.color.rgb;';
    if(!text.includes(marker))throw Error('Reference accumulation contract changed');
    text=text.replace(marker,'if(u.flags.y>.5&&!moving&&u.size.z>0u){history=readSignal(previous[i],channel);}\n '+marker);
  }
  if(separateSignals&&trace&&parameters.get('referenceHistory')!=='legacy'){
    const marker='let combined=radianceD+radianceI+radianceS+radianceT;';
    if(!text.includes(marker))throw Error('Reference radiance contract changed');
    text=text.replace(marker,'if(u.flags.y>.5){demod=vec3f(1);}\n '+marker);
  }
  if(trace&&!options.transportIntegrity&&parameters.get('terminalEmission')!=='0')text=terminalEmission(text);
  if(opticalPass)text=opticalSampling(text);
  text = cameraPass ? cameraMediumShader(text) : text;
  if (parameters.get('mediumStack') === 'inline' && text.includes('struct MediumStack'))
    text = inlineMediumStack(text).code;
  if (parameters.get('mediumStack') === 'scalar' && text.includes('struct MediumStack'))
    text = scalarMediumStack(text).code;
  return text;
}
