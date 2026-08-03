"""The Hallucinated Lab toolkit.

Every tool in the lab is a method on this package:

    >>> from thehallucinatedlab import image_convert
    >>> result = image_convert("photo.jpg", format="png")

If you cannot remember what a tool takes, the argument reference is on
the website -- and it is generated from the very same spec this package
validates against, so the two cannot disagree:

    https://thehallucinatedlab.space/image-converter.html

You can also ask in plain english:

    >>> from thehallucinatedlab import parse
    >>> parse("convert it to webp at 80")["args"]
    {'format': 'webp', 'quality': 80}

Or from a shell::

    thl tools
    thl convert photo.jpg --format png
    thl "convert photo.jpg to webp at 80"
"""

from __future__ import annotations

from . import nexuslink
from .errors import (
    InvalidArgument,
    MissingArgument,
    NexusLinkNotInstalled,
    THLError,
    ToolNotFound,
    UnsupportedFormat,
)
from .nlp import merge_answer, parse
from .registry import Registry, registry
from .tools.image_convert import ConvertResult, image_convert

__version__ = "0.1.0"

__all__ = [
    # tools
    "image_convert",
    "ConvertResult",
    # natural language
    "parse",
    "merge_answer",
    # the spec behind all of it
    "registry",
    "Registry",
    # companion projects
    "nexuslink",
    # errors
    "THLError",
    "ToolNotFound",
    "InvalidArgument",
    "MissingArgument",
    "UnsupportedFormat",
    "NexusLinkNotInstalled",
    "__version__",
]
