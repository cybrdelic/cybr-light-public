"""Reproduce the delivered native examples from their frozen input scenes.

All paths are resolved relative to this source checkout. Native render runs
fail immediately on a nonzero executable return code. Optional tensor and
inverse scripts can be invoked separately; they are never replaced by mocks.
"""
from __future__ import annotations
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'python'))
from cybrlight import render


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('names', nargs='*', help='Example names; no names means all native examples')
    parser.add_argument('--list', action='store_true', help='Print recorded examples without rendering')
    parser.add_argument('--quick', action='store_true', help='Use a 320-pixel preview and 16 packets per pixel')
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--out', type=Path, default=ROOT / 'reproduced')
    args = parser.parse_args()
    if args.threads < 1:
        parser.error('--threads must be positive')
    index = ROOT / 'examples' / 'delivered' / 'index.json'
    if not index.is_file():
        raise FileNotFoundError('Frozen delivery scenes are missing: ' + str(index))
    examples = json.loads(index.read_text())['examples']
    if args.list:
        for name, record in examples.items():
            print(f'{name}: {record["kind"]}')
        return
    names = args.names or [name for name, item in examples.items() if item['kind'] == 'native_camera']
    for name in names:
        if name not in examples:
            raise ValueError(f'Unknown example {name!r}; run --list')
        record = examples[name]
        output = args.out.resolve() / name
        output.parent.mkdir(parents=True, exist_ok=True)
        if record['kind'] == 'native_camera':
            settings = record['settings']
            width, height = settings['width'], settings['height']
            spp, bands = settings['packets_per_pixel'], settings['wavelengths_per_packet']
            if args.quick:
                height = max(1, round(height * 320 / width)); width = 320; spp = 16
            scene = ROOT / 'examples' / 'delivered' / record['scene']
            command = [str(ROOT / 'build' / 'cybr-light'), '--scene', str(scene),
                       '--out', str(output), '--size', str(width), str(height),
                       '--spp', str(spp), '--bands', str(bands), '--threads', str(args.threads)]
            subprocess.run(command, check=True)
            from PIL import Image
            Image.open(output.with_suffix('.ppm')).save(output.with_suffix('.png'))
        elif record['kind'] == 'spectral_photon_detector':
            scene = ROOT / 'examples' / 'delivered' / record['scene']
            count = 100000 if args.quick else record['photon_count']
            subprocess.run([str(ROOT / 'build' / 'cybr-photons'), str(scene), str(output), str(count)], check=True)
            from PIL import Image
            Image.open(output.with_suffix('.ppm')).save(output.with_suffix('.png'))
        else:
            raise ValueError(f'{name} is reproduced by {record["script"]}; invoke that script directly')
        print(output.with_suffix('.png'), flush=True)


if __name__ == '__main__':
    main()
