# Physical Adreno compile isolation

The current-trace check already reproduced device loss on physical Adreno after successful frontend validation and with zero GPU buffer allocations. The full renderer's explicit compact mode also failed. The browser/driver root cause remains unknown.

The physical version-7 sequence passed **Small compute control** and the **full-source unused entrypoint**, then failed at **Current trace** and stopped. Those controls no longer need to precede the new probes. A later explicitly selected **Current trace, default device limits** comparison remains available to change only the device request. The next automatic probe sequence instead runs an empty 8x8 control, binding ABI, traversal and medium helpers, without requesting current main. This keeps the trace bytes identical and changes only the device request. No later device is requested automatically after a failure.

| Evidence | Next compile-only distinction |
| --- | --- |
| Tiny fails | Basic device/pipeline startup is affected; full-trace complexity is not required. |
| Tiny passes, full-source control fails | Full module handling affects an otherwise empty entrypoint; active transport compilation is not yet isolated. |
| Both controls pass, current fails | Active trace compilation or its automatic layout remains implicated; compare identical source with default device limits. |
| Default-limit current also fails | Compare workgroup and medium-capacity shapes individually; compact already failed in the actual renderer. |
| Isolated current passes, original prefix fails | Investigate canvas/diagnostic/module preparation ordering separately from the trace source. |

The source-analysis tool confirms the FUSE C220 and proof-optics scene URLs generate identical current and compact trace bytes. Scene geometry is not loaded before this compilation. Adapter capacities and private-array ABI sizes are not measured memory allocations or register usage.

If controls narrow the problem to active trace compilation, the smallest further bisection is diagnostic entrypoints appended to the unchanged generated module. Each probe should write a value dependent on its uniform/storage inputs so the compiler cannot remove all work. Start with traversal/private BVH-stack and medium-stack helper probes, then deterministic guide transport, then nested branch/bounce transport. Compile only: create no scene buffers, bind groups, dispatches or rendered outputs. Keep the original functions and source hash in the report, give the appended probe its own hash, and stop on loss. The empty 8x8 control, binding ABI, traversal and medium probes are now implemented as compile-only diagnostics and CPU type-validated. Guide and branch/bounce probes remain a later plan. None is a renderer mode or evidence of a fix.

Equivalent full-renderer specializations or pipeline splitting should follow physical probe evidence, with matching transport outputs and all supported glass/water paths preserved. Do not omit geometry, reflection/refraction branches or material features to obtain a compile pass. Compile-only probes cannot establish full-renderer equivalence.

The report stays in this browser and is copyable. Diagnostic build, browser, adapter, exact shader hash and per-stage completion distinguish runs. Reduced Android user-agent strings cannot establish the actual Android version. CPU fixtures and desktop/mobile-layout tests are not physical Adreno validation.

## Reproduce CPU validation

Node 22+ exports the exact baseline and appended probe modules. The standalone validator wrapper is MIT licensed and needs Rust 1.87+ and the platform linker. Its pinned Naga dependency is used under its MIT license option; no compiler binary or dependency cache is published. Existing renderer licenses are unchanged.

```sh
node tools/export_trace_probes.mjs
cargo build --release --locked --jobs 2 --manifest-path tools/wgsl-validator/Cargo.toml
tools/wgsl-validator/target/release/cybr-wgsl-validate build/wgsl-probes
```

On Windows the validator executable ends in `.exe`. The directory argument reads only its immediate WGSL files. Exported files and Cargo build outputs are ignored by source publication. The validator parses and type-checks the whole module, including the retained original main, without initializing a GPU or generating GPU machine code. The browser selects only the appended entrypoint in the probe sequence.
