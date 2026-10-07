"""Exercise the public README example and check its repository links."""
from pathlib import Path
import json
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import cybrlight

ROOT = Path(__file__).resolve().parents[1]


class ReadmeTests(unittest.TestCase):
    def test_python_example_renders_with_native_engine(self):
        blocks = re.findall(r'```python\n(.*?)```', (ROOT / 'README.md').read_text(), re.S)
        self.assertEqual(len(blocks), 1)
        real_render = cybrlight.render
        with tempfile.TemporaryDirectory(prefix='cybr-readme-') as tmp:
            prefix = Path(tmp) / 'glass'
            def smoke_render(scene, stem, **kwargs):
                # Keep the documented scene intact, lowering only the work
                # budget and relocating generated files for a regression test.
                kwargs.update(size=(80, 54), spp=2, bands=4, threads=2)
                return real_render(scene, prefix, **kwargs)
            with patch.object(cybrlight, 'render', smoke_render):
                exec(compile(blocks[0], 'README.md', 'exec'), {'__name__': '__readme__'})
            film = cybrlight.read_pfm(prefix.with_suffix('.pfm'))
            self.assertEqual(film.shape, (54, 80, 3))
            self.assertTrue(np.isfinite(film).all())
            self.assertGreater(float(film.max()), 0)
            self.assertGreater(prefix.with_suffix('.png').stat().st_size, 0)
            self.assertGreater(prefix.with_suffix('.exr').stat().st_size, 0)

    def test_readme_repository_links_exist(self):
        text = (ROOT / 'README.md').read_text()
        for target in re.findall(r'\]\(([^)]+)\)', text):
            if '://' in target or target.startswith('#'):
                continue
            path = ROOT / target.split('#', 1)[0]
            with self.subTest(target=target):
                self.assertTrue(path.exists(), f'Missing README link: {target}')

    def test_cli_feature_report_is_valid_json(self):
        result = subprocess.run([sys.executable, '-m', 'cybrlight', 'features'],
                                cwd=ROOT, text=True, capture_output=True, check=True)
        features = json.loads(result.stdout)
        self.assertEqual(features['renderer'], 'CYBR LIGHT 0.2')
        self.assertIn('C++17', features['native'])
        self.assertIsInstance(features['limits'], list)


if __name__ == '__main__':
    unittest.main()
