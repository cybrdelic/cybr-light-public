"""Check every shipped asset, source ZIP and preserved renderer file, CPU only."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
client = root / 'out'
inputs = json.loads((root / 'docs/LIVE_ASSET_INPUTS.json').read_text())
mapping = json.loads((client / 'browser/asset-parts.json').read_text())
remote = {part['path'].removeprefix('assets/'): part for record in mapping.values() for part in record['parts']}
bundled_count = external_count = 0
for item in inputs['files']:
    path = client / 'browser/assets' / item['path']
    if path.exists():
        assert path.stat().st_size == item['bytes'], item['path']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256'], item['path']
        bundled_count += 1
    else:
        part = remote[item['path']]
        assert part['bytes'] == item['bytes'] and part['sha256'] == item['sha256'], item['path']
        assert part['url'] == inputs['base_url'] + item['path'], item['path']
        external_count += 1
files = [path for path in client.rglob('*') if path.is_file()]
expanded = sum(path.stat().st_size for path in files)
assert expanded + 65536 < 256 * 1024 * 1024, expanded
assert all(path.stat().st_size <= 25 * 1024 * 1024 for path in files)
baseline = json.loads((root / 'docs/SOURCE_BASELINE.json').read_text())
with zipfile.ZipFile(client / 'cybr-light-current-source.zip') as archive:
    assert not any(name.startswith('.git/') or name.startswith('dist/browser/assets/') for name in archive.namelist())
    for item in baseline['preserved_implementation']:
        assert hashlib.sha256(archive.read(item['path'])).hexdigest() == item['sha256'], item['path']
for path in (client / 'browser').rglob('*'):
    if path.is_file() and path.suffix in ('.js', '.mjs', '.wgsl', '.html'):
        relative = path.relative_to(client)
        assert path.read_bytes() == (root / 'dist' / relative).read_bytes(), str(relative)
print(json.dumps({'bundled_assets': bundled_count, 'external_assets': external_count,
                  'total_assets': bundled_count + external_count, 'expanded_bytes': expanded,
                  'source_zip_implementation_digests': len(baseline['preserved_implementation'])}))
