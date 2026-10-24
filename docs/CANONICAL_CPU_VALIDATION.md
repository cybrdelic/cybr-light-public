# Canonical CPU Assembly and medium changes

This is a partial native CPU integration on public base
`dce2427660adaa6a6de2bb8626d66ffabcd868ce`, not a renderer replacement or a
completed cross-repository consolidation. Existing browser, CUDA/OptiX, geometry,
sampling, scene-format and camera-initialization implementations are unchanged.
The separate mobile-session and meshlet draft work is not included.

## Shared owners and behavior

- `cybrlight.mesh_io.append_assembly` appends an explicit static GEO-style Assembly
  through the existing `Scene.mesh` consumer. The caller supplies material IDs
  and an orientation-preserving source-to-metres affine transform. No material,
  finish, motion or camera policy is inferred. Invalid input, implicit motion,
  nonidentity part poses and triangle loss are rejected; consumer failure rolls
  back appended primitives and object IDs. This is a duck-typed bridge, not a
  bundled GEO implementation or a new rendering backend.
- Exactly equal incident/transmitted indices make RoughGlass a straight unit
  delta with identity Mueller transport. Ownership still changes, but the event
  consumes no scattering depth, Russian-roulette decision or angular NEE sample.
  The continuous BSDF density is zero. Matching is exact, not a tolerance;
  coated Glass remains an interface.
- Exiting a non-top overlapping object retains the surviving top medium's IOR.
  The existing last-entered/top precedence is retained.
- Camera transport, photon-map paths and the standalone photon detector use
  `BSDFSample::null_event()`. The standalone detector now consumes the existing
  `MediumStack`, `dielectric_indices` and `transition_medium` owner rather than
  maintaining its duplicate index/transition algorithm. Importance eta weighting
  remains in the light-path consumers, distinct from camera weighting.

## Validation on 2026-10-24

Rebuilt and tested from an isolated public checkout on CPU:

- Engine numerical suite: 61 assertions passed; numerical suite: 28 passed.
- Python discovery: all 87 tests passed, including six Assembly importer tests.
- Existing browser CPU suite: all 263 tests passed; no browser source changed.
- Main renderer and standalone photon detector compiled successfully with
  C++17, `-O2`, OpenMP and `-ldl`, sequentially rather than a parallel heavy build.
- All 64 source-byte contracts and required source/license checks passed.
  Five contracts have explicitly recorded changes and retain their prior hashes;
  the other 59 are unchanged. The checker itself was not weakened or changed.
- Existing anisotropy, dielectrics and cloud smoke scenes completed at 160x106,
  four packets, four wavelengths, one CPU thread. These are execution smoke
  checks, not convergence, temporal stability or physical-accuracy evidence.
- Changed-file private-path and credential-pattern scan and `git diff --check`
  passed. Original mixed line endings were preserved rather than normalizing
  unrelated source. No private history, user paths, recovered source archives,
  generated render outputs or binaries are included.

CMake was not installed in this local validation environment. The existing
GitHub workflow separately runs the CMake build, CTest, Python discovery, source
contracts, smoke scenes and browser CPU tests. Its status must be checked for
the actual PR head; the local results above are not a claim that CI passed.

Standard reproduction:

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel 1
ctest --test-dir build --output-on-failure
PYTHONPATH=python python -m unittest discover -s tests -p 'test_*.py' -v
python tools/check_repository.py
node --test browser/*.test.mjs
PYTHONPATH=python python tools/examples.py anisotropy dielectrics cloud --preset smoke --threads 1 --out rendered/ci
```

## Literal source-line accounting

Production changes are 85 added / 15 removed, net +70: the Assembly adapter adds
55 lines; the medium fix adds 30 and removes 15. Tests add 105 lines. The removed
standalone index/transition algorithm occupies three dense physical source
lines; no broader logical-line reduction is claimed.

First-party source totals are 20,295 before and 20,470 after, net +175 across
249 files. The native library subset (`include/`, `src/`, `python/`) is
4,258 before and 4,328 after. These are physical lines including comments and
blank lines in tracked `.py`, `.cpp`, `.hpp`, `.h`, `.cu`, `.js`, `.mjs` and
`.wgsl` files, excluding `dist/`, `browser/vendor/`, documentation, assets and
generated output. This patch centralizes one duplicate consumer; it is not a
claim that total code size decreased.

## Remaining limits

This does not establish complete medium correctness. Initial camera-inside
medium/Beer attenuation, unmatched exits, duplicate entries, shadow ownership,
atomic coincident-interface ordering and finite-gap/contact precision remain
outside this patch. Fixed 2-micrometre spawn offsets and the 1-micrometre default
hit minimum are unchanged. Photon-map trace retains its pre-existing strict
maximum-depth convention; the regression verifies null continuation at depth 1,
while the main camera test also covers terminal depth 0.

ROAM and PETG outputs remain proof-only. No noise-free, flicker-free, continuous
motion, exact-contact, ARX source parity or physical qualification is claimed.
Unfinished spawn/contact changes and recovered sampling implementations are not
included. Full GEO/ARX alignment and production rerender acceptance remain
separate work. The browser distribution and source ZIP are not rebuilt or
deployed by this PR.

Root GPLv2, the separately scoped original native MIT notice, and all existing
third-party notices are unchanged. No project-wide relicensing is performed.
