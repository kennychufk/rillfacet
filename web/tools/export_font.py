"""Export the native viewer's label font (SDF atlas + glyph metrics, built by
the same code as the renderer's) for the web client:

    PYTHONPATH=python python web/tools/export_font.py

writes web/public/font/label.png (the atlas, 8-bit grayscale) and
web/public/font/label.json (metrics). Re-run after changing the font code in
src/rillfacet/text.cpp; the outputs are committed.
"""
import json
import os

from PIL import Image

from rillfacet import _rillfacet

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public",
                   "font")


def main():
    f = _rillfacet.font_atlas()
    os.makedirs(OUT, exist_ok=True)
    atlas = f["atlas"]
    Image.fromarray(atlas, "L").save(os.path.join(OUT, "label.png"),
                                     optimize=True)
    meta = dict(width=int(atlas.shape[1]), height=int(atlas.shape[0]),
                base_px=f["base_px"], ascent=f["ascent"],
                line_height=f["line_height"], sdf_per_px=f["sdf_per_px"],
                glyphs={str(cp): dict(advance=a, uv=list(uv), offset=list(o),
                                      size=list(sz))
                        for cp, (a, uv, o, sz) in sorted(f["glyphs"].items())})
    with open(os.path.join(OUT, "label.json"), "w") as fh:
        json.dump(meta, fh, separators=(",", ":"))
    print(f"font atlas {atlas.shape[1]}x{atlas.shape[0]}, "
          f"{len(meta['glyphs'])} glyphs -> {os.path.normpath(OUT)}")


if __name__ == "__main__":
    main()
