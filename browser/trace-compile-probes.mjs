// Compile-only entrypoints appended to the unchanged trace module. Never dispatch.
export const traceProbeCases=["probe-control-8","binding-abi","traversal","medium"];
export const traceProbeSourceSha256='563e314d2f974482c1b24c890067316eab892b7adeb8806ad688b15527a60b3f';
const probes={
  "probe-control-8": {
    "entryPoint": "probeControl8",
    "purpose": "Empty full-source entrypoint with the same 8x8 workgroup as the failing current trace",
    "body": "\n@compute @workgroup_size(8,8)\nfn probeControl8() {}\n"
  },
  "binding-abi": {
    "entryPoint": "probeBindingABI",
    "purpose": "Original uniform/storage declarations and dynamic buffer accesses, without traversal or medium loops",
    "body": "\n@compute @workgroup_size(8,8)\nfn probeBindingABI(@builtin(global_invocation_id) gid:vec3u) {\n if(any(gid.xy>=u.size.xy)){return;}\n let index=gid.y*u.size.x+gid.x;let input=u.size.z;\n samples[index].color=triangles[input].p+nodes[input].low+materials[input].base\n  +portals[input].center+attributes[input].n0+lighting.info+u.eye;\n}\n"
  },
  "traversal": {
    "entryPoint": "probeTraversal",
    "purpose": "Original camera and traversal helpers, including private 64-entry BVH stack, with a dynamic output witness",
    "body": "\n@compute @workgroup_size(8,8)\nfn probeTraversal(@builtin(global_invocation_id) gid:vec3u) {\n if(any(gid.xy>=u.size.xy)){return;}\n let index=gid.y*u.size.x+gid.x;\n let direction=camera(vec2f(gid.xy)+vec2f(.5));\n let hit=trace(u.eye.xyz,direction,1e20,u.flags.x>.5);\n samples[index].color=vec4f(hit.t,f32(hit.id),hit.bary);\n}\n"
  },
  "medium": {
    "entryPoint": "probeMedium",
    "purpose": "Original medium-target/commit/exit helpers and 16-slot private stack, with uniform-dependent loops, queries and output",
    "body": "\n@compute @workgroup_size(8,8)\nfn probeMedium(@builtin(global_invocation_id) gid:vec3u) {\n if(any(gid.xy>=u.size.xy)){return;}\n let index=gid.y*u.size.x+gid.x;let depth=min(u.size.w,16u);\n var stack:MediumStack;var value=vec4f(0);\n for(var i=0u;i<depth;i++) {\n  let boundary=u.size.z+i;\n  let inside=vec4f(abs(u.eye.xyz)*f32(i+1u),1.+abs(u.forward.w)+f32(i)*.001);\n  commitMedium(&stack,boundary,true,inside);\n  let query=select(boundary,u.size.z,u.flags.y>.5);\n  value+=mediumTarget(&stack,query,u.flags.x>.5,inside);\n }\n for(var i=0u;i<depth;i++) {\n  let boundary=select(u.size.z+i,u.size.z,u.flags.y>.5);\n  value+=mediumTarget(&stack,boundary,false,vec4f(0,0,0,1));\n  commitMedium(&stack,boundary,false,vec4f(0,0,0,1));\n }\n samples[index].color=value+vec4f(f32(stack.count));\n}\n"
  }
};
export function traceCompileProbe(source,name,{sourceSha256}={}){
 const probe=probes[name];if(!probe)throw Error('Unknown trace compile probe');
 if(sourceSha256!==traceProbeSourceSha256)throw Error('Trace probe baseline changed; review diagnostic before compilation');
 return {code:source+'\n// Appended compile-only diagnostic; never dispatched.\n'+probe.body,entryPoint:probe.entryPoint,workgroup:8,compileOnly:true,purpose:probe.purpose,originalSourceSha256:sourceSha256};
}
