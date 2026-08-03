"""Tool implementations.

One module per tool, each registering itself with the shared registry on
import. The manifest declares what a tool is; these modules are what it
does.
"""

from __future__ import annotations

from .converter import ConvertResult, converter

__all__ = ["converter", "ConvertResult"]
