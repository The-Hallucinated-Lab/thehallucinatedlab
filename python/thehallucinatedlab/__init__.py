"""The Hallucinated Lab toolkit.

Every tool in the lab is a method on this package:

    >>> from thehallucinatedlab import convert
    >>> result = convert("photo.jpg", format="png")

If you cannot remember what a tool takes, the argument reference is on
the website -- and it is generated from the very same spec this package
validates against, so the two cannot disagree:

    https://thehallucinatedlab.space/convert.html

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
    DependencyMissing,
    InvalidArgument,
    MissingArgument,
    NexusLinkNotInstalled,
    THLError,
    ToolNotFound,
    UnsupportedFormat,
)
from .nlp import merge_answer, parse
from .registry import Registry, registry
from .tools.chunk import Chunk, ChunkResult, chunk
from .tools.convert import ConvertResult, convert
from .tools.embed import EmbedResult, embed
from .tools.extract import ExtractResult, extract
from .tools.index import IndexResult, index
from .tools.tokenize import TokenReport, tokenize

__version__ = "0.2.0"

# Deprecated alias. The tool is "convert" everywhere now — website, spec,
# CLI and API — but `image_convert` shipped in 0.1.0, so it keeps working
# rather than breaking installs that already import it.
image_convert = convert

__all__ = [
    # tools
    "convert",
    "ConvertResult",
    "extract",
    "ExtractResult",
    "chunk",
    "Chunk",
    "ChunkResult",
    "tokenize",
    "TokenReport",
    "embed",
    "EmbedResult",
    "index",
    "IndexResult",
    # deprecated, kept for 0.1.0 compatibility
    "image_convert",
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
    "DependencyMissing",
    "__version__",
]
