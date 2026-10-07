# Asset closure and source reproduction

The public repository retains the complete current renderer source and exact cleared browser runtime under `dist/`. The original 652-file recovery capture remains preserved separately. [PUBLICATION_INVENTORY.json](PUBLICATION_INVENTORY.json) records the historical 311-file cleanup branch; its original omission counts precede the later runtime restoration. [LIVE_ASSET_INPUTS.json](LIVE_ASSET_INPUTS.json) and [LIVE_ASSET_SCOPE.json](../dist/docs/LIVE_ASSET_SCOPE.json) describe the current public runtime and pin every delivery-file hash.

## Current availability

| Mode | Public availability |
| --- | --- |
| Native CPU procedural examples | Complete C++/Python source and recipes; build/run using the root README |
| Main WebGPU transport proofs | Three built-in procedural scenes, original worker, modules and shaders |
| Native-authored browser studies | Four exact material/knot exports; recipes and checked preparation helper retained |
| GEO models | All 28 preserved procedural GEO export pairs |
| Gallery | 39 cleared models with original low/near geometry; no substituted meshes |
| Six-module instrument and cached FLIP | Original cartridge, texture, route and all cached frame files; instrument bytes match the cleared public portfolio package |
| Forest | Exact original manifest, complete geometry and 1,220,375 placements for raster and path-tracer loaders |
| CUDA/OptiX | Backend source included; optional SDK/toolchain/hardware requirements remain |
| Hybrid/separated browser labs | Source retained; existing experimental limits and companion-dependent modes remain |

Clone the public repository and serve its packaged runtime:

```bash
python -m http.server 4181 --bind 127.0.0.1 --directory dist
```

Open `http://127.0.0.1:4181/`. A source ZIP or source-only hosting checkout can first run `python tools/restore_live_assets.py`; it retrieves files from the pinned public asset commit and checks every size and SHA-256 digest. `--local-input-dir` accepts a verified local mirror. The original source entry points under `browser/` remain available for inspection and the three asset-free proof scenes.

## Delivery and validation

The public repository stores all cleared runtime files locally. The live Site bundles smaller inputs and directly fetches exact large parts and selected gallery near-detail payloads from the immutable public GitHub commit. The existing worker fetch adapter reconstructs the original compressed bytes before decoding. This is explicit application fetching, not a static redirect rule. [Public release scope](PUBLIC_RELEASE.md) describes the limits and exact dependency; the built client records its selected external files in `docs/DELIVERY.json`.

`python tools/validate_live_assets.py` checks all original split-stream hashes. `node tools/validate_live_transport.mjs --client` exercises the deployed adapter, pinned URLs, byte lengths, MIME types and original stream hashes without a browser or GPU. The original forest and gallery loaders retain their decompressed-content hash checks. Cached FLIP is recorded geometry, not live fluid simulation.

## Reproduce native-authored studies

After installing the Python package, run `python tools/prepare_browser_examples.py`. The included material gallery and knot recipes reproduce all four geometry exports; the generated knot OBJ also matched the preserved capture. The low-level exporter omits conductor Eta/K annotations, so the preparation helper verifies decompressed geometry and restores the included original material manifests. Compression versions may change gzip bytes; decoded geometry and original RGB approximations remain the same. No renderer or original exporter math was changed.

## Remaining exclusions

The Observatory interior/full-scene and Drowned Geode exports, their LOD derivatives and the dependent old pile/million bakes are excluded. Attribution for their imported-room/scanned inputs remains unresolved. Five geode texture conversions have recognizable source names but no verified license/source record here. Differential and geode authoring caches, credentials, recovery archives and private Git history are excluded.

The forest authoring state/exporter is outside standalone LIGHT. Exact cached runtime restoration is verified; authoring-source regeneration is a separate workflow. Absence of that generator does not prevent redistribution of the verified original procedural runtime.

GPLv2 code, original native MIT terms, meshoptimizer MIT notices, current MakeHuman/Quaternius mannequin provenance and motion credits retain their separate scope. The runtime clearance receipt does not assign a blanket license to unrelated or excluded inputs.
