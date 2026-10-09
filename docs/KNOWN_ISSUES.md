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
- A physical Android Qualcomm / Adreno-8xx session reported Chromium's `A valid external Instance reference no longer exists` at the default 960×540 proof-optics settings. This message alone does not identify the underlying driver/browser failure. The host now retains the startup phase and device-loss reason, prevents late errors from hiding that information, serializes mobile pipeline compilation, and omits optional timestamp-query/readback diagnostics on mobile. `gpuTimings=1` explicitly restores timing diagnostics. Scene geometry, shaders, resolution, bounce count and transport inputs are unchanged. These mitigations require confirmation on that physical device; a desktop browser with a mobile viewport is not an Adreno test.
- **Retry renderer** creates a fresh session with the selected scene, resolution, bounces and mode, serial compilation, and optional GPU timing disabled. It does not loop automatically or replace the renderer with a static preview. Returning to a cached document reloads its destroyed GPU session; pending startup work is cancelled when the document leaves.
- **Physical Adreno retest still fails**, including live version 6 with compact mode selected on FUSE C220. Full Chrome 154 also reproduced loss in the isolated current-trace check after successful WGSL validation, during compute-pipeline creation, with zero scene/frame GPU allocations and no timeout. The lifecycle changes and compact mode are not a fix on this phone. The physical version-7 sequence passed tiny and full-source empty-entrypoint controls, then failed at active current-trace pipeline creation and correctly stopped. The physical version-8 probe sequence passed empty 8x8, bindings and 64-entry BVH traversal, then lost its device compiling the medium helpers after clean frontend validation and with zero GPU buffer allocations. The user also reported the same error after live version 9; exact phone shader selection/cache state was not independently retrieved. Version 10 selected sixteen separately named scalar medium slots. The current candidate selects workgroup medium storage on Qualcomm/Adreno only when actual device limits pass, keeping sixteen slots, exact keys and transport. `mediumStack=scalar` restores version 10 and `mediumStack=legacy` restores the original form. Workgroup state and six-/ten-bounce pixel parity pass on NVIDIA/Lovelace, but this candidate has not passed a physical Adreno retest. The scalar candidate removes private medium arrays, dynamic medium indices and medium pointer helpers. CPU equivalence, exact integrated module hashes, Naga validation, real NVIDIA operation comparisons and six-/ten-bounce pixel parity pass. The candidate has not passed a physical Adreno retest. Earlier host loss/retry checks remain historical evidence; desktop success does not establish phone compatibility. Reports remain local and copyable after reload. Desktop success does not establish physical Adreno compatibility. See [the current investigation and compile isolation plan](MOBILE_GPU_RECOVERY.md).
- Full asset-heavy modes need their original exported binaries. Source availability alone does not recreate every model export. Cached FLIP frame selection rebuilds geometry; it is not continuous simulation playback.

## Forest raster prototype

The fast forest entrypoint renders source geometry using rasterization, cached sunlight depth shadows, approximate hemispherical sky lighting, adaptive detail and 4x MSAA. It is not a completed path-traced hybrid.

- No traced indirect occlusion/multiple scattering or dynamic sunlight/shadow invalidation.
- Finite shadow-map resolution and bias, LOD transitions and perceptual motion AA remain limitations.
- Source forest export lacks native leaf transmission, textures and volumetric fog. A clearing camera preset intersects branches.
- Default simplification error is 0.75 internal pixels. The 1.5-pixel setting is explicitly lossy; zero disables LOD.

Historical Oct 6 measurements on the same NVIDIA/Lovelace GPU at 960x540 reported approximately **74 FPS trail, 158 FPS canopy, 61 FPS clearing**, and 70 FPS moving trail after warm-up. Cold trail timing was substantially slower. These are preserved measurements, not fresh consolidation benchmarks or a guarantee of 120 FPS everywhere.

## Cleanup validation

Matched current-source baselines and consolidation evidence are stored outside the working repository. Keep original scene/settings/cameras/seeds for comparisons; inspect actual pixels and user-visible behavior. Document an unavailable runtime check as unverified. Optional GPU backends require their own coordinated checks. The public live package retains the captured runtime; its publication adds CPU source/asset/delivery checks without a new GPU benchmark. Large assets depend on the immutable public GitHub asset commit, as recorded in the release scope.

## Phone failure after version 11

On October 9 the user reported the same “A valid external Instance reference no longer exists” startup error after version 11 was published. Fresh public HTTP checks matched the saved candidate, including its session URL, exact compiler imports, medium policy and source ZIP. The phone document, selected medium mode and precise failing stage were not independently retrieved. Version 11 is not a verified phone fix.

The ordinary failure panel now names the startup/compilation stage and actual selected medium mode, including a scalar device-limit fallback. Concurrent shader-information checks list all active shaders; a rejected request retains its own label. The loss reason survives later failures, and further GPU requests stop after loss. This is an observability correction. It preserves scene/resolution/bounce settings and records context locally without automatic upload or a separate diagnostic sequence.

Chrome/NVIDIA acceptance exercised normal and explicit workgroup startup, an injected trace-pipeline rejection with scalar fallback, and injected device loss with automatic workgroup selection. All passed; no post-loss GPU request occurred. Qualcomm metadata overrides were policy fixtures on the NVIDIA host. Physical Adreno success remains unverified. See [the pinned acceptance receipt](MOBILE_FAILURE_CONTEXT_VALIDATION.json).
