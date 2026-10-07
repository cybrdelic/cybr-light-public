const $ = (s) => document.querySelector(s),
  canvas = $("#viewport"),
  status = $("#status");
const sceneChoices = [
  ["all", "All six / exploded assembly"],
  ["geo", "GEO / terrain mechanism"],
  ["light", "LIGHT / optical lens"],
  ["elements", "ELEMENTS / vessel + FLIP"],
  ["song", "SONG / cymbals"],
  ["combat", "COMBAT / avatar frame"],
  ["scenes", "SCENES / desert hot springs"],
  ["flip", "FLIP / water surface only"],
];
sceneChoices.push(
  ["example-materials", "LIGHT example / material gallery"],
  ["example-knot", "LIGHT example / copper knot"],
  ["example-geo-flange", "GEO example / CAD flange"],
  ["example-observatory", "SCENES example / Observatory source interior"],
);
sceneChoices.push(
  ["example-materials-source", "LIGHT / material gallery · source lighting"],
  ["example-knot-source", "LIGHT / copper knot · source lighting"],
);
sceneChoices.unshift(
  ["example-geo-printer", "GEO / FUSE C220 3D printer"],
  ["example-geo-wrist", "GEO / Orbit inspection wrist"],
);
$("#scene").replaceChildren(
  ...sceneChoices.map(([value, label]) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    return o;
  }),
);
const catalogPanel = document.createElement("details");
catalogPanel.innerHTML = "<summary>Source import catalog</summary><div></div>";
$("#scene").parentElement.after(catalogPanel);
async function refreshCatalog() {
  try {
    const sources = await Promise.all(
      ["catalog.json", "environment-catalog.json"].map(async (path) => {
        const r = await fetch(path, { cache: "no-store" });
        return r.ok ? (await r.json()).entries : [];
      }),
    );
    const rows = sources.flat(),
      content = catalogPanel.querySelector("div");
    content.replaceChildren();
    for (const row of rows) {
      if (
        row.status === "exported" &&
        !sceneChoices.some(([id]) => id === row.id)
      ) {
        sceneChoices.push([row.id, row.label]);
        const o = document.createElement("option");
        o.value = row.id;
        o.textContent = row.label;
        $("#scene").append(o);
      }
      const p = document.createElement("p");
      p.textContent =
        row.label +
        " — " +
        (row.status === "exported"
          ? "imported / visual approval pending"
          : row.status) +
        (row.error ? " · " + row.error : "");
      content.append(p);
    }
    catalogPanel.querySelector("summary").textContent =
      `Source import catalog · ${rows.filter((r) => r.status === "exported").length}/${rows.length} exported`;
  } catch (error) {
    catalogPanel.querySelector("div").textContent =
      "Catalog unavailable: " + error.message;
  }
}
await refreshCatalog();
setInterval(refreshCatalog, 30000);
const fluidControls = document.createElement("div");
fluidControls.id = "fluid-controls";
fluidControls.innerHTML =
  '<label for="fluid-frame">Cached FLIP frame <output id="fluid-number">0 / 71</output></label><input id="fluid-frame" type="range" min="0" max="71" value="0" step="1"><p>Recorded simulation mesh. Changing frames rebuilds the BVH; this is frame inspection, not live simulation playback.</p>';
$("#scene").parentElement.after(fluidControls);
const sceneActions = document.createElement("div");
sceneActions.className = "scene-actions";
sceneActions.innerHTML =
  '<button id="show-all">Six modules</button><button id="fit-view">Fit view</button>';
$("#scene").parentElement.before(sceneActions);
const gpuWarning = document.createElement("p");
gpuWarning.id = "gpu-warning";
gpuWarning.className = "note";
$("#metrics").after(gpuWarning);
const provenance = document.createElement("p");
provenance.className = "note";
$("#scene").parentElement.after(provenance);
const parameters = new URLSearchParams(location.search);
if (!parameters.has("glass")) parameters.set("glass", "split");
if (!parameters.has("motion")) parameters.set("motion", "bilinear");
// Keep the transport disclaimer accurate when loading an older cached shell.
document.querySelector("aside > p.note:last-child").textContent =
  "EXPERIMENTAL — separated lighting reconstruction. Not quality-approved: moving GI remains mottled and GPU cost is higher. RGB transport; no spectral dispersion or live FLIP. Default viewer remains unchanged.";
for (const id of ["scene", "resolution", "bounces", "mode"]) {
  const value = parameters.get(id);
  if (value && [...$("#" + id).options].some((o) => o.value === value))
    $("#" + id).value = value;
}
let sampleLimit = Math.max(0, Number(parameters.get("samples")) || 0);
$("#fluid-frame").value = String(
  Math.max(0, Math.min(71, Number(parameters.get("fluidFrame")) || 0)),
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
  scene: "combat",
  generation: 0,
};
let device,
  context,
  format,
  pipelines,
  sceneBuffers = [],
  frameBuffers = [],
  worker,
  querySet,
  queryResolve,
  queryRead,
  queryBusy = false;
let reconstructionPipelines, filterPipelines;
let uniform,
  traceGroup,
  reconstructionGroups,
  filterGroups,
  displayGroups,
  samples,
  histories,
  colors,
  configs,
  modulation,
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
if ($("#scene").value === "all") {
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
    eye,
    right,
    up,
    forward,
    tan: sceneInfo?.camera?.fov
      ? Math.tan((sceneInfo.camera.fov * Math.PI) / 360)
      : Math.tan(Math.PI / 7),
  };
}
function fail(error) {
  const message = error.message || String(error);
  state.errors.push(message);
  status.textContent = message;
  state.paused = true;
  state.pauseReason = "error";
  $("#scene").disabled = false;
  $("#fluid-frame").disabled = false;
  $("#show-all").disabled = false;
}
function buffer(data, usage = GPUBufferUsage.STORAGE) {
  const size = typeof data === "number" ? data : data.byteLength;
  const b = device.createBuffer({
    size: Math.max(16, Math.ceil(size / 4) * 4),
    usage: usage | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  if (typeof data !== "number") device.queue.writeBuffer(b, 0, data);
  return b;
}
function group(p, resources) {
  return device.createBindGroup({
    layout: p.getBindGroupLayout(0),
    entries: resources.map((b, binding) => ({
      binding,
      resource: { buffer: b },
    })),
  });
}
async function shader(name) {
  const text = await fetch("experimental-signals/" + name + ".wgsl", {
    cache: "no-store",
  }).then((r) => {
    if (!r.ok) throw Error("Missing " + name);
    return r.text();
  });
  const shared =
    name === "display"
      ? ""
      : await fetch("experimental-signals/signals.wgsl", {
          cache: "no-store",
        }).then((r) => {
          if (!r.ok) throw Error("Missing signal ABI");
          return r.text();
        });
  const module = device.createShaderModule({
    label: name,
    code: shared + "\n" + text,
  });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === "error");
  if (errors.length)
    throw Error(
      name + ": " + errors.map((m) => `${m.lineNum}: ${m.message}`).join("\n"),
    );
  return module;
}
async function boot() {
  const {probeGpuSession}=await import('./gpu-session.mjs');
  const session=await probeGpuSession(canvas);
  const {adapter}=session;
  const features = adapter.features.has("timestamp-query")
    ? ["timestamp-query"]
    : [];
  const storageLimit = Math.min(
      adapter.limits.maxStorageBufferBindingSize,
      512 * 1024 * 1024,
    ),
    bufferLimit = Math.min(adapter.limits.maxBufferSize, 512 * 1024 * 1024);
  device = await adapter.requestDevice({
    requiredFeatures: features,
    requiredLimits: {
      maxStorageBufferBindingSize: storageLimit,
      maxBufferSize: bufferLimit,
    },
  });
  device.addEventListener("uncapturederror", (e) => fail(e.error));
  device.lost.then((info) =>
    fail("GPU device lost: " + info.message + ". Reload to recover."),
  );
  $("#adapter").textContent =
    [adapter.info?.vendor, adapter.info?.architecture, adapter.info?.device]
      .filter(Boolean)
      .join(" / ") || "WebGPU adapter";
  if (adapter.info?.vendor === "intel")
    $("#gpu-warning").textContent =
      "Intel adapter selected. On dual-GPU systems, check the browser’s graphics preference: this page cannot force the dedicated GPU.";
  context = session.context;
  format = session.format;
  context.configure({ device, format, alphaMode: "opaque" });
  const mods = await Promise.all(
    ["trace", "reconstruct", "filter", "display"].map(shader),
  );
  pipelines = await Promise.all(
    mods
      .slice(0, 3)
      .map((module) =>
        device.createComputePipelineAsync({
          layout: "auto",
          compute: { module, entryPoint: "main" },
        }),
      ),
  );
  reconstructionPipelines = await Promise.all(
    [0, 1, 2].map((CHANNEL) =>
      device.createComputePipelineAsync({
        layout: "auto",
        compute: {
          module: mods[1],
          entryPoint: "main",
          constants: { CHANNEL },
        },
      }),
    ),
  );
  filterPipelines = await Promise.all(
    [0, 1, 2].map((CHANNEL) =>
      device.createComputePipelineAsync({
        layout: "auto",
        compute: {
          module: mods[2],
          entryPoint: "main",
          constants: { CHANNEL },
        },
      }),
    ),
  );
  pipelines.push(
    await device.createRenderPipelineAsync({
      layout: "auto",
      vertex: { module: mods[3], entryPoint: "vertex" },
      fragment: {
        module: mods[3],
        entryPoint: "fragment",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-list" },
    }),
  );
  if (features.length) {
    querySet = device.createQuerySet({ type: "timestamp", count: 4 });
    queryResolve = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    queryRead = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }
  await loadScene();
  requestAnimationFrame(loop);
}
async function loadScene() {
  const generation = ++state.generation;
  state.ready = false;
  status.textContent = "Loading mesh / building resident BVH…";
  $("#scene").disabled = true;
  $("#fluid-frame").disabled = true;
  $("#show-all").disabled = true;
  fluidControls.hidden = !["all", "elements", "flip"].includes(
    $("#scene").value,
  );
  $("#fluid-number").textContent = $("#fluid-frame").value + " / 71";
  worker?.terminate();
  await device.queue.onSubmittedWorkDone();
  sceneBuffers.forEach((b) => b.destroy());
  sceneBuffers = [];
  const selected = $("#scene").value;
  provenance.textContent = selected.startsWith("example-")
    ? "Source example geometry / approximate RGB materials / browser studio lighting."
    : "";
  worker = new Worker("./bvh-worker.js", { type: "module" });
  const result = await new Promise((resolve, reject) => {
    worker.onmessage = (e) =>
      e.data.error ? reject(Error(e.data.error)) : resolve(e.data);
    worker.onerror = (e) => reject(Error(e.message));
    worker.postMessage({
      base: new URL(
        selected.startsWith("example-")
          ? "./assets/" + selected + "/"
          : "./assets/instrument-cartridges-c/",
        location.href,
      ).href,
      module: selected,
      fluidFrame: Number($("#fluid-frame").value),
      maxStorageBytes: device.limits.maxStorageBufferBindingSize,
    });
  });
  provenance.textContent = result.notes || "";
  if (generation !== state.generation) return;
  worker.terminate();
  worker = null;
  sceneInfo = result;
  floor = result.floor;
  state.scene = $("#scene").value;
  const pose =
    result.camera ||
    (state.scene === "all"
      ? { yaw: 0.1, pitch: 0.35, distance: 4.2 }
      : { yaw: 0.62, pitch: 0.3, distance: 6.2 });
  yaw = pose.yaw;
  pitch = pose.pitch;
  distance = pose.distance;
  for (const data of [result.triangles, result.nodes, result.materials]) {
    if (data.byteLength > device.limits.maxStorageBufferBindingSize)
      throw Error("Mesh exceeds adapter storage limit");
    sceneBuffers.push(buffer(data));
  }
  sceneBuffers.push(buffer(new Float32Array(result.portals || 24)));
  sceneBuffers.push(buffer(result.attributes));
  sceneBuffers.push(buffer(result.lighting));
  await resize();
  state.ready = true;
  setPaused(false);
  status.textContent = "";
  $("#scene").disabled = false;
  $("#fluid-frame").disabled = false;
  $("#show-all").disabled = false;
  const url = new URL(location.href);
  url.searchParams.set("scene", state.scene);
  url.searchParams.set("fluidFrame", $("#fluid-frame").value);
  history.replaceState(null, "", url);
}
async function resize() {
  state.ready = false;
  await device.queue.onSubmittedWorkDone();
  frameBuffers.forEach((b) => b.destroy());
  frameBuffers = [];
  const h = Number($("#resolution").value),
    w = Math.round((h * 16) / 9);
  canvas.width = w;
  canvas.height = h;
  uniform = buffer(176, GPUBufferUsage.UNIFORM);
  samples = buffer(w * h * 160);
  histories = [buffer(w * h * 160), buffer(w * h * 160)];
  colors = [buffer(w * h * 48), buffer(w * h * 48)];
  modulation = buffer(w * h * 16);
  configs = [1, 2, 4].map((step) =>
    buffer(
      new Uint32Array([
        w,
        h,
        step,
        parameters.get("history") === "legacy" ? 0 : 1,
      ]),
      GPUBufferUsage.UNIFORM,
    ),
  );
  frameBuffers.push(
    uniform,
    samples,
    modulation,
    ...histories,
    ...colors,
    ...configs,
  );
  traceGroup = group(pipelines[0], [
    uniform,
    ...sceneBuffers.slice(0, 3),
    samples,
    sceneBuffers[3],
    sceneBuffers[4],
    sceneBuffers[5],
    modulation,
  ]);
  reconstructionGroups = [0, 1].map((i) =>
    reconstructionPipelines.map((p) =>
      group(p, [uniform, samples, histories[1 - i], histories[i], colors[0]]),
    ),
  );
  filterGroups = [0, 1].map((i) =>
    configs.map((config, j) =>
      filterPipelines.map((p) =>
        group(p, [config, histories[i], colors[j % 2], colors[1 - (j % 2)]]),
      ),
    ),
  );
  displayGroups = colors.map((b) =>
    group(pipelines[3], [configs[0], b, uniform, modulation]),
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
}
function dispatch(encoder, pipeline, bindings, timestampWrites) {
  const pass = encoder.beginComputePass(
    timestampWrites ? { timestampWrites } : {},
  );
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindings);
  pass.dispatchWorkgroups(
    Math.ceil(canvas.width / 8),
    Math.ceil(canvas.height / 8),
  );
  pass.end();
}
function render() {
  const cam = camera(),
    prev = previousCamera || cam;
  const moving =
    !!previousCamera &&
    cam.eye.some((v, i) => Math.abs(v - prev.eye[i]) > 1e-6);
  const reference = $("#mode").value === "reference";
  if (moving && reference) state.frame = 0;
  state.settled = moving ? 0 : state.settled + 1;
  state.converged = false;
  const bytes = new ArrayBuffer(176),
    f = new Float32Array(bytes),
    ints = new Uint32Array(bytes);
  ints.set([
    canvas.width,
    canvas.height,
    state.frame,
    Number($("#bounces").value),
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
    new URLSearchParams(location.search).get("portals") === "1"
      ? 1
      : 0;
  f[39] = parameters.get("history") === "legacy" ? 0 : 1;
  if (parameters.get("motion") === "bilinear" && f[39] > 0) f[39] += 2;
  f[11] = parameters.get("sampler") === "legacy" ? 0 : 1;
  // Environment importance sampling remains opt-in until equal-time image gates.
  f[15] = parameters.get("environmentSampling") === "1" ? 1 : 0;
  f[23] = parameters.get("primary") === "shared" ? 1 : 0;
  f[27] = sceneInfo?.exposure ?? 1;
  f[31] = parameters.get("glass") === "split" ? 1 : 0;
  f[40] = parameters.get("signals") === "separate" ? 1 : 0;
  f[41] = parameters.get("splitExit") === "1" ? 1 : 0;
  device.queue.writeBuffer(uniform, 0, bytes);
  const encoder = device.createCommandEncoder();
  const timed = !!querySet && !queryBusy;
  dispatch(
    encoder,
    pipelines[0],
    traceGroup,
    timed
      ? { querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 }
      : undefined,
  );
  const parity = state.frame % 2;
  for (let c = 0; c < 3; c++)
    dispatch(
      encoder,
      reconstructionPipelines[c],
      reconstructionGroups[parity][c],
    );
  if (!reference && $("#denoise").checked) {
    for (const groups of filterGroups[parity])
      for (let c = 0; c < 3; c++)
        dispatch(encoder, filterPipelines[c], groups[c]);
  }
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
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      },
    ],
  });
  pass.setPipeline(pipelines[3]);
  pass.setBindGroup(
    0,
    displayGroups[!reference && $("#denoise").checked ? configs.length % 2 : 0],
  );
  pass.draw(3);
  pass.end();
  if (timed) {
    encoder.resolveQuerySet(querySet, 0, 4, queryResolve, 0);
    encoder.copyBufferToBuffer(queryResolve, 0, queryRead, 0, 32);
    queryBusy = true;
  }
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
    setPaused(true, "sample-limit");
    status.textContent =
      "Verification capture complete. Drag or zoom to continue rendering.";
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
  const cap = $("#mode").value === "reference" ? 2048 : 512;
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
    adapter: $("#adapter").textContent,
    camera: { yaw, pitch, distance },
    ready: state.ready,
    scene: state.scene,
    frames: state.frame,
    paused: state.paused,
    errors: [...state.errors],
    resolution: [canvas.width, canvas.height],
    presentFPS: state.timings.length ? 1000 / average(state.timings) : 0,
    frameMsP95: times[Math.floor(times.length * 0.95)] || 0,
    traceGpuMs: average(state.gpuTimes),
    gpuFrameMs: average(state.gpuFrameTimes),
    gpuTiming: !!querySet,
    triangles: sceneInfo?.count,
    bvhNodes: sceneInfo?.nodeCount,
    maxBvhDepth: sceneInfo?.maxDepth,
    mode: $("#mode").value,
    bounces: Number($("#bounces").value),
    denoise: $("#denoise").checked,
    bytesResident: sceneBuffers
      .concat(frameBuffers)
      .reduce((n, b) => n + b.size, 0),
  };
}
function metrics() {
  const s = snapshot();
  $("#metrics").innerHTML = [
    ["Submitted FPS", s.presentFPS.toFixed(1)],
    ["Frame p95", s.frameMsP95.toFixed(1) + " ms"],
    [
      "GPU trace",
      s.gpuTiming ? s.traceGpuMs.toFixed(2) + " ms" : "Unavailable",
    ],
    [
      "GPU full frame",
      s.gpuTiming ? s.gpuFrameMs.toFixed(2) + " ms" : "Unavailable",
    ],
    ["Samples submitted", s.frames],
    ["Triangles", s.triangles.toLocaleString()],
    ["GPU buffers", (s.bytesResident / 1048576).toFixed(0) + " MiB"],
  ]
    .map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`)
    .join("");
}
function setPaused(value, reason = "manual") {
  state.paused = value;
  state.pauseReason = value ? reason : null;
  $("#pause").textContent = value ? "Resume" : "Pause";
}
function interact() {
  if (sampleLimit) {
    sampleLimit = 0;
    const url = new URL(location.href);
    url.searchParams.delete("samples");
    history.replaceState(null, "", url);
  }
  if (state.pauseReason === "sample-limit") {
    status.textContent = "";
    setPaused(false);
  }
}
async function inspectOutput(stage = "output") {
  const index =
    $("#mode").value !== "reference" && $("#denoise").checked
      ? configs.length % 2
      : 0;
  const source =
      stage === "samples"
        ? samples
        : stage === "history"
          ? histories[(state.frame + 1) % 2]
          : stage === "temporal"
            ? colors[0]
            : colors[index],
    stride = stage === "samples" || stage === "history" ? 40 : 4;
  const read = device.createBuffer({
    size: source.size,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(source, 0, read, 0, source.size);
  device.queue.submit([encoder.finish()]);
  await read.mapAsync(GPUMapMode.READ);
  const data = new Float32Array(read.getMappedRange());
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
  if (stage === "history") {
    for (let i = 0; i < data.length; i += stride) {
      const name =
        data[i + 27] === -1
          ? "glass"
          : data[i + 27] === 0
            ? "diffuse"
            : "reflective";
      const s = (historyStats[name] ??= {
        pixels: 0,
        samples: 0,
        secondaryGuides: 0,
      });
      s.pixels++;
      s.samples += data[i + 7];
      if (data[i + 39] > 0.5) s.secondaryGuides++;
    }
    for (const s of Object.values(historyStats))
      s.meanSamples = s.samples / s.pixels;
  }
  read.unmap();
  read.destroy();
  return {
    stage,
    nonfinite,
    channels,
    negative,
    maximum,
    locations,
    ...(stage === "history" ? { historyStats } : {}),
  };
}
canvas.addEventListener("pointerdown", (e) => {
  interact();
  drag = [e.clientX, e.clientY];
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointerup", () => (drag = null));
canvas.addEventListener("pointercancel", () => (drag = null));
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  yaw -= (e.clientX - drag[0]) * 0.006;
  pitch = Math.max(-0.1, Math.min(1.4, pitch + (e.clientY - drag[1]) * 0.006));
  drag = [e.clientX, e.clientY];
});
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    interact();
    distance = Math.max(
      sceneInfo?.camera?.distance * 0.25 || 2.2,
      Math.min(15, distance * Math.exp(e.deltaY * 0.001)),
    );
  },
  { passive: false },
);
$("#scene").onchange = () => {
  interact();
  loadScene().catch(fail);
};
$("#resolution").onchange = () => {
  interact();
  resize().catch(fail);
};
$("#mode").onchange = () => {
  interact();
  reset();
};
$("#bounces").onchange = () => {
  interact();
  reset();
};
$("#reset").onclick = () => {
  interact();
  reset();
};
$("#pause").onclick = () => {
  const resume = state.paused;
  if (resume) interact();
  setPaused(!resume);
};
$("#show-all").onclick = () => {
  $("#scene").value = "all";
  yaw = 0.1;
  pitch = 0.35;
  distance = 4.2;
  loadScene().catch(fail);
};
$("#fit-view").onclick = () => {
  interact();
  const pose = sceneInfo?.camera || {
    yaw: state.scene === "all" ? 0.1 : 0.62,
    pitch: 0.35,
    distance: 4.2,
  };
  yaw = pose.yaw;
  pitch = pose.pitch;
  distance = pose.distance;
  reset();
  setPaused(false);
};
$("#fluid-frame").oninput = () =>
  ($("#fluid-number").textContent = $("#fluid-frame").value + " / 71");
$("#fluid-frame").onchange = () => loadScene().catch(fail);
$("#denoise").onchange = () => {
  state.settled = 0;
  state.converged = false;
};
// Deterministic, bounded GPU verification; no extra animation loop or sample cap.
async function verifySteps(poses) {
  if (!Array.isArray(poses) || poses.length > 256)
    throw Error("Verification requires at most 256 poses");
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
    throw Error("Invalid verification camera");
  setPaused(true);
  await device.queue.onSubmittedWorkDone();
  for (const pose of poses) {
    if (pose) {
      [yaw, pitch, distance] = pose;
    }
    render();
    await device.queue.onSubmittedWorkDone();
    if (state.errors.length) throw Error(state.errors.at(-1));
  }
  setPaused(true);
  metrics();
  return snapshot();
}
async function verifyOptions({
  legacyHistory = false,
  legacySampler = false,
  glass = parameters.get("glass") === "split",
  motion = parameters.get("motion") === "bilinear",
  separate = parameters.get("signals") === "separate",
} = {}) {
  setPaused(true);
  await device.queue.onSubmittedWorkDone();
  parameters.set("history", legacyHistory ? "legacy" : "validated");
  parameters.set("sampler", legacySampler ? "legacy" : "energy");
  parameters.set("glass", glass ? "split" : "legacy");
  parameters.set("motion", motion ? "bilinear" : "legacy");
  parameters.set("signals", separate ? "separate" : "combined");
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
  revision: "signals-experimental-20260927",
  activeOptions: () => ({
    glass: parameters.get("glass"),
    motion: parameters.get("motion"),
    signals: parameters.get("signals") || "combined",
    splitExit: parameters.get("splitExit") === "1",
  }),
  convergence: () => ({ settled: state.settled, idle: state.converged }),
  snapshot,
  reset,
  inspectOutput,
  verifySteps,
  verifyOptions,
  waitIdle: () => device.queue.onSubmittedWorkDone(),
  pause: () => setPaused(true),
  resume: () => {
    interact();
    setPaused(false);
  },
  setCamera(a, b, c) {
    yaw = a;
    pitch = b;
    distance = c;
  },
  async setScene(name) {
    if (!sceneChoices.some(([v]) => v === name))
      throw Error("Unknown scene: " + name);
    $("#scene").value = name;
    await loadScene();
  },
  async setFluidFrame(frame) {
    $("#fluid-frame").value = String(
      Math.max(0, Math.min(71, Math.round(frame))),
    );
    await loadScene();
  },
  async setResolution(height) {
    $("#resolution").value = height;
    await resize();
  },
};
// Read back only inside this explicit bounded test; never in the rendering loop.
window.cybrLight.verifyRecomposition = async function (steps = 32) {
  if (!state.ready || state.errors.length)
    throw Error(
      "Wait for a ready, error-free scene before recomposition testing",
    );
  if (!Number.isInteger(steps) || steps < 1 || steps > 128)
    throw Error("Use 1–128 reference frames");
  const previousMode = $("#mode").value,
    previousSignals = parameters.get("signals");
  async function read(b) {
    const staging = device.createBuffer({
      size: b.size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const e = device.createCommandEncoder();
    e.copyBufferToBuffer(b, 0, staging, 0, b.size);
    device.queue.submit([e.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const a = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return a;
  }
  const captures = [];
  try {
    $("#mode").value = "reference";
    for (const separate of [false, true]) {
      await verifyOptions({ separate });
      await verifySteps(Array(steps).fill(null));
      const c = await read(colors[0]),
        m = await read(modulation),
        count = canvas.width * canvas.height,
        out = new Float32Array(count * 3);
      for (let i = 0; i < count; i++)
        for (let k = 0; k < 3; k++)
          out[i * 3 + k] =
            c[i * 4 + k] * m[i * 4 + k] +
            c[(i + count) * 4 + k] +
            c[(i + count * 2) * 4 + k];
      captures.push(out);
    }
    let maxAbsolute = 0,
      sum = 0,
      nonfinite = 0;
    for (let i = 0; i < captures[0].length; i++) {
      const d = Math.abs(captures[0][i] - captures[1][i]);
      if (!Number.isFinite(d)) {
        nonfinite++;
        continue;
      }
      maxAbsolute = Math.max(maxAbsolute, d);
      sum += d * d;
    }
    return {
      steps,
      values: captures[0].length,
      maxAbsolute,
      rmse: Math.sqrt(sum / captures[0].length),
      nonfinite,
    };
  } finally {
    $("#mode").value = previousMode;
    parameters.set("signals", previousSignals || "combined");
    reset();
    setPaused(true);
  }
};
window.addEventListener("pagehide", () => {
  cancelAnimationFrame(frameId);
  worker?.terminate();
  device?.destroy();
});
boot().catch(fail);
