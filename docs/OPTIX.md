# Native GPU spectral surface backend

This opt-in backend runs CYBR LIGHT transport on CUDA and uses NVIDIA OptiX
for hardware-accelerated triangle traversal. It does not call Mitsuba or the
Numba CUDA simulator. The existing CPU executable is unchanged.

## Current implemented scope

- Triangle meshes with smooth normals and UV tangents; quads triangulated for RT traversal.
- Native scalar-wavelength packets, analytic observer, measured spectral tables.
- Diffuse, anisotropic GGX conductor/plastic, smooth dielectric, conductor mirror.
- Experimental: linear PFM albedo maps on diffuse/plastic, with repeat/clamp and UV scale.
- Experimental: one tangent normal-map or height/bump-map wrapper on a supported leaf BSDF, including water/glass. Textured AOVs retain material detail for denoising.
- Cauchy dispersion, nested dielectric absorption, single-layer thin-film coating.
- Linear PFM environment lighting with the native importance distribution and MIS.
- Emissive triangles/quads, including emission on supported reflective materials, with spectral blackbody temperature and finite-area light sampling/MIS.
- Point, directional and spot lights (up to 64), retaining the native intensity/irradiance units and spot falloff. An environment is no longer required when another supported light is present.
- High-resolution environments integrate multiple samples per proposal cell so small HDR lights are not lost by coarse point sampling.
- Static pinhole/orthographic cameras; independent samples; box/tent filters.
- Raw film and first-hit position, depth, normal, object-ID, albedo, standard-error maps.
- Small GPU launches, live packet progress, checksum-protected resumable checkpoints.

Unsupported features are explicitly rejected: analytic geometry not tessellated
by the caller, other material wrappers and arbitrary compiled/GLSL shaders,
emission inside a normal/bump wrapper, volumes, polarization, AD, arbitrary observer tables, other filters,
motion and depth of field. This is not full engine feature parity.

Nested-medium storage supports 64 boundaries; overflow is a fatal validation
error, not silent truncation. RT traversal uses float geometry; shading and
film accumulation use double precision. GPU results are not promised bitwise
identical to CPU results. A GPU checkpoint resumed on the tested configuration
does reproduce its uninterrupted GPU film exactly.

## Build and run

On the current Windows workstation, `powershell -File tools/build-optix.ps1`
uses installed CUDA 12.9, OptiX 9.1 and MSVC, writing a separate executable and
device.ptx to D:/CYBR-build/exploded-instrument/native-optix. No driver or system
settings are changed. Keep device.ptx adjacent to the executable.

A standalone CMake project is also supplied in src/optix. Pass OPTIX_ROOT and
CYBR_CUDA_ARCH explicitly. The tested device is an RTX 4060 Laptop GPU (89).
Other devices and the CMake route require their own build/run validation.

```
cybr-light-optix --scene input.cys --out result --spp 128 --bands 8
cybr-light-optix --scene input.cys --out result --spp 128 --resume result.gpu-checkpoint
```

Python entry point: `from cybrlight.optix import render_optix`. Pass the built
executable explicitly. It does not silently fall back to CPU.

Progress: result-progress.json (atomic update after each complete wavelength
packet per pixel). Checkpoints: every eight packets by default. `--tile 8192`
limits pixels per launch. The measured launch-duration gate aborts if a launch
exceeds one second; it is not a guarantee against all driver/device failures.
Use `--stop-after N` for a controlled checkpoint/resume test.

## Evidence

Run tools/validate-optix.py for a physical GPU comparison and exact GPU resume
test. Use --instrument 20 / 28 to compare the stored portfolio test scenes.
Raw CPU/GPU films and metrics stay in D:/CYBR-build/exploded-instrument/optix-validation.
Never promote a production bake based solely on a small synthetic fixture.

### Validated workstation results (2026-09-22)

The RTX 4060 Laptop passed the instrument water-view gate at 1280 x 800,
128 packets x 8 wavelengths and 20 bounces. Object IDs matched 100%; the
largest mean brightness error on a major surface was 0.154%. The denoised
CPU/GPU comparison was visually reviewed. CPU reported 1502.83 seconds;
GPU reported 477.29 seconds (about 3.1x faster on this view). GPU timing also
includes checkpoint/output writes, so these are not identical timing scopes
or a promise for other scenes. Maximum measured GPU launch was 218.86 ms.

### Experimental Springs material path (2026-09-23)

`tools/validate-optix-maps.py --gpu <experimental-exe> --out <isolated-folder>`
compares the actual CPU/GPU films for repeated/clamped colour maps, a mineral
bump map, tangent normals and closed refractive bump-mapped water. It also
requires exact checkpoint resume and rejection after changing a texture asset.
The fixture passed on the RTX 4060 Laptop: 100% object-ID agreement, relative
mean-film error 0.001081% after the environment-sampling change, zero invalid samples. This is a small correctness
fixture, not a speedup or full-scene visual-parity claim.

The portfolio's `export_springs_materials.cpp` evaluates the original source
shader into albedo, shading normal, roughness and IOR samples without lighting.
`render_springs_gpu_probe.py` uses its mineral maps and original closed pool
geometry, source absorption spectrum, and a source sky with the separate solar
light integrated into the environment map. The optical source IOR is 1.334
without invented dispersion. This is a focused test, not the completed hero.

Experimental source-style rough-diffuse shading, spatial roughness/IOR,
direct vertex-material interpolation and homogeneous water scattering have
subsequently been added. `--refractive-nee` enables single-interface, single-root
Snell connections; it does not provide general caustic/steam transport.
Still required for source parity: full-scene transport and material correspondence
review, source-specific steam, and full-quality multi-view validation.
Do not label the complete Springs scene supported based on the map fixture.
Production binaries/assets remain unchanged; candidates live in isolated
`portfolio/output/optix-springs-dev*` folders.

Later candidates are in `portfolio/output/optix-water-nee-v*`. The v7 direct
vertex-material CPU/GPU fixture reports 0.0123% relative mean-film error, 100%
ID agreement, zero invalid samples and exact checkpoint resume. Per-vertex
attributes apply only to diffuse/plastic/landscape leaves and are rejected by
the portable backend. Python `Scene.mesh` accepts paired `albedo` and `parameters`
Nx3 arrays; parameters are roughness, achromatic IOR, reserved zero.
Use physical reflectance inputs, never already-lit vertex colors.

GPU checkpoint identities now also include the host executable, not only the
scene/assets/PTX. This rejects resumes across host-side sampler changes.
Existing production executables/checkpoints are not migrated or overwritten.

The fixture also passed exact checkpoint resume, rejection of an incompatible
checkpoint, and rejection of unsupported emissive materials. Production uses
the separate `resume_optix_bakes.py` queue, accepting existing CPU receipts and
isolating geometry export in a subprocess to release its memory before tracing.

Known limitation: triangulated anisotropic quads may have a tangent seam across
their diagonal. The instrument's only quad is a diffuse backdrop; anisotropic
quad parity is not covered by these instrument results.

## Isolated optimization experiment (pending measurement)

`--inflight 1..8` on the new experimental host batches launch submissions with
separate pinned parameter slots and per-launch CUDA timing events. All work
stays ordered on the same stream; samples and checkpoint boundaries drain the
queue. The one-second per-launch safety gate is retained. The default is 1.

`tools/build-optix.ps1 -Build <separate-directory> -MixedMath` builds an opt-in
precision experiment: FP32 exp/trigonometric functions with double film,
geometry, square roots, and optical arithmetic. This is NOT a full FP32
renderer and is not approved for production. The default shader is unchanged.

The portfolio's `benchmark_optix_candidates.py --wait-for-bakes` first waits
for 49/49 production completion, acquires the shared queue lock, then tests
baseline/scheduled/mixed variants on lens and water views with reversed-order
paired trials. Candidates must exceed 1.1x on both views, pass image/geometry
gates, then pass fresh 1280 x 800 / 128 x 8 comparisons and exact GPU resume.
Results and reduced contact sheets stay under `optix-experiments/benchmark`.
Human image inspection remains required; the runner never promotes binaries.

The production worker now defaults to `--tile 2048` after a one-second safety
stop at view 40. This changes launch size, not samples, resolution, shaders,
or checkpoint compatibility. No speedup is claimed for this safety change.

### Emission and direct-light verification (2026-09-26)

`tools/validate-optix-emission.py --gpu <exe> --cpu <exe> --out <folder>`
checks an emissive-only scene, mixed environment/emission, environment-only,
and independent directional, point and spot fixtures. Tests include pure
emitters and emissive plastic, front/back emission, cast shadows, exact GPU
resume and rejection after changing emission. The physical RTX 4060 run had
100% object-ID agreement and maximum mean-film disagreement of 0.0263% across
these fixtures. The CPU/GPU comparison images were inspected.

Finite emitters and the environment use separate sampling techniques with
corresponding BSDF-hit MIS weights. Direct delta lights have no BSDF-hit
sampling competitor. Emission uses the CPU's 560 nm-normalized blackbody
convention; absolute physical radiance still requires the caller's emission
scale. A temperature alone does not specify total radiance in this API.

These small correctness fixtures do not establish a speedup or final scene
quality. GPU timings here were slower than CPU timings, and concurrent
physics work was running. Arbitrary volumes and emission inside material
wrappers remain unsupported. No CPU fallback is used.
