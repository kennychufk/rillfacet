#include "rillfacet/cuda_share.h"

#include <dlfcn.h>
#include <unistd.h>

#include <cstdio>
#include <cstring>
#include <vector>

#if RILLFACET_HAVE_CUDA_H
#define VK_NO_PROTOTYPES
#include <cuda.h>
#include <vulkan/vulkan.h>
#endif

namespace rillfacet {

#if RILLFACET_HAVE_CUDA_H

namespace {

struct FormatInfo {
  VkFormat vk;
  CUarray_format cu;
  unsigned channels;
  uint32_t bpp;
};

bool format_info(wgpu::TextureFormat f, FormatInfo& out) {
  switch (f) {
    case wgpu::TextureFormat::RGBA8Unorm:
      out = {VK_FORMAT_R8G8B8A8_UNORM, CU_AD_FORMAT_UNSIGNED_INT8, 4, 4}; return true;
    case wgpu::TextureFormat::RGBA16Float:
      out = {VK_FORMAT_R16G16B16A16_SFLOAT, CU_AD_FORMAT_HALF, 4, 8}; return true;
    case wgpu::TextureFormat::RGBA32Float:
      out = {VK_FORMAT_R32G32B32A32_SFLOAT, CU_AD_FORMAT_FLOAT, 4, 16}; return true;
    case wgpu::TextureFormat::R32Float:
      out = {VK_FORMAT_R32_SFLOAT, CU_AD_FORMAT_FLOAT, 1, 4}; return true;
    case wgpu::TextureFormat::R16Uint:
      out = {VK_FORMAT_R16_UINT, CU_AD_FORMAT_UNSIGNED_INT16, 1, 2}; return true;
    case wgpu::TextureFormat::R32Uint:
      out = {VK_FORMAT_R32_UINT, CU_AD_FORMAT_UNSIGNED_INT32, 1, 4}; return true;
    default:
      return false;
  }
}

}  // namespace

struct CudaShareImpl {
  wgpu::Device device;
  std::string error;
  bool ok = false;
  void* vk_lib = nullptr;
  void* cu_lib = nullptr;

  // Vulkan (allocation only)
  PFN_vkGetInstanceProcAddr vkGetInstanceProcAddr = nullptr;
  PFN_vkCreateInstance vkCreateInstance = nullptr;
  PFN_vkDestroyInstance vkDestroyInstance = nullptr;
  PFN_vkEnumeratePhysicalDevices vkEnumeratePhysicalDevices = nullptr;
  PFN_vkGetPhysicalDeviceProperties vkGetPhysicalDeviceProperties = nullptr;
  PFN_vkGetPhysicalDeviceProperties2 vkGetPhysicalDeviceProperties2 = nullptr;
  PFN_vkGetPhysicalDeviceMemoryProperties vkGetPhysicalDeviceMemoryProperties = nullptr;
  PFN_vkCreateDevice vkCreateDevice = nullptr;
  PFN_vkGetDeviceProcAddr vkGetDeviceProcAddr = nullptr;
  PFN_vkDestroyDevice vkDestroyDevice = nullptr;
  PFN_vkCreateImage vkCreateImage = nullptr;
  PFN_vkDestroyImage vkDestroyImage = nullptr;
  PFN_vkGetImageMemoryRequirements vkGetImageMemoryRequirements = nullptr;
  PFN_vkAllocateMemory vkAllocateMemory = nullptr;
  PFN_vkFreeMemory vkFreeMemory = nullptr;
  PFN_vkBindImageMemory vkBindImageMemory = nullptr;
  PFN_vkCreateSemaphore vkCreateSemaphore = nullptr;
  PFN_vkDestroySemaphore vkDestroySemaphore = nullptr;
  PFN_vkGetMemoryFdKHR vkGetMemoryFdKHR = nullptr;
  PFN_vkGetSemaphoreFdKHR vkGetSemaphoreFdKHR = nullptr;
  VkInstance instance = VK_NULL_HANDLE;
  VkPhysicalDevice physical = VK_NULL_HANDLE;
  VkDevice vk_device = VK_NULL_HANDLE;
  VkPhysicalDeviceMemoryProperties mem_props{};

  // CUDA driver API (resolved with cuGetProcAddress for this header's ABI)
#define RF_CU_FNS(X)                                                              \
  X(cuInit) X(cuDeviceGetCount) X(cuDeviceGet) X(cuDeviceGetUuid)                 \
  X(cuDevicePrimaryCtxRetain) X(cuDevicePrimaryCtxRelease) X(cuCtxPushCurrent)    \
  X(cuCtxPopCurrent) X(cuCtxSynchronize) X(cuImportExternalMemory)                \
  X(cuExternalMemoryGetMappedMipmappedArray) X(cuMipmappedArrayGetLevel)          \
  X(cuMipmappedArrayDestroy) X(cuDestroyExternalMemory)                           \
  X(cuImportExternalSemaphore) X(cuDestroyExternalSemaphore)                      \
  X(cuWaitExternalSemaphoresAsync) X(cuSignalExternalSemaphoresAsync)             \
  X(cuMemcpy3DAsync) X(cuMemcpy2DAsync) X(cuGetErrorString)
#define RF_CU_MEMBER(name) decltype(&name) p_##name = nullptr;
  RF_CU_FNS(RF_CU_MEMBER)
#undef RF_CU_MEMBER
  CUdevice cu_device = 0;
  CUcontext cu_context = nullptr;

  bool fail(const std::string& msg) {
    error = msg;
    return false;
  }
  bool cu_check(CUresult r, const char* what) {
    if (r == CUDA_SUCCESS) return true;
    const char* s = nullptr;
    if (p_cuGetErrorString) p_cuGetErrorString(r, &s);
    std::fprintf(stderr, "[rillfacet] %s failed: %s\n", what, s ? s : "?");
    return false;
  }
  bool vk_check(VkResult r, const char* what) {
    if (r == VK_SUCCESS) return true;
    std::fprintf(stderr, "[rillfacet] %s failed: VkResult %d\n", what, int(r));
    return false;
  }

  struct CtxGuard {
    CudaShareImpl* s;
    explicit CtxGuard(CudaShareImpl* s_) : s(s_) { s->p_cuCtxPushCurrent(s->cu_context); }
    ~CtxGuard() {
      CUcontext c;
      s->p_cuCtxPopCurrent(&c);
    }
  };

  bool init(const wgpu::Adapter& adapter);
  bool init_vulkan(const wgpu::Adapter& adapter, uint8_t uuid[VK_UUID_SIZE]);
  bool init_cuda(const uint8_t uuid[VK_UUID_SIZE]);
  ~CudaShareImpl();
};

bool CudaShareImpl::init(const wgpu::Adapter& adapter) {
  if (!device.HasFeature(wgpu::FeatureName::SharedTextureMemoryOpaqueFD) ||
      !device.HasFeature(wgpu::FeatureName::SharedFenceVkSemaphoreOpaqueFD))
    return fail("the Dawn device lacks the shared-memory features");
  if (device.HasFeature(wgpu::FeatureName::SharedFenceSyncFD))
    return fail("the Dawn device has SharedFenceSyncFD (CUDA cannot import sync FDs)");
  uint8_t uuid[VK_UUID_SIZE];
  return init_vulkan(adapter, uuid) && init_cuda(uuid);
}

bool CudaShareImpl::init_vulkan(const wgpu::Adapter& adapter, uint8_t uuid[VK_UUID_SIZE]) {
  vk_lib = dlopen("libvulkan.so.1", RTLD_NOW | RTLD_LOCAL);
  if (!vk_lib) return fail("libvulkan.so.1 not found");
  vkGetInstanceProcAddr = reinterpret_cast<PFN_vkGetInstanceProcAddr>(
      dlsym(vk_lib, "vkGetInstanceProcAddr"));
  if (!vkGetInstanceProcAddr) return fail("vkGetInstanceProcAddr missing");
#define RF_VK_GLOBAL(name) name = reinterpret_cast<PFN_##name>(vkGetInstanceProcAddr(nullptr, #name));
  RF_VK_GLOBAL(vkCreateInstance)
  VkApplicationInfo app{VK_STRUCTURE_TYPE_APPLICATION_INFO};
  app.pApplicationName = "rillfacet";
  app.apiVersion = VK_API_VERSION_1_2;
  VkInstanceCreateInfo ii{VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO};
  ii.pApplicationInfo = &app;
  if (!vkCreateInstance || !vk_check(vkCreateInstance(&ii, nullptr, &instance), "vkCreateInstance"))
    return fail("no Vulkan instance");
#define RF_VK_INST(name) name = reinterpret_cast<PFN_##name>(vkGetInstanceProcAddr(instance, #name));
  RF_VK_INST(vkDestroyInstance) RF_VK_INST(vkEnumeratePhysicalDevices)
  RF_VK_INST(vkGetPhysicalDeviceProperties) RF_VK_INST(vkGetPhysicalDeviceProperties2)
  RF_VK_INST(vkGetPhysicalDeviceMemoryProperties) RF_VK_INST(vkCreateDevice)
  RF_VK_INST(vkGetDeviceProcAddr)

  uint32_t n = 0;
  vkEnumeratePhysicalDevices(instance, &n, nullptr);
  std::vector<VkPhysicalDevice> pds(n);
  vkEnumeratePhysicalDevices(instance, &n, pds.data());
  wgpu::AdapterInfo info{};
  adapter.GetInfo(&info);
  for (auto pd : pds) {
    VkPhysicalDeviceProperties p;
    vkGetPhysicalDeviceProperties(pd, &p);
    if (p.vendorID == info.vendorID && p.deviceID == info.deviceID) {
      physical = pd;
      break;
    }
  }
  if (!physical) return fail("no Vulkan device matches the Dawn adapter");
  VkPhysicalDeviceIDProperties idp{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_ID_PROPERTIES};
  VkPhysicalDeviceProperties2 p2{VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_PROPERTIES_2};
  p2.pNext = &idp;
  vkGetPhysicalDeviceProperties2(physical, &p2);
  std::memcpy(uuid, idp.deviceUUID, VK_UUID_SIZE);
  vkGetPhysicalDeviceMemoryProperties(physical, &mem_props);

  float prio = 1.0f;
  VkDeviceQueueCreateInfo qi{VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO};
  qi.queueFamilyIndex = 0;
  qi.queueCount = 1;
  qi.pQueuePriorities = &prio;
  const char* exts[] = {"VK_KHR_external_memory_fd", "VK_KHR_external_semaphore_fd"};
  VkDeviceCreateInfo di{VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO};
  di.queueCreateInfoCount = 1;
  di.pQueueCreateInfos = &qi;
  di.enabledExtensionCount = 2;
  di.ppEnabledExtensionNames = exts;
  if (!vk_check(vkCreateDevice(physical, &di, nullptr, &vk_device), "vkCreateDevice"))
    return fail("no Vulkan device with external memory");
#define RF_VK_DEV(name) name = reinterpret_cast<PFN_##name>(vkGetDeviceProcAddr(vk_device, #name));
  RF_VK_DEV(vkDestroyDevice) RF_VK_DEV(vkCreateImage) RF_VK_DEV(vkDestroyImage)
  RF_VK_DEV(vkGetImageMemoryRequirements) RF_VK_DEV(vkAllocateMemory) RF_VK_DEV(vkFreeMemory)
  RF_VK_DEV(vkBindImageMemory) RF_VK_DEV(vkCreateSemaphore) RF_VK_DEV(vkDestroySemaphore)
  RF_VK_DEV(vkGetMemoryFdKHR) RF_VK_DEV(vkGetSemaphoreFdKHR)
  if (!vkGetMemoryFdKHR || !vkGetSemaphoreFdKHR) return fail("Vulkan external fd functions missing");
  return true;
}

bool CudaShareImpl::init_cuda(const uint8_t uuid[VK_UUID_SIZE]) {
  cu_lib = dlopen("libcuda.so.1", RTLD_NOW | RTLD_LOCAL);
  if (!cu_lib) return fail("libcuda.so.1 not found");
  using GetProc = CUresult (*)(const char*, void**, int, cuuint64_t, CUdriverProcAddressQueryResult*);
  auto get = reinterpret_cast<GetProc>(dlsym(cu_lib, "cuGetProcAddress_v2"));
  if (!get) return fail("cuGetProcAddress_v2 missing (CUDA driver too old)");
  bool all = true;
#define RF_CU_LOAD(name)                                                                  \
  {                                                                                       \
    CUdriverProcAddressQueryResult st;                                                    \
    if (get(#name, reinterpret_cast<void**>(&p_##name), CUDA_VERSION,                     \
            CU_GET_PROC_ADDRESS_DEFAULT, &st) != CUDA_SUCCESS || !p_##name)               \
      all = false;                                                                        \
  }
  RF_CU_FNS(RF_CU_LOAD)
#undef RF_CU_LOAD
  if (!all) return fail("CUDA driver functions missing");
  if (!cu_check(p_cuInit(0), "cuInit")) return fail("cuInit failed");
  int count = 0;
  p_cuDeviceGetCount(&count);
  for (int i = 0; i < count; ++i) {
    CUdevice d;
    CUuuid u;
    if (p_cuDeviceGet(&d, i) != CUDA_SUCCESS || p_cuDeviceGetUuid(&u, d) != CUDA_SUCCESS) continue;
    if (std::memcmp(u.bytes, uuid, VK_UUID_SIZE) == 0) {
      cu_device = d;
      if (!cu_check(p_cuDevicePrimaryCtxRetain(&cu_context, d), "cuDevicePrimaryCtxRetain"))
        return fail("no CUDA context");
      ok = true;
      return true;
    }
  }
  return fail("no CUDA device matches the Vulkan device");
}

CudaShareImpl::~CudaShareImpl() {
  if (cu_context) {
    p_cuCtxPushCurrent(cu_context);
    p_cuCtxSynchronize();
    CUcontext c;
    p_cuCtxPopCurrent(&c);
    p_cuDevicePrimaryCtxRelease(cu_device);
  }
  if (vk_device) vkDestroyDevice(vk_device, nullptr);
  if (instance) vkDestroyInstance(instance, nullptr);
  // The libraries stay loaded: Dawn and torch use them too.
}

struct SharedImageImpl {
  CudaShareImpl* s = nullptr;
  uint32_t W = 0, H = 0, layers = 1, bpp = 4;
  VkImage image = VK_NULL_HANDLE;
  VkDeviceMemory memory = VK_NULL_HANDLE;
  VkSemaphore back = VK_NULL_HANDLE;   // CUDA -> Dawn
  int fd = -1, back_fd = -1;
  VkImageCreateInfo ici{};
  VkExternalMemoryImageCreateInfo emi{};
  VkImageFormatListCreateInfo fli{};
  VkFormat view_formats[2] = {VK_FORMAT_R8G8B8A8_UNORM, VK_FORMAT_R8G8B8A8_SRGB};
  uint32_t mem_type = 0;
  uint64_t size = 0;
  wgpu::SharedTextureMemory stm;
  wgpu::Texture tex;
  wgpu::SharedFence back_fence;
  CUexternalMemory cu_mem = nullptr;
  CUmipmappedArray cu_mip = nullptr;
  CUarray cu_arr = nullptr;
  CUexternalSemaphore cu_back = nullptr;
  CUexternalSemaphore cu_done = nullptr;   // Dawn's last EndAccess fence
  bool back_pending = false, done_pending = false, initialized = false;
  int32_t layout_old = 0, layout_new = 0;

  bool create(wgpu::TextureFormat format, uint32_t w, uint32_t h, uint32_t l,
              wgpu::TextureUsage usage);
  ~SharedImageImpl();
};

bool SharedImageImpl::create(wgpu::TextureFormat format, uint32_t w, uint32_t h, uint32_t l,
                             wgpu::TextureUsage usage) {
  FormatInfo fi;
  if (!format_info(format, fi)) {
    std::fprintf(stderr, "[rillfacet] SharedImage: unsupported format\n");
    return false;
  }
  W = w; H = h; layers = l; bpp = fi.bpp;
  emi = {VK_STRUCTURE_TYPE_EXTERNAL_MEMORY_IMAGE_CREATE_INFO};
  emi.handleTypes = VK_EXTERNAL_MEMORY_HANDLE_TYPE_OPAQUE_FD_BIT;
  ici = {VK_STRUCTURE_TYPE_IMAGE_CREATE_INFO};
  ici.pNext = &emi;
  ici.imageType = VK_IMAGE_TYPE_2D;
  ici.format = fi.vk;
  ici.extent = {w, h, 1};
  ici.mipLevels = 1;
  ici.arrayLayers = l;
  ici.samples = VK_SAMPLE_COUNT_1_BIT;
  ici.tiling = VK_IMAGE_TILING_OPTIMAL;
  ici.usage = VK_IMAGE_USAGE_TRANSFER_SRC_BIT | VK_IMAGE_USAGE_TRANSFER_DST_BIT;
  if (usage & wgpu::TextureUsage::RenderAttachment) ici.usage |= VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT;
  if (usage & wgpu::TextureUsage::TextureBinding) ici.usage |= VK_IMAGE_USAGE_SAMPLED_BIT;
  if (usage & wgpu::TextureUsage::StorageBinding) ici.usage |= VK_IMAGE_USAGE_STORAGE_BIT;
  ici.sharingMode = VK_SHARING_MODE_EXCLUSIVE;
  ici.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
  if (fi.vk == VK_FORMAT_R8G8B8A8_UNORM) {
    // Dawn requires RGBA8 to be reinterpretable as sRGB; the list keeps it
    // compressible.
    fli = {VK_STRUCTURE_TYPE_IMAGE_FORMAT_LIST_CREATE_INFO};
    fli.viewFormatCount = 2;
    fli.pViewFormats = view_formats;
    emi.pNext = &fli;
    ici.flags = VK_IMAGE_CREATE_MUTABLE_FORMAT_BIT;
  }
  if (!s->vk_check(s->vkCreateImage(s->vk_device, &ici, nullptr, &image), "vkCreateImage")) return false;
  VkMemoryRequirements req;
  s->vkGetImageMemoryRequirements(s->vk_device, image, &req);
  mem_type = UINT32_MAX;
  for (uint32_t i = 0; i < s->mem_props.memoryTypeCount; ++i)
    if ((req.memoryTypeBits & (1u << i)) &&
        (s->mem_props.memoryTypes[i].propertyFlags & VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT)) {
      mem_type = i;
      break;
    }
  if (mem_type == UINT32_MAX) return false;
  size = req.size;
  VkMemoryDedicatedAllocateInfo ded{VK_STRUCTURE_TYPE_MEMORY_DEDICATED_ALLOCATE_INFO};
  ded.image = image;
  VkExportMemoryAllocateInfo exp{VK_STRUCTURE_TYPE_EXPORT_MEMORY_ALLOCATE_INFO};
  exp.pNext = &ded;
  exp.handleTypes = VK_EXTERNAL_MEMORY_HANDLE_TYPE_OPAQUE_FD_BIT;
  VkMemoryAllocateInfo ai{VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO};
  ai.pNext = &exp;
  ai.allocationSize = size;
  ai.memoryTypeIndex = mem_type;
  if (!s->vk_check(s->vkAllocateMemory(s->vk_device, &ai, nullptr, &memory), "vkAllocateMemory") ||
      !s->vk_check(s->vkBindImageMemory(s->vk_device, image, memory, 0), "vkBindImageMemory"))
    return false;
  VkMemoryGetFdInfoKHR gi{VK_STRUCTURE_TYPE_MEMORY_GET_FD_INFO_KHR};
  gi.memory = memory;
  gi.handleType = VK_EXTERNAL_MEMORY_HANDLE_TYPE_OPAQUE_FD_BIT;
  if (!s->vk_check(s->vkGetMemoryFdKHR(s->vk_device, &gi, &fd), "vkGetMemoryFdKHR")) return false;
  VkExportSemaphoreCreateInfo esi{VK_STRUCTURE_TYPE_EXPORT_SEMAPHORE_CREATE_INFO};
  esi.handleTypes = VK_EXTERNAL_SEMAPHORE_HANDLE_TYPE_OPAQUE_FD_BIT;
  VkSemaphoreCreateInfo sci{VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO};
  sci.pNext = &esi;
  if (!s->vk_check(s->vkCreateSemaphore(s->vk_device, &sci, nullptr, &back), "vkCreateSemaphore"))
    return false;
  VkSemaphoreGetFdInfoKHR sgi{VK_STRUCTURE_TYPE_SEMAPHORE_GET_FD_INFO_KHR};
  sgi.semaphore = back;
  sgi.handleType = VK_EXTERNAL_SEMAPHORE_HANDLE_TYPE_OPAQUE_FD_BIT;
  if (!s->vk_check(s->vkGetSemaphoreFdKHR(s->vk_device, &sgi, &back_fd), "vkGetSemaphoreFdKHR"))
    return false;

  // Dawn: its own VkImage from the same create info, bound to this memory.
  wgpu::SharedTextureMemoryOpaqueFDDescriptor fdd{};
  fdd.vkImageCreateInfo = &ici;
  fdd.memoryFD = dup(fd);
  fdd.memoryTypeIndex = mem_type;
  fdd.allocationSize = size;
  fdd.dedicatedAllocation = true;
  wgpu::SharedTextureMemoryDescriptor sd{};
  sd.nextInChain = &fdd;
  stm = s->device.ImportSharedTextureMemory(&sd);
  if (!stm) return false;
  tex = stm.CreateTexture();
  if (!tex) return false;
  wgpu::SharedFenceVkSemaphoreOpaqueFDDescriptor bfd{};
  bfd.handle = back_fd;   // Dawn duplicates it
  wgpu::SharedFenceDescriptor bsd{};
  bsd.nextInChain = &bfd;
  back_fence = s->device.ImportSharedFence(&bsd);
  if (!back_fence) return false;

  // CUDA
  CudaShareImpl::CtxGuard g(s);
  CUDA_EXTERNAL_MEMORY_HANDLE_DESC md{};
  md.type = CU_EXTERNAL_MEMORY_HANDLE_TYPE_OPAQUE_FD;
  md.handle.fd = dup(fd);
  md.size = size;
  md.flags = CUDA_EXTERNAL_MEMORY_DEDICATED;
  if (!s->cu_check(s->p_cuImportExternalMemory(&cu_mem, &md), "cuImportExternalMemory")) return false;
  CUDA_EXTERNAL_MEMORY_MIPMAPPED_ARRAY_DESC ad{};
  ad.arrayDesc.Width = w;
  ad.arrayDesc.Height = h;
  ad.arrayDesc.Depth = l > 1 ? l : 0;
  ad.arrayDesc.Format = fi.cu;
  ad.arrayDesc.NumChannels = fi.channels;
  ad.arrayDesc.Flags = CUDA_ARRAY3D_COLOR_ATTACHMENT | (l > 1 ? CUDA_ARRAY3D_LAYERED : 0);
  ad.numLevels = 1;
  if (!s->cu_check(s->p_cuExternalMemoryGetMappedMipmappedArray(&cu_mip, cu_mem, &ad),
                   "cuExternalMemoryGetMappedMipmappedArray") ||
      !s->cu_check(s->p_cuMipmappedArrayGetLevel(&cu_arr, cu_mip, 0), "cuMipmappedArrayGetLevel"))
    return false;
  CUDA_EXTERNAL_SEMAPHORE_HANDLE_DESC bd{};
  bd.type = CU_EXTERNAL_SEMAPHORE_HANDLE_TYPE_OPAQUE_FD;
  bd.handle.fd = dup(back_fd);
  return s->cu_check(s->p_cuImportExternalSemaphore(&cu_back, &bd), "cuImportExternalSemaphore");
}

SharedImageImpl::~SharedImageImpl() {
  if (s->cu_context) {
    CudaShareImpl::CtxGuard g(s);
    if (cu_done) s->p_cuDestroyExternalSemaphore(cu_done);
    if (cu_back) s->p_cuDestroyExternalSemaphore(cu_back);
    if (cu_mip) s->p_cuMipmappedArrayDestroy(cu_mip);
    if (cu_mem) s->p_cuDestroyExternalMemory(cu_mem);
  }
  back_fence = nullptr;
  tex = nullptr;
  stm = nullptr;
  if (fd >= 0) close(fd);
  if (back_fd >= 0) close(back_fd);
  if (back) s->vkDestroySemaphore(s->vk_device, back, nullptr);
  if (image) s->vkDestroyImage(s->vk_device, image, nullptr);
  if (memory) s->vkFreeMemory(s->vk_device, memory, nullptr);
}

SharedImage::SharedImage(std::unique_ptr<SharedImageImpl> impl) : impl_(std::move(impl)) {}
SharedImage::~SharedImage() = default;
wgpu::Texture SharedImage::texture() const { return impl_->tex; }
uint32_t SharedImage::width() const { return impl_->W; }
uint32_t SharedImage::height() const { return impl_->H; }
uint32_t SharedImage::layers() const { return impl_->layers; }

bool SharedImage::begin(bool contents_from_cuda) {
  auto& m = *impl_;
  wgpu::SharedTextureMemoryVkImageLayoutBeginState lb{};
  lb.oldLayout = m.layout_old;
  lb.newLayout = m.layout_new;
  if (contents_from_cuda && !m.initialized)  // written by CUDA before Dawn ever used it
    lb.oldLayout = lb.newLayout = VK_IMAGE_LAYOUT_GENERAL;
  wgpu::SharedTextureMemoryBeginAccessDescriptor bad{};
  bad.nextInChain = &lb;
  bad.initialized = m.initialized || contents_from_cuda;
  uint64_t one = 1;
  if (m.back_pending) {
    bad.fenceCount = 1;
    bad.fences = &m.back_fence;
    bad.signaledValueCount = 1;
    bad.signaledValues = &one;
    m.back_pending = false;
  }
  return m.stm.BeginAccess(m.tex, &bad) == wgpu::Status::Success;
}

bool SharedImage::end() {
  auto& m = *impl_;
  wgpu::SharedTextureMemoryVkImageLayoutEndState le{};
  wgpu::SharedTextureMemoryEndAccessState es{};
  es.nextInChain = &le;
  if (m.stm.EndAccess(m.tex, &es) != wgpu::Status::Success) return false;
  m.layout_old = le.oldLayout;
  m.layout_new = le.newLayout;
  m.initialized = true;
  if (es.fenceCount != 1) return false;
  wgpu::SharedFenceVkSemaphoreOpaqueFDExportInfo fx{};
  wgpu::SharedFenceExportInfo xi{};
  xi.nextInChain = &fx;
  es.fences[0].ExportInfo(&xi);
  if (xi.type != wgpu::SharedFenceType::VkSemaphoreOpaqueFD) return false;
  CudaShareImpl::CtxGuard g(m.s);
  if (m.cu_done) m.s->p_cuDestroyExternalSemaphore(m.cu_done);
  m.cu_done = nullptr;
  CUDA_EXTERNAL_SEMAPHORE_HANDLE_DESC sd{};
  sd.type = CU_EXTERNAL_SEMAPHORE_HANDLE_TYPE_OPAQUE_FD;
  sd.handle.fd = dup(fx.handle);
  if (!m.s->cu_check(m.s->p_cuImportExternalSemaphore(&m.cu_done, &sd), "cuImportExternalSemaphore"))
    return false;
  m.done_pending = true;
  return true;
}

bool SharedImage::wait_dawn(void* stream) {
  auto& m = *impl_;
  if (!m.done_pending) return true;
  CudaShareImpl::CtxGuard g(m.s);
  CUDA_EXTERNAL_SEMAPHORE_WAIT_PARAMS wp{};
  m.done_pending = false;
  return m.s->cu_check(m.s->p_cuWaitExternalSemaphoresAsync(&m.cu_done, &wp, 1,
                                                            static_cast<CUstream>(stream)),
                       "cuWaitExternalSemaphoresAsync");
}

bool SharedImage::signal_dawn(void* stream) {
  auto& m = *impl_;
  CudaShareImpl::CtxGuard g(m.s);
  CUDA_EXTERNAL_SEMAPHORE_SIGNAL_PARAMS sp{};
  m.back_pending = true;
  return m.s->cu_check(m.s->p_cuSignalExternalSemaphoresAsync(&m.cu_back, &sp, 1,
                                                              static_cast<CUstream>(stream)),
                       "cuSignalExternalSemaphoresAsync");
}

bool SharedImage::copy_to(void* dst, uint64_t rows, void* stream) {
  auto& m = *impl_;
  CudaShareImpl::CtxGuard g(m.s);
  const uint64_t row_bytes = uint64_t(m.W) * m.bpp;
  const uint64_t full = rows / m.H, rem = rows % m.H;
  CUDA_MEMCPY3D p{};
  p.srcMemoryType = CU_MEMORYTYPE_ARRAY;
  p.srcArray = m.cu_arr;
  p.dstMemoryType = CU_MEMORYTYPE_DEVICE;
  p.dstDevice = reinterpret_cast<CUdeviceptr>(dst);
  p.dstPitch = row_bytes;
  p.dstHeight = m.H;
  p.WidthInBytes = row_bytes;
  if (full) {
    p.Height = m.H;
    p.Depth = full;
    if (!m.s->cu_check(m.s->p_cuMemcpy3DAsync(&p, static_cast<CUstream>(stream)), "cuMemcpy3DAsync"))
      return false;
  }
  if (rem) {
    p.srcZ = full;
    p.dstDevice = reinterpret_cast<CUdeviceptr>(dst) + full * m.H * row_bytes;
    p.Height = rem;
    p.Depth = 1;
    if (!m.s->cu_check(m.s->p_cuMemcpy3DAsync(&p, static_cast<CUstream>(stream)), "cuMemcpy3DAsync"))
      return false;
  }
  return true;
}

bool SharedImage::copy_from(const void* src, uint64_t src_pitch, uint64_t rows, void* stream) {
  auto& m = *impl_;
  CudaShareImpl::CtxGuard g(m.s);
  CUDA_MEMCPY2D p{};
  p.srcMemoryType = CU_MEMORYTYPE_DEVICE;
  p.srcDevice = reinterpret_cast<CUdeviceptr>(src);
  p.srcPitch = src_pitch;
  p.dstMemoryType = CU_MEMORYTYPE_ARRAY;
  p.dstArray = m.cu_arr;
  p.WidthInBytes = uint64_t(m.W) * m.bpp;
  p.Height = rows;
  return m.s->cu_check(m.s->p_cuMemcpy2DAsync(&p, static_cast<CUstream>(stream)), "cuMemcpy2DAsync");
}

CudaShare::CudaShare(const wgpu::Adapter& adapter, const wgpu::Device& device)
    : impl_(std::make_unique<CudaShareImpl>()) {
  impl_->device = device;
  impl_->init(adapter);
}
CudaShare::~CudaShare() = default;
bool CudaShare::available() const { return impl_->ok; }
const std::string& CudaShare::error() const { return impl_->error; }
void CudaShare::synchronize() {
  if (!impl_->ok) return;
  CudaShareImpl::CtxGuard g(impl_.get());
  impl_->p_cuCtxSynchronize();
}

std::unique_ptr<SharedImage> CudaShare::create(wgpu::TextureFormat format, uint32_t width,
                                               uint32_t height, uint32_t layers,
                                               wgpu::TextureUsage usage) {
  if (!impl_->ok) return nullptr;
  auto m = std::make_unique<SharedImageImpl>();
  m->s = impl_.get();
  if (!m->create(format, width, height, layers, usage)) return nullptr;
  return std::unique_ptr<SharedImage>(new SharedImage(std::move(m)));
}

#else  // no cuda.h at build time: zero-copy is unavailable

struct SharedImageImpl {};
struct CudaShareImpl {
  std::string error = "rillfacet was built without CUDA headers (zero-copy disabled)";
};
SharedImage::SharedImage(std::unique_ptr<SharedImageImpl> impl) : impl_(std::move(impl)) {}
SharedImage::~SharedImage() = default;
wgpu::Texture SharedImage::texture() const { return nullptr; }
bool SharedImage::begin(bool) { return false; }
bool SharedImage::end() { return false; }
bool SharedImage::wait_dawn(void*) { return false; }
bool SharedImage::signal_dawn(void*) { return false; }
bool SharedImage::copy_to(void*, uint64_t, void*) { return false; }
bool SharedImage::copy_from(const void*, uint64_t, uint64_t, void*) { return false; }
uint32_t SharedImage::width() const { return 0; }
uint32_t SharedImage::height() const { return 0; }
uint32_t SharedImage::layers() const { return 0; }
CudaShare::CudaShare(const wgpu::Adapter&, const wgpu::Device&)
    : impl_(std::make_unique<CudaShareImpl>()) {}
CudaShare::~CudaShare() = default;
bool CudaShare::available() const { return false; }
const std::string& CudaShare::error() const { return impl_->error; }
void CudaShare::synchronize() {}
std::unique_ptr<SharedImage> CudaShare::create(wgpu::TextureFormat, uint32_t, uint32_t, uint32_t,
                                               wgpu::TextureUsage) {
  return nullptr;
}

#endif

}  // namespace rillfacet
