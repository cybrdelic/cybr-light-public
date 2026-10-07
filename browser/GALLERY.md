# Exported model gallery

Open `?scene=example-gallery`, or select Every model in the main browser renderer. The existing gallery combines available example exports, instrument modules and a cached fluid surface. Overview and nearby-model geometry use separate LOD files; original-resolution inspection remains available where the source asset exists.

Machinery uses a shared scale; large environments are explicit miniatures. Studio lighting differs from isolated source-lit scenes. Water in the gallery is a static cached mesh; individual FLIP mode supports recorded-frame selection.

Rebuild with `python tools/build_browser_gallery.py` after preparing full-resolution scene exports and local instrument assets. NumPy, SciPy and `fast_simplification` are required. Optional model IDs rebuild selected entries in an existing gallery. The generator writes `assets/gallery-lod/` separately from original exports.

See [asset preparation](../docs/ASSETS.md) and [known issues](../docs/KNOWN_ISSUES.md). An absent export is an asset-availability limit; the gallery does not substitute prerecorded beauty imagery for geometry.
