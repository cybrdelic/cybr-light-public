"""Build the unchanged client within the Site's expanded archive limit."""
from pathlib import Path
import json
import shutil
from urllib.parse import quote

root = Path(__file__).resolve().parents[1]
source = root / 'dist'
destination = root / 'out'
if destination.exists():
    raise RuntimeError('Preserve the existing client output; choose a fresh build checkout')
inputs = json.loads((root / 'docs/LIVE_ASSET_INPUTS.json').read_text())
files = [path for path in source.rglob('*') if path.is_file() and path.relative_to(source).parts[0] != 'client']
limit = 255 * 1024 * 1024  # Reserve 1 MiB for packaging metadata.
bundled = [path for path in files if '.part-' not in path.name]
expanded_bytes = sum(path.stat().st_size for path in bundled)
remote_files = []
for path in sorted((p for p in bundled if p.name == 'near.bin.gz'), key=lambda p: p.stat().st_size, reverse=True):
    if expanded_bytes <= limit:
        break
    relative = path.relative_to(source / 'browser/assets').as_posix()
    record = next(item for item in inputs['files'] if item['path'] == relative)
    remote_files.append(record)
    expanded_bytes -= path.stat().st_size
if expanded_bytes > limit:
    raise RuntimeError('Pinned payload selection cannot fit the expanded archive limit')
remote_paths = {'browser/assets/' + item['path'] for item in remote_files}
for path in files:
    relative = path.relative_to(source)
    if '.part-' in path.name or relative.as_posix() in remote_paths:
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
for item in remote_files:
    mapping['assets/' + item['path']] = {
        'bytes': item['bytes'], 'sha256': item['sha256'],
        'contentType': 'application/gzip',
        'parts': [{'path': 'assets/' + item['path'], 'bytes': item['bytes'],
                   'sha256': item['sha256'], 'url': inputs['base_url'] + quote(item['path'], safe='/')}],
    }
mapping_path.write_text(json.dumps(mapping, indent=2) + '\n')
receipt = {'asset_commit': inputs['commit_sha'], 'base_url': inputs['base_url'],
           'additional_external_files': remote_files,
           'additional_external_bytes': sum(item['bytes'] for item in remote_files),
           'expanded_bytes': sum(p.stat().st_size for p in destination.rglob('*') if p.is_file())}
(destination / 'docs/DELIVERY.json').write_text(json.dumps(receipt, indent=2) + '\n')
if receipt['expanded_bytes'] + 65536 > limit:
    raise RuntimeError('Packaged client exceeded the reserved expanded limit')
print(json.dumps(receipt))
