// The prebuilt Skia was compiled with a newer MSVC whose standard library calls these vectorized helpers
// from its import library. Older Build Tools lack them, so they are defined here under other names with the
// semantics of the algorithms that call them. /alternatename makes the linker use them only when the
// toolset's library does not define the real ones.

#include <algorithm>
#include <cstddef>

#pragma comment(linker, "/alternatename:__std_min_element_f=wenbu_std_min_element_f")
#pragma comment(linker, "/alternatename:__std_max_element_f=wenbu_std_max_element_f")
#pragma comment(linker, "/alternatename:__std_minmax_element_f=wenbu_std_minmax_element_f")
#pragma comment(linker, "/alternatename:__std_search_1=wenbu_std_search_1")

extern "C" {

const void* __stdcall wenbu_std_min_element_f(const void* first, const void* last, bool) noexcept {
    return std::min_element(static_cast<const float*>(first), static_cast<const float*>(last));
}

const void* __stdcall wenbu_std_max_element_f(const void* first, const void* last, bool) noexcept {
    return std::max_element(static_cast<const float*>(first), static_cast<const float*>(last));
}

_Min_max_element_t __stdcall wenbu_std_minmax_element_f(const void* first, const void* last, bool) noexcept {
    const auto [smallest, largest] =
        std::minmax_element(static_cast<const float*>(first), static_cast<const float*>(last));

    return {smallest, largest};
}

const void* __stdcall wenbu_std_search_1(const void* first1, const void* last1, const void* first2,
                                         std::size_t count2) noexcept {
    const auto* begin = static_cast<const unsigned char*>(first2);

    return std::search(static_cast<const unsigned char*>(first1), static_cast<const unsigned char*>(last1), begin,
                       begin + count2);
}

}
