"""Small executed authoring/API regressions; these are not optical validation."""
from pathlib import Path
import sys
import tempfile
import unittest
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
from cybrlight import Scene, normalized, vec, read_pfm


class AuthoringTests(unittest.TestCase):
    def test_bad_vectors_are_rejected(self):
        for value in ([1, 2], [1, 2, float('nan')], float('inf')):
            with self.assertRaises(ValueError):
                vec(value)
        with self.assertRaises(ValueError):
            normalized([0, 0, 0])

    def test_degenerate_shapes_are_rejected(self):
        s = Scene(); m = s.material()
        with self.assertRaises(ValueError):
            s.sphere([0, 0, 0], -1, m)
        with self.assertRaises(ValueError):
            s.quad([0, 0, 0], [1, 0, 0], [2, 0, 0], m)

    def test_mesh_transform_and_normal(self):
        s = Scene(); m = s.material()
        transform = np.eye(4); transform[:3, :3] = np.diag([2, 3, 4]); transform[:3, 3] = [4, 5, 6]
        s.mesh([[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 1, 2]], m,
               normals=[[0, 0, 1]] * 3, transform=transform)
        tri = s.primitives[0]
        np.testing.assert_allclose(tri['vertices'][1], [6, 5, 6])
        np.testing.assert_allclose(tri['normals'], [[0, 0, 1]] * 3)

    def test_invalid_indices_are_rejected(self):
        s = Scene(); m = s.material()
        with self.assertRaises(ValueError):
            s.mesh([[0, 0, 0]], [[0, 1, 2]], m)

    def test_obj_negative_indices_and_scene_output(self):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp)
            (p / 'test.obj').write_text('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\n')
            s = Scene(); m = s.material(); s.obj(p / 'test.obj', m)
            self.assertEqual(len(s.primitives), 1)
            s.save(p / 'test.cys')
            self.assertIn('triangle', (p / 'test.cys').read_text())
            self.assertTrue((p / 'test.scene.json').exists())

    def test_pfm_orientation_and_data_integrity(self):
        image = np.arange(18, dtype=np.float32).reshape(2, 3, 3)
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp) / 'test.pfm'
            with p.open('wb') as f:
                f.write(b'PF\n3 2\n-1\n'); f.write(np.flipud(image).astype('<f4').tobytes())
            np.testing.assert_array_equal(read_pfm(p), image)


if __name__ == '__main__':
    unittest.main(verbosity=2)
