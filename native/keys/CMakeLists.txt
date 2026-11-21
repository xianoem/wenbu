cmake_minimum_required(VERSION 3.20)

project(WenbuKeys LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(wenbu-keys src/main.cpp)

target_compile_definitions(wenbu-keys PRIVATE UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)
target_compile_options(wenbu-keys PRIVATE /W4 /permissive- /utf-8)
target_link_libraries(wenbu-keys PRIVATE user32)
set_property(TARGET wenbu-keys PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded")
