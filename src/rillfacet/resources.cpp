#include "rillfacet/resources.h"

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#else
#include <dlfcn.h>
#endif

#include <filesystem>

namespace rillfacet {

namespace {

// Directory of the shared object (or executable) this code was linked into.
std::filesystem::path module_dir() {
#ifdef _WIN32
  HMODULE module = nullptr;
  if (GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                         reinterpret_cast<LPCWSTR>(&shader_dir), &module)) {
    wchar_t buf[MAX_PATH * 4];
    DWORD n = GetModuleFileNameW(module, buf, DWORD(sizeof buf / sizeof *buf));
    if (n > 0 && n < sizeof buf / sizeof *buf) return std::filesystem::path(buf).parent_path();
  }
#else
  Dl_info info{};
  if (dladdr(reinterpret_cast<void*>(&shader_dir), &info) && info.dli_fname)
    return std::filesystem::path(info.dli_fname).parent_path();
#endif
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
