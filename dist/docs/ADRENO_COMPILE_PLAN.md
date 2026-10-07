# Physical Adreno medium operation form

Physical Chrome 154 on Qualcomm / Adreno-8xx passed the tiny and unused full-source controls, then failed current trace pipeline creation. Version 8 further passed an empty 8x8 entrypoint, all original bindings and the original 64-entry BVH traversal. Its original sixteen-slot medium probe lost the device about 766 ms after pipeline creation was requested. Frontend validation completed without messages; every case allocated zero GPU buffer bytes and nothing was dispatched. The phone was visible, unembedded and reported no lifecycle events.

This narrows the failure to reachable medium work. It does not establish pointer passing, aggregate copies, dynamic indices, loops or the browser/driver as the precise cause.

## Automatic startup and owned validation

Qualcomm/Adreno adapters select `mediumStack=inline` automatically. Other adapters keep the original form; `mediumStack=legacy` is an explicit rollback. A manual diagnostic sequence is not required.

The transformation expands lookup and enter/exit operations at each call site and removes unused pointer helpers. Stack storage remains count, sixteen IDs and sixteen absorption/IOR vectors. Capacities, boundary identities, last-match lookup, non-top compaction, random streams and all other transport operations are retained.

Real NVIDIA differential fixtures matched 1,024 operations and 103,424 words exactly. Full eight-frame glass/water output at 960x540 matched original raw, temporal and final hashes at six and ten bounces. A metadata fixture checked automatic selection and rollback on NVIDIA hardware; real loss/retry preserved settings, automatic selection and all three output hashes.

Physical Adreno success remains unverified because no authorized attached device or testing-service session was available. [The receipt](MEDIUM_STACK_VALIDATION.json) distinguishes hardware execution from the policy fixture and preserves the earlier timeout limitation. Existing bounded comparison controls remain maintainer diagnostics.

## Reproduce CPU checks

Node 22+ exports the exact candidate and renderer-mode modules. The standalone MIT wrapper needs Rust 1.87+ and a platform linker; its pinned Naga dependency uses the MIT license option. No compiler binary, dependency cache or generated WGSL is published.

```sh
node tools/export_medium_candidate.mjs
node browser/medium-stack-inline.test.mjs
cargo build --release --locked --jobs 2 --manifest-path tools/wgsl-validator/Cargo.toml
tools/wgsl-validator/target/release/cybr-wgsl-validate build/wgsl-medium-candidate
```

On Windows the executable ends in `.exe`. [The receipt](MEDIUM_STACK_VALIDATION.json) pins thirteen all-flags parse/type-validated modules with no optional capabilities. CPU fixtures execute the actual original helper bodies and expanded snippets, compare every count/slot/output, and cover nested glass/water, all sixteen slots, duplicate/unmatched/non-top exits, two-word instance identities and 8,192 adversarial operations. CPU validation does not establish Adreno machine-code compilation or rendered parity.

The original probe exporter and `TRACE_PROBE_VALIDATION.json` remain reproducible evidence for the original four-probe sequence. No local GPU or browser is needed for either CPU workflow. Physical Adreno validation remains unavailable; desktop validation is recorded separately.
