"""Deterministic, authored 3D capability scenes. No generated imagery/assets."""
from __future__ import annotations
import sys
from pathlib import Path
import math
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
from cybrlight import Scene, Camera, normalized

ROOT = Path(__file__).resolve().parents[1]


def studio(name: str) -> tuple[Scene, dict]:
    s = Scene(name)
    mats = {}
    mats['floor'] = s.material(name='graphite floor', type='plastic', color=(.095,.105,.12), roughness=.43)
    mats['base'] = s.material(name='charcoal ceramic', type='plastic', color=.075, roughness=.27)
    mats['gold'] = s.material(name='illustrative golden conductor', type='metal', eta=(.17,.38,1.45), k=(3.8,2.5,1.85), roughness=.19)
    mats['silver'] = s.material(name='neutral conductor', type='metal', eta=.2, k=3.8, roughness=.23)
    mats['copper'] = s.material(name='illustrative copper conductor', type='metal', eta=(.22,.95,1.3), k=(3.3,2.45,2.1), roughness=.25)
    mats['teal'] = s.material(name='teal polymer', type='plastic', color=(.035,.37,.39), roughness=.24)
    mats['red'] = s.material(name='vermilion polymer', type='plastic', color=(.65,.055,.025), roughness=.3)
    mats['glass'] = s.material(name='dispersive dielectric', type='glass', color=1, ior_a=1.50, ior_b=.006, absorption=(.06,.012,.004))
    mats['white'] = s.material(name='matte porcelain', type='diffuse', color=.73)
    mats['light'] = s.material(name='large daylight softbox', type='emitter', color=1, emission=9, kelvin=6500)
    mats['warm'] = s.material(name='warm rim softbox', type='emitter', color=1, emission=5, kelvin=4100)
    s.rectangle((0,-.005,0),(0,0,30),(30,0,0),mats['floor'])
    s.rectangle((-2.3,5,1),(3.4,0,0),(0,0,3),mats['light'])
    s.rectangle((2.5,5.5,-3.5),(3.4,0,0),(0,3.0,1.6),mats['warm'])
    s.environment['strength'] = .12
    s.environment['color'] = [.72,.8,1.]
    s.camera = Camera(origin=(5.6,3.7,7.8), target=(0,.95,0), fov=36, focus=9)
    s.settings.exposure = 1.25
    s.notes += ['All geometry and lighting authored deterministically.',
                'Metal eta/k are illustrative spectral controls, not certified measured alloys.',
                'Spectral basis controls are not calibrated sRGB colors.']
    return s,mats


def material_gallery() -> Scene:
    s,m=studio('01_materials')
    s.camera=Camera(origin=(4.6,3.0,8.0), target=(0,.8,0), fov=38, focus=9)
    for x,mat in zip((-1.65,0,1.65),(m['gold'],m['teal'],m['glass'])):
        s.cylinder((x,.13,0),.77,.25,m['base'])
        s.sphere((x,.89,0),.635,mat)
        s.torus((x,.264,0),.705,.022,m['silver'],segments=96,sides=12)
    for i in range(9):
        s.sphere((-2+i*.5,.13,1.45),.115,m['copper'] if i%2 else m['silver'])
    return s


def cornell() -> Scene:
    s=Scene('02_global_illumination')
    white=s.material(name='white diffuse',color=.76)
    red=s.material(name='red diffuse',color=(.68,.045,.035))
    green=s.material(name='green diffuse',color=(.05,.55,.07))
    metal=s.material(name='GGX conductor',type='metal',eta=.2,k=3.4,roughness=.25)
    glass=s.material(name='clear glass',type='glass',ior_a=1.5,absorption=(.08,.02,.015))
    light=s.material(name='ceiling area emitter',type='emitter',color=1,emission=11)
    s.rectangle((0,0,0),(0,0,4),(4,0,0),white)
    s.rectangle((0,4,0),(4,0,0),(0,0,4),white)
    s.rectangle((0,2,-2),(4,0,0),(0,4,0),white)
    s.rectangle((-2,2,0),(0,0,4),(0,4,0),red)
    s.rectangle((2,2,0),(0,4,0),(0,0,4),green)
    s.rectangle((0,3.98,-.25),(1.15,0,0),(0,0,1.0),light)
    s.box((-.9,0,-1.45),(.15,1.9,-.55),white)
    s.sphere((.8,.82,.2),.82,glass)
    s.sphere((-1.0,.53,.7),.53,metal)
    s.camera=Camera(origin=(0,2.05,7.7),target=(0,1.9,-.25),fov=39)
    s.settings.max_depth=32;s.settings.exposure=.85
    return s


def dielectrics() -> Scene:
    s,m=studio('03_dielectrics')
    floor=s.material(name='alternating diffuse tiles',color=.73,checker=2.0,second=.1)
    s.rectangle((0,0.002,0),(0,0,10),(10,0,0),floor)
    rough=s.material(name='frosted microfacet glass',type='roughglass',ior_a=1.50,ior_b=.006,roughness=.29,absorption=(.012,.04,.1))
    blue=s.material(name='absorbing blue glass',type='glass',ior_a=1.50,ior_b=.01,absorption=(.85,.16,.025))
    air=s.material(name='air bubble dielectric',type='glass',ior_a=1.0,ior_b=0)
    for x,mat in zip((-1.6,0,1.6),(m['glass'],rough,blue)):
        s.sphere((x,.81,0),.8,mat)
    # Nested closed surfaces share a medium stack, not opaque white dots.
    for p,r in [((1.5,.98,.1),.17),((1.82,.66,.15),.095),((1.45,.54,-.05),.07)]:
        s.sphere(p,r,air)
    s.camera=Camera(origin=(4.4,2.8,8.7),target=(0,.75,0),fov=37)
    s.settings.max_depth=36;s.settings.exposure=.85
    return s


def mesh_knot() -> Scene:
    s,m=studio('04_triangle_mesh')
    samples,sides=420,28
    t=np.arange(samples)*2*np.pi/samples
    centers=np.column_stack(((1+.34*np.cos(3*t))*np.cos(2*t),.42*np.sin(3*t),(1+.34*np.cos(3*t))*np.sin(2*t)))
    # Rotate the knot into an upright sculptural form.
    a=.86;rot=np.array([[1,0,0],[0,np.cos(a),-np.sin(a)],[0,np.sin(a),np.cos(a)]])
    centers=centers@rot.T+np.array([0,1.45,0])
    tangents=np.roll(centers,-1,axis=0)-np.roll(centers,1,axis=0)
    tangents/=np.linalg.norm(tangents,axis=1)[:,None]
    verts=[];normals=[];faces=[]
    # Parallel transport a frame to avoid Frenet-frame flips.
    n=normalized(np.cross(tangents[0],[0,1,0]));frames=[]
    for tangent in tangents:
        n=normalized(n-tangent*np.dot(n,tangent));b=np.cross(tangent,n);frames.append((n.copy(),b))
    # Close the transported frame continuously: distribute its holonomy
    # around the loop instead of creating a twisted seam in the last ring.
    end_n=normalized(frames[-1][0]-tangents[0]*np.dot(frames[-1][0],tangents[0]))
    holonomy=math.atan2(np.dot(np.cross(frames[0][0],end_n),tangents[0]),np.dot(frames[0][0],end_n))
    for i,(n,b) in enumerate(frames):
        twist=-holonomy*i/samples
        nn=n*math.cos(twist)+b*math.sin(twist)
        bb=-n*math.sin(twist)+b*math.cos(twist)
        n,b=nn,bb
        for j in range(sides):
            angle=2*np.pi*j/sides
            normal=n*np.cos(angle)+b*np.sin(angle)
            verts.append(centers[i]+.135*normal);normals.append(normal)
    for i in range(samples):
        for j in range(sides):
            a=i*sides+j;b=((i+1)%samples)*sides+j;c=((i+1)%samples)*sides+(j+1)%sides;d=i*sides+(j+1)%sides
            # Orient faces by the supplied surface normal.
            for face in ([a,b,c],[a,c,d]):
                cross=np.cross(verts[face[1]]-verts[face[0]],verts[face[2]]-verts[face[0]])
                if np.dot(cross,normals[face[0]])<0: face=face[::-1]
                faces.append(face)
    # Save and reimport OBJ: this example exercises the public mesh adapter.
    obj=ROOT/'examples'/'knot.obj'
    with obj.open('w') as f:
        for v in verts:f.write('v '+' '.join(map(str,v))+'\n')
        for n in normals:f.write('vn '+' '.join(map(str,n))+'\n')
        for face in faces:f.write('f '+' '.join(f'{i+1}//{i+1}' for i in face)+'\n')
    s.obj(obj,m['copper'])
    s.cylinder((0,.1,0),1.48,.2,m['base'])
    s.torus((0,.212,0),1.37,.024,m['gold'],segments=144,sides=12)
    s.camera=Camera(origin=(4.7,3.5,7.0),target=(0,1.25,0),fov=35)
    return s


def homogeneous() -> Scene:
    s=Scene('05_homogeneous_volume')
    wall=s.material(name='charcoal wall',color=.16)
    floor=s.material(name='rough floor',type='plastic',color=.1,roughness=.5)
    gold=s.material(name='brass conductor',type='metal',eta=(.18,.4,1.4),k=(3.8,2.7,2),roughness=.23)
    teal=s.material(name='blue ceramic',type='plastic',color=(.03,.20,.36),roughness=.25)
    glow=s.material(name='warm doorway emission',type='emitter',color=1,emission=22,kelvin=4700)
    s.box((-4,-.12,-3),(4,0,4),floor)
    s.box((-4,0,-3.2),(4,4,-3.0),wall)
    s.rectangle((0,2,-2.99),(4.7,0,0),(0,3.3,0),glow)
    # Real occluders cast volumetric shafts.
    for x in (-2.5,-1.6,-.7,.2,1.1,2):s.box((x,0,-2.88),(x+.26,4,-2.70),wall)
    s.sphere((-.65,.74,.1),.74,gold)
    s.sphere((1.2,.55,.65),.55,teal)
    s.volume((-3.8,0,-2.6),(3.8,4,3.6),extinction=.38,albedo=.91,g=.48)
    s.environment['strength']=.04
    s.camera=Camera(origin=(4.8,2.5,7.8),target=(0,1.5,-.9),fov=41)
    s.settings.exposure=.7;s.settings.max_depth=32
    return s


def clouds() -> Scene:
    s=Scene('06_heterogeneous_cloud')
    dark=s.material(name='terrain',type='diffuse',color=(.10,.13,.08))
    s.rectangle((0,-.8,0),(0,0,80),(80,0,0),dark)
    s.environment={'color':[.28,.43,.85],'strength':.8,'lobes':[
        {'direction':normalized((-1,1.1,-.6)).tolist(),'exponent':200,'strength':55,'kelvin':5800}]}
    rng=np.random.default_rng(12);lobes=[]
    for x,y,z,rx,ry,rz in [(-1.7,1.7,0,1.9,1.2,1.5),(.4,2,0,2.1,1.3,1.7),(1.1,3.1,-.25,1.35,1.9,1.25),(-.6,2.9,-.3,1.4,1.6,1.4),(2.5,1.5,.15,1.5,.9,1.2)]:
        lobes.append({'center':[x,y,z],'radii':[rx,ry,rz],'strength':1.5})
    for _ in range(22):
        p=[rng.uniform(-2.9,3.1),rng.uniform(1.0,3.9),rng.uniform(-.8,.8)]
        r=rng.uniform(.35,.8)
        lobes.append({'center':p,'radii':[r,r*.85,r],'strength':.7})
    s.volume((-4,0,-2.5),(4.3,5.5,2.5),kind=1,extinction=4.4,albedo=.999,g=.75,scale=2.8,lobes=lobes)
    s.camera=Camera(origin=(7.4,3.4,13.0),target=(0,2.4,0),fov=34)
    s.settings.max_depth=64;s.settings.rr_depth=12;s.settings.exposure=.72
    s.notes += ['Authored bounded heterogeneous density, not a meteorological simulation.', 'HG phase, not measured Mie droplet scattering.']
    return s


def polarization() -> Scene:
    s,m=studio('07_polarization')
    s.settings.polarized=True;s.settings.exposure=.48
    back=s.material(name='unpolarized luminous backplate',type='emitter',color=1,emission=3,kelvin=6500)
    first=s.material(name='fixed linear polarizer',type='polarizer',color=1,axis=(1,0,0))
    # Each cell has its own aligned source, first polarizer, and analyzer.
    for x,angle in zip((-1.65,0,1.65),(0,math.pi/4,math.pi/2)):
        analyzer=s.material(name=f'analyzer {round(angle*180/math.pi)} degrees',type='polarizer',axis=(math.cos(angle),math.sin(angle),0))
        s.rectangle((x,1.17,-.18),(1.28,0,0),(0,1.7,0),back)
        s.rectangle((x,1.17,0),(1.28,0,0),(0,1.7,0),first)
        s.rectangle((x,1.17,.18),(1.28,0,0),(0,1.7,0),analyzer)
        for side in (-1,1):s.box((x+side*.7-.045,.26,.04),(x+side*.7+.045,2.08,.29),m['silver'])
        for y in (.28,2.04):s.box((x-.75,y-.045,.04),(x+.75,y+.045,.29),m['silver'])
        s.cylinder((x,.10,.1),.76,.2,m['base'])
    s.camera=Camera(origin=(0,1.9,9.2),target=(0,1.05,.1),fov=38)
    return s


def lens_motion() -> tuple[Scene,Scene]:
    s,m=studio('08_depth_of_field')
    for z in range(5):
        for x in (-1.0,0,1.0):
            mat=m['gold'] if z==1 else m['teal'] if z%2 else m['copper']
            s.sphere((x,.38,-z*1.2),.38,mat)
    s.camera=Camera(origin=(3.2,1.9,5.6),target=(0,.4,-1.3),fov=39,aperture=.09)
    forward=normalized(np.array(s.camera.target)-s.camera.origin)
    s.camera.focus=float(np.dot(np.array([0,.38,-1.2])-s.camera.origin,forward))
    motion,mm=studio('09_motion_blur')
    motion.camera=Camera(origin=(0,2.5,8),target=(0,.65,0),fov=37,shutter_open=0,shutter_close=1)
    motion.sphere((-1.8,.65,0),.63,mm['gold'],velocity=(3.0,0,0))
    for x in (-2,-1,0,1,2):motion.sphere((x,.1,1.2),.1,mm['silver'])
    return s,motion


def inverse() -> Scene:
    s,m=studio('10_inverse_target')
    s.settings.width=240;s.settings.height=180;s.settings.spp=64;s.settings.bands=8;s.settings.max_depth=10
    mat=s.material(name='optimized diffuse spectral basis',color=(.075,.53,.31))
    s.sphere((0,.83,0),.82,mat)
    s.cylinder((0,.10,0),1.18,.20,m['base'])
    s.sphere((-1.65,.35,-.6),.35,m['silver'])
    s.camera=Camera(origin=(3.7,2.5,6.8),target=(0,.75,0),fov=35)
    s.settings.active_material=mat
    return s


BUILDERS={'materials':material_gallery,'cornell':cornell,'dielectrics':dielectrics,'mesh':mesh_knot,
          'homogeneous':homogeneous,'clouds':clouds,'polarization':polarization,'inverse':inverse}


def main() -> None:
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('names',nargs='*');args=parser.parse_args()
    for name in (args.names or list(BUILDERS)):
        scene=BUILDERS[name]();path=scene.save(ROOT/'examples'/f'{scene.name}.cys');print(path)
    if not args.names:
        for scene in lens_motion():print(scene.save(ROOT/'examples'/f'{scene.name}.cys'))


if __name__=='__main__':main()
