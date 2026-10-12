#include "rillfacet/resources.h"

#include <dlfcn.h>

#include <filesystem>

namespace rillfacet {

namespace {

// Directory of the shared object (or executable) this code was linked into.
std::filesystem::path module_dir() {
  Dl_info info{};
  if (dladdr(reinterpret_cast<void*>(&shader_dir), &info) && info.dli_fname)
    return std::filesystem::path(info.dli_fname).parent_path();
  return {};
}

std::string resolve(const char* name, const char* compiled_in) {
  std::filesystem::path installed = module_dir() / name;
  std::error_code ec;
  if (!installed.empty() && std::filesystem::is_directory(installed, ec)) return installed.string();
  return compiled_in;
}

}  // namespace

std::string shader_dir() { return resolve("shaders", RILLFACET_SHADER_DIR); }
std::string asset_dir() { return resolve("assets", RILLFACET_ASSET_DIR); }

}  // namespace rillfacet
