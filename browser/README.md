# Browser rendering modes

Serve the repository with `python -m http.server 4181 --bind 127.0.0.1`, then open `/browser/?scene=proof-optics` in a WebGPU browser. No frontend build, CDN or companion asset pack is required for the three built-in `proof-*` scenes. The unparameterized page defaults to an omitted companion scene; use the explicit proof URL in a fresh clone.

| Entry | Mode |
| --- | --- |
| `/?scene=proof-optics&resolution=540&bounces=6` | Procedural optical proof scene; current main RGB path tracer |
| `/?scene=example-geo-printer` | Imported geometry with the main path tracer |
| `/?scene=all` | Combined instrument modules |
| `/?scene=elements&fluidFrame=36` or `/?scene=flip&fluidFrame=71` | Selected cached FLIP surface frame |
| `/?scene=example-gallery` | Every available exported model, with near/overview detail |
| `/?scene=forest` | Forest path-traced reference |
| `/forest-game.html` | Forest rasterization, cached sun shadows, approximate sky lighting |
| `/hybrid-lab.html` | Experimental hybrid visibility/lighting lab |
| `/?signals=separate` | Separate experimental frontend; retain its shader directory |

Native spectral transport, browser RGB path tracing and the forest raster prototype are distinct implementations. Read [known issues](../docs/KNOWN_ISSUES.md) for current quality limits and recorded measurements.

## Controls and checks

Use the scene selector, Fit view, orbit controls, resolution, bounce count, filtering and mode controls. Free-flight controls use pointer lock; Escape releases it. Forest view/detail selectors select fixed camera presets and simplification thresholds.

`mode=reference` bypasses reconstruction; `samples=128` caps a repeatable stationary run. `reconstruction=baseline` selects the earlier presentation path; the normal main path uses single-signal coverage. Explicit experimental parameters preserve their selected architecture.

`window.cybrLight` exposes `snapshot()`, `waitIdle()`, `pause()`, `resume()`, `setCamera()`, `setScene()`, `setResolution()` and bounded `verifySteps()` for matched checks. Check actual readiness, errors, adapter, camera and timings. `window.forestGame` exposes `snapshot()`, `setView()`, `setCamera()`, `setLodPixels()` and `inspectDraws()`.

`verify-reference.js` creates a separate page for an independent reference capture; `verify-recomposition.js` checks signal composition; `verify-performance.js` samples runtime timings. These are Playwright CLI function-expression inputs. Use a dedicated coordinated GPU session; restore or close the test page afterwards.

## Assets

Imported geometry is under `assets/`; combined instrument modules use `assets/instrument-cartridges-c/`, and cached fluid frames use adjacent `assets/instrument-fluid/`. Main, separated and gallery-builder paths now use these repository-local files. [Asset preparation](../docs/ASSETS.md) describes recovery/import and reproduction limits.

The publication branch omits that companion asset tree. The imported models, gallery/pile, combined instruments, cached FLIP and both forest modes in the table therefore cannot run from a fresh source clone. Native-authored material/knot browser studies can be exported from source. Full scene distribution remains blocked; no public download is supplied. The hybrid and separated frontends retain their source but were not included in the hardware acceptance pass.

Node tests cover CPU geometry and shader construction, not final appearance. Validate supported scene/mode changes, asset fetching, shader compilation, stationary/moving pixels and controls in a real browser before accepting renderer changes.
