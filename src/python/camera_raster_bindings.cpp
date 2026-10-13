// Python bindings of rillfacet::CameraRaster (_rillfacet.CameraRaster), the
// engine of rillfacet.render.raster. Device memory is passed as integer
// pointers (torch's data_ptr()) and CUDA streams as integers (cuda_stream).

#include "rillfacet/camera_raster.h"

#include <pybind11/numpy.h>
#include <pybind11/pybind11.h>
#include <pybind11/stl.h>

#include <stdexcept>

namespace py = pybind11;
using namespace rillfacet;

namespace {

template <typename T>
using Arr = py::array_t<T, py::array::c_style | py::array::forcecast>;

template <typename T>
Arr<T> checked(py::handle h, int ndim, const char* what) {
  auto a = Arr<T>::ensure(h);
  if (!a || (ndim >= 0 && a.ndim() != ndim))
    throw std::invalid_argument(std::string("CameraRaster: bad array for ") + what);
  return a;
}

}  // namespace

void bind_camera_raster(py::module_& m) {
  py::class_<CameraRaster>(m, "CameraRaster",
                           "Batched camera rasterizer (rillfacet.render.raster).")
      .def(py::init<bool>(), py::arg("zero_copy") = true)
      .def_property_readonly("ok", &CameraRaster::ok)
      .def_property_readonly("zero_copy", &CameraRaster::zero_copy)
      .def_property_readonly("info", &CameraRaster::info)
      .def_property_readonly("seg16", &CameraRaster::seg16)
      .def("set_geometry", [](CameraRaster& r, py::handle verts, py::handle idx, py::handle ranges) {
        auto v = checked<float>(verts, 2, "verts");
        auto i = checked<uint32_t>(idx, 1, "idx");
        auto g = checked<uint32_t>(ranges, 2, "ranges");
        if (v.shape(1) != 9 || g.shape(1) != 2) throw std::invalid_argument("CameraRaster.set_geometry: shapes");
        return r.set_geometry(v.data(), uint32_t(v.shape(0)), i.data(), uint32_t(i.shape(0)), g.data(),
                              uint32_t(g.shape(0)));
      })
      .def("set_textures", [](CameraRaster& r, py::list mips) {
        std::vector<Arr<uint8_t>> keep;
        std::vector<const uint8_t*> ptrs;
        for (auto h : mips) {
          keep.push_back(checked<uint8_t>(h, 4, "texture mip"));
          ptrs.push_back(keep.back().data());
        }
        if (keep.empty()) return false;
        return r.set_textures(uint32_t(keep[0].shape(1)), uint32_t(keep[0].shape(0)), ptrs);
      })
      .def("set_envmap", [](CameraRaster& r, py::list mips) {
        std::vector<Arr<uint16_t>> keep;   // float16 bits (pass arr.view(np.uint16))
        std::vector<const uint16_t*> ptrs;
        for (auto h : mips) {
          keep.push_back(checked<uint16_t>(h, 3, "envmap mip"));
          ptrs.push_back(keep.back().data());
        }
        if (keep.empty()) return false;
        return r.set_envmap(uint32_t(keep[0].shape(1)), uint32_t(keep[0].shape(0)), ptrs);
      })
      .def("set_brdf_lut", [](CameraRaster& r, py::handle lut) {
        auto a = checked<uint16_t>(lut, 3, "brdf lut (float16 bits)");
        if (a.shape(0) != a.shape(1) || a.shape(2) != 4)
          throw std::invalid_argument("CameraRaster.set_brdf_lut: [n, n, 4]");
        return r.set_brdf_lut(uint32_t(a.shape(0)), a.data());
      })
      .def("set_materials", [](CameraRaster& r, py::handle m) {
        auto a = checked<float>(m, 3, "materials");
        return r.set_materials(a.data(), uint32_t(a.shape(0)), uint32_t(a.shape(1)));
      })
      .def("set_lens", [](CameraRaster& r, py::handle l) {
        auto a = checked<float>(l, 2, "lens");
        return r.set_lens(a.data(), uint32_t(a.shape(0)));
      })
      .def("set_frame", [](CameraRaster& r, py::handle f) {
        auto a = checked<float>(f, 1, "frame");
        if (size_t(a.shape(0)) != CameraRaster::kFrameFloats)
          throw std::invalid_argument("CameraRaster.set_frame: wrong size");
        return r.set_frame(a.data());
      })
      .def_property_readonly_static("FRAME_FLOATS", [](py::object) { return CameraRaster::kFrameFloats; })
      .def("add_view", [](CameraRaster& r, uint32_t width, uint32_t height, uint32_t proxy_width,
                          uint32_t proxy_height, float f, float cx, float cy, float near, float far,
                          uint32_t chunk, uint32_t sets, uint32_t shadow_res, uint32_t outputs,
                          uint32_t supersample, py::handle remap) {
        auto a = checked<float>(remap, 2, "remap");
        if (a.shape(0) != py::ssize_t(width) * height || a.shape(1) != 8)
          throw std::invalid_argument("CameraRaster.add_view: remap must be [height * width, 8]");
        RasterViewConfig c;
        c.width = width; c.height = height;
        c.proxy_width = proxy_width; c.proxy_height = proxy_height;
        c.f = f; c.cx = cx; c.cy = cy; c.near = near; c.far = far;
        c.chunk = chunk; c.sets = sets; c.shadow_res = shadow_res;
        c.outputs = outputs; c.supersample = supersample;
        return r.add_view(c, a.data());
      }, py::arg("width"), py::arg("height"), py::arg("proxy_width"), py::arg("proxy_height"),
         py::arg("f"), py::arg("cx"), py::arg("cy"), py::arg("near"), py::arg("far"),
         py::arg("chunk"), py::arg("sets"), py::arg("shadow_res"), py::arg("outputs"),
         py::arg("supersample"), py::arg("remap"))
      .def("remove_view", &CameraRaster::remove_view)
      .def("launch", [](CameraRaster& r, int view, int set, uint32_t e0, uint32_t n, uint64_t poses_dev,
                        uint64_t pitch, py::object poses_host, uint64_t stream, uint32_t seed,
                        uint32_t outputs) {
        Arr<float> host;
        if (!poses_host.is_none()) host = checked<float>(poses_host, -1, "poses");
        return r.launch(view, set, e0, n, poses_dev, pitch, poses_host.is_none() ? nullptr : host.data(),
                        stream, seed, outputs);
      }, py::arg("view"), py::arg("set"), py::arg("e0"), py::arg("n"), py::arg("poses_dev") = 0,
         py::arg("pitch") = 0, py::arg("poses_host") = py::none(), py::arg("stream") = 0,
         py::arg("seed") = 0, py::arg("outputs") = 15)
      .def("collect", [](CameraRaster& r, int view, int set, uint32_t n, std::vector<uint64_t> dst,
                         uint64_t stream) {
        if (dst.size() != 4) throw std::invalid_argument("CameraRaster.collect: 4 pointers");
        return r.collect(view, set, n, dst.data(), stream);
      })
      .def("collect_host", [](CameraRaster& r, int view, int set, uint32_t n, py::list dst) {
        if (dst.size() != 4) throw std::invalid_argument("CameraRaster.collect_host: 4 arrays");
        void* p[4] = {};
        for (size_t k = 0; k < 4; ++k) {
          if (dst[k].is_none()) continue;
          auto a = py::array::ensure(dst[k]);
          if (!a || !(a.flags() & py::array::c_style) || !a.writeable())
            throw std::invalid_argument("CameraRaster.collect_host: writable C-contiguous arrays");
          p[k] = a.mutable_data();
        }
        return r.collect_host(view, set, n, p);
      })
      .def("wait_idle", &CameraRaster::wait_idle);
}
