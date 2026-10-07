"""Import original cartridge/FLIP bytes without overwriting divergent assets."""
import argparse
import hashlib
import json
import shutil
import stat
from pathlib import Path

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('portfolio_assets',type=Path)
args=parser.parse_args()
assets=Path(__file__).resolve().parents[1]/'browser/assets'
records=[]
def sha(path):
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):
            digest.update(chunk)
    return digest.hexdigest()
for name in ('instrument-cartridges-c','instrument-fluid'):
    source=(args.portfolio_assets/name).resolve()
    if not source.is_dir(): raise FileNotFoundError(source)
    for original in sorted(source.rglob('*')):
        attributes=getattr(original.lstat(),'st_file_attributes',0)
        if original.is_symlink() or attributes & getattr(stat,'FILE_ATTRIBUTE_REPARSE_POINT',0):
            raise ValueError('Asset import does not follow links')
        if not original.is_file(): continue
        digest=sha(original);dest=assets/name/original.relative_to(source)
        if dest.exists() and sha(dest)!=digest:
            raise ValueError(f'Different existing asset; refusing overwrite: {dest}')
        if not dest.exists():
            dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(original,dest)
        if sha(dest)!=digest or sha(original)!=digest: raise RuntimeError(f'Unstable asset: {original}')
        records.append({'path':dest.relative_to(assets).as_posix(),'bytes':dest.stat().st_size,'sha256':digest})
print(json.dumps({'verified_files':len(records),'bytes':sum(r['bytes'] for r in records)},indent=2))
