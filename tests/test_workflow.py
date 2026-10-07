"""Scene compatibility, transactional edits, asset and compiler regression tests."""
from pathlib import Path
from tempfile import TemporaryDirectory
import copy, json, struct, shutil, unittest
import numpy as np
from cybrlight import (Scene,Settings,Camera,load_dict,load_file,ScalarTransform4f as T,
                       traverse,save_snapshot,load_snapshot,bundle_scene,register_bsdf,register_shape)
from cybrlight.workflow import validate_scene,write_pfm,UnsupportedFeatureError
from cybrlight.mesh_io import read_obj,read_ply
from cybrlight.jit import Graph

class WorkflowTests(unittest.TestCase):
    def setUp(self):self.temp=TemporaryDirectory();self.root=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()
    def simple(self):
        s=Scene('test');m=s.material(color=(.25,.5,.7));s.sphere((0,1,0),.7,m);return s
    def test_transform_inverse(self):
        t=T.translate([2,-1,3])@T.rotate([1,2,3],67)@T.scale([.5,2,3]);p=np.array([[1,2,3],[0,-4,.7]])
        np.testing.assert_allclose(t.inverse()@(t@p),p,atol=1e-12)
    def test_lookat(self):
        t=T.look_at([3,2,1],[0,1,0]);np.testing.assert_allclose(t.matrix[:3,2],np.array([-3,-1,-1])/np.sqrt(11),atol=1e-14)
    def test_singular_transform(self):
        with self.assertRaises(ValueError):T.scale([1,0,1])
    def test_nonaffine_transform(self):
        a=np.eye(4);a[3,1]=.1
        with self.assertRaises(ValueError):T(a)
    def test_dict_named_reference(self):
        s=load_dict({'type':'scene','paint':{'type':'diffuse','id':'paint','reflectance':.25},'ball':{'type':'sphere','bsdf':{'type':'ref','id':'paint'}}})
        self.assertEqual(len(s.materials),1);self.assertEqual(s.primitives[0]['material'],0)
    def test_dict_unknown_plugin(self):
        with self.assertRaises(UnsupportedFeatureError):load_dict({'type':'scene','shape':{'type':'signed_distance_octopus'}})
    def test_dict_unknown_parameter(self):
        with self.assertRaises(UnsupportedFeatureError):load_dict({'type':'scene','shape':{'type':'sphere','silently_ignore_me':True}})
    def test_missing_reference(self):
        with self.assertRaises(ValueError):load_dict({'type':'scene','shape':{'type':'sphere','bsdf':{'type':'ref','id':'missing'}}})
    def test_cyclic_bsdf_reference(self):
        with self.assertRaises(ValueError):load_dict({'type':'scene','a':{'type':'mask','id':'a','nested':{'type':'ref','id':'a'}}})
    def test_anisotropic_dict(self):
        s=load_dict({'type':'scene','ball':{'type':'sphere','bsdf':{'type':'roughconductor','alpha_u':.12,'alpha_v':.37}}})
        self.assertEqual((s.materials[0].alpha_u,s.materials[0].alpha_v),(.12,.37))
    def test_beckmann_rejected(self):
        with self.assertRaises(UnsupportedFeatureError):load_dict({'type':'scene','bsdf':{'type':'roughconductor','distribution':'beckmann'}})
    def test_diffuse_is_one_sided_in_compatibility_input(self):
        s=load_dict({'type':'scene','ball':{'type':'sphere','bsdf':{'type':'diffuse'}}});self.assertFalse(s.materials[0].two_sided)
    def test_two_sided_wrapper(self):
        s=load_dict({'type':'scene','ball':{'type':'sphere','bsdf':{'type':'twosided','nested':{'type':'diffuse'}}}})
        self.assertEqual(s.materials[-1].children,(0,-1));self.assertTrue(s.materials[-1].two_sided)
    def test_nonuniform_sphere_rejected(self):
        with self.assertRaises(UnsupportedFeatureError):load_dict({'type':'scene','s':{'type':'sphere','to_world':T.scale([1,2,1])}})
    def test_affine_cube_preserved(self):
        m=np.eye(4);m[0,1]=.35;s=load_dict({'type':'scene','shape':{'type':'cube','to_world':T(m)}})
        self.assertEqual(len(s.primitives),6);self.assertTrue(all(p['type']=='quad' for p in s.primitives))
    def test_shape_group_instances(self):
        s=load_dict({'type':'scene','group':{'type':'shapegroup','id':'g','s':{'type':'sphere','radius':.5}},
                     'a':{'type':'instance','shape':{'type':'ref','id':'g'},'to_world':T.translate([-1,0,0])},
                     'b':{'type':'instance','shape':{'type':'ref','id':'g'},'to_world':T.translate([1,0,0])}})
        self.assertEqual([p['center'][0] for p in s.primitives],[-1,1])
    def test_multiple_sensors_rejected(self):
        with self.assertRaises(UnsupportedFeatureError):load_dict({'type':'scene','a':{'type':'perspective'},'b':{'type':'orthographic'}})
    def test_transaction_commit(self):
        s=self.simple();p=traverse(s);p['materials.0.color']=[.1,.2,.3];p.update();self.assertEqual(s.materials[0].color,[.1,.2,.3])
    def test_transaction_rolls_back_invalid_radius(self):
        s=self.simple();p=traverse(s);p['materials.0.color']=[.1,.2,.3];p['shapes.0.radius']=-1
        with self.assertRaises(ValueError):p.update()
        self.assertEqual(tuple(s.materials[0].color),(.25,.5,.7));self.assertEqual(s.primitives[0]['radius'],.7)
    def test_parameter_filter(self):
        p=traverse(self.simple());p.keep('materials.*.color');self.assertEqual(list(p),['materials.0.color'])
    def test_snapshot_complete_geometry(self):
        s=self.simple();s.cylinder((2,1,0),.3,2,0);s.volume((-1,0,-1),(1,2,1),extinction=.2,phase='rayleigh');s.point_light((0,3,0),4)
        path=save_snapshot(s,self.root/'scene.json');t=load_snapshot(path)
        self.assertEqual(s.primitives,t.primitives);self.assertEqual(s.volumes,t.volumes);self.assertEqual(s.delta_lights,t.delta_lights)
    def test_bundle_moved_texture(self):
        tex=write_pfm(self.root/'input.pfm',np.full((4,8,3),.5));s=self.simple();s.materials[0].texture=str(tex)
        bundle_scene(s,self.root/'bundle');shutil.move(self.root/'bundle',self.root/'moved');tex.unlink()
        t=load_snapshot(self.root/'moved/scene.cybr.json');self.assertTrue(Path(t.materials[0].texture).exists())
        self.assertNotIn(str(tex),(self.root/'moved/scene.cys').read_text())
    def test_xml_default_override(self):
        p=self.root/'a.xml';p.write_text('<scene version="3.0.0"><default name="r" value="0.5"/><shape type="sphere"><float name="radius" value="$r"/></shape></scene>')
        self.assertEqual(load_file(p,r='1.2').primitives[0]['radius'],1.2)
    def test_xml_includes_relative_paths(self):
        (self.root/'part.xml').write_text('<scene><shape type="sphere" id="a"/></scene>');p=self.root/'main.xml';p.write_text('<scene><include filename="part.xml"/></scene>')
        self.assertEqual(len(load_file(p).primitives),1)
    def test_xml_cycle_rejected(self):
        p=self.root/'loop.xml';p.write_text('<scene><include filename="loop.xml"/></scene>')
        with self.assertRaises(ValueError):load_file(p)
    def test_xml_entities_rejected(self):
        p=self.root/'attack.xml';p.write_text('<!DOCTYPE scene [<!ENTITY x SYSTEM "file:///etc/passwd">]><scene/>')
        with self.assertRaises(ValueError):load_file(p)
    def test_obj_negative_indices_and_uv(self):
        p=self.root/'a.obj';p.write_text('v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nf -3/1 -2/2 -1/3\n')
        v,f,n,uv=read_obj(p);self.assertEqual(f.tolist(),[[0,1,2]]);np.testing.assert_equal(uv,[[0,0],[1,0],[0,1]])
    def test_obj_bad_index_rejected(self):
        p=self.root/'a.obj';p.write_text('v 0 0 0\nf 1 2 3\n')
        with self.assertRaises(ValueError):read_obj(p)
    def ply_file(self,fmt):
        p=self.root/'a.ply';header=f'ply\nformat {fmt} 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n'.encode()
        if fmt=='ascii':payload=b'0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n'
        else:
            endian='<' if fmt=='binary_little_endian' else '>';payload=struct.pack(endian+'9fB3i',0,0,0,1,0,0,0,1,0,3,0,1,2)
        p.write_bytes(header+payload);return p
    def test_ply_ascii(self):
        v,f,n,uv=read_ply(self.ply_file('ascii'));self.assertEqual(f.tolist(),[[0,1,2]])
    def test_ply_little_endian(self):
        v,f,n,uv=read_ply(self.ply_file('binary_little_endian'));np.testing.assert_equal(v,[[0,0,0],[1,0,0],[0,1,0]])
    def test_ply_big_endian(self):
        v,f,n,uv=read_ply(self.ply_file('binary_big_endian'));np.testing.assert_equal(v,[[0,0,0],[1,0,0],[0,1,0]])
    def test_ply_truncation(self):
        p=self.ply_file('binary_little_endian');p.write_bytes(p.read_bytes()[:-3])
        with self.assertRaises(ValueError):read_ply(p)
    def test_ply_face_normals(self):
        path=self.ply_file('ascii');s=load_dict({'type':'scene','shape':{'type':'ply','filename':str(path),'face_normals':True}})
        self.assertFalse(s.primitives[0]['smooth'])
    def test_scattering_medium_shape_restriction(self):
        with self.assertRaises(UnsupportedFeatureError):load_dict({'type':'scene','shape':{'type':'sphere','interior':{'type':'homogeneous','albedo':.9}}})
    def test_rayleigh_box_volume(self):
        s=load_dict({'type':'scene','shape':{'type':'cube','bsdf':{'type':'null'},'interior':{'type':'homogeneous','sigma_t':.2,'phase':{'type':'rayleigh'}}}})
        self.assertEqual(s.volumes[0]['phase'],'rayleigh')
    def test_nonfinite_update(self):
        s=self.simple();p=traverse(s);p['materials.0.roughness']=float('nan')
        with self.assertRaises(ValueError):p.update()
    def test_dielectric_blend_rejected(self):
        s=self.simple();b=s.material(type='glass');c=s.material(type='blendbsdf',children=(0,b));s.primitives[0]['material']=c
        with self.assertRaises(UnsupportedFeatureError):validate_scene(s)
    def test_custom_compilation_plugin(self):
        register_bsdf('test_paint',lambda scene,spec,compiler:scene.material(color=(.2,.3,.4)))
        s=load_dict({'type':'scene','shape':{'type':'sphere','bsdf':{'type':'test_paint'}}})
        self.assertEqual(tuple(s.materials[0].color),(.2,.3,.4))

class CompilerTests(unittest.TestCase):
    def setUp(self):self.temp=TemporaryDirectory();self.root=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()
    def graph(self):
        g=Graph();x=g.input('x');y=g.input('y');z=((x*y).sin()+(x+.9).log()+y.exp()/(x+2)+(x*x+y*y+.1).sqrt())*.3
        return g,z
    def test_reverse_finite_difference(self):
        g,z=self.graph();v={'x':np.linspace(.1,.9,12),'y':np.linspace(-.2,.4,12)};grad=g.backward(z,v)
        for k in v:
            a=copy.deepcopy(v);b=copy.deepcopy(v);a[k]+=1e-6;b[k]-=1e-6;fd=(g.evaluate(z,**a)-g.evaluate(z,**b))/2e-6
            np.testing.assert_allclose(grad[k],fd,rtol=1e-7,atol=1e-9)
    def test_compiled_matches_eager(self):
        g,z=self.graph();compiled=g.compile(z,self.root);v={'x':np.linspace(.1,.9,12),'y':np.linspace(-.2,.4,12)};a,grad=compiled(**v)
        np.testing.assert_allclose(a,g.evaluate(z,**v),rtol=1e-14,atol=1e-14)
        for k,b in g.backward(z,v).items():np.testing.assert_allclose(grad[k],b,rtol=1e-14,atol=1e-14)
        self.assertTrue((compiled.path.parent/'kernel.cpp').exists());self.assertTrue((compiled.path.parent/'graph.json').exists())
    def test_broadcast_vjp(self):
        g=Graph();x=g.input('x');y=g.input('y');z=x*y
        v={'x':np.arange(6).reshape(2,3)+1.,'y':np.array([2.,3.,4.])};grad=g.backward(z,v)
        np.testing.assert_equal(grad['y'],[5,7,9]);np.testing.assert_equal(grad['x'],[[2,3,4],[2,3,4]])
    def test_compiled_broadcast(self):
        g=Graph();x=g.input('x');p=g.input('p');z=(x*p).sigmoid();kernel=g.compile(z,self.root);v={'x':np.arange(6).reshape(2,3)/10.,'p':.4};a,grad=kernel(**v)
        np.testing.assert_allclose(a,g.evaluate(z,**v));self.assertAlmostEqual(grad['p'].sum(),g.backward(z,v)['p'])
    def test_mixed_graph_rejected(self):
        a=Graph();b=Graph()
        with self.assertRaises(ValueError):a.input('x')+b.input('x')
    def test_missing_inputs_rejected(self):
        g,z=self.graph()
        with self.assertRaises(ValueError):g.evaluate(z,x=1)
    def test_source_is_independent(self):
        g,z=self.graph();k=g.compile(z,self.root);source=(k.path.parent/'kernel.cpp').read_text()
        self.assertIn('cybr_kernel',source);self.assertNotIn('torch',source)
    def test_minmax_abs_branch_derivative(self):
        g=Graph();x=g.input('x');y=x.abs().maximum(.2).minimum(.8);v={'x':np.array([-.9,-.5,-.1,.1,.5,.9])};d=g.backward(y,v)['x'];np.testing.assert_equal(d,[0,-1,0,0,1,0])
    def test_native_shader_abi(self):
        import ctypes
        g=Graph();nm=g.input('nm');p=g.input('p0');u=g.input('u');y=(p+u).sigmoid()*(.3+.2*(-(nm-550)**2/10000).exp());kernel=g.compile(y,self.root,shader=True)
        f=kernel.library.cybr_shader;ptr=ctypes.POINTER(ctypes.c_double);f.argtypes=[ctypes.c_double]*3+[ptr]*3;f.restype=None
        parameters=np.array([.2,0,0]);value=np.zeros(1);gradient=np.zeros(3);f(530,.35,.2,parameters.ctypes.data_as(ptr),value.ctypes.data_as(ptr),gradient.ctypes.data_as(ptr))
        eager=g.evaluate(y,nm=530,u=.35,p0=.2);d=g.backward(y,{'nm':530,'u':.35,'p0':.2});self.assertAlmostEqual(value[0],eager);self.assertAlmostEqual(gradient[0],d['p0']);np.testing.assert_equal(gradient[1:],0)

class HigherDerivativeTests(unittest.TestCase):
    def test_second_derivative_compiles_and_matches_analytic(self):
        with TemporaryDirectory() as root:
            g=Graph();x=g.input('x');f=x.sin()*x*x;d=g.gradient(f,x);dd=g.gradient(d,x);xv=np.linspace(-1.5,1.5,13)
            expected=2*np.sin(xv)+4*xv*np.cos(xv)-xv*xv*np.sin(xv)
            np.testing.assert_allclose(g.evaluate(dd,x=xv),expected,rtol=1e-12,atol=1e-12)
            compiled=g.compile(dd,root);value,_=compiled(x=xv);np.testing.assert_allclose(value,expected,rtol=1e-12,atol=1e-12)
    def test_mixed_partial_symmetry(self):
        g=Graph();x=g.input('x');y=g.input('y');f=(x*y).exp()+x*x*y.sin();xy=g.gradient(g.gradient(f,x),y);yx=g.gradient(g.gradient(f,y),x)
        values={'x':np.linspace(.1,.5,8),'y':np.linspace(-.3,.7,8)};np.testing.assert_allclose(g.evaluate(xy,**values),g.evaluate(yx,**values),rtol=1e-12,atol=1e-12)
    def test_dead_code_does_not_evaluate_invalid_branch(self):
        g=Graph();x=g.input('x');unused=x.log();valid=x*x;np.testing.assert_allclose(g.evaluate(valid,x=np.array([-1,-2])),[1,4])
    def test_stable_extreme_sigmoid(self):
        with TemporaryDirectory() as root:
            g=Graph();x=g.input('x');f=x.sigmoid();v=np.array([-1000.,-40.,0.,40.,1000.]);compiled=g.compile(f,root);value,_=compiled(x=v)
            np.testing.assert_allclose(value,g.evaluate(f,x=v));self.assertEqual(value[0],0.);self.assertEqual(value[-1],1.)


class DeliveryRobustnessTests(unittest.TestCase):
    def test_select_derivative_uses_boolean_condition(self):
        g=Graph();x=g.input('x');condition=g.input('condition');y=condition.select(x*x,x*3)
        d=g.gradient(y,'x');values={'x':np.array([2.,2.,2.]),'condition':np.array([2.,-3.,0.])}
        np.testing.assert_allclose(g.evaluate(d,**values),[4.,4.,3.])
        np.testing.assert_allclose(g.backward(y,values)['x'],[4.,4.,3.])
    def test_constant_kernel_explicit_error(self):
        g=Graph();y=g.constant(2)
        with self.assertRaisesRegex(ValueError,'named input'):g.compile(y)

if __name__=='__main__':unittest.main(verbosity=2)
