"""Check source-clone imports and the explicit companion-asset inventory.

This does not claim to validate WebGPU execution or omitted scene assets.
"""
from pathlib import Path
import hashlib
import json
import re

root = Path(__file__).resolve().parents[1]
inventory = json.loads((root / 'docs/PUBLICATION_INVENTORY.json').read_text())
for item in inventory['files']:
    if item['disposition'] != 'included':
        continue
    path = root / item['path']
    if not path.is_file():
        raise RuntimeError('Missing published file: ' + item['path'])
    if item['preserved_bytes'] and hashlib.sha256(path.read_bytes()).hexdigest() != item['sha256']:
        raise RuntimeError('Published bytes changed: ' + item['path'])

relative_import = re.compile(
    r'''(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'](\.{1,2}/[^"']+)["']'''
)
checked = 0
for path in sorted((root / 'browser').rglob('*')):
    if path.suffix not in ('.js', '.mjs') or path.name.endswith('.test.mjs'):
        continue
    for target in relative_import.findall(path.read_text(encoding='utf-8')):
        # Computed import prefixes are checked by the retained CPU/source suite.
        target = target.split('?')[0].split('#')[0]
        if target.endswith('/'):
            continue
        resolved = (path.parent / target).resolve()
        if not resolved.is_relative_to(root) or not resolved.is_file():
            raise RuntimeError(f'Missing browser source import: {path.relative_to(root)} -> {target}')
        checked += 1
print(f'PASS: {checked} relative browser imports; included capture files and explicit omission inventory')
print('Companion scenes remain unavailable without the inventoried assets; see docs/ASSETS.md.')
