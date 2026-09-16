#!/usr/bin/env python
"""Print the metric-matched fallback overrides fonts.css needs.

    python scripts/font-metrics.py <webfont.ttf|.otf> <fallback.ttf|.otf>

Uses the TTF build of the webfont (Google Fonts serves it to a non-woff2
User-Agent; see README.md) because fontTools cannot open WOFF2 without
brotli, and the site keeps its Python dependencies minimal on purpose.

The four numbers are computed the way font-fallback generators do it:
size-adjust is the ratio of average advance widths over an English-weighted
sample, and the vertical overrides are the webfont's hhea metrics divided
by its unitsPerEm and by size-adjust, so the fallback occupies exactly the
line box the webfont will when it swaps in.
"""

from __future__ import annotations

import sys
from pathlib import Path

from fontTools.ttLib import TTFont

# Lowercase weighted four to one: that is what prose is made of.
SAMPLE = "etaoinshrdlucmfwypvbgkjqxz" * 4 + "ETAOINSHRDLUCMFWYPVBGKJQXZ" + "0123456789 .,"


def metrics(path: Path) -> dict[str, float]:
    """Return unitsPerEm, hhea ascent/descent/lineGap and the mean advance."""
    font = TTFont(path)
    upem = float(font["head"].unitsPerEm)
    hhea = font["hhea"]
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    advances = [hmtx[cmap[ord(c)]][0] for c in SAMPLE if ord(c) in cmap]
    if not advances:
        raise ValueError(f"{path}: none of the sample glyphs are present")
    return {
        "upem": upem,
        "ascent": float(hhea.ascent),
        "descent": float(abs(hhea.descent)),
        "gap": float(hhea.lineGap),
        "avg": sum(advances) / len(advances),
    }


def overrides(web: dict[str, float], fallback: dict[str, float]) -> dict[str, float]:
    """Compute size-adjust and the three vertical overrides, as percentages."""
    size_adjust = (web["avg"] / web["upem"]) / (fallback["avg"] / fallback["upem"])
    scale = 100.0 / size_adjust / web["upem"]
    return {
        "size-adjust": size_adjust * 100.0,
        "ascent-override": web["ascent"] * scale,
        "descent-override": web["descent"] * scale,
        "line-gap-override": web["gap"] * scale,
    }


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__.strip().splitlines()[2].strip(), file=sys.stderr)
        return 2
    web_path, fallback_path = Path(argv[1]), Path(argv[2])
    for p in (web_path, fallback_path):
        if not p.is_file():
            print(f"not a file: {p}", file=sys.stderr)
            return 2
    try:
        result = overrides(metrics(web_path), metrics(fallback_path))
    except (KeyError, ValueError) as err:
        print(f"could not read font metrics: {err}", file=sys.stderr)
        return 1
    for key, value in result.items():
        print(f"  {key}: {value:.2f}%;")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
