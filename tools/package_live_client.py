"""Build the unchanged client with pinned delivery URLs for large asset parts."""
from pathlib import Path
import json
import shutil
from urllib.parse import quote

root = Path(__file__).resolve().parents[1]
source = root / 'dist'
destination = source / 'client'
if destination.exists():
    raise RuntimeError('Preserve the existing client output; choose a fresh build checkout')
inputs = json.loads((root / 'docs/LIVE_ASSET_INPUTS.json').read_text())
files = [path for path in source.rglob('*') if path.is_file()]
for path in files:
    relative = path.relative_to(source)
    if '.part-' in path.name:
        continue
    target = destination / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, target)
mapping_path = destination / 'browser/asset-parts.json'
mapping = json.loads(mapping_path.read_text())
for record in mapping.values():
    for part in record['parts']:
        relative = part['path'].removeprefix('assets/')
        part['url'] = inputs['base_url'] + quote(relative, safe='/')
mapping_path.write_text(json.dumps(mapping, indent=2) + '\n')
print('PASS: client built; large exact parts use pinned public URLs; no renderer math changed')
