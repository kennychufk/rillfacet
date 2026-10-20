// Python bindings of rillfacet::CameraRaster (_rillfacet.CameraRaster), the
// engine of rillfacet.render.raster. Device memory is passed as integer
// pointers (torch's data_ptr()) and CUDA streams as integers (cuda_stream).

#include "rillfacet/camera_raster.h"

#include <nanobind/nanobind.h>
#include <nanobind/ndarray.h>
#include <nanobind/stl/vector.h>

#include "np_array.h"

#include <optional>
#include <stdexcept>

namespace nb = nanobind;
using namespace rillfacet;

namespace {

template <typename T>
using Arr = rfpy::Array<T>;

template <typename T>
Arr<T> checked(nb::handle h, int ndim, const char* what) {
  try {
    Arr<T> a(h);
    if (ndim >= 0 && int(a.ndim()) != ndim) throw std::invalid_argument("");
    return a;
  } catch (std::exception&) {
    throw std::invalid_argument(std::string("CameraRaster: bad array for ") + what);
  }
}

}  // namespace

void bind_camera_raster(nb::module_& m) {
  nb::class_<CameraRaster>(m, "CameraRaster",
                           "Batched camera rasterizer (rillfacet.render.raster).")
      .def(nb::init<bool>(), nb::arg("zero_copy") = true)
      .def_prop_ro("ok", &CameraRaster::ok)
      .def_prop_ro("zero_copy", &CameraRaster::zero_copy)
      .def_prop_ro("info", &CameraRaster::info)
      .def_prop_ro("seg16", &CameraRaster::seg16)
      .def("set_geometry", [](CameraRaster& r, nb::handle verts, nb::handle idx, nb::handle ranges) {
        auto v = checked<float>(verts, 2, "verts");
        auto i = checked<uint32_t>(idx, 1, "idx");
        auto g = checked<uint32_t>(ranges, 2, "ranges");
        if (v.shape(1) != 9 || g.shape(1) != 2) throw std::invalid_argument("CameraRaster.set_geometry: shapes");
        return r.set_geometry(v.data(), uint32_t(v.shape(0)), i.data(), uint32_t(i.shape(0)), g.data(),
                              uint32_t(g.shape(0)));
      })
      .def("set_textures", [](CameraRaster& r, nb::list mips) {
        std::vector<Arr<uint8_t>> keep;
        std::vector<const uint8_t*> ptrs;
        keep.reserve(mips.size());
        for (nb::handle h : mips) {
          keep.push_back(checked<uint8_t>(h, 4, "texture mip"));
          ptrs.push_back(keep.back().data());
        }
        if (keep.empty()) return false;
        return r.set_textures(uint32_t(keep[0].shape(1)), uint32_t(keep[0].shape(0)), ptrs);
      })
      .def("set_envmap", [](CameraRaster& r, nb::list mips) {
        std::vector<Arr<uint16_t>> keep;   // float16 bits (pass arr.view(np.uint16))
        std::vector<const uint16_t*> ptrs;
        keep.reserve(mips.size());
        for (nb::handle h : mips) {
          keep.push_back(checked<uint16_t>(h, 3, "envmap mip"));
          ptrs.push_back(keep.back().data());
        }
        if (keep.empty()) return false;
        return r.set_envmap(uint32_t(keep[0].shape(1)), uint32_t(keep[0].shape(0)), ptrs);
      })
      .def("set_brdf_lut", [](CameraRaster& r, nb::handle lut) {
        auto a = checked<uint16_t>(lut, 3, "brdf lut (float16 bits)");
        if (a.shape(0) != a.shape(1) || a.shape(2) != 4)
          throw std::invalid_argument("CameraRaster.set_brdf_lut: [n, n, 4]");
        return r.set_brdf_lut(uint32_t(a.shape(0)), a.data());
      })
      .def("set_materials", [](CameraRaster& r, nb::handle m) {
        auto a = checked<float>(m, 3, "materials");
        return r.set_materials(a.data(), uint32_t(a.shape(0)), uint32_t(a.shape(1)));
      })
      .def("set_lens", [](CameraRaster& r, nb::handle l) {
        auto a = checked<float>(l, 2, "lens");
        return r.set_lens(a.data(), uint32_t(a.shape(0)));
      })
      .def("set_frame", [](CameraRaster& r, nb::handle f) {
        auto a = checked<float>(f, 1, "frame");
        if (size_t(a.shape(0)) != CameraRaster::kFrameFloats)
          throw std::invalid_argument("CameraRaster.set_frame: wrong size");
        return r.set_frame(a.data());
      })
      .def_prop_ro_static("FRAME_FLOATS", [](nb::object) { return CameraRaster::kFrameFloats; })
      .def("add_view", [](CameraRaster& r, uint32_t width, uint32_t height, uint32_t proxy_width,
                          uint32_t proxy_height, float f, float cx, float cy, float near, float far,
                          uint32_t chunk, uint32_t sets, uint32_t shadow_res, uint32_t outputs,
                          uint32_t supersample, nb::handle remap) {
        auto a = checked<float>(remap, 2, "remap");
        if (a.shape(0) != size_t(width) * height || a.shape(1) != 8)
          throw std::invalid_argument("CameraRaster.add_view: remap must be [height * width, 8]");
        RasterViewConfig c;
        c.width = width; c.height = height;
        c.proxy_width = proxy_width; c.proxy_height = proxy_height;
        c.f = f; c.cx = cx; c.cy = cy; c.near = near; c.far = far;
        c.chunk = chunk; c.sets = sets; c.shadow_res = shadow_res;
        c.outputs = outputs; c.supersample = supersample;
        return r.add_view(c, a.data());
      }, nb::arg("width"), nb::arg("height"), nb::arg("proxy_width"), nb::arg("proxy_height"),
         nb::arg("f"), nb::arg("cx"), nb::arg("cy"), nb::arg("near"), nb::arg("far"),
         nb::arg("chunk"), nb::arg("sets"), nb::arg("shadow_res"), nb::arg("outputs"),
         nb::arg("supersample"), nb::arg("remap"))
      .def("remove_view", &CameraRaster::remove_view)
      .def("launch", [](CameraRaster& r, int view, int set, uint32_t e0, uint32_t n, uint64_t poses_dev,
                        uint64_t pitch, nb::object poses_host, uint64_t stream, uint32_t seed,
                        uint32_t outputs) {
        std::optional<Arr<float>> host;
        if (!poses_host.is_none()) host.emplace(checked<float>(poses_host, -1, "poses"));
        return r.launch(view, set, e0, n, poses_dev, pitch, host ? host->data() : nullptr,
                        stream, seed, outputs);
      }, nb::arg("view"), nb::arg("set"), nb::arg("e0"), nb::arg("n"), nb::arg("poses_dev") = 0,
         nb::arg("pitch") = 0, nb::arg("poses_host") = nb::none(), nb::arg("stream") = 0,
         nb::arg("seed") = 0, nb::arg("outputs") = 15)
      .def("collect", [](CameraRaster& r, int view, int set, uint32_t n, std::vector<uint64_t> dst,
                         uint64_t stream) {
        if (dst.size() != 4) throw std::invalid_argument("CameraRaster.collect: 4 pointers");
        return r.collect(view, set, n, dst.data(), stream);
      })
      .def("collect_host", [](CameraRaster& r, int view, int set, uint32_t n, nb::list dst) {
        if (dst.size() != 4) throw std::invalid_argument("CameraRaster.collect_host: 4 arrays");
        void* p[4] = {};
        for (size_t k = 0; k < 4; ++k) {
          if (dst[k].is_none()) continue;
          nb::ndarray<nb::c_contig, nb::device::cpu> a;
          if (!nb::try_cast(dst[k], a, /*convert=*/false))
            throw std::invalid_argument("CameraRaster.collect_host: writable C-contiguous arrays");
          p[k] = a.data();
        }
        return r.collect_host(view, set, n, p);
      })
      .def("wait_idle", &CameraRaster::wait_idle);
}
