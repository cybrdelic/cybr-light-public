"""Restore exact public runtime assets from pinned inputs, without a GPU."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
from urllib.parse import quote
from urllib.request import urlopen

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--local-input-dir', type=Path, help='Optional local mirror of the pinned public asset directory')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'docs/LIVE_ASSET_INPUTS.json').read_text())
destination = root / 'dist/browser/assets'
destination.mkdir(parents=True, exist_ok=True)

def signature(path):
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for data in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(data)
    return path.stat().st_size, digest.hexdigest()

for record in manifest['files']:
    relative = Path(record['path'])
    target = (destination / relative).resolve()
    if not target.is_relative_to(destination.resolve()):
        raise RuntimeError('Asset path escapes its directory')
    expected = record['bytes'], record['sha256']
    if target.is_file() and signature(target) == expected:
        continue
    target.parent.mkdir(parents=True, exist_ok=True)
    pending = target.with_name(target.name + '.restoring')
    if args.local_input_dir:
        shutil.copyfile(args.local_input_dir / relative, pending)
    else:
        with urlopen(manifest['base_url'] + quote(record['path'], safe='/'), timeout=90) as response, pending.open('wb') as handle:
            shutil.copyfileobj(response, handle, length=1024 * 1024)
    if signature(pending) != expected:
        raise RuntimeError('Asset content differs from pinned public input: ' + record['path'])
    pending.replace(target)
print('PASS:', len(manifest['files']), 'runtime files restored from pinned public inputs')
