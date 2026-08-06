"""Where figures go, and what they are called.

One small class, because figure naming is the sort of detail that ends up
duplicated in four places and inconsistent in three of them. It owns the
counter, the slug, the sampling caption that has to appear on every
affected figure, and closing the figure afterwards.

Names are ``01_revenue_histogram.png``: numbered so the directory sorts
into report order, named so a reader picking one out of a folder knows
what they have.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .errors import OutputNotWritable
from .types import PlotResult

_SLUG = re.compile(r"[^a-z0-9]+")


def slugify(text: str, limit: int = 40) -> str:
    """A filename-safe form of a column name.

    Column names are arbitrary strings and some of them are ``Revenue
    (USD, 2024) / net``. That has to become a filename on Windows, which
    means no slashes, no colons, and no trailing dots.
    """
    cleaned = _SLUG.sub("_", str(text).strip().casefold()).strip("_")
    return (cleaned[:limit].rstrip("_") or "column")


class FigureSink:
    """Numbers, names, saves and closes every figure a run produces."""

    def __init__(
        self,
        directory: Path,
        *,
        figure_format: str = "png",
        dpi: int = 110,
        caption: str = "",
    ) -> None:
        self.directory = Path(directory)
        self.figure_format = figure_format
        self.dpi = int(dpi)
        self.caption = caption
        self.written: list[PlotResult] = []
        self._n = 0

    def next_name(self, chart: str, column: str | None) -> str:
        self._n += 1
        parts = [f"{self._n:02d}"]
        if column:
            parts.append(slugify(column))
        parts.append(slugify(chart))
        return "_".join(parts) + "." + self.figure_format

    def save(
        self,
        fig: Any,
        *,
        chart: str,
        column: str | None = None,
        title: str = "",
        caption: str | None = None,
    ) -> PlotResult:
        """Write one figure and record it.

        The figure is closed whether or not the write succeeded --
        matplotlib holds every open figure in memory, and a wide dataset
        produces hundreds.
        """
        path = self.directory / self.next_name(chart, column)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            fig.savefig(
                path,
                format=self.figure_format,
                dpi=self.dpi,
                bbox_inches="tight",
                facecolor="white",
                edgecolor="none",
            )
        except OSError as err:
            raise OutputNotWritable(f"Could not write {path}: {err}") from err
        finally:
            _close(fig)

        result = PlotResult(
            path=path,
            chart=chart,
            column=column,
            title=title,
            caption=self.caption if caption is None else caption,
        )
        self.written.append(result)
        return result

    @property
    def paths(self) -> list[Path]:
        return [figure.path for figure in self.written]


def _close(fig: Any) -> None:
    try:
        import matplotlib.pyplot as plt  # noqa: PLC0415 - only needed when a figure exists

        plt.close(fig)
    except Exception:  # noqa: BLE001 - failing to close must not fail the run
        pass
