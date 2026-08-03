"""Tool implementations.

One module per tool, each registering itself with the shared registry on
import. The manifest declares what a tool is; these modules are what it
does.
"""

from __future__ import annotations

from .image_convert import ConvertResult, image_convert

__all__ = ["image_convert", "ConvertResult"]
