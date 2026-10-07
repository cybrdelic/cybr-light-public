"""Verify packaged large assets without a browser or GPU."""
from pathlib import Path
import hashlib, json
root = Path(__file__).resolve().parents[1] / 'dist'
browser = root / 'browser'
parts = json.loads((browser / 'asset-parts.json').read_text())
for name, record in parts.items():
    digest = hashlib.sha256()
    total = 0
    for item in record['parts']:
        data = (browser / item['path']).read_bytes()
        if len(data) != item['bytes'] or hashlib.sha256(data).hexdigest() != item['sha256']:
            raise RuntimeError('Asset part differs: ' + item['path'])
        total += len(data)
        digest.update(data)
    if total != record['bytes'] or digest.hexdigest() != record['sha256']:
        raise RuntimeError('Original asset stream differs: ' + name)
for path in root.rglob('*'):
    if path.is_file() and path.stat().st_size > 25 * 1024 * 1024:
        raise RuntimeError('Hosting file too large: ' + str(path))
for name in ('example-observatory', 'example-scene-observatory-full', 'example-scene-drowned-geode'):
    if (browser / 'assets' / name).exists():
        raise RuntimeError('Uncleared source included: ' + name)
print('PASS:', len(parts), 'exact original large-asset streams; all files below 25 MiB; blocked families absent')
