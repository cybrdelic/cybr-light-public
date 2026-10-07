# Runtime diagnostics

The Debug/profiler panel displays the current radiance, geometry guides, history, variance and timing counters. Normal startup uses beauty rendering with detailed profiling off. Pause before explicit buffer readbacks for stable measurements.

`cybrLight.snapshot()` records settings, camera, adapter, errors and timings. `inspectOutput()`, `inspectTraversal()`, `inspectReuse()`, `inspectRejection()` and `inspectVisibility()` require the relevant current mode/profiling flags. Consult their errors and snapshot flags instead of assuming a counter is enabled.

Detailed profiling adds GPU work. Trace time excludes reconstruction and presentation; submitted FPS is not an independently measured display rate. Compare identical scenes/cameras/settings after warm-up, with beauty selected and other GPU jobs paused through coordination.

Reference mode and denoise-off are separate validation paths. Raw/history images and actual moving captures help distinguish existing grain, blur and ghosting; numerical finiteness alone does not establish visual quality. See [current known issues](../docs/KNOWN_ISSUES.md).

Large noise captures and exported diagnostic JSON are generated data. Keep them outside the source tree or in ignored output directories.
