# Physical Adreno compile isolation

The current-trace check already reproduced device loss on physical Adreno after successful frontend validation and with zero GPU buffer allocations. The full renderer's explicit compact mode also failed. The browser/driver root cause remains unknown.

Run the comparison sequence from **Small compute control** once rather than following many links. The next missing distinction is the tiny/full-source unused-entrypoint controls. If either fails, preserve the report and stop. If both pass and current loses its device, a later explicit run can start at **Current trace, default device limits**. This keeps the trace bytes identical and changes only the device request. No later device is requested automatically after a failure.

| Evidence | Next compile-only distinction |
| --- | --- |
| Tiny fails | Basic device/pipeline startup is affected; full-trace complexity is not required. |
| Tiny passes, full-source control fails | Full module handling affects an otherwise empty entrypoint; active transport compilation is not yet isolated. |
| Both controls pass, current fails | Active trace compilation or its automatic layout remains implicated; compare identical source with default device limits. |
| Default-limit current also fails | Compare workgroup and medium-capacity shapes individually; compact already failed in the actual renderer. |
| Isolated current passes, original prefix fails | Investigate canvas/diagnostic/module preparation ordering separately from the trace source. |

The source-analysis tool confirms the FUSE C220 and proof-optics scene URLs generate identical current and compact trace bytes. Scene geometry is not loaded before this compilation. Adapter capacities and private-array ABI sizes are not measured memory allocations or register usage.

If controls narrow the problem to active trace compilation, the smallest further bisection is diagnostic entrypoints appended to the unchanged generated module. Each probe should write a value dependent on its uniform/storage inputs so the compiler cannot remove all work. Start with traversal/private BVH-stack and medium-stack helper probes, then deterministic guide transport, then nested branch/bounce transport. Compile only: create no scene buffers, bind groups, dispatches or rendered outputs. Keep the original functions and source hash in the report, give the appended probe its own hash, and stop on loss. These probes are a plan; they are not implemented renderer modes or evidence of a fix.

Equivalent full-renderer specializations or pipeline splitting should follow physical probe evidence, with matching transport outputs and all supported glass/water paths preserved. Do not omit geometry, reflection/refraction branches or material features to obtain a compile pass. Compile-only probes cannot establish full-renderer equivalence.

The report stays in this browser and is copyable. Diagnostic build, browser, adapter, exact shader hash and per-stage completion distinguish runs. Reduced Android user-agent strings cannot establish the actual Android version. CPU fixtures and desktop/mobile-layout tests are not physical Adreno validation.
