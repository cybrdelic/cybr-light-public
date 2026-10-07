// Deliberately readable diagnostic geometry: no baked illumination or sprites.
export function proofScene(id){
  const meshes=[],customMaterials={};let next=32;
  const mat=(color,roughness=.65,metalness=0,extra={})=>{const n=next++;customMaterials[n]={color,roughness,metalness,...extra};return n;};
  const white=mat([.73,.73,.73]),dark=mat([.035,.04,.045]),red=mat([.65,.035,.02]),blue=mat([.025,.16,.6]);
  const chrome=r=>mat([.92,.94,.96],r,1),glass=mat([1,1,1],.015,0,{nativeType:'glass',ior:1.52});
  const water=mat([1,1,1],.015,0,{nativeType:'glass',ior:1.333,attenuationColor:[.82,.97,.99],attenuationDistance:1.5});
  const light=mat([1,1,1],1,0,{nativeType:'emitter',emission:[12,11.4,10.4]});
  const add=(p,n,ix,material)=>meshes.push({module:id,material,positions:{data:Float32Array.from(p),count:p.length},normals:{data:Float32Array.from(n),count:n.length,dtype:'float32'},indices:{data:Uint32Array.from(ix),count:ix.length}});
  function box(c,s,m){
    const p=[],n=[],ix=[];
    // Each face has independent flat normals. Winding is checked against them.
    for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
      const a=(axis+1)%3,b=(axis+2)%3,base=p.length/3;
      for(const [u,v] of [[-1,-1],[1,-1],[1,1],[-1,1]]){const q=[...c],normal=[0,0,0];q[axis]+=sign*s[axis]/2;q[a]+=u*s[a]/2;q[b]+=v*s[b]/2;normal[axis]=sign;p.push(...q);n.push(...normal);}
      ix.push(...(sign>0?[0,1,2,0,2,3]:[0,2,1,0,3,2]).map(v=>base+v));
    }add(p,n,ix,m);
  }
  function sphere(c,r,m,inner=0){
    const p=[],n=[],ix=[],nu=96,nv=48;
    for(const [radius,sign] of [[r,1],...(inner?[[inner,-1]]:[])]){
      const base=p.length/3;
      for(let v=0;v<=nv;v++)for(let u=0;u<=nu;u++){
        const a=Math.PI*v/nv,b=2*Math.PI*u/nu,q=[Math.sin(a)*Math.cos(b),Math.sin(a)*Math.sin(b),Math.cos(a)];
        p.push(...q.map((x,k)=>c[k]+x*radius));n.push(...q.map(x=>x*sign));
      }
      for(let v=0;v<nv;v++)for(let u=0;u<nu;u++){
        const a=base+v*(nu+1)+u,b=a+nu+1;
        const face=[];if(v>0)face.push(a,b,a+1);if(v<nv-1)face.push(a+1,b,b+1);
        for(let j=0;j<face.length;j+=3)ix.push(...(sign>0?face.slice(j,j+3):[face[j],face[j+2],face[j+1]]));
      }
    }add(p,n,ix,m);
  }
  // Revolved closed cross-sections. Cups include their real wall and base;
  // liquids are separate closed volumes, not two coplanar sheets.
  function lathe(c,profile,m){
    const p=[],n=[],ix=[],segments=128;
    for(let j=0;j<profile.length;j++){
      const [r0,z0]=profile[j],[r1,z1]=profile[(j+1)%profile.length],dr=r1-r0,dz=z1-z0,len=Math.hypot(dr,dz),base=p.length/3;
      for(let i=0;i<=segments;i++)for(const [r,z] of [[r0,z0],[r1,z1]]){const t=i*2*Math.PI/segments;p.push(c[0]+r*Math.cos(t),c[1]+r*Math.sin(t),c[2]+z);n.push(dz/len*Math.cos(t),dz/len*Math.sin(t),-dr/len);}
      for(let i=0;i<segments;i++){const a=base+i*2; if(r0>0)ix.push(a,a+2,a+1);if(r1>0)ix.push(a+1,a+2,a+3);}
    }add(p,n,ix,m);
  }
  let notes,camera={yaw:.12,pitch:.32,distance:4.8,target:[0,.45,0]},extent=5.4;
  if(id==='proof-indirect'){
    box([0,0,-.08],[4,3.4,.16],white);box([0,1.65,1.4],[4,.1,2.8],white);
    box([-2,0,1.4],[.1,3.4,2.8],red);box([2,0,1.4],[.1,3.4,2.8],blue);
    box([0,0,2.85],[4,3.4,.1],white);box([0,.65,2.775],[1.2,.9,.025],light);
    box([-.8,.35,.55],[.8,.85,1.1],white);sphere([.85,-.1,.48],.48,white);
    box([.3,.8,1.55],[2.1,1.7,.09],white); // rear-wall-mounted canopy
    notes='Indirect-light test: sole ceiling emitter, zero environment, no studio fill. Look for red/blue bounce light and illumination under the canopy. Compare 1 versus 6 bounces. This is a diagnostic, not a reference-error certification.';
    extent=4.4;camera={yaw:.02,pitch:.15,distance:4.2,target:[0,1.15,0]};
  }else{
    box([0,0,-.07],[6,4,.14],white);
    box([0,1.95,1.35],[6,.1,2.7],dark);
    box([-1.4,-.1,3.2],[2.2,1.6,.04],light);box([2,.5,2.8],[.5,2,.04],light);
    if(id==='proof-optics'){
      for(let i=0;i<19;i++)box([-2.7+i*.3,1.86,1.15],[.10,.035,2.2],i%2?white:red);
      lathe([-1.55,-.1,0],[[0,0],[.48,0],[.48,1.25],[.425,1.25],[.425,.065],[0,.065]],glass);
      lathe([-1.55,-.1,.0651],[[0,0],[.4249,0],[.4249,.81],[0,.81]],water);
      sphere([0,-.2,.58],.58,glass);sphere([0,-.2,.58],.39,water);
      sphere([1.5,-.15,.61],.61,glass,.55);
      for(let i=0;i<12;i++)box([-2.6+i*.46,-1.25,.012],[.22,.52,.024],i%2?blue:dark);
      notes='Optical test: thick-walled water cup, water sphere nested in solid glass, and hollow glass shell. Stripe distortion, Fresnel edges and absorption must remain distinct. RGB only: no spectral dispersion; difficult caustics/noise remain unsolved.';
    }else if(id==='proof-metals'){
      const rough=[.025,.065,.14,.28,.5];
      for(let row=0;row<3;row++)for(let i=0;i<5;i++)sphere([-2.15+i*1.075,.9-row*.92,.39],.39,row===0?chrome(rough[i]):mat(row===1?[.95,.64,.54]:[.92,.73,.33],rough[i],1));
      for(let i=0;i<17;i++)box([-2.8+i*.35,1.84,1.2],[.06,.04,2.3],white);
      notes='Metal test: chrome, copper and gold rows; roughness increases left to right (.025 to .5). Actual area lights and stripes must reflect, broaden and occlude correctly. RGB conductor approximations, not measured spectral metals.';
      camera={yaw:.12,pitch:.6,distance:4.8,target:[0,.3,0]};
    }else throw Error('Unknown diagnostic scene');
  }
  return {raw:new ArrayBuffer(0),manifest:{meshes,customMaterials,modules:[],framing:{center:[0,0,0],extent},camera,floor:0,recommendedBounces:id==='proof-optics'?10:undefined,lighting:{environment:[0,0,0],disableStudio:true},notes}};
}
