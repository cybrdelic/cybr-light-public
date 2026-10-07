import { buildBVH } from "./bvh.mjs";
import {compactBVH} from './compact-bvh.mjs';
import {packMeshletAttributes} from './meshlet-attributes.mjs';
import { packTriangles } from "./triangle-layout.mjs";
import { weightEmitters } from './emitter-distribution.mjs';
import { loadGallery } from "./gallery-loader.mjs";
import {buildInstancedBVH} from './instanced-bvh.mjs?revision=tlas-profile-1';
import {millionPile} from './million-pile.mjs?revision=million-3';
import {proofScene} from './proof-scenes.mjs?revision=proof-2';
import {loadForest} from './forest-loader.mjs';
import {createBVHCache} from './bvh-cache.mjs';
const templateCache=createBVHCache();
// Resident FP32 triangles; build once, in a worker, never on the animation loop.
self.onmessage = async ({ data }) => {
  try {
    const base = data.base;
    const isPile=['example-pile','example-million'].includes(data.module);
    const forest=data.module==='forest'||data.module.startsWith('forest-tree-')?await loadForest(base,data.module):null;
    postMessage({progress:'Loading shared geometry…'});
    const gallery = forest || (data.module.startsWith('proof-')?proofScene(data.module):(data.module === "example-gallery" || isPile) ? await loadGallery(base, isPile?'':data.focus, isPile?(data.nearModels||[]):data.nearModels, Math.min(4000000, Math.floor(data.maxStorageBytes / 96)),isPile,progress=>postMessage({progress})) : null);
    let pile=isPile?await fetch(base+(data.module==='example-pile'&&data.contactBake?'pile-compound.json':'pile.json'),{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Pile bake unavailable');return r.json();}):null;
    if(data.module==='example-pile'&&data.contactBake){
      if(!Number.isFinite(pile.quality?.maxPenetration)||pile.quality.maxPenetration>.0005)throw Error('Compound contact bake failed penetration gate');
      pile.description='2,016 rigid instances / compound component-box contacts. Post-projected static bake; not a claim of physical equilibrium. Cavities between component groups remain open.';
    }
    if(pile){
      const index=await fetch(base+'index.json',{cache:'no-store'}).then(r=>r.json());
      for(const model of pile.models){
        const asset=await fetch(base+model.id+'/low.json',{cache:'no-store'}).then(r=>r.json());
        if(asset.sha256!==model.sha256||index.entries.find(e=>e.id===model.id)?.galleryScale!==model.scale)throw Error('Pile collision bake is stale: '+model.id);
      }
    }
    const contacts=isPile?await fetch(base+'contact-boxes.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Missing compound contact assets');return r.json();}):null;
    if(forest)pile=forest.pile;
    // The vertical-only 2K relaxation failed visual QA: preserving crowded X/Z
    // positions produced tall bridges. Keep the validated dynamics bake here.
    if(data.module==='example-million'){
      postMessage({progress:'Packing one million model envelopes into one heap…'});
      pile=millionPile(pile,1000000,await fetch(base+'index.json',{cache:'no-store'}).then(r=>r.json()),data.contacts===false?null:contacts);
    }
    const manifest = gallery?.manifest || await fetch(base + "manifest.json").then((r) => r.json());
    postMessage({progress:'Decoding geometry and materials…'});
    const response = gallery ? null : await fetch(base + "instrument.bin.gz");
    if (response && !response.ok) throw Error("Geometry fetch failed");
    const raw = gallery?.raw || await new Response(
      response.body.pipeThrough(new DecompressionStream("gzip")),
    ).arrayBuffer();
    const attr = (s) =>
      new { float32: Float32Array, int16: Int16Array, uint32: Uint32Array }[
        s.dtype
      ](raw, s.offset, s.count);
    const together = data.module === "all",
      fluidOnly = data.module === "flip";
    let meshes = manifest.meshes.filter(
      (m) => (together || gallery || m.module === data.module) && (gallery || m.material !== 7),
    );
    if (together || data.module === "elements" || fluidOnly) {
      const fluidBase = new URL("../instrument-fluid/", base).href,
        fm = await fetch(fluidBase + "manifest.json").then((r) => r.json());
      const frame = Math.max(
          0,
          Math.min(fm.frames.length - 1, Math.round(data.fluidFrame || 0)),
        ),
        item = fm.frames[frame];
      const response = await fetch(fluidBase + item.file);
      if (!response.ok) throw Error("FLIP frame unavailable");
      const bytes = await new Response(
        response.body.pipeThrough(new DecompressionStream("gzip")),
      ).arrayBuffer();
      if (bytes.byteLength !== item.count * 12)
        throw Error("Invalid FLIP frame byte length");
      const p = new Int16Array(bytes, 0, item.count * 3),
        positions = Float32Array.from(p, (v) => v / fm.positionScale);
      meshes.push({
        module: "elements",
        material: 7,
        positions: { data: positions },
        normals: {
          data: new Int16Array(bytes, item.count * 6, item.count * 3),
          dtype: "int16",
        },
        indices: {
          data: Uint32Array.from({ length: item.count }, (_, i) => i),
          count: item.count,
        },
      });
    }
    const read = (s) => s.data || attr(s),
      offset = (m) =>
        together
          ? manifest.modules.find((v) => v.name === m.module)?.explodedX || 0
          : 0;
    const count = meshes.reduce((n, m) => n + m.indices.count / 3, 0);
    if (count * 96 > data.maxStorageBytes)
      throw Error(
        "Combined scene attributes exceed this GPU’s storage limit. Select an individual module.",
      );
    const tri = new Float32Array(count * 36),
      bounds = new Float32Array(count * 6),
      centers = new Float32Array(count * 3);
    const lo = [Infinity, Infinity, Infinity],
      hi = [-Infinity, -Infinity, -Infinity];
    for (const m of meshes) {
      const p = read(m.positions),
        dx = offset(m);
      for (let i = 0; i < p.length; i += 3) {
        const v = [p[i] + dx, p[i + 2], -p[i + 1]];
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], v[k]);
          hi[k] = Math.max(hi[k], v[k]);
        }
      }
    }
    // Stable vessel framing: scrubbing water must not renormalize every wave.
    if (fluidOnly) {
      const b = manifest.modules.find((m) => m.name === "elements").bounds;
      lo.splice(0, 3, b[0][0], b[0][2], -b[1][1]);
      hi.splice(0, 3, b[1][0], b[1][2], -b[0][1]);
    }
    const framing = manifest.framing;
    const center = framing
        ? [framing.center[0], framing.center[2], -framing.center[1]]
        : lo.map((v, k) => (v + hi[k]) / 2),
      scale = 4 / (framing?.extent || Math.max(...hi.map((v, k) => v - lo[k])));
    const portals = manifest.portals?.flatMap((p) => [
      ...p.center
        .map((_, k) => [p.center[0], p.center[2], -p.center[1]][k] - center[k])
        .map((v) => v * scale),
      0,
      p.u[0] * scale,
      p.u[2] * scale,
      -p.u[1] * scale,
      0,
      p.v[0] * scale,
      p.v[2] * scale,
      -p.v[1] * scale,
      0,
    ]);
    const linear = (hex) =>
      [16, 8, 0].map((shift) => {
        const c = ((hex >> shift) & 255) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
    const defaults = [
      [0xe6e7e8, 1, 0.32],
      [0xc4c7cb, 1, 0.18],
      [0x25292d, 0.65, 0.48],
      [0xffffff, 0, 0.035],
      [0x9e0c21, 0.15, 0.28],
      [0xd1c5ac, 1, 0.42],
      [0x080909, 0, 0.62],
      [0xffffff, 0, 0.025],
    ].map(([color, metalness, roughness], i) => ({
      color: linear(color),
      metalness,
      roughness,
      ...([3, 7].includes(i)
        ? { nativeType: "glass", ior: i === 7 ? 1.333 : 1.52 }
        : {}),
    }));
    const materials = [],
      matMap = new Map(),
      emitters = [];
    let t = 0,
      boundary = 0;
    for (const m of meshes) {
      let material = matMap.get(m.material);
      if (material === undefined) {
        material = materials.length / 16;
        matMap.set(m.material, material);
        const a = manifest.customMaterials[m.material] || defaults[m.material];
        if (!a) throw Error("Unmapped material " + m.material);
        const glass = a.nativeType === "glass" || a.role === "springs-water";
        materials.push(
          ...a.color,
          a.roughness,
          a.metalness,
          glass ? 1 : 0,
          a.ior || (a.role === "springs-water" ? 1.334 : 1.5),
          a.nativeType === "diffuse" ? 1 : 0,
          ...(a.emission || [0, 0, 0]),
          0,
          ...(a.attenuationColor || [1, 1, 1]),
          (a.attenuationDistance || 100) * scale,
        );
      }
      boundary++;
      const emission = materials.slice(material * 16 + 8, material * 16 + 11),
        emissive = emission.some((v) => v > 0);
      const p = read(m.positions),
        n = read(m.normals),
        ix = read(m.indices),
        c = m.colors ? read(m.colors) : null,
        boundaries = m.boundaries ? read(m.boundaries) : null,
        dx = offset(m);
      const ns = m.normals.dtype === "int16" ? 1 / 32767 : 1;
      for (let f = 0; f < ix.length; f += 3, t++) {
        const q = t * 36;
        const points = [];
        for (let j = 0; j < 3; j++) {
          const i = ix[f + j] * 3;
          points.push([
            (p[i] + dx - center[0]) * scale,
            (p[i + 2] - center[1]) * scale,
            -(p[i + 1] + center[2]) * scale,
          ]);
          tri.set(
            [n[i] * ns, n[i + 2] * ns, -n[i + 1] * ns, 0],
            q + 12 + j * 4,
          );
          tri.set(
            [c ? c[i] : 1, c ? c[i + 1] : 1, c ? c[i + 2] : 1, 0],
            q + 24 + j * 4,
          );
        }
        tri[q + 15] = boundaries ? boundaries[f / 3] : boundary;
        tri.set([...points[0], material], q);
        tri.set([...points[1].map((v, k) => v - points[0][k]), m.leafMask || 0], q + 4);
        tri.set([...points[2].map((v, k) => v - points[0][k]), 0], q + 8);
        if (emissive) {
          tri[q + 11] = emitters.length / 16 + 1;
          emitters.push(
            ...points[0],
            0,
            ...tri.subarray(q + 4, q + 7),
            0,
            ...tri.subarray(q + 8, q + 11),
            0,
            ...emission,
            0,
          );
        }
        for (let k = 0; k < 3; k++) {
          bounds[t * 6 + k] = Math.min(...points.map((v) => v[k]));
          bounds[t * 6 + k + 3] = Math.max(...points.map((v) => v[k]));
          centers[t * 3 + k] =
            (bounds[t * 6 + k] + bounds[t * 6 + k + 3]) * 0.5;
        }
      }
    }
    postMessage({progress:'Building resident acceleration structures…'});
    let buffer,nodeCount,maxDepth,geometry,attributes,instanceInfo,meshletInfo;
    if(pile){
      postMessage({progress:`Building acceleration structure for ${pile.count.toLocaleString()} instances…`});
      // Emissive faces remain emissive, but do not sample their old gallery
      // positions as lights. Their contribution is found by BSDF paths.
      for(let i=0;i<count;i++)tri[i*36+11]=0;
      emitters.length=0;
      const buildStart=performance.now(),beforeCache=templateCache.stats();
      instanceInfo=buildInstancedBVH(tri,bounds,centers,meshes,pile,scale,Number(data.tlasLeafSize||6),templateCache);
      const afterCache=templateCache.stats();
      instanceInfo.buildStats={ms:performance.now()-buildStart,cacheBytes:afterCache.bytes,
        reusedTemplates:afterCache.hits-beforeCache.hits,builtTemplates:afterCache.misses-beforeCache.misses};
      ({buffer,nodeCount,maxDepth,geometry,attributes}=instanceInfo);
      for(let i=15;i<materials.length;i+=16)materials[i]*=instanceInfo.ratio;
    }else{
      const built=buildBVH(bounds,centers,count);
      ({buffer,nodeCount,maxDepth}=built);
      if(data.compactNodes)buffer=compactBVH(buffer);
      ({geometry,attributes}=packTriangles(tri,built.ids));
      if(data.meshletAttributes){
        const packed=packMeshletAttributes(attributes),enabled=packed.data.byteLength<attributes.byteLength*.9;
        if(enabled)attributes=packed.data;
        meshletInfo={enabled,clusters:packed.clusters,vertices:packed.vertices,originalBytes:packed.originalBytes,packedBytes:attributes.byteLength};
      }
    }
    weightEmitters(emitters);
    const lighting = new Float32Array([
      ...(manifest.lighting?.environment || [0, 0, 0]),
      0,
      manifest.lighting?.disableStudio ? 1 : 0,
      emitters.length / 16,
      forest ? 1 : 0,
      0,
      ...(emitters.length ? emitters : Array(16).fill(0)),
    ]);
    const mats = new Float32Array(materials);
    postMessage(
      {
        triangles: geometry.buffer,
        attributes: attributes.buffer,
        lighting: lighting.buffer,
        nodes: buffer,
        materials: mats.buffer,
        count,
        nodeCount,
        nodeBytes:pile?48:data.compactNodes?32:48,
        meshletInfo,
        maxDepth,
        portals,
        camera: instanceInfo?.camera || manifest.camera,
        views:instanceInfo?.views,
        recommendedBounces:manifest.recommendedBounces,
        instanceCount:instanceInfo?.instanceCount,
        tlasLeafSize:pile?Number(data.tlasLeafSize||6):undefined,
        buildStats:instanceInfo?.buildStats,
        instanceRecordStart:instanceInfo?.instanceRecordStart,
        representedTriangles:instanceInfo?.representedTriangles,
        nearModels: manifest.nearModels,
        lodPositions:instanceInfo?.lodPositions,
        modelRadii:instanceInfo?.modelRadii,
        modelIds:instanceInfo?.modelIds,
        exposure: manifest.exposure ?? 1,
        notes: pile?.forest?pile.description:pile?`${pile.description||`${pile.count.toLocaleString()} instances / 42 shared model meshes. Frozen collision bake; conservative hulls fill cavities. Water is a frozen specimen.`} ${manifest.nearModels.length} detailed templates resident; individual copies switch at 48 projected pixels. Detail streams after camera input stops.`:manifest.notes,
        floor: instanceInfo?.floor ?? manifest.floor ?? (lo[1] - center[1]) * scale - 0.015,
      },
      [
        geometry.buffer,
        attributes.buffer,
        lighting.buffer,
        buffer,
        mats.buffer,
      ],
    );
  } catch (e) {
    postMessage({ error: e.message });
  }
};
