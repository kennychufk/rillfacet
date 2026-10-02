#pragma once
// Loads WGSL from disk with a tiny `#include "file.wgsl"` preprocessor and
// watches the files so edited shaders hot-reload while the viewer runs.

#include "rillfacet/gpu.h"

#include <filesystem>
#include <map>
#include <string>

namespace rillfacet {

class ShaderLibrary {
 public:
  explicit ShaderLibrary(std::string root);

  // Compiles `path` (relative to the shader root). `aliases` maps symbolic
  // include names to files, e.g. {"STYLE", "styles/studio.wgsl"} lets
  // `#include STYLE` pick a shading style per pipeline. On failure returns a
  // null module and fills `error`.
  wgpu::ShaderModule compile(const Gpu& gpu, const std::string& path,
                             const std::map<std::string, std::string>& aliases,
                             std::string* error);

  // Returns true (at most every 250 ms) when any loaded file changed on disk.
  bool poll_changes();

  const std::string& root() const { return root_; }

 private:
  bool expand(const std::string& path, const std::map<std::string, std::string>& aliases,
              std::string& out, std::string* error, int depth);

  std::string root_;
  std::map<std::string, std::filesystem::file_time_type> watched_;
  double last_poll_ = 0.0;
};

}  // namespace rillfacet
