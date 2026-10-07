# Deterministic meshlet acceptance sweep

The grouped geometry campaign is complete for 79 recorded poses: 17 valid stored-depth prefix captures plus 62 passing v3 continuation captures. All five authored views are covered; ordered CPU visual review is complete with the dark/occluded-frame limits described below. Baseline remains default. Production renderer source and its 90% demotion hysteresis are unchanged; `tools/meshlet_validation_server.py --acceptance` serves an isolated instrumented copy only. These acceptance captures are not performance measurements. Streaming remains deferred. Fine mode has no equivalent sweep and remains unsupported experimental research.

The real-forest CPU plan selects 167 transformed triangle probes and a promotion/demotion boundary from an admitted model in every authored view: Trail, Canopy, Under crowns, Clearing and Whole stand. Each view follows a recorded pan, outbound threshold brackets, a coarse hold, reverse brackets, a fine hold and a repeated base hold. History resets explicitly at the start of each segment; camera poses, applied float32 uniforms and previous/selected target levels are recorded.

For every pose, render the actual experimental cull, then freeze its selected per-instance LOD and render all clusters belonging to those complete model levels. This complete-model reference bypasses hierarchy rejection and retains the same root frustum, material shader, transforms, leaf masks, lighting and selected geometry. It controls for the baseline selector's different hysteresis; it is not a timing comparison with the normal baseline URL.

The harness checks:

- All 1,220,375 previous/selected LOD state words continue from the preceding capture. Visible populations are counted by model/level; sampled selectors and independent polygon clipping supply an additional root-culling check.
- Every reference draw contains exactly its root-visible model/level population. Normal draws stay within capacity. Every fallback count must exactly equal the CPU prediction using that selected level's conservative sphere, transformed and tested in shader-source order with binary32 rounding and the applied float32 camera uniforms; both overflow counters remain zero. A fallback's selected-LOD bounds can reject geometry even when its larger full-resolution instance sphere is visible. Count equality remains strict; no extra-instance tolerance is applied.
- The depth attachment is explicitly stored before compute readback. Every one of four MSAA depth samples matches coverage, and the reference must contain nonzero covered samples so an all-clear readback cannot pass vacuously. A missing sample, a closer reference surface, a spurious closer experimental surface or nonfinite depth fails geometry acceptance. Relative depth tolerance is `2^-20`; colors are compared exactly, with any difference requiring image review.
- Identical camera/detail holds must not change selected LODs. Every view must record both promotion and demotion, rather than merely taking a screenshot near a presumed threshold.
- Every ordered normal/reference PNG pair and temporal image-change metric is retained for post-release perceptual review. Geometry equality does not certify perceptual popping of the original discrete model LODs.

Full-detail checks are bounded to 600 million estimated submitted triangles per view. Whole-stand full detail would submit approximately 1.89 billion triangles and is explicitly excluded from the three-minute run. Whole stand still receives the complete default-detail transition sweep. No full-detail Whole-stand acceptance is claimed.

## Reproduction and bounds

```sh
node tools/prepare_forest_acceptance.mjs <original-forest-assets> output/meshlet-acceptance/cpu-plan-grouped.json 8
python tools/meshlet_validation_server.py --acceptance --export-policy --output output/meshlet-acceptance
```

These commands use CPU only and never start a browser, server or GPU. The preparation command exercises the unchanged forest loader with three local file-backed Response mocks, retaining its source hash validation and authored camera definitions. Node tests detect injected single-sample holes, stale state, reference omissions, fallback omissions and capacity overflow. Naga validates the reset, four-sample depth capture and instrumented cull shaders without optional capabilities.

For an authorized native reproduction, run a fresh v3 server without `--export-policy` and execute `tools/meshlet-acceptance.browser.js` using the existing sandboxed, pre-spawn-allowlisted native harness. The checked-in callback retains the exact successful continuation configuration: grouped mode starts at case 17, Canopy/start's explicit history reset. It replays nine preceding cases, the failed case 26, and the 52 formerly unrun cases: 62 pairs. Starting directly at 26 loses its hysteresis history and is rejected. For a fresh campaign without archived prefix evidence, explicitly set `resumeIndex=0` in a copy of the callback and record its new hash; a case-17 run alone does not certify cases 0..16. Fine mode starts at zero but is not required or represented as accepted by this grouped handoff. Any continuation summary certifies only its remaining cases. The run allows 150 seconds internally, at most 80 pairs, and requires a 180-second outer launcher including resource cleanup. Incomplete cases, absent threshold coverage or any assertion failure cannot pass. Preserve the release receipt and end the GPU turn before media/report packaging.

The successful native v3 continuation passed 62/62 pairs in 66.445 seconds. Chrome 145.0.7632.160 used NVIDIA Lovelace. Browser, daemon and server release was confirmed at `2026-10-07T21:47:24.3814427Z`; the outer launcher lasted 70.034 seconds. No unsafe launch flags were used. The [reconciled ledger](MESHLET_RASTER_GROUPED_ACCEPTANCE.json) audits the exact 0..16 prefix plus 17..78 continuation, matching manifest poses/probes and capture helper hashes. Prefix count/history evidence is checked against the v3 CPU proof. Every decoded normal/reference RGBA pair matches exactly, and all temporal metrics reproduce from the saved PNGs.

Exact combined coverage is 40,953,600 color pixels and 163,814,400 recorded MSAA depth-sample comparisons at relative tolerance `2^-20`, 167 transformed triangle probes, five target promotion/demotion cycles and 15 stable hold pairs. This does not double-count the failed replay's overlapping cases 17..26. The four full-detail views are included; Whole stand full detail remains excluded. Raw depth buffers were not separately archived for CPU re-comparison; depth coverage comes from stored native readback receipts.

CPU-only reconciliation reproduces the public ledger and contact sheets without touching the preserved originals:

```sh
python tools/reconcile_meshlet_acceptance.py --prefix <stored-depth-replay-v2-directory> --continuation <binary32-continuation-v3-directory> --invalid-depth <initial-discard-depth-directory> --cpu-proof docs/MESHLET_RASTER_FLOAT32_PROOF.json --docs docs --boundary-output output/meshlet-acceptance/visual-review
```

[Ordered visual review](MESHLET_RASTER_VISUAL_REVIEW.md) covers all five contact sheets and full-resolution threshold/hold sheets. Under-crowns cases 38..43 are nearly black (all RGB channels at most 5/255), exactly shared by the reference, with all depth samples covered. Clearing also contains large foreground occluders. The cause of the dark route is unconfirmed; geometry equality does not make these poses perceptually suitable or prove the default baseline shares them. No continuous no-popping acceptance is claimed. Both paired renders share selected LOD, and the original model levels switch without blending.

## Captured fallback-count failure, CPU reproduction

The first native acceptance attempt stopped at Trail/start (case 1) after 18 fallback draw-count mismatches. The captured normal/reference colors matched exactly; the previous count oracle had required each fallback's selected-LOD count to equal its larger root-sphere reference population. Its depth evidence is invalid for the separate readback reason below.

`tools/reproduce_fallback_acceptance.mjs` reproduced the captured state hash across all 1,220,375 instance words, both triangle totals (39,060,110 normal and 39,442,613 reference), and all 738 rejected hierarchy nodes. The 18 draws exclude 20 instances. Every referenced vertex is contained by its selected-LOD sphere, every excluded instance lies beyond a common clipping plane, and independent polygon clipping of all 611 excluded triangles finds zero intersections. This demonstrates an incorrect count assumption; production renderer code is unchanged.

The corrected oracle requires exact predicted counts rather than allowing fewer draws. A regression uses the captured crown-0/LOD3 instance 1036 and exact camera: its full root is visible while its selected-LOD bounds are outside. Moving that instance into view makes an omitted draw fail again. The reproduction also checks every fallback draw against the CPU hierarchy traversal. It is CPU evidence for the recorded failure, not a completed GPU continuation or perceptual acceptance claim.

```sh
node tools/reproduce_fallback_acceptance.mjs <original-forest-assets> <captured-grouped-acceptance-001.json> output/meshlet-acceptance/fallback-proof.json
```

## Depth readback correction and withdrawn receipt

CPU source inspection also found a validation-only defect: the capture pass used `depthStoreOp: 'discard'` before the following compute pass read the depth texture. The [WebGPU store-operation definition](https://www.w3.org/TR/2022/WD-webgpu-20221004/#enumdef-gpustoreop) requires `store` to retain attachment contents for this use. Consequently the previous depth comparisons, including case 0, cannot certify coverage. Their state, count and color captures remain useful independent evidence.

The harness now stores depth and reports both normal/reference covered-sample counts. All-clear depth fails acceptance. A regression guards the store/readback contract and injected all-clear evidence. No production renderer source changed. The subsequent stored-depth replay stopped at case 26 as described below. Its 0..16 prefix is retained after v3 CPU count auditing; the successful v3 continuation starts at 17 and does not relabel the original failed receipt.

## Pair 26: binary32 boundary reproduction

The stored-depth replay attempted 27 pairs: 26 passed, then Canopy/return-band failed strict count equality at draw 2605 (model 457, `litter-1`, LOD 3): 8,246 actual instances versus 8,245 under the float64 oracle. Every captured color and stored-depth comparison remained exact, with nonzero reference coverage. The native receipt remains failed; CPU diagnosis does not replace it with a pass.

The differing instance is 368645. Its horizontal float64 margin is `-9.761732897572983e-7`. In shader-source-order binary32 arithmetic, camera-relative x rounds from `-34.56201648712158` to `-34.562015533447266`, and the horizontal bound rounds to `34.562015533447266`. The compared values are exactly equal, so the shader's strict outside comparison retains it. Its eight transformed vertices lie beyond the same clipping plane by at least 0.03396476; independent clipping of all six triangles finds zero intersections, using both exact transforms and binary32 transforms. They remain enclosed by the conservative selected-level sphere. This is an extra conservative draw, not an unsafe omission.

`tools/reproduce_float32_acceptance.mjs` reconstructs every saved state hash for cases 0..26 (1,220,375 words each). The v3 binary32 oracle also matches all 48,924 reconstructed native fallback counts: 1,812 per capture. Actual fallback counts are reconstructed from the verified root/model/LOD populations and the runtime's exhaustive difference rows; the full native draw buffer was not separately saved. No count allowance or expanded epsilon is introduced. A specific regression retains exact tangency, rejects one horizontal-plane ULP outside, and still fails an omitted visible instance.

[WGSL permits reassociation and fusion](https://www.w3.org/TR/2026/CRD-WGSL-20260703/#floating-point-reassociation). Source-order nearest-binary32 emulation is verified against these captured adapter counts; it does not assert bit identity for every implementation. A new mismatch on another arithmetic path still fails and requires investigation.

```sh
node tools/reproduce_float32_acceptance.mjs <original-forest-assets> <meshlet-acceptance-replay-v2-directory> output/meshlet-acceptance/pair-026-float32-proof-v3.json
```

The [fallback proof](MESHLET_RASTER_FALLBACK_PROOF.json), [binary32 proof](MESHLET_RASTER_FLOAT32_PROOF.json) and combined ledger retain the failed native count receipts and their diagnoses. Remaining limits are continuous/intermediate-frame perception, unconfirmed dark-route cause, other adapters, fine-mode equivalence and full-detail Whole stand. Fine is explicitly unsupported; no additional GPU work was used for this final CPU review. Review, merge and any deployment remain separate owner actions.
