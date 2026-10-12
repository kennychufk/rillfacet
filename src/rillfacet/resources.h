#pragma once
// Where the WGSL shaders and fonts live at runtime. An installed wheel carries
// them next to the extension module (<package>/shaders, <package>/assets); a
// source-tree build falls back to the directories compiled in, so shader edits
// still hot-reload there.

#include <string>

namespace rillfacet {

std::string shader_dir();
std::string asset_dir();

}  // namespace rillfacet
