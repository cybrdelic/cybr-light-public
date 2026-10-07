# Physical Adreno medium operation form

Physical Chrome 154 on Qualcomm / Adreno-8xx passed the tiny and unused full-source controls, then failed current trace pipeline creation. Version 8 further passed an empty 8x8 entrypoint, all original bindings and the original 64-entry BVH traversal. Its original sixteen-slot medium probe lost the device about 766 ms after pipeline creation was requested. Frontend validation completed without messages; every case allocated zero GPU buffer bytes and nothing was dispatched. The phone was visible, unembedded and reported no lifecycle events.

This narrows the failure to reachable medium work. It does not establish pointer passing, aggregate copies, dynamic indices, loops or the browser/driver as the precise cause.

## Automatic scalar medium operation form

Normal startup selects `mediumStack=scalar` when the adapter vendor/architecture identifies Qualcomm or Adreno. Other adapters retain the original form. `mediumStack=legacy` is an explicit rollback; the earlier `mediumStack=inline` form remains available. The local renderer snapshot records the selection reason, sixteen-slot capacity and `physicalAdrenoVerified: false`. No manual diagnostic sequence is required for startup.

The earlier inline form still used dynamically indexed private arrays. Version 9 was deployed and the user reported the same mobile startup error. The exact shader selection/cache state on that phone was not independently retrieved; stale cache is not an established cause, and version 9 is not a verified phone fix.

The scalar form replaces each private MediumStack aggregate with one count, sixteen individually named boundary-key locals and sixteen individually named vec4f absorption/IOR locals. Lookup, push and ascending exit compaction are fully unrolled. Camera initialization uses constant storage indices; its storage ABI is unchanged. There are no medium pointer helpers or dynamically indexed private medium arrays. All sixteen slots, zero/trailing values, last-match boundary lookup, non-top/unmatched exits and exact two-word instance keys are preserved. Transport, Fresnel, absorption, random streams, branch/guides and reconstruction arithmetic are retained. Changed helper contracts fail explicitly. This changes the compiler representation; it does not establish the precise phone driver cause.

The exact 50,682-byte scalar trace (`49cc7c138f6ea80a3e049429636b2956a329d8ea9dbf8963921a519d0bd22867`) passed pipeline compilation on real NVIDIA/Lovelace. Actual scalar/vector state fixtures compared 1,024 operations and 103,424 GPU words with zero differences. Eight-frame 960x540 glass/water rendering matched original raw, temporal and final output exactly at six and ten bounces. CPU tests prove the integrated builder emits those same tested bytes and verify normal adapter selection/rollback. The prior lifecycle/loss-retry checks remain historical evidence for the unchanged host; this scalar validation did not rerun them.

The accepted browser run retained Chromium sandboxing, checked an allowlist before spawn and verified actual command-line arguments. It used no unsafe WebGPU/software fallback or security-disabling switches. NVIDIA adapter identity was reported; the Dawn backend table was empty, so D3D12 is an inference from Chromium's normal Windows launch. The supported SwiftShader selector returned no WebGPU adapter and that path stopped; no Vulkan pipeline result is claimed. All owned resources were closed in 30.6 seconds. No physical Android device/emulator/testing-service session was available. The scalar candidate has not passed a physical Adreno retest and must remain unverified.

CPU fixtures execute the actual original WGSL bodies and generated snippets, cover 8,192 adversarial operations, all sixteen slots, both key types and inside/outside camera initialization at every count from zero through sixteen. Naga 30.0.1 validates thirteen exact modules with all flags and no optional capabilities. [The current receipt](SCALAR_MEDIUM_VALIDATION.json) preserves hashes, limits and reproducible commands. [The inline receipt](MEDIUM_STACK_VALIDATION.json) preserves the previous candidate's distinct evidence.

## Reproduce CPU checks

Node 22+ exports the actual integrated renderer and preserved original/inline controls. The standalone MIT wrapper needs Rust 1.87+ and a platform linker; its pinned Naga dependency uses the MIT license option. Compiler binaries, dependency caches and generated WGSL remain outside source.

```sh
node browser/medium-stack-scalar.test.mjs
node browser/medium-stack-policy.test.mjs
node tools/export_scalar_medium.mjs
cargo build --release --locked --jobs 2 --manifest-path tools/wgsl-validator/Cargo.toml
tools/wgsl-validator/target/release/cybr-wgsl-validate build/wgsl-scalar-medium
```

On Windows the validator ends in `.exe`. Existing `export_medium_candidate.mjs` and `export_trace_probes.mjs` preserve the earlier inline and original compile-probe receipts. These CPU workflows do not create a browser or use a GPU. An additional local Naga backend-writer build was blocked by denied Rust compiler execution (OS error 5); no alternative route was attempted and no GLES/SPIR-V/IR result is claimed.
