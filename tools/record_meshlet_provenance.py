"""Record scoped raster changes against the parent's confirmed clean public base."""
from pathlib import Path
import hashlib
import json
import sys

root = Path(__file__).resolve().parents[1]
original = Path(sys.argv[1]).resolve()
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
baseline = json.loads((root / 'docs/SOURCE_BASELINE.json').read_text())
assert digest(root / 'docs/SOURCE_BASELINE.json') == digest(original / 'docs/SOURCE_BASELINE.json')
protected = {item['path']: item['sha256'] for item in baseline['preserved_implementation']}
for name in ('browser/app.js', 'browser/renderer-shaders.mjs', 'browser/forest-loader.mjs',
             'browser/forest-detail.mjs', 'browser/instanced-bvh.mjs', 'browser/compact-bvh.mjs',
             'browser/meshlet-attributes.mjs', 'browser/pile-lod.mjs'):
    protected[name] = digest(original / name)
for name, expected in protected.items():
    assert digest(root / name) == expected, name
changed = ('browser/forest-game.mjs', 'browser/forest-raster-worker.mjs',
           'browser/meshlet-hierarchy.mjs', 'browser/forest-meshlet-cull.wgsl',
           'browser/meshlet-hierarchy.test.mjs', 'tools/measure_forest_meshlets.mjs',
           'browser/meshlet-gpu-proof.html', 'browser/meshlet-gpu-proof.mjs',
           'tools/record_meshlet_provenance.py', 'docs/MESHLET_RASTER_STAGE1.md')
record = {
    'base_public_commit': '8f82e06ccadbc77f017eb3d6baba269d3eef93db',
    'branch': 'feat/raster-meshlet-hierarchy',
    'scope': 'Resident forest raster clusters; opt-in; CPU validated; GPU acceptance pending',
    'source_baseline_sha256': digest(root / 'docs/SOURCE_BASELINE.json'),
    'original_source_baseline_sha256': digest(original / 'docs/SOURCE_BASELINE.json'),
    'original_digests_retained': True,
    'preserved_implementation': [{'path': name, 'sha256': sha} for name, sha in sorted(protected.items())],
    'raster_diff': [{'path': name,
                    'original_sha256': digest(original / name) if (original / name).exists() else None,
                    'current_sha256': digest(root / name)} for name in changed],
    'validation': {'browser_cpu_tests': 328, 'naga_optional_capabilities': 'none',
                   'gpu_used': False, 'browser_used': False,
                   'visual_holes_popping_acceptance': 'pending serialized slot',
                   'gpu_performance_acceptance': 'pending serialized slot'},
    'publication_owner': 'parent', 'worker_deployed': False, 'worker_pr_mutated': False,
}
output = root / 'docs/MESHLET_RASTER_PROVENANCE.json'
output.write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps({'provenance': str(output), 'preserved_digests': len(protected),
                  'source_baseline_unchanged': True, 'scoped_raster_files': len(changed)}))
