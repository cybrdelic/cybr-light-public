from tempfile import TemporaryDirectory
from pathlib import Path
import unittest,json
import numpy as np
from cybrlight.jit import Graph

class GraphStorageTests(unittest.TestCase):
    def test_roundtrip_eager_compiled_and_gradient(self):
        with TemporaryDirectory() as d:
            g=Graph();x=g.input('x');a=g.input('a');y=(x*x+a).sigmoid()+x.sin()
            p=g.save(y,Path(d)/'graph.json');h,z=Graph.load(p);v={'x':np.array([.2,.4]),'a':.3}
            np.testing.assert_array_equal(g.evaluate(y,**v),h.evaluate(z,**v))
            value,gradient=h.compile(z,d)(**v);np.testing.assert_allclose(value,g.evaluate(y,**v),atol=1e-14)
            np.testing.assert_allclose(gradient['x'],g.backward(y,v)['x'],atol=1e-14)
    def test_unknown_operation_rejected(self):
        with TemporaryDirectory() as d:
            g=Graph();x=g.input('x');p=g.save(x,Path(d)/'g.json');data=json.loads(p.read_text());data['nodes'][0]['op']='external_exec';p.write_text(json.dumps(data))
            with self.assertRaises(ValueError):Graph.load(p)
    def test_forward_reference_rejected(self):
        with TemporaryDirectory() as d:
            g=Graph();x=g.input('x');y=x+1;p=g.save(y,Path(d)/'g.json');data=json.loads(p.read_text());data['nodes'][-1]['inputs']=[0,len(data['nodes'])-1];p.write_text(json.dumps(data))
            with self.assertRaises(ValueError):Graph.load(p)

if __name__=='__main__':unittest.main(verbosity=2)
