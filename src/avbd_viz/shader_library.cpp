#include "avbd_viz/shader_library.h"

#include <chrono>
#include <fstream>
#include <sstream>

namespace avbd_viz {

namespace fs = std::filesystem;

ShaderLibrary::ShaderLibrary(std::string root) : root_(std::move(root)) {}

bool ShaderLibrary::expand(const std::string& path,
                           const std::map<std::string, std::string>& aliases, std::string& out,
                           std::string* error, int depth) {
  if (depth > 16) {
    if (error) *error = "include depth exceeded at " + path;
    return false;
  }
  fs::path full = fs::path(root_) / path;
  std::ifstream in(full);
  if (!in) {
    if (error) *error = "cannot open shader " + full.string();
    return false;
  }
  std::error_code ec;
  watched_[full.string()] = fs::last_write_time(full, ec);

  std::string line;
  int line_no = 0;
  while (std::getline(in, line)) {
    ++line_no;
    size_t p = line.find_first_not_of(" \t");
    if (p != std::string::npos && line.compare(p, 8, "#include") == 0) {
      std::string arg = line.substr(p + 8);
      arg.erase(0, arg.find_first_not_of(" \t"));
      arg.erase(arg.find_last_not_of(" \t\r") + 1);
      std::string target;
      if (arg.size() >= 2 && arg.front() == '"' && arg.back() == '"') {
        target = arg.substr(1, arg.size() - 2);
      } else if (auto it = aliases.find(arg); it != aliases.end()) {
        target = it->second;
      } else {
        if (error)
          *error = path + ":" + std::to_string(line_no) + ": unknown include '" + arg + "'";
        return false;
      }
      out += "// ---- begin " + target + "\n";
      if (!expand(target, aliases, out, error, depth + 1)) return false;
      out += "// ---- end " + target + "\n";
    } else {
      out += line;
      out += '\n';
    }
  }
  return true;
}

wgpu::ShaderModule ShaderLibrary::compile(const Gpu& gpu, const std::string& path,
                                          const std::map<std::string, std::string>& aliases,
                                          std::string* error) {
  std::string source;
  if (!expand(path, aliases, source, error, 0)) return nullptr;

  wgpu::ShaderSourceWGSL wgsl{};
  wgsl.code = wgpu::StringView(source.data(), source.size());
  wgpu::ShaderModuleDescriptor desc{};
  desc.nextInChain = &wgsl;
  desc.label = wgpu::StringView(path.data(), path.size());

  gpu.push_error_scope();
  wgpu::ShaderModule module = gpu.device.CreateShaderModule(&desc);
  std::string err = gpu.pop_error_scope();
  if (!err.empty()) {
    if (error) *error = path + ": " + err;
    return nullptr;
  }
  return module;
}

bool ShaderLibrary::poll_changes() {
  using clock = std::chrono::steady_clock;
  double now = std::chrono::duration<double>(clock::now().time_since_epoch()).count();
  if (now - last_poll_ < 0.25) return false;
  last_poll_ = now;
  bool changed = false;
  for (auto& [file, stamp] : watched_) {
    std::error_code ec;
    auto t = fs::last_write_time(file, ec);
    if (!ec && t != stamp) {
      stamp = t;
      changed = true;
    }
  }
  return changed;
}

}  // namespace avbd_viz
