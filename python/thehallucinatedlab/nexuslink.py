"""Access to the NexusLink Engine through the toolkit namespace.

NexusLink is a separate project -- a Rust SDK with a Python binding,
built and released from its own repository. Vendoring a Rust crate into
this pure-Python package would be the wrong trade, so this module is a
thin door onto the real binding instead: import it if it is installed,
and fail with something actionable if it is not.

The import is lazy, via PEP 562, so ``import thehallucinatedlab`` costs
nothing for the people who only wanted to convert an image.

    >>> from thehallucinatedlab import nexuslink
    >>> nexuslink.is_available()
    False

The binding is not on PyPI yet, so there is no extra to install it with;
the error points at the repository instead. When it does ship, this
module starts working with no change here.
"""

from __future__ import annotations

import importlib
from typing import Any

from .errors import NexusLinkNotInstalled

_REPOSITORY = "https://github.com/06pratyush/NexusLinkEngine"
_binding: Any = None


def _load() -> Any:
    global _binding
    if _binding is None:
        try:
            _binding = importlib.import_module("nexuslink")
        except ImportError as err:  # pragma: no cover - depends on the environment
            raise NexusLinkNotInstalled(
                "The NexusLink binding is not installed. It is built and released "
                f"separately -- see {_REPOSITORY} for build and install instructions."
            ) from err
    return _binding


def is_available() -> bool:
    """True when the NexusLink binding can be imported.

    Use this to branch, rather than catching the exception, when
    NexusLink is an optional part of your program.
    """
    try:
        _load()
    except NexusLinkNotInstalled:
        return False
    return True


def __getattr__(name: str) -> Any:
    """Forward every attribute to the real binding, loading it on first use."""
    if name.startswith("__"):
        raise AttributeError(name)
    return getattr(_load(), name)


def __dir__() -> list[str]:
    local = ["is_available"]
    try:
        return sorted(set(local) | set(dir(_load())))
    except NexusLinkNotInstalled:
        return local
