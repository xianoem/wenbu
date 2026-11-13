cmake_minimum_required(VERSION 3.20)

project(WenbuLunaHook LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(wenbu-luna-hook src/main.cpp)

target_compile_definitions(wenbu-luna-hook PRIVATE UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)
target_compile_options(wenbu-luna-hook PRIVATE /W4 /permissive- /utf-8)
target_link_libraries(wenbu-luna-hook PRIVATE psapi shell32)
set_property(TARGET wenbu-luna-hook PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded")
