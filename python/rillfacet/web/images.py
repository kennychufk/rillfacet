"""JPEG sheets: the web viewer's wire and record format of camera images.

A step of a scene's :class:`~rillfacet.scene_api.Images` is ``[n, C, H, W, 3]``
uint8 (``C`` views of ``n`` instances). It travels and is stored as ONE JPEG,
a sheet with a row per instance and a column per view: at the small images a
vision policy sees, the headers of one JPEG per view would outweigh its
pixels. Chroma is not subsampled, which at 64 x 48 buys more than the same
bytes spent on luma. Needs Pillow (``pip install rillfacet[images]``).
"""
from __future__ import annotations

import io

import numpy as np

__all__ = ["JPEG_QUALITY", "encode_sheet", "decode_sheet", "encode_images",
           "decode_images"]

#: JPEG quality of live frames, ring replays and records.
JPEG_QUALITY = 85


def _pil():
    try:
        from PIL import Image
    except ImportError as e:
        raise ImportError("rillfacet: camera images need Pillow "
                          "(pip install rillfacet[images])") from e
    return Image


def encode_sheet(images, quality: int = JPEG_QUALITY) -> bytes:
    """``[n, C, H, W, 3]`` uint8 -> the JPEG bytes of its sheet."""
    a = np.asarray(images, np.uint8)
    n, C, H, W, _ = a.shape
    sheet = a.transpose(0, 2, 1, 3, 4).reshape(n * H, C * W, 3)
    buf = io.BytesIO()
    _pil().fromarray(sheet).save(buf, "JPEG", quality=int(quality),
                                 subsampling=0)
    return buf.getvalue()


def decode_sheet(data, shape) -> np.ndarray:
    """Inverse of :func:`encode_sheet`; ``shape`` = ``(n, C, H, W)``."""
    n, C, H, W = (int(x) for x in shape)
    sheet = np.asarray(_pil().open(io.BytesIO(bytes(data))).convert("RGB"))
    return sheet.reshape(n, H, C, W, 3).transpose(0, 2, 1, 3, 4)


def encode_images(images, quality: int = JPEG_QUALITY) -> dict:
    """``[K, n, C, H, W, 3]`` -> ``{"shape", "offsets" [K + 1], "data"}``:
    the ``K`` sheets one after the other in the bytes ``data``."""
    a = np.asarray(images, np.uint8)
    sheets = [encode_sheet(x, quality) for x in a]
    return dict(shape=np.asarray(a.shape, np.int64),
                offsets=np.cumsum([0] + [len(s) for s in sheets],
                                  dtype=np.int64),
                data=b"".join(sheets))


def decode_images(enc: dict) -> np.ndarray:
    """Inverse of :func:`encode_images`."""
    K, n, C, H, W, _ = (int(x) for x in enc["shape"])
    o, data = enc["offsets"], enc["data"]
    out = np.empty((K, n, C, H, W, 3), np.uint8)
    for k in range(K):
        out[k] = decode_sheet(data[int(o[k]):int(o[k + 1])], (n, C, H, W))
    return out
