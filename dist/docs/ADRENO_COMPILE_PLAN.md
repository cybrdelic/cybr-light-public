# Physical Adreno medium candidate

Physical Chrome 154 on Qualcomm / Adreno-8xx passed the tiny and unused full-source controls, then failed current trace pipeline creation. Version 8 further passed an empty 8x8 entrypoint, all original bindings and the original 64-entry BVH traversal. Its original sixteen-slot medium probe lost the device about 766 ms after pipeline creation was requested. Frontend validation completed without messages; every case allocated zero GPU buffer bytes and nothing was dispatched. The phone was visible, unembedded and reported no lifecycle events.

This narrows the failure to reachable medium work. It does not establish pointer passing, aggregate copies, dynamic indices, loops or the browser/driver as the precise cause.

## Next physical comparison

Run `candidateSequence=1&run=1` once. It tries the equivalent inline medium probe, then the full current trace with the same transformation. Each case gets a fresh device and retains all stop, cancellation, 40-second deadline and browser-local Copy/Clear/checkpoint behavior. It stops at the first failure. The already failing original medium and current cases remain selectable but are not part of this next automatic sequence.

The transformation expands the original lookup and enter/exit operations at their call sites. It retains two sixteen-slot local stacks, exact boundary identities, last-match lookup, non-top compaction, absorption, IOR, reflection/refraction branches, random streams and other transport operations. Ordinary, separate-signal, instanced, packed, corrected and outside paths keep their original capacities. Changed helper contracts fail explicitly. The default renderer stays unchanged; `mediumStack=inline` opts in and removing it rolls back.

If both candidate pipelines pass, open the actual candidate renderer from the page and copy `window.cybrLight.snapshot().gpuSession` through the available diagnostics. Full trace compilation is not rendered-output validation. A medium pass followed by a full-trace failure would isolate additional reachable transport work; a medium failure means this equivalent form did not avoid the failing backend path.

## Reproduce CPU checks

Node 22+ exports the exact candidate and renderer-mode modules. The standalone MIT wrapper needs Rust 1.87+ and a platform linker; its pinned Naga dependency uses the MIT license option. No compiler binary, dependency cache or generated WGSL is published.

```sh
node tools/export_medium_candidate.mjs
node browser/medium-stack-inline.test.mjs
cargo build --release --locked --jobs 2 --manifest-path tools/wgsl-validator/Cargo.toml
tools/wgsl-validator/target/release/cybr-wgsl-validate build/wgsl-medium-candidate
```

On Windows the executable ends in `.exe`. [The receipt](MEDIUM_STACK_VALIDATION.json) pins thirteen all-flags parse/type-validated modules with no optional capabilities. CPU fixtures execute the actual original helper bodies and expanded snippets, compare every count/slot/output, and cover nested glass/water, all sixteen slots, duplicate/unmatched/non-top exits, two-word instance identities and 8,192 adversarial operations. CPU validation does not establish Adreno machine-code compilation or rendered parity.

The original probe exporter and `TRACE_PROBE_VALIDATION.json` remain reproducible evidence for the original four-probe sequence. No local GPU or browser is needed for either CPU workflow. Physical candidate results remain pending.
