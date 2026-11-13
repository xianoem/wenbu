cmake_minimum_required(VERSION 3.20)

project(WenbuScreenAiOcr LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(wenbu-screen-ai-ocr src/main.cpp)

if(MSVC)
  target_compile_definitions(wenbu-screen-ai-ocr PRIVATE UNICODE _UNICODE NOMINMAX)
  target_compile_options(wenbu-screen-ai-ocr PRIVATE /W4 /permissive- /utf-8)
  set_property(TARGET wenbu-screen-ai-ocr PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded")
else()
  target_compile_options(wenbu-screen-ai-ocr PRIVATE -Wall -Wextra)
  target_link_libraries(wenbu-screen-ai-ocr PRIVATE ${CMAKE_DL_LIBS})
endif()
