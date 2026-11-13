cmake_minimum_required(VERSION 3.24)

project(WenbuSpeech LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
# Set before transcribe.cpp is added so ggml uses the same C runtime.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded")

include(FetchContent)

set(TRANSCRIBE_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(TRANSCRIBE_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(TRANSCRIBE_USE_SYSTEM_BLAS OFF CACHE BOOL "" FORCE)
set(TRANSCRIBE_VULKAN ON CACHE BOOL "" FORCE)

FetchContent_Declare(
    transcribe
    URL https://github.com/handy-computer/transcribe.cpp/archive/4d7c1ccefd39e5a9ea36cca5f8fefc6dcc14b99b.zip
    URL_HASH SHA256=001977775c412aa4d114034d451424464709e95cd27b57f2e94eb6197d809a2e
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_MakeAvailable(transcribe)

# transcribe.cpp points its public headers at CMAKE_SOURCE_DIR, which is this folder when it is embedded.
target_include_directories(transcribe PUBLIC ${transcribe_SOURCE_DIR}/include)

add_executable(wenbu-speech
    src/main.cpp
    src/Audio.cpp
    src/Capture.cpp
    src/Filters.cpp
    src/Listener.cpp
    src/Sources.cpp
)

target_compile_definitions(wenbu-speech PRIVATE UNICODE _UNICODE NOMINMAX)
target_compile_options(wenbu-speech PRIVATE /W4 /permissive- /utf-8)
target_link_libraries(wenbu-speech PRIVATE transcribe ole32 mmdevapi version shlwapi)
