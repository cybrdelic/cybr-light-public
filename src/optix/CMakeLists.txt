cmake_minimum_required(VERSION 3.18)
project(cybr_light_optix LANGUAGES CXX CUDA)
find_package(CUDAToolkit REQUIRED)
set(OPTIX_ROOT "" CACHE PATH "Installed NVIDIA OptiX 9.1 SDK root")
set(CYBR_CUDA_ARCH 89 CACHE STRING "CUDA compute capability, e.g. 89 for RTX 4060")
find_path(OPTIX_INCLUDE optix.h HINTS "${OPTIX_ROOT}/include" REQUIRED)
add_custom_command(OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/device.ptx"
 COMMAND "${CMAKE_CUDA_COMPILER}" --ptx -std=c++17 "-arch=compute_${CYBR_CUDA_ARCH}"
 "-I${OPTIX_INCLUDE}" "${CMAKE_CURRENT_SOURCE_DIR}/device.cu"
 -o "${CMAKE_CURRENT_BINARY_DIR}/device.ptx"
 DEPENDS device.cu shared.h VERBATIM)
add_custom_target(cybr-optix-device ALL DEPENDS "${CMAKE_CURRENT_BINARY_DIR}/device.ptx")
add_executable(cybr-light-optix main.cpp)
target_compile_features(cybr-light-optix PRIVATE cxx_std_17)
target_compile_definitions(cybr-light-optix PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)
target_include_directories(cybr-light-optix PRIVATE "${OPTIX_INCLUDE}" ../../include)
target_link_libraries(cybr-light-optix PRIVATE CUDA::cudart CUDA::cuda_driver ${CMAKE_DL_LIBS})
if(WIN32)
 target_link_libraries(cybr-light-optix PRIVATE advapi32)
endif()
add_dependencies(cybr-light-optix cybr-optix-device)
add_custom_command(TARGET cybr-light-optix POST_BUILD COMMAND ${CMAKE_COMMAND} -E copy_if_different
 "${CMAKE_CURRENT_BINARY_DIR}/device.ptx" "$<TARGET_FILE_DIR:cybr-light-optix>/device.ptx")
