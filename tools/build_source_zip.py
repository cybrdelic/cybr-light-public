"""Package current tracked renderer source/docs, without history or runtime payloads."""
from pathlib import Path
import subprocess
import zipfile

root = Path(__file__).resolve().parents[1]
result = subprocess.run(['git', '-c', 'safe.directory=' + root.as_posix(),
                         'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
                        cwd=root, check=True, capture_output=True)
names = sorted(set(result.stdout.decode('utf-8').split('\0')) - {''})
output = root / 'dist/cybr-light-current-source.zip'
pending = output.with_name('.cybr-light-current-source.zip.new')
if pending.exists():
    raise RuntimeError('Preserve the existing unfinished source archive')
with zipfile.ZipFile(pending, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for name in names:
        if name.startswith(('dist/browser/assets/', 'dist/client/', 'out/')) or name == 'dist/cybr-light-current-source.zip':
            continue
        path = root / name
        if path.is_file():
            archive.write(path, name)
pending.replace(output)
print('PASS: current source ZIP built without Git history or large runtime assets:', output.stat().st_size, 'bytes')
