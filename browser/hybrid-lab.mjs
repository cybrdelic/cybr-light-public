import {
  rasterDraws,
  cameraBasis,
  shareSurfaceAnchors,
} from './hybrid-geometry.mjs';
import {
  incidentTransport,
  beautyCacheTransport,
} from './hybrid-transport.mjs';
import { instancedShader } from './instanced-shader.mjs';
import { buildSignalShaders } from './hybrid-shaders.mjs';
import { availableHybridModes } from './hybrid-modes.mjs';
import { readBuffer, readFloatBuffer } from './readback.mjs';
import { glassBounds } from './hybrid-glass-bounds.mjs';
const $ = (s) => document.querySelector(s),
  canvas = $('#viewport'),
  status = $('#status'),
  params = new URLSearchParams(location.search);
const sceneName = params.get('scene') || 'example-geo-printer';
const queued = params.get('queue') !== '0';
const experimentalBeauty = params.get('experimental') === 'beauty-cache';
const experimentalPaths = params.get('experimental') === 'path-cache';
const queuedConnections =
  params.get('experimental') === 'refracted-nee' &&
  params.get('work') === 'queue';
const connectionChance = Number(params.get('connectionChance') || 0.125);
if (![0.03125, 0.0625, 0.125, 0.25, 0.5, 1].includes(connectionChance))
  throw Error('Unsupported connection sampling probability');
if (experimentalBeauty) {
  const option = document.createElement('option');
  option.value = 'hybrid';
  option.textContent = 'Rejected beauty-cache experiment (research only)';
  $('#mode').append(option);
}
if (
  ![
    'example-geo-printer',
    'example-pile',
    'proof-optics',
    'proof-metals',
    'proof-indirect',
  ].includes(sceneName)
)
  throw Error('Unsupported hybrid lab scene');
$('#scene').value = sceneName;
const state = {
  ready: false,
  paused: true,
  frame: 0,
  errors: [],
  scene: sceneName,
  mode: 'cache',
  epoch: 1,
  timings: [],
  counts: [],
  scope:
    'unit-Lambertian primary diagnostic; full production secondary transport; no primary optical reconstruction',
};
let device,
  context,
  scene,
  pose,
  uniform,
  controls,
  owners,
  cells,
  result,
  stats,
  visibility,
  depth,
  draws,
  raster,
  pipelines,
  groups,
  display,
  displayGroup,
  lod,
  lodGroup;
let visibilityHigh,
  queries,
  queryBuffer,
  readback,
  metadata,
  busy = false,
  referenceFrame = 0,
  lastReferenceCamera = '',
  raf = 0;
let ownerSignature = '';
let primaryRaster,
  primaryGroup,
  signalBuffer,
  guideBuffer,
  signalGroups,
  signalPipeline,
  reconstructPipeline,
  opticalPipeline,
  opticalBuffer;
let signalView = 0;
let previousRender = null;
let renderedPhase = 0,
  reconstructionFrame = 0;
let sampleUniform;
let pathBuffer,
  pathGroups,
  pathPipeline,
  pathUpdate,
  pathEpoch = 0;
let controlSignalPipeline;
let connectionBuffer,
  connectionGroups,
  connectionTrace,
  connectionClear,
  connectionSolve,
  connectionResolve;
const slots = 2097152,
  W = 960,
  H = 540;
const modes = availableHybridModes(params.get('experimental'));
const currentMode = () => modes[state.mode];
const isRaster = () => !!currentMode().raster;
if (Object.hasOwn(modes, params.get('mode'))) state.mode = params.get('mode');
$('#mode').value = state.mode;
function fail(e) {
  state.errors.push(e.message || String(e));
  state.paused = true;
  status.textContent = state.errors.join('\n');
}
function buffer(data, usage = GPUBufferUsage.STORAGE) {
  const n = typeof data === 'number' ? data : data.byteLength;
  const b = device.createBuffer({
    size: Math.max(16, Math.ceil(n / 4) * 4),
    usage: usage | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  if (typeof data !== 'number') device.queue.writeBuffer(b, 0, data);
  return b;
}
const text = async (name) => {
  const r = await fetch(name, { cache: 'no-store' });
  if (!r.ok) throw Error(name + ': ' + r.status);
  const source = await r.text();
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(source),
  );
  (state.sourceHashes ??= {})[name] = Array.from(new Uint8Array(hash), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('');
  return source;
};
const bg = (layout, resources) =>
  device.createBindGroup({
    layout,
    entries: resources.map(([binding, resource]) => ({
      binding,
      resource: resource instanceof GPUBuffer ? { buffer: resource } : resource,
    })),
  });
async function module(code, label) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(code),
  );
  (state.moduleHashes ??= {})[label] = Array.from(new Uint8Array(hash), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('');
  const m = device.createShaderModule({ code, label });
  const info = await m.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === 'error');
  if (errors.length)
    throw Error(
      label + ': ' + errors.map((m) => m.lineNum + ': ' + m.message).join('\n'),
    );
  return m;
}
async function loadScene() {
  const worker = new Worker('./bvh-worker.js', { type: 'module' });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.terminate();
        reject(Error('Scene build exceeded 120 seconds'));
      }, 120000);
      worker.onerror = (e) => {
        clearTimeout(timer);
        reject(Error(e.message));
      };
      worker.onmessage = ({ data }) => {
        if (data.progress) {
          status.textContent = data.progress;
          return;
        }
        clearTimeout(timer);
        if (data.error) reject(Error(data.error));
        else resolve(data);
      };
      worker.postMessage({
        module: sceneName,
        base:
          sceneName === 'example-pile'
            ? './assets/gallery-lod/'
            : './assets/' + sceneName + '/',
        nearModels: [],
        contactBake: true,
        contacts: true,
        fluidFrame: 0,
        maxStorageBytes: device.limits.maxStorageBufferBindingSize,
        meshletAttributes: false,
      });
    });
  } finally {
    worker.terminate();
  }
}
async function boot() {
  const adapter = await navigator.gpu?.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) throw Error('WebGPU adapter unavailable');
  if (adapter.limits.maxStorageBuffersPerShaderStage < 10)
    throw Error(
      'Diagnostic requires 10 storage bindings; default renderer is unaffected',
    );
  device = await adapter.requestDevice({
    requiredFeatures: adapter.features.has('timestamp-query')
      ? ['timestamp-query']
      : [],
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBuffersPerShaderStage: 10,
    },
  });
  state.adapter = {
    vendor: adapter.info.vendor,
    architecture: adapter.info.architecture,
    device: adapter.info.device,
  };
  device.addEventListener('uncapturederror', (e) => fail(e.error));
  device.lost.then((info) =>
    fail(Error('Device lost: ' + info.reason + ' ' + info.message)),
  );
  context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  scene = await loadScene();
  pose = structuredClone(
    scene.camera || { yaw: 0.62, pitch: 0.3, distance: 6.2, target: [0, 0, 0] },
  );
  const authoredLights = new Float32Array(scene.lighting);
  state.studioLighting = authoredLights[4] === 0 && authoredLights[6] === 0;
  state.analyticGround = authoredLights[4] < 0.5;
  if (!state.studioLighting && !isRaster() && state.mode !== 'beauty')
    throw Error('Authored-light scenes require a raster or beauty mode');
  for (const option of $('#mode').options)
    option.disabled =
      !state.studioLighting &&
      ![
        'raster',
        'reconstructed',
        'optical',
        'rasterReference',
        'beauty',
      ].includes(option.value);
  const grid = Number(params.get('grid') || 32);
  if (!Number.isInteger(grid) || grid < 1 || grid > 128)
    throw Error('Cache grid must be an integer from 1 to 128');
  state.cacheConfig = {
    slots,
    bytes: slots * (queued ? 56 : 52) + (queued ? 16 : 0),
    maxGrid: grid,
    cellSpacing: 0.025,
    refreshFraction: 0.25,
    scheduling: queued ? 'screen-local queue' : 'hash order',
  };
  state.geometry = {
    triangles: scene.triangles.byteLength / 48,
    instances: scene.instanceCount || 1,
    representedTriangles: scene.representedTriangles || scene.count,
    nearModels: scene.nearModels || [],
    meshletAttributes: false,
  };
  state.camera = pose;
  state.anchors = shareSurfaceAnchors(scene.triangles, scene.attributes);
  const tri = buffer(scene.triangles),
    nodes = buffer(scene.nodes),
    mats = buffer(scene.materials),
    portals = buffer(new Float32Array(scene.portals || 24)),
    attrs = buffer(scene.attributes),
    lights = buffer(scene.lighting);
  uniform = buffer(160, GPUBufferUsage.UNIFORM);
  controls = buffer(32, GPUBufferUsage.UNIFORM);
  sampleUniform = buffer(16, GPUBufferUsage.UNIFORM);
  owners = buffer(queued ? (slots * 2 + 4) * 4 : slots * 4);
  cells = buffer(slots * 48);
  result = buffer(W * H * 16);
  stats = buffer(64);
  const tex = (format, usage) =>
    device.createTexture({ size: [W, H], format, sampleCount: 4, usage });
  visibility = tex(
    'rgba16uint',
    GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  );
  visibilityHigh = tex(
    'rgba16uint',
    GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  );
  depth = tex('depth32float', GPUTextureUsage.RENDER_ATTACHMENT);
  const sampling = await text('./hybrid-sampling.wgsl');
  const rm = await module(
    (await text('./hybrid-visibility.wgsl')) + sampling,
    'hybrid visibility',
  );
  raster = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module: rm, entryPoint: 'vertex' },
    fragment: {
      module: rm,
      entryPoint: 'fragment',
      targets: [{ format: 'rgba16uint' }, { format: 'rgba16uint' }],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: {
      format: 'depth32float',
      depthWriteEnabled: true,
      depthCompare: 'greater',
    },
    multisample: { count: 4 },
  });
  const pm = await module(
    (await text('./hybrid-primary.wgsl')) + sampling,
    'sample-exact floor and environment visibility',
  );
  primaryRaster = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module: pm, entryPoint: 'vertex' },
    fragment: {
      module: pm,
      entryPoint: 'fragment',
      targets: [{ format: 'rgba16uint' }, { format: 'rgba16uint' }],
    },
    primitive: { topology: 'triangle-list' },
    depthStencil: {
      format: 'depth32float',
      depthWriteEnabled: true,
      depthCompare: 'always',
    },
    multisample: { count: 4 },
  });
  primaryGroup = bg(primaryRaster.getBindGroupLayout(0), [
    [0, uniform],
    [1, sampleUniform],
  ]);
  draws = rasterDraws(scene).map((d) => ({
    ...d,
    group: bg(raster.getBindGroupLayout(0), [
      [0, uniform],
      [1, tri],
      [2, nodes],
      [3, buffer(new Uint32Array(d.instances))],
      [
        4,
        buffer(
          new Uint32Array([d.first, d.count, d.root, 0]),
          GPUBufferUsage.UNIFORM,
        ),
      ],
      [5, sampleUniform],
    ]),
  }));
  if (scene.instanceRecordStart !== undefined) {
    const lm = await module(
      await text('./instance-lod.wgsl'),
      'hybrid shared instance LOD',
    );
    lod = await device.createComputePipelineAsync({
      layout: 'auto',
      compute: { module: lm, entryPoint: 'main' },
    });
    lodGroup = bg(lod.getBindGroupLayout(0), [
      [0, uniform],
      [1, nodes],
      [
        2,
        buffer(
          new Uint32Array([
            scene.instanceRecordStart,
            scene.instanceCount,
            0,
            0,
          ]),
          GPUBufferUsage.UNIFORM,
        ),
      ],
    ]);
  }
  let source = await text('./trace.wgsl');
  const instanced = scene.instanceRecordStart !== undefined;
  if (instanced)
    source = instancedShader(
      source,
      await text('./trace-instances.wgsl'),
      Math.min(64, Math.max(8, scene.maxDepth + 2)),
    );
  let lighting = await text('./hybrid-lighting.wgsl');
  lighting = lighting
    .replace('/*DATA_INSTANCE*/', instanced ? ',data.y' : '')
    .replace('/*KEY_INSTANCE*/', instanced ? ',key.y' : '')
    .replace('/*GROUND_INSTANCE*/', instanced ? ',0u' : '')
    .replace(
      '/*POINT_TRANSFORM*/',
      instanced
        ? 'let t=nodes[h.instance];return rotateInstance(normalize(t.high),local*dot(t.high,t.high))+t.low.xyz;'
        : 'return local;',
    )
    .replace(
      '/*SURFACE_SCALE*/',
      instanced ? 'dot(nodes[data.y].high,nodes[data.y].high)' : '1.',
    )
    .replace(
      '/*EPSILON*/',
      instanced ? 'max(nodes[0].low.w,1e-6)*.0001' : '.0001',
    );
  if (queued) lighting += '\n' + (await text('./hybrid-queue.wgsl'));
  const transport = incidentTransport(source);
  const beautyCache = experimentalBeauty
    ? (await text('./hybrid-beauty-cache.wgsl')).replace(
        '/*BEAUTY_INSTANCE*/',
        instanced ? 'h.instance' : '0u',
      )
    : '';
  const beautyTransport = experimentalBeauty
    ? beautyCacheTransport(transport).replace(
        '/*BEAUTY_STATS*/',
        params.has('countBeautyHits') ? 'atomicAdd(&statistics[10],1u);' : '',
      )
    : '';
  if (!experimentalBeauty)
    lighting = lighting
      .replaceAll('lab.mode==6u', 'false')
      .replaceAll('incidentAfterPrimary(', 'incident(');
  const lm = await module(
    transport +
      beautyTransport +
      lighting +
      (await text('./hybrid-beauty.wgsl')) +
      beautyCache,
    'hybrid lighting',
  );
  const layout0 = device.createBindGroupLayout({
    entries: [0, 1, 2, 3, 5, 6, 7].map((binding) => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: binding === 0 ? 'uniform' : 'read-only-storage' },
    })),
  });
  const layout1 = device.createBindGroupLayout({
    entries: [
      ...[0, 6].map((binding) => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: 'uint', multisampled: true },
      })),
      ...[1, 2, 3, 4, 5].map((binding) => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: binding === 4 ? 'uniform' : 'storage' },
      })),
    ],
  });
  const layout = device.createPipelineLayout({
    bindGroupLayouts: [layout0, layout1],
  });
  pipelines = {};
  for (const entryPoint of [
    'clearOwners',
    'clearStatistics',
    'request',
    'publish',
    'update',
    'resolve',
    'resolveReference',
    'resolveBeauty',
    ...(experimentalBeauty ? ['resolveHybridBeauty'] : []),
    'resolveFallback',
    ...(queued ? ['clearQueue', 'collectQueue', 'updateQueued'] : []),
  ])
    pipelines[entryPoint] = await device.createComputePipelineAsync({
      layout,
      compute: { module: lm, entryPoint },
    });
  groups = [
    bg(layout0, [
      [0, uniform],
      [1, tri],
      [2, nodes],
      [3, mats],
      [5, portals],
      [6, attrs],
      [7, lights],
    ]),
    bg(layout1, [
      [0, visibility.createView()],
      [1, owners],
      [2, cells],
      [3, result],
      [4, controls],
      [5, stats],
      [6, visibilityHigh.createView()],
    ]),
  ];
  state.opticalMap =
    params.get('opticalMap') === 'bilinear'
      ? 'bilinear-experimental'
      : 'legacy';
  const sources = await buildSignalShaders({
    load: text,
    transport,
    sampling,
    instanced,
    sceneName,
    experiment: params.get('experimental'),
    opticalMap: state.opticalMap,
    derivatives: params.get('derivatives'),
    connectionChance,
    queuedConnections,
    legacyReplay: params.get('replay') === 'legacy',
  });
  const sm = await module(sources.signals, 'raster primary separated signals');
  signalPipeline = await device.createComputePipelineAsync({
    layout,
    compute: { module: sm, entryPoint: 'resolveRasterSignals' },
  });
  if (params.get('experimental') === 'refracted-nee') {
    // Compile the control independently: the solver's register pressure must not
    // contaminate reference timing even when its runtime branch is not taken.
    const control = await module(
      sources.control,
      'independent transport control',
    );
    controlSignalPipeline = await device.createComputePipelineAsync({
      layout,
      compute: { module: control, entryPoint: 'resolveRasterSignals' },
    });
  }
  reconstructPipeline = await device.createComputePipelineAsync({
    layout,
    compute: { module: sm, entryPoint: 'reconstructSignals' },
  });
  opticalPipeline = await device.createComputePipelineAsync({
    layout,
    compute: { module: sm, entryPoint: 'buildOpticalGuides' },
  });
  signalBuffer = buffer(W * H * 64 * 2);
  guideBuffer = buffer(W * H * 64 * 2);
  opticalBuffer = buffer(W * H * 128 * 2);
  signalGroups = [
    groups[0],
    bg(layout1, [
      [0, visibility.createView()],
      [1, signalBuffer],
      [2, guideBuffer],
      [3, result],
      [4, controls],
      [5, opticalBuffer],
      [6, visibilityHigh.createView()],
    ]),
  ];
  if (queuedConnections) {
    const qm = await module(sources.queueTrace, 'connection queue tracing');
    const solveModule = await module(
      sources.queueSolve,
      'isolated connection solving',
    );
    connectionTrace = await device.createComputePipelineAsync({
      layout,
      compute: { module: qm, entryPoint: 'resolveRasterSignals' },
    });
    connectionClear = await device.createComputePipelineAsync({
      layout,
      compute: { module: qm, entryPoint: 'clearConnections' },
    });
    connectionResolve = await device.createComputePipelineAsync({
      layout,
      compute: { module: qm, entryPoint: 'resolveConnections' },
    });
    connectionSolve = await device.createComputePipelineAsync({
      layout,
      compute: { module: solveModule, entryPoint: 'solveConnections' },
    });
    const bounds = glassBounds(
      scene.triangles,
      scene.attributes,
      scene.materials,
    );
    connectionBuffer = buffer(16 + 512 + W * H * 4 + 131072 * 192);
    device.queue.writeBuffer(
      connectionBuffer,
      12,
      new Uint32Array([bounds.count]),
    );
    device.queue.writeBuffer(connectionBuffer, 16, bounds.data);
    connectionGroups = [
      groups[0],
      bg(layout1, [
        [0, visibility.createView()],
        [1, signalBuffer],
        [2, guideBuffer],
        [3, result],
        [4, controls],
        [5, connectionBuffer],
        [6, visibilityHigh.createView()],
      ]),
    ];
  }
  if (experimentalPaths) {
    const pcm = await module(sources.pathCache, 'branch-local path cache');
    pathPipeline = await device.createComputePipelineAsync({
      layout,
      compute: { module: pcm, entryPoint: 'resolveRasterSignals' },
    });
    pathUpdate = await device.createComputePipelineAsync({
      layout,
      compute: { module: pcm, entryPoint: 'updatePathCache' },
    });
    pathBuffer = buffer(16 + 65536 * 128);
    pathGroups = [
      groups[0],
      bg(layout1, [
        [0, visibility.createView()],
        [1, signalBuffer],
        [2, guideBuffer],
        [3, result],
        [4, controls],
        [5, pathBuffer],
        [6, visibilityHigh.createView()],
      ]),
    ];
  }
  const dm = await module(
    await text('./display.wgsl'),
    'hybrid shared display',
  );
  display = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module: dm, entryPoint: 'vertex' },
    fragment: { module: dm, entryPoint: 'fragment', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  displayGroup = bg(display.getBindGroupLayout(0), [
    [0, uniform],
    [1, result],
    [2, uniform],
  ]);
  if (device.features.has('timestamp-query')) {
    queries = device.createQuerySet({ type: 'timestamp', count: 16 });
    queryBuffer = buffer(128, GPUBufferUsage.QUERY_RESOLVE);
    readback = device.createBuffer({
      size: 128,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }
  metadata = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  // Keep the resident GPU scene, not the duplicate CPU bulk arrays.
  for (const key of [
    'triangles',
    'nodes',
    'materials',
    'attributes',
    'lighting',
  ])
    delete scene[key];
  state.ready = true;
  state.paused = true;
  $('#pause').textContent = params.has('paused') ? 'Resume' : 'Pause';
  await render();
  if (!params.has('paused')) {
    state.paused = false;
    schedule();
  }
}
function writeUniforms() {
  const signature = JSON.stringify(pose);
  if (signature !== lastReferenceCamera) {
    referenceFrame = 0;
    lastReferenceCamera = signature;
  }
  // Temporal reconstruction needs new stochastic samples during motion. Camera
  // changes reset reference accumulation, not this independent sample sequence.
  renderedPhase = currentMode().history ? reconstructionFrame : referenceFrame;
  const camera = cameraBasis(pose, scene.camera?.fov),
    raw = new ArrayBuffer(160),
    f = new Float32Array(raw),
    i = new Uint32Array(raw);
  i.set([W, H, state.frame, scene.recommendedBounces || 6]);
  f.set([...camera.eye, scene.floor || 0], 4);
  f.set([...camera.right, 1], 8);
  f.set([...camera.up, 1], 12);
  f.set([...camera.forward, camera.tan], 16);
  const previous = previousRender?.camera || camera;
  f.set([...previous.eye, 0], 20);
  f.set([...previous.right, scene.exposure || 1], 24);
  f.set([...previous.up, 1], 28);
  f.set([...previous.forward, previous.tan], 32);
  f.set(
    [
      previousRender?.mode === state.mode &&
      previousRender?.epoch === state.epoch
        ? 1
        : 0,
      previousRender?.signature === signature ? 0 : 1,
      0,
      0,
    ],
    36,
  );
  device.queue.writeBuffer(uniform, 0, raw);
  device.queue.writeBuffer(
    controls,
    0,
    new Uint32Array([
      currentMode().id,
      state.epoch,
      isRaster() ? signalView : Number(params.get('grid') || 32),
      renderedPhase,
    ]),
  );
  const sampling = new Float32Array([
    isRaster() ? renderedPhase : -1,
    previousRender?.phase || 0,
    state.analyticGround ? 1 : 0,
    0,
  ]);
  device.queue.writeBuffer(controls, 16, sampling);
  device.queue.writeBuffer(sampleUniform, 0, sampling);
}
function stamps(a, b) {
  return queries
    ? {
        querySet: queries,
        beginningOfPassWriteIndex: a,
        endOfPassWriteIndex: b,
      }
    : undefined;
}
async function render() {
  if (busy || !state.ready) return;
  busy = true;
  try {
    writeUniforms();
    const encoder = device.createCommandEncoder();
    const mode = currentMode();
    const useConnections = queuedConnections && isRaster() && !mode.oracle;
    if (state.mode === 'pathCache') {
      if (pathEpoch !== state.epoch) {
        encoder.clearBuffer(pathBuffer);
        pathEpoch = state.epoch;
      } else encoder.clearBuffer(pathBuffer, 0, 16);
    }
    const lodPass = encoder.beginComputePass({
      timestampWrites: stamps(12, 13),
    });
    if (lod) {
      lodPass.setPipeline(lod);
      lodPass.setBindGroup(0, lodGroup);
      lodPass.dispatchWorkgroups(Math.ceil(scene.instanceCount / 128));
    }
    lodPass.end();
    const rp = encoder.beginRenderPass({
      colorAttachments: [visibility, visibilityHigh].map((t) => ({
        view: t.createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      })),
      depthStencilAttachment: {
        view: depth.createView(),
        depthClearValue: 0,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
      timestampWrites: stamps(0, 1),
    });
    if (isRaster()) {
      rp.setPipeline(primaryRaster);
      rp.setBindGroup(0, primaryGroup);
      rp.draw(3);
    }
    rp.setPipeline(raster);
    for (const d of draws) {
      rp.setBindGroup(0, d.group);
      rp.draw(d.count * 3, d.instances.length);
    }
    rp.end();
    const cp = encoder.beginComputePass({ timestampWrites: stamps(2, 3) });
    groups.forEach((g, i) => cp.setBindGroup(i, g));
    cp.setPipeline(pipelines.clearStatistics);
    cp.dispatchWorkgroups(1);
    const cacheMode = !!mode.cache;
    const signature = JSON.stringify([pose, state.epoch]);
    // Ownership depends on visibility and cache epoch, not the lighting sample.
    // Rebuild on every camera change; never reuse screen ownership across motion.
    const rebuild =
      cacheMode &&
      (params.get('reuseOwners') === '0' ||
        signature !== ownerSignature ||
        state.counts[0] > 0 ||
        state.counts[4] > 0);
    if (rebuild) {
      // Missing or immature beauty anchors fall back to the complete integrator.
      // A single publication round bounds per-frame maintenance; later frames
      // resolve contested allocations without inventing lighting at missing cells.
      const rounds = state.mode === 'hybrid' ? 1 : 4;
      for (let round = 0; round < rounds; round++) {
        cp.setPipeline(pipelines.clearOwners);
        cp.dispatchWorkgroups(slots / 128);
        cp.setPipeline(pipelines.request);
        cp.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
        cp.setPipeline(pipelines.publish);
        cp.dispatchWorkgroups(slots / 64);
      }
      cp.setPipeline(pipelines.clearOwners);
      cp.dispatchWorkgroups(slots / 128);
      cp.setPipeline(pipelines.request);
      cp.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
    }
    cp.end();
    if (cacheMode) ownerSignature = signature;
    state.ownershipRebuilt = rebuild;
    const collect = encoder.beginComputePass({ timestampWrites: stamps(8, 9) });
    groups.forEach((g, i) => collect.setBindGroup(i, g));
    if (queued && cacheMode) {
      collect.setPipeline(pipelines.clearQueue);
      collect.dispatchWorkgroups(1);
      collect.setPipeline(pipelines.collectQueue);
      collect.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
    }
    if (useConnections) {
      connectionGroups.forEach((g, i) => collect.setBindGroup(i, g));
      collect.setPipeline(connectionClear);
      collect.dispatchWorkgroups(Math.ceil((W * H) / 64));
    }
    collect.end();
    const update = encoder.beginComputePass({
      timestampWrites: stamps(10, 11),
    });
    groups.forEach((g, i) => update.setBindGroup(i, g));
    if (cacheMode) {
      update.setPipeline(pipelines[queued ? 'updateQueued' : 'update']);
      update.dispatchWorkgroups(slots / 64);
    }
    update.end();
    const resolve = encoder.beginComputePass({ timestampWrites: stamps(4, 5) });
    let resolveGroups = groups,
      resolvePipeline = pipelines[mode.resolve];
    if (useConnections) {
      resolveGroups = connectionGroups;
      resolvePipeline = connectionTrace;
    } else if (state.mode === 'pathCache') {
      resolveGroups = pathGroups;
      resolvePipeline = pathPipeline;
    } else if (isRaster()) {
      resolveGroups = signalGroups;
      resolvePipeline =
        mode.oracle && controlSignalPipeline
          ? controlSignalPipeline
          : signalPipeline;
    }
    resolveGroups.forEach((g, i) => resolve.setBindGroup(i, g));
    resolve.setPipeline(resolvePipeline);
    resolve.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
    if (state.mode === 'cache') {
      resolve.setPipeline(pipelines.resolveFallback);
      resolve.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
    }
    resolve.end();
    const reconstruction = encoder.beginComputePass({
      timestampWrites: stamps(14, 15),
    });
    if (useConnections) {
      connectionGroups.forEach((g, i) => reconstruction.setBindGroup(i, g));
      reconstruction.setPipeline(connectionSolve);
      reconstruction.dispatchWorkgroups(131072 / 64);
      reconstruction.setPipeline(connectionResolve);
      reconstruction.dispatchWorkgroups(Math.ceil((W * H) / 64));
    }
    if (mode.optical) {
      reconstruction.setPipeline(opticalPipeline);
      signalGroups.forEach((g, i) => reconstruction.setBindGroup(i, g));
      reconstruction.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
    }
    if (mode.history) {
      reconstruction.setPipeline(reconstructPipeline);
      signalGroups.forEach((g, i) => reconstruction.setBindGroup(i, g));
      reconstruction.dispatchWorkgroups(Math.ceil(W / 8), Math.ceil(H / 8));
    }
    if (state.mode === 'pathCache') {
      pathGroups.forEach((g, i) => reconstruction.setBindGroup(i, g));
      reconstruction.setPipeline(pathUpdate);
      reconstruction.dispatchWorkgroups(128);
    }
    reconstruction.end();
    const dp = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      timestampWrites: stamps(6, 7),
    });
    dp.setPipeline(display);
    dp.setBindGroup(0, displayGroup);
    dp.draw(3);
    dp.end();
    if (queries) {
      encoder.resolveQuerySet(queries, 0, 16, queryBuffer, 0);
      encoder.copyBufferToBuffer(queryBuffer, 0, readback, 0, 128);
    }
    encoder.copyBufferToBuffer(stats, 0, metadata, 0, 64);
    if (state.mode === 'pathCache')
      encoder.copyBufferToBuffer(pathBuffer, 0, metadata, 0, 16);
    if (useConnections)
      encoder.copyBufferToBuffer(connectionBuffer, 0, metadata, 0, 16);
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    if (queries) {
      await readback.mapAsync(GPUMapMode.READ);
      const q = new BigUint64Array(readback.getMappedRange());
      const times = Array.from(
        { length: 8 },
        (_, i) => Number(q[i * 2 + 1] - q[i * 2]) / 1e6,
      );
      readback.unmap();
      state.gpuMs = {
        visibility: times[0],
        cacheMaintenance: times[1],
        queueCollection: times[4],
        cacheTracing: times[5],
        lod: times[6],
        cache: times[1] + times[4] + times[5],
        resolve: times[2],
        display: times[3],
        reconstruction: times[7],
        total: times.reduce((a, b) => a + b, 0),
      };
      state.timings.push(state.gpuMs);
      if (state.timings.length > 256) state.timings.shift();
    }
    await metadata.mapAsync(GPUMapMode.READ);
    const counts = Array.from(new Uint32Array(metadata.getMappedRange()));
    metadata.unmap();
    state.counts = counts;
    if (useConnections && counts[1] !== 0) {
      referenceFrame = 0;
      reconstructionFrame = 0;
      previousRender = null;
      state.referenceSamples = 0;
      throw Error(
        'Connection queue overflow: invalid sample; accumulation reset. No fallback accepted.',
      );
    }
    state.frame++;
    if (mode.accumulate) referenceFrame++;
    reconstructionFrame++;
    state.referenceSamples = referenceFrame * 4;
    state.camera = structuredClone(pose);
    state.scope = mode.scope;
    previousRender = {
      camera: cameraBasis(pose, scene.camera?.fov),
      mode: state.mode,
      epoch: state.epoch,
      signature: JSON.stringify(pose),
      phase: renderedPhase,
    };
    status.textContent = JSON.stringify(
      {
        scene: state.scene,
        mode: state.mode,
        frame: state.frame,
        gpuMs: state.gpuMs,
        activeCells: counts[1],
        newOrEvictedCells: counts[0],
        paths: counts[2],
        missFraction: counts[3] ? counts[4] / counts[3] : 0,
        referenceSamples: state.referenceSamples,
        cache: state.cacheConfig,
        geometry: state.geometry,
        errors: state.errors,
      },
      null,
      2,
    );
  } catch (e) {
    fail(e);
  } finally {
    busy = false;
  }
}
function schedule() {
  cancelAnimationFrame(raf);
  if (!state.paused)
    raf = requestAnimationFrame(async () => {
      await render();
      schedule();
    });
}
async function pause() {
  state.paused = true;
  $('#pause').textContent = 'Resume';
  cancelAnimationFrame(raf);
  while (busy) await new Promise((r) => setTimeout(r, 10));
}
function invalidate() {
  state.epoch++;
  referenceFrame = 0;
}
async function setMode(mode) {
  if (!Object.hasOwn(modes, mode)) throw Error('Unknown hybrid mode');
  await pause();
  if ((mode === 'hybrid') !== (state.mode === 'hybrid')) invalidate();
  state.mode = mode;
  $('#mode').value = mode;
  referenceFrame = 0;
  reconstructionFrame = 0;
  previousRender = null;
}
window.cybrHybrid = {
  snapshot: () => structuredClone(state),
  pause,
  resume: () => {
    state.paused = false;
    schedule();
  },
  setMode,
  invalidate,
  captureConnections: async () => {
    await pause();
    if (!connectionBuffer) throw Error('Connection experiment is not enabled');
    return readBuffer(device, connectionBuffer);
  },
  setSignal: async (view) => {
    if (!Number.isInteger(view) || view < 0 || view > 4)
      throw Error('Invalid signal view');
    await pause();
    signalView = view;
  },
  captureSignals: async () => {
    await pause();
    return readFloatBuffer(device, signalBuffer, {
      offset: ((state.frame - 1) & 1) * W * H * 64,
      size: W * H * 64,
    });
  },
  setCamera: async (value) => {
    await pause();
    pose = { ...pose, ...value };
    referenceFrame = 0;
  },
  steps: async (count = 1) => {
    await pause();
    if (!state.ready) throw Error('Renderer is not ready; no steps rendered');
    if (state.errors.length) throw Error(state.errors.at(-1));
    if (!Number.isInteger(count) || count < 1 || count > 2048)
      throw Error('Step count outside [1,2048]');
    for (let i = 0; i < count; i++) {
      const frame = state.frame;
      await render();
      if (state.errors.length) throw Error(state.errors.at(-1));
      if (state.frame !== frame + 1)
        throw Error('Requested step did not render exactly one frame');
    }
    return structuredClone(state);
  },
  capture: async () => {
    await pause();
    return readFloatBuffer(device, result);
  },
};
$('#scene').onchange = () => {
  const url = new URL(location.href);
  url.searchParams.set('scene', $('#scene').value);
  if ($('#scene').value.startsWith('proof-'))
    url.searchParams.set('mode', 'raster');
  if (
    $('#scene').value !== 'proof-optics' &&
    url.searchParams.get('experimental') === 'refracted-nee'
  ) {
    for (const key of [
      'experimental',
      'derivatives',
      'work',
      'connectionChance',
      'replay',
    ])
      url.searchParams.delete(key);
  }
  location.href = url;
};
$('#mode').onchange = async () => {
  await setMode($('#mode').value);
  state.paused = false;
  $('#pause').textContent = 'Pause';
  schedule();
};
$('#signal').onchange = async () => {
  await window.cybrHybrid.setSignal(Number($('#signal').value));
  await render();
};
$('#reset').onclick = () => {
  invalidate();
  if (state.paused) render();
};
$('#pause').onclick = async () => {
  if (state.paused) {
    state.paused = false;
    schedule();
    $('#pause').textContent = 'Pause';
  } else {
    await pause();
    $('#pause').textContent = 'Resume';
  }
};
let drag = null;
canvas.oncontextmenu = (e) => e.preventDefault();
canvas.onpointerdown = (e) => {
  drag = { x: e.clientX, y: e.clientY, button: e.button };
  canvas.setPointerCapture(e.pointerId);
};
canvas.onpointerup = () => (drag = null);
canvas.onpointermove = (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x,
    dy = e.clientY - drag.y;
  drag.x = e.clientX;
  drag.y = e.clientY;
  if (drag.button === 2) {
    const b = cameraBasis(pose, scene.camera?.fov),
      scale = pose.distance * 0.002;
    pose.target = (pose.target || [0, 0, 0]).map(
      (v, i) => v + (-b.right[i] * dx + b.up[i] * dy) * scale,
    );
  } else {
    pose.yaw -= dx * 0.005;
    pose.pitch = Math.max(-1.5, Math.min(1.5, pose.pitch + dy * 0.005));
  }
  referenceFrame = 0;
  if (state.paused) render();
};
canvas.onwheel = (e) => {
  e.preventDefault();
  pose.distance = Math.max(
    0.0001,
    Math.min(1000, pose.distance * Math.exp(e.deltaY * 0.001)),
  );
  referenceFrame = 0;
  if (state.paused) render();
};
boot().catch(fail);
