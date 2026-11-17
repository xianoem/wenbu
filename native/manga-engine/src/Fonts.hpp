// Installed fonts as the worker finds them (wenbu_manga/fonts.py): the faces in Windows' font folders are
// indexed by family and style, and a family's regular, bold, italic and bold italic faces are copied (or
// taken out of a collection) into a folder of the font cache that the lettering reads like any font folder.
#pragma once

#include <filesystem>
#include <string>

namespace engine {

// resolve: the folder holding the family's faces; throws with a message for the user when it is not installed.
std::filesystem::path resolveFont(const std::string& family, const std::filesystem::path& cache);

}
