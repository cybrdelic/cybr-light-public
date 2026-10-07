"""Executed integration scenes for CYBR LIGHT 0.2. No image-generation API."""
from pathlib import Path
import sys,math,json,argparse
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
from cybrlight import Scene,Camera,Settings,render,bundle_scene,load_dict,load_file
from cybrlight.workflow import write_pfm
from cybrlight.jit import Graph
ROOT=Path(__file__).resolve().parents[1]

def studio(name):
 s=Scene(name);s.asset_base=str(ROOT);s.settings=Settings(width=480,height=320,spp=64,bands=10,max_depth=12,threads=4,seed=9271,filter='tent',sampler=1)
 s.camera=Camera(origin=(5,3.5,7.8),target=(0,1,0),fov=37)
 floor=s.material(name='stone',color=(.22,.25,.30),roughness=.7,type='plastic',checker=.7,second=(.13,.15,.18))
 s.quad((-9,0,-9),(0,0,18),(18,0,0),floor)
 white=s.material(name='softbox',type='emitter',emission=12,color=1,kelvin=5600)
 s.rectangle((-2,5,1),(3,0,0),(0,0,2),white)
 s.environment.update(color=[.45,.55,.7],strength=.12)
 s.environment['lobes']=[{'direction':[-.6,.7,-.3],'exponent':12,'strength':1,'kelvin':7200}]
 return s

def anisotropy():
 s=studio('Analytic geometry and anisotropic GGX')
 for i,(ax,ay) in enumerate([(0.035,.35),(.3,.04),(.15,.15)]):
  m=s.material(name=f'brushed_{i}',type='metal',eta=(.17,.43,1.35),k=(3.1,2.4,1.85),alpha_u=ax,alpha_v=ay)
  s.cylinder((i*1.5-1.5,.65,0),.62,1.3,m)
  s.sphere((i*1.5-1.5,1.8,0),.43,m)
 return s

def caustics():
 s=Scene('Shared-scene spectral camera photon mapping');s.asset_base=str(ROOT)
 s.settings=Settings(width=448,height=300,spp=8,bands=16,max_depth=16,threads=4,seed=719,filter='tent',integrator='photonmap',photon_count=500_000,photon_radius=.07)
 s.camera=Camera(origin=(4.2,3.8,6.7),target=(0,.6,0),fov=37)
 ground=s.material(name='matte_detector',color=(.68,.7,.73));s.quad((-5,0,-5),(0,0,10),(10,0,0),ground)
 glass=s.material(name='dispersive_glass',type='glass',ior_a=1.47,ior_b=.018,absorption=(.018,.003,.012))
 s.sphere((-.85,.82,0),.8,glass)
 s.cylinder((1,.70,-.15),.68,1.4,glass)
 e=s.material(name='focused_source',type='emitter',color=1,emission=70,kelvin=5400);s.disk((-1,5,.8),(0,-1,0),.32,e)
 s.environment.update(color=[.4,.5,.7],strength=.055,flat=True)
 return s

def rayleigh():
 s=studio('Polarized Rayleigh multiple scattering');s.settings.width=420;s.settings.height=300;s.settings.spp=48;s.settings.bands=8;s.settings.polarized=True
 s.environment.update(strength=.02,lobes=[]);s.camera=Camera(origin=(0,1.8,6.2),target=(0,1.05,0),fov=32)
 # The original overhead softbox is dimmed; the lateral point source defines the scattering plane.
 s.materials[1].emission=.25;s.point_light((-3,2,.2),(1,1,1),scale=32)
 s.volume((-1.6,.1,-.9),(1.6,2.4,.9),extinction=.85,albedo=.98,phase='rayleigh')
 metal=s.material(type='metal',eta=.25,k=3.5,alpha_u=.15,alpha_v=.35);s.sphere((-.8,.48,-.2),.45,metal)
 glass=s.material(type='glass',ior_a=1.5);s.sphere((.65,.55,.1),.52,glass)
 return s

def transparent():
 s=Scene('Transparent-sheet light sampling and masks');s.asset_base=str(ROOT);s.settings=Settings(width=480,height=320,spp=96,bands=10,filter='tent',sampler=1,max_depth=8)
 s.camera=Camera(origin=(4,4.8,6.6),target=(0,.4,0),fov=37)
 ground=s.material(color=.65);s.quad((-5,0,-5),(0,0,10),(10,0,0),ground)
 for x,col in [(-1.5,(.95,.12,.08)),(0,(.1,.85,.15)),(1.5,(.08,.25,.95))]:
  material=s.material(type='null',color=col);s.rectangle((x,1,0),(1.2,0,0),(0,0,1.2),material)
  support=s.material(type='metal',eta=.2,k=3.2,roughness=.22)
  for z in (-.59,.59):s.cylinder((x,.48,z),.025,.96,support)
 s.directional_light((-.3,-1,-.35),irradiance=2.8)
 s.environment.update(strength=.18,color=[.5,.6,.8],flat=True)
 return s

def textures():
 s=studio('UV textures and nested material graphs');s.settings.width=480;s.settings.spp=72
 Y,X=np.mgrid[0:256,0:512];pattern=.5+.5*np.sin(2*math.pi*(X/60+0.18*np.sin(Y/15)))
 image=np.stack((.08+.6*pattern,.15+.28*pattern,.5-.35*pattern),-1)
 texture=write_pfm(ROOT/'examples/assets/woven.pfm',image)
 normal=np.stack((.5+.2*np.sin(X/8),.5+.2*np.cos(Y/8),np.ones_like(X)),axis=-1)
 normal_path=write_pfm(ROOT/'examples/assets/normal.pfm',normal)
 for i,kind in enumerate(['texture','normalmap','blend']):
  if i==0:m=s.material(type='diffuse',color=1,texture=str(texture))
  elif i==1:
   base=s.material(type='metal',eta=.2,k=3.2,alpha_u=.12,alpha_v=.12)
   m=s.material(type='normalmap',children=(base,-1),texture=str(normal_path))
  else:
   a=s.material(color=(.035,.45,.38));b=s.material(type='metal',eta=(.2,.5,1.2),k=(3,2.3,1.7),roughness=.35)
   m=s.material(type='blendbsdf',children=(a,b),weight=.55)
  s.sphere((i*1.55-1.55,.9,0),.85,m)
 return s

def shader():
 s=studio('Native compiled shader with image derivatives');s.settings.width=448;s.settings.height=300;s.settings.spp=64;s.settings.bands=10
 g=Graph();nm=g.input('nm');u=g.input('u');v=g.input('v');p0=g.input('p0');p1=g.input('p1');p2=g.input('p2')
 stripes=((u*2*math.pi*7+v*5).sin()*p1+p0).sigmoid()
 warm=(-(nm-610)**2/(2*42**2)).exp();cool=(-(nm-480)**2/(2*36**2)).exp()
 value=.025+.85*(stripes*(.08+.85*warm)+(1-stripes)*(.08+.8*cool))*(.65+.3*p2.sigmoid())
 kernel=g.compile(value,ROOT/'examples/assets/jit',shader=True)
 m=s.material(name='compiled_spectral_pattern',shader=str(kernel.path),shader_parameters=(.1,4,.4));s.sphere((0,1.1,0),1.07,m)
 s.settings.ad=True;s.settings.active_material=m
 return s

def xml_instances():
 directory=ROOT/'examples/workflow';directory.mkdir(exist_ok=True,parents=True)
 # Actual PLY triangle mesh, instanced by the XML compiler; no mesh was generated by an image model.
 vertices=[(0,1,0),(1,0,0),(0,0,1),(-1,0,0),(0,0,-1),(0,-1,0)]
 faces=[(0,2,1),(0,3,2),(0,4,3),(0,1,4),(5,1,2),(5,2,3),(5,3,4),(5,4,1)]
 (directory/'gem.ply').write_text('ply\nformat ascii 1.0\nelement vertex 6\nproperty float x\nproperty float y\nproperty float z\nelement face 8\nproperty list uchar int vertex_indices\nend_header\n'+'\n'.join(' '.join(map(str,p)) for p in vertices)+'\n'+'\n'.join('3 '+' '.join(map(str,f)) for f in faces)+'\n')
 xml='''<scene version="3.0.0">
 <integrator type="path"><integer name="max_depth" value="10"/></integrator>
 <sensor type="perspective"><transform name="to_world"><lookat origin="5,3.2,7" target="0,0.6,0" up="0,1,0"/></transform><float name="fov" value="43"/><film type="hdrfilm"><integer name="width" value="480"/><integer name="height" value="320"/><rfilter type="tent"/></film><sampler type="halton"><integer name="sample_count" value="64"/></sampler></sensor>
 <bsdf type="roughconductor" id="copper"><rgb name="eta" value="0.22,0.66,1.1"/><rgb name="k" value="3.3,2.3,2.1"/><float name="alpha_u" value="0.08"/><float name="alpha_v" value="0.2"/></bsdf>
 <shape type="shapegroup" id="gem"><shape type="ply"><string name="filename" value="gem.ply"/><ref id="copper"/></shape></shape>
 <shape type="instance"><ref id="gem"/><transform name="to_world"><scale value="0.8"/><translate x="-1.8" y="0.8"/></transform></shape>
 <shape type="instance"><ref id="gem"/><transform name="to_world"><rotate y="1" angle="35"/><translate y="1"/></transform></shape>
 <shape type="instance"><ref id="gem"/><transform name="to_world"><scale value="0.65"/><rotate y="1" angle="75"/><translate x="1.8" y="0.65"/></transform></shape>
 <shape type="rectangle"><transform name="to_world"><scale value="8"/><rotate x="1" angle="-90"/></transform><bsdf type="diffuse"><rgb name="reflectance" value="0.24,0.28,0.34"/></bsdf></shape>
 <emitter type="point"><point name="position" x="-2" y="5" z="3"/><rgb name="intensity" value="80,80,80"/></emitter>
 <emitter type="constant"><rgb name="radiance" value="0.3,0.35,0.45"/></emitter>
</scene>'''
 path=directory/'instances.xml';path.write_text(xml);s=load_file(path);s.name='XML references, PLY import and transformed instances';return s

SCENES={'01_anisotropy':anisotropy,'02_camera_caustics':caustics,'03_polarized_rayleigh':rayleigh,
        '04_transparent_shadows':transparent,'05_material_graphs':textures,'06_compiled_shader':shader,'07_xml_instances':xml_instances}

def main():
 p=argparse.ArgumentParser();p.add_argument('scenes',nargs='*',default=list(SCENES));p.add_argument('--smoke',action='store_true');p.add_argument('--quality',action='store_true',help='Render frozen delivery quality');a=p.parse_args()
 for name in a.scenes:
  s=SCENES[name]()
  if a.quality:
   s.settings.width=640;s.settings.height=424;s.settings.spp=192;s.settings.bands=12;s.settings.film_format='openexr'
   if name=='02_camera_caustics':s.settings.spp=24;s.settings.bands=24;s.settings.photon_count=2_400_000;s.settings.photon_radius=.10
   if name=='03_polarized_rayleigh':s.settings.width=560;s.settings.height=400;s.settings.spp=128
  if a.smoke:s.settings.width=240;s.settings.height=160;s.settings.spp=8;s.settings.bands=6;s.settings.photon_count=60000;s.settings.photon_radius=.12
  bundle=ROOT/'examples/executed'/name;bundle_scene(s,bundle)
  out=ROOT/'outputs'/name
  report=render(bundle/'scene.cys',out);report['source_scene']=str(bundle.relative_to(ROOT)/'scene.cys')
  (out.with_suffix('.json')).write_text(json.dumps(report,indent=2))
if __name__=='__main__':main()
