// One placement contract for meshes, focus cameras, LOD distance and labels.
export function galleryLayout(index) {
  const columns=index.columns, rows=Math.ceil(index.entries.length/columns);
  const sizes=index.entries.map(e=>(e.normalizedSize||[2.6,2.6,2.6]).map(v=>v*(e.galleryScale??1)));
  // Tall machines belong behind tabletop specimens, not in front of them.
  const order=index.entries.map((_,i)=>i).sort((a,b)=>sizes[a][2]-sizes[b][2]||a-b);
  const slots=[];order.forEach((entry,slot)=>{slots[entry]=slot;});
  const gap=.045, depths=Array(rows).fill(0), rowWidths=Array.from({length:rows},()=>[]);
  sizes.forEach((s,i)=>{const slot=slots[i],row=Math.floor(slot/columns);rowWidths[row][slot%columns]=s[0];depths[row]=Math.max(depths[row],s[1]);});
  const centers=(lengths)=>{const total=lengths.reduce((a,b)=>a+b,0)+gap*(lengths.length-1);let at=-total/2;return {total,values:lengths.map(v=>{const center=at+v/2;at+=v+gap;return center;})};};
  // Each row packs independently: a large machine cannot create empty columns
  // throughout every other row. Front edges align without intersecting rows.
  const xs=rowWidths.map(centers),y=centers(depths);
  const px=i=>xs[Math.floor(slots[i]/columns)].values[slots[i]%columns];
  const py=i=>{const row=Math.floor(slots[i]/columns);return y.values[row]-depths[row]/2+sizes[i][1]/2;};
  const extent=Math.max(...xs.map(x=>x.total),y.total,...sizes.map(s=>s[2]*2));
  return {extent,items:index.entries.map((e,i)=>({id:e.id,scale:e.galleryScale??1,size:sizes[i],x:px(i),y:py(i),
    target:[px(i)*4/extent,sizes[i][2]*2/extent,-py(i)*4/extent],
    distance:Math.max(.06,Math.max(...sizes[i])*4/extent*2.5)}))};
}
