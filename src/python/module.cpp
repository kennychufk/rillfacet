// Python bindings: `import avbd_viz`.
//
// Arrays can be numpy arrays, nested lists, or torch tensors (moved to the
// CPU first). Structures are owned by the scene: a Python handle to a removed
// structure must not be used. `avbd_viz.imgui` is a Dear ImGui subset named
// like polyscope.imgui, for per-frame UI in the viewer callback.

#include "avbd_viz/viewer.h"

#include <imgui.h>
#include <implot.h>
#include <pybind11/functional.h>
#include <pybind11/stl_bind.h>
#include <pybind11/numpy.h>
#include <pybind11/pybind11.h>
#include <pybind11/stl.h>

#include <algorithm>
#include <cfloat>
#include <cmath>
#include <memory>

namespace py = pybind11;
using namespace avbd_viz;

PYBIND11_MAKE_OPAQUE(std::vector<Measurement>);

// ---- glm vectors <-> Python sequences ---------------------------------------------

namespace pybind11::detail {
template <int N>
struct glm_vec_caster {
  using V = glm::vec<N, float>;
  PYBIND11_TYPE_CASTER(V, const_name("tuple[float, ...]"));
  bool load(handle src, bool) {
    if (!src || !PySequence_Check(src.ptr()) || PyUnicode_Check(src.ptr())) return false;
    sequence seq = reinterpret_borrow<sequence>(src);
    if (seq.size() != size_t(N)) return false;
    for (int i = 0; i < N; ++i) value[i] = seq[size_t(i)].cast<float>();
    return true;
  }
  static handle cast(const V& v, return_value_policy, handle) {
    tuple t(N);
    for (int i = 0; i < N; ++i) t[size_t(i)] = ::pybind11::float_(v[i]);
    return t.release();
  }
};
template <>
struct type_caster<glm::vec2> : glm_vec_caster<2> {};
template <>
struct type_caster<glm::vec3> : glm_vec_caster<3> {};
template <>
struct type_caster<glm::vec4> : glm_vec_caster<4> {};
// std::vector<std::unique_ptr<...>> claims to be copyable.
template <>
struct is_copy_constructible<Scene> : std::false_type {};
}  // namespace pybind11::detail

namespace {

// numpy / list / torch tensor -> contiguous array of T.
template <class T>
py::array_t<T, py::array::c_style | py::array::forcecast> as_array(py::handle h) {
  py::object o = py::reinterpret_borrow<py::object>(h);
  if (py::hasattr(o, "detach") && py::hasattr(o, "cpu")) o = o.attr("detach")().attr("cpu")().attr("numpy")();
  return py::array_t<T, py::array::c_style | py::array::forcecast>::ensure(o);
}

template <class T>
std::vector<T> as_vector(py::handle h) {
  auto a = as_array<T>(h);
  if (!a) throw py::type_error("expected an array of numbers");
  return std::vector<T>(a.data(), a.data() + a.size());
}

py::array_t<float> to_numpy(const std::vector<float>& v, size_t cols) {
  size_t rows = cols ? v.size() / cols : v.size();
  py::array_t<float> out(cols > 1 ? std::vector<size_t>{rows, cols} : std::vector<size_t>{rows});
  std::copy(v.begin(), v.end(), out.mutable_data());
  return out;
}

int colormap_index(py::handle h) {
  if (py::isinstance<py::str>(h)) {
    std::string name = h.cast<std::string>();
    for (int i = 0; i < colormap_count(); ++i)
      if (name == colormap_name(i)) return i;
    throw py::value_error("unknown colormap '" + name + "'");
  }
  return h.cast<int>();
}

// An exception raised in the viewer callback is kept until the frame is
// finished, then re-raised from Viewer.frame()/run().
std::unique_ptr<py::error_already_set> g_callback_error;

void rethrow_callback_error() {
  if (g_callback_error) {
    std::unique_ptr<py::error_already_set> e = std::move(g_callback_error);
    throw *e;
  }
}

}  // namespace

static void bind_imgui(py::module_ m);
static void bind_implot(py::module_ m);

PYBIND11_MODULE(_avbd_viz, m) {
  m.doc() = "avbd-viz: real-time scientific viewer (WebGPU)";

  // ---- Enums ----
  py::enum_<ElementKind>(m, "ElementKind")
      .value("Vertex", ElementKind::Vertex)
      .value("Edge", ElementKind::Edge)
      .value("Face", ElementKind::Face)
      .value("Segment", ElementKind::Segment)
      .value("Cell", ElementKind::Cell);
  py::enum_<QuantityType>(m, "QuantityType")
      .value("Scalar", QuantityType::Scalar)
      .value("Vector", QuantityType::Vector)
      .value("Color", QuantityType::Color);
  py::enum_<ColorSource>(m, "ColorSource")
      .value("Uniform", ColorSource::Uniform)
      .value("SegmentPalette", ColorSource::SegmentPalette)
      .value("Quantity", ColorSource::Quantity);
  py::enum_<Style>(m, "Style")
      .value("Studio", Style::Studio)
      .value("MatCap", Style::MatCap)
      .value("EnvironmentPBR", Style::EnvironmentPBR)
      .value("Technical", Style::Technical);
  py::enum_<Theme>(m, "Theme").value("Dark", Theme::Dark).value("Light", Theme::Light);
  py::enum_<Shading>(m, "Shading").value("Solid", Shading::Solid).value("Wireframe", Shading::Wireframe);
  py::enum_<OutlineMode>(m, "OutlineMode")
      .value("Off", OutlineMode::Off)
      .value("Silhouettes", OutlineMode::Silhouettes)
      .value("SilhouettesAndCreases", OutlineMode::SilhouettesAndCreases);
  py::enum_<PickMode>(m, "PickMode")
      .value("Vertex", PickMode::Vertex)
      .value("Edge", PickMode::Edge)
      .value("Face", PickMode::Face)
      .value("Body", PickMode::Segment);
  py::enum_<ViewPreset>(m, "ViewPreset")
      .value("Front", ViewPreset::Front)
      .value("Back", ViewPreset::Back)
      .value("Right", ViewPreset::Right)
      .value("Left", ViewPreset::Left)
      .value("Top", ViewPreset::Top)
      .value("Bottom", ViewPreset::Bottom);
  py::enum_<MatcapPreset>(m, "MatcapPreset")
      .value("Clay", MatcapPreset::Clay)
      .value("Porcelain", MatcapPreset::Porcelain)
      .value("Chrome", MatcapPreset::Chrome)
      .value("Toon", MatcapPreset::Toon);
  py::enum_<EnvironmentPreset>(m, "EnvironmentPreset")
      .value("Studio", EnvironmentPreset::Studio)
      .value("Sky", EnvironmentPreset::Sky)
      .value("Soft", EnvironmentPreset::Soft);

  m.def("colormap_names", []() {
    std::vector<std::string> names;
    for (int i = 0; i < colormap_count(); ++i) names.push_back(colormap_name(i));
    return names;
  });

  // ---- Quantities and structures ----
  py::class_<Quantity>(m, "Quantity")
      .def_readonly("name", &Quantity::name)
      .def_readonly("on", &Quantity::on)
      .def_readonly("type", &Quantity::type)
      .def_property_readonly("data", [](const Quantity& q) { return to_numpy(q.data, q.dims); })
      .def_readwrite("show_arrows", &Quantity::show_arrows)
      .def_readwrite("arrow_scale", &Quantity::arrow_scale)
      .def_readwrite("arrow_radius", &Quantity::arrow_radius)
      .def_readwrite("arrow_color", &Quantity::arrow_color);

  py::class_<Structure>(m, "Structure")
      .def_property_readonly("name", &Structure::name)
      .def_property_readonly("id", &Structure::id)
      .def_property_readonly("kind", [](const Structure& s) { return std::string(structure_kind_name(s.kind())); })
      .def_readwrite("visible", &Structure::visible)
      .def_readwrite("opacity", &Structure::opacity)
      .def_readwrite("sliced", &Structure::sliced)
      .def_readwrite("draggable", &Structure::draggable, "Ctrl+LMB can grab it (when the viewer's drag is enabled).")
      .def("bounds", [](const Structure& s) -> py::object {
        glm::vec3 lo, hi;
        if (!s.bounds(lo, hi)) return py::none();
        return py::make_tuple(lo, hi);
      });

  auto touch = [](QuantityStructure& q) { q.touch_attributes(); };
  py::class_<QuantityStructure, Structure>(m, "QuantityStructure")
      .def("count", &QuantityStructure::count)
      .def_property("color", [](const QuantityStructure& q) { return q.color; },
                    [touch](QuantityStructure& q, glm::vec3 c) { q.color = c; touch(q); })
      .def_property("color_source", [](const QuantityStructure& q) { return q.color_source; },
                    [touch](QuantityStructure& q, ColorSource c) { q.color_source = c; touch(q); })
      // Names the quantity used when color_source is Quantity; setting it does
      // not change color_source (the C++ field behaves the same way).
      .def_property("color_quantity", [](const QuantityStructure& q) { return q.color_quantity; },
                    [touch](QuantityStructure& q, const std::string& n) {
                      q.color_quantity = n;
                      touch(q);
                    })
      .def_property("colormap", [](const QuantityStructure& q) { return std::string(colormap_name(q.colormap)); },
                    [](QuantityStructure& q, py::handle h) { q.colormap = colormap_index(h); })
      .def_property("range", [](const QuantityStructure& q) { return q.range; },
                    [](QuantityStructure& q, glm::vec2 r) {
                      q.range = r;
                      q.auto_range = false;
                    })
      .def_readwrite("auto_range", &QuantityStructure::auto_range)
      .def_readwrite("isolines", &QuantityStructure::isolines)
      .def_readwrite("isoline_spacing", &QuantityStructure::isoline_spacing)
      .def_readwrite("metallic", &QuantityStructure::metallic)
      .def_readwrite("roughness", &QuantityStructure::roughness)
      .def("add_scalar", [](QuantityStructure& q, const std::string& name, ElementKind on, py::handle v) -> Quantity& {
             return q.add_scalar(name, on, as_vector<float>(v));
           }, py::arg("name"), py::arg("on"), py::arg("values"), py::return_value_policy::reference_internal)
      .def("add_vector", [](QuantityStructure& q, const std::string& name, ElementKind on, py::handle v) -> Quantity& {
             return q.add_vector(name, on, as_vector<float>(v));
           }, py::arg("name"), py::arg("on"), py::arg("vectors"), py::return_value_policy::reference_internal)
      .def("add_color", [](QuantityStructure& q, const std::string& name, ElementKind on, py::handle v) -> Quantity& {
             return q.add_color(name, on, as_vector<float>(v));
           }, py::arg("name"), py::arg("on"), py::arg("rgb"), py::return_value_policy::reference_internal)
      .def("quantity", py::overload_cast<const std::string&>(&QuantityStructure::quantity),
           py::return_value_policy::reference_internal)
      .def("remove_quantity", &QuantityStructure::remove_quantity)
      .def("touch_attributes", &QuantityStructure::touch_attributes,
           "Mark display settings changed when fields were written in place.")
      .def_property_readonly("quantity_names", [](const QuantityStructure& q) {
        std::vector<std::string> n;
        for (const Quantity& x : q.quantities()) n.push_back(x.name);
        return n;
      });

  py::class_<SurfaceMesh, QuantityStructure>(m, "SurfaceMesh")
      .def("set_geometry", [](SurfaceMesh& s, py::handle v, py::handle t) {
        auto va = as_vector<float>(v);
        auto ta = as_vector<uint32_t>(t);
        s.set_geometry(va.data(), va.size() / 3, ta.data(), ta.size() / 3);
      }, py::arg("vertices"), py::arg("triangles"))
      .def("set_positions", [](SurfaceMesh& s, py::handle v) {
        auto a = as_array<float>(v);
        if (size_t(a.size()) != s.positions().size()) throw py::value_error("vertex count changed; use set_geometry");
        s.set_positions(a.data());
      })
      .def("set_segments", [](SurfaceMesh& s, py::handle offsets, std::vector<std::string> names) {
        s.set_segments(as_vector<uint32_t>(offsets), std::move(names));
      }, py::arg("triangle_offsets"), py::arg("names") = std::vector<std::string>{})
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
      .def_property_readonly("num_vertices", &SurfaceMesh::num_vertices)
      .def_property_readonly("num_faces", &SurfaceMesh::num_faces)
      .def_property_readonly("num_segments", &SurfaceMesh::num_segments)
      .def_property_readonly("num_edges", &SurfaceMesh::num_edges)
      .def_property_readonly("positions", [](const SurfaceMesh& s) { return to_numpy(s.positions(), 3); })
      .def_property_readonly("edges", [](const SurfaceMesh& s) {
        const auto& e = s.edges();
        py::array_t<uint32_t> out(std::vector<size_t>{e.size() / 2, 2});
        std::copy(e.begin(), e.end(), out.mutable_data());
        return out;
      }, "Unique edges [E, 2], the order of Edge quantities.")
      .def_readwrite("smooth_shading", &SurfaceMesh::smooth_shading)
      .def_readwrite("rigid_segments", &SurfaceMesh::rigid_segments);

  py::class_<PointCloud, QuantityStructure>(m, "PointCloud")
      .def("set_points", [](PointCloud& p, py::handle xyz, py::object radii) {
        auto a = as_vector<float>(xyz);
        std::vector<float> r;
        if (!radii.is_none()) r = as_vector<float>(radii);
        p.set_points(a.data(), a.size() / 3, r.empty() ? nullptr : r.data());
      }, py::arg("points"), py::arg("radii") = py::none())
      .def_property_readonly("size", &PointCloud::size)
      .def_readwrite("radius", &PointCloud::radius);

  py::class_<CurveNetwork, QuantityStructure>(m, "CurveNetwork")
      .def("set_nodes", [](CurveNetwork& c, py::handle xyz) {
        auto a = as_vector<float>(xyz);
        c.set_nodes(a.data(), a.size() / 3);
      })
      .def("set_edges", [](CurveNetwork& c, py::handle e) {
        auto a = as_vector<uint32_t>(e);
        c.set_edges(a.data(), a.size() / 2);
      })
      .def("set_polyline", [](CurveNetwork& c, py::handle xyz, bool closed) {
        auto a = as_vector<float>(xyz);
        c.set_polyline(a.data(), a.size() / 3, closed);
      }, py::arg("points"), py::arg("closed") = false)
      .def_property_readonly("num_nodes", &CurveNetwork::num_nodes)
      .def_property_readonly("num_edges", &CurveNetwork::num_edges)
      .def_readwrite("radius", &CurveNetwork::radius);

  py::class_<VolumeMesh, QuantityStructure>(m, "VolumeMesh")
      .def("set_geometry", [](VolumeMesh& v, py::handle xyz, py::handle tets) {
        auto a = as_vector<float>(xyz);
        auto t = as_vector<uint32_t>(tets);
        v.set_geometry(a.data(), a.size() / 3, t.data(), t.size() / 4);
      }, py::arg("vertices"), py::arg("tets"))
      .def("set_positions", [](VolumeMesh& v, py::handle xyz) {
        auto a = as_array<float>(xyz);
        if (size_t(a.size()) != v.positions().size()) throw py::value_error("vertex count changed; use set_geometry");
        v.set_positions(a.data());
      })
      .def_property_readonly("num_vertices", &VolumeMesh::num_vertices)
      .def_property_readonly("num_cells", &VolumeMesh::num_cells);

  py::class_<VectorSet, Structure>(m, "VectorSet")
      .def("set_vectors", [](VectorSet& v, py::handle o, py::handle d) {
        auto a = as_vector<float>(o);
        auto b = as_vector<float>(d);
        if (a.size() != b.size()) throw py::value_error("origins and vectors differ in length");
        v.set_vectors(a.data(), b.data(), a.size() / 3);
      })
      .def_property_readonly("size", &VectorSet::size)
      .def_readwrite("radius", &VectorSet::radius)
      .def_readwrite("length_scale", &VectorSet::length_scale)
      .def_readwrite("color", &VectorSet::color);

  auto ref = py::return_value_policy::reference_internal;
  py::class_<Scene>(m, "Scene")
      .def("add_mesh", &Scene::add_mesh, ref)
      .def("add_points", &Scene::add_points, ref)
      .def("add_curves", &Scene::add_curves, ref)
      .def("add_volume", &Scene::add_volume, ref)
      .def("add_vectors", &Scene::add_vectors, ref)
      .def("remove", &Scene::remove)
      .def("clear", &Scene::clear)
      .def("get", [](const Scene& s, const std::string& name) { return s.find(name); }, ref)
      .def_property_readonly("names", [](const Scene& s) {
        std::vector<std::string> n;
        for (const auto& x : s.structures()) n.push_back(x->name());
        return n;
      })
      .def("bounds", [](const Scene& s) -> py::object {
        glm::vec3 lo, hi;
        if (!s.bounds(lo, hi)) return py::none();
        return py::make_tuple(lo, hi);
      });

  // ---- Settings, camera, selection, overlay ----
  py::class_<SlicePlane>(m, "SlicePlane")
      .def_readwrite("enabled", &SlicePlane::enabled)
      .def_readwrite("axis", &SlicePlane::axis)
      .def_readwrite("offset", &SlicePlane::offset)
      .def_readwrite("flip", &SlicePlane::flip)
      .def_readwrite("show", &SlicePlane::show);

  py::class_<RenderSettings>(m, "RenderSettings")
      .def_readwrite("shading", &RenderSettings::shading)
      .def_property("style", [](const RenderSettings& s) { return s.style; },
                    [](RenderSettings& s, Style st) { s.apply_style_defaults(st); })
      .def_readwrite("theme", &RenderSettings::theme)
      .def_readwrite("wireframe", &RenderSettings::wireframe)
      .def_readwrite("wire_width", &RenderSettings::wire_width)
      .def_readwrite("flat_edge_angle", &RenderSettings::flat_edge_angle)
      .def_readwrite("wire_object_colors", &RenderSettings::wire_object_colors)
      .def_readwrite("face_opacity", &RenderSettings::face_opacity)
      .def_readwrite("shadows", &RenderSettings::shadows)
      .def_readwrite("shadow_strength", &RenderSettings::shadow_strength)
      .def_readwrite("sun_dir", &RenderSettings::sun_dir)
      .def_readwrite("ssao", &RenderSettings::ssao)
      .def_readwrite("ao_strength", &RenderSettings::ao_strength)
      .def_readwrite("ao_radius", &RenderSettings::ao_radius)
      .def_readwrite("outline", &RenderSettings::outline)
      .def_readwrite("outline_width", &RenderSettings::outline_width)
      .def_readwrite("exposure", &RenderSettings::exposure)
      .def_readwrite("grid", &RenderSettings::grid)
      .def_readwrite("ground_shadow", &RenderSettings::ground_shadow)
      .def_readwrite("ground_height", &RenderSettings::ground_height)
      .def_property_readonly("slice", [](RenderSettings& s) -> SlicePlane& { return s.slice; }, ref)
      .def_readwrite("matcap", &RenderSettings::matcap)
      .def_readwrite("environment", &RenderSettings::environment)
      .def_readwrite("environment_file", &RenderSettings::environment_file)
      .def_readwrite("env_intensity", &RenderSettings::env_intensity)
      .def_readwrite("env_rotation", &RenderSettings::env_rotation);

  py::class_<Ray>(m, "Ray").def_readonly("origin", &Ray::origin).def_readonly("dir", &Ray::dir);

  py::class_<Camera>(m, "Camera")
      .def_readwrite("target", &Camera::target)
      .def_readwrite("distance", &Camera::distance)
      .def_readwrite("yaw", &Camera::yaw)
      .def_readwrite("pitch", &Camera::pitch)
      .def_readwrite("fov_y", &Camera::fov_y)
      .def_readwrite("ortho", &Camera::ortho)
      .def_property_readonly("eye", &Camera::eye)
      .def_property_readonly("forward", &Camera::forward)
      .def_property_readonly("right", &Camera::right)
      .def_property_readonly("up", &Camera::up)
      .def("set_view", &Camera::set_view)
      .def("update", &Camera::update, py::arg("dt"), "Advance smooth-view animation (dt >= 1 finishes it).")
      .def_property_readonly("animating", &Camera::animating)
      .def("aligned_axis", &Camera::aligned_axis)
      .def("project", &Camera::project, py::arg("p"), py::arg("width"), py::arg("height"),
           "World point -> (x, y) pixels (origin top-left) and view depth.")
      .def("ray", &Camera::ray, py::arg("x"), py::arg("y"), py::arg("width"), py::arg("height"))
      .def("look_at", [](Camera& c, glm::vec3 eye, glm::vec3 target) {
        glm::vec3 d = target - eye;
        c.target = target;
        c.distance = std::max(glm::length(d), 1e-4f);
        glm::vec3 f = d / c.distance;
        c.pitch = -std::asin(std::clamp(f.z, -1.0f, 1.0f));
        c.yaw = std::atan2(-f.y, -f.x);
      });

  py::class_<Selection>(m, "Selection")
      .def_property("mode", &Selection::mode, &Selection::set_mode)
      .def_property_readonly("items", [](const Selection& s) {
        std::vector<std::pair<uint32_t, uint32_t>> out;
        for (const ElementRef& e : s.items()) out.push_back({e.object, e.index});
        return out;
      })
      .def("clear", &Selection::clear)
      .def("set", [](Selection& s, uint32_t object, uint32_t index) { s.set({object, index}); })
      .def("toggle", [](Selection& s, uint32_t object, uint32_t index) { s.toggle({object, index}); });

  py::class_<Anchor> anchor(m, "Anchor", "A point that follows moving geometry.");
  py::enum_<Anchor::Kind>(anchor, "Kind")
      .value("Vertex", Anchor::Vertex)
      .value("Surface", Anchor::Surface)
      .value("Ground", Anchor::Ground)
      .value("Point", Anchor::Point)
      .value("Fixed", Anchor::Fixed);
  anchor.def(py::init<>())
      .def_readwrite("kind", &Anchor::kind)
      .def_readwrite("object", &Anchor::object)
      .def_readwrite("index", &Anchor::index)
      .def_readwrite("bary", &Anchor::bary)
      .def_readwrite("point", &Anchor::point);

  py::class_<Measurement>(m, "Measurement")
      .def(py::init<>())
      .def_readwrite("anchors", &Measurement::anchors)
      .def_readwrite("angle", &Measurement::angle);
  py::bind_vector<std::vector<Measurement>>(m, "MeasurementList");

  py::class_<Hit>(m, "Hit")
      .def_readonly("valid", &Hit::valid)
      .def_readonly("point", &Hit::point)
      .def_readonly("surface", &Hit::surface)
      .def_property_readonly("kind", [](const Hit& h) { return h.surface.kind; })
      .def_property_readonly("object", [](const Hit& h) { return h.surface.object; })
      .def_property_readonly("index", [](const Hit& h) { return h.surface.index; });

  py::class_<Drag> drag(m, "Drag", "Ctrl+LMB drag state (Viewer.drag). Started and Released last one frame.");
  py::enum_<Drag::Phase>(drag, "Phase")
      .value("Idle", Drag::Idle)
      .value("Started", Drag::Started)
      .value("Held", Drag::Held)
      .value("Released", Drag::Released);
  drag.def_readonly("phase", &Drag::phase)
      .def_property_readonly("active", &Drag::active, "Started or Held.")
      .def_readonly("object", &Drag::object, "Structure id.")
      .def_readonly("element", &Drag::element, "Face (meshes), tet cell (volumes), edge (curves) or point.")
      .def_property_readonly("vertices", [](const Drag& d) {
        py::array_t<uint32_t> out(d.vertices.size());
        std::copy(d.vertices.begin(), d.vertices.end(), out.mutable_data());
        return out;
      }, "The element's vertices / nodes / point, structure-local.")
      .def_property_readonly("weights", [](const Drag& d) {
        py::array_t<float> out(d.weights.size());
        std::copy(d.weights.begin(), d.weights.end(), out.mutable_data());
        return out;
      }, "Grabbed point = sum of weights[i] * vertex(vertices[i]).")
      .def_readonly("grab_point", &Drag::grab_point, "World point grabbed.")
      .def_readonly("point", &Drag::point, "The grabbed point on the current geometry.")
      .def_readonly("target", &Drag::target, "Cursor on the plane through grab_point facing the camera.")
      .def_readonly("normal", &Drag::normal, "That plane's normal.");

  py::class_<Overlay>(m, "Overlay")
      .def("line", &Overlay::line, py::arg("a"), py::arg("b"), py::arg("color") = glm::vec4(1.0f),
           py::arg("width_px") = 2.0f, py::arg("hidden_alpha") = 0.35f, py::arg("border") = glm::vec4(0.0f))
      .def("dot", &Overlay::dot, py::arg("p"), py::arg("color") = glm::vec4(1.0f), py::arg("diameter_px") = 8.0f,
           py::arg("hidden_alpha") = 0.35f, py::arg("border") = glm::vec4(0.0f, 0.0f, 0.0f, 1.5f))
      .def("text", [](Overlay& o, const std::string& text, glm::vec3 anchor, float size_px, glm::vec4 color,
                      glm::vec2 align, glm::vec2 offset, float hidden_alpha, glm::vec4 halo) {
             TextLabel l;
             l.text = text;
             l.anchor = anchor;
             l.size_px = size_px;
             l.color = color;
             l.align = align;
             l.offset = offset;
             l.hidden_alpha = hidden_alpha;
             l.halo = halo;
             o.text(l);
           }, py::arg("text"), py::arg("anchor"), py::arg("size_px") = 14.0f, py::arg("color") = glm::vec4(1.0f),
           py::arg("align") = glm::vec2(0.0f), py::arg("offset") = glm::vec2(0.0f), py::arg("hidden_alpha") = 0.3f,
           py::arg("halo") = glm::vec4(0.0f, 0.0f, 0.0f, 0.75f));

  // ---- Viewer ----
  py::class_<Viewer>(m, "Viewer")
      .def(py::init([](const std::string& title, int width, int height, bool headless) {
             ViewerOptions o;
             o.title = title;
             o.width = width;
             o.height = height;
             o.headless = headless;
             auto v = std::make_unique<Viewer>(o);
             if (!v->ok()) throw std::runtime_error("avbd_viz: could not create the viewer (GPU or display missing?)");
             return v;
           }),
           py::arg("title") = "avbd-viz", py::arg("width") = 1600, py::arg("height") = 960,
           py::arg("headless") = false)
      .def_property_readonly("scene", &Viewer::scene, ref)
      .def_property_readonly("camera", &Viewer::camera, ref)
      .def_property_readonly("settings", &Viewer::settings, ref)
      .def_property_readonly("selection", &Viewer::selection, ref)
      .def_property_readonly("overlay", &Viewer::overlay, ref)
      .def_property_readonly("measurements", &Viewer::measurements, ref)
      .def("set_callback", [](Viewer& v, py::object fn) {
        if (fn.is_none()) {
          v.set_callback(nullptr);
          return;
        }
        py::function f = fn.cast<py::function>();
        v.set_callback([f]() {
          if (g_callback_error) return;
          try {
            f();
          } catch (py::error_already_set& e) {
            g_callback_error = std::make_unique<py::error_already_set>(std::move(e));
          }
        });
      })
      .def("frame", [](Viewer& v) {
        bool alive = v.frame();
        rethrow_callback_error();
        return alive;
      }, "Render one frame; False once the window is closed.")
      .def("run", [](Viewer& v) {
        while (v.frame()) {
          rethrow_callback_error();
          if (PyErr_CheckSignals() != 0) throw py::error_already_set();
        }
        rethrow_callback_error();
      }, "Render frames until the window is closed.")
      .def("screenshot", &Viewer::screenshot)
      .def("request_screenshot", &Viewer::request_screenshot, py::arg("path"), py::arg("with_ui") = false)
      .def("start_recording", &Viewer::start_recording, py::arg("path"), py::arg("fps") = 30,
           py::arg("with_ui") = false)
      .def("stop_recording", &Viewer::stop_recording)
      .def_property_readonly("recording", &Viewer::recording)
      .def("set_ui_visible", &Viewer::set_ui_visible)
      .def("frame_all", &Viewer::frame_all, py::arg("animate") = true)
      .def("frame_selection", &Viewer::frame_selection)
      .def_property_readonly("mouse_ray", &Viewer::mouse_ray, "View ray under the cursor.")
      .def_property_readonly("mouse", &Viewer::mouse, "Cursor position in pixels (origin top-left).")
      .def_property_readonly("viewport", &Viewer::viewport)
      .def("pick", &Viewer::pick)
      .def_property("drag_enabled", &Viewer::drag_enabled, &Viewer::set_drag_enabled,
                    "Ctrl+LMB grabs elements of draggable structures; read the state from `drag`.")
      .def_property_readonly("drag", &Viewer::drag, ref, "Ctrl+LMB drag state (live).")
      .def("begin_drag", &Viewer::begin_drag, py::arg("x"), py::arg("y"),
           "Grab what is under pixel (x, y) as Ctrl+LMB would; False if nothing draggable.")
      .def("drag_to", &Viewer::drag_to, py::arg("x"), py::arg("y"), "Move the drag target to pixel (x, y).")
      .def("end_drag", &Viewer::end_drag, "Release: Released, then Idle.")
      .def("cancel_drag", &Viewer::cancel_drag, "Idle at once, no Released (e.g. the scene was rebuilt).")
      .def_property_readonly("frame_seconds", &Viewer::frame_seconds);

  auto im = m.def_submodule("imgui", "Dear ImGui subset, named like polyscope.imgui");
  bind_imgui(im);
  bind_implot(m.def_submodule("implot", "ImPlot subset: line plots with named axes"));
}

// ---- Dear ImGui subset ------------------------------------------------------------

static ImVec2 v2(glm::vec2 v) { return ImVec2(v.x, v.y); }

static void bind_imgui(py::module_ im) {
  im.def("Begin", [](const std::string& name, int flags) { return ImGui::Begin(name.c_str(), nullptr, flags); },
         py::arg("name"), py::arg("flags") = 0);
  im.def("End", &ImGui::End);
  im.def("Text", [](const std::string& s) { ImGui::TextUnformatted(s.c_str()); });
  im.def("TextUnformatted", [](const std::string& s) { ImGui::TextUnformatted(s.c_str()); });
  im.def("TextDisabled", [](const std::string& s) { ImGui::TextDisabled("%s", s.c_str()); });
  im.def("TextColored", [](glm::vec4 c, const std::string& s) { ImGui::TextColored(ImVec4(c.x, c.y, c.z, c.w), "%s", s.c_str()); });
  im.def("BulletText", [](const std::string& s) { ImGui::BulletText("%s", s.c_str()); });
  im.def("Button", [](const std::string& l, glm::vec2 size) { return ImGui::Button(l.c_str(), v2(size)); },
         py::arg("label"), py::arg("size") = glm::vec2(0.0f));
  im.def("SmallButton", [](const std::string& l) { return ImGui::SmallButton(l.c_str()); });
  im.def("Checkbox", [](const std::string& l, bool v) {
    bool c = ImGui::Checkbox(l.c_str(), &v);
    return py::make_tuple(c, v);
  });
  im.def("RadioButton", [](const std::string& l, bool active) { return ImGui::RadioButton(l.c_str(), active); });
  im.def("RadioButton", [](const std::string& l, int current, int value) {
    bool c = ImGui::RadioButton(l.c_str(), &current, value);
    return py::make_tuple(c, current);
  }, py::arg("label"), py::arg("current"), py::arg("value"),
     "Radio button over an int: returns (clicked, current).");
  im.def("SliderFloat", [](const std::string& l, float v, float lo, float hi, const std::string& fmt, int flags) {
    bool c = ImGui::SliderFloat(l.c_str(), &v, lo, hi, fmt.c_str(), flags);
    return py::make_tuple(c, v);
  }, py::arg("label"), py::arg("v"), py::arg("v_min"), py::arg("v_max"), py::arg("format") = "%.3f",
     py::arg("flags") = 0);
  im.def("SliderInt", [](const std::string& l, int v, int lo, int hi) {
    bool c = ImGui::SliderInt(l.c_str(), &v, lo, hi);
    return py::make_tuple(c, v);
  }, py::arg("label"), py::arg("v"), py::arg("v_min"), py::arg("v_max"));
  im.def("SliderFloat2", [](const std::string& l, glm::vec2 v, float lo, float hi) {
    bool c = ImGui::SliderFloat2(l.c_str(), &v.x, lo, hi);
    return py::make_tuple(c, std::vector<float>{v.x, v.y});
  }, py::arg("label"), py::arg("v"), py::arg("v_min"), py::arg("v_max"));
  im.def("SliderFloat3", [](const std::string& l, glm::vec3 v, float lo, float hi) {
    bool c = ImGui::SliderFloat3(l.c_str(), &v.x, lo, hi);
    return py::make_tuple(c, std::vector<float>{v.x, v.y, v.z});
  }, py::arg("label"), py::arg("v"), py::arg("v_min"), py::arg("v_max"));
  im.def("DragFloat", [](const std::string& l, float v, float speed, float lo, float hi) {
    bool c = ImGui::DragFloat(l.c_str(), &v, speed, lo, hi);
    return py::make_tuple(c, v);
  }, py::arg("label"), py::arg("v"), py::arg("speed") = 1.0f, py::arg("v_min") = 0.0f, py::arg("v_max") = 0.0f);
  im.def("InputFloat", [](const std::string& l, float v) {
    bool c = ImGui::InputFloat(l.c_str(), &v);
    return py::make_tuple(c, v);
  });
  im.def("InputInt", [](const std::string& l, int v) {
    bool c = ImGui::InputInt(l.c_str(), &v);
    return py::make_tuple(c, v);
  });
  im.def("InputText", [](const std::string& l, const std::string& text, size_t buffer_size) {
    std::vector<char> buf(std::max(buffer_size, text.size() + 1), 0);
    std::copy(text.begin(), text.end(), buf.begin());
    bool c = ImGui::InputText(l.c_str(), buf.data(), buf.size());
    return py::make_tuple(c, std::string(buf.data()));
  }, py::arg("label"), py::arg("text"), py::arg("buffer_size") = 256);
  im.def("ColorEdit3", [](const std::string& l, glm::vec3 c) {
    bool ch = ImGui::ColorEdit3(l.c_str(), &c.x);
    return py::make_tuple(ch, std::vector<float>{c.x, c.y, c.z});
  });
  im.def("ColorEdit4", [](const std::string& l, glm::vec4 c) {
    bool ch = ImGui::ColorEdit4(l.c_str(), &c.x);
    return py::make_tuple(ch, std::vector<float>{c.x, c.y, c.z, c.w});
  });
  im.def("Combo", [](const std::string& l, int current, const std::vector<std::string>& items) {
    std::vector<const char*> p;
    for (const auto& s : items) p.push_back(s.c_str());
    bool c = ImGui::Combo(l.c_str(), &current, p.data(), int(p.size()));
    return py::make_tuple(c, current);
  });
  im.def("BeginCombo", [](const std::string& l, const std::string& preview) {
    return ImGui::BeginCombo(l.c_str(), preview.c_str());
  });
  im.def("EndCombo", &ImGui::EndCombo);
  im.def("Selectable", [](const std::string& l, bool selected) { return ImGui::Selectable(l.c_str(), selected); },
         py::arg("label"), py::arg("selected") = false);
  im.def("SetItemDefaultFocus", &ImGui::SetItemDefaultFocus);
  im.def("SameLine", [](float offset, float spacing) { ImGui::SameLine(offset, spacing); },
         py::arg("offset_from_start_x") = 0.0f, py::arg("spacing") = -1.0f);
  im.def("Separator", &ImGui::Separator);
  im.def("SeparatorText", [](const std::string& s) { ImGui::SeparatorText(s.c_str()); });
  im.def("Spacing", &ImGui::Spacing);
  im.def("NewLine", &ImGui::NewLine);
  im.def("Indent", [](float w) { ImGui::Indent(w); }, py::arg("width") = 0.0f);
  im.def("Unindent", [](float w) { ImGui::Unindent(w); }, py::arg("width") = 0.0f);
  im.def("TreeNode", [](const std::string& l) { return ImGui::TreeNode(l.c_str()); });
  im.def("TreePop", &ImGui::TreePop);
  im.def("CollapsingHeader", [](const std::string& l, int flags) { return ImGui::CollapsingHeader(l.c_str(), flags); },
         py::arg("label"), py::arg("flags") = 0);
  im.def("PushItemWidth", &ImGui::PushItemWidth);
  im.def("PopItemWidth", &ImGui::PopItemWidth);
  im.def("SetNextItemWidth", &ImGui::SetNextItemWidth);
  im.def("SetNextWindowPos", [](glm::vec2 p, int cond) { ImGui::SetNextWindowPos(v2(p), cond); },
         py::arg("pos"), py::arg("cond") = 0);
  im.def("SetNextWindowSize", [](glm::vec2 s, int cond) { ImGui::SetNextWindowSize(v2(s), cond); },
         py::arg("size"), py::arg("cond") = 0);
  im.def("BeginDisabled", [](bool d) { ImGui::BeginDisabled(d); }, py::arg("disabled") = true);
  im.def("EndDisabled", &ImGui::EndDisabled);
  im.def("PushID", [](const std::string& s) { ImGui::PushID(s.c_str()); });
  im.def("PushID", [](int i) { ImGui::PushID(i); });
  im.def("PopID", &ImGui::PopID);
  im.def("IsItemHovered", []() { return ImGui::IsItemHovered(); });
  im.def("SetTooltip", [](const std::string& s) { ImGui::SetTooltip("%s", s.c_str()); });
  im.def("PlotLines", [](const std::string& l, const std::vector<float>& v, const std::string& overlay, glm::vec2 size) {
    ImGui::PlotLines(l.c_str(), v.data(), int(v.size()), 0, overlay.empty() ? nullptr : overlay.c_str(), FLT_MAX,
                     FLT_MAX, v2(size));
  }, py::arg("label"), py::arg("values"), py::arg("overlay") = "", py::arg("size") = glm::vec2(0.0f, 80.0f));
  im.def("ProgressBar", [](float f, glm::vec2 size, const std::string& overlay) {
    ImGui::ProgressBar(f, v2(size), overlay.empty() ? nullptr : overlay.c_str());
  }, py::arg("fraction"), py::arg("size") = glm::vec2(-1.0f, 0.0f), py::arg("overlay") = "");

  // Input.
  im.def("IsKeyPressed", [](int k, bool repeat) { return ImGui::IsKeyPressed(ImGuiKey(k), repeat); },
         py::arg("key"), py::arg("repeat") = true);
  im.def("IsKeyDown", [](int k) { return ImGui::IsKeyDown(ImGuiKey(k)); });
  im.def("IsMouseClicked", [](int b) { return ImGui::IsMouseClicked(b); });
  im.def("IsMouseDown", [](int b) { return ImGui::IsMouseDown(b); });
  im.def("IsMouseReleased", [](int b) { return ImGui::IsMouseReleased(b); });
  im.def("IsMouseDoubleClicked", [](int b) { return ImGui::IsMouseDoubleClicked(b); });
  im.def("GetMousePos", []() { return glm::vec2(ImGui::GetIO().MousePos.x, ImGui::GetIO().MousePos.y); });
  struct IO {};
  py::class_<IO>(im, "IO")
      .def_property_readonly("WantCaptureMouse", [](const IO&) { return ImGui::GetIO().WantCaptureMouse; })
      .def_property_readonly("WantCaptureKeyboard", [](const IO&) { return ImGui::GetIO().WantCaptureKeyboard; })
      .def_property_readonly("KeyCtrl", [](const IO&) { return ImGui::GetIO().KeyCtrl; })
      .def_property_readonly("KeyShift", [](const IO&) { return ImGui::GetIO().KeyShift; })
      .def_property_readonly("KeyAlt", [](const IO&) { return ImGui::GetIO().KeyAlt; })
      .def_property_readonly("MousePos", [](const IO&) { return glm::vec2(ImGui::GetIO().MousePos.x, ImGui::GetIO().MousePos.y); })
      .def_property_readonly("MouseDelta", [](const IO&) { return glm::vec2(ImGui::GetIO().MouseDelta.x, ImGui::GetIO().MouseDelta.y); })
      .def_property_readonly("MouseWheel", [](const IO&) { return ImGui::GetIO().MouseWheel; })
      .def_property_readonly("DisplaySize", [](const IO&) { return glm::vec2(ImGui::GetIO().DisplaySize.x, ImGui::GetIO().DisplaySize.y); })
      .def_property_readonly("DeltaTime", [](const IO&) { return ImGui::GetIO().DeltaTime; })
      .def_property_readonly("Framerate", [](const IO&) { return ImGui::GetIO().Framerate; })
      // Input injection: drive a viewer callback from a script (headless tests).
      .def("AddKeyEvent", [](const IO&, int key, bool down) {
        ImGui::GetIO().AddKeyEvent(ImGuiKey(key), down);
      }, py::arg("key"), py::arg("down"))
      .def("AddMousePosEvent", [](const IO&, float x, float y) {
        ImGui::GetIO().AddMousePosEvent(x, y);
      }, py::arg("x"), py::arg("y"))
      .def("AddMouseButtonEvent", [](const IO&, int button, bool down) {
        ImGui::GetIO().AddMouseButtonEvent(button, down);
      }, py::arg("button"), py::arg("down"))
      .def("AddMouseWheelEvent", [](const IO&, float x, float y) {
        ImGui::GetIO().AddMouseWheelEvent(x, y);
      }, py::arg("wheel_x"), py::arg("wheel_y"))
      .def("AddInputCharacter", [](const IO&, unsigned int c) {
        ImGui::GetIO().AddInputCharacter(c);
      }, py::arg("c"));
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

  // A line plot (ImPlot) for time series.
  im.def("PlotSeries", [](const std::string& title, const std::vector<std::string>& labels,
                          const std::vector<std::vector<float>>& series, glm::vec2 size) {
    if (!ImPlot::BeginPlot(title.c_str(), v2(size))) return;
    ImPlot::SetupAxes(nullptr, nullptr, ImPlotAxisFlags_AutoFit, ImPlotAxisFlags_AutoFit);
    for (size_t i = 0; i < series.size() && i < labels.size(); ++i)
      ImPlot::PlotLine(labels[i].c_str(), series[i].data(), int(series[i].size()));
    ImPlot::EndPlot();
  }, py::arg("title"), py::arg("labels"), py::arg("series"), py::arg("size") = glm::vec2(-1.0f, 150.0f));
}

// ---- ImPlot subset ----------------------------------------------------------------

static void bind_implot(py::module_ m) {
  m.def("BeginPlot", [](const std::string& title, glm::vec2 size, int flags) {
    return ImPlot::BeginPlot(title.c_str(), v2(size), flags);
  }, py::arg("title"), py::arg("size") = glm::vec2(-1.0f, 0.0f), py::arg("flags") = 0);
  m.def("EndPlot", &ImPlot::EndPlot);
  m.def("SetupAxes", [](py::object x, py::object y, int x_flags, int y_flags) {
    std::string xs = x.is_none() ? "" : x.cast<std::string>();
    std::string ys = y.is_none() ? "" : y.cast<std::string>();
    ImPlot::SetupAxes(x.is_none() ? nullptr : xs.c_str(), y.is_none() ? nullptr : ys.c_str(), x_flags, y_flags);
  }, py::arg("x_label") = py::none(), py::arg("y_label") = py::none(), py::arg("x_flags") = 0,
     py::arg("y_flags") = 0);
  m.def("SetupAxis", [](int axis, py::object label, int flags) {
    std::string l = label.is_none() ? "" : label.cast<std::string>();
    ImPlot::SetupAxis(ImAxis_(axis), label.is_none() ? nullptr : l.c_str(), flags);
  }, py::arg("axis"), py::arg("label") = py::none(), py::arg("flags") = 0);
  m.def("SetupAxisLimits", [](int axis, double lo, double hi, int cond) {
    ImPlot::SetupAxisLimits(ImAxis_(axis), lo, hi, cond);
  }, py::arg("axis"), py::arg("v_min"), py::arg("v_max"), py::arg("cond") = int(ImPlotCond_Once));
  m.def("SetAxes", [](int x, int y) { ImPlot::SetAxes(ImAxis_(x), ImAxis_(y)); });
  m.def("PlotLine", [](const std::string& label, const std::vector<float>& values, py::object xs) {
    if (xs.is_none()) {
      ImPlot::PlotLine(label.c_str(), values.data(), int(values.size()));
    } else {
      std::vector<float> x = xs.cast<std::vector<float>>();
      ImPlot::PlotLine(label.c_str(), x.data(), values.data(), int(std::min(x.size(), values.size())));
    }
  }, py::arg("label"), py::arg("values"), py::arg("xs") = py::none());
  m.def("PlotShaded", [](const std::string& label, const std::vector<float>& values, double y_ref) {
    ImPlot::PlotShaded(label.c_str(), values.data(), int(values.size()), y_ref);
  }, py::arg("label"), py::arg("values"), py::arg("y_ref") = 0.0);

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
