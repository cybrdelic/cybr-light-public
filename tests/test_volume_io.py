from tempfile import TemporaryDirectory
from pathlib import Path
import unittest,struct
import numpy as np
from cybrlight import Scene,load_dict
from cybrlight.volume_io import VolumeGrid,native_density_path

class VolumeIOTests(unittest.TestCase):
    def test_exact_scalar_roundtrip(self):
        with TemporaryDirectory() as d:
            values=np.arange(120,dtype=np.float32).reshape(4,5,6)/120
            p=VolumeGrid(values,((-1,-2,-3),(2,3,4))).write(Path(d)/'a.vol')
            grid=VolumeGrid.read(p);np.testing.assert_array_equal(grid.data[...,0],values)
            self.assertEqual(grid.bounds,((-1.,-2.,-3.),(2.,3.,4.)))
            native=native_density_path(p);self.assertEqual(native.read_bytes()[:12],struct.pack('<3i',6,5,4))
            np.testing.assert_array_equal(np.frombuffer(native.read_bytes()[12:],'<f4').reshape(values.shape),values)
    def test_rgb_not_silently_converted(self):
        with TemporaryDirectory() as d:
            grid=VolumeGrid(np.ones((2,2,2,3)));p=grid.write(Path(d)/'a.vol')
            self.assertEqual(VolumeGrid.read(p).data.shape,(2,2,2,3))
            with self.assertRaises(ValueError):native_density_path(p)
    def test_corrupt_header_and_truncation(self):
        with TemporaryDirectory() as d:
            p=VolumeGrid(np.ones((2,2,2))).write(Path(d)/'a.vol');data=p.read_bytes();p.write_bytes(data[:-1])
            with self.assertRaises(ValueError):VolumeGrid.read(p)
            p.write_bytes(b'XXX'+data[3:])
            with self.assertRaises(ValueError):VolumeGrid.read(p)
    def test_negative_density_rejected(self):
        with TemporaryDirectory() as d:
            p=VolumeGrid(-np.ones((2,2,2))).write(Path(d)/'a.vol')
            with self.assertRaises(ValueError):native_density_path(p)
    def test_xml_depth_convention(self):
        s=load_dict({'type':'scene','integrator':{'type':'path','max_depth':1},'sphere':{'type':'sphere'}})
        self.assertEqual(s.settings.max_depth,0)
    def test_xml_unlimited_depth(self):
        s=load_dict({'type':'scene','integrator':{'type':'path'},'sphere':{'type':'sphere'}})
        self.assertEqual(s.settings.max_depth,-1)

class VolumeValidationTests(unittest.TestCase):
    def test_isotropic_sets_zero_anisotropy(self):
        s=Scene();s.material();s.volume((-1,-1,-1),(1,1,1),phase='isotropic')
        self.assertEqual(s.volumes[0]['g'],0)
    def test_missing_density_grid_rejected(self):
        from cybrlight.workflow import validate_scene
        s=Scene();s.material();s.volume((-1,-1,-1),(1,1,1),kind=2)
        with self.assertRaises(ValueError):validate_scene(s)
    def test_unknown_phase_rejected(self):
        s=Scene()
        with self.assertRaises(ValueError):s.volume((-1,-1,-1),(1,1,1),phase='not_implemented')

if __name__=='__main__':unittest.main(verbosity=2)
