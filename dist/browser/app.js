import { galleryLayout } from './gallery-layout.mjs';
import { mountPlayControls } from './play-controls.mjs';
import { tracePassTiming } from './optical-sampling.mjs?revision=sparse-2';
import { rendererOptions } from './renderer-options.mjs?revision=coverage-single-1';
import { buildRendererShader } from './renderer-shaders.mjs?revision=stationary-coverage-1';
import { packMetalEnergy } from './metal-energy-table.mjs';
import { opticalHistoryStats } from './optical-history-stats.mjs';
import { fusedTileBytes } from './fused-tiled-filter.mjs?revision=tile-budget-1';
import { baselineTileBytes } from './tiled-filter.mjs?revision=baseline-tiles-1';
import { outsideSceneBounds } from './transport-integrity.mjs?revision=outside-fast-path';
import { createSceneLoader } from './scene-loader.mjs';
import { endpointPublish } from './endpoint-cache.mjs';
import { contributorResolve } from './contributor-coverage.mjs';
import { summarizeTraversal } from './traversal-profile.mjs';
import { summarizeRejection } from './rejection-profile.mjs?revision=2';
import { summarizeVisibility } from './visibility-profile.mjs?revision=2';
import {
  diagnosticShader,
  createDiagnostics,
  decodeStages,
} from './diagnostics.mjs';
import { probeGpuSession, gpuDeviceOptions, createGpuRuntime, validateGpuBuffer } from './gpu-session.mjs?revision=mobile-lifecycle-2';
import { traceCompatibility } from './trace-compatibility.mjs';
import { selectMediumStackMode } from './medium-stack-policy.mjs';
import { adaptiveAaResolve } from './adaptive-aa.mjs';
import { selectPileDetail } from './pile-lod.mjs';
import { signalSchedule } from './signal-schedule.mjs';
import { motionHistoryMode } from './motion-history.mjs?revision=rollback-1';
import {
  readFloatBuffer,
  recomposeSignals,
  compareLinear,
  temporalColors,
} from './readback.mjs?revision=temporal-isolation-1';

// Optional GPU resources are owned by the same scene/frame lifecycle below.
let endpointPipeline,
  endpointGroups,
  contributorPipeline,
  contributorGroups,
  contributorLayers,
  contributorOutput;
let traversalStats, traversalDisplayPipeline, traversalDisplayGroup;
let visibilityBuffer, rejectionBuffer;
let diagnostics, diagnosticPipeline, diagnosticUniform, diagnosticGroups;
const $ = (s) => document.querySelector(s),
  canvas = $('#viewport'),
  status = $('#status');
const sceneChoices = [
  ['forest', 'Forest / complete procedural stand'],
  ...Array.from({ length: 4 }, (_, i) => [
    `forest-tree-${i}`,
    `Forest / individual tree ${i + 1}`,
  ]),
  ['example-gallery', 'Every model / gallery'],
  ['example-pile', 'Pile / 2,016 model instances'],
  ['example-million', 'Stress / 1,000,000 model instances'],
  ['proof-optics', 'Test / glass + water transport'],
  ['proof-metals', 'Test / metal reflection ladder'],
  ['proof-indirect', 'Test / indirect light room'],
  ['all', 'All six / exploded assembly'],
  ['geo', 'GEO / terrain mechanism'],
  ['light', 'LIGHT / optical lens'],
  ['elements', 'ELEMENTS / vessel + FLIP'],
  ['song', 'SONG / cymbals'],
  ['combat', 'COMBAT / avatar frame'],
  ['scenes', 'SCENES / desert hot springs'],
  ['flip', 'FLIP / water surface only'],
];
sceneChoices.push(
  ['example-materials', 'LIGHT example / material gallery'],
  ['example-knot', 'LIGHT example / copper knot'],
  ['example-geo-flange', 'GEO example / CAD flange'],
  ['example-observatory', 'SCENES example / Observatory source interior'],
);
sceneChoices.push(
  ['example-materials-source', 'LIGHT / material gallery · source lighting'],
  ['example-knot-source', 'LIGHT / copper knot · source lighting'],
);
sceneChoices.unshift(
  ['example-geo-printer', 'GEO / FUSE C220 3D printer'],
  ['example-geo-wrist', 'GEO / Orbit inspection wrist'],
);
$('#scene').replaceChildren(
  ...sceneChoices.map(([value, label]) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    return o;
  }),
);
const catalogPanel = document.createElement('details');
const forestViewControl = document.createElement('label');
forestViewControl.id = 'forest-camera-controls';
forestViewControl.hidden = true;
forestViewControl.innerHTML =
  'Forest view <select id="forest-view"><option value="trail">Trail</option><option value="canopy">Crown boundaries</option><option value="sky">Under the crowns</option><option value="clearing">Clearing</option><option value="overview">Whole stand</option></select><a href="./forest-game.html">Fast forest / cached lighting ↗</a>';
$('#scene').parentElement.after(forestViewControl);
forestViewControl
  .querySelector('select')
  .addEventListener('change', (event) => {
    const pose = sceneInfo?.views?.[event.target.value];
    if (!pose) return;
    window.cybrLight.setCamera(
      pose.yaw,
      pose.pitch,
      pose.distance,
      pose.target,
    );
    window.cybrLight.reset();
    window.cybrLight.resume();
  });
catalogPanel.innerHTML = '<summary>Source import catalog</summary><div></div>';
$('#scene').parentElement.after(catalogPanel);
async function refreshCatalog() {
  try {
    const sources = await Promise.all(
      ['catalog.json', 'environment-catalog.json'].map(async (path) => {
        const r = await fetch(path, { cache: 'no-store' });
        return r.ok ? (await r.json()).entries : [];
      }),
    );
    const rows = sources.flat(),
      content = catalogPanel.querySelector('div');
    content.replaceChildren();
    for (const row of rows) {
      if (
        row.status === 'exported' &&
        !sceneChoices.some(([id]) => id === row.id)
      ) {
        sceneChoices.push([row.id, row.label]);
        const o = document.createElement('option');
        o.value = row.id;
        o.textContent = row.label;
        $('#scene').append(o);
      }
      const p = document.createElement('p');
      p.textContent =
        row.label +
        ' — ' +
        (row.status === 'exported'
          ? 'imported / visual approval pending'
          : row.status) +
        (row.error ? ' · import details below' : '');
      content.append(p);
      if (row.error) {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        const error = document.createElement('pre');
        summary.textContent =
          'Source import details (not a live renderer error)';
        error.textContent = row.error;
        error.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere';
        details.append(summary, error);
        content.append(details);
      }
    }
    catalogPanel.querySelector('summary').textContent =
      `Source import catalog · ${rows.filter((r) => r.status === 'exported').length}/${rows.length} exported`;
  } catch (error) {
    catalogPanel.querySelector('div').textContent =
      'Catalog unavailable: ' + error.message;
  }
}
await refreshCatalog();
setInterval(refreshCatalog, 30000);
const fluidControls = document.createElement('div');
fluidControls.id = 'fluid-controls';
fluidControls.innerHTML =
  '<label for="fluid-frame">Cached FLIP frame <output id="fluid-number">0 / 71</output></label><input id="fluid-frame" type="range" min="0" max="71" value="0" step="1"><p>Recorded simulation mesh. Changing frames rebuilds the BVH; this is frame inspection, not live simulation playback.</p>';
$('#scene').parentElement.after(fluidControls);
const sceneActions = document.createElement('div');
sceneActions.className = 'scene-actions';
sceneActions.innerHTML =
  '<button id="show-gallery">Every model</button><button id="show-all">Six modules</button><button id="fit-view">Fit view</button>';
$('#scene').parentElement.before(sceneActions);
const gpuWarning = document.createElement('p');
gpuWarning.id = 'gpu-warning';
gpuWarning.className = 'note';
$('#metrics').after(gpuWarning);
const provenance = document.createElement('p');
provenance.className = 'note';
$('#scene').parentElement.after(provenance);
const parameters = new URLSearchParams(location.search);
// Apply defaults before deriving immutable shader/reconstruction options.
if (!parameters.has('glass')) parameters.set('glass', 'split');
if (!parameters.has('motion')) parameters.set('motion', 'bilinear');
// Shared scene/lifecycle runtime; candidate reconstruction is not a second app.
const options = rendererOptions(parameters);
const {
  coverageReconstruction,
  contributorCoverage,
  endpointCache,
  fusedCoverageFilter,
  opticalGuides,
  separateSignals,
  signalDiffuseHistory,
  pixelBytes,
  signalCount,
  rejectionProfiling,
  adaptiveAA,
  screenCacheEnabled,
  traversalProfiling,
  visibilityProfiling,
} = options;
const compatibilityMode = parameters.get('gpuCompatibility') === 'compact';
const moduleWorkgroups = new WeakMap(), pipelineWorkgroups = new WeakMap();
let motionReconstruction = options.motionReconstruction;
const transportIntegrityEnabled = options.transportIntegrity;
const metalCompensation = options.metalCompensation;
let metalEnergyTable;
const filterTileSteps = [];
let cameraMediumPipeline, cameraMediumGroup, cameraMediumBuffer;
let outsideTracePipeline,outsideTraceGroup,sceneBounds;
const outsideTracePipelines=new Map();
const cameraMediumPipelines = new Map();
let activeSignals = Array.from({ length: signalCount }, (_, i) => i);
const galleryControls = document.createElement('div');
galleryControls.innerHTML =
  '<label>Gallery focus<select id="gallery-focus"><option value="">All models / overview</option></select></label><button id="gallery-inspect">Inspect full-quality original</button>';
$('#scene').parentElement.after(galleryControls);
const galleryIndex = await fetch('./assets/gallery-lod/index.json', {
  cache: 'no-store',
})
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null);
for (const entry of galleryIndex?.entries || []) {
  const option = document.createElement('option');
  option.value = entry.id;
  option.textContent = entry.label;
  $('#gallery-focus').append(option);
  if (!sceneChoices.some(([id]) => id === entry.id)) {
    sceneChoices.push([entry.id, entry.label]);
    $('#scene').append(option.cloneNode(true));
  }
}
$('#gallery-focus').value = parameters.get('focus') || '';
$('#gallery-focus').onchange = () => loadScene().catch(fail);
$('#gallery-inspect').onclick = () => {
  if (!$('#gallery-focus').value) return;
  $('#scene').value = $('#gallery-focus').value;
  loadScene().catch(fail);
};
const galleryLabels = document.createElement('div');
galleryLabels.style.cssText =
  'position:absolute;inset:0;pointer-events:none;overflow:hidden';
canvas.parentElement.append(galleryLabels);
for (const [i, entry] of (galleryIndex?.entries || []).entries()) {
  const button = document.createElement('button');
  button.textContent = String(i + 1).padStart(2, '0');
  button.title = entry.label + ' — ' + (entry.scaleNote || '');
  button.setAttribute('aria-label', 'Focus ' + entry.label);
  button.style.cssText =
    'position:absolute;pointer-events:auto;width:25px;height:20px;padding:0;margin:0;font:10px monospace;background:#ffffffd9;border:1px solid #888;transform:translate(-50%,-50%)';
  button.onclick = () => {
    $('#gallery-focus').value = entry.id;
    loadScene().catch(fail);
  };
  galleryLabels.append(button);
}
function positionGalleryLabels(cam) {
  galleryLabels.hidden = state.scene !== 'example-gallery' || !state.ready;
  if (galleryLabels.hidden || !galleryIndex) return;
  const layout = galleryLayout(galleryIndex);
  const rect = canvas.getBoundingClientRect(),
    parent = canvas.parentElement.getBoundingClientRect();
  const fit = Math.min(rect.width / canvas.width, rect.height / canvas.height),
    width = canvas.width * fit,
    height = canvas.height * fit;
  const dot = (a, b) => a.reduce((s, v, k) => s + v * b[k], 0);
  const occupied = [];
  const ordered = [...galleryLabels.children]
    .map((button, i) => ({ button, i }))
    .sort(
      (a, b) =>
        Number(galleryIndex.entries[b.i].id === $('#gallery-focus').value) -
        Number(galleryIndex.entries[a.i].id === $('#gallery-focus').value),
    );
  ordered.forEach(({ button, i }) => {
    const p = [layout.items[i].target[0], 0, layout.items[i].target[2]];
    const relative = p.map((v, k) => v - cam.eye[k]),
      z = dot(relative, cam.forward);
    const x =
      ((dot(relative, cam.right) /
        ((z * cam.tan * canvas.width) / canvas.height)) *
        0.5 +
        0.5) *
      width;
    const y =
      ((-dot(relative, cam.up) / (z * cam.tan)) * 0.5 + 0.5) * height + 12;
    button.hidden =
      z <= 0 ||
      x < 13 ||
      x > width - 13 ||
      y < 10 ||
      y > height - 10 ||
      occupied.some((p) => Math.abs(p[0] - x) < 28 && Math.abs(p[1] - y) < 23);
    if (!button.hidden) occupied.push([x, y]);
    button.style.left =
      rect.left - parent.left + (rect.width - width) / 2 + x + 'px';
    button.style.top =
      rect.top - parent.top + (rect.height - height) / 2 + y + 'px';
  });
}
// Older cached HTML shells may predate the direct-only diagnostic option.
if (![...$('#bounces').options].some((o) => o.value === '1')) {
  const option = document.createElement('option');
  option.value = '1';
  option.textContent = 'Direct only / 1 bounce';
  $('#bounces').prepend(option);
}
// Keep the transport disclaimer accurate when loading an older cached shell.
document.querySelector('aside > p.note:last-child').textContent =
  'Experimental RGB backend. No spectral dispersion, caustic solver or live FLIP topology. Primary glass splits reflection/transmission; short glass history requires matching secondary surfaces. Complex glass/water and fast motion still show noise.';
for (const id of ['scene', 'resolution', 'bounces', 'mode']) {
  const value = parameters.get(id);
  if (value && [...$('#' + id).options].some((o) => o.value === value))
    $('#' + id).value = value;
}
let sampleLimit = Math.max(0, Number(parameters.get('samples')) || 0);
$('#fluid-frame').value = String(
  Math.max(0, Math.min(71, Number(parameters.get('fluidFrame')) || 0)),
);
const state = {
  ready: false,
  frame: 0,
  settled: 0,
  converged: false,
  paused: false,
  pauseReason: null,
  errors: [],
  timings: [],
  gpuTimes: [],
  gpuFrameTimes: [],
  scene: 'combat',
  generation: 0,
  loading: null,
  interactionEpoch: 0,
};
let gpuSession, gpuRuntime, mediumStackMode, sessionClosed = false;
let device,
  context,
  format,
  pipelines,
  sceneBuffers = [],
  frameBuffers = [],
  querySet,
  queryResolve,
  queryRead,
  queryBusy = false;
let uniform,
  traceGroup,
  reconstructionGroups,
  filterGroups,
  reconstructionPipelines,
  filterPipelines,
  modulation,
  displayGroups,
  samples,
  histories,
  colors,
  configs,
  frameId = 0,
  flight = 0;
let yaw = 0.62,
  pitch = 0.3,
  distance = 6.2,
  previousCamera = null,
  drag = null,
  lastTime = 0,
  floor = -1,
  sceneInfo = null;
let cameraTarget = [0, 0, 0];
let galleryLodTimer;
function scheduleGalleryDetail() {
  clearTimeout(galleryLodTimer);
  if (
    !['example-gallery', 'example-pile', 'example-million'].includes(
      state.scene,
    ) ||
    !state.ready
  )
    return;
  galleryLodTimer = setTimeout(() => {
    if (!state.ready || $('#scene').disabled) return;
    if (['example-pile', 'example-million'].includes(state.scene)) {
      const nearby = selectPileDetail(
        sceneInfo,
        camera(),
        canvas.height,
        Math.min(
          4000000,
          Math.floor(device.limits.maxStorageBufferBindingSize / 96),
        ),
        galleryIndex,
      );
      // Keep cached detail on zoom-out: the shader already picks the cheap
      // BLAS for distant copies. Stream only when a required template is absent.
      if (nearby.some((id) => !(sceneInfo.nearModels || []).includes(id)))
        loadScene({ keepCamera: true, nearModels: nearby }).catch(fail);
      return;
    }
    const eye = camera().eye,
      layout = galleryLayout(galleryIndex);
    const nearby = galleryIndex.entries
      .map((entry, i) => {
        const p = layout.items[i].target;
        return { id: entry.id, d: Math.hypot(...p.map((v, k) => v - eye[k])) };
      })
      .filter((e) => e.d < 1.6)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4)
      .map((e) => e.id);
    if (
      [...nearby].sort().join('|') !==
      [...(sceneInfo.nearModels || [])].sort().join('|')
    )
      loadScene({ keepCamera: true, nearModels: nearby }).catch(fail);
  }, 650);
}
canvas.addEventListener('wheel', scheduleGalleryDetail, { passive: true });
canvas.addEventListener('pointerup', scheduleGalleryDetail);
if ($('#scene').value === 'all') {
  yaw = 0.1;
  pitch = 0.35;
  distance = 4.2;
}
const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  normalize = (v) => {
    const n = Math.hypot(...v);
    return v.map((x) => x / n);
  };
function camera() {
  const eye = [
      Math.sin(yaw) * Math.cos(pitch) * distance,
      Math.sin(pitch) * distance,
      Math.cos(yaw) * Math.cos(pitch) * distance,
    ],
    forward = normalize(eye.map((v) => -v)),
    right = normalize(cross(forward, [0, 1, 0])),
    up = cross(right, forward);
  return {
    eye: eye.map((v, i) => v + cameraTarget[i]),
    right,
    up,
    forward,
    tan: sceneInfo?.camera?.fov
      ? Math.tan((sceneInfo.camera.fov * Math.PI) / 360)
      : Math.tan(Math.PI / 7),
  };
}
const retryGpu = document.createElement('button');
retryGpu.id = 'retry-gpu';
retryGpu.textContent = 'Retry renderer';
retryGpu.style.cssText = 'position:absolute;bottom:54px;left:24px;padding:10px;z-index:2';
retryGpu.hidden = true;
retryGpu.onclick = () => {
  retryGpu.disabled = true;
  const url = new URL(location.href);
  for (const id of ['scene', 'resolution', 'bounces', 'mode']) url.searchParams.set(id, $('#' + id).value);
  url.searchParams.set('opticalSamples', opticalChoice.value);
  url.searchParams.set('gpuRecovery', '1');
  url.searchParams.set('gpuTimings', '0');
  location.replace(url.href);
};
status.after(retryGpu);
const compatibilityRetry = document.createElement('button');
compatibilityRetry.id = 'retry-compatible-gpu';
compatibilityRetry.textContent = 'Try compatibility renderer';
compatibilityRetry.style.cssText = 'position:absolute;bottom:100px;left:24px;padding:10px;z-index:2';
compatibilityRetry.hidden = true;
compatibilityRetry.onclick = () => { const url = new URL(location.href);
  for (const id of ['scene', 'resolution', 'bounces', 'mode']) url.searchParams.set(id, $('#' + id).value);
  url.searchParams.set('opticalSamples', opticalChoice.value);
  url.searchParams.set('gpuCompatibility', 'compact');url.searchParams.set('gpuRecovery', '1');url.searchParams.set('gpuTimings', '0');
  location.replace(url.href);
};
const compileCheck = document.createElement('a');
compileCheck.id = 'gpu-compile-check';compileCheck.textContent = 'GPU startup comparison';
compileCheck.href = './gpu-compile-check.html?case=tiny&run=1';compileCheck.hidden = true;
compileCheck.style.cssText = 'position:absolute;bottom:150px;left:24px;padding:10px;background:#e8e8e4;z-index:2';
status.after(compatibilityRetry, compileCheck);
function fail(error) {
  if (sessionClosed) return;
  if (gpuRuntime) gpuRuntime.report(error);
  else presentFailure(error.message || String(error));
}
function presentFailure(message) {
  if (sessionClosed) return;
  if (!state.errors.includes(message)) state.errors.push(message);
  if (gpuRuntime?.snapshot().lost) { state.ready = false; sceneLoader.cancel(); }
  retryGpu.hidden = false;
  compatibilityRetry.hidden = compatibilityMode || transportIntegrityEnabled || separateSignals;
  compileCheck.hidden = false;
  status.setAttribute('role', 'alert');
  state.loading = null;
  status.textContent = message;
  state.paused = true;
  state.pauseReason = 'error';
  $('#scene').disabled = false;
  $('#fluid-frame').disabled = false;
  $('#show-all').disabled = false;
  $('#show-gallery').disabled = false;
  $('#gallery-focus').disabled = false;
  for (const button of galleryLabels.children) button.disabled = false;
}
function buffer(data, usage = GPUBufferUsage.STORAGE) {
  gpuRuntime.assertActive();
  const size = typeof data === 'number' ? data : data.byteLength;
  const b = device.createBuffer({
    size: validateGpuBuffer(size, usage, device.limits, GPUBufferUsage.STORAGE),
    usage: usage | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  if (typeof data !== 'number') device.queue.writeBuffer(b, 0, data);
  return b;
}
function group(p, resources) {
  gpuRuntime.assertActive();
  return device.createBindGroup({
    layout: p.getBindGroupLayout(0),
    entries: resources.map((b, binding) => ({
      binding,
      resource: { buffer: b },
    })),
  });
}
let ordinaryTracePipeline,
  meshletTracePipeline,
  pileTracePipeline,
  instanceLodPipeline,
  instanceLodGroup;
let aaRaw, aaResolvePipeline, aaResolveGroup;
let coveragePipeline,
  coverageBuffers = [],
  coverageGroups;
let screenCache, screenCachePipeline, screenCacheGroups;
let opticalSamplePipeline,opticalSampleGroup;
const opticalSamplePipelines=new Map();
const extraOpticalSample=parameters.get('opticalSamples')==='2'&&coverageReconstruction&&!separateSignals&&!transportIntegrityEnabled&&!traversalProfiling&&!visibilityProfiling;
const opticalControl=document.createElement('label');
opticalControl.textContent='Optical lighting samples';
const opticalChoice=document.createElement('select');opticalChoice.id='optical-samples';
for(const [value,label] of [['1','1 / current speed'],['2','2 / cleaner glass and metal, slower']]){
 const option=document.createElement('option');option.value=value;option.textContent=label;opticalChoice.append(option);
}
opticalChoice.value=extraOpticalSample?'2':'1';
opticalChoice.disabled=!coverageReconstruction||separateSignals||transportIntegrityEnabled||traversalProfiling||visibilityProfiling;
opticalChoice.addEventListener('change',()=>{const next=new URL(location.href);next.searchParams.set('opticalSamples',opticalChoice.value);location.href=next.href;});
opticalControl.append(opticalChoice);$('#bounces').parentElement.after(opticalControl);
const pileTracePipelines = new Map();
const sceneLoader = createSceneLoader(
  () =>
    new Worker('./bvh-worker.js?revision=pile-cache-20261005', {
      type: 'module',
    }),
  { reuse: true },
);
async function shader(name, stackCapacity = 64, filterOptions) {
  let text = await buildRendererShader(name, {
    load: async (path) => {
      const response = await fetch(path, { cache: 'no-store' });
      if (!response.ok)
        throw Error('Missing shader: ' + path + ' (' + response.status + ')');
      return response.text();
    },
    parameters,
    options: { ...options, motionReconstruction },
    stackCapacity,
    filterOptions,
  });
  let workgroup = 8;
  if (compatibilityMode && /^(optical-)?trace(-pile|-meshlets)?$/.test(name)) {
    const variant = traceCompatibility(text);text = variant.code;workgroup = variant.workgroup;
  }
  gpuRuntime.assertActive();
  const module = device.createShaderModule({ label: name, code: text });
  moduleWorkgroups.set(module, workgroup);
  const info = await module.getCompilationInfo();
  gpuRuntime.assertActive();
  const errors = info.messages.filter((m) => m.type === 'error');
  if (errors.length)
    throw Error(
      name + ': ' + errors.map((m) => `${m.lineNum}: ${m.message}`).join('\n'),
    );
  return module;
}
async function compileCompute(descriptor) {
  const pipeline = await gpuRuntime.compile('createComputePipelineAsync', descriptor);
  pipelineWorkgroups.set(pipeline, moduleWorkgroups.get(descriptor.compute.module) || 8);
  return pipeline;
}
async function boot() {
  if (compatibilityMode && (transportIntegrityEnabled || separateSignals))
    throw Error('Compatibility startup currently supports the baseline RGB renderer. Keep corrected/separate-signal experiments on the current startup path.');
  if (compatibilityMode) $('#gpu-warning').textContent = 'Compatibility startup / same transport and settings; smaller trace workgroups and medium storage matched to the ten-bounce UI. Physical Adreno success is not yet confirmed.';
  if(metalCompensation){
    const response=await fetch('./metal-energy-table.json');
    if(!response.ok)throw Error('Missing GGX energy table');
    metalEnergyTable=await response.json();
    packMetalEnergy([],metalEnergyTable); // Validate before allocating renderer resources.
  }
  gpuSession = await probeGpuSession(canvas);
  if (sessionClosed) return;
  const { adapter } = gpuSession;
  mediumStackMode = selectMediumStackMode(adapter, parameters.get('mediumStack'));
  parameters.set('mediumStack', mediumStackMode.mode);
  const mobile = navigator.userAgentData?.mobile === true || /Android|iPhone|iPad/i.test(navigator.userAgent) ||
    /qualcomm|adreno/i.test([adapter.info?.vendor, adapter.info?.architecture].join(' '));
  const recovery = parameters.get('gpuRecovery') === '1';
  const deviceOptions = gpuDeviceOptions(adapter, {
    mobile, recovery,
    timings: parameters.has('gpuTimings') ? parameters.get('gpuTimings') === '1' : null,
  });
  const features = deviceOptions.requiredFeatures;
  device = await adapter.requestDevice(deviceOptions);
  if (sessionClosed) { device.destroy(); return; }
  gpuRuntime = createGpuRuntime(device, { serial: mobile || recovery, onFailure: presentFailure });
  $('#adapter').textContent =
    [adapter.info?.vendor, adapter.info?.architecture, adapter.info?.device]
      .filter(Boolean)
      .join(' / ') || 'WebGPU adapter';
  if (adapter.info?.vendor === 'intel')
    $('#gpu-warning').textContent =
      'Intel adapter selected. On dual-GPU systems, check the browser’s graphics preference: this page cannot force the dedicated GPU.';
  context = gpuSession.context;
  format = gpuSession.format;
  context.configure({ device, format, alphaMode: 'opaque' });
  const debugModule = device.createShaderModule({
    label: 'diagnostic display',
    code: diagnosticShader(pixelBytes, separateSignals, opticalGuides),
  });
  diagnosticPipeline = await gpuRuntime.compile('createRenderPipelineAsync', {
    layout: 'auto',
    vertex: { module: debugModule, entryPoint: 'vertex' },
    fragment: {
      module: debugModule,
      entryPoint: 'fragment',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-list' },
  });
  diagnosticUniform = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  if (traversalProfiling) {
    const module = device.createShaderModule({
      code: diagnosticShader(16, false, false),
    });
    traversalDisplayPipeline = await gpuRuntime.compile('createRenderPipelineAsync', {
      layout: 'auto',
      vertex: { module, entryPoint: 'vertex' },
      fragment: { module, entryPoint: 'fragment', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    });
  }
  diagnostics = createDiagnostics({
    wake: () => {
      state.settled = 0;
      state.converged = false;
    },
    snapshot,
  });
  if (traversalProfiling)
    for (const [i, label] of [
      'Trace calls',
      'BVH node visits',
      'Triangle tests',
      'BLAS entries',
    ].entries())
      $('#debug-view').add(new Option(label + ' / pixel', String(11 + i)));
  $('#debug-channel').disabled = !separateSignals;
  if (!features.length) {
    $('#debug-profile').disabled = true;
    $('#profile-stages').textContent =
      'GPU timing is disabled or unavailable. Mobile viewing omits optional timing queries; rendering quality is unchanged.';
  }
  const mods = await Promise.all(
    ['trace', 'reconstruct', 'filter', 'display'].map((name) => shader(name)),
  );
  pipelines = await Promise.all(
    mods.slice(0, 3).map((module) =>
      compileCompute({
        layout: 'auto',
        compute: { module, entryPoint: 'main' },
      }),
    ),
  );
  reconstructionPipelines = await Promise.all(
    Array.from({ length: signalCount }, (_, CHANNEL) =>
      CHANNEL === 0
        ? pipelines[1]
        : compileCompute({
            layout: 'auto',
            compute: {
              module: mods[1],
              entryPoint: 'main',
              constants: { CHANNEL },
            },
          }),
    ),
  );
  if (adaptiveAA)
    aaResolvePipeline = await compileCompute({
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: adaptiveAaResolve }),
        entryPoint: 'main',
      },
    });
  if (coverageReconstruction)
    coveragePipeline = await compileCompute({
      layout: 'auto',
      compute: { module: await shader('coverage-resolve'), entryPoint: 'main' },
    });
  if (screenCacheEnabled)
    screenCachePipeline = await compileCompute({
      layout: 'auto',
      compute: {
        module: await shader('screen-cache-publish'),
        entryPoint: 'main',
      },
    });
  if (endpointCache || contributorCoverage) {
    let abi =
      'struct Pixel { color:vec4f,position:vec4f,normal:vec4f,moments:vec4f,secondary:vec4f,secondaryNormal:vec4f }';
    if (separateSignals) {
      abi = gameShader(
        'filter',
        await fetch('./experimental-signals/signals.wgsl', {
          cache: 'no-store',
        }).then((r) => r.text()),
      );
      if (opticalGuides) abi = opticalGuideShader('abi', abi);
    }
    if (endpointCache)
      endpointPipeline = await compileCompute({
        layout: 'auto',
        compute: {
          module: device.createShaderModule({
            code: abi + '\n' + endpointPublish,
          }),
          entryPoint: 'main',
        },
      });
    if (contributorCoverage)
      contributorPipeline = await compileCompute({
        layout: 'auto',
        compute: {
          module: device.createShaderModule({
            code: abi + '\n' + contributorResolve(separateSignals),
          }),
          entryPoint: 'main',
        },
      });
  }
  const sharedFilters = await Promise.all(
    Array.from({ length: signalCount }, (_, CHANNEL) =>
      CHANNEL === 0
        ? pipelines[2]
        : compileCompute({
            layout: 'auto',
            compute: {
              module: mods[2],
              entryPoint: 'main',
              constants: { CHANNEL },
            },
          }),
    ),
  );
  filterPipelines = [sharedFilters, sharedFilters, sharedFilters];
  if(!separateSignals && !adaptiveAA && !contributorCoverage && parameters.get('tiled')!=='0'){
    for(const [index,step] of [1,2,4].entries())if(device.limits.maxComputeWorkgroupStorageSize>=baselineTileBytes(step)){
      const tiled=await compileCompute({layout:'auto',compute:{module:await shader('filter',64,{step}),entryPoint:'main'}});
      filterPipelines[index]=[tiled];
      filterTileSteps.push(step);
    }
  }
  if (
    separateSignals &&
    parameters.get('tiled') === '1' &&
    device.limits.maxComputeWorkgroupStorageSize >= 32768
  ) {
    filterPipelines = await Promise.all(
      [1, 2, 4].map((step) =>
        Promise.all(
          Array.from({ length: signalCount }, async (_, CHANNEL) =>
            compileCompute({
              layout: 'auto',
              compute: {
                module: await shader('filter', 64, { step, channel: CHANNEL }),
                entryPoint: 'main',
                constants: { CHANNEL },
              },
            }),
          ),
        ),
      ),
    );
  }
  if (fusedCoverageFilter) {
    const p = await compileCompute({
      layout: 'auto',
      compute: { module: await shader('coverage-filter'), entryPoint: 'main' },
    });
    filterPipelines = [[p], [p], [p]];
    if(opticalGuides && parameters.get('fusedTiled')!=='0'){
      for(const step of [1])if(device.limits.maxComputeWorkgroupStorageSize>=fusedTileBytes(step)){
        const tiled=await compileCompute({layout:'auto',compute:{module:await shader('coverage-filter',64,{step}),entryPoint:'main'}});
        filterPipelines[step-1]=[tiled];
        filterTileSteps.push(step);
      }
    }
  }
  pipelines.push(
    await gpuRuntime.compile('createRenderPipelineAsync', {
      layout: 'auto',
      vertex: { module: mods[3], entryPoint: 'vertex' },
      fragment: {
        module: mods[3],
        entryPoint: 'fragment',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    }),
  );
  if (features.length) {
    querySet = device.createQuerySet({ type: 'timestamp', count: 8 });
    queryResolve = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    queryRead = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }
  await loadScene();
  gpuRuntime.assertActive();
  gpuRuntime.setPhase('Rendering');
  requestAnimationFrame(loop);
}
async function loadScene(options = {}) {
  gpuRuntime?.assertActive();
  const generation = ++state.generation;
  const background = !!options.keepCamera && state.ready;
  const progress = (phase) => {
    if (generation !== state.generation) return;
    gpuRuntime.setPhase(phase);
    state.loading = { scene: $('#scene').value, phase, background };
    status.textContent = background
      ? 'Updating detail; current scene remains visible. ' + phase
      : phase;
  };
  if (!options.keepCamera) state.ready = false;
  progress('Loading scene assets…');
  $('#scene').disabled = true;
  $('#fluid-frame').disabled = true;
  $('#show-all').disabled = true;
  $('#show-gallery').disabled = true;
  $('#gallery-focus').disabled = true;
  for (const button of galleryLabels.children) button.disabled = true;
  fluidControls.hidden = !['all', 'elements', 'flip'].includes(
    $('#scene').value,
  );
  $('#fluid-number').textContent = $('#fluid-frame').value + ' / 71';
  const selected = $('#scene').value;
  galleryControls.hidden = selected !== 'example-gallery';
  $('#gallery-inspect').disabled = true;
  provenance.textContent = selected.startsWith('example-')
    ? 'Source example geometry / approximate RGB materials / browser studio lighting.'
    : '';
  let result;
  try {
    result = await sceneLoader.load(
      {
        base: new URL(
          selected.startsWith('forest')
            ? './assets/forest/'
            : ['example-gallery', 'example-pile', 'example-million'].includes(
                  selected,
                )
              ? './assets/gallery-lod/'
              : selected.startsWith('example-')
                ? './assets/' + selected + '/'
                : './assets/instrument-cartridges-c/',
          location.href,
        ).href,
        module: selected,
        // Detailed pile templates make unnecessary per-instance traversal costly.
        // Keep one instance per leaf here; other scene families retain their policy.
        tlasLeafSize: Number(
          parameters.get('tlasLeaf') || (selected === 'example-pile' ? 1 : 6),
        ),
        focus: $('#gallery-focus').value,
        nearModels: options.nearModels,
        contacts: parameters.get('contacts') !== 'legacy',
        contactBake: parameters.get('contacts') !== 'legacy',
        fluidFrame: Number($('#fluid-frame').value),
        maxStorageBytes: device.limits.maxStorageBufferBindingSize,
        compactNodes: parameters.get('nodes') === 'compact',
        meshletAttributes:
          parameters.get('meshlets') === 'attributes' ||
          (!parameters.has('meshlets') &&
            ['example-geo-printer', 'example-geo-wrist'].includes(selected)),
      },
      progress,
    );
  } catch (error) {
    if (generation !== state.generation || error.name === 'AbortError') return;
    state.loading = null;
    for (const id of [
      'scene',
      'fluid-frame',
      'show-all',
      'show-gallery',
      'gallery-focus',
    ])
      $('#' + id).disabled = false;
    throw error;
  }
  if (generation !== state.generation) return;
  provenance.textContent = result.notes || '';
  progress('Preparing GPU traversal pipelines…');
  state.ready = false;
  await device.queue.onSubmittedWorkDone();
  gpuRuntime.assertActive();
  if (generation !== state.generation) return;
  ordinaryTracePipeline ||= pipelines[0];
  if (result.instanceRecordStart !== undefined) {
    // DFS needs at most depth+1 pending entries. Two spares retain a margin;
    // specialize from the validated tree, never from an assumed scene limit.
    const capacity =
      parameters.get('traversal') === 'legacy'
        ? 64
        : Math.max(8, result.maxDepth + 2);
    if (capacity > 64) throw Error('Unsupported BVH depth');
    if (!pileTracePipelines.has(capacity))
      pileTracePipelines.set(
        capacity,
        await compileCompute({
          layout: 'auto',
          compute: {
            module: await shader('trace-pile', capacity),
            entryPoint: 'main',
          },
        }),
      );
    pileTracePipeline = pileTracePipelines.get(capacity);
  }
  if (result.instanceRecordStart !== undefined)
    instanceLodPipeline ||= await compileCompute({
      layout: 'auto',
      compute: { module: await shader('instance-lod'), entryPoint: 'main' },
    });
  if (result.meshletInfo?.enabled && !meshletTracePipeline)
    meshletTracePipeline = await compileCompute({
      layout: 'auto',
      compute: { module: await shader('trace-meshlets'), entryPoint: 'main' },
    });
  if (generation !== state.generation) return;
  pipelines[0] =
    result.instanceRecordStart !== undefined
      ? pileTracePipeline
      : result.meshletInfo?.enabled
        ? meshletTracePipeline
        : ordinaryTracePipeline;
  if(extraOpticalSample){
    const kind=result.instanceRecordStart!==undefined?'trace-pile':result.meshletInfo?.enabled?'trace-meshlets':'trace';
    const capacity=kind==='trace-pile'?(parameters.get('traversal')==='legacy'?64:Math.max(8,result.maxDepth+2)):64;
    const key=kind+':'+capacity;
    if(!opticalSamplePipelines.has(key))opticalSamplePipelines.set(key,await compileCompute({layout:'auto',compute:{module:await shader('optical-'+kind,capacity),entryPoint:'main'}}));
    opticalSamplePipeline=opticalSamplePipelines.get(key);
  }
  if (transportIntegrityEnabled) {
    const kind =
      result.instanceRecordStart !== undefined
        ? 'trace-pile'
        : result.meshletInfo?.enabled
          ? 'trace-meshlets'
          : 'trace';
    const capacity =
      kind === 'trace-pile'
        ? parameters.get('traversal') === 'legacy'
          ? 64
          : Math.max(8, result.maxDepth + 2)
        : 64;
    const key = kind + ':' + capacity;
    if (!cameraMediumPipelines.has(key))
      cameraMediumPipelines.set(
        key,
        await compileCompute({
          layout: 'auto',
          compute: {
            module: await shader('camera-' + kind, capacity),
            entryPoint: 'main',
          },
        }),
      );
    cameraMediumPipeline = cameraMediumPipelines.get(key);
    if(!outsideTracePipelines.has(key))outsideTracePipelines.set(key,await compileCompute({layout:'auto',compute:{module:await shader('outside-'+kind,capacity),entryPoint:'main'}}));
    outsideTracePipeline=outsideTracePipelines.get(key);
  }
  progress('Uploading scene buffers…');
  // Validate every storage binding before releasing the currently visible scene.
  // Attributes are often the largest allocation for streamed pile templates.
  for (const [name, data] of Object.entries({
    triangles: result.triangles,
    nodes: result.nodes,
    materials: result.materials,
    attributes: result.attributes,
    lighting: result.lighting,
  })) {
    if (data.byteLength > device.limits.maxStorageBufferBindingSize)
      throw Error(
        `${name} buffer (${data.byteLength} bytes) exceeds adapter storage limit (${device.limits.maxStorageBufferBindingSize} bytes)`,
      );
  }
  sceneBuffers.forEach((b) => b.destroy());
  sceneBuffers = [];
  sceneInfo = result;
  {const n=new Float32Array(result.nodes);sceneBounds=[...n.slice(0,3),...n.slice(4,7)];}
  activeSignals = signalSchedule(result.materials, {
    separate: separateSignals,
    cullEmpty: coverageReconstruction || parameters.get('cullEmpty') === '1',
  });
  forestViewControl.hidden = !result.views;
  if (result.views) $('#forest-view').value = 'trail';
  if (result.recommendedBounces && !parameters.has('bounces'))
    $('#bounces').value = String(result.recommendedBounces);
  floor = result.floor;
  state.scene = $('#scene').value;
  const pose =
    result.camera ||
    (state.scene === 'all'
      ? { yaw: 0.1, pitch: 0.35, distance: 4.2 }
      : { yaw: 0.62, pitch: 0.3, distance: 6.2 });
  if (!options.keepCamera) {
    yaw = pose.yaw;
    pitch = pose.pitch;
    distance = pose.distance;
    cameraTarget = pose.target || [0, 0, 0];
  }
  for (const data of [result.triangles, result.nodes, result.materials]) {
    if (data.byteLength > device.limits.maxStorageBufferBindingSize)
      throw Error('Mesh exceeds adapter storage limit');
    sceneBuffers.push(buffer(data));
  }
  sceneBuffers.push(buffer(metalCompensation?packMetalEnergy(result.portals,metalEnergyTable):new Float32Array(result.portals || 24)));
  sceneBuffers.push(buffer(result.attributes));
  sceneBuffers.push(buffer(result.lighting));
  progress('Preparing frame buffers…');
  await resize();
  state.ready = true;
  setPaused(false);
  state.loading = null;
  status.textContent = '';
  $('#scene').disabled = false;
  $('#fluid-frame').disabled = false;
  $('#show-all').disabled = false;
  $('#show-gallery').disabled = false;
  $('#gallery-focus').disabled = false;
  $('#gallery-inspect').disabled = !$('#gallery-focus').value;
  for (const button of galleryLabels.children) button.disabled = false;
  const url = new URL(location.href);
  url.searchParams.set('scene', state.scene);
  url.searchParams.set('fluidFrame', $('#fluid-frame').value);
  if (selected === 'example-gallery' && $('#gallery-focus').value)
    url.searchParams.set('focus', $('#gallery-focus').value);
  else url.searchParams.delete('focus');
  history.replaceState(null, '', url);
  if (options.keepCamera) scheduleGalleryDetail();
}
async function resize() {
  gpuRuntime.assertActive();
  gpuRuntime.setPhase('Allocating frame buffers');
  state.interactionEpoch++;
  state.ready = false;
  await device.queue.onSubmittedWorkDone();
  gpuRuntime.assertActive();
  frameBuffers.forEach((b) => b.destroy());
  frameBuffers = [];
  const h = Number($('#resolution').value),
    w = Math.round((h * 16) / 9);
  canvas.width = w;
  canvas.height = h;
  uniform = buffer(
    separateSignals || contributorCoverage || coverageReconstruction ? 176 : 160,
    GPUBufferUsage.UNIFORM,
  );
  samples = buffer(w * h * pixelBytes);
  cameraMediumBuffer = transportIntegrityEnabled ? buffer(400) : null;
  aaRaw = adaptiveAA ? buffer(w * h * pixelBytes * 2) : null;
  histories = [buffer(w * h * pixelBytes), buffer(w * h * pixelBytes)];
  colors = [buffer(w * h * 16 * signalCount), buffer(w * h * 16 * signalCount)];
  rejectionBuffer = rejectionProfiling
    ? buffer(w * h * 16 * signalCount)
    : null;
  visibilityBuffer = visibilityProfiling ? buffer(w * h * 16) : null;
  screenCache = screenCacheEnabled ? buffer(w * h * 96) : null;
  modulation = separateSignals
    ? buffer(w * h * 16 * (endpointCache ? 7 : 1))
    : null;
  configs = [1, 2, 4].map((step) =>
    buffer(
      new Uint32Array([
        w,
        h,
        step,
        parameters.get('history') === 'legacy' ? 0 : 1,
      ]),
      GPUBufferUsage.UNIFORM,
    ),
  );
  frameBuffers.push(uniform, samples, ...histories, ...colors, ...configs);
  if (cameraMediumBuffer) {
    frameBuffers.push(cameraMediumBuffer);
    cameraMediumGroup = device.createBindGroup({
      layout: cameraMediumPipeline.getBindGroupLayout(0),
      entries: [
        [0, uniform],
        [1, sceneBuffers[0]],
        [2, sceneBuffers[1]],
        [3, sceneBuffers[2]],
        [6, sceneBuffers[4]],
        [7, sceneBuffers[5]],
        [8, cameraMediumBuffer],
      ].map(([binding, b]) => ({ binding, resource: { buffer: b } })),
    });
  }
  if (rejectionBuffer) frameBuffers.push(rejectionBuffer);
  if (visibilityBuffer) frameBuffers.push(visibilityBuffer);
  if (traversalProfiling) {
    traversalStats = buffer(w * h * 16);
    frameBuffers.push(traversalStats);
    traversalDisplayGroup = group(traversalDisplayPipeline, [
      diagnosticUniform,
      traversalStats,
    ]);
  }
  if (aaRaw) {
    frameBuffers.push(aaRaw);
    aaResolveGroup = group(aaResolvePipeline, [configs[0], aaRaw, samples]);
  }
  if (modulation) frameBuffers.push(modulation);
  if (endpointCache)
    endpointGroups = histories.map((b) =>
      colors.map((c) => group(endpointPipeline, [uniform, b, c, modulation])),
    );
  if (contributorCoverage) {
    contributorLayers = [buffer(w * h * 128), buffer(w * h * 128)];
    contributorOutput = buffer(w * h * 16);
    frameBuffers.push(...contributorLayers, contributorOutput);
    contributorGroups = histories.map((b, i) =>
      colors.map((c) =>
        group(contributorPipeline, [
          uniform,
          b,
          contributorLayers[1 - i],
          contributorLayers[i],
          c,
          contributorOutput,
          ...(separateSignals ? [modulation] : []),
        ]),
      ),
    );
  }
  if (screenCache) {
    frameBuffers.push(screenCache);
    screenCacheGroups = [0, 1].map((i) =>
      colors.map((color) =>
        group(screenCachePipeline, [
          configs[0],
          histories[i],
          color,
          screenCache,
        ]),
      ),
    );
  }
  if (coverageReconstruction) {
    coverageBuffers = [buffer(w * h * 16), buffer(w * h * 16)];
    frameBuffers.push(...coverageBuffers);
    coverageGroups = [0, 1].map((i) =>
      colors.map((color) =>
        group(coveragePipeline, [
          uniform,
          histories[i],
          histories[1 - i],
          color,
          ...(separateSignals ? [modulation] : []),
          coverageBuffers[1 - i],
          coverageBuffers[i],
        ]),
      ),
    );
  }
  instanceLodGroup = null;
  if (sceneInfo.instanceRecordStart !== undefined) {
    const records = buffer(
      new Uint32Array([
        sceneInfo.instanceRecordStart,
        sceneInfo.instanceCount,
        0,
        0,
      ]),
      GPUBufferUsage.UNIFORM,
    );
    frameBuffers.push(records);
    instanceLodGroup = group(instanceLodPipeline, [
      uniform,
      sceneBuffers[1],
      records,
    ]);
  }
  traceGroup = [0, 1].map((i) =>
    group(pipelines[0], [
      uniform,
      ...sceneBuffers.slice(0, 3),
      aaRaw || samples,
      sceneBuffers[3],
      sceneBuffers[4],
      sceneBuffers[5],
      ...(modulation ? [modulation] : []),
      ...(adaptiveAA ? [histories[1 - i]] : []),
      ...(screenCache ? [screenCache] : []),
      ...(traversalProfiling ? [traversalStats] : []),
      ...(visibilityBuffer ? [visibilityBuffer] : []),
      ...(cameraMediumBuffer ? [cameraMediumBuffer] : []),
    ]),
  );
  if(cameraMediumBuffer)outsideTraceGroup=group(outsideTracePipeline,[uniform,...sceneBuffers.slice(0,3),samples,sceneBuffers[3],sceneBuffers[4],sceneBuffers[5]]);
  if(extraOpticalSample)opticalSampleGroup=group(opticalSamplePipeline,[uniform,...sceneBuffers.slice(0,3),samples,sceneBuffers[3],sceneBuffers[4],sceneBuffers[5]]);
  reconstructionGroups = [0, 1].map((i) =>
    reconstructionPipelines.map((p) =>
      group(p, [
        uniform,
        samples,
        histories[1 - i],
        histories[i],
        colors[0],
        ...(rejectionBuffer ? [rejectionBuffer] : []),
      ]),
    ),
  );
  filterGroups = [0, 1].map((i) =>
    configs.map((config, j) =>
      filterPipelines[j].map((p) =>
        group(p, [config, histories[i], colors[j % 2], colors[1 - (j % 2)]]),
      ),
    ),
  );
  displayGroups = (
    contributorCoverage
      ? [contributorOutput, contributorOutput]
      : coverageReconstruction
        ? coverageBuffers
        : colors
  ).map((b) =>
    group(pipelines[3], [
      configs[0],
      b,
      uniform,
      ...(modulation && !coverageReconstruction && !contributorCoverage
        ? [modulation]
        : []),
    ]),
  );
  diagnosticGroups = [samples, ...histories].map((b) =>
    group(diagnosticPipeline, [diagnosticUniform, b]),
  );
  reset();
  state.ready = true;
}
function reset() {
  state.frame = 0;
  state.settled = 0;
  state.converged = false;
  previousCamera = null;
  state.timings = [];
  state.gpuTimes = [];
  state.gpuFrameTimes = [];
  diagnostics?.clear();
}
function dispatch(encoder, pipeline, bindings, timestampWrites, depth = 1) {
  const pass = encoder.beginComputePass(
    timestampWrites ? { timestampWrites } : {},
  );
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindings);
  pass.dispatchWorkgroups(
    Math.ceil(canvas.width / (pipelineWorkgroups.get(pipeline) || 8)),
    Math.ceil(canvas.height / (pipelineWorkgroups.get(pipeline) || 8)),
    depth,
  );
  pass.end();
}
function render() {
  const cam = camera(),
    prev = previousCamera || cam;
  const moving =
    !!previousCamera &&
    (cam.eye.some((v, i) => Math.abs(v - prev.eye[i]) > 1e-6) ||
      cam.forward.some((v, i) => Math.abs(v - prev.forward[i]) > 1e-6) ||
      cam.tan !== prev.tan);
  const reference = $('#mode').value === 'reference';
  if (moving && reference) state.frame = 0;
  state.settled = moving ? 0 : state.settled + 1;
  state.converged = false;
  const bytes = new ArrayBuffer(
      separateSignals || contributorCoverage || coverageReconstruction ? 176 : 160,
    ),
    f = new Float32Array(bytes),
    ints = new Uint32Array(bytes);
  ints.set([
    canvas.width,
    canvas.height,
    state.frame,
    Number($('#bounces').value),
  ]);
  f.set([...cam.eye, floor], 4);
  f.set([...cam.right, 0], 8);
  f.set([...cam.up, 0], 12);
  f.set([...cam.forward, cam.tan], 16);
  f.set([...prev.eye, 0], 20);
  f.set([...prev.right, 0], 24);
  f.set([...prev.up, 0], 28);
  f.set([...prev.forward, prev.tan], 32);
  f.set([moving ? 1 : 0, reference ? 1 : 0, 0, 0], 36);
  // Experimental: window sampling has not passed the noise/performance gate.
  f[38] =
    sceneInfo?.portals?.length &&
    new URLSearchParams(location.search).get('portals') === '1'
      ? 1
      : 0;
  f[39] = parameters.get('history') === 'legacy' ? 0 : 1;
  if (['bilinear', 'confidence'].includes(motionReconstruction) && f[39] > 0)
    f[39] += 2;
  if (coverageReconstruction && f[39] > 0 && (Math.floor(f[39]) & 2) === 0)
    f[39] += 2;
  if (parameters.get('reflection') !== 'legacy' && f[39] > 0) f[39] += 4;
  if (screenCacheEnabled && !reference && $('#denoise').checked) f[39] += 16;
  f[11] = parameters.get('sampler') === 'legacy' ? 0 : 1;
  // Environment importance sampling remains opt-in until equal-time image gates.
  f[15] = parameters.get('environmentSampling') === '1' ? 1 : 0;
  f[23] =
    coverageReconstruction ||
    contributorCoverage ||
    parameters.get('optics') === 'paths' ||
    parameters.get('primary') === 'shared'
      ? 1
      : 0;
  f[27] = sceneInfo?.exposure ?? 1;
  f[31] = coverageReconstruction || parameters.get('glass') === 'split' ? 1 : 0;
  if (separateSignals) {
    f[40] = parameters.get('decompose') === '0' ? 0 : 1;
    f[41] = parameters.get('splitExit') === '1' || parameters.get('optics') === 'paths' ? 1 : 0;
  }
  if (coverageReconstruction) {
    f[40] = reference ? 0 : 1;
    if (!separateSignals) f[41] = state.settled;
    f[42] = $('#denoise').checked ? 1 : 0;
  }
  if (endpointCache) f[42] = $('#denoise').checked ? 1 : 0;
  if (contributorCoverage) f[43] = $('#denoise').checked ? 1 : 0;
  device.queue.writeBuffer(uniform, 0, bytes);
  const encoder = device.createCommandEncoder();
  const timed = !!querySet && !queryBusy;
  const updateLod = !!instanceLodGroup && (moving || state.frame === 0);
  const outside=cameraMediumBuffer&&outsideSceneBounds(cam.eye,sceneBounds);
  const updateMedium = !!cameraMediumBuffer && !outside && (moving || state.frame === 0);
  if(outside&&(moving||state.frame===0))device.queue.writeBuffer(cameraMediumBuffer,0,new Uint32Array(4));
  if (updateLod) {
    const pass = encoder.beginComputePass(
      timed
        ? { timestampWrites: { querySet, beginningOfPassWriteIndex: 0 } }
        : {},
    );
    pass.setPipeline(instanceLodPipeline);
    pass.setBindGroup(0, instanceLodGroup);
    pass.dispatchWorkgroups(Math.ceil(sceneInfo.instanceCount / 128));
    pass.end();
  }
  if (updateMedium) {
    const pass = encoder.beginComputePass(
      timed && !updateLod
        ? { timestampWrites: { querySet, beginningOfPassWriteIndex: 0 } }
        : {},
    );
    pass.setPipeline(cameraMediumPipeline);
    pass.setBindGroup(0, cameraMediumGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
  }
  dispatch(
    encoder,
    outside?outsideTracePipeline:pipelines[0],
    outside?outsideTraceGroup:traceGroup[state.frame % 2],
    tracePassTiming(timed?querySet:null,updateLod||updateMedium,extraOpticalSample&&!reference),
    adaptiveAA ? 4 : 1,
  );
  if(extraOpticalSample&&!reference)dispatch(encoder,opticalSamplePipeline,opticalSampleGroup,timed?{querySet,endOfPassWriteIndex:1}:undefined);
  if (adaptiveAA) dispatch(encoder, aaResolvePipeline, aaResolveGroup);
  const parity = state.frame % 2;
  const detailed = timed && diagnostics.enabled;
  for (const [i, c] of activeSignals.entries())
    dispatch(
      encoder,
      reconstructionPipelines[c],
      reconstructionGroups[parity][c],
      detailed && (i === 0 || i === activeSignals.length - 1)
        ? {
            querySet,
            ...(i === 0 ? { beginningOfPassWriteIndex: 4 } : {}),
            ...(i === activeSignals.length - 1
              ? { endOfPassWriteIndex: 5 }
              : {}),
          }
        : undefined,
    );
  // Detailed-only boundary markers include every lobe/filter dispatch in the interval.
  if (detailed) {
    const p = encoder.beginComputePass({
      timestampWrites: { querySet, beginningOfPassWriteIndex: 6 },
    });
    p.end();
  }
  if (!reference && $('#denoise').checked) {
    for (let step = 0; step < filterGroups[parity].length; step++) {
      for (const c of fusedCoverageFilter ? [0] : activeSignals)
        dispatch(
          encoder,
          filterPipelines[step][c],
          filterGroups[parity][step][c],
        );
    }
  }
  if (detailed) {
    const p = encoder.beginComputePass({
      timestampWrites: { querySet, endOfPassWriteIndex: 7 },
    });
    p.end();
  }
  if (coverageReconstruction)
    dispatch(
      encoder,
      coveragePipeline,
      coverageGroups[parity][
        !reference && $('#denoise').checked ? configs.length % 2 : 0
      ],
    );
  if (screenCacheEnabled)
    dispatch(
      encoder,
      screenCachePipeline,
      screenCacheGroups[parity][
        !reference && $('#denoise').checked ? configs.length % 2 : 0
      ],
    );
  if (endpointCache)
    dispatch(
      encoder,
      endpointPipeline,
      endpointGroups[parity][
        !reference && $('#denoise').checked ? configs.length % 2 : 0
      ],
    );
  if (contributorCoverage)
    dispatch(
      encoder,
      contributorPipeline,
      contributorGroups[parity][
        !reference && $('#denoise').checked ? configs.length % 2 : 0
      ],
    );
  const pass = encoder.beginRenderPass({
    ...(timed
      ? {
          timestampWrites: {
            querySet,
            beginningOfPassWriteIndex: 2,
            endOfPassWriteIndex: 3,
          },
        }
      : {}),
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      },
    ],
  });
  const debugView = diagnostics.view;
  if (debugView)
    device.queue.writeBuffer(
      diagnosticUniform,
      0,
      new Uint32Array([
        canvas.width,
        canvas.height,
        debugView,
        diagnostics.channel,
      ]),
    );
  pass.setPipeline(
    debugView >= 11
      ? traversalDisplayPipeline
      : debugView
        ? diagnosticPipeline
        : pipelines[3],
  );
  pass.setBindGroup(
    0,
    debugView >= 11
      ? traversalDisplayGroup
      : debugView
        ? diagnosticGroups[debugView === 1 ? 0 : 1 + parity]
        : displayGroups[
            coverageReconstruction
              ? parity
              : !reference && $('#denoise').checked
                ? configs.length % 2
                : 0
          ],
  );
  pass.draw(3);
  pass.end();
  if (timed) {
    encoder.resolveQuerySet(querySet, 0, detailed ? 8 : 4, queryResolve, 0);
    encoder.copyBufferToBuffer(
      queryResolve,
      0,
      queryRead,
      0,
      detailed ? 64 : 32,
    );
    queryBusy = true;
  }
  gpuRuntime.setPhase('Rendering');
  device.queue.submit([encoder.finish()]);
  flight++;
  device.queue
    .onSubmittedWorkDone()
    .then(() => {
      flight--;
    })
    .catch(fail);
  if (timed)
    queryRead
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const times = new BigUint64Array(queryRead.getMappedRange());
        const ms = Number(times[1] - times[0]) / 1e6;
        state.gpuTimes.push(ms);
        state.gpuFrameTimes.push(Number(times[3] - times[0]) / 1e6);
        diagnostics.record({
          ...decodeStages(times, detailed),
          view: debugView,
          detailed,
        });
        if (state.gpuTimes.length > 240) {
          state.gpuTimes.shift();
          state.gpuFrameTimes.shift();
        }
        queryRead.unmap();
        queryBusy = false;
      })
      .catch((e) => {
        queryBusy = false;
        fail(e);
      });
  previousCamera = cam;
  state.frame++;
  if (sampleLimit && state.frame >= sampleLimit) {
    setPaused(true, 'sample-limit');
    status.textContent =
      'Verification capture complete. Drag or zoom to continue rendering.';
    metrics();
  }
}
function loop(now) {
  frameId = requestAnimationFrame(loop);
  if (document.hidden || state.paused || !state.ready) {
    lastTime = 0;
    return;
  }
  if (flight >= 2) return;
  playControls.update(now);
  positionGalleryLabels(camera());
  const cap = $('#mode').value === 'reference' ? 2048 : 512;
  if (
    state.settled >= cap &&
    previousCamera &&
    camera().eye.every((v, i) => Math.abs(v - previousCamera.eye[i]) <= 1e-6)
  ) {
    state.converged = true;
    lastTime = 0;
    return;
  }
  if (lastTime) {
    state.timings.push(now - lastTime);
    if (state.timings.length > 240) state.timings.shift();
  }
  lastTime = now;
  try {
    render();
  } catch (e) {
    fail(e);
  }
  if (state.frame % 15 === 0) metrics();
}
const average = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
function snapshot() {
  const times = [...state.timings].sort((a, b) => a - b);
  return {
    adapter: $('#adapter').textContent,
    gpuSession: gpuRuntime?.snapshot() || null,
    mediumStack: mediumStackMode ? { ...mediumStackMode } : null,
    gpuCompatibility: compatibilityMode ? { mode: 'compact', traceWorkgroup: 4, mediumSlots: 10, maxBounces: 10, physicalAdrenoVerified: false } : null,
    backend: separateSignals ? 'separate-signals' : 'baseline',
    opticalSamples:extraOpticalSample&&$('#mode').value!=='reference'?2:1,
    activeSignals: [...activeSignals],
    transmissionSupport:
      separateSignals && parameters.get('transmissionSupport') === 'guided'
        ? 'rough-endpoint-experimental'
        : 'narrow',
    lightCandidates: separateSignals
      ? Number(parameters.get('lightCandidates') || 1)
      : 1,
    motionReconstruction,
    transport: transportIntegrityEnabled ? 'corrected-experimental' : 'baseline',
    diffuseHistory: endpointCache
      ? 'endpoint-albedo-validated'
      : signalDiffuseHistory
        ? 'signal-albedo-validated'
        : separateSignals
          ? 'separated-backend'
          : parameters.get('diffuseHistory') === 'legacy'
            ? 'legacy-clamp'
            : 'albedo-validated',
    radianceCache: endpointCache
      ? 'endpoint-diffuse-experimental'
      : screenCacheEnabled
        ? 'screen-experimental'
        : 'none',
    rejectionProfiling,
    visibilityProfiling,
    opticalGuides,
    coverageSampling: adaptiveAA ? 'adaptive-4' : 'single',
    presentationReconstruction: contributorCoverage
      ? 'contributors-experimental'
      : coverageReconstruction
        ? (separateSignals ? 'coverage-experimental' : 'coverage-single')
        : 'none',
    fusedCoverageFilter,
    camera: { yaw, pitch, distance, target: [...cameraTarget] },
    nearModels: sceneInfo?.nearModels || [],
    ready: state.ready,
    loading: state.loading ? { ...state.loading } : null,
    scene: state.scene,
    frames: state.frame,
    paused: state.paused,
    errors: [...state.errors],
    resolution: [canvas.width, canvas.height],
    presentFPS: state.timings.length ? 1000 / average(state.timings) : 0,
    frameMsP95: times[Math.floor(times.length * 0.95)] || 0,
    traceGpuMs: average(state.gpuTimes),
    gpuTimingSamples: state.gpuTimes.length,
    filterTileSteps: [...filterTileSteps],
    metalCompensation,
    gpuFrameMs: average(state.gpuFrameTimes),
    gpuTiming: !!querySet,
    traversalProfiling,
    diagnostics: {
      view: diagnostics?.view || 0,
      detailed: diagnostics?.enabled || false,
      last: diagnostics?.rows.at(-1) || null,
    },
    triangles: sceneInfo?.count,
    instances: sceneInfo?.instanceCount || 1,
    tlasLeafSize: sceneInfo?.tlasLeafSize || null,
    buildStats: sceneInfo?.buildStats || null,
    representedTriangles: sceneInfo?.representedTriangles || sceneInfo?.count,
    bvhNodes: sceneInfo?.nodeCount,
    bvhNodeBytes: sceneInfo?.nodeBytes || 48,
    meshletAttributes: sceneInfo?.meshletInfo || null,
    maxBvhDepth: sceneInfo?.maxDepth,
    mode: $('#mode').value,
    bounces: Number($('#bounces').value),
    denoise: $('#denoise').checked,
    bytesResident: sceneBuffers
      .concat(frameBuffers)
      .reduce((n, b) => n + b.size, 0),
  };
}
function metrics() {
  const s = snapshot();
  $('#metrics').innerHTML = [
    ['Submitted FPS', s.presentFPS.toFixed(1)],
    ['Frame p95', s.frameMsP95.toFixed(1) + ' ms'],
    [
      'GPU trace',
      s.gpuTiming ? s.traceGpuMs.toFixed(2) + ' ms' : 'Unavailable',
    ],
    [
      'GPU full frame',
      s.gpuTiming ? s.gpuFrameMs.toFixed(2) + ' ms' : 'Unavailable',
    ],
    ['Samples submitted', s.frames],
    ['Triangles', s.triangles.toLocaleString()],
    ...(s.instances > 1
      ? [
          ['Instances', s.instances.toLocaleString()],
          ['Instanced triangles', s.representedTriangles.toLocaleString()],
        ]
      : []),
    ['GPU buffers', (s.bytesResident / 1048576).toFixed(0) + ' MiB'],
  ]
    .map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`)
    .join('');
}
function setPaused(value, reason = 'manual') {
  state.paused = value;
  state.pauseReason = value ? reason : null;
  $('#pause').textContent = value ? 'Resume' : 'Pause';
}
function interact() {
  if (state.paused)
    state.lastInteraction = new Error('Renderer interaction while paused').stack
      ?.split('\n')
      .slice(1, 4)
      .join(' | ');
  state.interactionEpoch++;
  if (state.pauseReason === 'verification') setPaused(false);
  if (sampleLimit) {
    sampleLimit = 0;
    const url = new URL(location.href);
    url.searchParams.delete('samples');
    history.replaceState(null, '', url);
  }
  if (state.pauseReason === 'sample-limit') {
    status.textContent = '';
    setPaused(false);
  }
}
async function inspectOutput(stage = 'output') {
  const index =
    $('#mode').value !== 'reference' && $('#denoise').checked
      ? configs.length % 2
      : 0;
  const source =
      (stage === 'output' || stage === 'coverage') && contributorCoverage
        ? contributorOutput
        : stage === 'coverage' && coverageReconstruction
          ? coverageBuffers[(state.frame + 1) % 2]
          : stage === 'samples'
            ? samples
            : stage === 'history' || stage === 'temporal'
              ? histories[(state.frame + 1) % 2]
              : colors[index],
    stride = stage === 'samples' || stage === 'history' ? pixelBytes / 4 : 4;
  const mapped = await readFloatBuffer(device, source);
  const data =
    stage === 'temporal'
      ? temporalColors(
          mapped,
          canvas.width * canvas.height,
          pixelBytes / 4,
          separateSignals,
        )
      : mapped;
  let nonfinite = 0,
    negative = 0,
    maximum = 0;
  const locations = [],
    channels = Array(stride).fill(0);
  for (let i = 0; i < data.length; i++) {
    if (!Number.isFinite(data[i])) {
      nonfinite++;
      channels[i % stride]++;
      if (locations.length < 8)
        locations.push([
          Math.floor(i / stride) % canvas.width,
          Math.floor(i / stride / canvas.width),
          i % stride,
        ]);
    } else {
      maximum = Math.max(maximum, data[i]);
      if (data[i] < 0) negative++;
    }
  }
  const historyStats = {};
  if (stage === 'history' && separateSignals) {
    for (const [name, colorOffset, momentOffset] of [
      ['directDiffuse', 0, 20],
      ['specular', 4, 24],
      ['transmission', 8, 28],
      ['indirectDiffuse', 40, 44],
    ]) {
      let luminance = 0,
        temporalVariance = 0,
        sampleCount = 0,
        activePixels = 0;
      for (let i = 0; i < data.length; i += stride) {
        const l = data[i + momentOffset];
        luminance += l;
        temporalVariance += Math.max(0, data[i + momentOffset + 1] - l * l);
        sampleCount += data[i + colorOffset + 3];
        if (l > 1e-8) activePixels++;
      }
      const pixels = data.length / stride;
      historyStats[name] = {
        pixels,
        activePixels,
        meanLuminance: luminance / pixels,
        meanTemporalVariance: temporalVariance / pixels,
        meanSamples: sampleCount / pixels,
      };
    }
  }
  if (stage === 'history' && !separateSignals) {
    for (let i = 0; i < data.length; i += stride) {
      const name =
        data[i + 15] === -1
          ? 'glass'
          : data[i + 15] === 0
            ? 'diffuse'
            : 'reflective';
      const s = (historyStats[name] ??= {
        pixels: 0,
        samples: 0,
        secondaryGuides: 0,
        luminance: 0,
        temporalVariance: 0,
      });
      s.pixels++;
      s.samples += data[i + 3];
      s.luminance += data[i + 12];
      s.temporalVariance += Math.max(
        0,
        data[i + 13] - data[i + 12] * data[i + 12],
      );
      if (data[i + 23] > 0.5) s.secondaryGuides++;
    }
    for (const s of Object.values(historyStats)) {
      s.meanSamples = s.samples / s.pixels;
      s.meanLuminance = s.luminance / s.pixels;
      s.meanTemporalVariance = s.temporalVariance / s.pixels;
    }
  }
  let geometryCoverage;
  let coverageStats;
  if (stage === 'coverage' && coverageReconstruction) {
    let sum = 0,
      rejected = 0;
    for (let i = 3; i < data.length; i += 4) {
      sum += data[i];
      if (data[i] < 1.01) rejected++;
    }
    coverageStats = {
      pixels: data.length / 4,
      meanSamples: sum / (data.length / 4),
      freshFraction: rejected / (data.length / 4),
    };
  }
  if (stage === 'samples' && !separateSignals) {
    let skyPixels = 0;
    for (let i = 0; i < data.length; i += stride)
      if (data[i + 7] === -1) skyPixels++;
    geometryCoverage = {
      pixels: data.length / stride,
      skyPixels,
      skyFraction: skyPixels / (data.length / stride),
    };
  }
  return {
    stage,
    ...(geometryCoverage ? { geometryCoverage } : {}),
    ...(coverageStats ? { coverageStats } : {}),
    nonfinite,
    channels,
    negative,
    maximum,
    locations,
    ...(stage === 'history' ? { historyStats } : {}),
    ...(stage === 'history' && opticalGuides ? {opticalHistory:opticalHistoryStats(data,stride)} : {}),
  };
}
canvas.addEventListener('pointerdown', (e) => {
  interact();
  drag = [e.clientX, e.clientY, e.button !== 0 || e.shiftKey];
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', () => (drag = null));
canvas.addEventListener('pointercancel', () => (drag = null));
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag[0],
    dy = e.clientY - drag[1];
  if (drag[2] || e.shiftKey) {
    const cam = camera();
    const rect = canvas.getBoundingClientRect();
    const scale = (2 * distance * cam.tan) / Math.max(1, rect.height);
    cameraTarget = cameraTarget.map(
      (v, i) => v + (-dx * cam.right[i] + dy * cam.up[i]) * scale,
    );
  } else {
    yaw -= dx * 0.006;
    pitch = Math.max(
      -Math.PI / 2 + 0.01,
      Math.min(Math.PI / 2 - 0.01, pitch + dy * 0.006),
    );
  }
  drag = [e.clientX, e.clientY, drag[2]];
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
// Focus the surface actually under the cursor. Zooming toward the center of
// a million-object mound otherwise drives the camera into buried geometry.
canvas.addEventListener('dblclick', async (e) => {
  if (!state.ready || state.frame === 0) return;
  const generation = state.generation,
    rect = canvas.getBoundingClientRect();
  const x = Math.min(
    canvas.width - 1,
    Math.max(
      0,
      Math.floor(((e.clientX - rect.left) * canvas.width) / rect.width),
    ),
  );
  const y = Math.min(
    canvas.height - 1,
    Math.max(
      0,
      Math.floor(((e.clientY - rect.top) * canvas.height) / rect.height),
    ),
  );
  const read = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(
      histories[(state.frame + 1) % 2],
      (y * canvas.width + x) * pixelBytes + (separateSignals ? 48 : 16),
      read,
      0,
      16,
    );
    device.queue.submit([encoder.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const point = Array.from(new Float32Array(read.getMappedRange()));
    if (
      generation !== state.generation ||
      point[3] === -1 ||
      !point.every(Number.isFinite)
    )
      return;
    const eye = camera().eye,
      offset = eye.map((v, k) => v - point[k]);
    distance = Math.max(1e-6, Math.hypot(...offset));
    cameraTarget = point.slice(0, 3);
    yaw = Math.atan2(offset[0], offset[2]);
    pitch = Math.asin(
      Math.max(-0.9999, Math.min(0.9999, offset[1] / distance)),
    );
    interact();
    reset();
    scheduleGalleryDetail();
  } catch (error) {
    console.warn('Surface focus unavailable', error.message);
  } finally {
    read.destroy();
  }
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    interact();
    // Numerical guards only: five orders of magnitude either side of fit.
    const fit = sceneInfo?.camera?.distance || 4;
    const delta =
      e.deltaY *
      (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1);
    distance = Math.max(
      fit * 1e-5,
      Math.min(
        fit * 1e5,
        distance * Math.exp(Math.max(-2, Math.min(2, delta * 0.001))),
      ),
    );
  },
  { passive: false },
);
$('#scene').onchange = () => {
  interact();
  loadScene().catch(fail);
};
$('#resolution').onchange = () => {
  interact();
  resize().catch(fail);
};
$('#mode').onchange = () => {
  interact();
  reset();
};
$('#bounces').onchange = () => {
  interact();
  reset();
};
$('#reset').onclick = () => {
  interact();
  reset();
};
$('#pause').onclick = () => {
  const resume = state.paused;
  if (resume) interact();
  setPaused(!resume);
};
$('#show-all').onclick = () => {
  $('#scene').value = 'all';
  yaw = 0.1;
  pitch = 0.35;
  distance = 4.2;
  loadScene().catch(fail);
};
$('#show-gallery').onclick = () => {
  $('#scene').value = 'example-gallery';
  $('#gallery-focus').value = '';
  loadScene().catch(fail);
};
$('#fit-view').onclick = () => {
  interact();
  const pose = sceneInfo?.camera || {
    yaw: state.scene === 'all' ? 0.1 : 0.62,
    pitch: 0.35,
    distance: 4.2,
  };
  yaw = pose.yaw;
  pitch = pose.pitch;
  distance = pose.distance;
  cameraTarget = pose.target || [0, 0, 0];
  reset();
  setPaused(false);
};
$('#fluid-frame').oninput = () =>
  ($('#fluid-number').textContent = $('#fluid-frame').value + ' / 71');
$('#fluid-frame').onchange = () => loadScene().catch(fail);
$('#denoise').onchange = () => {
  state.settled = 0;
  state.converged = false;
};
// Deterministic, bounded GPU verification; no extra animation loop or sample cap.
async function verifySteps(poses) {
  if (!Array.isArray(poses) || poses.length > 256)
    throw Error('Verification requires at most 256 poses');
  if (
    poses.some(
      (p) =>
        p !== null &&
        (!Array.isArray(p) ||
          p.length !== 3 ||
          !p.every(Number.isFinite) ||
          p[2] <= 0),
    )
  )
    throw Error('Invalid verification camera');
  const generation = state.generation,
    epoch = state.interactionEpoch;
  state.lastInteraction = undefined;
  const check = () => {
    if (
      generation !== state.generation ||
      epoch !== state.interactionEpoch ||
      !state.ready
    )
      throw Error(
        `Verification cancelled: generation ${generation}/${state.generation}, interaction ${epoch}/${state.interactionEpoch}, ready ${state.ready}; ${state.lastInteraction || 'scene/resize'}`,
      );
  };
  check();
  setPaused(true, 'verification');
  await device.queue.onSubmittedWorkDone();
  for (const pose of poses) {
    check();
    if (pose) {
      [yaw, pitch, distance] = pose;
    }
    render();
    await device.queue.onSubmittedWorkDone();
    check();
    if (state.errors.length) throw Error(state.errors.at(-1));
  }
  setPaused(true, 'verification');
  metrics();
  return snapshot();
}
async function verifyOptions({
  legacyHistory = false,
  legacySampler = false,
  glass = parameters.get('glass') === 'split',
  motion = parameters.get('motion') === 'bilinear',
} = {}) {
  setPaused(true);
  await device.queue.onSubmittedWorkDone();
  parameters.set('history', legacyHistory ? 'legacy' : 'validated');
  parameters.set('sampler', legacySampler ? 'legacy' : 'energy');
  parameters.set('glass', glass ? 'split' : 'legacy');
  parameters.set('motion', motion ? 'bilinear' : 'legacy');
  motionReconstruction = motionHistoryMode(
    parameters.get('motion'),
    separateSignals,
  );
  configs.forEach((b, i) =>
    device.queue.writeBuffer(
      b,
      0,
      new Uint32Array([
        canvas.width,
        canvas.height,
        [1, 2, 4][i],
        legacyHistory ? 0 : 1,
      ]),
    ),
  );
  reset();
}
window.cybrLight = {
  revision: 'noise-20260927',
  activeOptions: () => ({
    glass: parameters.get('glass'),
    motion: parameters.get('motion'),
  }),
  convergence: () => ({ settled: state.settled, idle: state.converged }),
  snapshot,
  reset,
  inspectOutput,
  // Explicit paused diagnostics only; keep arrays in the browser, not tool logs.
  async captureLinearStages() {
    if (!state.paused || !state.ready)
      throw Error('Pause a ready renderer before readback');
    if ((coverageReconstruction && separateSignals) || contributorCoverage)
      throw Error(
        'Stage capture does not support alternate presentation buffers',
      );
    const generation = state.generation,
      epoch = state.interactionEpoch,
      frame = state.frame;
    await device.queue.onSubmittedWorkDone();
    const count = canvas.width * canvas.height,
      stride = pixelBytes / 4;
    const raw = await readFloatBuffer(device, samples);
    const history = await readFloatBuffer(
      device,
      histories[(state.frame + 1) % 2],
    );
    const filtered = $('#mode').value !== 'reference' && $('#denoise').checked;
    const final = await readFloatBuffer(
      device,
      coverageReconstruction ? coverageBuffers[(state.frame + 1) % 2] : colors[filtered ? configs.length % 2 : 0],
    );
    const mod = separateSignals
      ? (await readFloatBuffer(device, modulation)).subarray(0, count * 4)
      : null;
    const rgb = (data) => {
      if (separateSignals) return recomposeSignals(data, mod, count);
      const out = new Float32Array(count * 3);
      for (let i = 0; i < count; i++)
        out.set(data.subarray(i * 4, i * 4 + 3), i * 3);
      return out;
    };
    const classes = new Int8Array(count);
    for (let i = 0; i < count; i++)
      classes[i] =
        raw[i * stride + (separateSignals ? 19 : 11)] === 0
          ? 2
          : raw[i * stride + (separateSignals ? 19 : 11)] < 0.3
            ? 1
            : 0;
    if (
      generation !== state.generation ||
      epoch !== state.interactionEpoch ||
      frame !== state.frame
    )
      throw Error('Stage capture cancelled by interaction');
    return {
      state: snapshot(),
      raw: rgb(temporalColors(raw, count, stride, separateSignals)),
      temporal: rgb(temporalColors(history, count, stride, separateSignals)),
      output: rgb(final),
      classes,
    };
  },
  async inspectRejection() {
    if (!rejectionBuffer) throw Error('Enable profileRejection=1');
    if (!state.paused)
      throw Error('Pause before reading rejection diagnostics');
    await device.queue.onSubmittedWorkDone();
    return summarizeRejection(
      await readFloatBuffer(device, rejectionBuffer),
      canvas.width * canvas.height,
      signalCount,
    );
  },
  async inspectReflectionRejection() {
    if(!rejectionBuffer||separateSignals||!state.paused)throw Error('Pause a single-signal rejection profile first');
    const frame=state.frame,generation=state.generation;
    await device.queue.onSubmittedWorkDone();
    const raw=await readFloatBuffer(device,samples),rejected=await readFloatBuffer(device,rejectionBuffer),groups=new Map();
    for(let i=0;i<canvas.width*canvas.height;i++){
      if(rejected[i*4+3]!==1)continue;
      const key=raw[i*24+11].toFixed(3)+' / guide '+raw[i*24+15];
      const g=groups.get(key)||{key,pixels:0,fresh:0,ineligible:0};g.pixels++;
      if(rejected[i*4+1]<=0)g.fresh++;if((rejected[i*4]&4)!==0)g.ineligible++;
      groups.set(key,g);
    }
    if(frame!==state.frame||generation!==state.generation)throw Error('Rejection inspection cancelled by scene interaction');
    return [...groups.values()].sort((a,b)=>b.fresh-a.fresh).slice(0,20);
  },
  async inspectVisibility() {
    if (!visibilityBuffer)
      throw Error('Enable profileVisibility=1 on plain baseline');
    if (!state.paused)
      throw Error('Pause before reading visibility diagnostics');
    await device.queue.onSubmittedWorkDone();
    return summarizeVisibility(await readFloatBuffer(device, visibilityBuffer));
  },
  async exportNoiseCapture(name = 'noise-capture', compact = false) {
    if (!state.paused || !state.ready)
      throw Error('Pause a ready renderer before diagnostic export');
    const generation = state.generation,
      epoch = state.interactionEpoch,
      frame = state.frame;
    await device.queue.onSubmittedWorkDone();
    const filtered = $('#mode').value !== 'reference' && $('#denoise').checked;
    const sources = {
      ...(!compact
        ? { samples, history: histories[(state.frame + 1) % 2] }
        : {}),
      output: colors[filtered ? configs.length % 2 : 0],
      ...(separateSignals ? { modulation } : {}),
    };
    const arrays = [],
      fields = [];
    for (const [key, source] of Object.entries(sources)) {
      let data = await readFloatBuffer(device, source);
      if (compact && key === 'modulation')
        data = data.subarray(0, canvas.width * canvas.height * 4);
      arrays.push(data);
      fields.push({ key, floats: data.length });
      if (
        generation !== state.generation ||
        epoch !== state.interactionEpoch ||
        frame !== state.frame
      )
        throw Error('Diagnostic export cancelled by interaction');
    }
    const header = new TextEncoder().encode(
      JSON.stringify({
        schema: 1,
        state: snapshot(),
        pixelFloats: pixelBytes / 4,
        separated: separateSignals,
        fields,
      }),
    );
    const rawBlob = new Blob(
      [new Uint32Array([header.length]), header, ...arrays],
      { type: 'application/octet-stream' },
    );
    const blob = await new Response(
      rawBlob.stream().pipeThrough(new CompressionStream('gzip')),
    ).blob();
    const url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.bin.gz';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { bytes: blob.size, fields: fields.map((f) => f.key), frame };
  },
  inspectReuse: async () => {
    await device.queue.onSubmittedWorkDone();
    const result = {};
    if (endpointCache) {
      const data = await readFloatBuffer(device, modulation);
      let attempts = 0,
        hits = 0;
      for (let i = canvas.width * canvas.height * 24; i < data.length; i += 4) {
        attempts += data[i];
        hits += data[i + 1];
      }
      result.endpoint = {
        attempts,
        hits,
        hitFraction: attempts ? hits / attempts : 0,
      };
    }
    if (contributorCoverage) {
      const data = await readFloatBuffer(
        device,
        contributorLayers[(state.frame + 1) % 2],
      );
      let dual = 0;
      for (let i = 27; i < data.length; i += 32) if (data[i] > 0) dual++;
      const output = await readFloatBuffer(device, contributorOutput);
      let overflow = 0;
      for (let i = 3; i < output.length; i += 4) if (output[i] < 0) overflow++;
      result.coverage = {
        pixels: canvas.width * canvas.height,
        dual,
        overflow,
      };
    }
    return result;
  },
  inspectTraversal: async () => {
    if (!traversalStats)
      throw Error(
        'Enable profileTraversal=1 on baseline without cache/adaptive AA',
      );
    await device.queue.onSubmittedWorkDone();
    return summarizeTraversal(await readFloatBuffer(device, traversalStats));
  },
  verifySteps,
  async inspectCameraMedium() {
    if (!cameraMediumBuffer || !state.paused)
      throw Error('Pause a main-renderer scene before inspecting camera media');
    await device.queue.onSubmittedWorkDone();
    const f = await readFloatBuffer(device, cameraMediumBuffer),
      i = new Uint32Array(f.buffer);
    return {
      count: i[0],
      truncated: i[1] !== 0,
      media: Array.from({ length: Math.min(i[0], 16) }, (_, n) => ({
        boundary: [i[4 + n * 2], i[5 + n * 2]],
        absorption: [...f.slice(36 + n * 4, 39 + n * 4)],
        ior: f[39 + n * 4],
      })),
    };
  },
  verifyOptions,
  waitIdle: () => device.queue.onSubmittedWorkDone(),
  pause: () => setPaused(true),
  resume: () => {
    interact();
    setPaused(false);
  },
  setCamera(a, b, c, target) {
    interact();
    yaw = a;
    pitch = b;
    distance = c;
    if (target) {
      if (target.length !== 3 || !target.every(Number.isFinite))
        throw Error('Invalid camera target');
      cameraTarget = [...target];
    }
  },
  async setScene(name) {
    if (!sceneChoices.some(([v]) => v === name))
      throw Error('Unknown scene: ' + name);
    $('#scene').value = name;
    await loadScene();
  },
  async setFluidFrame(frame) {
    $('#fluid-frame').value = String(
      Math.max(0, Math.min(71, Math.round(frame))),
    );
    await loadScene();
  },
  async setResolution(height) {
    $('#resolution').value = height;
    await resize();
  },
};
const playControls=mountPlayControls(canvas,{
  ready:()=>state.ready,
  pose:()=>({yaw,pitch,distance,target:[...cameraTarget]}),
  apply:pose=>window.cybrLight.setCamera(pose.yaw,pose.pitch,pose.distance,pose.target),
  resume:()=>window.cybrLight.resume(),
});
window.addEventListener('pagehide', () => {
  sessionClosed = true;
  state.paused = true;
  state.ready = false;
  state.generation++;
  playControls.dispose();
  cancelAnimationFrame(frameId);
  sceneLoader.cancel();
  if (gpuRuntime) gpuRuntime.dispose();
  else device?.destroy();
  context?.unconfigure();
});
// A cached document owns a destroyed device. Reload the same settings to create
// a fresh adapter/device/context instead of resuming stale GPU objects.
window.addEventListener('pageshow', event => { if (event.persisted && sessionClosed) location.reload(); });
window.cybrLight.verifyRecomposition = async (steps = 16) => {
  if (!separateSignals || !state.ready)
    throw Error('Ready four-signal backend required');
  if (!Number.isInteger(steps) || steps < 1 || steps > 128)
    throw Error('Use 1–128 verification frames');
  const mode = $('#mode').value,
    option = parameters.get('decompose'),
    paused = state.paused;
  const generation = state.generation,
    epoch = state.interactionEpoch,
    captures = [];
  try {
    $('#mode').value = 'reference';
    for (const split of ['0', '1']) {
      parameters.set('decompose', split);
      reset();
      await verifySteps(Array(steps).fill(null));
      const data = await readFloatBuffer(device, colors[0]);
      if (generation !== state.generation || epoch !== state.interactionEpoch)
        throw Error('Recomposition cancelled by interaction');
      const factors = await readFloatBuffer(device, modulation);
      if (generation !== state.generation || epoch !== state.interactionEpoch)
        throw Error('Recomposition cancelled by interaction');
      captures.push(
        recomposeSignals(
          data,
          factors.subarray(0, canvas.width * canvas.height * 4),
          canvas.width * canvas.height,
        ),
      );
    }
    return compareLinear(captures[0], captures[1]);
  } finally {
    if (generation === state.generation && epoch === state.interactionEpoch) {
      $('#mode').value = mode;
      if (option === null) parameters.delete('decompose');
      else parameters.set('decompose', option);
      reset();
      setPaused(paused);
    }
  }
};
boot().catch(fail);
