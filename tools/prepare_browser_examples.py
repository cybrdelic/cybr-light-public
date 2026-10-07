"""Reproduce native-authored browser geometry and retain captured material data.

The original exporter omits existing conductor Eta/K manifest annotations.
Preserve those checked-in manifests only after the generated geometry passes
the recorded decompressed SHA-256 contracts. No transport code is changed.
"""
from pathlib import Path
import gzip
import hashlib
import json
import os
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
inventory = json.loads((root / 'docs/PUBLICATION_INVENTORY.json').read_text())
contracts = {item['path']: item for item in inventory['files']}
names = ('example-materials', 'example-knot',
         'example-materials-source', 'example-knot-source')
manifests = {}
for name in names:
    path = f'browser/assets/{name}/manifest.json'
    data = (root / path).read_bytes()
    if hashlib.sha256(data).hexdigest() != contracts[path]['sha256']:
        raise RuntimeError('Preserved manifest changed: ' + path)
    manifest = json.loads(data)
    if manifest['sourceSha256'] != hashlib.sha256((root / 'examples/gallery.py').read_bytes()).hexdigest():
        raise RuntimeError('Native example source changed: ' + name)
    manifests[name] = data
environment = os.environ.copy()
environment['PYTHONPATH'] = str(root / 'python')
try:
    subprocess.run([sys.executable, str(root / 'browser/export_examples.py')],
                   cwd=root, env=environment, check=True)
    for name in names:
        path = f'browser/assets/{name}/instrument.bin.gz'
        contract = contracts[path]
        raw = gzip.decompress((root / path).read_bytes())
        if hashlib.sha256(raw).hexdigest() != contract['reproduction_decompressed_sha256']:
            raise RuntimeError('Generated geometry differs from preserved scene: ' + name)
        print('PASS:', name, 'geometry SHA-256 and preserved material manifest')
finally:
    # The exporter regenerates metadata; always restore the authored source data.
    for name, data in manifests.items():
        (root / f'browser/assets/{name}/manifest.json').write_bytes(data)
