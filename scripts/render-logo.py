#!/usr/bin/env python
"""Rasterise assets/images/logo.svg into the files the site still needs as pixels.

    python scripts/render-logo.py            # writes the three assets below
    python scripts/render-logo.py --preview out.png 512   # one PNG, any size

Outputs (all on the brand charcoal, since every social card and home-screen
tile shows the mark on that ground):

    assets/images/logo.jpeg        1024x1024, the og:image / JSON-LD logo
    assets/images/favicon-180.png  Apple touch icon
    assets/images/favicon-32.png   classic favicon

The SVG is the single source of the geometry. This script parses only what
the mark uses - absolute M / C / Z - and refuses anything else, so the SVG
cannot quietly grow a feature the rasters do not reproduce. Curves are
flattened, drawn at 4x and downsampled with Lanczos: Pillow has no vector
rasteriser, and the site keeps its Python footprint minimal on purpose.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SVG = ROOT / "assets" / "images" / "logo.svg"
OUT = ROOT / "assets" / "images"

CHARCOAL = (11, 15, 20)
PETAL = (215, 222, 232)  # --logo-petal, dark theme
SIGNAL = (242, 138, 61)  # --signal

SUPERSAMPLE = 4
SEGMENTS = 32  # per cubic; the mark is small, this is well past visible error

Point = tuple[float, float]


def parse_viewbox(svg: str) -> tuple[float, float, float, float]:
    m = re.search(r'viewBox="([-\d. ]+)"', svg)
    if not m:
        raise ValueError("logo.svg has no viewBox")
    parts = [float(v) for v in m.group(1).split()]
    if len(parts) != 4:
        raise ValueError("viewBox must have four numbers")
    return parts[0], parts[1], parts[2], parts[3]


def petals(svg: str) -> list[tuple[str, str]]:
    """Every <path class="petal …" d="…"> as (class, d), in document order."""
    found = re.findall(r'<path class="(petal[^"]*)" d="([^"]+)"', svg)
    if not found:
        raise ValueError("logo.svg has no petal paths")
    return found


def cubic(p0: Point, p1: Point, p2: Point, p3: Point, n: int = SEGMENTS) -> list[Point]:
    out: list[Point] = []
    for i in range(1, n + 1):
        t = i / n
        u = 1 - t
        x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0]
        y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
        out.append((x, y))
    return out


def flatten(d: str) -> list[Point]:
    """Absolute M, C and Z only. Anything else is an error, not a guess."""
    tokens = re.findall(r"[MCZ]|-?\d*\.?\d+(?:e-?\d+)?", d)
    pts: list[Point] = []
    i = 0
    cur: Point | None = None
    while i < len(tokens):
        cmd = tokens[i]
        i += 1
        if cmd == "M":
            cur = (float(tokens[i]), float(tokens[i + 1]))
            i += 2
            pts.append(cur)
        elif cmd == "C":
            if cur is None:
                raise ValueError("C before M")
            nums = [float(v) for v in tokens[i : i + 6]]
            if len(nums) != 6:
                raise ValueError("C needs six numbers")
            i += 6
            p1, p2, p3 = (nums[0], nums[1]), (nums[2], nums[3]), (nums[4], nums[5])
            pts.extend(cubic(cur, p1, p2, p3))
            cur = p3
        elif cmd == "Z":
            pass
        else:
            raise ValueError(f"unsupported path command in logo.svg: {cmd!r}")
    if len(pts) < 3:
        raise ValueError("a petal needs at least three points")
    return pts


def render(size: int, background: tuple[int, int, int] | None = CHARCOAL, pad: float = 0.0) -> Image.Image:
    """Draw the mark centred in a size x size image. pad is a fraction of size kept clear on each side."""
    svg = SVG.read_text(encoding="utf-8")
    vx, vy, vw, vh = parse_viewbox(svg)
    big = size * SUPERSAMPLE
    mode = "RGB" if background else "RGBA"
    im = Image.new(mode, (big, big), background if background else (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    inner = big * (1 - 2 * pad)
    scale = inner / max(vw, vh)
    ox = (big - vw * scale) / 2 - vx * scale
    oy = (big - vh * scale) / 2 - vy * scale
    for cls, d in petals(svg):
        colour = SIGNAL if "petal-signal" in cls else PETAL
        poly = [(x * scale + ox, y * scale + oy) for x, y in flatten(d)]
        draw.polygon(poly, fill=colour)
    return im.resize((size, size), Image.Resampling.LANCZOS)


def main(argv: list[str]) -> int:
    if not SVG.is_file():
        print(f"missing {SVG}", file=sys.stderr)
        return 2
    try:
        if len(argv) == 4 and argv[1] == "--preview":
            out, size = Path(argv[2]), int(argv[3])
            render(size, pad=0.06).save(out)
            print(f"wrote {out} ({size}px)")
            return 0
        if len(argv) != 1:
            print("usage: render-logo.py [--preview out.png size]", file=sys.stderr)
            return 2
        render(1024, pad=0.14).save(OUT / "logo.jpeg", quality=92, optimize=True, subsampling=0)
        render(180, pad=0.12).save(OUT / "favicon-180.png", optimize=True)
        # The favicon is tight: at 32px the gaps between petals are the mark.
        render(32, pad=0.04).save(OUT / "favicon-32.png", optimize=True)
    except (ValueError, OSError) as err:
        print(f"could not render the logo: {err}", file=sys.stderr)
        return 1
    for name in ("logo.jpeg", "favicon-180.png", "favicon-32.png"):
        print(f"wrote assets/images/{name} ({(OUT / name).stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
