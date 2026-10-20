#pragma once
// numpy interchange for the bindings. Inputs may be numpy arrays, nested lists
// or torch tensors (moved to the CPU first); they are converted by numpy
// itself (`ascontiguousarray`), then read without another copy. Outputs are
// numpy arrays that own their data.

#include <nanobind/nanobind.h>
#include <nanobind/ndarray.h>

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace rfpy {

namespace nb = nanobind;

template <class T> constexpr const char* dtype_name();
template <> constexpr const char* dtype_name<float>() { return "float32"; }
template <> constexpr const char* dtype_name<double>() { return "float64"; }
template <> constexpr const char* dtype_name<uint8_t>() { return "uint8"; }
template <> constexpr const char* dtype_name<uint16_t>() { return "uint16"; }
template <> constexpr const char* dtype_name<uint32_t>() { return "uint32"; }

// A tensor or array-like as a numpy object (torch tensors via detach().cpu().numpy()).
inline nb::object to_numpy_object(nb::handle h) {
  nb::object o = nb::borrow(h);
  if (nb::hasattr(o, "detach") && nb::hasattr(o, "cpu")) o = o.attr("detach")().attr("cpu")().attr("numpy")();
  return o;
}

// A C-contiguous CPU array of T. `what` names the argument in error messages.
template <class T>
class Array {
 public:
  explicit Array(nb::handle h) {
    try {
      nb::object np = nb::module_::import_("numpy");
      owner_ = np.attr("ascontiguousarray")(to_numpy_object(h), nb::arg("dtype") = dtype_name<T>());
      a_ = nb::cast<View>(owner_);
    } catch (nb::python_error&) {
      throw nb::type_error("expected an array of numbers");
    }
  }
  const T* data() const { return a_.data(); }
  size_t size() const { return a_.size(); }
  size_t ndim() const { return a_.ndim(); }
  size_t shape(size_t i) const { return a_.shape(i); }

 private:
  using View = nb::ndarray<const T, nb::c_contig, nb::device::cpu>;
  nb::object owner_;
  View a_;
};

// A new numpy array that owns `data` (row-major, `shape`).
template <class T>
nb::object new_array(std::vector<T> data, std::vector<size_t> shape) {
  data.reserve(1);   // a non-null pointer even when empty
  auto* v = new std::vector<T>(std::move(data));
  nb::capsule owner(v, [](void* p) noexcept { delete static_cast<std::vector<T>*>(p); });
  return nb::cast(nb::ndarray<nb::numpy, T>(v->data(), shape.size(), shape.data(), owner));
}

}  // namespace rfpy
