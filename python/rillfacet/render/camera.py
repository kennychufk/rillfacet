"""OpenCV camera model shared by the renderers.

Pixel coordinates are OpenCV's (pixel centers at integers, so pixel ``i``
spans ``[i - 0.5, i + 0.5]``); the camera frame is x right, y down, z
forward. Distortion coefficients follow OpenCV's order
``k1 k2 p1 p2 [k3 [k4 k5 k6 [s1 s2 s3 s4]]]`` (rational + thin prism).

A ray renderer samples a pixel at a sub-pixel position and needs the
undistorted direction there: :class:`PixelRays` undistorts the pixel
CORNERS once and interpolates them bilinearly per sample, so distortion
costs nothing per frame and no resampling of a pinhole render is needed.
"""
from __future__ import annotations

import numpy as np

__all__ = ["distort", "undistort", "radial_fold", "PixelRays", "look_at",
           "scale_intrinsics", "aperture_radius"]


def _coeffs(dist):
    d = np.zeros(14)
    if dist is not None:
        d0 = np.asarray(dist, np.float64).ravel()
        d[:len(d0)] = d0
    if np.any(d[12:]):
        raise NotImplementedError("tilted sensor models (tau_x, tau_y)")
    return d


def distort(x, y, dist):
    """Normalized undistorted ``(x, y)`` -> distorted (OpenCV's forward
    model). numpy arrays, any shape."""
    k1, k2, p1, p2, k3, k4, k5, k6, s1, s2, s3, s4 = _coeffs(dist)[:12]
    r2 = x * x + y * y
    r4, r6 = r2 * r2, r2 * r2 * r2
    radial = (1 + k1 * r2 + k2 * r4 + k3 * r6) / (1 + k4 * r2 + k5 * r4 + k6 * r6)
    xd = x * radial + 2 * p1 * x * y + p2 * (r2 + 2 * x * x) + s1 * r2 + s2 * r4
    yd = y * radial + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y + s3 * r2 + s4 * r4
    return xd, yd


def radial_fold(dist, r_max=10.0):
    """Undistorted radius where the radial map ``r * radial(r)`` stops
    increasing (``r_max`` if it never does): beyond it the model folds
    back, so distorted radii above its value have no inverse. Wide-angle
    calibrations often fold just outside the image corners they were not
    fitted on."""
    d = _coeffs(dist)
    r = np.linspace(0.0, r_max, 20001)
    _, f = _radial(r, d)
    df = np.diff(f)
    bad = np.nonzero(df <= 0)[0]
    return float(r[bad[0]]) if len(bad) else float(r_max)


def _radial(r, d):
    k1, k2, k3, k4, k5, k6 = d[0], d[1], d[4], d[5], d[6], d[7]
    r2 = r * r
    rad = (1 + k1 * r2 + k2 * r2 ** 2 + k3 * r2 ** 3) / \
          (1 + k4 * r2 + k5 * r2 ** 2 + k6 * r2 ** 3)
    return rad, r * rad


def undistort(xd, yd, dist, iters=8):
    """Inverse of :func:`distort`: ``(x, y, residual)`` with ``residual``
    the re-projection error ``|distort(x, y) - (xd, yd)|``.

    OpenCV's fixed-point iteration diverges on strong wide-angle models, so
    this inverts the radial part by bisection up to :func:`radial_fold`,
    then refines with the full model (tangential, thin prism) by Newton
    steps. Points beyond the fold get the fold's radius (their residual
    shows by how much they are outside the model)."""
    d = _coeffs(dist)
    xd = np.asarray(xd, np.float64)
    yd = np.asarray(yd, np.float64)
    rd = np.hypot(xd, yd)
    r_fold = radial_fold(d)
    lo, hi = np.zeros_like(rd), np.full_like(rd, r_fold)
    for _ in range(60):                      # f(r) = rd, f increasing on [0, fold]
        mid = 0.5 * (lo + hi)
        below = _radial(mid, d)[1] < rd
        lo, hi = np.where(below, mid, lo), np.where(below, hi, mid)
    r = 0.5 * (lo + hi)
    s = np.where(rd > 0, r / np.where(rd > 0, rd, 1.0), 1.0)
    x, y = xd * s, yd * s
    ex, ey = distort(x, y, d)
    best = np.hypot(ex - xd, ey - yd)
    h = 1e-7
    for _ in range(iters):                   # Newton on the full model
        fx, fy = ex - xd, ey - yd
        ax, ay = distort(x + h, y, d)
        bx, by = distort(x, y + h, d)
        j11, j21 = (ax - ex) / h, (ay - ey) / h
        j12, j22 = (bx - ex) / h, (by - ey) / h
        det = j11 * j22 - j12 * j21
        ok = np.abs(det) > 1e-12
        det = np.where(ok, det, 1.0)
        xn = x - np.where(ok, (j22 * fx - j12 * fy) / det, 0.0)
        yn = y - np.where(ok, (j11 * fy - j21 * fx) / det, 0.0)
        exn, eyn = distort(xn, yn, d)
        res = np.hypot(exn - xd, eyn - yd)
        # keep only improving steps that stay on the invertible side
        take = (res < best) & (np.hypot(xn, yn) <= r_fold)
        x, y = np.where(take, xn, x), np.where(take, yn, y)
        ex, ey = np.where(take, exn, ex), np.where(take, eyn, ey)
        best = np.where(take, res, best)
    return x, y, best


class PixelRays:
    """Undistorted normalized coordinates of a camera's pixels, on the GPU.

    ``corners`` ``[H + 1, W + 1, 2]`` holds ``(x, y)`` (camera ray
    ``(x, y, 1)``) at every pixel corner; :meth:`at` interpolates them at
    continuous positions. Without distortion this is exact (the map is
    affine); with it, the error is the curvature of the map within a pixel.
    Renderers use the per-pixel linearization (:attr:`center`,
    :attr:`d_du`, :attr:`d_dv`: ``(x, y)`` at a pixel's center and its
    derivatives along u and v), which broadcasts over envs and samples
    without gathers.
    ``outside`` is the fraction of pixel corners the distortion model
    cannot reach (beyond its fold: no inverse, they get the nearest
    reachable ray) and ``max_residual`` the worst re-projection error, in
    pixels, of the others."""

    #: Re-projection error (pixels) above which a corner counts as outside.
    OUTSIDE_PX = 0.01

    def __init__(self, K, width, height, dist=None, device="cuda"):
        import torch
        K = np.asarray(K, np.float64)
        fx, fy, cx, cy, skew = K[0, 0], K[1, 1], K[0, 2], K[1, 2], K[0, 1]
        self.width, self.height = int(width), int(height)
        u = np.arange(self.width + 1) - 0.5           # corner positions
        v = np.arange(self.height + 1) - 0.5
        uu, vv = np.meshgrid(u, v)
        yd = (vv - cy) / fy
        xd = (uu - cx - skew * yd) / fx
        if dist is None or not np.any(dist):
            x, y, res = xd, yd, np.zeros(1)
        else:
            x, y, res = undistort(xd, yd, dist)
        beyond = res * fx > self.OUTSIDE_PX
        self.outside = float(np.mean(beyond))
        self.max_residual = float(np.max(np.where(beyond, 0.0, res)) * fx)
        self.corners = torch.as_tensor(np.stack([x, y], -1), dtype=torch.float32,
                                       device=device)
        # Per pixel, the bilinear map linearized at the center: the value
        # there and its gradient in (u, v), [H * W] each (row-major).
        c = self.corners
        c00, c01, c10, c11 = c[:-1, :-1], c[:-1, 1:], c[1:, :-1], c[1:, 1:]
        self.center = (0.25 * (c00 + c01 + c10 + c11)).reshape(-1, 2)
        self.d_du = (0.5 * (c01 - c00 + c11 - c10)).reshape(-1, 2)
        self.d_dv = (0.5 * (c10 - c00 + c11 - c01)).reshape(-1, 2)

    def at(self, u, v):
        """``(x, y)`` at continuous positions measured from the image's
        top-left corner (``u`` in ``[0, W]``, ``v`` in ``[0, H]``; pixel
        ``i``'s center is at ``i + 0.5``). torch tensors, same shape."""
        import torch
        W, H = self.width, self.height
        u = u.clamp(0, W)
        v = v.clamp(0, H)
        i0 = v.floor().clamp(max=H - 1).long()
        j0 = u.floor().clamp(max=W - 1).long()
        fv, fu = (v - i0)[..., None], (u - j0)[..., None]
        c = self.corners
        top = c[i0, j0] * (1 - fu) + c[i0, j0 + 1] * fu
        bot = c[i0 + 1, j0] * (1 - fu) + c[i0 + 1, j0 + 1] * fu
        xy = top * (1 - fv) + bot * fv
        return xy[..., 0], xy[..., 1]


def look_at(eye, target, up=(0.0, 0.0, 1.0)):
    """``[7]`` pose of an OpenCV camera (z forward, y down) at ``eye``
    looking at ``target``, image up toward ``up``."""
    eye, target, up = (np.asarray(a, np.float64) for a in (eye, target, up))
    z = target - eye
    z /= np.linalg.norm(z)
    x = np.cross(z, up)
    if np.linalg.norm(x) < 1e-9:
        raise ValueError("look_at: view direction parallel to up")
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    return np.concatenate([eye, _mat_to_quat(np.stack([x, y, z], 1))])


def _mat_to_quat(R):
    """xyzw quaternion of a rotation matrix."""
    t = np.trace(R)
    if t > 0:
        s = 2.0 * np.sqrt(t + 1.0)
        q = [(R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s,
             (R[1, 0] - R[0, 1]) / s, 0.25 * s]
    else:
        i = int(np.argmax(np.diag(R)))
        j, k = (i + 1) % 3, (i + 2) % 3
        s = 2.0 * np.sqrt(1.0 + R[i, i] - R[j, j] - R[k, k])
        q = [0.0] * 4
        q[i] = 0.25 * s
        q[j] = (R[j, i] + R[i, j]) / s
        q[k] = (R[k, i] + R[i, k]) / s
        q[3] = (R[k, j] - R[j, k]) / s
    q = np.asarray(q)
    return q / np.linalg.norm(q)


def scale_intrinsics(K, from_size, to_size):
    """``K`` of a ``from_size`` (w, h) calibration, for images resized to
    ``to_size`` (pixel centers at integers, so the shift is about -0.5)."""
    K = np.array(K, np.float64)
    sx = to_size[0] / from_size[0]
    sy = to_size[1] / from_size[1]
    out = K.copy()
    out[0, 0], out[0, 1], out[1, 1] = K[0, 0] * sx, K[0, 1] * sx, K[1, 1] * sy
    out[0, 2] = (K[0, 2] + 0.5) * sx - 0.5
    out[1, 2] = (K[1, 2] + 0.5) * sy - 0.5
    return out


def aperture_radius(focal_length, f_number):
    """Entrance pupil radius (same unit as ``focal_length``) of a lens at
    ``f_number``: ``f / 2N``."""
    return focal_length / (2.0 * f_number)
