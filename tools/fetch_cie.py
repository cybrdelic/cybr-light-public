"""Optional official CIE observer fetch. Not needed to reproduce this delivery.

The external dataset has its own CC BY-SA 4.0 license. Downloading the data does
not relicense the renderer, but redistributing that dataset requires retaining
its attribution and complying with its license.
"""
from pathlib import Path
import hashlib
import urllib.request

URL='https://files.cie.co.at/Publications-datasets/CIE_xyz_1931_2deg.csv'
EXPECTED='fa663e3535a7e0763a745993a1f0a192eb0275ac46ad2d1befd7626841e713c1'

def main():
    root=Path(__file__).resolve().parents[1]
    target=root/'data'/'CIE_xyz_1931_2deg.csv';target.parent.mkdir(exist_ok=True)
    with urllib.request.urlopen(URL,timeout=30) as response:
        data=response.read()
    actual=hashlib.sha256(data).hexdigest()
    if actual!=EXPECTED:raise RuntimeError(f'CIE checksum mismatch: {actual}')
    target.write_bytes(data)
    print(target)
    print('Dataset: CIE 2019, DOI 10.25039/CIE.DS.xvudnb9b; CC BY-SA 4.0')
    print('For a scene in examples/ or outputs/: scene.observer_path="../data/CIE_xyz_1931_2deg.csv"')

if __name__=='__main__':main()
