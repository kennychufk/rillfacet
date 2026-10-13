"""The camera sensor stage every renderer shares: from the linear radiance a
backend renders to the camera's linear image, per instance (env).

    x = gain * (1 - vignetting * r^2) * L
    x += sqrt(shot_noise * x + read_noise^2) * N(0, 1)    (each channel)
    x = max(x, 0)

``L`` is the rendered linear radiance ``[I, H, W, 3]``, ``r`` the distance
from the principal point over the distance to the image corner farthest from
it (so ``vignetting`` is the fraction of light lost at that corner), and the
noise the heteroscedastic Gaussian approximation of Poisson shot noise plus
Gaussian read noise, in units of the linear image (white = 1). For a raw
sensor ``shot_noise`` is about 1 / full-well electrons at the applied gain;
Brooks et al., "Unprocessing Images for Learned Raw Denoising" (CVPR 2019)
sample ``log shot_noise`` uniformly in [log 1e-4, log 1.2e-2] and
``log read_noise = 2.18 log shot_noise + 1.2 + N(0, 0.26)``. Cameras whose
ISP corrects lens shading and denoises (the Raspberry Pi's libcamera does
both) leave much less of either.

Renderers call :func:`apply` on their linear radiance; its result is the
``"linear"`` output and, through sRGB, the ``"rgb"`` one.
"""
from __future__ import annotations

import numpy as np

__all__ = ["apply", "radius2"]


def radius2(K, width, height, device=None):
    """``[H, W]`` squared normalized distance ``r^2`` of each pixel center
    from the principal point (``r = 1`` at the farthest image corner)."""
    import torch
    K = np.asarray(K, np.float64)
    cx, cy = K[0, 2], K[1, 2]
    corners = np.array([[-0.5, -0.5], [width - 0.5, -0.5],
                        [-0.5, height - 0.5], [width - 0.5, height - 0.5]])
    rmax2 = float(np.max((corners[:, 0] - cx) ** 2 + (corners[:, 1] - cy) ** 2))
    v, u = torch.meshgrid(
        torch.arange(height, dtype=torch.float64, device=device),
        torch.arange(width, dtype=torch.float64, device=device), indexing="ij")
    return (((u - cx) ** 2 + (v - cy) ** 2) / rmax2).float()


def apply(cam, radiance, *, generator=None, r2=None):
    """The sensor image of :class:`~rillfacet.scene_api.CameraSensor`
    ``cam`` from linear ``radiance`` ``[I, H, W, 3]`` (torch): gain,
    vignetting, then shot and read noise drawn with ``generator`` (a torch
    generator on the radiance's device). ``r2`` is a cached
    :func:`radius2` of the camera. Values are clamped at 0."""
    import torch
    dev = radiance.device
    I = radiance.shape[0]

    def per_instance(v, shape):
        return torch.as_tensor(np.asarray(v, np.float32), device=dev).reshape(
            I, *shape)

    x = radiance * per_instance(cam.gain, (1, 1, 3))
    vig = np.asarray(cam.vignetting)
    if vig.any():
        if r2 is None:
            r2 = radius2(cam.K, cam.width, cam.height, dev)
        x = x * (1.0 - per_instance(vig, (1, 1)) * r2)[..., None]
    shot, read = np.asarray(cam.shot_noise), np.asarray(cam.read_noise)
    if shot.any() or read.any():
        var = (per_instance(shot, (1, 1, 1)) * x.clamp(min=0)
               + per_instance(read, (1, 1, 1)) ** 2)
        noise = torch.randn(x.shape, device=dev, generator=generator)
        x = x + var.sqrt() * noise
    return x.clamp(min=0)
