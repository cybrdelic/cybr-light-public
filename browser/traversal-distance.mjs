// Carry an already tested child's near distance instead of repeating its AABB
// intersection on pop. Keep the same traversal order and closest-hit cutoff.
export function traversalDistance(source) {
  if(!source.includes('fn localTrace(')||!source.includes('let ni=stack[count];')||!source.includes('nodes[stack[count]]'))
    throw Error('Instanced traversal distance contract changed');
  source = source.replaceAll(/var stack:array<u32,(\d+)>/g,
    'var stack:array<vec2u,$1>');
  source = source.replaceAll('stack[0]=root;', 'let rr=boxDistance(nodes[root],o,inv);if(rr.y<rr.x||rr.x>=hit.t){return hit;}stack[0]=vec2u(root,bitcast<u32>(rr.x));');
  source = source.replaceAll('stack[0]=0u;', 'let rr=boxDistance(nodes[0],o,inv);if(rr.y>=rr.x&&rr.x<hit.t){stack[0]=vec2u(0u,bitcast<u32>(rr.x));}else{count=0u;}');
  source = source.replace('let ni=stack[count];let node=nodes[ni];let range=boxDistance(node,o,inv);if(range.y<range.x||range.x>=hit.t){continue;}',
    'let entry=stack[count];if(bitcast<f32>(entry.y)>=hit.t){continue;}let node=nodes[entry.x];');
  source = source.replace('let node=nodes[stack[count]];let range=boxDistance(node,o,inv);if(range.y<range.x||range.x>=hit.t){continue;}',
    'let entry=stack[count];if(bitcast<f32>(entry.y)>=hit.t){continue;}let node=nodes[entry.x];');
  source = source.replaceAll('stack[count]=select(node.links.x,node.links.y,a.x<b.x);stack[count+1u]=select(node.links.y,node.links.x,a.x<b.x);',
    'stack[count]=vec2u(select(node.links.x,node.links.y,a.x<b.x),bitcast<u32>(select(a.x,b.x,a.x<b.x)));stack[count+1u]=vec2u(select(node.links.y,node.links.x,a.x<b.x),bitcast<u32>(select(b.x,a.x,a.x<b.x)));');
  source = source.replaceAll('stack[count]=node.links.x;', 'stack[count]=vec2u(node.links.x,bitcast<u32>(a.x));');
  source = source.replaceAll('stack[count]=node.links.y;', 'stack[count]=vec2u(node.links.y,bitcast<u32>(b.x));');
  return source;
}
