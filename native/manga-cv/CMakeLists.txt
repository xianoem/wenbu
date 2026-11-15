cmake_minimum_required(VERSION 3.24)

project(WenbuMangaCv LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded")

include(FetchContent)

# The same OpenCV release, IPP and SIMD dispatch as the opencv-python 4.11 wheel the manga plugin used,
# so filters, contours and line segments match it exactly.
set(BUILD_LIST "core,imgproc" CACHE STRING "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(BUILD_PERF_TESTS OFF CACHE BOOL "" FORCE)
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_DOCS OFF CACHE BOOL "" FORCE)
set(BUILD_opencv_apps OFF CACHE BOOL "" FORCE)
set(BUILD_opencv_world OFF CACHE BOOL "" FORCE)
set(BUILD_JAVA OFF CACHE BOOL "" FORCE)
set(BUILD_opencv_python3 OFF CACHE BOOL "" FORCE)
set(BUILD_WITH_STATIC_CRT ON CACHE BOOL "" FORCE)
set(WITH_IPP ON CACHE BOOL "" FORCE)
set(WITH_OPENCL OFF CACHE BOOL "" FORCE)
set(WITH_EIGEN OFF CACHE BOOL "" FORCE)
set(WITH_ITT OFF CACHE BOOL "" FORCE)
set(WITH_PROTOBUF OFF CACHE BOOL "" FORCE)
set(WITH_ADE OFF CACHE BOOL "" FORCE)
set(CPU_BASELINE "SSE3" CACHE STRING "" FORCE)
set(CPU_DISPATCH "SSE4_1;SSE4_2;AVX;FP16;AVX2" CACHE STRING "" FORCE)
set(OPENCV_FORCE_3RDPARTY_BUILD ON CACHE BOOL "" FORCE)

FetchContent_Declare(
    opencv
    URL https://github.com/opencv/opencv/archive/refs/tags/4.11.0.tar.gz
    URL_HASH SHA256=9a7c11f924eff5f8d8070e297b322ee68b9227e003fd600d4b8122198091665f
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_MakeAvailable(opencv)

# The dense CRF that pydensecrf wraps, at the commit the plugin's wheel was built from.
FetchContent_Declare(
    pydensecrf
    URL https://github.com/lucasb-eyer/pydensecrf/archive/2723c7fa4f2ead16ae1ce3d8afe977724bb8f87f.zip
    URL_HASH SHA256=eaaff2af277322067227aed5f105c7eb94cb4dc467df2ed1da435fac442e31f4
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_GetProperties(pydensecrf)

if(NOT pydensecrf_POPULATED)
    FetchContent_Populate(pydensecrf)
endif()

set(DENSECRF_DIR ${pydensecrf_SOURCE_DIR}/pydensecrf/densecrf)

add_library(densecrf STATIC
    ${DENSECRF_DIR}/src/densecrf.cpp
    ${DENSECRF_DIR}/src/labelcompatibility.cpp
    ${DENSECRF_DIR}/src/objective.cpp
    ${DENSECRF_DIR}/src/optimization.cpp
    ${DENSECRF_DIR}/src/pairwise.cpp
    ${DENSECRF_DIR}/src/permutohedral.cpp
    ${DENSECRF_DIR}/src/unary.cpp
    ${DENSECRF_DIR}/src/util.cpp
    ${DENSECRF_DIR}/external/liblbfgs/lib/lbfgs.c
)
target_include_directories(densecrf PUBLIC ${DENSECRF_DIR}/include ${DENSECRF_DIR}/external/liblbfgs/include)

add_executable(wenbu-manga-cv src/main.cpp)

target_include_directories(wenbu-manga-cv PRIVATE
    ${OPENCV_CONFIG_FILE_INCLUDE_DIR}
    ${OpenCV_SOURCE_DIR}/include
    ${OpenCV_SOURCE_DIR}/modules/core/include
    ${OpenCV_SOURCE_DIR}/modules/imgproc/include
)
target_compile_definitions(wenbu-manga-cv PRIVATE UNICODE _UNICODE NOMINMAX)
target_compile_options(wenbu-manga-cv PRIVATE /W4 /permissive- /utf-8)
target_link_libraries(wenbu-manga-cv PRIVATE opencv_core opencv_imgproc densecrf)
# OpenCV sends executables to bin/; build:native expects Release/ under the build folder.
set_target_properties(wenbu-manga-cv PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})

# The licences of everything linked into the helper ship next to it.
set(LICENSES_DIR $<TARGET_FILE_DIR:wenbu-manga-cv>/licenses/wenbu-manga-cv)
add_custom_command(TARGET wenbu-manga-cv POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory ${LICENSES_DIR}
    COMMAND ${CMAKE_COMMAND} -E copy ${OpenCV_SOURCE_DIR}/LICENSE ${LICENSES_DIR}/opencv-LICENSE.txt
    COMMAND ${CMAKE_COMMAND} -E copy ${OpenCV_BINARY_DIR}/3rdparty/ippicv/ippicv_win/EULA.rtf ${LICENSES_DIR}/intel-ippicv-EULA.rtf
    COMMAND ${CMAKE_COMMAND} -E copy ${OpenCV_BINARY_DIR}/3rdparty/ippicv/ippicv_win/third-party-programs.txt ${LICENSES_DIR}/intel-ippicv-third-party-programs.txt
    COMMAND ${CMAKE_COMMAND} -E copy ${pydensecrf_SOURCE_DIR}/LICENSE ${LICENSES_DIR}/pydensecrf-LICENSE.txt
    COMMAND ${CMAKE_COMMAND} -E copy ${DENSECRF_DIR}/external/liblbfgs/COPYING ${LICENSES_DIR}/liblbfgs-COPYING.txt
)
