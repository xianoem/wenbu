cmake_minimum_required(VERSION 3.20)

project(WenbuRgssBridge LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_SIZEOF_VOID_P EQUAL 4)
  message(FATAL_ERROR "RGSS games are 32-bit, so the bridge must be built with -A Win32.")
endif()

add_library(wenbu-rgss SHARED src/bridge.cpp src/bridge.def)
add_executable(wenbu-rgss-inject src/inject.cpp)

foreach(target wenbu-rgss wenbu-rgss-inject)
  target_compile_definitions(${target} PRIVATE UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)
  target_compile_options(${target} PRIVATE /W4 /permissive- /utf-8)
  set_property(TARGET ${target} PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded")
endforeach()

target_link_libraries(wenbu-rgss PRIVATE user32 psapi)
