#!/usr/bin/env python3
"""Validate every WGSL entry shader (x every style) with Dawn's `tint` CLI.

Expands `#include` exactly like src/rillfacet/shader_library.cpp.
Usage: python3 scripts/check_shaders.py [shader.wgsl ...]
"""
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SHADERS = os.path.join(ROOT, "shaders")
TINT = os.path.join(ROOT, "third_party", "dawn", "bin", "tint")
STYLES = ["studio", "matcap", "pbr", "technical"]
ENTRY = ["mesh.wgsl", "points.wgsl", "curves.wgsl", "arrows.wgsl", "grid.wgsl", "ssao.wgsl",
         "composite.wgsl", "overlay_lines.wgsl", "overlay_text.wgsl", "blit.wgsl",
         "env_prefilter.wgsl"]


def expand(path, aliases, depth=0):
    out = []
    with open(os.path.join(SHADERS, path)) as f:
        for line in f:
            s = line.strip()
            if s.startswith("#include"):
                arg = s[len("#include"):].strip()
                target = arg[1:-1] if arg.startswith('"') else aliases[arg]
                out.append(expand(target, aliases, depth + 1))
            else:
                out.append(line)
    return "".join(out)


def main():
    files = sys.argv[1:] or ENTRY
    failed = 0
    for name in files:
        src = open(os.path.join(SHADERS, name)).read()
        styles = STYLES if "#include STYLE" in src else [None]
        for style in styles:
            code = expand(name, {"STYLE": f"styles/{style}.wgsl"} if style else {})
            with tempfile.NamedTemporaryFile("w", suffix=".wgsl", delete=False) as tmp:
                tmp.write(code)
            entries = re.findall(r"@(?:vertex|fragment|compute)[^\n]*\n?\s*fn\s+(\w+)", code)
            for ep in entries:
                r = subprocess.run([TINT, "--format", "spirv", "--ep", ep, "-o", os.devnull,
                                    tmp.name], capture_output=True, text=True)
                label = f"{name}:{ep}" + (f" [{style}]" if style else "")
                if r.returncode != 0:
                    failed += 1
                    print(f"FAIL {label}\n{r.stdout}{r.stderr}")
                else:
                    print(f"ok   {label}")
            os.unlink(tmp.name)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
