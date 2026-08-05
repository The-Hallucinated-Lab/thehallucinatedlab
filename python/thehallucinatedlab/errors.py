"""Exception hierarchy for the toolkit.

One base class so callers can catch everything from the library with a
single ``except THLError``, and specific subclasses so they do not have
to parse message strings to tell a typo from a missing dependency.
"""

from __future__ import annotations


class THLError(Exception):
    """Base class for every error this package raises deliberately."""


class ToolNotFound(THLError):
    """No tool by that name exists in the manifest."""


class InvalidArgument(THLError):
    """An argument was supplied but is not something the tool accepts."""


class MissingArgument(THLError):
    """A required argument was not supplied at all."""


class UnsupportedFormat(THLError):
    """The format is in the manifest, but this install cannot encode it.

    Raised rather than writing a file whose extension lies about its
    contents -- the same guarantee the browser runtime makes when the
    canvas quietly falls back to PNG.
    """


class NexusLinkNotInstalled(THLError):
    """The NexusLink binding is not importable in this environment."""


class DependencyMissing(THLError):
    """A tool needs an optional dependency that is not installed.

    The base package depends only on Pillow. Document loading, chunking,
    embedding and indexing each pull in something substantial -- torch
    alone is larger than everything else here combined -- so they live
    behind extras and raise this instead of an ImportError traceback that
    does not say which extra to install.
    """

    def __init__(self, message: str, *, extra: str | None = None) -> None:
        super().__init__(message)
        self.extra = extra

