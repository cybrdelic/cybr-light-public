"""Consumer-level tests of the explicit Assembly bridge, not another renderer."""
import unittest
from types import SimpleNamespace
import numpy as np
from cybrlight import Scene
from cybrlight.mesh_io import append_assembly

class AssemblyImport(unittest.TestCase):
    def setUp(self):
        self.scene=Scene();self.scene.material(type='diffuse');self.scene.material(type='roughglass',ior_a=1.57)
        self.part=SimpleNamespace(name='source',material=0,vertices=np.array([[0.,0,0],[10.,0,0],[0.,10,0]]),faces=np.array([[0,1,2]]),normals=np.tile([0.,0,1.],(3,1)))
        self.assembly=SimpleNamespace(parts=[self.part],motion_function=None,pose=lambda p,t,e:np.eye(4))
        self.transform=np.diag([.001,.001,.001,1.])
    def apply(self,mapping=None):
        return append_assembly(self.scene,self.assembly,{0:1} if mapping is None else mapping,metres_from_source=self.transform)
    def test_actual_consumer_identity(self):
        prior=self.scene.object_id();rows=self.apply();p=self.scene.primitives[0]
        self.assertEqual(p['material'],1);self.assertEqual(p['object'],prior+1)
        np.testing.assert_array_equal(p['vertices'],self.part.vertices*.001)
        np.testing.assert_array_equal(p['normals'],self.part.normals)
        self.assertEqual(rows[0]['source_material'],0)
    def test_unmapped_rejected_before_mutation(self):
        with self.assertRaises(ValueError):self.apply({})
        self.assertEqual(self.scene.primitives,[])
    def test_motion_not_silently_frozen(self):
        self.assembly.motion_function=lambda:None
        with self.assertRaises(ValueError):self.apply()
        self.assembly.motion_function=None;self.assembly.pose=lambda *a:self.transform
        with self.assertRaises(ValueError):self.apply()
    def test_no_silent_small_triangle_drop(self):
        self.part.vertices*=1e-9
        with self.assertRaises(ValueError):self.apply()
        self.assertEqual(self.scene.primitives,[])
    def test_bad_normals_rejected(self):
        self.part.normals[0]=0
        with self.assertRaises(ValueError):self.apply()
    def test_consumer_failure_rolls_back(self):
        original=self.scene.mesh
        def fail(*a,**kw):original(*a,**kw);raise RuntimeError('injected consumer failure')
        self.scene.mesh=fail
        with self.assertRaises(RuntimeError):self.apply()
        self.assertEqual(self.scene.primitives,[]);self.assertEqual(self.scene._object,0)

if __name__=='__main__':unittest.main()
