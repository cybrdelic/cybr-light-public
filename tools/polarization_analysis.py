"""Derive analyzer images and degree of polarization from saved rendered Stokes films."""
from pathlib import Path
import sys,json
import numpy as np
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'python'))
from cybrlight import read_pfm

def display_rgb(value):
    value=np.maximum(value,0);value=np.clip(value*(2.51*value+.03)/(value*(2.43*value+.59)+.14),0,1)
    value=np.where(value<=.0031308,value*12.92,1.055*value**(1/2.4)-.055)
    return Image.fromarray(np.uint8(np.rint(value*255)))

def main():
    prefix=ROOT/'outputs/03_polarized_rayleigh'
    fields=[read_pfm(prefix.with_name(prefix.name+f'_stokes{i}.pfm')).astype(float) for i in range(4)]
    luminance=np.array([.2126,.7152,.0722]);S=np.stack([x@luminance for x in fields])
    valid=S[0]>1e-7;degree=np.zeros_like(S[0]);degree[valid]=np.linalg.norm(S[1:,valid],axis=0)/S[0,valid]
    # Finite precision can change the last bits of the physical inequality.
    maximum=float(np.max(degree))
    if maximum>1.00003:raise AssertionError(f'Nonphysical integrated Stokes degree: {maximum}')
    names=[]
    for degrees in (0,45,90):
        angle=np.deg2rad(degrees);rgb=.5*(fields[0]+fields[1]*np.cos(2*angle)+fields[2]*np.sin(2*angle))
        name=f'03_analyzer_{degrees:02d}.png';display_rgb(rgb).save(ROOT/'outputs'/name);names.append((f'Analyzer {degrees} degrees',name))
    gray=np.uint8(np.rint(np.clip(degree,0,1)*255));Image.fromarray(gray).save(ROOT/'outputs/03_degree_polarization.png')
    names.append(('Degree of polarization', '03_degree_polarization.png'))
    panel=Image.new('RGB',(800,602),(17,21,28));draw=ImageDraw.Draw(panel)
    for i,(label,name) in enumerate(names):
        x=(i%2)*400;y=(i//2)*301;draw.text((x+10,y+8),label,fill='white')
        image=Image.open(ROOT/'outputs'/name).convert('RGB').resize((400,276),Image.Resampling.LANCZOS);panel.paste(image,(x,y+25))
    panel.save(ROOT/'outputs/03_polarization_analysis.png')
    report={'source':'Rendered native Stokes buffers, not four independently rerendered scenes','maximum_luminance_degree_of_polarization':maximum,
            'mean_degree_above_intensity_threshold':float(np.mean(degree[valid])),'intensity_threshold':1e-7,
            'analyzer_angles_degrees':[0,45,90],'analyzer_equation':'0.5*(S0+S1*cos(2a)+S2*sin(2a))',
            'model':'Rayleigh scattering and native surface Mueller operators; no measured-optics validation'}
    (ROOT/'evidence/polarization_analysis.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
if __name__=='__main__':main()
