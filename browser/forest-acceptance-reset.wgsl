// Validation only: explicit initial hysteresis state, unchanged instance ABI.
struct Instance {position:vec4f,rotation:vec4f,info:vec4u}
@group(0) @binding(0) var<storage,read_write> instances:array<Instance>;
@compute @workgroup_size(128) fn reset(@builtin(global_invocation_id) id:vec3u){
 if(id.x<arrayLength(&instances)){instances[id.x].info.w=0u;}
}
