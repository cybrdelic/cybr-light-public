# Algorithms, provenance, and third-party dependencies

CYBR LIGHT implements established light-transport and optical models in project-owned code. The references below describe the underlying algorithms and datasets.

Primary technical references consulted:

- Pharr, Jakob, Humphreys, *Physically Based Rendering*, fourth edition:
  https://pbr-book.org/4ed/Light_Transport_I_Surface_Reflection/A_Better_Path_Tracer
  (path-space sampling and multiple importance sampling).
- Same book, volume scattering:
  https://pbr-book.org/4ed/Light_Transport_II_Volume_Rendering/Volume_Scattering_Integrators
  (free flight, null collisions, spectral and directional sampling).
- Same book, rough dielectric transport:
  https://pbr-book.org/4ed/Reflection_Models/Rough_Dielectric_BSDF
  (microfacet transmission, Jacobians and transport-mode eta scaling).
- The default analytic color-matching fit uses the commonly published
  asymmetric-Gaussian CIE 1931 approximation of Wyman, Sloan and Shirley,
  *Simple Analytic Approximations to the CIE XYZ Color Matching Functions*,
  Journal of Computer Graphics Techniques, 2013. This is an approximation,
  not a claim to have loaded the official CIE dataset.
- An optional official observer-table loader is provided. The authoritative
  dataset citation is CIE 2019, *Colour-matching functions of CIE 1931 standard
  colorimetric observer*, DOI 10.25039/CIE.DS.xvudnb9b:
  https://cie.co.at/datatable/cie-1931-colour-matching-functions-2-degree-observer
  The dataset itself is CC BY-SA 4.0 and is NOT bundled in this delivery.
  The demo outputs use the analytic fit, as recorded in their JSON reports.

## Dependency boundaries

Native rendering and C++ tests: C++17 standard library; optional OpenMP runtime.
Python scene authoring/packaging: NumPy and Pillow.
Tensor/JIT/reverse-mode example: PyTorch. PyTorch supplies its compiler and AD
engine. Physical CUDA execution is not verified by the archived CPU results.
Optional EXR conversion: OpenCV, using its OpenEXR image codec.

The repository retains its existing root GPLv2 license and the original native
engine MIT notice in `LICENSES/CYBR_LIGHT_ORIGINAL_MIT.txt`. The vendored browser
meshoptimizer code retains its own MIT notice. Optional dependencies and SDKs
retain their own licenses; this consolidation does not relicense them.

Historical native previews use procedural project scenes and system-font labels.
Font files are not distributed. Browser geometry exports and cached simulation
assets are separate from those native previews; their original authoring inputs
and redistribution provenance must accompany any separately published asset pack.
See `ASSETS.md` for local recovery and reproduction limits.
