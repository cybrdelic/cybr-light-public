# Native examples

Run from the repository root after building the C++ renderer and installing the Python package:

```bash
python tools/examples.py --list
python tools/examples.py all --preset smoke
python tools/examples.py rayleigh polarization fog cloud --preset preview
python tools/examples.py mesh dof motion --preset preview
python tools/examples.py shader --preset preview
```

`--preset smoke` uses 160x106, four sample packets and four wavelengths per packet. `preview` uses 480x320, 64 packets and eight wavelengths. `reference` uses 720x480, 192 packets and twelve wavelengths. The camera photon-mapper caps camera samples at 24 and uses 20,000 / 500,000 / 2,400,000 emitted photons respectively. A preset is an explicit compute budget, not a quality guarantee.

The original `gallery.py`, `prism.py`, and `tools/engine_gallery.py` builders are preserved. Texture images, OBJ geometry, and compiled native shaders are generated from their original source on the local machine. Nothing downloads a scene or inserts a rendered image into the renderer.

## Inverse fitting

```bash
python tools/inverse_geometry_example.py
python tools/validate_and_inverse.py
```

The first workflow is low-dimensional geometry fitting using finite-difference rerenders. The second preserves the original material-derivative example. These are synthetic same-renderer fitting examples, not demonstrated reconstruction from real photographs.

## Forward spectral photon detector

```bash
python examples/prism.py
./build/cybr-photons examples/11_prism_photon_detector.cys rendered/prism 3000000
```

This is a planar irradiance detector. For a camera-view surface-caustic scene use `python tools/examples.py caustics` instead.

## Optional portable backend

```bash
python -m pip install -e '.[portable]'
python tools/portable_validation.py --backend cpu
NUMBA_ENABLE_CUDASIM=1 python tools/portable_validation.py --backend cuda
```

CUDA simulation runs on the CPU. Physical CUDA compilation/execution and OptiX/RTX are not established by these commands. The portable adapter rejects features outside its supported subset rather than silently using the native renderer.

## Additional source-only tools

`tools/engine_gallery.py` renders the seven native integration recipes directly. `tools/render_gallery.py` preserves the original baseline gallery workflow. `tools/reproduce_delivery.py` expects frozen files from the historical complete archive; those bulky generated dumps are intentionally not tracked here. Use the procedural runner for a fresh clone.

README previews are native PNGs with the renderer's display transform only. JSON records beside them include dimensions, packet counts, wavelength counts, elapsed render time, and raw-film hashes. They are neither denoised nor image-generated.
