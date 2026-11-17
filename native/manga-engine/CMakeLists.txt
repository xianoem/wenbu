cmake_minimum_required(VERSION 3.24)

project(WenbuMangaEngine LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# The prebuilt Skia and ONNX Runtime use the DLL runtime, so the engine does too and ships its DLLs.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreadedDLL")

include(FetchContent)

# The OpenCV release, IPP and SIMD dispatch of the opencv-python 4.11 wheel the manga plugin used, plus
# its image codecs (libjpeg-turbo, libpng, libwebp, zlib) for pages.
set(BUILD_LIST "core,imgproc,imgcodecs" CACHE STRING "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(BUILD_PERF_TESTS OFF CACHE BOOL "" FORCE)
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_DOCS OFF CACHE BOOL "" FORCE)
set(BUILD_opencv_apps OFF CACHE BOOL "" FORCE)
set(BUILD_opencv_world OFF CACHE BOOL "" FORCE)
set(BUILD_JAVA OFF CACHE BOOL "" FORCE)
set(BUILD_opencv_python3 OFF CACHE BOOL "" FORCE)
set(BUILD_WITH_STATIC_CRT OFF CACHE BOOL "" FORCE)
set(WITH_IPP ON CACHE BOOL "" FORCE)
set(WITH_OPENCL OFF CACHE BOOL "" FORCE)
set(WITH_EIGEN OFF CACHE BOOL "" FORCE)
set(WITH_ITT OFF CACHE BOOL "" FORCE)
set(WITH_PROTOBUF OFF CACHE BOOL "" FORCE)
set(WITH_ADE OFF CACHE BOOL "" FORCE)
set(WITH_JPEG ON CACHE BOOL "" FORCE)
set(WITH_PNG ON CACHE BOOL "" FORCE)
set(WITH_WEBP ON CACHE BOOL "" FORCE)
set(WITH_TIFF OFF CACHE BOOL "" FORCE)
set(WITH_OPENJPEG OFF CACHE BOOL "" FORCE)
set(WITH_JASPER OFF CACHE BOOL "" FORCE)
set(WITH_OPENEXR OFF CACHE BOOL "" FORCE)
set(WITH_AVIF OFF CACHE BOOL "" FORCE)
set(WITH_IMGCODEC_HDR OFF CACHE BOOL "" FORCE)
set(WITH_IMGCODEC_SUNRASTER OFF CACHE BOOL "" FORCE)
set(WITH_IMGCODEC_PXM OFF CACHE BOOL "" FORCE)
set(WITH_IMGCODEC_PFM OFF CACHE BOOL "" FORCE)
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

FetchContent_Declare(
    json
    URL https://github.com/nlohmann/json/releases/download/v3.12.0/json.hpp
    URL_HASH SHA256=aaf127c04cb31c406e5b04a63f1ae89369fccde6d8fa7cdda1ed4f32dfc5de63
    DOWNLOAD_NO_EXTRACT TRUE
)
FetchContent_MakeAvailable(json)

# Skia m145, prebuilt by rust-skia (raster and the DirectWrite font manager), and the headers of the
# same commit. It carries its own libpng and libjpeg-turbo, so it lives in wenbu-letter.dll behind a
# small C interface, apart from OpenCV's copies.
FetchContent_Declare(
    skia_binaries
    URL https://github.com/rust-skia/skia-binaries/releases/download/0.93.0/skia-binaries-ee5a1df62817e898128e-x86_64-pc-windows-msvc-pdf.tar.gz
    URL_HASH SHA256=600c80774fb9c3c23e3a2dcb8472a4d09f260fc6f942b7c74245bceb62cb787a
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_MakeAvailable(skia_binaries)

FetchContent_Declare(
    skia_source
    URL https://codeload.github.com/rust-skia/skia/tar.gz/refs/tags/m145-0.92.0
    URL_HASH SHA256=b74f41a751834b0a87c2ad44e3f8c5d7da3dee222390c6d591dc12ca42f84301
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_GetProperties(skia_source)

if(NOT skia_source_POPULATED)
    FetchContent_Populate(skia_source)
endif()

# Clipper 6.4.2 as pyclipper 1.4.0 bundles it (with use_lines), the copy the plugin's unclip runs.
FetchContent_Declare(
    pyclipper
    URL https://github.com/fonttools/pyclipper/archive/refs/tags/1.4.0.tar.gz
    URL_HASH SHA256=71c8ec37604e9c92c04984f56740b370376cf3a0b3885bcb1d5f9baee32c4ffb
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_GetProperties(pyclipper)

if(NOT pyclipper_POPULATED)
    FetchContent_Populate(pyclipper)
endif()

# HarfBuzz 14.2.1, the version the plugin's uharfbuzz 0.55.0 shapes with, built from its one-file source.
FetchContent_Declare(
    harfbuzz
    URL https://github.com/harfbuzz/harfbuzz/releases/download/14.2.1/harfbuzz-14.2.1.tar.xz
    URL_HASH SHA256=a54a5d8e9380a41fbb762ce367bcbf7704792dfca0d93f1bbca86c5a57902e0e
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_GetProperties(harfbuzz)

if(NOT harfbuzz_POPULATED)
    FetchContent_Populate(harfbuzz)
endif()

add_library(harfbuzz STATIC ${harfbuzz_SOURCE_DIR}/src/harfbuzz.cc)
target_include_directories(harfbuzz PUBLIC ${harfbuzz_SOURCE_DIR}/src)
target_compile_options(harfbuzz PRIVATE /bigobj /W0 /utf-8)

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

# ONNX Runtime 1.24.4 with DirectML (the 1.24 line the TensorRT-RTX plugin was checked with), and
# DirectML 1.15.4 it depends on. NuGet packages are zip files.
foreach(package IN ITEMS ort dml)
    if(package STREQUAL "ort")
        set(url https://www.nuget.org/api/v2/package/Microsoft.ML.OnnxRuntime.DirectML/1.24.4)
        set(hash 57e9f11b73437bef7a309496135d4c1f96b1a8e9ddba60013fa27bfc1d788681)
    else()
        set(url https://www.nuget.org/api/v2/package/Microsoft.AI.DirectML/1.15.4)
        set(hash 4e7cb7ddce8cf837a7a75dc029209b520ca0101470fcdf275c1f49736a3615b9)
    endif()

    set(archive ${CMAKE_BINARY_DIR}/_deps/${package}.nupkg)
    set(${package}_DIR ${CMAKE_BINARY_DIR}/_deps/${package}-src)

    if(NOT EXISTS ${${package}_DIR})
        file(DOWNLOAD ${url} ${archive} EXPECTED_HASH SHA256=${hash} SHOW_PROGRESS)
        file(ARCHIVE_EXTRACT INPUT ${archive} DESTINATION ${${package}_DIR})
        file(REMOVE ${archive})
    endif()
endforeach()

set(ORT_NATIVE ${ort_DIR}/runtimes/win-x64/native)
set(ORT_RUNTIME_FILES ${ORT_NATIVE}/onnxruntime.dll ${ORT_NATIVE}/onnxruntime_providers_shared.dll ${dml_DIR}/bin/x64-win/DirectML.dll)

set(OPENCV_INCLUDES
    ${OPENCV_CONFIG_FILE_INCLUDE_DIR}
    ${OpenCV_SOURCE_DIR}/include
    ${OpenCV_SOURCE_DIR}/modules/core/include
    ${OpenCV_SOURCE_DIR}/modules/imgproc/include
    ${OpenCV_SOURCE_DIR}/modules/imgcodecs/include
)

# The PNG decoder reads the file itself, to keep palettes, grey depths and alpha apart like Pillow.
set(PNG_INCLUDES ${OpenCV_SOURCE_DIR}/3rdparty/libpng ${OpenCV_BINARY_DIR}/3rdparty/libpng)

add_library(wenbu-letter SHARED src/letter/Letter.cpp src/letter/StlCompat.cpp)
target_include_directories(wenbu-letter PRIVATE ${skia_source_SOURCE_DIR})
target_compile_definitions(wenbu-letter PRIVATE WENBU_LETTER_EXPORTS UNICODE _UNICODE NOMINMAX SK_RELEASE)
target_compile_options(wenbu-letter PRIVATE /W4 /permissive- /utf-8)
target_link_libraries(wenbu-letter PRIVATE ${skia_binaries_SOURCE_DIR}/skia.lib dwrite user32 ole32 opengl32)
set_target_properties(wenbu-letter PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})

add_library(engine-core STATIC src/Images.cpp src/Protocol.cpp src/Runtime.cpp src/Quad.cpp src/DbBoxes.cpp
    src/Detector.cpp src/PySet.cpp src/Kumiko.cpp src/TextMerge.cpp src/MaskRefine.cpp
    src/Utf8.cpp src/PillowResize.cpp src/ReaderInput.cpp src/Tokenizer.cpp src/TextFilter.cpp src/Colours.cpp
    src/Reader.cpp src/CleanPlan.cpp src/Inpaint.cpp src/Scanner.cpp src/EngineOps.cpp src/LineBreaking.cpp
    src/LetterFonts.cpp src/LetterLayout.cpp src/LetterGeometry.cpp src/Lettering.cpp src/Runner.cpp src/Service.cpp src/Fonts.cpp src/ScreenAi.cpp src/Pictures.cpp ${pyclipper_SOURCE_DIR}/src/clipper.cpp)
set_source_files_properties(${pyclipper_SOURCE_DIR}/src/clipper.cpp PROPERTIES COMPILE_OPTIONS /W0)
target_include_directories(engine-core PUBLIC src ${OPENCV_INCLUDES} ${PNG_INCLUDES} ${json_SOURCE_DIR}
    ${pyclipper_SOURCE_DIR}/src
    ${ort_DIR}/build/native/include)
target_compile_definitions(engine-core PUBLIC UNICODE _UNICODE NOMINMAX)
target_compile_options(engine-core PUBLIC /W4 /permissive- /utf-8)
target_link_libraries(engine-core PUBLIC opencv_core opencv_imgproc opencv_imgcodecs libpng zlib densecrf icu harfbuzz wenbu-letter
    ${ORT_NATIVE}/onnxruntime.lib)

add_executable(wenbu-manga-engine src/main.cpp)
target_link_libraries(wenbu-manga-engine PRIVATE engine-core)
set_target_properties(wenbu-manga-engine PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})

add_executable(wenbu-manga-engine-tests tests/tests.cpp)
target_include_directories(wenbu-manga-engine-tests PRIVATE src/letter)
target_link_libraries(wenbu-manga-engine-tests PRIVATE engine-core wenbu-letter)
set_target_properties(wenbu-manga-engine-tests PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})









foreach(runtime ${ORT_RUNTIME_FILES})
    add_custom_command(TARGET wenbu-manga-engine POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different ${runtime} $<TARGET_FILE_DIR:wenbu-manga-engine>)
endforeach()

# Licences of everything linked in ship next to the engine.
set(LICENSES_DIR $<TARGET_FILE_DIR:wenbu-manga-engine>/licenses/wenbu-manga-engine)
add_custom_command(TARGET wenbu-manga-engine POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory ${LICENSES_DIR}
    COMMAND ${CMAKE_COMMAND} -E copy ${OpenCV_SOURCE_DIR}/LICENSE ${LICENSES_DIR}/opencv-LICENSE.txt
    COMMAND ${CMAKE_COMMAND} -E copy ${OpenCV_BINARY_DIR}/3rdparty/ippicv/ippicv_win/EULA.rtf ${LICENSES_DIR}/intel-ippicv-EULA.rtf
    COMMAND ${CMAKE_COMMAND} -E copy ${OpenCV_BINARY_DIR}/3rdparty/ippicv/ippicv_win/third-party-programs.txt ${LICENSES_DIR}/intel-ippicv-third-party-programs.txt
    COMMAND ${CMAKE_COMMAND} -E copy ${pydensecrf_SOURCE_DIR}/LICENSE ${LICENSES_DIR}/pydensecrf-LICENSE.txt
    COMMAND ${CMAKE_COMMAND} -E copy ${harfbuzz_SOURCE_DIR}/COPYING ${LICENSES_DIR}/harfbuzz-COPYING.txt
    COMMAND ${CMAKE_COMMAND} -E copy ${DENSECRF_DIR}/external/liblbfgs/COPYING ${LICENSES_DIR}/liblbfgs-COPYING.txt
    COMMAND ${CMAKE_COMMAND} -E copy ${json_SOURCE_DIR}/json.hpp ${LICENSES_DIR}/nlohmann-json-header.txt
    COMMAND ${CMAKE_COMMAND} -E copy ${skia_binaries_SOURCE_DIR}/LICENSE_SKIA ${LICENSES_DIR}/skia-LICENSE.txt
    COMMAND ${CMAKE_COMMAND} -E copy ${ort_DIR}/LICENSE ${LICENSES_DIR}/onnxruntime-LICENSE.txt
    COMMAND ${CMAKE_COMMAND} -E copy ${ort_DIR}/ThirdPartyNotices.txt ${LICENSES_DIR}/onnxruntime-ThirdPartyNotices.txt
    COMMAND ${CMAKE_COMMAND} -E copy ${dml_DIR}/LICENSE.txt ${LICENSES_DIR}/directml-LICENSE.txt
    COMMAND ${CMAKE_COMMAND} -E copy ${pyclipper_SOURCE_DIR}/LICENSE ${LICENSES_DIR}/pyclipper-LICENSE.txt
    COMMAND ${CMAKE_COMMAND} -E copy ${pyclipper_SOURCE_DIR}/src/clipper.hpp ${LICENSES_DIR}/clipper-header.txt
)

# The Visual C++ runtime ships next to the engine (app-local deployment), since the app cannot assume it
# is installed.
set(CMAKE_INSTALL_SYSTEM_RUNTIME_LIBS_SKIP TRUE)
include(InstallRequiredSystemLibraries)

foreach(runtime ${CMAKE_INSTALL_SYSTEM_RUNTIME_LIBS})
    add_custom_command(TARGET wenbu-manga-engine POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different ${runtime} $<TARGET_FILE_DIR:wenbu-manga-engine>)
endforeach()
