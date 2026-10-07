# Known issues and validation limits

These are pre-existing limits of the captured current implementation. Consolidation does not claim to fix them.

## Native spectral rendering

- The surface photon mapper is a biased density estimate. General visibility-aware automatic differentiation and unbiased bidirectional transport are absent.
- Native derivatives cover selected material/shader controls; general fitting uses finite differences. Camera/medium combinations and overlapping dielectric solids have restrictions in the capability matrix.
- The forward photon detector uses a serial loop on classic MSVC OpenMP, whose compiler rejects its unsigned 64-bit loop index. GCC/Clang keep their existing parallel path. Native transport source is unchanged.
- The MSVC CPU renderer can build independently of material JIT compilation. The current JIT/rebuild commands require a GCC/Clang-style compiler; MSVC-only environments cannot run those optional compilation workflows.
- CUDA/OptiX supports a restricted surface subset and explicitly rejects unsupported features. Numba CPU/CUDA and tensor examples are separate backends. CPU tests do not validate physical GPU execution.
- Checkpoints depend on compatible scene/assets/settings and native format/build. They are not universal interchange files.
- Windows checkpoint replacement uses the existing `std::rename` behavior and can fail when the destination already exists. The native engine test also uses a fixed filename in the shared temporary directory; an interrupted earlier run can leave a destination that makes a later run terminate. Use an isolated temporary directory for validation. This existing checkpoint/test behavior was observed and remains unchanged.

## Browser path tracing

- Motion and initial frames remain noisy, especially glass, reflections, thin detail and disocclusions. Settled imagery does not prove clean moving optics.
- Reconstruction can soften edges/highlights. Single-signal stationary accumulation improves stability but does not remove the existing moving optical noise.
- RGB/FP32 transport has different features and precision from native spectral transport. It is not a WebAssembly build of the spectral engine.
- Optional endpoint/contributor/cache/optical modes have additional quality and performance limits. Keep them explicit; no universal quality or FPS promise is made.
- Large scenes require sufficient WebGPU storage limits. Adapter selection depends on browser/OS configuration; verify the actual adapter before comparisons.
- Full asset-heavy modes need their original exported binaries. Source availability alone does not recreate every model export. Cached FLIP frame selection rebuilds geometry; it is not continuous simulation playback.

## Forest raster prototype

The fast forest entrypoint renders source geometry using rasterization, cached sunlight depth shadows, approximate hemispherical sky lighting, adaptive detail and 4Ã— MSAA. It is not a completed path-traced hybrid.

- No traced indirect occlusion/multiple scattering or dynamic sunlight/shadow invalidation.
- Finite shadow-map resolution and bias, LOD transitions and perceptual motion AA remain limitations.
- Source forest export lacks native leaf transmission, textures and volumetric fog. A clearing camera preset intersects branches.
- Default simplification error is 0.75 internal pixels. The 1.5-pixel setting is explicitly lossy; zero disables LOD.

Historical Oct 6 measurements on the same NVIDIA/Lovelace GPU at 960Ã—540 reported approximately **74 FPS trail, 158 FPS canopy, 61 FPS clearing**, and 70 FPS moving trail after warm-up. Cold trail timing was substantially slower. These are preserved measurements, not fresh consolidation benchmarks or a guarantee of 120 FPS everywhere.

## Cleanup validation

Matched current-source baselines and new consolidation evidence are stored outside the working repository. Keep original scene/settings/cameras/seeds for comparisons; inspect actual pixels and user-visible behavior. Document an unavailable runtime check as unverified. Optional GPU backends require their own coordinated checks, and no live deployment is part of this work.
