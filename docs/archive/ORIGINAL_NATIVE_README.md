# CYBR LIGHT 0.2 — independent renderer engine

This archived guide describes the original 0.2 native engine package, including its tests, frozen scenes, and execution records. Use the root README for current checkout instructions and the capability matrix for supported features and limits.

## Build and run

The delivered build was executed on Linux, with Python 3.13 and a C++17 compiler. Linux/WSL is the tested path. Other operating systems and physical CUDA GPUs are not verified.

```bash
python -m pip install -e .
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j4
ctest --test-dir build --output-on-failure
python -m unittest discover -s tests -p 'test_*.py' -v

# An actual XML scene with PLY geometry, references, and transformed instances.
python -m cybrlight validate examples/workflow/instances.xml
python -m cybrlight render examples/workflow/instances.xml --out rendered/instances --spp 64

# Reproduce a frozen integration scene directly with the native renderer.
python -m cybrlight render examples/executed/02_camera_caustics/scene.cys --out rendered/caustics
```

`CYBR_LIGHT_BINARY` or `render(..., executable=...)` can select a separately installed native executable. `python -m cybrlight features` and `python -m cybrlight plugins` describe the implemented surface. The installed `cybrlight` command is equivalent to `python -m cybrlight`.

## Engine components

The C++ engine provides wavelength-sampled path and volume transport, MIS, anisotropic GGX surfaces, nested dielectric interfaces, absorption, homogeneous and bounded heterogeneous media, Rayleigh/HG scattering, Mueller/Stokes propagation, camera-view surface photon mapping, analytic geometry, smooth triangle meshes, a BVH, textures, material graphs, cameras, reconstruction filters, film/AOV export, and checkpoint/resume.

The Python scene system loads a checked dictionary and XML scene vocabulary. It provides references, affine transforms, flattened instances, OBJ/PLY import, parameter traversal with transactional updates, complete snapshots, and self-contained asset bundles. Only the documented plugin parameters and semantics are supported. RGB triples are spectral authoring controls in the native renderer, not calibrated RGB-to-spectrum reconstruction.

The new independent expression compiler emits and executes C++17 kernels. It has eager/broadcast evaluation, reverse derivatives, symbolic higher derivatives, and a material-shader ABI used by the native renderer. This compiler does not use PyTorch. It is an elementwise expression compiler: it does not provide general reductions, scatter/gather, dynamic control flow, or GPU lowering. `select` is not lazy: both branches must be mathematically defined. Constant-only graphs can be evaluated eagerly; compilation requires a named input.

A separate shared Numba CPU/CUDA transport implementation provides a threaded BVH, smooth triangles, analytic primitives, rough and smooth materials, dispersion, and nested optical media. Its same-source CPU and CUDA-simulator test results match. **CUDA simulation is CPU execution, not evidence that device code compiles or runs on a physical GPU.** Numba supplies this backend's compiler; the independent shader compiler and the portable backend are distinct implementations.

`cybrlight.inverse` adds bounded low-dimensional scene fitting with finite-difference rerenders. It can optimize selected geometry, camera, light, material, or volume controls exposed by `traverse()`. It is **not automatic differentiation** and is not an unbiased visibility derivative estimator. Native material/shader AD is a separate facility restricted to three active controls.

## Executed examples

The primary outputs in `outputs/` are actual rendered images with raw floating-point buffers and run receipts. The full archive includes the raw films. The source archive preserves scene inputs, assets, code, tests, and compact verification reports, but omits most saved image buffers.

| Example | What actually executes |
|---|---|
| `01_anisotropy` | Analytic cylinders/disks, anisotropic GGX conductors, environment and area-light sampling. |
| `02_camera_caustics` | Shared-scene spectral photon mapping through dispersive glass, observed from a camera. |
| `03_polarized_rayleigh` | Multiple scattering through a bounded Rayleigh medium, with stored Stokes films. |
| `04_transparent_shadows` | Delta-light illumination through spectral null sheets, preserving tinted visibility. |
| `05_material_graphs` | PFM bitmap textures, normal mapping, and nested BSDF mixtures. |
| `06_compiled_shader` | A generated C++ spectral shader used in native transport, with rendered derivatives. |
| `07_xml_instances` | An XML scene with material references, PLY triangles, and transformed instances. |
| `08_portable_bvh` | The shared CPU/CUDA source executed using its Numba CPU target; no hardware GPU claim. |
| `09_inverse_geometry` | A two-parameter geometry fit using real finite-difference renders. The target is synthetic. |

`03_polarization_analysis.png` contains analyzer views and a degree-of-polarization map derived analytically from the saved Stokes films; these are not four separately rerendered scenes. `outputs/baseline_rechecks/` contains newly executed quick regressions of older frozen scenes, not reused old images. The original baseline scene inputs and optional tensor demonstration remain available, with their earlier scope labeled separately.

```bash
# All seven new native scene recipes, with recorded delivery quality.
python tools/engine_gallery.py --quality
# Faster construction/rendering smoke checks.
python tools/engine_gallery.py --smoke
# Same-input native image derivatives, checkpoint/resume, relocation, EXR checks.
python -m pip install -e '.[exr]'
python tools/verify_integrations.py
# Geometry fitting and held-out-seed validation.
python tools/inverse_geometry_example.py
```

## Portable backend

```bash
python -m pip install -e '.[portable]'
python tools/portable_validation.py --backend cpu
# Explicitly CPU-simulated CUDA. This is not a hardware test.
NUMBA_ENABLE_CUDASIM=1 python tools/portable_validation.py --backend cuda
python tools/portable_validation.py --gallery

# Physical CUDA execution is attempted only without NUMBA_ENABLE_CUDASIM.
# Requires a compatible CUDA/Numba installation and GPU; not verified here.
python -m cybrlight render examples/executed/08_portable_bvh/scene.cybr.json \
  --backend portable-cuda --out rendered/portable_gpu
```

The portable adapter rejects unsupported native materials, volumes, polarization, AD, textures, custom observers, and integrator/sampling combinations. It does not silently fall back to the CPU native renderer or present simulation as a GPU run. Its optical stack has 64 entries, checked for overflow; the native C++ stack can spill to dynamic storage. Portable cameras must start outside dielectric primitive bounds.

## Checkpointing and asset relocation

```bash
python -m cybrlight render examples/executed/06_compiled_shader/scene.cys \
  --out rendered/part --spp 16 --checkpoint rendered/part.ckpt
python -m cybrlight render examples/executed/06_compiled_shader/scene.cys \
  --out rendered/resumed --spp 32 --threads 4 --resume rendered/part.ckpt

# Rebuild the bundled shader on another machine before loading its scene.
python -m cybrlight rebuild-shaders examples/executed/06_compiled_shader
```

Requested `--spp` is the **total** sample count, not additional samples. Checkpoints hash scene inputs and assets and validate their ABI, dimensions, payload checksum, and trailing bytes. Thread counts can change without changing the sample sequence. Checkpoints are native-ABI files, not a portable cross-version archival format. Rebuilding a shader changes its binary hash and therefore invalidates checkpoints that used the previous binary.

Scene bundles contain `scene.cys`, `scene.cybr.json`, `assets.json`, and `shaders.json`. Shader records associate the binary with its generated C++ source, graph, and compilation receipt. The original asset manifest describes delivered bytes; `shader_rebuild.json` records local recompilation. Only load or rebuild trusted shaders: a native shared library executes arbitrary code.

## Numerical and optical limits

The default observer remains a disclosed analytic CIE approximation. Material triples are illustrative spectral controls; there is no bundled measured-optics database. The native renderer accepts tabulated material spectra and an observer table supplied by the user. The VOL v3 reader preserves scalar grid values without resampling; explicit CYBR volume bounds define placement. RGB/six-channel VOL files can be read, but are rejected as scalar density rather than silently converted.

Photon mapping is a **biased spatial-density estimate** with finite spectral bands, not unbiased BDPT/VCM. The native material model is not a measured multilayer solver; hair/BSSRDF, general microfacet multiple scattering, and arbitrary intersecting dielectric-solid resolution are absent. Motion is translation-only. Native camera media are not initialized from containment queries, so cameras should start outside dielectric interiors. Some features cannot be combined, including native AD with polarization and camera photon mapping with volumes.

Raw films are not denoised or radiance-clipped. PNG previews use a display tone curve and gamut clipping. Monte Carlo noise remains visible; these are implementation/validation scenes, not a demonstration of production photorealism. Native diagnostic AOVs use a pinhole, mid-shutter center sample, not reconstruction-filtered coverage; `_normal` is remapped into [0,1], and `_albedo` is an authoring-control diagnostic, not calibrated reflectance. The `aov` compatibility wrapper validates the documented subset but does not reproduce arbitrary named EXR channels. Standard-error buffers are descriptive IID estimates, not rigorous confidence intervals for the Halton sampler.

## Evidence and licensing

`evidence/` records actual commands, test results, CPU/simulator comparisons, raw-image finite differences, relocation, checkpoint checks, and the independent OpenEXR decode. `docs/CAPABILITY_MATRIX.md` ties implemented areas to evidence and explicit limits. `baseline_evidence/` preserves earlier results without representing them as new tests. Physical GPU execution was not verified in this archived delivery.

Original project code is MIT licensed. The licenses of NumPy, Pillow, Numba/LLVM, optional OpenCV/OpenEXR, and the optional legacy PyTorch example remain separate. No font files are distributed. There was no remote repository push or CYBR GEO default-backend change.
