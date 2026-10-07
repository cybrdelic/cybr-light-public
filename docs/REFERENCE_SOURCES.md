# Technical reference sources

Implementation notes for scene and volume interchange, plus external references for file layouts and backend validation.

- VOL v3 container: a 48-byte little-endian header followed by X-fastest sample data. [The reader](../python/cybrlight/volume_io.py) validates encoding, dimensions, channels, bounds, exact file length, and finite data.
- Scene depth convention: [the XML/dictionary adapter](../python/cybrlight/workflow.py) translates a visible-emitter depth of 1 to zero native scattering events. Only the declared scene vocabulary is accepted.
- OpenEXR file layout: https://openexr.com/en/latest/OpenEXRFileLayout.html . The native writer implements the uncompressed single-part float32 scanline subset. The saved image was independently decoded through OpenCV/OpenEXR and compared with the native PFM pixels.
- Numba CUDA simulator limits: https://numba.readthedocs.io/en/stable/cuda/simulator.html . Simulator execution does not infer/type-check device code and must not be presented as physical GPU validation.

The default observer is still the original analytic approximation, not a newly downloaded CIE standard table. No measured-material or calibrated-observer dataset was fabricated or silently bundled.
