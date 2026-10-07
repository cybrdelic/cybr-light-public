"""Check preserved current renderer source and required standalone contracts."""
from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parents[1]
record = json.loads((root / 'docs/SOURCE_BASELINE.json').read_text())
for item in record['preserved_implementation']:
    path = root / item['path']
    if hashlib.sha256(path.read_bytes()).hexdigest() != item['sha256']:
        raise RuntimeError('Preserved implementation digest changed: ' + item['path'])
for name in ('browser/index.html', 'browser/app.js', 'browser/forest-game.html',
             'browser/forest-game.mjs', 'browser/experimental-signals/signals.wgsl',
             'browser/vendor/meshoptimizer-1.3.0/LICENSE.md',
             'LICENSES/CYBR_LIGHT_ORIGINAL_MIT.txt'):
    if not (root / name).is_file():
        raise RuntimeError('Required source/notice missing: ' + name)
license_text = (root / 'LICENSE').read_text()
if 'GNU GENERAL PUBLIC LICENSE' not in license_text or 'Version 2, June 1991' not in license_text:
    raise RuntimeError('Existing GPLv2 license was not preserved')
for name in ('node_modules', '.publish', 'browser/experiments'):
    if (root / name).exists():
        raise RuntimeError('Generated/import/archive content in source tree: ' + name)
print(f'PASS: {len(record["preserved_implementation"])} current renderer digests; native/browser entrypoints and notices')
