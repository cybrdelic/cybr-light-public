# Asset closure and source reproduction

The validated local runtime contains 652 files (2,432,007,667 bytes). The initial publication index contained 303 files (10,240,279 bytes): 297 captured files and six added validation/proof files. Its first closure check found 355 omitted captured files, including all browser asset metadata. The final package retains four small native-authored scene manifests and adds source-only validation/preparation tools: **311 files, containing 301 captured files and ten additions**. The remaining **351 omissions total 2,429,043,406 bytes**.

The nested `browser/.gitignore` now permits those four authored manifests; generated geometry and other companion assets remain excluded. The root ignore excludes caches and the generated native knot. These exclusions are intentional in this review draft but leave imported/instrument/forest scenes unavailable.

[PUBLICATION_INVENTORY.json](PUBLICATION_INVENTORY.json) accounts for every captured file with relative path, byte count, SHA-256, disposition and reason. Later documentation/checker additions do not restore the omitted assets. Original captures and full runtime assets remain in private recovery storage; no active source checkout was changed.

## What a fresh source clone can run

| Mode | Source-clone availability |
| --- | --- |
| Native CPU procedural examples | Included C++/Python source and recipes; build and run using the root README |
| Main WebGPU `proof-optics`, `proof-metals`, `proof-indirect` | Included procedural geometry, production worker, modules and shaders; no scene asset download required |
| Native-authored material/knot browser studies | Four original material manifests included; regenerate verified geometry using `tools/prepare_browser_examples.py` |
| Imported GEO/environment models | Omitted manifest/binary companions; no verified public download or complete upstream export bundle |
| Gallery, pile, million-instance stress scenes | Omitted LOD meshes, metadata and collision bakes; rebuilding also requires the omitted original exports |
| Six-module instruments and cached FLIP | Omitted cartridge/texture/route files and 72 cached frame files; import tool needs the original companion directory |
| Forest path tracer and `forest-game.html` | Omitted forest manifest, template mesh and instance stream; upstream authoring state is not in this repository |
| Optional native CUDA/OptiX | Backend source included; optional SDK/toolchain/hardware requirements, not executed in this acceptance pass |
| Hybrid/separated browser labs | Source included; companion-dependent selections remain unavailable; no hardware acceptance claim for these frontends |

For the built-in main tracer, use an explicit proof URL:

```text
http://127.0.0.1:4181/browser/?scene=proof-optics&resolution=540&bounces=6
```

The existing unparameterized main page defaults to `combat`, an omitted companion scene. Its existing selection/renderer behavior is preserved. `node tools/check_proof_scenes.mjs` exercises the actual production worker for all three built-in proof scenes while forbidding every external fetch; this is a CPU geometry/import check, not a replacement for WebGPU validation.

## Generate native-authored browser studies

After `python -m pip install -e .`:

```bash
python tools/prepare_browser_examples.py
```

The checked-in procedural material gallery and knot recipes produce `example-materials`, `example-knot` and their `-source` lighting variants. The knot recipe creates/reimports its OBJ on demand. On the isolated source-only export, all four generated gzip geometry payloads and the generated OBJ matched the captured bytes exactly. The existing low-level exporter omits conductor Eta/K annotations from regenerated metadata; the preparation helper checks the decompressed geometry hashes and restores the four included original material manifests. It also checks the recipe and manifest hashes before writing. No renderer or original exporter code is changed.

Geometry tessellation and RGB material approximations remain the original behavior; these studies do not provide native spectral/lighting parity. Different compression versions may change gzip bytes; the helper checks decompressed content. Calling `browser/export_examples.py` directly retains its existing metadata behavior and does not guarantee the preserved material manifests.

This exporter does not recreate the imported GEO/environment, forest or combined instrument exports. `tools/build_browser_gallery.py` requires original full-resolution assets plus NumPy, SciPy and `fast_simplification`; source code alone does not supply those inputs.

## Import existing instrument companions

With an original directory containing `instrument-cartridges-c/` and `instrument-fluid/`:

```bash
python tools/import_browser_assets.py /path/to/portfolio/assets
```

The import tool checks copied hashes and refuses to overwrite different existing files. It is a local recovery/import workflow, not a public download. The publication inventory supplies expected hashes; it supplies no distribution URL or redistribution grant.

## Remaining distribution blocker

Full current-scene runtime closure has **not** been preserved in this source branch. Companion files are retained privately, but a complete regenerable upstream bundle and asset-by-asset redistribution rights have not been established. Forest loading requires the exact decompressed mesh/instance hashes in its manifest. Imported CAD/environment/outfit assets and cross-project companions need provenance review before public redistribution. Publishing their hashes does not establish permission to redistribute their contents.

The repository preserves its existing GPLv2 license, the original native MIT notice and meshoptimizer MIT notices. These cover the retained code/notices as recorded; they do not certify every omitted input or historical media file. No credentials, browser profiles, recovery archives, large source caches or checkpoints are added here. This draft stays private and does not authorize visibility change, merge, release or deployment.
