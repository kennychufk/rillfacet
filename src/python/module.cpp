// Python bindings: `import rillfacet`.
//
// Arrays can be numpy arrays, nested lists, or torch tensors (moved to the
// CPU first). Structures are owned by the scene: a Python handle to a removed
// structure must not be used. `rillfacet.imgui` is a Dear ImGui subset named
// like polyscope.imgui, for per-frame UI in the viewer callback.

#include "rillfacet/resources.h"
#include "rillfacet/viewer.h"

#include <imgui.h>
#include <implot.h>
#include <nanobind/nanobind.h>
#include <nanobind/stl/bind_vector.h>
#include <nanobind/stl/function.h>
#include <nanobind/stl/pair.h>
#include <nanobind/stl/string.h>
#include <nanobind/stl/vector.h>

#include "np_array.h"

#include <algorithm>
#include <cfloat>
#include <cmath>
#include <cstring>
#include <memory>

namespace nb = nanobind;
using namespace rillfacet;
using rfpy::Array;

NB_MAKE_OPAQUE(std::vector<Measurement>);

void bind_camera_raster(nb::module_& m);   // camera_raster_bindings.cpp

// ---- glm vectors <-> Python sequences ---------------------------------------------

namespace nanobind::detail {
template <int N>
struct glm_vec_caster {
  using V = glm::vec<N, float>;
  NB_TYPE_CASTER(V, const_name("tuple[float, ...]"))
  bool from_python(handle src, uint8_t, cleanup_list*) noexcept {
    PyObject* o = src.ptr();
    if (!o || !PySequence_Check(o) || PyUnicode_Check(o) || PySequence_Size(o) != N) {
      PyErr_Clear();
      return false;
    }
    for (int i = 0; i < N; ++i) {
      PyObject* item = PySequence_GetItem(o, i);
      double x = item ? PyFloat_AsDouble(item) : -1.0;
      Py_XDECREF(item);
      if (x == -1.0 && PyErr_Occurred()) {
        PyErr_Clear();
        return false;
      }
      value[i] = float(x);
    }
    return true;
  }
  static handle from_cpp(const V& v, rv_policy, cleanup_list*) noexcept {
    PyObject* t = PyTuple_New(N);
    if (!t) return handle();
    for (int i = 0; i < N; ++i) PyTuple_SetItem(t, i, PyFloat_FromDouble(double(v[i])));
    return t;
  }
};
template <>
struct type_caster<glm::vec2> : glm_vec_caster<2> {};
template <>
struct type_caster<glm::vec3> : glm_vec_caster<3> {};
template <>
struct type_caster<glm::vec4> : glm_vec_caster<4> {};
}  // namespace nanobind::detail

namespace {

template <class T>
std::vector<T> as_vector(nb::handle h) {
  Array<T> a(h);
  return std::vector<T>(a.data(), a.data() + a.size());
}

nb::object to_numpy(const std::vector<float>& v, size_t cols) {
  size_t rows = cols ? v.size() / cols : v.size();
  return rfpy::new_array<float>(v, cols > 1 ? std::vector<size_t>{rows, cols} : std::vector<size_t>{rows});
}

glm::mat4 mat4_from(nb::handle h) {
  Array<double> a(h);
  if (a.size() != 16) throw nb::value_error("expected a 4x4 matrix");
  glm::mat4 T;
  for (int r = 0; r < 4; ++r)
    for (int c = 0; c < 4; ++c) T[c][r] = float(a.data()[4 * r + c]);  // row-major in, column-major glm
  return T;
}

nb::object mat4_to_numpy(const glm::mat4& T) {
  std::vector<double> out(16);
  for (int r = 0; r < 4; ++r)
    for (int c = 0; c < 4; ++c) out[4 * r + c] = T[c][r];
  return rfpy::new_array<double>(std::move(out), {4, 4});
}

// [H, W, 3|4] image -> RGBA8. uint8 is taken as is; floats are 0..1.
std::vector<uint8_t> image_rgba8(nb::handle h, uint32_t& width, uint32_t& height) {
  nb::object arr = nb::module_::import_("numpy").attr("asarray")(rfpy::to_numpy_object(h));
  const bool is_u8 = nb::cast<std::string>(arr.attr("dtype").attr("name")) == "uint8";
  if (nb::cast<size_t>(arr.attr("ndim")) != 3) throw nb::value_error("expected an [H, W, 3] or [H, W, 4] image");
  const size_t ch = nb::cast<size_t>(arr.attr("shape")[2]);
  if (ch != 3 && ch != 4) throw nb::value_error("expected an [H, W, 3] or [H, W, 4] image");
  height = nb::cast<uint32_t>(arr.attr("shape")[0]);
  width = nb::cast<uint32_t>(arr.attr("shape")[1]);
  const size_t n = size_t(width) * height;
  std::vector<uint8_t> rgba(4 * n, 255);
  if (is_u8) {
    Array<uint8_t> a(arr);
    const uint8_t* src = a.data();
    for (size_t i = 0; i < n; ++i)
      for (size_t k = 0; k < ch; ++k) rgba[4 * i + k] = src[ch * i + k];
  } else {
    Array<float> a(arr);
    const float* src = a.data();
    for (size_t i = 0; i < n; ++i)
      for (size_t k = 0; k < ch; ++k)
        rgba[4 * i + k] = uint8_t(std::lround(std::clamp(src[ch * i + k], 0.0f, 1.0f) * 255.0f));
  }
  return rgba;
}

int colormap_index(nb::handle h) {
  if (nb::isinstance<nb::str>(h)) {
    std::string name = nb::cast<std::string>(h);
    for (int i = 0; i < colormap_count(); ++i)
      if (name == colormap_name(i)) return i;
    throw nb::value_error(("unknown colormap '" + name + "'").c_str());
  }
  return nb::cast<int>(h);
}

// An exception raised in the viewer callback is kept until the frame is
// finished, then re-raised from Viewer.frame()/run().
std::unique_ptr<nb::python_error> g_callback_error;

void rethrow_callback_error() {
  if (g_callback_error) {
    std::unique_ptr<nb::python_error> e = std::move(g_callback_error);
    throw *e;
  }
}

}  // namespace

static void bind_imgui(nb::module_ m);
static void bind_implot(nb::module_ m);

NB_MODULE(_rillfacet, m) {
  // A viewer kept in a global (a script, a test fixture) is still alive when the interpreter exits.
  nb::set_leak_warnings(false);
  bind_camera_raster(m);
  m.doc() = "rillfacet: real-time scientific viewer (WebGPU)";

  // ---- Enums ----
  nb::enum_<ElementKind>(m, "ElementKind", nb::is_arithmetic())
      .value("Vertex", ElementKind::Vertex)
      .value("Edge", ElementKind::Edge)
      .value("Face", ElementKind::Face)
      .value("Segment", ElementKind::Segment)
      .value("Cell", ElementKind::Cell);
  nb::enum_<QuantityType>(m, "QuantityType", nb::is_arithmetic())
      .value("Scalar", QuantityType::Scalar)
      .value("Vector", QuantityType::Vector)
      .value("Color", QuantityType::Color);
  nb::enum_<ColorSource>(m, "ColorSource", nb::is_arithmetic())
      .value("Uniform", ColorSource::Uniform)
      .value("SegmentPalette", ColorSource::SegmentPalette)
      .value("Quantity", ColorSource::Quantity)
      .value("Texture", ColorSource::Texture);
  nb::enum_<Style>(m, "Style", nb::is_arithmetic())
      .value("Studio", Style::Studio)
      .value("MatCap", Style::MatCap)
      .value("EnvironmentPBR", Style::EnvironmentPBR)
      .value("Technical", Style::Technical);
  nb::enum_<Theme>(m, "Theme", nb::is_arithmetic()).value("Dark", Theme::Dark).value("Light", Theme::Light);
  nb::enum_<Shading>(m, "Shading", nb::is_arithmetic()).value("Solid", Shading::Solid).value("Wireframe", Shading::Wireframe);
  nb::enum_<OutlineMode>(m, "OutlineMode", nb::is_arithmetic())
      .value("Off", OutlineMode::Off)
      .value("Silhouettes", OutlineMode::Silhouettes)
      .value("SilhouettesAndCreases", OutlineMode::SilhouettesAndCreases);
  nb::enum_<PickMode>(m, "PickMode", nb::is_arithmetic())
      .value("Vertex", PickMode::Vertex)
      .value("Edge", PickMode::Edge)
      .value("Face", PickMode::Face)
      .value("Body", PickMode::Segment);
  nb::enum_<ViewPreset>(m, "ViewPreset", nb::is_arithmetic())
      .value("Front", ViewPreset::Front)
      .value("Back", ViewPreset::Back)
      .value("Right", ViewPreset::Right)
      .value("Left", ViewPreset::Left)
      .value("Top", ViewPreset::Top)
      .value("Bottom", ViewPreset::Bottom);
  nb::enum_<MatcapPreset>(m, "MatcapPreset", nb::is_arithmetic())
      .value("Clay", MatcapPreset::Clay)
      .value("Porcelain", MatcapPreset::Porcelain)
      .value("Chrome", MatcapPreset::Chrome)
      .value("Toon", MatcapPreset::Toon);
  nb::enum_<EnvironmentPreset>(m, "EnvironmentPreset", nb::is_arithmetic())
      .value("Studio", EnvironmentPreset::Studio)
      .value("Sky", EnvironmentPreset::Sky)
      .value("Soft", EnvironmentPreset::Soft);

  m.def("colormap_names", []() {
    std::vector<std::string> names;
    for (int i = 0; i < colormap_count(); ++i) names.push_back(colormap_name(i));
    return names;
  });

  m.def("font_atlas", [](const std::string& path) {
    // The 3D-label font exactly as the renderer builds it (SDF atlas + glyph
    // metrics), for clients that draw text themselves (the web viewer).
    Font f;
    if (!f.load(path.empty() ? rillfacet::asset_dir() + "/fonts/Inter-SemiBold.ttf" : path))
      throw std::runtime_error("cannot load font " + path);
    nb::object atlas = rfpy::new_array<uint8_t>(std::vector<uint8_t>(f.atlas().begin(), f.atlas().end()),
                                                {size_t(f.atlas_height()), size_t(f.atlas_width())});
    nb::dict glyphs;
    for (const auto& [cp, g] : f.glyphs())
      glyphs[nb::int_(cp)] = nb::make_tuple(g.advance, nb::make_tuple(g.uv.x, g.uv.y, g.uv.z, g.uv.w),
                                            nb::make_tuple(g.offset.x, g.offset.y),
                                            nb::make_tuple(g.size.x, g.size.y));
    nb::dict out;
    out["atlas"] = atlas;
    out["base_px"] = f.base_px();
    out["ascent"] = f.ascent();
    out["line_height"] = f.line_height();
    out["sdf_per_px"] = f.sdf_per_px();
    out["glyphs"] = glyphs;
    return out;
  }, nb::arg("path") = "", "SDF atlas [H, W] uint8 and glyph metrics (advance, uv, offset, size) of the label font.");

  // ---- Quantities and structures ----
  nb::class_<Quantity>(m, "Quantity")
      .def_ro("name", &Quantity::name)
      .def_ro("on", &Quantity::on)
      .def_ro("type", &Quantity::type)
      .def_prop_ro("data", [](const Quantity& q) { return to_numpy(q.data, q.dims); })
      .def_rw("show_arrows", &Quantity::show_arrows)
      .def_rw("arrow_scale", &Quantity::arrow_scale)
      .def_rw("arrow_radius", &Quantity::arrow_radius)
      .def_rw("arrow_color", &Quantity::arrow_color);

  nb::class_<Structure>(m, "Structure")
      .def_prop_ro("name", &Structure::name)
      .def_prop_ro("id", &Structure::id)
      .def_prop_ro("kind", [](const Structure& s) { return std::string(structure_kind_name(s.kind())); })
      .def_rw("visible", &Structure::visible)
      .def_rw("opacity", &Structure::opacity)
      .def_rw("sliced", &Structure::sliced)
      .def_rw("draggable", &Structure::draggable, "Ctrl+LMB can grab it (when the viewer's drag is enabled).")
      .def_prop_rw("transform", [](const Structure& s) { return mat4_to_numpy(s.transform()); },
                    [](Structure& s, nb::handle T) { s.set_transform(mat4_from(T)); },
                    "4x4 world-from-local placement. Once set, geometry setters take local coordinates.")
      .def("bounds", [](const Structure& s) -> nb::object {
        glm::vec3 lo, hi;
        if (!s.bounds(lo, hi)) return nb::none();
        return nb::make_tuple(lo, hi);
      });

  auto touch = [](QuantityStructure& q) { q.touch_attributes(); };
  nb::class_<QuantityStructure, Structure>(m, "QuantityStructure")
      .def("count", &QuantityStructure::count)
      .def_prop_rw("color", [](const QuantityStructure& q) { return q.color; },
                    [touch](QuantityStructure& q, glm::vec3 c) { q.color = c; touch(q); })
      .def_prop_rw("color_source", [](const QuantityStructure& q) { return q.color_source; },
                    [touch](QuantityStructure& q, ColorSource c) { q.color_source = c; touch(q); })
      // Names the quantity used when color_source is Quantity; setting it does
      // not change color_source (the C++ field behaves the same way).
      .def_prop_rw("color_quantity", [](const QuantityStructure& q) { return q.color_quantity; },
                    [touch](QuantityStructure& q, const std::string& n) {
                      q.color_quantity = n;
                      touch(q);
                    })
      .def_prop_rw("colormap", [](const QuantityStructure& q) { return std::string(colormap_name(q.colormap)); },
                    [](QuantityStructure& q, nb::handle h) { q.colormap = colormap_index(h); })
      .def_prop_rw("range", [](const QuantityStructure& q) { return q.range; },
                    [](QuantityStructure& q, glm::vec2 r) {
                      q.range = r;
                      q.auto_range = false;
                    })
      .def_rw("auto_range", &QuantityStructure::auto_range)
      .def_rw("isolines", &QuantityStructure::isolines)
      .def_rw("isoline_spacing", &QuantityStructure::isoline_spacing)
      .def_rw("metallic", &QuantityStructure::metallic)
      .def_rw("roughness", &QuantityStructure::roughness)
      .def("add_scalar", [](QuantityStructure& q, const std::string& name, ElementKind on, nb::handle v) -> Quantity& {
             return q.add_scalar(name, on, as_vector<float>(v));
           }, nb::arg("name"), nb::arg("on"), nb::arg("values"), nb::rv_policy::reference_internal)
      .def("add_vector", [](QuantityStructure& q, const std::string& name, ElementKind on, nb::handle v) -> Quantity& {
             return q.add_vector(name, on, as_vector<float>(v));
           }, nb::arg("name"), nb::arg("on"), nb::arg("vectors"), nb::rv_policy::reference_internal)
      .def("add_color", [](QuantityStructure& q, const std::string& name, ElementKind on, nb::handle v) -> Quantity& {
             return q.add_color(name, on, as_vector<float>(v));
           }, nb::arg("name"), nb::arg("on"), nb::arg("rgb"), nb::rv_policy::reference_internal)
      .def("quantity", nb::overload_cast<const std::string&>(&QuantityStructure::quantity),
           nb::rv_policy::reference_internal)
      .def("remove_quantity", &QuantityStructure::remove_quantity)
      .def("touch_attributes", &QuantityStructure::touch_attributes,
           "Mark display settings changed when fields were written in place.")
      .def_prop_ro("quantity_names", [](const QuantityStructure& q) {
        std::vector<std::string> n;
        for (const Quantity& x : q.quantities()) n.push_back(x.name);
        return n;
      });

  nb::class_<SurfaceMesh, QuantityStructure>(m, "SurfaceMesh")
      .def("set_geometry", [](SurfaceMesh& s, nb::handle v, nb::handle t) {
        auto va = as_vector<float>(v);
        auto ta = as_vector<uint32_t>(t);
        s.set_geometry(va.data(), va.size() / 3, ta.data(), ta.size() / 3);
      }, nb::arg("vertices"), nb::arg("triangles"))
      .def("set_positions", [](SurfaceMesh& s, nb::handle v) {
        Array<float> a(v);
        if (a.size() != s.positions().size()) throw nb::value_error("vertex count changed; use set_geometry");
        s.set_positions(a.data());
      })
      .def("set_segments", [](SurfaceMesh& s, nb::handle offsets, std::vector<std::string> names) {
        s.set_segments(as_vector<uint32_t>(offsets), std::move(names));
      }, nb::arg("triangle_offsets"), nb::arg("names") = std::vector<std::string>{})
      .def("set_segment_visible", &SurfaceMesh::set_segment_visible)
      .def("segment_visible", &SurfaceMesh::segment_visible)
      .def("segment_hidden_by_app", &SurfaceMesh::segment_hidden_by_app)
      .def("set_segment_hidden_by_user", &SurfaceMesh::set_segment_hidden_by_user)
      .def("segment_hidden_by_user", &SurfaceMesh::segment_hidden_by_user)
      .def("unhide_all_by_user", &SurfaceMesh::unhide_all_by_user)
      .def("set_segment_color", &SurfaceMesh::set_segment_color)
      .def("segment_color", &SurfaceMesh::segment_color)
      .def("segment_name", &SurfaceMesh::segment_name)
      .def("segment_of_face", &SurfaceMesh::segment_of_face)
      .def("segment_of_vertex", &SurfaceMesh::segment_of_vertex)
      .def_prop_ro("num_vertices", &SurfaceMesh::num_vertices)
      .def_prop_ro("num_faces", &SurfaceMesh::num_faces)
      .def_prop_ro("num_segments", &SurfaceMesh::num_segments)
      .def_prop_ro("num_edges", &SurfaceMesh::num_edges)
      .def_prop_ro("positions", [](const SurfaceMesh& s) { return to_numpy(s.positions(), 3); })
      .def_prop_ro("edges", [](const SurfaceMesh& s) {
        const auto& e = s.edges();
        return rfpy::new_array<uint32_t>(std::vector<uint32_t>(e.begin(), e.end()), {e.size() / 2, 2});
      }, "Unique edges [E, 2], the order of Edge quantities.")
      .def("set_uvs", [](SurfaceMesh& s, nb::handle uv) {
        auto a = as_vector<float>(uv);
        if (a.size() != 2 * s.num_vertices()) throw nb::value_error("need 2 texture coordinates per vertex");
        s.set_uvs(a.data(), s.num_vertices());
      }, nb::arg("uv"), "Texture coordinates [V, 2] (origin at the image's top-left) for ColorSource.Texture.")
      .def_rw("texture", &SurfaceMesh::texture, "Scene image sampled with ColorSource.Texture.")
      .def_rw("unlit", &SurfaceMesh::unlit, "Show the base color as is, without lighting.")
      .def_rw("smooth_shading", &SurfaceMesh::smooth_shading)
      .def_rw("rigid_segments", &SurfaceMesh::rigid_segments);

  nb::class_<PointCloud, QuantityStructure>(m, "PointCloud")
      .def("set_points", [](PointCloud& p, nb::handle xyz, nb::object radii) {
        auto a = as_vector<float>(xyz);
        std::vector<float> r;
        if (!radii.is_none()) r = as_vector<float>(radii);
        p.set_points(a.data(), a.size() / 3, r.empty() ? nullptr : r.data());
      }, nb::arg("points"), nb::arg("radii") = nb::none())
      .def_prop_ro("size", &PointCloud::size)
      .def_rw("radius", &PointCloud::radius);

  nb::class_<CurveNetwork, QuantityStructure>(m, "CurveNetwork")
      .def("set_nodes", [](CurveNetwork& c, nb::handle xyz) {
        auto a = as_vector<float>(xyz);
        c.set_nodes(a.data(), a.size() / 3);
      })
      .def("set_edges", [](CurveNetwork& c, nb::handle e) {
        auto a = as_vector<uint32_t>(e);
        c.set_edges(a.data(), a.size() / 2);
      })
      .def("set_polyline", [](CurveNetwork& c, nb::handle xyz, bool closed) {
        auto a = as_vector<float>(xyz);
        c.set_polyline(a.data(), a.size() / 3, closed);
      }, nb::arg("points"), nb::arg("closed") = false)
      .def_prop_ro("num_nodes", &CurveNetwork::num_nodes)
      .def_prop_ro("num_edges", &CurveNetwork::num_edges)
      .def_rw("radius", &CurveNetwork::radius);

  nb::class_<VolumeMesh, QuantityStructure>(m, "VolumeMesh")
      .def("set_geometry", [](VolumeMesh& v, nb::handle xyz, nb::handle tets) {
        auto a = as_vector<float>(xyz);
        auto t = as_vector<uint32_t>(tets);
        v.set_geometry(a.data(), a.size() / 3, t.data(), t.size() / 4);
      }, nb::arg("vertices"), nb::arg("tets"))
      .def("set_positions", [](VolumeMesh& v, nb::handle xyz) {
        Array<float> a(xyz);
        if (a.size() != v.positions().size()) throw nb::value_error("vertex count changed; use set_geometry");
        v.set_positions(a.data());
      })
      .def_prop_ro("num_vertices", &VolumeMesh::num_vertices)
      .def_prop_ro("num_cells", &VolumeMesh::num_cells);

  nb::class_<VectorSet, Structure>(m, "VectorSet")
      .def("set_vectors", [](VectorSet& v, nb::handle o, nb::handle d) {
        auto a = as_vector<float>(o);
        auto b = as_vector<float>(d);
        if (a.size() != b.size()) throw nb::value_error("origins and vectors differ in length");
        v.set_vectors(a.data(), b.data(), a.size() / 3);
      })
      .def_prop_ro("size", &VectorSet::size)
      .def_rw("radius", &VectorSet::radius)
      .def_rw("length_scale", &VectorSet::length_scale)
      .def_rw("color", &VectorSet::color);

  auto ref = nb::rv_policy::reference_internal;
  nb::class_<Scene>(m, "Scene")
      .def("add_mesh", &Scene::add_mesh, ref)
      .def("add_points", &Scene::add_points, ref)
      .def("add_curves", &Scene::add_curves, ref)
      .def("add_volume", &Scene::add_volume, ref)
      .def("add_vectors", &Scene::add_vectors, ref)
      .def("remove", &Scene::remove)
      .def("clear", &Scene::clear)
      .def("get", [](const Scene& s, const std::string& name) { return s.find(name); }, ref)
      .def_prop_ro("names", [](const Scene& s) {
        std::vector<std::string> n;
        for (const auto& x : s.structures()) n.push_back(x->name());
        return n;
      })
      .def("bounds", [](const Scene& s) -> nb::object {
        glm::vec3 lo, hi;
        if (!s.bounds(lo, hi)) return nb::none();
        return nb::make_tuple(lo, hi);
      })
      .def("set_image", [](Scene& s, const std::string& name, nb::handle image) {
        uint32_t w = 0, h = 0;
        auto rgba = image_rgba8(image, w, h);
        s.set_image(name, w, h, std::move(rgba));
      }, nb::arg("name"), nb::arg("image"),
         "Named [H, W, 3|4] image (uint8, or floats in 0..1), top row first; replaces any previous one.")
      .def("remove_image", &Scene::remove_image)
      .def("has_image", [](const Scene& s, const std::string& name) { return s.image(name) != nullptr; })
      .def("image_size", [](const Scene& s, const std::string& name) -> nb::object {
        const Scene::Image* im = s.image(name);
        if (!im) return nb::none();
        return nb::make_tuple(im->height, im->width);
      }, "(height, width) of an image, or None.");

  // ---- Settings, camera, selection, overlay ----
  nb::class_<SlicePlane>(m, "SlicePlane")
      .def_rw("enabled", &SlicePlane::enabled)
      .def_rw("axis", &SlicePlane::axis)
      .def_rw("offset", &SlicePlane::offset)
      .def_rw("flip", &SlicePlane::flip)
      .def_rw("show", &SlicePlane::show);

  nb::class_<RenderSettings>(m, "RenderSettings")
      .def_rw("shading", &RenderSettings::shading)
      .def_prop_rw("style", [](const RenderSettings& s) { return s.style; },
                    [](RenderSettings& s, Style st) { s.apply_style_defaults(st); })
      .def_rw("theme", &RenderSettings::theme)
      .def_rw("wireframe", &RenderSettings::wireframe)
      .def_rw("wire_width", &RenderSettings::wire_width)
      .def_rw("flat_edge_angle", &RenderSettings::flat_edge_angle)
      .def_rw("wire_object_colors", &RenderSettings::wire_object_colors)
      .def_rw("face_opacity", &RenderSettings::face_opacity)
      .def_rw("shadows", &RenderSettings::shadows)
      .def_rw("shadow_strength", &RenderSettings::shadow_strength)
      .def_rw("sun_dir", &RenderSettings::sun_dir)
      .def_rw("ssao", &RenderSettings::ssao)
      .def_rw("ao_strength", &RenderSettings::ao_strength)
      .def_rw("ao_radius", &RenderSettings::ao_radius)
      .def_rw("outline", &RenderSettings::outline)
      .def_rw("outline_width", &RenderSettings::outline_width)
      .def_rw("exposure", &RenderSettings::exposure)
      .def_rw("grid", &RenderSettings::grid)
      .def_rw("ground_shadow", &RenderSettings::ground_shadow)
      .def_rw("ground_height", &RenderSettings::ground_height)
      .def_prop_ro("slice", [](RenderSettings& s) -> SlicePlane& { return s.slice; }, ref)
      .def_rw("matcap", &RenderSettings::matcap)
      .def_rw("environment", &RenderSettings::environment)
      .def_rw("environment_file", &RenderSettings::environment_file)
      .def_rw("env_intensity", &RenderSettings::env_intensity)
      .def_rw("env_rotation", &RenderSettings::env_rotation);

  nb::class_<Ray>(m, "Ray").def_ro("origin", &Ray::origin).def_ro("dir", &Ray::dir);

  nb::class_<Camera>(m, "Camera")
      .def_rw("target", &Camera::target)
      .def_rw("distance", &Camera::distance)
      .def_rw("yaw", &Camera::yaw)
      .def_rw("pitch", &Camera::pitch)
      .def_rw("fov_y", &Camera::fov_y)
      .def_rw("ortho", &Camera::ortho)
      .def_prop_ro("eye", &Camera::eye)
      .def_prop_ro("forward", &Camera::forward)
      .def_prop_ro("right", &Camera::right)
      .def_prop_ro("up", &Camera::up)
      .def("set_view", &Camera::set_view)
      .def("update", &Camera::update, nb::arg("dt"), "Advance smooth-view animation (dt >= 1 finishes it).")
      .def_prop_ro("animating", &Camera::animating)
      .def("aligned_axis", &Camera::aligned_axis)
      .def("project", &Camera::project, nb::arg("p"), nb::arg("width"), nb::arg("height"),
           "World point -> (x, y) pixels (origin top-left) and view depth.")
      .def("ray", &Camera::ray, nb::arg("x"), nb::arg("y"), nb::arg("width"), nb::arg("height"))
      .def("look_at", [](Camera& c, glm::vec3 eye, glm::vec3 target) {
        glm::vec3 d = target - eye;
        c.target = target;
        c.distance = std::max(glm::length(d), 1e-4f);
        glm::vec3 f = d / c.distance;
        c.pitch = -std::asin(std::clamp(f.z, -1.0f, 1.0f));
        c.yaw = std::atan2(-f.y, -f.x);
      });

  nb::class_<Selection>(m, "Selection")
      .def_prop_rw("mode", &Selection::mode, &Selection::set_mode)
      .def_prop_ro("items", [](const Selection& s) {
        std::vector<std::pair<uint32_t, uint32_t>> out;
        for (const ElementRef& e : s.items()) out.push_back({e.object, e.index});
        return out;
      })
      .def("clear", &Selection::clear)
      .def("set", [](Selection& s, uint32_t object, uint32_t index) { s.set({object, index}); })
      .def("toggle", [](Selection& s, uint32_t object, uint32_t index) { s.toggle({object, index}); });

  nb::class_<Anchor> anchor(m, "Anchor", "A point that follows moving geometry.");
  nb::enum_<Anchor::Kind>(anchor, "Kind", nb::is_arithmetic())
      .value("Vertex", Anchor::Vertex)
      .value("Surface", Anchor::Surface)
      .value("Ground", Anchor::Ground)
      .value("Point", Anchor::Point)
      .value("Fixed", Anchor::Fixed);
  anchor.def(nb::init<>())
      .def_rw("kind", &Anchor::kind)
      .def_rw("object", &Anchor::object)
      .def_rw("index", &Anchor::index)
      .def_rw("bary", &Anchor::bary)
      .def_rw("point", &Anchor::point);

  nb::class_<Measurement>(m, "Measurement")
      .def(nb::init<>())
      .def_rw("anchors", &Measurement::anchors)
      .def_rw("angle", &Measurement::angle);
  nb::bind_vector<std::vector<Measurement>>(m, "MeasurementList");

  nb::class_<Hit>(m, "Hit")
      .def_ro("valid", &Hit::valid)
      .def_ro("point", &Hit::point)
      .def_ro("surface", &Hit::surface)
      .def_prop_ro("kind", [](const Hit& h) { return h.surface.kind; })
      .def_prop_ro("object", [](const Hit& h) { return h.surface.object; })
      .def_prop_ro("index", [](const Hit& h) { return h.surface.index; });

  nb::class_<Drag> drag(m, "Drag", "Ctrl+LMB drag state (Viewer.drag). Started and Released last one frame.");
  nb::enum_<Drag::Phase>(drag, "Phase", nb::is_arithmetic())
      .value("Idle", Drag::Idle)
      .value("Started", Drag::Started)
      .value("Held", Drag::Held)
      .value("Released", Drag::Released);
  drag.def_ro("phase", &Drag::phase)
      .def_prop_ro("active", &Drag::active, "Started or Held.")
      .def_ro("object", &Drag::object, "Structure id.")
      .def_ro("element", &Drag::element, "Face (meshes), tet cell (volumes), edge (curves) or point.")
      .def_prop_ro("vertices", [](const Drag& d) {
        return rfpy::new_array<uint32_t>(std::vector<uint32_t>(d.vertices.begin(), d.vertices.end()),
                                         {d.vertices.size()});
      }, "The element's vertices / nodes / point, structure-local.")
      .def_prop_ro("weights", [](const Drag& d) {
        return rfpy::new_array<float>(std::vector<float>(d.weights.begin(), d.weights.end()), {d.weights.size()});
      }, "Grabbed point = sum of weights[i] * vertex(vertices[i]).")
      .def_ro("grab_point", &Drag::grab_point, "World point grabbed.")
      .def_ro("point", &Drag::point, "The grabbed point on the current geometry.")
      .def_ro("target", &Drag::target, "Cursor on the plane through grab_point facing the camera.")
      .def_ro("normal", &Drag::normal, "That plane's normal.");

  nb::class_<Overlay>(m, "Overlay")
      .def("line", &Overlay::line, nb::arg("a"), nb::arg("b"), nb::arg("color") = glm::vec4(1.0f),
           nb::arg("width_px") = 2.0f, nb::arg("hidden_alpha") = 0.35f, nb::arg("border") = glm::vec4(0.0f))
      .def("dot", &Overlay::dot, nb::arg("p"), nb::arg("color") = glm::vec4(1.0f), nb::arg("diameter_px") = 8.0f,
           nb::arg("hidden_alpha") = 0.35f, nb::arg("border") = glm::vec4(0.0f, 0.0f, 0.0f, 1.5f))
      .def("text", [](Overlay& o, const std::string& text, glm::vec3 anchor, float size_px, glm::vec4 color,
                      glm::vec2 align, glm::vec2 offset, float hidden_alpha, glm::vec4 halo, float halo_px,
                      bool ignore_depth, float world_height, float min_px) {
             TextLabel l;
             l.text = text;
             l.anchor = anchor;
             l.size_px = size_px;
             l.color = color;
             l.align = align;
             l.offset = offset;
             l.hidden_alpha = hidden_alpha;
             l.halo = halo;
             l.halo_px = halo_px;
             l.ignore_depth = ignore_depth;
             l.world_height = world_height;
             l.min_px = min_px;
             o.text(l);
           }, nb::arg("text"), nb::arg("anchor"), nb::arg("size_px") = 14.0f, nb::arg("color") = glm::vec4(1.0f),
           nb::arg("align") = glm::vec2(0.0f), nb::arg("offset") = glm::vec2(0.0f), nb::arg("hidden_alpha") = 0.3f,
           nb::arg("halo") = glm::vec4(0.0f, 0.0f, 0.0f, 0.75f), nb::arg("halo_px") = 2.0f,
           nb::arg("ignore_depth") = false, nb::arg("world_height") = 0.0f, nb::arg("min_px") = 4.0f,
           "Text label at a world anchor, facing the screen. With world_height > 0 it is that tall in world\n"
           "units (shrinks with distance; skipped below min_px); otherwise size_px pixels tall.");

  // ---- Viewer ----
  nb::class_<Viewer>(m, "Viewer")
      .def("__init__", [](Viewer* self, const std::string& title, int width, int height, bool headless, bool vsync,
                          float max_fps) {
             ViewerOptions o;
             o.title = title;
             o.width = width;
             o.height = height;
             o.headless = headless;
             o.vsync = vsync;
             o.max_fps = max_fps;
             new (self) Viewer(o);
             if (!self->ok()) {
               self->~Viewer();
               throw std::runtime_error("rillfacet: could not create the viewer (GPU or display missing?)");
             }
           },
           nb::arg("title") = "rillfacet", nb::arg("width") = 1600, nb::arg("height") = 960,
           nb::arg("headless") = false, nb::arg("vsync") = true, nb::arg("max_fps") = 0.0f)
      .def_prop_ro("scene", &Viewer::scene, ref)
      .def_prop_ro("camera", &Viewer::camera, ref)
      .def_prop_ro("settings", &Viewer::settings, ref)
      .def_prop_ro("selection", &Viewer::selection, ref)
      .def_prop_ro("overlay", &Viewer::overlay, ref)
      .def_prop_ro("measurements", &Viewer::measurements, ref)
      .def("set_callback", [](Viewer& v, nb::object fn) {
        if (fn.is_none()) {
          v.set_callback(nullptr);
          return;
        }
        // The callback holds a Python function: it is released with the GIL.
        auto f = std::shared_ptr<nb::object>(new nb::object(fn), [](nb::object* p) {
          nb::gil_scoped_acquire gil;
          delete p;
        });
        v.set_callback([f]() {
          // frame() runs without the GIL (see below); the callback takes it.
          nb::gil_scoped_acquire gil;
          if (g_callback_error) return;
          try {
            (*f)();
          } catch (nb::python_error& e) {
            g_callback_error = std::make_unique<nb::python_error>(std::move(e));
          }
        });
      }, nb::arg("fn").none())
      // The frame runs with the GIL RELEASED, except inside the callback:
      // rendering, the vsync wait and event polling never block other Python
      // threads (stock polyscope held the GIL for the whole frame, starving
      // every worker thread to one GIL grant per frame). Structures may only
      // be changed from the callback or the thread that calls frame().
      .def("frame", [](Viewer& v) {
        bool alive;
        {
          nb::gil_scoped_release nogil;
          alive = v.frame();
        }
        rethrow_callback_error();
        return alive;
      }, "Render one frame; False once the window is closed.")
      .def("run", [](Viewer& v) {
        for (;;) {
          bool alive;
          {
            nb::gil_scoped_release nogil;
            alive = v.frame();
          }
          rethrow_callback_error();
          if (!alive) break;
          if (PyErr_CheckSignals() != 0) throw nb::python_error();
        }
      }, "Render frames until the window is closed.")
      .def("request_close", &Viewer::request_close,
           "Close after the current frame: the next frame() returns False (ends run()).")
      .def_prop_rw("vsync", &Viewer::vsync, &Viewer::set_vsync,
                    "Wait for the display between frames (default). False presents at once: a waiting\n"
                    "present blocks while the display is off or locked (1 s per frame on X11).")
      .def_prop_rw("max_fps", &Viewer::max_fps, &Viewer::set_max_fps,
                    "> 0: frame() sleeps (GIL released) to stay under this rate; 0 = no cap.")
      .def("image_texture", &Viewer::image_texture, nb::arg("name"),
           "ImGui texture id of a scene image for imgui.Image (0 when there is none).")
      .def("screenshot", &Viewer::screenshot)
      .def("request_screenshot", &Viewer::request_screenshot, nb::arg("path"), nb::arg("with_ui") = false)
      .def("start_recording", &Viewer::start_recording, nb::arg("path"), nb::arg("fps") = 30,
           nb::arg("with_ui") = false)
      .def("stop_recording", &Viewer::stop_recording)
      .def_prop_ro("recording", &Viewer::recording)
      .def("set_ui_visible", &Viewer::set_ui_visible)
      .def("frame_all", &Viewer::frame_all, nb::arg("animate") = true)
      .def("frame_selection", &Viewer::frame_selection)
      .def_prop_ro("mouse_ray", &Viewer::mouse_ray, "View ray under the cursor.")
      .def_prop_ro("mouse", &Viewer::mouse, "Cursor position in pixels (origin top-left).")
      .def_prop_ro("viewport", &Viewer::viewport)
      .def("pick", &Viewer::pick)
      .def_prop_rw("drag_enabled", &Viewer::drag_enabled, &Viewer::set_drag_enabled,
                    "Ctrl+LMB grabs elements of draggable structures; read the state from `drag`.")
      .def_prop_ro("drag", &Viewer::drag, ref, "Ctrl+LMB drag state (live).")
      .def("begin_drag", &Viewer::begin_drag, nb::arg("x"), nb::arg("y"),
           "Grab what is under pixel (x, y) as Ctrl+LMB would; False if nothing draggable.")
      .def("drag_to", &Viewer::drag_to, nb::arg("x"), nb::arg("y"), "Move the drag target to pixel (x, y).")
      .def("end_drag", &Viewer::end_drag, "Release: Released, then Idle.")
      .def("cancel_drag", &Viewer::cancel_drag, "Idle at once, no Released (e.g. the scene was rebuilt).")
      .def_prop_ro("frame_seconds", &Viewer::frame_seconds)
      .def_prop_ro("ui_scale", &Viewer::ui_scale, "Desktop UI scale (2 at 200%) for hard-coded imgui sizes.");

  auto im = m.def_submodule("imgui", "Dear ImGui subset, named like polyscope.imgui");
  bind_imgui(im);
  bind_implot(m.def_submodule("implot", "ImPlot subset: line plots with named axes"));
}

// ---- Dear ImGui subset ------------------------------------------------------------

static ImVec2 v2(glm::vec2 v) { return ImVec2(v.x, v.y); }

static void bind_imgui(nb::module_ im) {
  im.def("Begin", [](const std::string& name, int flags) { return ImGui::Begin(name.c_str(), nullptr, flags); },
         nb::arg("name"), nb::arg("flags") = 0);
  im.def("End", &ImGui::End);
  im.def("Text", [](const std::string& s) { ImGui::TextUnformatted(s.c_str()); });
  im.def("TextUnformatted", [](const std::string& s) { ImGui::TextUnformatted(s.c_str()); });
  im.def("TextDisabled", [](const std::string& s) { ImGui::TextDisabled("%s", s.c_str()); });
  im.def("TextColored", [](glm::vec4 c, const std::string& s) { ImGui::TextColored(ImVec4(c.x, c.y, c.z, c.w), "%s", s.c_str()); });
  im.def("BulletText", [](const std::string& s) { ImGui::BulletText("%s", s.c_str()); });
  im.def("Button", [](const std::string& l, glm::vec2 size) { return ImGui::Button(l.c_str(), v2(size)); },
         nb::arg("label"), nb::arg("size") = glm::vec2(0.0f));
  im.def("SmallButton", [](const std::string& l) { return ImGui::SmallButton(l.c_str()); });
  im.def("Checkbox", [](const std::string& l, bool v) {
    bool c = ImGui::Checkbox(l.c_str(), &v);
    return nb::make_tuple(c, v);
  });
  im.def("RadioButton", [](const std::string& l, bool active) { return ImGui::RadioButton(l.c_str(), active); });
  im.def("RadioButton", [](const std::string& l, int current, int value) {
    bool c = ImGui::RadioButton(l.c_str(), &current, value);
    return nb::make_tuple(c, current);
  }, nb::arg("label"), nb::arg("current"), nb::arg("value"),
     "Radio button over an int: returns (clicked, current).");
  im.def("SliderFloat", [](const std::string& l, float v, float lo, float hi, const std::string& fmt, int flags) {
    bool c = ImGui::SliderFloat(l.c_str(), &v, lo, hi, fmt.c_str(), flags);
    return nb::make_tuple(c, v);
  }, nb::arg("label"), nb::arg("v"), nb::arg("v_min"), nb::arg("v_max"), nb::arg("format") = "%.3f",
     nb::arg("flags") = 0);
  im.def("SliderInt", [](const std::string& l, int v, int lo, int hi) {
    bool c = ImGui::SliderInt(l.c_str(), &v, lo, hi);
    return nb::make_tuple(c, v);
  }, nb::arg("label"), nb::arg("v"), nb::arg("v_min"), nb::arg("v_max"));
  im.def("SliderFloat2", [](const std::string& l, glm::vec2 v, float lo, float hi) {
    bool c = ImGui::SliderFloat2(l.c_str(), &v.x, lo, hi);
    return nb::make_tuple(c, std::vector<float>{v.x, v.y});
  }, nb::arg("label"), nb::arg("v"), nb::arg("v_min"), nb::arg("v_max"));
  im.def("SliderFloat3", [](const std::string& l, glm::vec3 v, float lo, float hi) {
    bool c = ImGui::SliderFloat3(l.c_str(), &v.x, lo, hi);
    return nb::make_tuple(c, std::vector<float>{v.x, v.y, v.z});
  }, nb::arg("label"), nb::arg("v"), nb::arg("v_min"), nb::arg("v_max"));
  im.def("DragFloat", [](const std::string& l, float v, float speed, float lo, float hi, const std::string& fmt) {
    bool c = ImGui::DragFloat(l.c_str(), &v, speed, lo, hi, fmt.c_str());
    return nb::make_tuple(c, v);
  }, nb::arg("label"), nb::arg("v"), nb::arg("speed") = 1.0f, nb::arg("v_min") = 0.0f, nb::arg("v_max") = 0.0f,
     nb::arg("format") = "%.3f");
  im.def("InputFloat", [](const std::string& l, float v, float step, float step_fast, const std::string& fmt,
                          int flags) {
    bool c = ImGui::InputFloat(l.c_str(), &v, step, step_fast, fmt.c_str(), flags);
    return nb::make_tuple(c, v);
  }, nb::arg("label"), nb::arg("v"), nb::arg("step") = 0.0f, nb::arg("step_fast") = 0.0f,
     nb::arg("format") = "%.3f", nb::arg("flags") = 0);
  im.def("InputInt", [](const std::string& l, int v, int step, int step_fast, int flags) {
    bool c = ImGui::InputInt(l.c_str(), &v, step, step_fast, flags);
    return nb::make_tuple(c, v);
  }, nb::arg("label"), nb::arg("v"), nb::arg("step") = 1, nb::arg("step_fast") = 100, nb::arg("flags") = 0);
  im.def("InputText", [](const std::string& l, const std::string& text, size_t buffer_size) {
    std::vector<char> buf(std::max(buffer_size, text.size() + 1), 0);
    std::copy(text.begin(), text.end(), buf.begin());
    bool c = ImGui::InputText(l.c_str(), buf.data(), buf.size());
    return nb::make_tuple(c, std::string(buf.data()));
  }, nb::arg("label"), nb::arg("text"), nb::arg("buffer_size") = 256);
  im.def("ColorEdit3", [](const std::string& l, glm::vec3 c) {
    bool ch = ImGui::ColorEdit3(l.c_str(), &c.x);
    return nb::make_tuple(ch, std::vector<float>{c.x, c.y, c.z});
  });
  im.def("ColorEdit4", [](const std::string& l, glm::vec4 c) {
    bool ch = ImGui::ColorEdit4(l.c_str(), &c.x);
    return nb::make_tuple(ch, std::vector<float>{c.x, c.y, c.z, c.w});
  });
  im.def("Combo", [](const std::string& l, int current, const std::vector<std::string>& items) {
    std::vector<const char*> p;
    for (const auto& s : items) p.push_back(s.c_str());
    bool c = ImGui::Combo(l.c_str(), &current, p.data(), int(p.size()));
    return nb::make_tuple(c, current);
  });
  im.def("BeginCombo", [](const std::string& l, const std::string& preview) {
    return ImGui::BeginCombo(l.c_str(), preview.c_str());
  });
  im.def("EndCombo", &ImGui::EndCombo);
  im.def("Selectable", [](const std::string& l, bool selected) { return ImGui::Selectable(l.c_str(), selected); },
         nb::arg("label"), nb::arg("selected") = false);
  im.def("SetItemDefaultFocus", &ImGui::SetItemDefaultFocus);
  im.def("SameLine", [](float offset, float spacing) { ImGui::SameLine(offset, spacing); },
         nb::arg("offset_from_start_x") = 0.0f, nb::arg("spacing") = -1.0f);
  im.def("Separator", &ImGui::Separator);
  im.def("SeparatorText", [](const std::string& s) { ImGui::SeparatorText(s.c_str()); });
  im.def("Spacing", &ImGui::Spacing);
  im.def("NewLine", &ImGui::NewLine);
  im.def("Indent", [](float w) { ImGui::Indent(w); }, nb::arg("width") = 0.0f);
  im.def("Unindent", [](float w) { ImGui::Unindent(w); }, nb::arg("width") = 0.0f);
  im.def("TreeNode", [](const std::string& l) { return ImGui::TreeNode(l.c_str()); });
  im.def("TreeNodeEx", [](const std::string& l, int flags) { return ImGui::TreeNodeEx(l.c_str(), flags); },
         nb::arg("label"), nb::arg("flags") = 0);
  im.def("SetNextItemOpen", [](bool open, int cond) { ImGui::SetNextItemOpen(open, cond); }, nb::arg("is_open"),
         nb::arg("cond") = 0);
  im.def("TreePop", &ImGui::TreePop);
  im.def("CollapsingHeader", [](const std::string& l, int flags) { return ImGui::CollapsingHeader(l.c_str(), flags); },
         nb::arg("label"), nb::arg("flags") = 0);
  im.def("PushItemWidth", &ImGui::PushItemWidth);
  im.def("PopItemWidth", &ImGui::PopItemWidth);
  im.def("SetNextItemWidth", &ImGui::SetNextItemWidth);
  im.def("SetNextWindowPos", [](glm::vec2 p, int cond) { ImGui::SetNextWindowPos(v2(p), cond); },
         nb::arg("pos"), nb::arg("cond") = 0);
  im.def("SetNextWindowSize", [](glm::vec2 s, int cond) { ImGui::SetNextWindowSize(v2(s), cond); },
         nb::arg("size"), nb::arg("cond") = 0);
  im.def("BeginDisabled", [](bool d) { ImGui::BeginDisabled(d); }, nb::arg("disabled") = true);
  im.def("EndDisabled", &ImGui::EndDisabled);
  im.def("PushID", [](const std::string& s) { ImGui::PushID(s.c_str()); });
  im.def("PushID", [](int i) { ImGui::PushID(i); });
  im.def("PopID", &ImGui::PopID);
  im.def("IsItemHovered", [](int flags) { return ImGui::IsItemHovered(flags); }, nb::arg("flags") = 0);
  im.def("IsItemActive", []() { return ImGui::IsItemActive(); });
  im.def("IsItemEdited", []() { return ImGui::IsItemEdited(); });
  im.def("IsItemClicked", [](int b) { return ImGui::IsItemClicked(b); }, nb::arg("mouse_button") = 0);
  im.def("IsItemDeactivatedAfterEdit", []() { return ImGui::IsItemDeactivatedAfterEdit(); });
  im.def("TextWrapped", [](const std::string& s) { ImGui::TextWrapped("%s", s.c_str()); });
  im.def("PushTextWrapPos", [](float x) { ImGui::PushTextWrapPos(x); }, nb::arg("wrap_local_pos_x") = 0.0f);
  im.def("PopTextWrapPos", &ImGui::PopTextWrapPos);
  im.def("Dummy", [](glm::vec2 size) { ImGui::Dummy(v2(size)); });
  im.def("CalcTextSize", [](const std::string& s) {
    ImVec2 v = ImGui::CalcTextSize(s.c_str());
    return glm::vec2(v.x, v.y);
  });
  im.def("GetFrameHeight", &ImGui::GetFrameHeight);
  im.def("GetFrameHeightWithSpacing", &ImGui::GetFrameHeightWithSpacing);
  im.def("GetTextLineHeight", &ImGui::GetTextLineHeight);
  im.def("GetTextLineHeightWithSpacing", &ImGui::GetTextLineHeightWithSpacing);
  im.def("GetCursorPosX", &ImGui::GetCursorPosX);
  im.def("SetCursorPosX", &ImGui::SetCursorPosX);
  im.def("GetContentRegionAvail", []() {
    ImVec2 v = ImGui::GetContentRegionAvail();
    return glm::vec2(v.x, v.y);
  });
  im.def("GetWindowWidth", &ImGui::GetWindowWidth);
  im.def("SetClipboardText", [](const std::string& s) { ImGui::SetClipboardText(s.c_str()); });
  im.def("GetClipboardText", []() {
    const char* t = ImGui::GetClipboardText();
    return std::string(t ? t : "");
  });
  im.def("PushStyleVar", [](int idx, float v) { ImGui::PushStyleVar(idx, v); });
  im.def("PushStyleVar", [](int idx, glm::vec2 v) { ImGui::PushStyleVar(idx, v2(v)); });
  im.def("PushStyleVarX", [](int idx, float v) { ImGui::PushStyleVarX(idx, v); });
  im.def("PushStyleVarY", [](int idx, float v) { ImGui::PushStyleVarY(idx, v); });
  im.def("PopStyleVar", [](int n) { ImGui::PopStyleVar(n); }, nb::arg("count") = 1);
  im.def("PushStyleColor", [](int idx, glm::vec4 c) { ImGui::PushStyleColor(idx, ImVec4(c.x, c.y, c.z, c.w)); });
  im.def("PopStyleColor", [](int n) { ImGui::PopStyleColor(n); }, nb::arg("count") = 1);
  im.def("BeginTable", [](const std::string& id, int columns, int flags, glm::vec2 outer) {
    return ImGui::BeginTable(id.c_str(), columns, flags, v2(outer));
  }, nb::arg("str_id"), nb::arg("columns"), nb::arg("flags") = 0, nb::arg("outer_size") = glm::vec2(0.0f));
  im.def("EndTable", &ImGui::EndTable);
  im.def("TableNextRow", []() { ImGui::TableNextRow(); });
  im.def("TableNextColumn", &ImGui::TableNextColumn);
  im.def("TableSetColumnIndex", &ImGui::TableSetColumnIndex);
  im.def("TableSetupColumn", [](const std::string& l, int flags, float w) {
    ImGui::TableSetupColumn(l.c_str(), flags, w);
  }, nb::arg("label"), nb::arg("flags") = 0, nb::arg("init_width_or_weight") = 0.0f);
  im.def("TableHeadersRow", &ImGui::TableHeadersRow);
  im.def("BeginTabBar", [](const std::string& id) { return ImGui::BeginTabBar(id.c_str()); });
  im.def("EndTabBar", &ImGui::EndTabBar);
  im.def("BeginTabItem", [](const std::string& l) { return ImGui::BeginTabItem(l.c_str()); });
  im.def("EndTabItem", &ImGui::EndTabItem);
  im.def("BeginChild", [](const std::string& id, glm::vec2 size, int child_flags, int window_flags) {
    return ImGui::BeginChild(id.c_str(), v2(size), child_flags, window_flags);
  }, nb::arg("str_id"), nb::arg("size") = glm::vec2(0.0f), nb::arg("child_flags") = 0, nb::arg("window_flags") = 0);
  im.def("EndChild", &ImGui::EndChild);
  // An image by texture id (Viewer.image_texture); uv (0,0) is the top-left.
  im.def("Image", [](uint64_t tex, glm::vec2 size, glm::vec2 uv0, glm::vec2 uv1) {
    if (tex) ImGui::Image(ImTextureRef(ImTextureID(tex)), v2(size), v2(uv0), v2(uv1));
    else ImGui::Dummy(v2(size));
  }, nb::arg("texture_id"), nb::arg("size"), nb::arg("uv0") = glm::vec2(0.0f), nb::arg("uv1") = glm::vec2(1.0f));
  im.def("SetTooltip", [](const std::string& s) { ImGui::SetTooltip("%s", s.c_str()); });
  im.def("PlotLines", [](const std::string& l, const std::vector<float>& v, const std::string& overlay, glm::vec2 size) {
    ImGui::PlotLines(l.c_str(), v.data(), int(v.size()), 0, overlay.empty() ? nullptr : overlay.c_str(), FLT_MAX,
                     FLT_MAX, v2(size));
  }, nb::arg("label"), nb::arg("values"), nb::arg("overlay") = "", nb::arg("size") = glm::vec2(0.0f, 80.0f));
  im.def("ProgressBar", [](float f, glm::vec2 size, const std::string& overlay) {
    ImGui::ProgressBar(f, v2(size), overlay.empty() ? nullptr : overlay.c_str());
  }, nb::arg("fraction"), nb::arg("size") = glm::vec2(-1.0f, 0.0f), nb::arg("overlay") = "");

  // Input.
  im.def("IsKeyPressed", [](int k, bool repeat) { return ImGui::IsKeyPressed(ImGuiKey(k), repeat); },
         nb::arg("key"), nb::arg("repeat") = true);
  im.def("IsKeyDown", [](int k) { return ImGui::IsKeyDown(ImGuiKey(k)); });
  im.def("IsMouseClicked", [](int b) { return ImGui::IsMouseClicked(b); });
  im.def("IsMouseDown", [](int b) { return ImGui::IsMouseDown(b); });
  im.def("IsMouseReleased", [](int b) { return ImGui::IsMouseReleased(b); });
  im.def("IsMouseDoubleClicked", [](int b) { return ImGui::IsMouseDoubleClicked(b); });
  im.def("GetMousePos", []() { return glm::vec2(ImGui::GetIO().MousePos.x, ImGui::GetIO().MousePos.y); });
  struct IO {};
  nb::class_<IO>(im, "IO")
      .def_prop_ro("WantCaptureMouse", [](const IO&) { return ImGui::GetIO().WantCaptureMouse; })
      .def_prop_ro("WantCaptureKeyboard", [](const IO&) { return ImGui::GetIO().WantCaptureKeyboard; })
      .def_prop_ro("KeyCtrl", [](const IO&) { return ImGui::GetIO().KeyCtrl; })
      .def_prop_ro("KeyShift", [](const IO&) { return ImGui::GetIO().KeyShift; })
      .def_prop_ro("KeyAlt", [](const IO&) { return ImGui::GetIO().KeyAlt; })
      .def_prop_ro("MousePos", [](const IO&) { return glm::vec2(ImGui::GetIO().MousePos.x, ImGui::GetIO().MousePos.y); })
      .def_prop_ro("MouseDelta", [](const IO&) { return glm::vec2(ImGui::GetIO().MouseDelta.x, ImGui::GetIO().MouseDelta.y); })
      .def_prop_ro("MouseWheel", [](const IO&) { return ImGui::GetIO().MouseWheel; })
      .def_prop_ro("DisplaySize", [](const IO&) { return glm::vec2(ImGui::GetIO().DisplaySize.x, ImGui::GetIO().DisplaySize.y); })
      .def_prop_ro("DeltaTime", [](const IO&) { return ImGui::GetIO().DeltaTime; })
      .def_prop_ro("Framerate", [](const IO&) { return ImGui::GetIO().Framerate; })
      // Input injection: drive a viewer callback from a script (headless tests).
      .def("AddKeyEvent", [](const IO&, int key, bool down) {
        ImGui::GetIO().AddKeyEvent(ImGuiKey(key), down);
      }, nb::arg("key"), nb::arg("down"))
      .def("AddMousePosEvent", [](const IO&, float x, float y) {
        ImGui::GetIO().AddMousePosEvent(x, y);
      }, nb::arg("x"), nb::arg("y"))
      .def("AddMouseButtonEvent", [](const IO&, int button, bool down) {
        ImGui::GetIO().AddMouseButtonEvent(button, down);
      }, nb::arg("button"), nb::arg("down"))
      .def("AddMouseWheelEvent", [](const IO&, float x, float y) {
        ImGui::GetIO().AddMouseWheelEvent(x, y);
      }, nb::arg("wheel_x"), nb::arg("wheel_y"))
      .def("AddInputCharacter", [](const IO&, unsigned int c) {
        ImGui::GetIO().AddInputCharacter(c);
      }, nb::arg("c"));
  im.def("GetIO", []() { return IO{}; });

  // Constants.
  for (int k = ImGuiKey_NamedKey_BEGIN; k < ImGuiKey_NamedKey_END; ++k) {
    std::string name = ImGui::GetKeyName(ImGuiKey(k));
    if (!name.empty() && name.find(' ') == std::string::npos) im.attr(("ImGuiKey_" + name).c_str()) = k;
  }
  im.attr("ImGuiMod_None") = int(ImGuiMod_None);
  im.attr("ImGuiMod_Ctrl") = int(ImGuiMod_Ctrl);
  im.attr("ImGuiMod_Shift") = int(ImGuiMod_Shift);
  im.attr("ImGuiMod_Alt") = int(ImGuiMod_Alt);
  im.attr("ImGuiMod_Super") = int(ImGuiMod_Super);
  im.attr("ImGuiMouseButton_Left") = 0;
  im.attr("ImGuiMouseButton_Right") = 1;
  im.attr("ImGuiMouseButton_Middle") = 2;
  im.attr("ImGuiCond_Always") = int(ImGuiCond_Always);
  im.attr("ImGuiCond_Once") = int(ImGuiCond_Once);
  im.attr("ImGuiCond_FirstUseEver") = int(ImGuiCond_FirstUseEver);
  im.attr("ImGuiCond_Appearing") = int(ImGuiCond_Appearing);
  im.attr("ImGuiWindowFlags_None") = int(ImGuiWindowFlags_None);
  im.attr("ImGuiWindowFlags_NoTitleBar") = int(ImGuiWindowFlags_NoTitleBar);
  im.attr("ImGuiWindowFlags_NoResize") = int(ImGuiWindowFlags_NoResize);
  im.attr("ImGuiWindowFlags_NoMove") = int(ImGuiWindowFlags_NoMove);
  im.attr("ImGuiWindowFlags_AlwaysAutoResize") = int(ImGuiWindowFlags_AlwaysAutoResize);
  im.attr("ImGuiWindowFlags_NoBackground") = int(ImGuiWindowFlags_NoBackground);
  im.attr("ImGuiSliderFlags_Logarithmic") = int(ImGuiSliderFlags_Logarithmic);
  im.attr("ImGuiTreeNodeFlags_DefaultOpen") = int(ImGuiTreeNodeFlags_DefaultOpen);
  im.attr("ImGuiTreeNodeFlags_Framed") = int(ImGuiTreeNodeFlags_Framed);
  im.attr("ImGuiTreeNodeFlags_Leaf") = int(ImGuiTreeNodeFlags_Leaf);
  im.attr("ImGuiWindowFlags_NoScrollbar") = int(ImGuiWindowFlags_NoScrollbar);
  im.attr("ImGuiWindowFlags_NoCollapse") = int(ImGuiWindowFlags_NoCollapse);
  im.attr("ImGuiWindowFlags_NoSavedSettings") = int(ImGuiWindowFlags_NoSavedSettings);
  im.attr("ImGuiWindowFlags_NoInputs") = int(ImGuiWindowFlags_NoInputs);
  im.attr("ImGuiWindowFlags_NoFocusOnAppearing") = int(ImGuiWindowFlags_NoFocusOnAppearing);
  im.attr("ImGuiChildFlags_None") = int(ImGuiChildFlags_None);
  im.attr("ImGuiChildFlags_Borders") = int(ImGuiChildFlags_Borders);
  im.attr("ImGuiChildFlags_AutoResizeY") = int(ImGuiChildFlags_AutoResizeY);
  im.attr("ImGuiInputTextFlags_EnterReturnsTrue") = int(ImGuiInputTextFlags_EnterReturnsTrue);
  im.attr("ImGuiHoveredFlags_None") = int(ImGuiHoveredFlags_None);
  im.attr("ImGuiHoveredFlags_AllowWhenDisabled") = int(ImGuiHoveredFlags_AllowWhenDisabled);
  im.attr("ImGuiTableFlags_None") = int(ImGuiTableFlags_None);
  im.attr("ImGuiTableFlags_Borders") = int(ImGuiTableFlags_Borders);
  im.attr("ImGuiTableFlags_RowBg") = int(ImGuiTableFlags_RowBg);
  im.attr("ImGuiTableFlags_Resizable") = int(ImGuiTableFlags_Resizable);
  im.attr("ImGuiTableFlags_SizingFixedFit") = int(ImGuiTableFlags_SizingFixedFit);
  im.attr("ImGuiTableFlags_SizingStretchProp") = int(ImGuiTableFlags_SizingStretchProp);
  im.attr("ImGuiTableFlags_SizingStretchSame") = int(ImGuiTableFlags_SizingStretchSame);
  im.attr("ImGuiTableColumnFlags_None") = int(ImGuiTableColumnFlags_None);
  im.attr("ImGuiTableColumnFlags_WidthFixed") = int(ImGuiTableColumnFlags_WidthFixed);
  im.attr("ImGuiTableColumnFlags_WidthStretch") = int(ImGuiTableColumnFlags_WidthStretch);
  im.attr("ImGuiStyleVar_Alpha") = int(ImGuiStyleVar_Alpha);
  im.attr("ImGuiStyleVar_WindowPadding") = int(ImGuiStyleVar_WindowPadding);
  im.attr("ImGuiStyleVar_FramePadding") = int(ImGuiStyleVar_FramePadding);
  im.attr("ImGuiStyleVar_FrameRounding") = int(ImGuiStyleVar_FrameRounding);
  im.attr("ImGuiStyleVar_ItemSpacing") = int(ImGuiStyleVar_ItemSpacing);
  im.attr("ImGuiStyleVar_ItemInnerSpacing") = int(ImGuiStyleVar_ItemInnerSpacing);
  im.attr("ImGuiStyleVar_IndentSpacing") = int(ImGuiStyleVar_IndentSpacing);
  im.attr("ImGuiCol_Text") = int(ImGuiCol_Text);
  im.attr("ImGuiCol_TextDisabled") = int(ImGuiCol_TextDisabled);
  im.attr("ImGuiCol_WindowBg") = int(ImGuiCol_WindowBg);
  im.attr("ImGuiCol_FrameBg") = int(ImGuiCol_FrameBg);
  im.attr("ImGuiCol_Button") = int(ImGuiCol_Button);
  im.attr("ImGuiCol_ButtonHovered") = int(ImGuiCol_ButtonHovered);
  im.attr("ImGuiCol_ButtonActive") = int(ImGuiCol_ButtonActive);
  im.attr("ImGuiCol_Header") = int(ImGuiCol_Header);
  im.attr("ImGuiCol_PlotHistogram") = int(ImGuiCol_PlotHistogram);

  // A line plot (ImPlot) for time series.
  im.def("PlotSeries", [](const std::string& title, const std::vector<std::string>& labels,
                          const std::vector<std::vector<float>>& series, glm::vec2 size) {
    if (!ImPlot::BeginPlot(title.c_str(), v2(size))) return;
    ImPlot::SetupAxes(nullptr, nullptr, ImPlotAxisFlags_AutoFit, ImPlotAxisFlags_AutoFit);
    for (size_t i = 0; i < series.size() && i < labels.size(); ++i)
      ImPlot::PlotLine(labels[i].c_str(), series[i].data(), int(series[i].size()));
    ImPlot::EndPlot();
  }, nb::arg("title"), nb::arg("labels"), nb::arg("series"), nb::arg("size") = glm::vec2(-1.0f, 150.0f));
}

// ---- ImPlot subset ----------------------------------------------------------------

static void bind_implot(nb::module_ m) {
  m.def("BeginPlot", [](const std::string& title, glm::vec2 size, int flags) {
    return ImPlot::BeginPlot(title.c_str(), v2(size), flags);
  }, nb::arg("title"), nb::arg("size") = glm::vec2(-1.0f, 0.0f), nb::arg("flags") = 0);
  m.def("EndPlot", &ImPlot::EndPlot);
  m.def("SetupAxes", [](nb::object x, nb::object y, int x_flags, int y_flags) {
    std::string xs = x.is_none() ? "" : nb::cast<std::string>(x);
    std::string ys = y.is_none() ? "" : nb::cast<std::string>(y);
    ImPlot::SetupAxes(x.is_none() ? nullptr : xs.c_str(), y.is_none() ? nullptr : ys.c_str(), x_flags, y_flags);
  }, nb::arg("x_label") = nb::none(), nb::arg("y_label") = nb::none(), nb::arg("x_flags") = 0,
     nb::arg("y_flags") = 0);
  m.def("SetupAxis", [](int axis, nb::object label, int flags) {
    std::string l = label.is_none() ? "" : nb::cast<std::string>(label);
    ImPlot::SetupAxis(ImAxis_(axis), label.is_none() ? nullptr : l.c_str(), flags);
  }, nb::arg("axis"), nb::arg("label") = nb::none(), nb::arg("flags") = 0);
  m.def("SetupAxisLimits", [](int axis, double lo, double hi, int cond) {
    ImPlot::SetupAxisLimits(ImAxis_(axis), lo, hi, cond);
  }, nb::arg("axis"), nb::arg("v_min"), nb::arg("v_max"), nb::arg("cond") = int(ImPlotCond_Once));
  m.def("SetAxes", [](int x, int y) { ImPlot::SetAxes(ImAxis_(x), ImAxis_(y)); });
  m.def("PlotLine", [](const std::string& label, const std::vector<float>& values, nb::object xs) {
    if (xs.is_none()) {
      ImPlot::PlotLine(label.c_str(), values.data(), int(values.size()));
    } else {
      std::vector<float> x = nb::cast<std::vector<float>>(xs);
      ImPlot::PlotLine(label.c_str(), x.data(), values.data(), int(std::min(x.size(), values.size())));
    }
  }, nb::arg("label"), nb::arg("values"), nb::arg("xs") = nb::none());
  m.def("PlotShaded", [](const std::string& label, const std::vector<float>& values, double y_ref) {
    ImPlot::PlotShaded(label.c_str(), values.data(), int(values.size()), y_ref);
  }, nb::arg("label"), nb::arg("values"), nb::arg("y_ref") = 0.0);

  m.attr("ImAxis_X1") = int(ImAxis_X1);
  m.attr("ImAxis_Y1") = int(ImAxis_Y1);
  m.attr("ImAxis_Y2") = int(ImAxis_Y2);
  m.attr("ImAxis_Y3") = int(ImAxis_Y3);
  m.attr("ImPlotAxisFlags_None") = int(ImPlotAxisFlags_None);
  m.attr("ImPlotAxisFlags_AutoFit") = int(ImPlotAxisFlags_AutoFit);
  m.attr("ImPlotAxisFlags_AuxDefault") = int(ImPlotAxisFlags_AuxDefault);
  m.attr("ImPlotAxisFlags_NoGridLines") = int(ImPlotAxisFlags_NoGridLines);
  m.attr("ImPlotAxisFlags_NoTickLabels") = int(ImPlotAxisFlags_NoTickLabels);
  m.attr("ImPlotAxisFlags_Opposite") = int(ImPlotAxisFlags_Opposite);
  m.attr("ImPlotFlags_None") = int(ImPlotFlags_None);
  m.attr("ImPlotFlags_NoLegend") = int(ImPlotFlags_NoLegend);
  m.attr("ImPlotFlags_NoTitle") = int(ImPlotFlags_NoTitle);
}
