from pathlib import Path
import unittest
import numpy as np
from cybrlight import Scene,traverse
from cybrlight.inverse import Parameter,values,apply,gaussian_objective_filter

class InverseControlsTests(unittest.TestCase):
    def scene(self):
        scene=Scene();m=scene.material();scene.sphere((0,1,0),.8,m);scene.point_light((0,3,0),2);return scene
    def test_scalar_and_component_selection(self):
        s=self.scene();params=[Parameter('shapes.0.center',0),Parameter('shapes.0.radius')]
        np.testing.assert_array_equal(values(s,params),[0,.8])
        changed=apply(s,params,np.array([.4,1.2]));self.assertEqual(changed.primitives[0]['center'][0],.4)
        self.assertEqual(s.primitives[0]['radius'],.8)
    def test_bounds_reject(self):
        with self.assertRaises(ValueError):apply(self.scene(),[Parameter('shapes.0.radius',lower=.3,upper=1)],np.array([2.]))
    def test_multiple_components_preserved(self):
        s=apply(self.scene(),[Parameter('camera.origin',0),Parameter('camera.origin',1)],np.array([2.,3.]))
        np.testing.assert_array_equal(s.camera.origin,[2,3,6])
    def test_light_transaction_rejects_negative(self):
        s=self.scene();p=traverse(s);p['lights.0.scale']=-2
        with self.assertRaises(ValueError):p.update()
        self.assertEqual(s.delta_lights[0]['scale'],1)
    def test_environment_transaction_rejects_nonfinite(self):
        s=self.scene();p=traverse(s);p['environment.strength']=float('nan')
        with self.assertRaises(ValueError):p.update()
        self.assertEqual(s.environment['strength'],0)
    def test_loss_filter_preserves_constant(self):
        np.testing.assert_allclose(gaussian_objective_filter(np.ones((8,8,3))*.7,1.2),.7,atol=1e-14)
    def test_parameter_validation(self):
        for kwargs in ({'step':0},{'lower':float('nan')},{'component':1.2}):
            with self.assertRaises(ValueError):Parameter('shapes.0.radius',**kwargs)

if __name__=='__main__':unittest.main(verbosity=2)
